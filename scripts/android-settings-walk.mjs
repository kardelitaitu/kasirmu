#!/usr/bin/env node
/**
 * Repeatable live walk of the tablet settings hub and the topology route, over CDP.
 *
 * WHY THIS EXISTS
 *   plan-tablet-homescreen-settings.md section 2.4 names the gap: the settings
 *   half of the tablet audit was static-only because nobody could re-run a walk
 *   without a person typing a PIN. This script is the repeatable version. It
 *   logs in, walks every section, and prints a per-section verdict.
 *
 * PREREQUISITE — the adb forward must already exist, set up from bash.
 *   DO NOT spawn adb from node: `execFileSync('adb', …)` throws `spawnSync adb
 *   EBUSY` in this sandbox (measured 2026-10-07; see .agents/skills/
 *   android-adb-connect/SKILL.md). This script therefore speaks HTTP + WebSocket
 *   only, and prints the bash line below when the port is not listening.
 *
 *     export PATH="$PATH:$ANDROID_HOME/platform-tools"
 *     for i in $(seq 1 8); do D=$(adb devices | sed -n '2p' | awk '{print $1}'); [ -n "$D" ] && break; sleep 2; done
 *     PID=$(adb shell pidof mu.kasir.mobile | tr -d '\r')
 *     adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
 *
 * USAGE
 *   node scripts/android-settings-walk.mjs --user owner --pin 1234
 *   node scripts/android-settings-walk.mjs --user owner --pin 1234 --json walk.json
 *   node scripts/android-settings-walk.mjs --port 9222 --no-login   # tablet already signed in
 *
 * LOGIN
 *   `--user` / `--pin` are the DEMO staff credentials for the Redmi 23073RPBFG
 *   test tablet (Android 15, mu.kasir.mobile 0.0.41, DEBUGGABLE). They are
 *   recorded here on purpose: §2.4 requires the walk to state the login it
 *   needs, and a walk nobody can reproduce is the rot this script prevents.
 *   Override on the command line for any other device.
 *
 * VERDICT
 *   FAIL — the section rendered the error boundary, threw an uncaught
 *          exception, or did not mount its container at all.
 *   WARN — the section mounted but rendered no controls, or logged a
 *          console.error. Reported, not fatal; several are pre-existing.
 *   Exit 1 on any FAIL, or if the login did not take.
 */

const SECTIONS = [
  'general',
  'license-subscription',
  'devices-connectivity',
  'business-defaults',
  'features-modules',
  'security-account',
  'data-sync',
  'data-management',
  'sync-status',
  'sync-conflicts',
  'offline-queue',
  'tax-configuration',
  'exchange-rates',
  'system-diagnostics',
];

// The topology route is walked too: it is the crash this whole plan started
// from (H1), so it belongs in the acceptance walk, not only in unit tests.
const TOPOLOGY_ROUTE = '#/topology';

const args = process.argv.slice(2);
// Accepts BOTH `--name value` and `--name=value`; the space form is what the
// header documents, and missing the `=` form silently walked every route once.
const flag = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3) || fallback;
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const PORT = Number(flag('port', '9222'));
const USER = flag('user', 'owner');
const PIN = flag('pin', '1234');
const SKIP_LOGIN = args.includes('--no-login');
// Route selection. `--routes=sections` exists because the hub's error boundary
// is STICKY: once one route trips it, every later route renders "Something went
// wrong" until the app restarts. Walking sections alone is how you tell a real
// per-section defect apart from one earlier crash poisoning the whole run.
const ROUTES = flag('routes', 'all');
const JSON_OUT = flag('json', null);
const SETTLE_MS = Number(flag('settle', '2200'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP transport ───────────────────────────────────────────────────────────
let ws;
let nextId = 0;
const errors = [];

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluate threw',
    );
  }
  return r.result.value;
}

// ── In-page helpers (run inside the WebView) ────────────────────────────────

