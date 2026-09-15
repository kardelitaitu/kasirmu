#!/usr/bin/env node
/**
 * check-font-bundle.mjs -- re-derive, from the built artifact, the numbers
 * todo-font-system.md keeps having to re-measure.
 *
 * Why this exists as a tool: every round of that plan has re-counted `@font-face`
 * blocks, src files, `data:` faces and woff2 bytes with a throwaway script, and the
 * throwaways have been wrong in three different ways -- counting LINES of a minified
 * stylesheet instead of occurrences (one line, 13 blocks), globbing `ui/dist/assets/*.css`
 * and taking element 0 (a per-screen chunk with zero faces, read out as the bundle),
 * and searching for a host string that silently skips the lines that spell it with
 * escaped dots. Each mistake produced a confident wrong number. A committed tool with
 * one output format is the fix for a class of error, not for one error.
 *
 * What it refuses to do: report a zero for a pipeline it could not read. `ui/dist` is
 * gitignored and may be absent, so an absent build exits 2 with a message rather than
 * printing counts of 0 -- a broken pipeline is not a zero.
 *
 * Usage:  node scripts/check-font-bundle.mjs [--dist ui/dist]
 * Exit:   0 read and reported | 2 no build to read
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dist = path.resolve(argv.indexOf('--dist') === -1
  ? path.join(HERE, '..', 'ui', 'dist')
  : argv[argv.indexOf('--dist') + 1]);

const ASSETS = path.join(dist, 'assets');
if (!fs.existsSync(ASSETS)) {
  console.error(`no ${ASSETS} -- build first (cd ui && npm run build) or pass --dist <dir>.`);
  console.error('Refusing to print zeros for a pipeline that was not read.');
  process.exit(2);
}

const sheets = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.css'));
const withFaces = [];
for (const f of sheets) {
  const text = fs.readFileSync(path.join(ASSETS, f), 'utf-8');
  const blocks = text.match(/@font-face\s*\{[^}]*\}/gi) ?? [];
  if (blocks.length) withFaces.push({ name: f, text, blocks });
}

console.log(`css sheets in the build: ${sheets.length}   carrying @font-face: ${withFaces.length}`);
for (const s of withFaces) {
  const urls = [];
  for (const b of s.blocks) {
    for (const m of b.matchAll(/url\(\s*['"]?([^'")\s]+)/g)) urls.push(m[1]);
  }
  const data = urls.filter((u) => u.startsWith('data:'));
  const files = urls.filter((u) => !u.startsWith('data:')).map((u) => path.basename(u));
  const distinct = [...new Set(files)];
  const swap = s.blocks.filter((b) => /font-display\s*:\s*swap/i.test(b)).length;
  const families = {};
  for (const b of s.blocks) {
    const fam = (b.match(/font-family\s*:\s*['"]?([^;'"]+)/i)?.[1] ?? '?').trim();
    families[fam] = (families[fam] ?? 0) + 1;
  }
  const onDisk = new Set(fs.readdirSync(ASSETS).filter((f) => f.endsWith('.woff2') || f.endsWith('.woff')));
  const missing = distinct.filter((f) => !onDisk.has(f));
  const orphans = [...onDisk].filter((f) => !distinct.includes(f));

  console.log(`\n  ${s.name}`);
  console.log(`    @font-face blocks      ${s.blocks.length}   (counted as occurrences; the file is minified onto ${s.text.split('\n').length} line(s), so a line count would read 1)`);
  console.log(`    src url() refs         ${urls.length}  = ${files.length} file refs + ${data.length} inline data: URI(s)`);
  console.log(`    distinct font files    ${distinct.length}   ${JSON.stringify(families)}`);
  console.log(`    font-display: swap     ${swap} of ${s.blocks.length}`);
  console.log(`    referenced but absent  ${missing.length} ${missing.length ? JSON.stringify(missing) : ''}`);
  console.log(`    on disk, never ref'd   ${orphans.length} ${orphans.length ? JSON.stringify(orphans) : ''}`);
}

const fontFiles = fs.readdirSync(ASSETS).filter((f) => /\.(woff2?|ttf|otf|eot)$/.test(f));
const bytesOf = (list) => list.reduce((a, f) => a + fs.statSync(path.join(ASSETS, f)).size, 0);
const kb = (n) => Math.round((n / 1024) * 10) / 10;
const jsFiles = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));

console.log('\n  budget');
console.log(`    font bytes in build    ${kb(bytesOf(fontFiles))} KB across ${fontFiles.length} files`);
console.log(`    js bytes in build      ${kb(bytesOf(jsFiles))} KB across ${jsFiles.length} files`);
console.log(`    fonts as share of js   ${jsFiles.length ? Math.round((bytesOf(fontFiles) / bytesOf(jsFiles)) * 1000) / 10 : 0} %`);
console.log('\n    Note: scripts/check-bundle.mjs filters to .js and .css and cannot see any of');
console.log('    the bytes above. That gap is recorded in todo-font-system.md and not fixed here.');
console.log(`\n  subject: ${ASSETS} (gitignored; this is a build of whatever tree made it)`);

// A walker has no channel to the revision it is being asked about -- this file's own
// AGENTS.md says so of every CSS suite in the repo, and this tool is not exempt: it
// graded a build four hours old last time it ran and printed nothing about it. The
// newest asset mtime is the closest thing a gitignored directory has to a build stamp,
// so compare the sources against it and say what that comparison can and cannot mean.
const newestAsset = Math.max(...fs.readdirSync(ASSETS).map((f) => fs.statSync(path.join(ASSETS, f)).mtimeMs));
const srcCss = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.css')) srcCss.push({ p, m: fs.statSync(p).mtimeMs });
  }
})(path.join(HERE, '..', 'ui', 'src'));
const suspects = srcCss.filter((s) => s.m > newestAsset);
const hours = (ms) => Math.round((ms / 3600000) * 10) / 10;
console.log('\n  staleness');
console.log(`    build time (newest asset)  ${new Date(newestAsset).toISOString()}   ${hours(Date.now() - newestAsset)} h before this run`);
console.log(`    stylesheets newer than it  ${suspects.length} of ${srcCss.length} under ui/src`);
if (suspects.length) {
  console.log('    These were last modified after the build, so the numbers above may not describe the');
  console.log('    tree you are reading them against: rebuild (cd ui && npm run build) before quoting');
  console.log('    them. Suspicion, not proof -- a checkout or a branch switch rewrites mtimes too,');
  console.log('    so each one is asked whether git thinks its bytes actually differ from HEAD:');
  const repo = path.join(HERE, '..');
  // Ask git about the whole tree once, rather than per displayed suspect: the first
  // version counted dirty files INSIDE the slice(0,12) display loop and printed
  // "0 differ from HEAD" for a 134-suspect list that genuinely contained a dirty
  // stylesheet. A summary computed over what happened to be printed is not a summary.
  const dirtySet = new Set();
  try {
    const por = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain', '--', 'ui/src'],
      { cwd: repo, encoding: 'utf-8' }).split('\n').filter(Boolean);
    for (const line of por) {
      const p = line.slice(3);
      dirtySet.add(p.includes(' -> ') ? p.split(' -> ').pop() : p);
    }
  } catch { /* the mtime facts stand without git */ }
  let dirtyCount = 0;
  const withState = suspects.map((s) => {
    const rel = path.relative(repo, s.p).replace(/\\/g, '/');
    const isDirty = dirtySet.has(rel);
    if (isDirty) dirtyCount++;
    return { rel, isDirty };
  });
  // Dirty first: the display is a sample, and a sample that leads alphabetically can
  // spend all twelve slots on files that only have a moved mtime.
  const ordered = withState.filter((s) => s.isDirty).concat(withState.filter((s) => !s.isDirty));
  for (const s of ordered.slice(0, 12)) {
    const state = s.isDirty ? 'DIRTY vs HEAD -- the build cannot contain this edit'
      : 'clean vs HEAD -- mtime moved, bytes did not';
    console.log(`      ${state.padEnd(46)} ${s.rel}`);
  }
  if (suspects.length > 12) console.log(`      ... and ${suspects.length - 12} more (the count below covers all ${suspects.length}, not just what is shown)`);
  console.log(`    of all ${suspects.length} suspects, ${dirtyCount} differ from HEAD; only those can make the build wrong rather than merely old.`);
}

