#!/usr/bin/env node
/**
 * scripts/prebuild.mjs — Parallel pre-build gate runner.
 *
 * Replaces the sequential `&&` chain in package.json "prebuild" with
 * concurrent execution for the three independent checks, cutting wall-clock
 * time from ~12s to ~6s on a multi-core machine (Ryzen 9 7950X: 32 threads).
 *
 * Execution order:
 *   Phase 1 (parallel): sync-dev-files + audit-i18n + check-ui-strings +
 *                       check-password-policy
 *   Phase 2 (sequential, depends on phase 1): import-portal.sh
 *   Phase 3 (parallel test pool, after phase 2): vitest run
 *
 * Exit code mirrors the first failing subprocess (fail-fast).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// __dirname of this file is website/scripts/ — root is one level up
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a command, inherit stdio, return a Promise<void> that rejects on
 * non-zero exit.
 */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      ...opts,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(' ')}" exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Run all tasks in parallel. If any fail, reject immediately with the first
 * error (and let the others complete — we don't cancel siblings to keep logs
 * readable).
 */
async function parallel(label, tasks) {
  const start = Date.now();
  process.stdout.write(`[prebuild] ▶ ${label}\n`);
  await Promise.all(tasks);
  process.stdout.write(`[prebuild] ✓ ${label} (${Date.now() - start}ms)\n`);
}

async function serial(label, task) {
  const start = Date.now();
  process.stdout.write(`[prebuild] ▶ ${label}\n`);
  await task();
  process.stdout.write(`[prebuild] ✓ ${label} (${Date.now() - start}ms)\n`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const total = Date.now();

// ── Node version floor ────────────────────────────────────────────────────────
// Three scripts in this build pass `--experimental-strip-types`
// (check-ui-strings.mjs, check-password-policy.mjs here, check-seo.mjs in
// `check:seo`), which Node rejects outright before 22.6. Without this guard the
// failure arrives as two stray `node: bad option` lines from npm's children
// plus a stack trace pointing at this file's run() helper — naming neither the
// flag nor the version, so the obvious conclusion is that the build is broken.
// Measured 2026-10-12 on v18.19.1 (Ubuntu/WSL's apt node). CI pins Node 24; the
// floor below is what the code actually needs, not what CI happens to run.
const NODE_FLOOR = [22, 6];
{
  const parts = process.versions.node.split('.').map(Number);
  const tooOld = parts[0] < NODE_FLOOR[0] ||
    (parts[0] === NODE_FLOOR[0] && parts[1] < NODE_FLOOR[1]);
  if (tooOld) {
    process.stderr.write(
      `[prebuild] ✗ Node >= ${NODE_FLOOR.join('.')} is required; this is ${process.versions.node}.\n` +
      `            Install a newer Node (CI uses 24 — see the root .nvmrc) and re-run.\n` +
      `            The scripts that fail first are check-ui-strings.mjs and\n` +
      `            check-password-policy.mjs, which need --experimental-strip-types.\n`
    );
    process.exit(1);
  }
}

// Phase 1: independent static checks — run in parallel
await parallel('static checks', [
  run('node', ['scripts/sync-dev-files.mjs'], { cwd: ROOT }),
  run('node', ['scripts/audit-i18n.mjs'],    { cwd: ROOT }),
  run('node', ['--experimental-strip-types', 'scripts/check-ui-strings.mjs'], { cwd: ROOT }),
  run('node', ['--experimental-strip-types', 'scripts/check-password-policy.mjs'], { cwd: ROOT }),
]);

// Phase 2: portal import (depends on sync-dev-files completing first)
await serial('import-portal', async () => {
  const script = path.join(ROOT, 'scripts', 'import-portal.mjs');
  if (existsSync(script)) {
    await run('node', ['scripts/import-portal.mjs', '--if-exists'], { cwd: ROOT });
  } else {
    process.stdout.write('[prebuild]   import-portal.mjs not found — skipped\n');
  }
});

// Phase 3: full test suite (vitest already distributes across thread workers)
const logicalCores = cpus().length;
process.stdout.write(`[prebuild] ℹ ${logicalCores} logical CPUs detected\n`);
await serial('vitest', async () => {
  await run('npx', ['vitest', 'run'], { cwd: ROOT });
});

process.stdout.write(`[prebuild] ✅ all gates passed in ${Date.now() - total}ms\n`);
