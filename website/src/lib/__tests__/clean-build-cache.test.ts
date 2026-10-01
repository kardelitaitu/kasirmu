/**
 * clean-build-cache.mjs exists because a warm `.astro` cache makes a build measurement
 * silently lie in BOTH directions: a working plugin reads as inert, and an inert plugin
 * reads as working. That cost two rounds of wrong conclusions (see the plugin docstring).
 *
 * These cases pin the two properties that keep it safe to run: it removes exactly the two
 * cache directories and nothing else, and it is idempotent so a second run is not an error.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../../../scripts/clean-build-cache.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kasirmu-clean-'));
  // Mirror the website layout the script resolves against: <root>/scripts/<file>.
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, '.astro'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, '.astro', 'data-store.json'), '{}');
  writeFileSync(join(root, 'dist', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'src', 'keep.md'), '# keep');
  // Copy the script in so its `..` resolution lands on this temp root.
  writeFileSync(
    join(root, 'scripts', 'clean-build-cache.mjs'),
    readFileSync(SCRIPT, 'utf8'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run() {
  return spawnSync(process.execPath, [join(root, 'scripts', 'clean-build-cache.mjs')], {
    encoding: 'utf8',
  });
}

describe('clean-build-cache', () => {
  it('removes .astro and dist', () => {
    run();
    expect(existsSync(join(root, '.astro'))).toBe(false);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  });

  it('leaves anything else alone', () => {
    run();
    expect(existsSync(join(root, 'src', 'keep.md'))).toBe(true);
    expect(existsSync(join(root, 'scripts', 'clean-build-cache.mjs'))).toBe(true);
  });

  it('exits 0 when the caches are already gone', () => {
    expect(run().status).toBe(0);
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('absent');
  });
});
