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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = (dir) => path.join(dir, '..');

/**
 * The only commits that can change a font measurement. Deliberately narrow, and the
 * narrowness is measured rather than asserted: filtering on all of ui/src reported 28
 * commits since a build that exactly 1 commit could have affected, and a warning that
 * counts everything is a warning nobody acts on. The 2026-09-30 re-measurement found
 * the same thing at a larger scale -- 37 commits since that day's build against ZERO
 * commits that could touch a face, because exactly one sheet in the repo has anything
 * to do with fonts at all (see the note on FONT_SURFACE: no sheet DECLARES a face,
 * one IMPORTS them). So the list below is that one sheet, derived from HEAD rather
 * than kept by name, plus the two ways a face can appear or vanish without a CSS edit.
 */
export const FONT_SURFACE = [
  // The sheets that actually PRODUCE a face, DERIVED rather than assumed. At the commit
  // that introduced this list the filter was all of ui/src/**/*.css, and the 28-vs-1
  // note above describes what that cost; the narrow form was never applied, so the
  // warning has been counting every CSS commit in the repo ever since.
  //
  // "Produces a face" is two things, and the second is the one this repo actually
  // uses: a sheet may declare an @font-face block itself, or it may @import a
  // fontsource package that declares them. Measured at 2026-09-30 over all 142 tracked
  // sheets under ui/src: ZERO declare a block, and exactly ONE -- ui/src/theme/fonts.css
  // -- imports two of them. A filter that looked only for @font-face would return an
  // empty list here and then, because empty means "current" to the caller, declare a
  // stale artifact fresh. Searching for the WORD also looks right and is wrong: the
  // only @font-face string in that sheet is inside a comment explaining the trap.
  //
  // A sheet that ADDS a face is caught, because the commit that adds it changes a
  // sheet and fontSurfaceSheets() re-derives the list from HEAD on every run. A commit
  // that only REMOVES the last import and leaves the sheet in place is caught too --
  // the sheet is still here, it just stops matching, and `surfaceCommitsSince` no longer
  // counts that commit as able to change a font number. That second case is a real
  // limit worth writing down: the filter asks what can change the numbers, and after a
  // removal the answer is correct only if the removal itself is visible, which it is
  // not from inside the next run.
  ...fontSurfaceSheets(repoRoot(HERE)),
  // The boot documents name the sheets the build starts from, so adding a third
  // entry point changes what the artifact contains without any .css changing.
  'ui/index.html',
  'ui/index.mobile.html',
  // Packaging and dependency moves: fontsource ships the files the @imports resolve
  // to, which is the one non-CSS way a face appears or vanishes.
  'ui/package.json',
  'ui/package-lock.json',
  // The binaries themselves, if they are ever tracked.
  ':(glob)ui/src/**/*.{woff,woff2}',
];

/**
 * The tracked sheets under ui/src that declare at least one @font-face block, as git
 * pathspecs. Measured from HEAD, so the list follows the tree instead of a hand-kept
 * set of file names -- a name list is a list that starts rotting the day a sheet is
 * added.
 *
 * REPO ROOT, NOT CWD: this list is computed at module load, before any caller has
 * passed a root, so reading it from process.cwd() made the answer depend on where the
 * tool happened to be launched. Run from the repo it found the sheet; run from
 * ui/e2e/ it found nothing and reported the artifact as current. That is the one way a
 * freshness check must not fail -- silently, by measuring nothing -- so the root is
 * derived from this module's own location and git failing to answer throws instead of
 * returning an empty list.
 */
export function fontSurfaceSheets(repo) {
  let out = '';
  try {
    out = execFileSync('git', ['ls-files', '--', ':(glob)ui/src/**/*.css'], {
      cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // git could not answer. Returning [] here would report the artifact as CURRENT,
    // which is the one answer a freshness check must never give by accident.
    throw new Error(`git ls-files failed under ${repo}: ${e.message}`);
  }
  const sheets = out.split('\n').filter(Boolean);
  if (!sheets.length) {
    throw new Error(`no tracked .css under ui/src found from ${repo}`);
  }
  const withFaces = [];
  for (const rel of sheets) {
    try {
      const text = execFileSync('git', ['show', 'HEAD:' + rel], {
        cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
      if (/@font-face\s*\{/i.test(text)
        || /@import\s+['"][^'"]*font/i.test(text)) withFaces.push(rel);
    } catch { /* a sheet git cannot show is not evidence of a face */ }
  }
  return withFaces;
}

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
