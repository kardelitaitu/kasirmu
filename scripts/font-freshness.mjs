/**
 * font-freshness.mjs -- one definition of "how current is this build artifact", shared
 * by scripts/check-font-bundle.mjs (the bundle arithmetic) and
 * ui/e2e/font-visual-audit.mjs (the before/after and type-scale measurements).
 *
 * Why it is shared rather than copied twice: both tools measure `ui/dist`, which is
 * gitignored and has no revision stamp, so each has to answer the same question --
 * could something have landed that makes these numbers describe a tree that no longer
 * exists? Two copies of that answer drift, and this repository has already documented
 * what drift looks like: five separate copies of a stylesheet-listing helper across
 * five walker suites, each fixed on a different day. AGENTS.md's rule binds every
 * walker -- a file read has no channel to the revision it is being asked about -- and
 * an artifact read has the same blind spot in sharper form, because it can be hours
 * behind HEAD while the source tree looks perfectly clean.
 *
 * This module answers with facts and no advice; advice belongs to the tool that knows
 * what it measured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The only commits that can change a font measurement. Deliberately narrow: filtering
 * on all of ui/src reported 28 commits since a build that exactly 1 commit could have
 * affected, and a warning that counts everything is a warning nobody acts on. A
 * dependency move is in the list because it is the one non-CSS way a face appears or
 * vanishes -- fontsource ships the files that the @imports resolve to.
 */
export const FONT_SURFACE = [
  ':(glob)ui/src/**/*.css',
  'ui/index.html',
  'ui/index.tablet.html',
  'ui/package.json',
];

/** Newest mtime among the artifact's files: the closest thing a gitignored dir has to a build stamp. */
export function buildTimeOf(assetsDir) {
  const times = fs.readdirSync(assetsDir)
    .map((f) => fs.statSync(path.join(assetsDir, f)).mtimeMs)
    .filter((t) => Number.isFinite(t));
  if (!times.length) throw new Error(`${assetsDir} has no files to date`);
  return Math.max(...times);
}

function git(repo, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], { cwd: repo, encoding: 'utf-8' });
}

/** Commits on the font surface since the artifact was built, newest first. */
export function surfaceCommitsSince(repo, sinceMs) {
  const since = new Date(sinceMs).toISOString();
  const out = git(repo, ['log', '--format=%h %s', `--since=${since}`, '--', ...FONT_SURFACE]).trim();
  const rows = out === '' ? [] : out.split('\n');
  const headSha = git(repo, ['rev-parse', '--short', 'HEAD']).trim();
  return { rows, headSha, since };
}

/** Repo-relative paths git considers modified under `dir`. One call, whole subtree. */
export function dirtyPathsUnder(repo, dir) {
  const out = new Set();
  try {
    for (const line of git(repo, ['status', '--porcelain', '--', dir]).split('\n').filter(Boolean)) {
      const p = line.slice(3);
      out.add(p.includes(' -> ') ? p.split(' -> ').pop() : p);
    }
  } catch {
    return null; // caller must say it could not ask, not that nothing was dirty
  }
  return out;
}

/** Every .css under `dir` with its mtime, for the "edited after the build" comparison. */
export function stylesheetsNewerThan(repo, dir, sinceMs) {
  const root = path.join(repo, dir);
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) found.push({ path: p, rel: path.relative(repo, p).replace(/\\/g, '/'), mtime: fs.statSync(p).mtimeMs });
    }
  })(root);
  const newer = found.filter((f) => f.mtime > sinceMs);
  const dirty = dirtyPathsUnder(repo, dir);
  const rows = newer.map((f) => ({ ...f, dirty: dirty === null ? null : dirty.has(f.rel) }));
  return { total: found.length, suspects: rows, dirtyCount: rows.filter((r) => r.dirty === true).length, gitAskable: dirty !== null };
}

/** Hours, one decimal, for printing. */
export function ageHours(sinceMs) {
  return Math.round(((Date.now() - sinceMs) / 3600000) * 10) / 10;
}
