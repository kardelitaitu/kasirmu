#!/usr/bin/env node
/**
 * scripts/__tests__/pipefail.test.mjs
 *
 * AUDIT-27 CI-04: a step that pipes a test command into `tee` reports the exit status of
 * `tee`, not of the test, unless the shell runs with pipefail. So `cargo test | tee log`
 * without pipefail is GREEN WHEN THE TESTS FAIL. This file proves that hazard is real and
 * then guards against reintroducing it.
 *
 * WHY THIS FILE WAS REWRITTEN. It asserted that every tee-wrapped step in ci.yml and
 * nightly.yml declares `shell: bash --noprofile --norc -eo pipefail {0}`, with floors of
 * >=3 and >=2 such steps. Both workflows were retired to .bak by 23c96330, so both
 * readFileSync calls threw ENOENT -- and nothing ran this suite (`npm run test:scripts` is
 * defined in ui/package.json and invoked by no hook, no workflow, and no check script), so
 * it sat red unnoticed. Its other half used bare `bash`, which on Windows resolves to WSL
 * and HANGS rather than failing (AGENTS.md's most-costly documented trap): spawnSync
 * cmd.exe ETIMEDOUT.
 *
 * Repointing the paths at the live workflows is not possible, because the practice died
 * with ci.yml. Measured: dev-ci.yml has 85 steps and ZERO pipe into tee; release.yml has 35
 * steps and ZERO. ci.yml.bak had 3, all correctly declared. So there is nothing to assert
 * about today -- the value here is prospective, and it is written as a tripwire over every
 * live workflow and shell script rather than a claim about files that no longer exist.
 *
 * A tripwire that scans nothing passes vacuously, which is the failure mode this repo keeps
 * rediscovering ("green from a smaller input"). So the scan case PRINTS the counts it saw and
 * asserts the scan itself was non-empty -- it must find at least one live workflow and one
 * live script to have any standing at all.
 *
 * Run:  node --test scripts/__tests__/pipefail.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/**
 * Resolve a bash that is actually bash, not WSL.
 *
 * On Windows, bare `bash` is C:\Windows\System32\bash.exe -- WSL. Where no distro is running
 * (or the sandbox blocks the VM's named pipes) it does not fail, it HANGS until killed, so a
 * test using it looks like a broken test rather than a broken shell. Git for Windows ships the
 * real one; its location is derived from `git --exec-path` rather than hardcoded, because the
 * checkout lives at no fixed path and AGENTS.md forbids anchoring to one.
 *
 * Returns null when no usable bash is found. Callers must SKIP visibly rather than pass: a
 * silently-green shell test is exactly the hole this rewrite is closing.
 */
function resolveBash() {
  if (process.platform !== 'win32') return 'bash';
  let execPath = '';
  try {
    execPath = execSync('git --exec-path', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
  // Git for Windows puts bash at <root>/bin/bash.exe and also at <root>/usr/bin/bash.exe.
  // exec-path is <root>/mingw64/libexec/git-core, so walk up to the install root instead of
  // assuming a fixed number of levels -- portable and MSYS-only installs differ by one.
  const candidates = [];
  let dir = execPath.replace(/[\\/]$/, '');
  for (let up = 0; up < 5; up++) {
    dir = resolve(dir, '..');
    candidates.push(join(dir, 'bin', 'bash.exe'));
    candidates.push(join(dir, 'usr', 'bin', 'bash.exe'));
  }
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    // The whole point: refuse anything under System32, which is WSL wearing bash's name.
    if (/\\(system32|syswow64)\\/i.test(c)) continue;
    return c;
  }
  return null;
}

const BASH = resolveBash();

/** Run CMD under the exact flags the workflows historically declared. */
function runWithPipefailFlags(cmd) {
  return execFileSync(BASH, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', cmd], {
    stdio: 'pipe',
    timeout: 20_000,
  });
}

/** Same, WITHOUT pipefail -- the control that proves the hazard is real. */
function runWithoutPipefailFlags(cmd) {
  return execFileSync(BASH, ['--noprofile', '--norc', '-eo', 'errexit', '-c', cmd], {
    stdio: 'pipe',
    timeout: 20_000,
  });
}

