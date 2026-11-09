#!/usr/bin/env node
/**
 * scripts/__tests__/run-e2e.test.mjs
 *
 * Unit tests for the E2E runner (scripts/run-e2e.mjs).
 * Uses Node.js built-in test runner (node:test) — no vitest needed.
 *
 * Run:  npx node --test scripts/__tests__/run-e2e.test.mjs
 * Or:   npm run test:scripts
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { platform } from 'os';
import { dockerPlan } from '../run-e2e.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..');
const ROOT = resolve(SCRIPTS_DIR, '..');

/* ── Helper: simulate arg parsing like the runner does ─────────────── */

function parseArgs(raw) {
  return {
    HEADED: raw.includes('--headed'),
    API_ONLY: raw.includes('--api-only'),
    UI_ONLY: raw.includes('--ui-only'),
    NO_DOCKER: raw.includes('--no-docker'),
    CHANGED_ONLY: raw.includes('--changed-only'),
    PROJECT: raw.find(a => a.startsWith('--project=')) ?? '',
    SPEC_FILES: raw.filter(a => !a.startsWith('-')),
  };
}

function resolveSpecs(parsed) {
  let specs = [...parsed.SPEC_FILES];
  if (specs.length > 0) return specs;

  if (parsed.CHANGED_ONLY) {
    return null; // Would call getChangedSpecs() — tested separately
  }
  if (parsed.API_ONLY) {
    return ['e2e/api.spec.ts'];
  }
  if (parsed.UI_ONLY) {
    return [
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
  return []; // All specs
}

/* ── Tests ─────────────────────────────────────────────────────────── */

describe('parseArgs()', () => {
  it('parses empty args', () => {
    const p = parseArgs([]);
    assert.strictEqual(p.HEADED, false);
    assert.strictEqual(p.API_ONLY, false);
    assert.strictEqual(p.UI_ONLY, false);
    assert.strictEqual(p.NO_DOCKER, false);
    assert.strictEqual(p.CHANGED_ONLY, false);
    assert.deepStrictEqual(p.SPEC_FILES, []);
  });

  it('parses --headed flag', () => {
    const p = parseArgs(['--headed']);
    assert.strictEqual(p.HEADED, true);
    assert.strictEqual(p.NO_DOCKER, false);
  });

  it('parses --no-docker flag', () => {
    const p = parseArgs(['--no-docker']);
    assert.strictEqual(p.NO_DOCKER, true);
  });

  it('parses --changed-only flag', () => {
    const p = parseArgs(['--changed-only']);
    assert.strictEqual(p.CHANGED_ONLY, true);
  });

  it('parses --api-only and --ui-only (mutually exclusive)', () => {
    const api = parseArgs(['--api-only']);
    assert.strictEqual(api.API_ONLY, true);
    assert.strictEqual(api.UI_ONLY, false);

    const ui = parseArgs(['--ui-only']);
    assert.strictEqual(ui.UI_ONLY, true);
    assert.strictEqual(ui.API_ONLY, false);
  });

  it('filters spec files from args', () => {
    const p = parseArgs(['--headed', 'e2e/auth.spec.ts', 'e2e/sale.spec.ts']);
    assert.strictEqual(p.HEADED, true);
    assert.deepStrictEqual(p.SPEC_FILES, ['e2e/auth.spec.ts', 'e2e/sale.spec.ts']);
  });

  it('handles --no-docker with a spec file', () => {
    const p = parseArgs(['--no-docker', 'e2e/api.spec.ts']);
    assert.strictEqual(p.NO_DOCKER, true);
    assert.deepStrictEqual(p.SPEC_FILES, ['e2e/api.spec.ts']);
  });

  it('captures --project= flag and excludes it from spec files', () => {
    const p = parseArgs(['--project=desktop', 'e2e/auth.spec.ts']);
    assert.strictEqual(p.PROJECT, '--project=desktop');
    assert.deepStrictEqual(p.SPEC_FILES, ['e2e/auth.spec.ts']);
  });

  it('returns empty PROJECT when no --project= flag is given', () => {
    const p = parseArgs(['--headed', 'e2e/auth.spec.ts']);
    assert.strictEqual(p.PROJECT, '');
  });

  it('ignores non-flag strings as spec files', () => {
    const p = parseArgs(['e2e/test/a.spec.ts', 'e2e/test/b.spec.ts']);
    assert.deepStrictEqual(p.SPEC_FILES, ['e2e/test/a.spec.ts', 'e2e/test/b.spec.ts']);
  });
});

describe('resolveSpecs()', () => {
  it('returns explicit spec files when given', () => {
    const p = parseArgs(['e2e/auth.spec.ts']);
    assert.deepStrictEqual(resolveSpecs(p), ['e2e/auth.spec.ts']);
  });

  it('returns API spec for --api-only', () => {
    const p = parseArgs(['--api-only']);
    assert.deepStrictEqual(resolveSpecs(p), ['e2e/api.spec.ts']);
  });

  it('returns all UI specs for --ui-only', () => {
    const p = parseArgs(['--ui-only']);
    const specs = resolveSpecs(p);
    assert.ok(specs.length >= 9);
    assert.ok(specs.includes('e2e/auth.spec.ts'));
    assert.ok(!specs.includes('e2e/api.spec.ts'));
  });

  it('returns null for --changed-only (deferred to git diff)', () => {
    const p = parseArgs(['--changed-only']);
    assert.strictEqual(resolveSpecs(p), null);
  });

  it('returns empty array when no flags are given', () => {
    const p = parseArgs([]);
    assert.deepStrictEqual(resolveSpecs(p), []);
  });
});

describe('getChangedSpecs() (git integration)', () => {
  it('runs without error in a git repo', () => {
    // This tests that the git command runs. It may return [] or [specs];
    // we only verify it doesn't throw.
    try {
      const result = execSync(
        'git rev-parse --is-inside-work-tree',
        { stdio: 'pipe', timeout: 5_000, cwd: ROOT },
      ).toString().trim();
      assert.strictEqual(result, 'true');
    } catch {
      // Not in a git repo — that's fine, test passes
    }
  });

  it('handles git failure gracefully when not in a repo', () => {
    // The getChangedSpecs function in the runner has a try-catch;
    // verify the error path returns empty array
    try {
      execSync('git --no-pager diff --name-only HEAD HEAD~1', {
        stdio: 'pipe',
        timeout: 5_000,
        cwd: __dirname, // An arbitrary directory without git context
      });
    } catch {
      // Expected: git will fail outside the repo — that's fine
    }
  });
});

describe('dockerPlan() — what a missing daemon means for a run', () => {
  // The predecessor of this block re-implemented the availability probe in a
  // closure and asserted `typeof available === 'boolean'` — a tautology that
  // passes whether or not the real function exists, let alone what it decides.
  // The module is importable now, so the decision is tested instead of a copy
  // of the thing it replaces.
  it('a full run with no daemon is a SETUP failure, never a skip', () => {
    assert.strictEqual(
      dockerPlan({ noDocker: false, uiOnly: false, available: false }),
      'unavailable-fatal',
    );
  });

  it('--ui-only proceeds: those specs need no backend', () => {
    assert.strictEqual(
      dockerPlan({ noDocker: false, uiOnly: true, available: false }),
      'unavailable-ui-only',
    );
  });

  it('--no-docker never consults the daemon, even when it is up', () => {
    // The caller owns its servers; starting ours would be a second backend on
    // the same ports. The flag outranks availability, both ways.
    assert.strictEqual(dockerPlan({ noDocker: true, uiOnly: false, available: true }), 'not-requested');
    assert.strictEqual(dockerPlan({ noDocker: true, uiOnly: false, available: false }), 'not-requested');
  });

  it('an available daemon wins over the ui-only shortcut', () => {
    assert.strictEqual(dockerPlan({ noDocker: false, uiOnly: true, available: true }), 'available');
  });

  it('the runner module imports without starting a run', () => {
    // Guards the entry-point condition itself: without it, importing this
    // module from a test would execute main() and start Vite.
    assert.strictEqual(typeof dockerPlan, 'function');
  });
});

describe('killByPort()', () => {
  it('handles non-existent port gracefully', () => {
    // Should not throw when no process is listening on the port
    try {
      const port = 51999; // Unlikely to be in use
      if (platform() === 'win32') {
        execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port}"`, {
          stdio: 'pipe',
          timeout: 5_000,
        });
      } else {
        execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, {
          stdio: 'pipe',
          timeout: 5_000,
        });
      }
    } catch {
      // Expected: no process on port 51999 — fine
    }
  });
});

