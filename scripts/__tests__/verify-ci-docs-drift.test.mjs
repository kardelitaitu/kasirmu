#!/usr/bin/env node
/**
 * scripts/__tests__/verify-ci-docs-drift.test.mjs
 *
 * AUDIT-27 CI-08 regression tests for scripts/verify-ci-docs-drift.py.
 * Runs the verifier against a minimal fixture repo (a temp dir) and
 * asserts its documented exit contract:
 *
 *   exit 0 — docs/ci-pipeline.md, .github/workflows/*.yml, scripts/gates.json,
 *            and the runner gate vocabulary are all in sync
 *   exit 1 — a documented job does not exist in any workflow (ghost job)
 *   exit 2 — a required docs section is missing (structural error)
 *
 * The verifier resolves every path relative to its own location
 * (ROOT = Path(__file__).parent.parent), so copying it into the fixture
 * tree makes it validate the fixtures instead of the real repository.
 *
 * The fixture is minimal but internally consistent: the same three jobs
 * appear in gates.json (with ci + runner mappings), the workflow, and the
 * docs tables, and the runners declare the exact gate labels.
 *
 * Run:  npm run test:scripts   (from ui/)
 * Or:   npx node --test scripts/__tests__/verify-ci-docs-drift.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VERIFIER = resolve(ROOT, 'scripts', 'verify-ci-docs-drift.py');

/* ── Fixture contents ──────────────────────────────────────────────── */

const GATES_JSON =
  JSON.stringify(
    {
      gates: [
        {
          id: 'ui-lint',
          label: 'UI lint',
          status: 'required',
          runners: { 'check.sh': ['ui lint'], 'check:all': ['ui lint'] },
          ci: { workflow: 'ci.yml', job: 'ui-lint' },
        },
        {
          id: 'rust-fmt',
          label: 'Rust fmt',
          status: 'required',
          runners: { 'check.sh': ['rust fmt'] },
          ci: { workflow: 'ci.yml', job: 'rust-fmt' },
        },
        {
          id: 'ci-docs-drift',
          label: 'CI docs drift',
          status: 'required',
          runners: { 'check.sh': ['ci docs drift'], 'check:all': ['ci docs drift'] },
          ci: { workflow: 'ci.yml', job: 'ci-docs-drift' },
        },
      ],
    },
    null,
    2,
  ) + '\n';

const CHECK_SH = `#!/usr/bin/env bash
set -euo pipefail
step() { echo "step: $1"; }
step "ui lint"
step "rust fmt"
step "ci docs drift"
`;

const CHECK_UI = `export function gate(name) {
  console.log('gate: ' + name);
}
gate('ui lint');
gate('ci docs drift');
`;

const CI_YML = `name: CI
on:
  push:
    branches: [main]
jobs:
  ui-lint:
    runs-on: ubuntu-latest
  rust-fmt:
    runs-on: ubuntu-latest
  ci-docs-drift:
    runs-on: ubuntu-latest
`;

const DOCS = `# CI Pipeline

## Job Matrix

| Job | What it does | Blocks |
| --- | --- | --- |
| \`ui-lint\` | ESLint on the UI | ✅ Required |
| \`rust-fmt\` | Rust formatting | ✅ Required |
| \`ci-docs-drift\` | Docs drift check | ✅ Required |

## Pre-Merge Validation Gates

| Gate | Job(s) | Where |
| --- | --- | --- |
| UI lint | \`ui-lint\` | ci.yml |
| Rust fmt | \`rust-fmt\` | ci.yml |
| CI docs drift | \`ci-docs-drift\` | ci.yml |

## Workflow inventory

| Workflow | Purpose |
| --- | --- |
| \`ci.yml\` | Merge validation |
`;

// The verifier requires docs/releases/checklist.md and reports "release checklist not
// found" when it is absent (verify-ci-docs-drift.py:1121). The `if is_file()` guard at
// L1080 has an else that appends a problem, so absence is NOT tolerated -- reading only
// the `if` line and concluding otherwise was my error here, caught by the test.
// The bullet names the fixture's own jobs: live_jobs comes from dev-ci.yml, which this
// fixture does not have, so it is empty and every name resolves against all_jobs.
const CHECKLIST_MD = `# Release Checklist

- [ ] All CI jobs pass: \`ui-lint\`, \`rust-fmt\`, \`ci-docs-drift\`.
- [ ] Version bumped.
`;

