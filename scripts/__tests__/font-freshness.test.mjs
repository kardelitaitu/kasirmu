#!/usr/bin/env node
/**
 * scripts/__tests__/font-freshness.test.mjs
 *
 * Tests the primitives of scripts/font-freshness.mjs, the module that answers
 * "could this font artifact be describing a tree that no longer exists?".
 *
 * Why it deserves its own file: both consumers (scripts/check-font-bundle.mjs and
 * ui/e2e/font-visual-audit.mjs) test their own VERDICT -- CURRENT / STALE /
 * UNKNOWN -- but neither exercises the four measurements the verdict is built
 * from. The failure mode this module exists to prevent is a check that answers
 * "current" by measuring nothing, so every case below is about the measurement
 * being able to say something other than yes.
 *
 * Everything runs against a THROWAWAY GIT REPO built in a temp directory, not
 * against this checkout: the point of surfaceCommitsSince() is that it counts
 * only commits that can change a font number, and proving that needs a repo
 * where a non-font commit exists to be excluded.
 *
 * Run:  node --test scripts/__tests__/font-freshness.test.mjs
 *   Or: npm run test:scripts   (from ui/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fontSurfaceSheets, buildTimeOf, surfaceCommitsSince, dirtyPathsUnder, stylesheetsNewerThan, ageHours,
} from '../font-freshness.mjs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A real git repo with the font-surface paths the module's FONT_SURFACE names. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'font-fresh-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 'test@example.invalid');
  sh(root, 'config', 'user.name', 'font-freshness test');
  sh(root, 'config', 'commit.gpgsign', 'false');
  for (const d of ['ui/src/theme', 'ui/src/other', 'ui/index.html']) {
    if (d.endsWith('.html')) continue;
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'ui/index.html'), '<html></html>');
  // One sheet that DECLARES a face, one that IMPORTS fontsource, one that does neither.
  writeFileSync(join(root, 'ui/src/theme/fonts.css'), '@font-face { font-family: X; }');
  writeFileSync(join(root, 'ui/src/theme/imports.css'), '@import \'@fontsource/inter/index.css\';');
  writeFileSync(join(root, 'ui/src/other/plain.css'), 'body { color: red; }');
  return root;
}

const commit = (root, msg, ...paths) => {
  sh(root, 'add', '--', ...paths);
  sh(root, 'commit', '-q', '-m', msg);
};

/** A commit stamped in the past, so `--since` can exclude it deterministically. */
const commitAt = (root, iso, msg, ...paths) => {
  sh(root, 'add', '--', ...paths);
  execFileSync('git', ['commit', '-q', '-m', msg], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
};

describe('fontSurfaceSheets() — derived from HEAD, and never silently empty', () => {
  it('finds the two sheets that can produce a face and not the one that cannot', () => {
    const root = makeRepo();
    try {
      commit(root, 'seed', '.');
      const sheets = fontSurfaceSheets(root);
      assert.deepStrictEqual(sheets.sort(), ['ui/src/theme/fonts.css', 'ui/src/theme/imports.css']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws where git cannot answer, rather than returning an empty list', () => {
    // An empty list means "no sheet can change a font number", which the callers
    // read as "the artifact is current" -- the one answer a freshness check must
    // never give by accident.
    const root = mkdtempSync(join(tmpdir(), 'font-nogit-'));
    try {
      assert.throws(() => fontSurfaceSheets(root), /git ls-files failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('surfaceCommitsSince() — the narrow filter, proven narrow', () => {
  it('counts a commit on the surface and ignores one that cannot change a font number', () => {
    const root = makeRepo();
    try {
      // The seed itself touches the surface (it adds ui/index.html), so it is
      // stamped in the past: otherwise "since" catches it and the case proves
      // nothing about the filter.
      commitAt(root, '2026-01-01T00:00:00+0000', 'seed', '.');
      const since = Date.now() - 60_000;
      writeFileSync(join(root, 'ui/src/other/plain.css'), 'body { color: blue; }');
      commit(root, 'unrelated css', 'ui/src/other/plain.css');
      let res = surfaceCommitsSince(root, since);
      assert.deepStrictEqual(res.rows, [], 'a plain stylesheet commit is NOT on the font surface');
      assert.match(res.headSha, /^[0-9a-f]{7,}$/);

      writeFileSync(join(root, 'ui/index.html'), '<html lang="en"></html>');
      commit(root, 'boot document', 'ui/index.html');
      res = surfaceCommitsSince(root, since);
      assert.strictEqual(res.rows.length, 1);
      assert.match(res.rows[0], /boot document/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dirtyPathsUnder() — says "could not ask" instead of "nothing dirty"', () => {
  it('names the modified path', () => {
    const root = makeRepo();
    try {
      commit(root, 'seed', '.');
      writeFileSync(join(root, 'ui/src/theme/fonts.css'), '@font-face { font-family: Y; }');
      const dirty = dirtyPathsUnder(root, 'ui');
      assert.ok(dirty instanceof Set);
      assert.strictEqual(dirty.has('ui/src/theme/fonts.css'), true);
      assert.strictEqual(dirty.size, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null where git cannot answer', () => {
    const root = mkdtempSync(join(tmpdir(), 'font-nogit2-'));
    try {
      assert.strictEqual(dirtyPathsUnder(root, 'ui'), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('stylesheetsNewerThan() — the "edited after the build" comparison', () => {
  it('flags a sheet newer than the build and leaves an older one alone', () => {
    const root = makeRepo();
    try {
      commit(root, 'seed', '.');
      const now = Date.now();
      const buildMs = now - 3_600_000; // one hour ago
      // Both non-suspect sheets must be older than the build, or their write time
      // (this second) makes them suspects for a reason the case is not about.
      utimesSync(join(root, 'ui/src/theme/fonts.css'), new Date(now - 7_200_000), new Date(now - 7_200_000));
      utimesSync(join(root, 'ui/src/theme/imports.css'), new Date(now - 7_200_000), new Date(now - 7_200_000));
      utimesSync(join(root, 'ui/src/other/plain.css'), new Date(buildMs + 60_000), new Date(buildMs + 60_000));
      const res = stylesheetsNewerThan(root, 'ui/src', buildMs);
      assert.strictEqual(res.total, 3, 'every .css under the dir is counted, not just the suspects');
      assert.deepStrictEqual(res.suspects.map((s) => s.rel), ['ui/src/other/plain.css']);
      assert.strictEqual(res.gitAskable, true);
      assert.strictEqual(res.suspects[0].dirty, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('buildTimeOf() / ageHours()', () => {
  it('dates the artifact by its newest file and refuses an empty directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'font-assets-'));
    try {
      assert.throws(() => buildTimeOf(root), /has no files to date/);
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');
      writeFileSync(join(root, 'a.woff2'), 'x');
      writeFileSync(join(root, 'b.woff2'), 'y');
      utimesSync(join(root, 'a.woff2'), older, older);
      utimesSync(join(root, 'b.woff2'), newer, newer);
      assert.strictEqual(buildTimeOf(root), newer.getTime());
      assert.strictEqual(readdirSync(root).length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints hours to one decimal', () => {
    const twoAndAHalfHoursAgo = Date.now() - 2.5 * 3_600_000;
    assert.strictEqual(ageHours(twoAndAHalfHoursAgo), 2.5);
    assert.strictEqual(ageHours(Date.now()), 0);
  });
});