// The sharper half: an entirely clean tree still moves under a build, because commits
// land. "No file differs from HEAD" is not "the build matches HEAD" -- say how far
// behind HEAD this artifact is, in commits that could actually change these numbers.
try {
  const since = new Date(newestAsset).toISOString();
  const SURFACE = [':(glob)ui/src/**/*.css', 'ui/index.html', 'ui/index.tablet.html', 'ui/package.json'];
  const commits = execFileSync('git', ['--no-optional-locks', 'log', '--format=%h %s', `--since=${since}`, '--', ...SURFACE],
    { cwd: path.join(HERE, '..'), encoding: 'utf-8' }).trim();
  const rows = commits === '' ? [] : commits.split('\n');
  const headSha = execFileSync('git', ['--no-optional-locks', 'rev-parse', '--short', 'HEAD'],
    { cwd: path.join(HERE, '..'), encoding: 'utf-8' }).trim();
  // Narrow on purpose: the first version filtered on all of ui/src and reported 28
  // commits since a build that could only have been changed by 1 of them. A warning
  // that counts everything is a warning nobody acts on.
  console.log(`    commits that could change these numbers since the build: ${rows.length}   (HEAD ${headSha})`);
  for (const r of rows.slice(0, 4)) console.log(`      ${r.slice(0, 96)}`);
  if (rows.length > 4) console.log(`      ... and ${rows.length - 4} more`);
  // Printed even when the count is 0: a zero means nothing unless the reader knows
  // what it was counted over. The advice is conditional; the definition is not.
  console.log('    Filter: any .css under ui/src, the two boot documents, and ui/package.json (a');
  console.log('    dependency move can add or drop a face).');
  if (rows.length) {
    console.log('    A build is not a checkout: these numbers describe the artifact, and the artifact was');
    console.log('    made before that much history existed. Rebuild before quoting them as a property of HEAD.');
  } else {
    console.log('    Nothing has landed that could move these figures: the artifact is current with HEAD.');
  }
} catch { /* reported informationally; the tool is still correct without git */ }