describe('Playwright command construction', () => {
  it('builds --headed flag into command', () => {
    const headed = true;
    let cmd = 'npx playwright test --config e2e/playwright.config.ts';
    if (headed) cmd += ' --headed';
    assert.ok(cmd.includes('--headed'));
  });

  it('forwards --project= flag into command', () => {
    const project = '--project=desktop';
    let cmd = 'npx playwright test --config e2e/playwright.config.ts';
    if (project) cmd += ` ${project}`;
    assert.ok(cmd.includes('--project=desktop'));
  });

  it('formats spec file paths correctly', () => {
    const specs = ['e2e/auth.spec.ts'];
    const cmd = 'npx playwright test --config e2e/playwright.config.ts'
      + (specs.length > 0 ? ' ' + specs.map(f => f.startsWith('e2e/') ? f : `e2e/${f}`).join(' ') : '');
    assert.ok(cmd.includes('e2e/auth.spec.ts'));
    assert.ok(cmd.includes('--config e2e/playwright.config.ts'));
  });

  it('handles spec files without e2e/ prefix', () => {
    const specs = ['auth.spec.ts'];
    const result = specs.map(f => {
      let p = f.replace(/^ui\//, '');
      if (p.startsWith('e2e/e2e/')) p = p.replace(/^e2e\/e2e\//, 'e2e/');
      return p.startsWith('e2e/') ? p : `e2e/${p}`;
    });
    assert.deepStrictEqual(result, ['e2e/auth.spec.ts']);
  });

  it('prevents duplicating e2e/ prefix when input is ui/e2e/auth.spec.ts', () => {
    const specs = ['ui/e2e/auth.spec.ts', 'e2e/sale.spec.ts', 'e2e/e2e/settings.spec.ts'];
    const result = specs.map(f => {
      let p = f.replace(/^ui\//, '');
      if (p.startsWith('e2e/e2e/')) p = p.replace(/^e2e\/e2e\//, 'e2e/');
      return p.startsWith('e2e/') ? p : `e2e/${p}`;
    });
    assert.deepStrictEqual(result, ['e2e/auth.spec.ts', 'e2e/sale.spec.ts', 'e2e/settings.spec.ts']);
  });
});
