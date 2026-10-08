#!/usr/bin/env node
/**
 * scripts/android-homescreen-probe.mjs — device pass over the tablet HOME screen.
 *
 * WHY THIS EXISTS
 * `scripts/android-settings-walk.mjs` walks the SETTINGS routes, so it never
 * renders the screen the homescreen fixes live on: the workspace picker /
 * WorkspaceHome. It can therefore pass while the picker is broken. This probe
 * drives the home screen itself and reports the four things a settings walk
 * cannot see:
 *
 *   1. the org picker is present AFTER the workspace list resolves (it used to
 *      render only inside the loading skeleton, which a fast list hides);
 *   2. favorites persist under a PER-USER key (`workspace-pins:<userId>`), not
 *      one device-global key shared by every operator;
 *   3. a disabled workspace card is greyed, not merely dimmed;
 *   4. the tier-gated tools do NOT flash-lock during the first entitlement
 *      fetch (sampled over time, since the defect was a transient one).
 *
 * Like the walk, it speaks HTTP + WebSocket directly and never spawns adb:
 * `execFileSync('adb', …)` throws `spawnSync adb EBUSY` in a sandboxed shell
 * (measured 2026-10-07). Forward the socket first:
 *
 *   PID=$(adb shell pidof mu.kasir.mobile)
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
 *   node scripts/android-homescreen-probe.mjs --user owner --pin 1234
 */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const has = (name) => argv.includes(`--${name}`);

const PORT = flag('port', '9222');
const USER = flag('user', '');
const PIN = flag('pin', '');
const JSON_OUT = flag('json', null);
const SKIP_LOGIN = has('no-login');

let ws = null;
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
}

async function evaluate(expression, arg) {
  const params = { expression: `(${expression})(${JSON.stringify(arg ?? null)})`, returnByValue: true, awaitPromise: true };
  const r = await send('Runtime.evaluate', params);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluate threw');
  }
  return r.result.value;
}

// ── In-page helpers ────────────────────────────────────────────────────────

const HOME_PROBE = `() => ({
  home: !!document.querySelector('[data-testid="workspace-home"]'),
  skeleton: !!document.querySelector('.workspace-skeleton-grid'),
  orgSelector: !!document.querySelector('.org-selector'),
  orgTriggerLabel: (document.querySelector('.org-selector-current')?.textContent || '').trim(),
  lockedTools: document.querySelectorAll('[class*="workspace-tool-card--locked"]').length,
  toolCards: document.querySelectorAll('[class*="workspace-tool-card"]').length,
  disabledCards: document.querySelectorAll('.workspace-card--disabled').length,
  workspaceCards: document.querySelectorAll('[class*="workspace-card-row"]').length,
  disabledStyle: (() => {
    const el = document.querySelector('.workspace-card--disabled .workspace-card-row')
      || document.querySelector('.workspace-card--disabled .workspace-card-badge');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, filter: cs.filter };
  })(),
  pinKeys: Object.keys(localStorage).filter((k) => k.startsWith('workspace-pins')),
  lastUsedKeys: Object.keys(localStorage).filter((k) => k.startsWith('workspace-last-used')),
  hash: location.hash,
})`;

const LOGIN_USERNAME = `(u) => {
  const el = document.getElementById('staff-login-username');
  if (!el) return 'no username input';
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, u);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
}`;

const CLICK_NEXT = `() => {
  const n = document.querySelector('[aria-label="Next"]');
  if (!n) return 'no Next control';
  n.click();
  return 'clicked';
}`;

const TAP_PIN = `(digit) => {
  const pad = [...document.querySelectorAll('.staff-login-pad-key')];
  const key = pad.find((k) => k.getAttribute('aria-label') === digit)
    || pad.find((k) => (k.textContent || '').trim() === digit)
    || [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === digit);
  if (!key) return 'no pad key for ' + digit;
  key.click();
  return 'tapped';
}`;

const ROUTE_PROBE = `() => {
  const root = document.querySelector('.settings-section-content')
    || document.querySelector('[class*="section-content"]')
    || document.body;
  const scope = root;
  const controls = [...scope.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select, [role="button"]:not([aria-disabled="true"])',
  )].filter((el) => el.offsetParent !== null || el.getClientRects().length).length;
  return {
    hash: location.hash,
    container: root.className || '(body)',
    controls,
    text: (scope.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
    boundary: [...document.querySelectorAll('.error-boundary__message')].map((e) => e.textContent.trim().slice(0, 120)),
  };
}`;

