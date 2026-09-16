#!/usr/bin/env node
/**
 * scripts/check-ui.mjs — Unified UI validation runner.
 *
 * Chains all UI validation gates into one `npm run check:all` command.
 * Mirrors the UI portion of scripts/check.sh but runs cross-platform
 * (no bash dependency).
 *
 * Usage:  cd ui && npm run check:all
 *
 * Gates (in order; the numbering matches the section comments in main()):
 *   1.  Lint          — ESLint (jsx-a11y, react-hooks)
 *   2.  TypeScript    — tsc --noEmit (strict type checking)
 *   3.  Unit tests    — vitest run. File and case counts are printed by the leg
 *       itself; the numbers previously quoted here (214 files / 3230 tests) had
 *       rotted by a factor of ~3 while nobody was looking, which is why they are
 *       no longer in a comment.
 *   4.  i18n lint     — Fluent key consistency check
 *   5.  FTL dedupe    — detect duplicate Fluent keys
 *   6.  Bundle budget — gzip budgets on the desktop production build (PERF-02)
 *   6b. Bundle budget — the same budgets on the TABLET production build
 *   7.  E2E tests     — Playwright via scripts/run-e2e.mjs (SKIPPED if Docker is unavailable)
 *   8.  Perf smoke    — Playwright runtime budgets, desktop + tablet (SKIPPED if
 *       browsers are not installed)
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ── Change to ui/ directory so we can run from anywhere ─────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, '..', 'ui');
process.chdir(uiDir);

// ── Gate manifest (AUDIT-27 CI-08) ──────────────────────────────────
// The `check:all` gate vocabulary derives from scripts/gates.json (the
// single source of truth shared with ci.yml, nightly.yml, check.sh, and
// the CI docs-drift verifier). If a manifest `check:all` gate is not
// declared below, this runner must fail closed — exactly like the CI
// `ci-docs-drift` gate does.
const gatesManifestPath = resolve(__dirname, 'gates.json');
let manifestCheckAllNeedles = [];
let manifestReadable = true;
try {
  const manifest = JSON.parse(readFileSync(gatesManifestPath, 'utf8'));
  manifestCheckAllNeedles = (manifest.gates ?? [])
    .map((g) => g.runners?.['check:all'] ?? [])
    .flat()
    .map((n) => n.toLowerCase());
} catch {
  manifestReadable = false;
}

/* ── ANSI helpers ───────────────────────────────────────────────────── */
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m'; // reset

/* ── State ──────────────────────────────────────────────────────────── */
const results = []; // { gate, status, duration }

/**
 * Run a single validation gate.
 *
 * @param {string}  name         Human-readable gate name.
 * @param {string}  command      Shell command to execute.
 * @param {object}  [opts]
 * @param {number}  [opts.timeout]    Timeout in ms (default 300_000).
 * @param {number}  [opts.maxBuffer]  Cap on the stdout this gate captures.
 *   Left unset it inherits execSync's own 1 MiB — and exceeding that does not
 *   truncate the capture, it kills the child with SIGTERM and throws ENOBUFS,
 *   which the catch below files as a FAIL. So a leg whose PASSING output is
 *   near 1 MiB is graded by its verbosity, not its result: set maxBuffer on
 *   any leg that can print that much when nothing is wrong.
 */
function gate(name, command, opts = {}) {
  const timeout = opts.timeout ?? 300_000;
  const execOpts = { stdio: 'pipe', timeout };
  if (opts.maxBuffer !== undefined) execOpts.maxBuffer = opts.maxBuffer;
  const start = Date.now();

  process.stdout.write(`  ${CYAN}▶${NC} ${name} ... `);

  try {
    execSync(command, execOpts);
    const sec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${GREEN}PASS (${sec}s)${NC}`);
    results.push({ gate: name, status: 'pass', duration: sec });
  } catch {
    const sec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${RED}FAIL (${sec}s)${NC}`);
    results.push({ gate: name, status: 'fail', duration: sec });

    // Re-run with inherited stdio so the user sees the full error output
    console.error(`\n${RED}── ${name} ──${NC}`);
    try {
      execSync(command, { stdio: 'inherit', timeout });
    } catch {
      // ignore — we already know it failed
    }
    console.error();
  }
}

