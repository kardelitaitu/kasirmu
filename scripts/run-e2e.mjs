#!/usr/bin/env node
/**
 * scripts/run-e2e.mjs — Unified E2E test runner.
 *
 * Orchestrates the full E2E test suite cross-platform (no bash dependency):
 *   1. Start Docker backend (cloud server, license server, Redis)
 *   2. Start Vite dev server (with Tauri IPC mock)
 *   3. Run Playwright tests
 *   4. Cleanup and report results
 *
 * Usage:
 *   cd ui && npm run e2e                    # full suite
 *   cd ui && npm run e2e:headed             # watch browser
 *   cd ui && npm run e2e:api                # API tests only
 *   cd ui && npm run e2e:ui                 # UI tests only
 *   cd ui && npm run e2e -- --no-docker     # skip Docker (use existing servers)
 *   cd ui && npm run e2e -- e2e/auth.spec.ts  # single spec
 *   cd ui && npm run e2e -- --project=desktop # one Playwright project only
 *   cd ui && npm run e2e -- --build         # rebuild stale E2E images first
 *
 * Image freshness: `compose up --pull=missing` never rebuilds a tag that
 * already exists, so a stale e2e-{cloud,license}-server:latest would silently
 * test outdated binaries. The runner therefore refuses to start when a
 * locally-built image predates its own sources — pass --build to rebuild them.
 * Skipped under CI, where the workflow builds the images from the checkout.
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'node:fs';
import { generateKeyPairSync } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { platform } from 'os';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const UI_DIR = resolve(ROOT, 'ui');

// Parse args
const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const API_ONLY = args.includes('--api-only');
const UI_ONLY = args.includes('--ui-only');
const NO_DOCKER = args.includes('--no-docker');
const CHANGED_ONLY = args.includes('--changed-only');
// Rebuild the locally-built E2E images that the freshness guard judges stale,
// instead of aborting. See assertImagesFresh() for the staleness rule.
const BUILD = args.includes('--build');
// Optional --project=<name> passthrough (e.g. --project=desktop) so CI
// can shard the suite by Playwright project (desktop / tablet) instead
// of running the full matrix in a single job. Forwarded verbatim.
const PROJECT = args.find(a => a.startsWith('--project=')) ?? '';
const SPEC_FILES = args.filter(a => !a.startsWith('-'));

/* ── ANSI helpers ───────────────────────────────────────────────────── */
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m';

/* ── State ──────────────────────────────────────────────────────────── */
let viteProcess = null;
let dockerStarted = false;
let cleanupDone = false;

// DOCKER-06: the E2E Redis image is pinned to an immutable digest in
// docker-compose.e2e.yml. We pre-pull it here with bounded retries so
// `compose up --wait` never stalls on a transient registry rate limit
// (the observed `toomanyrequests` CI failures). Keep in sync with the
// digest in docker-compose.e2e.yml.
const E2E_REDIS_IMAGE =
  'public.ecr.aws/docker/library/redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2';