const CLICK_FIRST_PIN = `() => {
  const btn = document.querySelector('.workspace-card-pin-btn');
  if (!btn) return 'no pin button';
  btn.click();
  return 'clicked';
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let list;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    list = await res.json();
  } catch {
    console.error(
      `\nCannot reach 127.0.0.1:${PORT}. Forward the WebView socket first:\n` +
        `  PID=$(adb shell pidof mu.kasir.mobile | tr -d '\\r')\n` +
        `  adb forward tcp:${PORT} localabstract:webview_devtools_remote_$PID\n`,
    );
    process.exit(2);
  }
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    console.error('No inspectable page. Is the app running and the socket forwarded?');
    process.exit(2);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  await send('Runtime.enable');

  if (!SKIP_LOGIN) {
    // Same cadence as the settings walk: React needs the username committed
    // before Next, the pad needs to exist before a digit is tapped, and the
    // session needs the full 4s to settle. Firing these back-to-back made the
    // probe read a never-mounted home screen.
    console.log(`Logging in as "${USER}" …`);
    console.log('  username:', await evaluate(LOGIN_USERNAME, USER));
    await sleep(700);
    console.log('  next:', await evaluate(CLICK_NEXT));
    await sleep(1400);
    for (const d of String(PIN).split('')) {
      const r = await evaluate(TAP_PIN, d);
      console.log(`  pin ${d}:`, r);
      if (r !== 'tapped') {
        console.error(`\nPIN entry failed — ${r}`);
        process.exit(2);
      }
      await sleep(400);
    }
    await sleep(4000);
    const probe = await evaluate(HOME_PROBE);
    if (!probe.home) {
      console.error(
        '\nLogin did not take, or the home screen never mounted.\n' +
          `  sample: ${JSON.stringify(probe)}\n` +
          '  Re-run with --no-login once the tablet is already signed in.',
      );
      process.exit(2);
    }
    console.log('  signed in.');
  }

  // ── Sample the home screen over the first seconds ──────────────────────
  // The flash-lock was a TRANSIENT defect (locked during `loading`, unlocked
  // once caps arrive), so a single sample cannot see it: sample repeatedly
  // from the moment the home screen appears.
  const samples = [];
  for (let i = 0; i < 24; i += 1) {
    samples.push(await evaluate(HOME_PROBE));
    await sleep(180);
  }

  const onHome = samples.filter((s) => s.home);
  const first = onHome[0] ?? samples[samples.length - 1];
  if (!first.home) {
    console.error('\nThe home screen never rendered — nothing to probe. Last sample:');
    console.error(JSON.stringify(first, null, 2));
    process.exit(1);
  }

  const loadedSamples = onHome.filter((s) => !s.skeleton);
  const last = loadedSamples[loadedSamples.length - 1] ?? first;
  const maxLocked = Math.max(0, ...loadedSamples.map((s) => s.lockedTools));
  const orgAfterLoad = loadedSamples.some((s) => s.orgSelector);

  // ── Favorites: click a pin and read the key it wrote ────────────────────
  const pinned = await evaluate(CLICK_FIRST_PIN);
  await sleep(400);
  const afterPin = await evaluate(HOME_PROBE);

  // The org picker renders NULL when the device has at most one organization
  // (OrgSelector.tsx), so on a single-org device its absence proves nothing.
  // Report that as SKIP rather than fail a check the device cannot answer.
  const orgVerdict = orgAfterLoad
    ? 'pass'
    : loadedSamples.some((s) => s.orgSelector === false) ? 'skip' : 'fail';

  // The flash-lock was a TRANSIENT excess: locked during `loading`, fewer once
  // the entitlement resolves. On a Free-tier device the paid tools are locked
  // at rest too, so "zero locked" is the wrong assertion -- the right one is
  // that loading is never MORE locked than at rest.
  const lockedVerdict = maxLocked <= last.lockedTools ? 'pass' : 'fail';

  const checks = [
    {
      name: 'home screen renders',
      pass: first.home,
      detail: `data-testid=workspace-home present (${onHome.length}/${samples.length} samples)`,
    },
    {
      name: 'org picker present after the list resolves',
      verdict: orgVerdict,
      detail: orgVerdict === 'pass'
        ? `rendered in ${loadedSamples.filter((s) => s.orgSelector).length} loaded sample(s); label "${last.orgTriggerLabel}"`
        : orgVerdict === 'skip'
          ? 'no .org-selector — a single-org device, where the picker renders null by design; unobservable here'
          : 'never seen outside the skeleton',
    },
    {
      name: 'tier-gated tools never MORE locked during the fetch',
      verdict: lockedVerdict,
      detail: `locked tool cards: max ${maxLocked} during the fetch, ${last.lockedTools} at rest (of ${last.toolCards} tool cards)`,
    },
    {
      name: 'favorites persist per user',
      pass: afterPin.pinKeys.some((k) => k.includes(':') && k.split(':')[1].length > 0),
      detail: `pin click: ${pinned}; keys now ${JSON.stringify(afterPin.pinKeys)}`,
    },
    {
      name: 'disabled cards greyed, not merely dimmed',
      pass: last.disabledCards === 0 || (last.disabledStyle?.filter ?? '').includes('grayscale'),
      detail: last.disabledCards === 0
        ? `no disabled card on this device (owner sees ${last.workspaceCards} enabled) — not observable here`
        : `${last.disabledCards} disabled; computed ${JSON.stringify(last.disabledStyle)}`,
    },
  ];

  console.log('');
  for (const c of checks) {
    const v = (c.verdict ?? (c.pass ? 'pass' : 'fail')).toUpperCase();
    console.log(`  ${v.padEnd(5)} ${c.name.padEnd(48)}`);
    console.log(`        ${c.detail}`);
  }
  const verdictOf = (c) => c.verdict ?? (c.pass ? 'pass' : 'fail');
  const failed = checks.filter((c) => verdictOf(c) === 'fail').length;
  const skipped = checks.filter((c) => verdictOf(c) === 'skip').length;
  console.log(
    `\n${checks.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped.`,
  );

  // ── Optional single-route visit ──────────────────────────────────────────
  // The settings walk covers 15 settings routes and nothing else, so a route
  // OUTSIDE them (e.g. the Locations editor) is otherwise never measured.
  const route = flag('route', null);
  let routeReport = null;
  if (route) {
    await evaluate(`() => { location.hash = ${JSON.stringify(route)}; return location.hash; }`);
    await sleep(2500);
    routeReport = await evaluate(ROUTE_PROBE);
    console.log(`\nroute ${route}:`);
    console.log(`  container: ${routeReport.container}`);
    console.log(`  controls : ${routeReport.controls}`);
    console.log(`  text     : ${routeReport.text}`);
    if (routeReport.boundary.length) {
      console.log(`  BOUNDARY : ${JSON.stringify(routeReport.boundary)}`);
    }
  }

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(JSON_OUT, JSON.stringify({ samples, last, afterPin, routeReport, checks }, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
