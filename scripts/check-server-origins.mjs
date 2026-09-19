// ── check-server-origins.mjs ───────────────────────────────────────────────
// Drift guard for the server origin (ADR #55).
//
// The compiled origin list lives in crates/kasirmu-core/src/server_origin.rs.
// Every other place that names or allows an origin must agree with it, or the
// app authenticates against one host and syncs to another with nothing
// detecting it — the failure reads as "cloud sync silently does nothing".
// This check is what makes "one list" true rather than aspirational.
//
// Usage:  node scripts/check-server-origins.mjs
// Exit:   0 fresh (one ok: line), 1 drift (findings), 2 could not read/parse.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch (e) {
    console.error('error: cannot read ' + rel + ': ' + e.message);
    process.exit(2);
  }
}

const SOURCE = 'crates/kasirmu-core/src/server_origin.rs';
const src = read(SOURCE);

function constant(name) {
  const m = src.match(new RegExp(name + '\\s*:\\s*&str\\s*=\\s*"([^"]+)"'));
  if (!m) {
    console.error('error: ' + name + ' not declared in ' + SOURCE);
    process.exit(2);
  }
  return m[1];
}

const MAIN = constant('MAIN_SERVER_ORIGIN');
const FALLBACK = constant('FALLBACK_SERVER_ORIGIN');
const host = (u) => new URL(u).host;

function check(ok, message) {
  if (!ok) findings.push(message);
}

/** True when a CSP connect-src directive admits the given host. */
function admits(directive, h) {
  if (directive.includes('https://' + h)) return true;
  const suffix = h.split('.').slice(-2).join('.');
  return directive.includes('https://*.' + suffix);
}

// 1. Both Tauri allowlists must admit both names (either can be resolved), and
//    the RELEASE csp must contain no loopback origin at all (ADR #55 D4).
for (const file of ['apps/desktop-tauri/tauri.conf.json', 'apps/mobile-tauri/tauri.conf.json']) {
  const text = read(file);
  for (const key of ['csp', 'devCsp']) {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"[^"]*?connect-src([^;"]*)'));
    check(Boolean(m), file + ' (' + key + '): no connect-src directive found');
    if (!m) continue;
    const directive = m[1];
    check(admits(directive, host(MAIN)), file + ' (' + key + '): connect-src does not admit ' + MAIN);
    check(admits(directive, host(FALLBACK)), file + ' (' + key + '): connect-src does not admit ' + FALLBACK);
    if (key === 'csp') {
      check(
        !/localhost|127\.0\.0\.1/.test(directive),
        file + ' (csp): release connect-src names a loopback origin: ' + directive.trim(),
      );
    }
  }
}

// 2. The Worker allowlist must admit both names, and its API fallback must be
//    the canonical origin.
const worker = read('website/worker.ts');
// NOTE: the exclusion class must NOT contain an apostrophe -- a CSP directive
// begins with 'self', so excluding it captured only the space after the name and
// the gate then reported that the Worker admitted neither origin.
const workerCsp = worker.match(/connect-src([^;"\n]*)/);
check(Boolean(workerCsp), 'website/worker.ts: no connect-src directive found');
if (workerCsp) {
  check(admits(workerCsp[1], host(MAIN)), 'website/worker.ts: connect-src does not admit ' + MAIN);
  check(
    admits(workerCsp[1], host(FALLBACK)),
    'website/worker.ts: connect-src does not admit ' + FALLBACK,
  );
}
check(
  worker.includes("LICENSE_API_URL ?? '" + MAIN + "'"),
  "website/worker.ts: the LICENSE_API_URL fallback must be " + MAIN,
);

// 3. The settings draft proposes the canonical origin, never the second name.
const settings = read('ui/src/contexts/SettingsContext.tsx');
check(
  settings.includes("'" + MAIN + "'"),
  'ui/src/contexts/SettingsContext.tsx: the sync URL draft must be ' + MAIN,
);
check(
  !settings.includes("'" + FALLBACK + "'"),
  'ui/src/contexts/SettingsContext.tsx: the sync URL draft must not prefill the fallback name ' + FALLBACK,
);

// 4. The two Rust fallbacks must reference the list instead of carrying a
//    literal of their own.
const bridge = read('crates/kasirmu-bridge/src/sync.rs');
check(
  bridge.includes('server_origin::MAIN_SERVER_ORIGIN'),
  'crates/kasirmu-bridge/src/sync.rs: the debug probe fallback must reference server_origin::MAIN_SERVER_ORIGIN',
);
check(
  !/"https:\/\/license\./.test(bridge),
  'crates/kasirmu-bridge/src/sync.rs: carries its own origin literal',
);

const bootstrap = read('apps/desktop-tauri/src/sync_bootstrap.rs');
check(
  bootstrap.includes('server_origin::FALLBACK_SERVER_ORIGIN'),
  'apps/desktop-tauri/src/sync_bootstrap.rs: the dev bootstrap must reference server_origin::FALLBACK_SERVER_ORIGIN',
);
check(
  !/"https:\/\/license\./.test(bootstrap),
  'apps/desktop-tauri/src/sync_bootstrap.rs: carries its own origin literal',
);

if (findings.length > 0) {
  console.error('server-origins: ' + findings.length + ' finding(s) against ' + SOURCE);
  for (const f of findings) console.error('  - ' + f);
  process.exit(1);
}

console.log(
  'ok: server origin consistent (' + host(MAIN) + ' + ' + host(FALLBACK) + ') across ' + SOURCE +
    ', both Tauri CSPs, the Worker CSP and fallback, the settings draft and both Rust fallbacks',
);