function statusOf(fn, cmd) {
  try {
    fn(cmd);
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

/* ── Live-surface scan ─────────────────────────────────────────────── */

const PIPEFAIL_SHELL = 'bash --noprofile --norc -eo pipefail {0}';

/** Split a workflow into step blocks, the same way the original test did. */
function splitSteps(workflow) {
  return workflow.split('\n').reduce((acc, line) => {
    if (/^\s+- (name|uses):/.test(line)) acc.push(line);
    else if (acc.length > 0) acc[acc.length - 1] += '\n' + line;
    return acc;
  }, []);
}

function liveWorkflows() {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  // .bak is what GitHub never runs; including it would let a retired file satisfy the guard.
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
}

function liveScripts() {
  const dir = join(ROOT, 'scripts');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
}

describe('pipefail shell wrapper (AUDIT-27 CI-04)', () => {
  it('propagates a left-side failure through tee, and the masking is real without pipefail', (t) => {
    if (!BASH) return t.skip('no non-WSL bash resolved -- shell semantics cannot be exercised');
    // The hazard, demonstrated rather than asserted: without pipefail the pipeline reports
    // tee's status, so a failing test reads as success. If this ever stops being true the
    // guard below is protecting nothing and should be deleted.
    const masked = statusOf(runWithoutPipefailFlags, 'false | tee /tmp/oz-pf-mask.log');
    assert.strictEqual(masked, 0,
      'CONTROL FAILED: `false | tee` without pipefail should mask the failure (exit 0); '
      + `it exited ${masked}, so the hazard this test exists for may no longer be real`);
    const caught = statusOf(runWithPipefailFlags, 'false | tee /tmp/oz-pf-fail.log');
    assert.notStrictEqual(caught, 0, 'pipefail must propagate `false | tee` as a failure');
  });

  it('still succeeds when the left command exits zero', (t) => {
    if (!BASH) return t.skip('no non-WSL bash resolved');
    runWithPipefailFlags('true | tee /tmp/oz-pf-ok.log');
  });

  it('scans a non-empty live surface, so the guard below cannot pass by seeing nothing', () => {
    const wf = liveWorkflows();
    const sh = liveScripts();
    assert.ok(wf.length >= 1, 'expected at least one live .yml workflow to scan');
    assert.ok(sh.length >= 1, 'expected at least one live scripts/*.sh to scan');
    console.log(`    scanned ${wf.length} live workflow(s) and ${sh.length} live script(s)`);
  });

  it('every live step and script that pipes into tee declares pipefail', () => {
    const offenders = [];
    let teeSites = 0;

    for (const { name, text } of liveWorkflows()) {
      for (const step of splitSteps(text)) {
        if (!step.includes('| tee ')) continue;
        teeSites++;
        if (!step.includes(`shell: ${PIPEFAIL_SHELL}`)) {
          const m = step.match(/- name:\s*(.+)/);
          offenders.push(`${name} step "${(m ? m[1] : '?').trim()}"`);
        }
      }
    }
    for (const { name, text } of liveScripts()) {
      if (!/\|\s*tee[\s ]/.test(text)) continue;
      teeSites++;
      if (!/set\s+-[a-z]*p[a-z]*\s+pipefail|pipefail/.test(text)) {
        offenders.push(`${name}`);
      }
    }

    // The count is printed, not asserted away. Today it is 1 (report-flaky.sh, which is
    // compliant) and zero in workflows -- so this case is a tripwire, and a reader can see
    // that rather than being told "passed" with no idea whether anything was examined.
    console.log(`    ${teeSites} live tee-pipe site(s); ${offenders.length} without pipefail`);
    assert.deepStrictEqual(offenders, [],
      'these pipe into tee without pipefail, so a failing command would report success');
  });

  it('runs the report-flaky.sh script under set -euo pipefail', (t) => {
    const p = resolve(ROOT, 'scripts/report-flaky.sh');
    if (!existsSync(p)) return t.skip('report-flaky.sh no longer present');
    const script = readFileSync(p, 'utf8');
    assert.ok(script.includes('set -euo pipefail'), 'report-flaky.sh must set -euo pipefail');
    // Recorded, not asserted away: its only caller was nightly.yml, now .bak. The script is
    // live code with no live caller, so this case guards a hazard nobody currently walks into.
    console.log('    note: report-flaky.sh is referenced only by nightly.yml.bak (retired)');
  });
});
