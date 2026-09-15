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
import { buildTimeOf, surfaceCommitsSince, stylesheetsNewerThan, ageHours } from './font-freshness.mjs';

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

// A walker has no channel to the revision it is being asked about -- AGENTS.md says so
// of every CSS suite in the repo, and this tool is not exempt: it graded a build four
// hours old and printed nothing about it. The definition of "how current is this
// artifact" lives in scripts/font-freshness.mjs, shared with the audit probe so the two
// tools cannot answer that question differently.
const repo = path.join(HERE, '..');
const newestAsset = buildTimeOf(ASSETS);
console.log('\n  staleness');
console.log(`    build time (newest asset)  ${new Date(newestAsset).toISOString()}   ${ageHours(newestAsset)} h before this run`);
const fresh = stylesheetsNewerThan(repo, 'ui/src', newestAsset);
console.log(`    stylesheets newer than it  ${fresh.suspects.length} of ${fresh.total} under ui/src`);
if (fresh.suspects.length && fresh.gitAskable) {
  console.log('    These were last modified after the build, so the numbers above may not describe the');
  console.log('    tree you are reading them against: rebuild (cd ui && npm run build) before quoting');
  console.log('    them. Suspicion, not proof -- a checkout or a branch switch rewrites mtimes too, so');
  console.log('    each one is asked whether git thinks its bytes actually differ from HEAD:');
  // Dirty first: the display is a sample, and a sample that leads alphabetically can
  // spend all twelve slots on files that only have a moved mtime.
  const ordered = fresh.suspects.filter((s) => s.dirty).concat(fresh.suspects.filter((s) => !s.dirty));
  for (const s of ordered.slice(0, 12)) {
    const state = s.dirty ? 'DIRTY vs HEAD -- the build cannot contain this edit'
      : 'clean vs HEAD -- mtime moved, bytes did not';
    console.log(`      ${state.padEnd(46)} ${s.rel}`);
  }
  if (ordered.length > 12) console.log(`      ... and ${ordered.length - 12} more (the count below covers all ${ordered.length}, not just what is shown)`);
  console.log(`    of all ${fresh.suspects.length} suspects, ${fresh.dirtyCount} differ from HEAD; only those can make the build wrong rather than merely old.`);
} else if (fresh.suspects.length) {
  console.log(`    ${fresh.suspects.length} modified after the build, and git could not be asked whether they`);
  console.log('    also differ in bytes. Reported as unaskable rather than as clean.');
}
// The sharper half: an entirely clean tree still moves under a build, because commits
// land. "No file differs from HEAD" is not "the build matches HEAD".
try {
  const { rows, headSha } = surfaceCommitsSince(repo, newestAsset);
  console.log(`    commits that could change these numbers since the build: ${rows.length}   (HEAD ${headSha})`);
  for (const r of rows.slice(0, 4)) console.log(`      ${r.slice(0, 96)}`);
  if (rows.length > 4) console.log(`      ... and ${rows.length - 4} more`);
  console.log('    Filter: any .css under ui/src, the two boot documents, and ui/package.json -- defined');
  console.log('    once, in scripts/font-freshness.mjs, and shared with the audit probe.');
  if (rows.length) {
    console.log('    A build is not a checkout: these numbers describe the artifact, and the artifact was');
    console.log('    made before that much history existed. Rebuild before quoting them as a property of HEAD.');
  } else {
    console.log('    Nothing has landed that could move these figures: the artifact is current with HEAD.');
  }
} catch { /* informational; the arithmetic above stands without git */ }