const PROBE = `(() => {
  const login = !!document.getElementById('staff-login-username');
  const root = document.querySelector('.settings-section-content')
    || document.querySelector('[class*="settings-section"]')
    || document.querySelector('.node-canvas-container');
  const scope = root || document.body;
  const text = (scope.textContent || '').replace(/\\s+/g, ' ').trim();
  // WHERE the crash text lives, not just that it does. MUST be boundary
  // elements specifically: measured 2026-10-07, matching the raw string in
  // body text false-FAILed the topology route — its load-failure TOAST reads
  // "Failed to load topology: Something went wrong. Please try again.", which
  // is a real defect signal but not a boundary, and it belongs to WARN.
  const boundaryMsgs = [...document.querySelectorAll('.error-boundary__message')]
    .map((e) => e.textContent.trim().slice(0, 160));
  const toasts = [...document.querySelectorAll('.toast__message')]
    .map((e) => e.textContent.trim().slice(0, 160))
    .slice(0, 3);
  return JSON.stringify({
    login,
    container: root ? String(root.className).slice(0, 70) : null,
    controls: scope.querySelectorAll('input,select,textarea,button').length,
    text: text.slice(0, 130),
    crash: boundaryMsgs.length > 0,
    boundaryMsgs,
    toasts,
    invokeFailures: (window.__TAURI_INTERNALS__?.__invokeFailures || []),
    hash: location.hash,
  });
})()`;

const LOGIN_USERNAME = `(u) => {
  const el = document.getElementById('staff-login-username');
  if (!el) return 'no username input';
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, u);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
}`;

const CLICK_NEXT = `(() => {
  const n = document.querySelector('[aria-label="Next"]');
  if (!n) return 'no Next control';
  n.click();
  return 'clicked';
})()`;

const TAP_PIN = `(digit) => {
  const pad = [...document.querySelectorAll('.staff-login-pad-key')];
  const key = pad.find((k) => k.getAttribute('aria-label') === digit)
    || pad.find((k) => (k.textContent || '').trim() === digit)
    || [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === digit);
  if (!key) return 'no pad key for ' + digit + ' (have: ' + pad.map((k) => k.getAttribute('aria-label')).join(',') + ')';
  key.click();
  return 'tapped';
}`;