/** Check whether Docker is available (daemon reachable). */
function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Check whether Playwright browsers are installed (for the perf smoke suite). */
function playwrightAvailable() {
  try {
    execSync('npx playwright --version', { stdio: 'pipe', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/* ── Main ───────────────────────────────────────────────────────────── */
function main() {
  const totalStart = Date.now();

  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════${NC}`);
  console.log(`${BOLD}${CYAN}  OZ-POS — UI Validation Gates${NC}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════${NC}\n`);

  // ── 1. Lint ────────────────────────────────────────────────────────────
  gate('ESLint', 'npm run lint');

  // ── 2. TypeScript ──────────────────────────────────────────────────────
  gate('TypeScript type check', 'npm run typecheck');

  // ── 3. Unit tests ──────────────────────────────────────────────────────
  // Sized from this leg's own print, not guessed: measured 2026-09-15 the
  // GREEN run is 1,335,496 bytes (580 files / 9,988 cases) — 27% OVER execSync's
  // 1 MiB default, which is how a passing suite was being filed as a FAIL.
  // 64 MiB is 50x that print, and maxBuffer ceilings accumulated bytes rather
  // than reserving them, so unused headroom costs nothing. RESIDUAL RISK left
  // on purpose: a suite that outgrows even 64 MiB reproduces the same bug
  // rarer — green reported as FAIL with no failing test named. The structural
  // fix is stdio: 'inherit' here, since gate() parses none of this output; the
  // other seven legs keep the pipe because their GREEN print is small enough
  // that overflow can only follow a real failure, which is already their verdict.
  gate('Unit tests (vitest)', 'npm run test', { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

  // ── 4. i18n lint ───────────────────────────────────────────────────────
  gate('i18n lint', 'npm run lint:i18n');

  // ── 5. FTL dedupe ──────────────────────────────────────────────────────
  gate('FTL dedupe', 'npm run dedupe:ftl');

  // ── 6. Bundle budget (PERF-02) — production build + gzip size gates ────
  gate('Bundle budget', 'npm run bundle:check', { timeout: 300_000 });

  // ── 6b. Bundle budget, TABLET artifact — the second shipped app ─────────
  // Two apps build from this one `ui/` tree and the tablet artifact is not the
  // desktop one under a new name: 59 stylesheets against 56, its own chunk
  // graph, its own content hashes, and its own ~296 KB font payload. The script
  // for it (`npm run bundle:check:tablet`) has existed since 2b762b08f and had
  // ZERO callers repo-wide, so a tablet-only size regression passed this runner
  // without a word -- recorded as notes.md item 38. Cost of closing it, measured rather
  // than assumed: 9.4s for this leg against the desktop leg's 9.6s in the same run
  // (`cd ui && npm run check:all`, whose summary prints both durations), so the second
  // build is not the tax it was written as if it would be. A red line now says which of
  // the two artifacts broke.
  gate('Bundle budget (tablet)', 'npm run bundle:check:tablet', { timeout: 300_000 });

  // ── 7. E2E tests (optional — requires Docker) ──────────────────────────
  // AUDIT-27 CI-07: use `npm run e2e` (scripts/run-e2e.mjs) which
  // PROVISIONS the Docker backend (cloud + license + redis), starts Vite,
  // runs Playwright, and cleans up — rather than bare `playwright test`
  // which would run against whatever happens to be on port 1420/3099.
  if (dockerAvailable()) {
    gate('E2E tests (Playwright, provisioned)', 'npm run e2e', { timeout: 900_000 });
  } else {
    console.log(`  ${YELLOW}SKIP (Docker not available)${NC}`);
    results.push({ gate: 'E2E tests (Playwright)', status: 'skip', duration: '0.0' });
  }

  // ── 8. Perf smoke suite (PERF-10) — UI-only, no Docker required ────────
  // Runs the Playwright performance smoke suite (desktop + tablet budgets).
  // Skipped when Playwright browsers are not installed locally.
  if (playwrightAvailable()) {
    gate('Perf smoke (Playwright)', 'npm run test:e2e:perf', { timeout: 600_000 });
  } else {
    console.log(`  ${YELLOW}SKIP (Playwright not available)${NC}`);
    results.push({ gate: 'Perf smoke (Playwright)', status: 'skip', duration: '0.0' });
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const totalSec = ((Date.now() - totalStart) / 1000).toFixed(1);
  const pass = results.filter((r) => r.status === 'pass').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  const fail = results.filter((r) => r.status === 'fail').length;

  // ── Gate manifest self-audit (AUDIT-27 CI-08) ─────────────────────
  // The gate vocabulary derives from scripts/gates.json. Every manifest
  // `check:all` needle must match at least one gate this runner actually
  // declared; a manifest gate that is not declared is drift and fails
  // this runner closed — mirroring the CI `ci-docs-drift` gate.
  let manifestOk = true;
  if (manifestReadable) {
    const declared = results.map((r) => r.gate.toLowerCase());
    const missing = manifestCheckAllNeedles.filter(
      (needle) => !declared.some((g) => g.includes(needle))
    );
    if (missing.length > 0) {
      manifestOk = false;
      console.error(`\n${RED}✘ Gate manifest drift: check:all does not declare ${missing.length} manifest gate(s): ${missing.join(', ')}${NC}`);
      console.error(`  Fix scripts/gates.json or add the missing gate here.`);
    }
  } else {
    console.log(`  ${YELLOW}⚠ Gate manifest unreadable — manifest self-audit skipped (${gatesManifestPath})${NC}`);
  }

  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════${NC}`);
  console.log(`${BOLD}${CYAN}  Summary${NC}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════${NC}`);
  for (const r of results) {
    const icon =
      r.status === 'pass' ? `${GREEN}✔${NC}` :
      r.status === 'skip' ? `${YELLOW}–${NC}` :
                             `${RED}✘${NC}`;
    const label = r.status === 'pass' ? 'Pass' : r.status === 'skip' ? 'Skip' : 'FAIL';
    console.log(`  ${icon} ${r.gate} (${r.duration}s) — ${label}`);
  }
  console.log(`\n  Total: ${totalSec}s  |  ${GREEN}${pass} passed${NC}  ${YELLOW}${skip} skipped${NC}  ${fail > 0 ? `${RED}${fail} failed` : ''}${NC}`);

  if (fail > 0 || !manifestOk) {
    console.error(`\n${RED}${BOLD}✘ Some checks failed. Fix the issues above and re-run.${NC}\n`);
    process.exit(1);
  }

  console.log(`\n${GREEN}${BOLD}✔ All checks passed${NC}\n`);
}

main();