/** Synchronous cross-platform sleep (Node has no sync sleep built in). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Pull the pinned Redis image, retrying transient failures with backoff. */
function prePullRedis() {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    log('Docker', `Pre-pulling Redis (attempt ${i}/${attempts})...`);
    try {
      execSync(`docker pull ${E2E_REDIS_IMAGE}`, { stdio: 'pipe', timeout: 120_000 });
      log('Docker', 'Redis pre-pulled.');
      return;
    } catch (err) {
      if (i === attempts) {
        log('Docker', `${RED}Redis pre-pull failed after ${attempts} attempts.${NC}`);
        throw new Error(`Redis pre-pull failed: ${err.message || err}`);
      }
      log('Docker', `Retry ${i}/${attempts} in 15s...`);
      sleepSync(15_000); // bounded backoff
    }
  }
}

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  ${CYAN}[${ts}]${NC} ${label} ${msg}`);
}

/** Kill a process by its listening port (cross-platform). */
function killByPort(port) {
  try {
    if (platform() === 'win32') {
      // Windows: netstat + taskkill
      const result = execSync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port}"`,
        { stdio: 'pipe', timeout: 5_000 },
      ).toString();
      const lines = result.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe', timeout: 3_000 }); } catch {}
        }
      }
    } else {
      // Unix: lsof + kill
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'pipe', timeout: 5_000 });
    }
  } catch {
    // No process found on that port — fine
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

/* ── E2E image freshness guard ─────────────────────────────────────── */

/**
 * The two E2E services whose images are built from this repository rather
 * than pulled from a registry. `paths` is the set of tracked paths that can
 * actually change each image, mirroring the Dockerfile COPY lines and
 * .dockerignore — deliberately NOT the whole repo, so an unrelated edit
 * (docs, ui/) never demands a multi-minute Rust rebuild.
 */
const LOCAL_BUILD_CONTEXTS = [
  {
    service: 'e2e-license-server',
    image: 'e2e-license-server:latest',
    paths: ['apps/license-server'],
  },
  {
    service: 'e2e-cloud-server',
    image: 'e2e-cloud-server:latest',
    // Dockerfile.server: context is the repo root, but .dockerignore drops
    // ui/, docs/, apps/desktop-client and apps/tablet-client, and cargo only
    // builds the oz-cloud-server package — so apps/license-server and
    // apps/unified cannot change this binary.
    paths: [
      'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml',
      'Dockerfile.server', '.dockerignore',
      'crates', 'foundation', 'platform', 'modules',
      'apps/cloud-server',
      'scripts/docker-entrypoint.sh', 'scripts/updater-compat-check',
    ],
  },
];

/** Creation time of a local image in ms, or null when the image is absent. */
function imageCreatedMs(image) {
  try {
    const out = execSync(`docker image inspect ${image} --format "{{.Created}}"`, {
      stdio: 'pipe', timeout: 15_000,
    }).toString().trim();
    const ms = Date.parse(out);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null; // no such image locally
  }
}

/** Timestamp of the last commit touching any of `paths`, in ms (0 if unknown). */
function lastCommittedChangeMs(paths) {
  try {
    const quoted = paths.map(p => `"${p}"`).join(' ');
    const out = execSync(`git log -1 --format=%ct -- ${quoted}`, {
      stdio: 'pipe', timeout: 15_000, cwd: ROOT,
    }).toString().trim();
    return out ? Number(out) * 1000 : 0;
  } catch {
    return 0; // shallow clone / no matching history — treat as fresh
  }
}

/** True when `paths` has uncommitted or untracked changes. */
function hasUncommittedChanges(paths) {
  try {
    const quoted = paths.map(p => `"${p}"`).join(' ');
    const out = execSync(`git status --porcelain -- ${quoted}`, {
      stdio: 'pipe', timeout: 15_000, cwd: ROOT,
    }).toString().trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

const iso = ms => new Date(ms).toISOString().slice(0, 19) + 'Z';

/**
 * Classify the locally-built services into `missing` (no image at all) and
 * `stale` (an image that predates its own sources).
 *
 * Why this exists: `compose up --pull=missing` only fetches tags that are
 * missing — it NEVER rebuilds a tag that already exists. A long-lived
 * `e2e-license-server:latest` therefore keeps serving the bytes from whenever
 * it was last built, and a green E2E run silently means "tested an outdated
 * binary". This bit us on 2026-08-31: a local image from 08-03 answered
 * /api/health with PocketBase's built-in envelope while CI (which builds
 * fresh) returned the bindHealthOverride payload, making a correct test look
 * wrong. The guard turns that invisible trap into a loud, actionable stop.
 *
 * `missing` is kept separate because it carries no stale-bytes risk — compose
 * builds an absent image during `up` anyway — so the runner just does that
 * up front instead of adding first-run friction.
 */
function classifyImages() {
  const missing = [];
  const stale = [];
  for (const ctx of LOCAL_BUILD_CONTEXTS) {
    const created = imageCreatedMs(ctx.image);
    if (created === null) {
      missing.push({ ...ctx, reason: 'image has not been built yet' });
      continue;
    }
    const changed = lastCommittedChangeMs(ctx.paths);
    if (created < changed) {
      stale.push({
        ...ctx,
        reason: `built ${iso(created)} predates the last change to its `
              + `build context (${iso(changed)})`,
      });
      continue;
    }
    if (hasUncommittedChanges(ctx.paths)) {
      stale.push({
        ...ctx,
        reason: `has uncommitted changes in its build context (image built `
              + `${iso(created)})`,
      });
    }
  }
  return { missing, stale };
}

/** Build the named compose services from the E2E compose file. */
function buildServices(services) {
  for (const { service, reason } of services) {
    log('Docker', `Building ${service} — ${reason}`);
    execSync(
      `docker compose -f "${ROOT}/docker-compose.e2e.yml" build ${service}`,
      { stdio: 'inherit', timeout: 2_400_000 },
    );
  }
}

/**
 * Abort unless every locally-built E2E image is at least as new as its
 * sources. With --build, rebuild the stale ones in place instead.
 *
 * Skipped under CI: both E2E workflows build these images from the exact
 * checkout immediately before running the suite, so the guard is a no-op
 * there — and it must never become a new way to fail a green pipeline.
 */
function assertImagesFresh() {
  if (process.env.CI) {
    log('Docker', 'CI detected — trusting the images built by the workflow.');
    return;
  }
  const { missing, stale } = classifyImages();
  // Absent images are built unconditionally: there are no stale bytes to
  // test, and this is what `compose up` would have done anyway.
  if (missing.length > 0) buildServices(missing);
  if (stale.length === 0) return;

  if (BUILD) {
    buildServices(stale);
    log('Docker', 'Stale images rebuilt.');
    return;
  }

  log('Docker', `${RED}E2E images are stale — refusing to run tests against `
    + `outdated binaries.${NC}`);
  for (const { image, reason } of stale) {
    console.log(`    ${YELLOW}•${NC} ${image}: ${reason}`);
  }
  console.log('');
  log('Docker', `Rebuild them and re-run:  ${BOLD}npm run e2e -- --build${NC}`);
  log('Docker', `Or build one directly:    docker compose -f docker-compose.e2e.yml build ${stale[0].service}`);
  throw new Error('stale E2E images');
}

/**
 * Ensure OZ_LICENSE_PRIVATE_KEY is set for the license server.
 *
 * If the user has already set OZ_LICENSE_PRIVATE_KEY in their environment,
 * use it as-is (honouring explicit configuration). Otherwise, generate a
 * throwaway RSA-2048 key pair with Node's built-in crypto module so the
 * E2E license server container can boot. The generated key is for testing
 * only — it is not committed, never persisted, and discarded on cleanup.
 *
 * NOTE: The generated key does NOT match the committed public key
 * (crates/kasirmu-core/oz-license.key.pub). Tests that verify real license
 * signatures must provide a real OZ_LICENSE_PRIVATE_KEY instead.
 */
function ensureLicenseKey() {
  if (process.env.OZ_LICENSE_PRIVATE_KEY) {
    log('License', 'Using OZ_LICENSE_PRIVATE_KEY from environment.');
    return;
  }
  log('License', 'Generating throwaway RSA-2048 key for E2E license server...');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Escape literal newlines to \n so the PEM survives shell/env boundaries
  // intact. The Go license server's normalizePEM() reverses this on receipt.
  process.env.OZ_LICENSE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  log('License', 'Throwaway key generated (valid for this session only).');
}

/**
 * Dump recent logs from all E2E services for diagnosis.
 * Called on docker compose failure, before cleanup removes containers.
 */
function dumpContainerLogs() {
  try {
    log('Docker', 'Dumping service logs for diagnosis...');
    execSync(
      `docker compose -f "${ROOT}/docker-compose.e2e.yml" logs --tail 100`,
      { stdio: 'inherit', timeout: 15_000 },
    );
    log('Docker', 'Container status:');
    execSync(
      `docker compose -f "${ROOT}/docker-compose.e2e.yml" ps -a`,
      { stdio: 'inherit', timeout: 10_000 },
    );
  } catch {
    // Log dumping is best-effort — don't mask the original error.
    log('Docker', '(Could not retrieve container logs — containers may already be gone.)');
  }
}

/** Start Docker E2E services. */
function startDocker() {
  log('Docker', 'Starting E2E services...');
  // Pre-flight: compose auto-reads the repo-root .env and dies with a
  // terse "key cannot contain a space" on a poisoned line (2026-08-31
  // outage). Fail here instead, with every offending line numbered.
  const envPath = `${ROOT}/.env`;
  if (existsSync(envPath)) {
    try {
      execSync(`node "${ROOT}/scripts/validate-env.mjs" "${envPath}"`, {
        stdio: 'inherit',
        timeout: 15_000,
      });
    } catch {
      log('Docker', `${RED}.env failed validation — fix the lines above (comment out note lines; a # prefix is always safe).${NC}`);
      process.exit(1);
    }
  }
  // Freshness guard runs BEFORE the compose try/catch: its own message is
  // the actionable one, and must not be relabelled "Failed to start
  // services" with a container-log dump.
  assertImagesFresh();
  try {
    prePullRedis();
    execSync(
      `docker compose -f "${ROOT}/docker-compose.e2e.yml" up -d --wait --pull=missing`,
      { stdio: 'inherit', timeout: 120_000 },
    );
    dockerStarted = true;
    log('Docker', 'Services ready.');
  } catch (err) {
    dockerStarted = true; // containers may be partially up — let cleanup tear them down
    log('Docker', `${RED}Failed to start services.${NC}`);
    dumpContainerLogs();
    throw new Error(`Docker compose failed: ${err.message || err}`);
  }
}
/** Stop Docker E2E services. */
function stopDocker() {
  if (!dockerStarted) return;
  log('Docker', 'Stopping E2E services...');
  try {
    execSync(
      `docker compose -f "${ROOT}/docker-compose.e2e.yml" down -v`,
      { stdio: 'pipe', timeout: 60_000 },
    );
    dockerStarted = false;
    log('Docker', 'Stopped.');
  } catch (e) {
    log('Docker', `Cleanup warning: ${e.message.slice(0, 80)}`);
  }
}

/** Start Vite dev server, return when ready. */
function startVite() {
  return new Promise((resolvePromise, reject) => {
    // Check if Vite is already running
    try {
      execSync('curl -sf http://localhost:1420 > /dev/null 2>&1', { timeout: 3_000 });
      log('Vite', 'Already running on port 1420, reusing.');
      resolvePromise();
      return;
    } catch {
      // Not running — kill any stale process on port 1420, then start
    }

    killByPort(1420);

    log('Vite', 'Starting dev server...');
    viteProcess = spawn('npx', ['vite'], {
      cwd: UI_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      // Hide the dev-mode DevToolbar overlay during E2E — it floats
      // bottom-right at tooltip z-index and would intercept clicks on
      // POS action buttons (App.tsx reads VITE_DEV_TOOLBAR to disable it).
      env: { ...process.env, VITE_DEV_TOOLBAR: '0' },
    });

    let outputBuffer = '';
    let isReady = false;
    let pollInterval = null;
    const startupTimeout = Number(process.env.VITE_STARTUP_TIMEOUT || '120000');

    const markReady = () => {
      if (isReady) return;
      isReady = true;
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(timeout);
      log('Vite', 'Ready.');
      resolvePromise();
    };

    const timeout = setTimeout(() => {
      if (pollInterval) clearInterval(pollInterval);
      if (isReady) return;
      const tail = outputBuffer.split('\n').filter(Boolean).slice(-40).join('\n');
      reject(new Error(
        `Vite dev server failed to start within ${startupTimeout / 1000}s.\n` +
        `--- last Vite output (${process.env.VITE_LOG_LEVEL || 'default'}): ---\n${tail || '(no output captured)'}`
      ));
    }, startupTimeout);

    const onData = (data) => {
      outputBuffer += data.toString();
      if (!isReady && (outputBuffer.includes('Local:') || outputBuffer.includes('localhost:1420') || outputBuffer.includes('ready in'))) {
        markReady();
      }
    };

    viteProcess.stdout.on('data', onData);
    viteProcess.stderr.on('data', onData);

    // Active HTTP poll every 250ms so we don't rely solely on stdout chunking in non-TTY CI
    pollInterval = setInterval(() => {
      if (isReady) return;
      const req = http.get('http://127.0.0.1:1420', (res) => {
        req.destroy();
        markReady();
      });
      req.on('error', () => {
        // Not ready yet
      });
    }, 250);

    viteProcess.on('error', (err) => {
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(timeout);
      if (!isReady) reject(err);
    });

    viteProcess.on('exit', (code) => {
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(timeout);
      if (!isReady && code !== 0 && !outputBuffer.includes('ready')) {
        reject(new Error(`Vite exited with code ${code}`));
      }
    });
  });
}

/** Stop Vite dev server. */
function stopVite() {
  if (viteProcess) {
    log('Vite', 'Stopping dev server...');
    viteProcess.kill('SIGTERM');
    viteProcess = null;
  }
  killByPort(1420);
}

/**
 * Get the list of E2E spec files changed relative to the default branch.
 * Returns an empty array if git detection fails or there's no diff.
 */
function getChangedSpecs() {
  try {
    // Try origin/main first, then origin/master, then main
    const refs = ['origin/main', 'origin/master', 'main'];
    let mergeBase;
    for (const ref of refs) {
      try {
        mergeBase = execSync(
          `git merge-base HEAD "${ref}"`,
          { stdio: 'pipe', timeout: 10_000, cwd: ROOT },
        ).toString().trim();
        if (mergeBase) break;
      } catch {}
    }
    if (!mergeBase) return [];

    // git diff --name-only outputs paths relative to repo root,
    // so we run from ROOT with pattern ui/e2e/** to get
    // results like "ui/e2e/auth.spec.ts", then strip ui/ prefix.
    // AUDIT-27 CI-02: widened from `ui/e2e/*.spec.ts` (top-level only)
    // to `ui/e2e/**` so spec files in nested directories are found and
    // the skip path is not silently hit for valid spec locations.
    const changed = execSync(
      `git diff --name-only "${mergeBase}" -- 'ui/e2e/**'`,
      { stdio: 'pipe', timeout: 10_000, cwd: ROOT },
    ).toString().trim().split('\n').filter(Boolean);

    return changed.map(f => {
      let cleaned = f.replace(/^ui\//, '');
      if (cleaned.startsWith('e2e/e2e/')) cleaned = cleaned.replace(/^e2e\/e2e\//, 'e2e/');
      return cleaned;
    });
  } catch {
    return [];
  }
}

/** Run Playwright tests. */
function runPlaywright() {
  let cmd = `npx playwright test --config e2e/playwright.config.ts`;

  if (PROJECT) cmd += ` ${PROJECT}`;
  if (HEADED) cmd += ' --headed';

  // Determine which spec files to run
  let specs = SPEC_FILES;

  // --changed-only overrides explicit spec files when none given
  if (specs.length === 0 && CHANGED_ONLY) {
    const changed = getChangedSpecs();
    if (changed.length > 0) {
      log('Playwright', `Changed-only: ${changed.length} spec(s) modified`);
      specs = changed;
    } else {
      // AUDIT-27 CI-02: zero executed tests must NOT report as a full
      // pass. Return a distinct `skipped` status that main() turns into
      // a distinct exit code + banner instead of "All E2E tests passed".
      log('Playwright', `Changed-only: no E2E specs changed — SKIPPED (0 tests executed).`);
      return 'skipped';
    }
  }

  if (specs.length === 0) {
    if (API_ONLY) {
      specs = ['e2e/api.spec.ts'];
    } else if (UI_ONLY) {
      specs = [
        'e2e/auth.spec.ts',
        'e2e/sale.spec.ts',
        'e2e/pos-workflows.spec.ts',
        'e2e/product.spec.ts',
        'e2e/shift.spec.ts',
        'e2e/settings.spec.ts',
        'e2e/new-flows.spec.ts',
        'e2e/e2e-sale-to-history.spec.ts',
        'e2e/e2e-shift-reconciliation.spec.ts',
        'e2e/e2e-settings-persist.spec.ts',
      ];
    }
  }

  if (specs.length > 0) {
    cmd += ' ' + specs.map(f => {
      let p = f.replace(/^ui\//, '');
      if (p.startsWith('e2e/e2e/')) p = p.replace(/^e2e\/e2e\//, 'e2e/');
      return p.startsWith('e2e/') ? p : `e2e/${p}`;
    }).join(' ');
  }

  log('Playwright', `Running: ${cmd}`);

  try {
    // Internal cap: 25 min. The GitHub job timeout-minutes (30 min in
    // e2e-pr.yml) is the real governor — this cap only needs to stay
    // comfortably above the longest realistic test phase so it never
    // fires first (the old 600s could be tight for a many-spec PR shard
    // with CI's 2 retries).
    execSync(cmd, { cwd: UI_DIR, stdio: 'inherit', timeout: 1_500_000 });
    log('Playwright', `${GREEN}All tests passed${NC}`);
    return 'pass';
  } catch {
    log('Playwright', `${RED}Some tests failed${NC}`);
    return 'fail';
  }
}

/** Cleanup everything. */
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log();

  stopVite();

  if (!NO_DOCKER) {
    stopDocker();
  }

  log('Cleanup', 'Done.');
}

/* ── Main ───────────────────────────────────────────────────────────── */
async function main() {
  // Register cleanup for Ctrl+C and normal exit
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  let status = 'fail';

  try {
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════${NC}`);
    console.log(`${BOLD}${CYAN}  OZ-POS — E2E Test Suite${NC}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════${NC}\n`);

    // ── Step 1: Start Docker backend ──────────────────────────────
    if (!NO_DOCKER) {
      if (dockerAvailable()) {
        ensureLicenseKey();
        startDocker();
      } else {
        log('Docker', `${YELLOW}Not available — skipping.${NC}`);
      }
    } else {
      log('Docker', 'Skipped (--no-docker).');
    }

    // ── Step 2: Start Vite dev server ─────────────────────────────
    await startVite();

    // ── Step 3: Run Playwright tests ──────────────────────────────
    status = runPlaywright();

  } catch (err) {
    console.error(`\n${RED}${BOLD}✘ Error:${NC} ${err.message || err}`);
    // Setup failed before Playwright ran — distinct from a test failure so
    // the banner never claims "some tests failed" when zero tests executed.
    status = 'error';
  } finally {
    cleanup();
  }

  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════${NC}`);
  if (status === 'pass') {
    console.log(`${GREEN}${BOLD}✔ All E2E tests passed${NC}`);
    process.exit(0);
  } else if (status === 'skipped') {
    // AUDIT-27 CI-02: distinct result for zero executed tests.
    console.log(`${YELLOW}${BOLD}✖ SKIPPED-NO-SPEC: no E2E specs changed — 0 tests executed (distinct from all-pass)${NC}`);
    process.exit(2);
  } else if (status === 'error') {
    console.log(`${RED}${BOLD}✘ E2E SETUP FAILED — 0 tests executed (backend/Vite never came up; not a test failure)${NC}`);
    process.exit(3);
  } else {
    console.log(`${RED}${BOLD}✘ Some E2E tests failed — check output above${NC}`);
    process.exit(1);
  }
}

main();