// ── Main ────────────────────────────────────────────────────────────────────

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
  const page = list.find((t) => t.type === 'page');
  if (!page) {
    console.error('No CDP page target. Is mu.kasir.mobile in the foreground?');
    process.exit(2);
  }

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(e.message ?? 'ws error')), { once: true });
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')
        .replace(/\s+/g, ' ');
      errors.push(`console.error: ${text.slice(0, 180)}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(`uncaught: ${(d.exception?.description ?? d.text ?? '').split('\n')[0].slice(0, 180)}`);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  // Capture every rejected invoke from before the first navigation onward:
  // the partial-load toast ("Some settings could not be loaded") names no
  // command, and its source is intermittent.
  //
  // MEASURED 2026-10-07, INERT on this build: the patch attaches to
  // `window.__TAURI_INTERNALS__.invoke`, but the app's transport is
  // `ui/src/api/tauri.ts` `invoke` → `rawInvoke` from `@tauri-apps/api/core`,
  // and on-device traces showed ZERO calls through the patched door while the
  // fan-out demonstrably ran. Likely the dev-mock layer or a captured module
  // reference replaces the door before we attach. Left in place because it is
  // harmless and will start biting the moment the transport is understood;
  // the productive next probe is a debug build with a subscriber on the
  // ERR-06 telemetry channel (`utils/logged-invoke.ts` `emitIpcError`), which
  // sees every failure by construction.
  await evaluate(`(() => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || internals.__walkPatched) return;
    internals.__walkPatched = true;
    const orig = internals.invoke.bind(internals);
    internals.__invokeFailures = [];
    internals.invoke = (cmd, payload, options) => {
      const p = Promise.resolve(orig(cmd, payload, options));
      p.catch((e) => {
        const list = internals.__invokeFailures;
        if (list.length < 40) list.push(cmd + ': ' + String((e && e.message) || e).slice(0, 120));
      });
      return p;
    };
  })()`);

  // ── Login ────────────────────────────────────────────────────────────────
  let state = JSON.parse(await evaluate(PROBE));
  if (state.login && !SKIP_LOGIN) {
    console.log(`Logging in as "${USER}" …`);
    console.log('  username:', await evaluate(`(${LOGIN_USERNAME})(${JSON.stringify(USER)})`));
    await sleep(700);
    console.log('  next:', await evaluate(CLICK_NEXT));
    await sleep(1400);
    for (const digit of PIN.split('')) {
      const r = await evaluate(`(${TAP_PIN})(${JSON.stringify(digit)})`);
      if (r !== 'tapped') {
        console.error(`  PIN entry failed — ${r}`);
        process.exit(2);
      }
      await sleep(400);
    }
    await sleep(4000);
    state = JSON.parse(await evaluate(PROBE));
    if (state.login) {
      console.error(
        '\nLogin did not take — still on the staff login screen.\n' +
          'The walk needs a signed-in tablet; re-run with --user/--pin for this device.',
      );
      process.exit(2);
    }
    console.log('  signed in.');
  } else if (SKIP_LOGIN) {
    console.log('Skipping login (--no-login).');
  } else {
    console.log('Already signed in.');
  }

  // ── Walk ─────────────────────────────────────────────────────────────────
  const sections = SECTIONS.map((s) => `#/settings/${s}`);
  const routes =
    ROUTES === 'sections' ? sections
    : ROUTES === 'topology' ? [TOPOLOGY_ROUTE]
    : [TOPOLOGY_ROUTE, ...sections];
  const results = [];

  for (const route of routes) {
    errors.length = 0;
    await evaluate(`location.hash = ${JSON.stringify(route)}`);
    await sleep(SETTLE_MS);
    const probe = JSON.parse(await evaluate(PROBE));
    const errs = [...errors];

    const problems = [];
    let verdict = 'ok';
    if (route === TOPOLOGY_ROUTE) {
      // The route is WITHDRAWN on the tablet (plan §5.1): the expected state
      // is the explanatory notice. The editor mounting here — or a toast —
      // is the regression, not the absence of a canvas.
      const notice = await evaluate(
        `!!document.querySelector('[data-testid="topology-tablet-unavailable"]')`,
      );
      if (notice && !probe.crash && probe.toasts.length === 0) {
        results.push({ route, verdict: 'ok', controls: 0, container: 'withdrawn — notice', problems: [], text: probe.text, toasts: [] });
        console.log(`  . ${route.padEnd(30)} withdrawn — notice rendered`);
        continue;
      }
      problems.push(notice ? 'notice rendered alongside errors' : 'editor mounted on the tablet');
      verdict = 'FAIL';
    }
    if (probe.crash) {
      problems.push(`rendered the error boundary — ${probe.boundaryMsgs.join(' | ')}`);
      verdict = 'FAIL';
    }
    if (probe.toasts.length) {
      problems.push(`toast: ${probe.toasts.join(' | ')}`);
      if (verdict === 'ok') verdict = 'WARN';
    }
    if ((probe.invokeFailures ?? []).length) {
      problems.push(`invoke failed: ${[...new Set(probe.invokeFailures)].join(' | ')}`);
    }
    if (errs.some((e) => e.startsWith('uncaught'))) {
      problems.push(`uncaught exception (${errs.find((e) => e.startsWith('uncaught'))})`);
      verdict = 'FAIL';
    }
    if (!probe.container) {
      problems.push('no section container mounted');
      verdict = 'FAIL';
    }
    if (probe.controls === 0) {
      problems.push('no interactive controls');
      if (verdict === 'ok') verdict = 'WARN';
    }
    if (errs.some((e) => e.startsWith('console.error'))) {
      problems.push(`console.error (${errs.find((e) => e.startsWith('console.error'))})`);
      if (verdict === 'ok') verdict = 'WARN';
    }

    results.push({ route, verdict, controls: probe.controls, container: probe.container, problems, text: probe.text, toasts: probe.toasts ?? [], invokeFailures: probe.invokeFailures ?? [] });
    const marker = verdict === 'FAIL' ? 'x' : verdict === 'WARN' ? '!' : '.';
    console.log(`  ${marker} ${route.padEnd(30)} controls=${String(probe.controls).padStart(3)}  ${problems.join('; ')}`);
  }

  const failed = results.filter((r) => r.verdict === 'FAIL');
  const warned = results.filter((r) => r.verdict === 'WARN');
  console.log(
    `\n${results.length} routes walked — ${results.length - failed.length - warned.length} ok, ` +
      `${warned.length} warn, ${failed.length} fail.`,
  );

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }

  ws.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('walk failed:', e.message);
  process.exit(2);
});