/* ── Fixture harness ──────────────────────────────────────────────── */
const fixtureDirs = [];

function buildFixture({ docs = DOCS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oz-ci-drift-'));
  fixtureDirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  // The verifier reads docs/operations/ci-pipeline.md (DOCS, line 81). This fixture
  // wrote docs/ci-pipeline.md, so all three cases failed with "docs not found" -- the
  // doc moved under docs/operations/ during the 0.0.36 restructure and the fixture
  // never followed. Nothing runs this file (see the header note), which is why it
  // stayed red. docs/releases/checklist.md is deliberately NOT created: the verifier
  // guards it with `if RELEASE_CHECKLIST.is_file()`, so absence is tolerated -- which
  // also means the checklist branch is unexercised here and remains so.
  mkdirSync(join(dir, 'docs', 'operations'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
  copyFileSync(VERIFIER, join(dir, 'scripts', 'verify-ci-docs-drift.py'));
  writeFileSync(join(dir, 'scripts', 'gates.json'), GATES_JSON);
  writeFileSync(join(dir, 'scripts', 'check.sh'), CHECK_SH);
  writeFileSync(join(dir, 'scripts', 'check-ui.mjs'), CHECK_UI);
  writeFileSync(join(dir, 'docs', 'operations', 'ci-pipeline.md'), docs);
  writeFileSync(join(dir, 'docs', 'releases', 'checklist.md'), CHECKLIST_MD);
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), CI_YML);
  return dir;
}

/** Run the copied verifier inside a fixture dir; return { code, output }. */
function runVerifier(dir) {
  try {
    const out = execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['scripts/verify-ci-docs-drift.py'],
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 },
    );
    return { code: 0, output: out };
  } catch (err) {
    return {
      code: err.status ?? 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

after(() => {
  for (const dir of fixtureDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── Tests ────────────────────────────────────────────────────────── */

describe('verify-ci-docs-drift.py exit contract (AUDIT-27 CI-08)', () => {
  it('exits 0 when docs, workflows, gates.json, and runners are in sync', () => {
    const dir = buildFixture();
    const { code, output } = runVerifier(dir);
    assert.strictEqual(code, 0, `expected exit 0, got ${code}:\n${output}`);
    assert.match(output, /0 drift item\(s\)\./, 'report should show zero drift');
  });

  it('exits 1 when a documented job does not exist in any workflow (ghost job)', () => {
    const drifted = DOCS.replace(
      '| `ci-docs-drift` | Docs drift check | ✅ Required |',
      '| `ci-docs-drift` | Docs drift check | ✅ Required |\n'
        + '| `ghost-job` | No such job anywhere | ✅ Required |',
    );
    assert.notStrictEqual(drifted, DOCS,
      'mutation changed nothing -- the anchor is stale and this case would pass vacuously');
    const dir = buildFixture({ docs: drifted });
    const { code, output } = runVerifier(dir);
    assert.strictEqual(code, 1, `expected exit 1, got ${code}:\n${output}`);
    assert.match(output, /MISSING JOBS/, 'report should flag the missing job section');
    assert.match(output, /ghost-job/, 'report should name the ghost job');
  });

  it('exits 2 when a required docs section is missing', () => {
    // Renaming the required "Job Matrix" heading makes the section vanish, which must
    // fail closed (exit 2) instead of passing vacuously. This anchor was stale for a
    // while -- it said '## Job Matrix (ci.yml)', the heading lost that suffix, and the
    // replace became a no-op so the doc was never actually truncated and the case could
    // only ever fail. Guarded now, in the same shape verify-agents-mirrors.py uses: a
    // mutation that changes nothing is a broken test, not a passing one.
    const truncated = DOCS.replace('## Job Matrix', '## Job Matrix (renamed)');
    assert.notStrictEqual(truncated, DOCS,
      'mutation changed nothing -- the anchor is stale and this case would pass vacuously');
    const dir = buildFixture({ docs: truncated });
    const { code, output } = runVerifier(dir);
    assert.strictEqual(code, 2, `expected exit 2, got ${code}:\n${output}`);
    assert.match(output, /missing required section/, 'report should name the missing section');
  });
});
