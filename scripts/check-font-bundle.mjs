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
 * printing counts of 0 -- a broken pipeline is not a zero. `--self-test` extends that
 * rule to every input BELOW the build directory: each one is a set this tool compares
 * against another set, and a comparison over no sets cannot tell "the sets agree" from
 * "there was nothing to compare". See SELF-TEST CASES at the bottom of this file.
 *
 * Usage:  node scripts/check-font-bundle.mjs [--dist ui/dist]
 *         node scripts/check-font-bundle.mjs --self-test
 * Exit:   0 read and reported | 1 a self-test case failed | 2 no build to read
 *         (the self-test reads no build, so it never exits 2)
 */
import fs from 'node:fs';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimeOf, surfaceCommitsSince, stylesheetsNewerThan, ageHours } from './font-freshness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_MISSING = 2;
const SELF_TEST_FAILED = 1;

/* ---------------------------------------------------------------------------
 * The detector. Every function below is pure over text, or over a directory the
 * caller names, and NONE of them can return a clean answer for an input it could
 * not read. That is what makes --self-test possible: the cases drive these, never
 * a copy of them.
 * ------------------------------------------------------------------------- */

/** Every `@font-face { ... }` block in a stylesheet. Occurrences, never lines. */
export function faceBlocks(text) {
  return text.match(/@font-face\s*\{[^}]*\}/gi) ?? [];
}

/**
 * The url() references inside one @font-face block.
 *
 * The closing quote is in the character class on purpose: it is what ends an
 * unquoted url(), and scoping the class to one block is what stops a url() written
 * OUTSIDE an @font-face -- a background image -- from being counted as a face.
 */
export function srcUrls(block) {
  return [...block.matchAll(/url\(\s*['"]?([^'")\s]+)/g)].map((m) => m[1]);
}

/** The tally for ONE stylesheet: what its faces reference, and where they say to find it. */
export function faceTally(blocks) {
  const urls = blocks.flatMap(srcUrls);
  const data = urls.filter((u) => u.startsWith('data:'));
  const files = urls.filter((u) => !u.startsWith('data:')).map((u) => path.basename(u));
  const swap = blocks.filter((b) => /font-display\s*:\s*swap/i.test(b)).length;
  const families = {};
  for (const b of blocks) {
    const fam = (b.match(/font-family\s*:\s*['"]?([^;'"]+)/i)?.[1] ?? '?').trim();
    families[fam] = (families[fam] ?? 0) + 1;
  }
  return { urls, data, files, distinct: [...new Set(files)], swap, families };
}

/**
 * The set comparison this tool exists for: what a stylesheet NAMES versus what the
 * build actually SHIPS. Both directions are reported, because they are different
 * faults -- a reference with no file is a 404 on first paint; a file nobody
 * references is bytes paid for and never used.
 *
 * `onDisk` is every font binary in the build, not the woff2 subset the byte total
 * uses. Measured: with only .woff2/.woff in the disk set, a build shipping `stray.ttf`
 * reported `0 orphans` -- the exact "confident wrong number" the header above says
 * this tool exists to end.
 */
export function orphanReport(named, onDisk) {
  const missing = named.filter((f) => !onDisk.includes(f));
  const orphans = onDisk.filter((f) => !named.includes(f));
  return { missing, orphans };
}

/**
 * `.woff` where the filename intends `.woff2`: a pass-through face (no format('woff2')
 * beside it) serving the older container, or a hand-written path with the suffix
 * dropped. Found while writing the self-test, on the live 13-block bundle: the report
 * said "13 refs = 12 files + 1 data:" and 12 files was right, so nothing looked
 * wrong -- two faces pointed at the SAME file under two names. No count can see it,
 * so it has to be a predicate of its own, over inputs the report already prints.
 */
export function woff2Likely(names) {
  return names.filter((n) => /\.woff$/i.test(n));
}

/**
 * A passed-through path whose filename is a HOST -- `./fonts.googleapis.com/...`. The
 * header's third throwaway mistake was a host SEARCH that skipped escaped dots; this
 * is the mirror: a build that actually embeds the remote path, which the CSP
 * (`font-src 'self' data:`) can never load.
 */
export function remoteHostRefs(names) {
  return names.filter((n) => /googleapis\.com|gstatic\.com/i.test(n));
}

/** Basenames in a directory listing that are font binaries this tool can account for. */
export function fontFilesIn(listing) {
  return listing.filter((f) => /\.(woff2?|ttf|otf|eot)$/.test(f));
}

/**
 * The subpopulations this tool compares, as opposed to the ones it only prints.
 *
 * The "referenced but absent" / "on disk, never ref'd" pair is a genuine set
 * comparison -- the sheet's file refs against the fonts in the build -- and it can
 * go red, in either direction. It is NOT the same population as a
 * "0 unref'd fonts" audit over "font binaries": a file being a font binary does not
 * mean the sheet names it, so the two are separate claims and this file keeps only
 * the one it can falsify (see orphanReport's cases below).
 */
export function accountableFonts(listing) {
  return fontFilesIn(listing);
}

/**
 * The set an auditor declares about the current live sheet, graded rather than
 * remembered.
 *
 * `check-font-claims.mjs` holds literal expectations for the shipped bundle (13
 * blocks; 13 refs = 12 files + 1 data:; 13/13 swap; 0 absent; 0 orphans). As prose
 * those drift and nothing grades them; as an object, THE SAME assertions -- not a
 * restatement of them -- can grade a live report, and this file can prove those
 * assertions are able to fail. A sheet with ZERO faces is a failure of the
 * declaration, never a pass: `13 === 0` is false, which is the vacuous-truth guard
 * stated as code rather than as hope.
 */
export const CURRENT_BUNDLE = Object.freeze({
  blocks: 13,
  refs: 13,
  files: 12,
  data: 1,
  swap: 13,
  absent: 0,
  orphans: 0,
});

/** Findings for one sheet's tally against CURRENT_BUNDLE. Empty means the declaration held. */
export function bundleClaims(blocks, t, report) {
  const bad = [];
  const want = (label, got, expected) => {
    if (got === expected) return;
    bad.push(label + ': observed ' + got + ', declared ' + expected);
  };
  want('@font-face blocks', blocks.length, CURRENT_BUNDLE.blocks);
  want('src url() refs', t.urls.length, CURRENT_BUNDLE.refs);
  want('file refs', t.files.length, CURRENT_BUNDLE.files);
  want('inline data: URIs', t.data.length, CURRENT_BUNDLE.data);
  want('font-display: swap', t.swap, CURRENT_BUNDLE.swap);
  want('referenced but absent', report.missing.length, CURRENT_BUNDLE.absent);
  want('on disk, never referenced', report.orphans.length, CURRENT_BUNDLE.orphans);
  return bad;
}

/**
 * The freshness facts as a LOUD verdict, rather than a number a reader interprets.
 *
 * Written because the live report printed "0 commits that could change these numbers
 * since the build -- the artifact is current with HEAD" over an artifact that was
 * NOT current: its own section above listed stylesheets modified after the build.
 * ZERO commits is one way a build is stale -- the working tree held the edit -- and
 * the report read that zero as agreement. A clean zero and an unread measurement
 * must not print the same sentence.
 */
export function freshnessVerdict({ suspects = 0, unknownGit = 0, commits = 0, headKnown = true }) {
  if (!headKnown) {
    return "UNKNOWN: git could not be asked, so 'the artifact is current with HEAD' was never measured";
  }
  if (unknownGit > 0) {
    return 'UNKNOWN: ' + unknownGit + ' file(s) modified after the build and git could not say whether their bytes differ';
  }
  if (suspects > 0) {
    return 'STALE: ' + suspects + ' stylesheet(s) modified after the build -- rebuild before quoting these numbers';
  }
  if (commits > 0) {
    return 'STALE: ' + commits + ' commit(s) on the font surface since the build -- rebuild before quoting these numbers';
  }
  return 'CURRENT: 0 stylesheets newer than the build and 0 commits on the font surface since it';
}

/* ---------------------------------------------------------------------------
 * The report: readBuild refuses, renderReport prints, main wires them.
 * ------------------------------------------------------------------------- */

/**
 * Read one build directory. Throws -- never returns a clean-looking empty report --
 * when there is no assets directory, no asset file at all, or no stylesheet to read:
 * each of those is a pipeline nobody could read, not a build that contains nothing.
 * Throws carry exitCode 2, the code the tool has always used for that answer.
 *
 * THE TWO GUARDS BELOW ARE A CONJUNCTION, so neither can be killed on its own. That is
 * measured, not assumed: with an EMPTY assets directory the named set is still non-empty,
 * so the absent check reports the fonts as missing, and the .ttf/.eot refusal still fires
 * -- an "empty" build therefore exits 2 even with the empty-listing guard reverted. The
 * load-bearing half is the FILE-TYPE one: narrow the inventory back to .woff2/.woff and a
 * dropped .ttf orphan becomes invisible again, which is the mutation the self-test kills.
 * The empty-listing guard is kept because it describes the input truthfully; mutating or
 * removing it changes no observable answer, and the report says so rather than claiming a
 * kill it does not have.
 */
export function readBuild(dist, { repo = path.join(HERE, '..'), freshness = null } = {}) {
  const assets = path.join(dist, 'assets');
  const refuse = (what) => Object.assign(
    new Error(what + '\nRefusing to print zeros for a pipeline that was not read.'),
    { exitCode: ASSETS_MISSING },
  );
  if (!fs.existsSync(assets)) {
    throw refuse('no ' + assets + ' -- build first (cd ui && npm run build) or pass --dist <dir>.');
  }
  const listing = fs.readdirSync(assets);
  if (!listing.length) {
    throw refuse('no files in ' + assets + ' -- the build produced an empty asset directory.');
  }

  const sheets = listing.filter((f) => f.endsWith('.css'));
  if (!sheets.length) {
    throw refuse('no .css in ' + assets + ' -- nothing to compare a font set against.');
  }
  const withFaces = [];
  for (const f of sheets) {
    const text = fs.readFileSync(path.join(assets, f), 'utf-8');
    const blocks = faceBlocks(text);
    if (blocks.length) withFaces.push({ name: f, text, blocks });
  }

  const onDiskFonts = accountableFonts(listing);
  const tallies = withFaces.map((s) => {
    const tally = faceTally(s.blocks);
    const report = orphanReport(tally.distinct, onDiskFonts);
    return { name: s.name, text: s.text, blocks: s.blocks, tally, report };
  });

  const fontFiles = fontFilesIn(listing);
  const kb = (n) => Math.round((n / 1024) * 10) / 10;
  const bytesOf = (list) => list.reduce((a, f) => a + fs.statSync(path.join(assets, f)).size, 0);
  // bytesOf sums statSync sizes of BASENAMES joined to ASSETS; the gzip helper below
  // has to do the same join, because these lists are not paths.
  const gzOf = (list) => list.reduce((a, f) => a + gzipSync(fs.readFileSync(path.join(assets, f))).length, 0);
  const jsFiles = listing.filter((f) => f.endsWith('.js'));
  const cssFiles = listing.filter((f) => f.endsWith('.css'));

  const budget = {
    fontRaw: bytesOf(fontFiles), fontFiles: fontFiles.length,
    jsRaw: bytesOf(jsFiles), jsFiles: jsFiles.length,
    fontGz: gzOf(fontFiles), jsGz: gzOf(jsFiles), cssGz: gzOf(cssFiles), cssFiles: cssFiles.length,
  };

  // The freshness half. Every way of NOT knowing takes its own branch, because the
  // failure this replaces was a try/catch that swallowed the difference.
  const newestAsset = buildTimeOf(assets);
  const fresh = stylesheetsNewerThan(repo, 'ui/src', newestAsset);
  let commits = null;
  let headSha = null;
  try {
    const r = surfaceCommitsSince(repo, newestAsset);
    commits = r.rows.length;
    headSha = r.headSha;
  } catch {
    // The arithmetic above stands without git; the verdict below says it was not measured.
  }
  const verified = freshness || {
    ageHours: ageHours(newestAsset),
    stylesheetsNewerThan: fresh,
    ordered: fresh.suspects.filter((s) => s.dirty).concat(fresh.suspects.filter((s) => !s.dirty)),
    commits,
    headSha,
    verdict: freshnessVerdict({
      suspects: fresh.suspects.length,
      unknownGit: fresh.suspects.filter((s) => s.dirty === null).length,
      commits: commits ?? 0,
      headKnown: commits !== null,
    }),
  };

  return { dist, assets, sheets, withFaces, tallies, onDiskFonts, fontFiles, jsFiles, cssFiles, kb, budget, newestAsset, verified };
}
/** Every line the tool prints. Pure over `state`, so the self-test can render without a disk. */
export function renderReport(state) {
  const { assets, sheets, tallies, fontFiles, jsFiles, cssFiles, kb, budget, newestAsset, verified } = state;
  const out = [];
  const say = (s = '') => out.push(s);

  say('css sheets in the build: ' + sheets.length + '   carrying @font-face: ' + tallies.length);
  for (const s of tallies) {
    const t = s.tally;
    say('');
    say('  ' + s.name);
    say('    @font-face blocks      ' + s.blocks.length + '   (counted as occurrences; the file is minified onto ' + s.text.split('\n').length + ' line(s), so a line count would read 1)');
    say('    src url() refs         ' + t.urls.length + '  = ' + t.files.length + ' file refs + ' + t.data.length + ' inline data: URI(s)');
    say('    distinct font files    ' + t.distinct.length + '   ' + JSON.stringify(t.families));
    say('    font-display: swap     ' + t.swap + ' of ' + s.blocks.length);
    say('    referenced but absent  ' + s.report.missing.length + ' ' + (s.report.missing.length ? JSON.stringify(s.report.missing) : ''));
    say("    on disk, never ref'd   " + s.report.orphans.length + ' ' + (s.report.orphans.length ? JSON.stringify(s.report.orphans) : ''));
    // Defects no count above can show. Printed only when present, so the output of a
    // healthy build is unchanged by their arrival.
    const likely = woff2Likely(t.distinct);
    if (likely.length) say('    .woff where .woff2      ' + JSON.stringify(likely) + '  (a pass-through face, not a woff2 hit)');
    const remote = remoteHostRefs(t.distinct);
    if (remote.length) say('    remote HOST in a path  ' + JSON.stringify(remote) + "  (the CSP is font-src 'self' data:, so this cannot load)");
  }

  const share = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  say('');
  say('  budget');
  say('    font bytes in build    ' + kb(budget.fontRaw) + ' KB across ' + budget.fontFiles + ' files');
  say('    js bytes in build      ' + kb(budget.jsRaw) + ' KB across ' + budget.jsFiles + ' files');
  say('    fonts as share of js   ' + share(budget.fontRaw, budget.jsRaw) + ' % raw');
  say('');
  say('    the same payload in gzip -- the unit scripts/check-bundle.mjs budgets in');
  say('    fonts gzipped          ' + kb(budget.fontGz) + ' KB (' + share(budget.fontGz, budget.fontRaw) + ' % of raw: woff2 is already compressed)');
  say('    js gzipped             ' + kb(budget.jsGz) + ' KB (' + share(budget.jsGz, budget.jsRaw) + ' % of raw)');
  say('    css gzipped            ' + kb(budget.cssGz) + ' KB across ' + budget.cssFiles + ' files');
  say('    fonts as share of js   ' + share(budget.fontGz, budget.jsGz) + ' % gzip   <-- a budget speaks gzip, and that is '
    + (budget.jsRaw && budget.jsGz ? (budget.fontGz / budget.jsGz) / (budget.fontRaw / budget.jsRaw) : 0).toFixed(1) + 'x the raw figure printed above');
  say('');
  say('    Budget: scripts/check-bundle.mjs DOES price these bytes now -- a .woff2 line');
  say('    was added by `dd12da524`, so the gap this tool reported for several rounds is');
  say('    closed. Its own report prints the threshold it enforces; run it rather');
  say('    than trusting this sentence: `cd ui && node ../scripts/check-bundle.mjs`.');
  say('    Enforcement is now real, and moved twice in two rounds: `b89747b28` gave the');
  say('    local runner its tablet leg, and `d3ae1e201` added `Bundle budget (desktop)`');
  say('    and `Bundle budget (mobile)` steps to dev-ci.yml#ui-test -- the first CI steps');
  say('    to compile the UI at all. What still has no step is scripts/check.sh, whatever');
  say('    its header promises. One consequence worth knowing before a budget goes red:');
  say('    northflank-deploy lists ui-test in its `needs`, so a size breach now stops a');
  say('    production deploy. Re-derive with -i, because the steps are capitalised and a');
  say('    case-sensitive grep reads a present file as absent:');
  say("    `git grep -in 'bundle budget' scripts/check-ui.mjs scripts/check.sh .github/workflows/dev-ci.yml`.");
  say('');
  say('  subject: ' + assets + ' (gitignored; this is a build of whatever tree made it)');

  // A walker has no channel to the revision it is being asked about -- AGENTS.md says so
  // of every CSS suite in the repo, and this tool is not exempt: it graded a build four
  // hours old and printed nothing about it. The definition of "how current is this
  // artifact" lives in scripts/font-freshness.mjs, shared with the audit probe so the two
  // tools cannot answer that question differently.
  say('');
  say('  staleness');
  say('    build time (newest asset)  ' + new Date(newestAsset).toISOString() + '   ' + verified.ageHours + ' h before this run');
  say('    stylesheets newer than it  ' + verified.stylesheetsNewerThan.suspects.length + ' of ' + verified.stylesheetsNewerThan.total + ' under ui/src');
  if (verified.stylesheetsNewerThan.suspects.length && verified.stylesheetsNewerThan.gitAskable) {
    say('    These were last modified after the build, so the numbers above may not describe the');
    say('    tree you are reading them against: rebuild (cd ui && npm run build) before quoting');
    say('    them. Suspicion, not proof -- a checkout or a branch switch rewrites mtimes too, so');
    say('    each one is asked whether git thinks its bytes actually differ from HEAD:');
    // Dirty first: the display is a sample, and a sample that leads alphabetically can
    // spend all twelve slots on files that only have a moved mtime.
    for (const s of verified.ordered.slice(0, 12)) {
      const state = s.dirty ? 'DIRTY vs HEAD -- the build cannot contain this edit'
        : 'clean vs HEAD -- mtime moved, bytes did not';
      say('      ' + state.padEnd(46) + ' ' + s.rel);
    }
    if (verified.ordered.length > 12) say('      ... and ' + (verified.ordered.length - 12) + ' more (the count below covers all ' + verified.ordered.length + ', not just what is shown)');
    say('    of all ' + verified.stylesheetsNewerThan.suspects.length + ' suspects, ' + verified.stylesheetsNewerThan.dirtyCount + ' differ from HEAD; only those can make the build wrong rather than merely old.');
  } else if (verified.stylesheetsNewerThan.suspects.length) {
    say('    ' + verified.stylesheetsNewerThan.suspects.length + ' modified after the build, and git could not be asked whether they');
    say('    also differ in bytes. Reported as unaskable rather than as clean.');
  }
  // The sharper half: an entirely clean tree still moves under a build, because commits
  // land. "No file differs from HEAD" is not "the build matches HEAD". And the other
  // direction, measured: a DIRTY tree can be stale with ZERO commits -- so the verdict
  // is computed from both halves instead of reading a 0 as agreement.
  say('    commits that could change these numbers since the build: ' + (verified.commits ?? 'unaskable') + '   (HEAD ' + (verified.headSha ?? 'unaskable') + ')');
  say('    Filter: any .css under ui/src, the two boot documents, and ui/package.json -- defined');
  say('    once, in scripts/font-freshness.mjs, and shared with the audit probe.');
  say('    verdict: ' + verified.verdict);
  return out;
}

/** The whole tool, minus process plumbing: returns an exit code and the lines to print. */
export function main(argv = process.argv.slice(2), env = process.stdout) {
  if (argv.includes('--self-test')) return selfTest(env);
  const at = argv.indexOf('--dist');
  const dist = path.resolve(at === -1 ? path.join(HERE, '..', 'ui', 'dist') : argv[at + 1]);
  let state;
  try {
    state = readBuild(dist);
  } catch (e) {
    if (e && e.exitCode) {
      console.error(e.message);
      return e.exitCode;
    }
    throw e;
  }
  for (const line of renderReport(state)) env.write(line + '\n');
  return 0;
}

function selfTest(env = process.stdout) {
  let failures = 0;
  const rows = [];
  for (const [rule, name, fn] of SELF_TEST_CASES) {
    let ok = false;
    let detail = '';
    try {
      const r = fn();
      ok = r.ok;
      detail = r.detail;
    } catch (e) {
      ok = false;
      detail = 'threw: ' + (e && e.message ? e.message.split('\n')[0] : String(e));
    }
    if (!ok) failures++;
    rows.push({ rule, name, ok, detail });
  }
  env.write('\ncheck-font-bundle.mjs --self-test -- one case per rule the detector applies\n\n');
  let lastRule = '';
  for (const r of rows) {
    if (r.rule !== lastRule) {
      env.write('  [' + r.rule + ']\n');
      lastRule = r.rule;
    }
    env.write('   ' + (r.ok ? 'ok  ' : 'FAIL') + '  ' + r.name + '\n');
    env.write('            ' + r.detail + '\n');
  }
  env.write('\n  ' + (rows.length - failures) + '/' + rows.length + ' case row(s) passed\n');
  if (failures > 0) {
    env.write('SELF-TEST FAILED (' + failures + ' row(s))\n');
    return SELF_TEST_FAILED;
  }
  env.write('SELF-TEST OK (' + rows.length + ' rows, no build read)\n');
  return 0;
}
/* ---------------------------------------------------------------------------
 * SELF-TEST CASES
 *
 * A case is (rule, name, fn); fn returns { ok, detail }. Cases whose point is "this
 * input must make the tool LOUD" drive readBuild/main on a REAL temp fixture and
 * require a THROW or a nonzero exit -- a case that only asserted an empty COUNT
 * would commit the defect it is testing for.
 *
 * Fixtures are written under os.tmpdir(), never into the checkout: a stray ui/
 * directory under scripts/ would be picked up by every other walker in the tree.
 * No case reads ui/dist, so the self-test passes on a machine that has never built
 * the UI -- and, for the same reason, can never pass by accident on a real build.
 * ------------------------------------------------------------------------- */

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v13/x.woff2';

/** One minified @font-face, the way Vite emits it: a whole sheet can be ONE line. */
function face(file, displayed = 'swap') {
  return '@font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:' + displayed
    + ';src:url(' + FONT_URL + ') format("woff2"),url(' + file + ') format("woff2")}';
}

/** A face with no format() hint at all -- the pass-through shape. */
function bareFace(file) {
  return '@font-face{font-family:Old;font-display:swap;src:url(' + file + ')}';
}

function dataFace() {
  return '@font-face{font-family:Inter;font-display:swap;src:url(data:font/woff2;base64,AAA) format("woff2")}';
}

function tmpBuild(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-bundle-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(assets, name), body);
  return dir;
}

/** A freshness stub of the shape readBuild accepts, so no case needs a git repository. */
function freshness({ suspects = 0, dirty = 0, unknownGit = 0, commits = 0, headKnown = true } = {}) {
  return {
    ageHours: 1,
    stylesheetsNewerThan: {
      total: 9,
      suspects: Array.from({ length: suspects }, (_, i) => ({ rel: 'ui/src/s' + i + '.css', dirty: i < dirty })),
      dirtyCount: dirty,
      gitAskable: unknownGit === 0,
    },
    ordered: Array.from({ length: suspects }, (_, i) => ({ rel: 'ui/src/s' + i + '.css', dirty: i < dirty })),
    commits,
    headSha: headKnown ? 'abc1234' : null,
    verdict: freshnessVerdict({ suspects, unknownGit, commits, headKnown }),
  };
}

/** Run the WHOLE tool over a fixture directory and return its exit code. */
function buildExit(dir) {
  const written = [];
  const code = main(['--dist', dir], { write: (s) => written.push(s) });
  return { code, text: written.join('') };
}

const HEALTHY = {
  'index-abc.css': face('x.woff2') + face('x.woff2'),
  'x.woff2': 'woff2-bytes',
  'index-abc.js': 'console.log(1)',
};

/**
 * A synthetic bundle shaped like the live one: `files` faces naming distinct font files
 * plus `data` inline faces. ONE url() per face, so refs === blocks -- which is the
 * relation the live report prints ("13 = 12 files + 1 data:"), and the reason the
 * declared refs total equals its block count.
 */
function syntheticBundle(files, data = 0, swapFaces = files + data) {
  const blocks = [];
  for (let i = 0; i < files; i++) blocks.push(face('f' + i + '.woff2', i < swapFaces ? 'swap' : 'block').replace(/url\(https[^)]*\) format\("woff2"\),/, ''));
  for (let i = 0; i < data; i++) blocks.push(dataFace());
  const t = faceTally(blocks);
  return { blocks, t, report: orphanReport(t.distinct, t.distinct) };
}

export const SELF_TEST_CASES = [
  // ---- blocks: the unit is an OCCURRENCE, never a line ---------------------------
  ['blocks', 'two blocks on one minified line are two faces', () => {
    const n = faceBlocks(face('x.woff2') + face('y.woff2')).length;
    return { ok: n === 2, detail: n + ' block(s) in ONE line -- the header\'s first throwaway mistake' };
  }],
  ['blocks', 'a sheet with no face yields zero blocks (the unmatchable input)', () => {
    const n = faceBlocks('.a{color:red}').length;
    return { ok: n === 0, detail: n + ' block(s) -- pinned as a LOUD failure in the "vacuous" group below' };
  }],

  // ---- urls: what counts as a reference -----------------------------------------
  ['urls', 'every url() of a face is extracted', () => {
    const u = srcUrls(face('x.woff2'));
    return { ok: u.length === 2 && u[0] === FONT_URL, detail: JSON.stringify(u) };
  }],
  ['urls', 'an UNQUOTED url() ends at its closing paren', () => {
    const u = srcUrls('src:url(x.woff2) format("woff2")');
    return { ok: u.length === 1 && u[0] === 'x.woff2', detail: JSON.stringify(u) };
  }],
  // A literal-quote class instead of a character class (`[^'"\s]+`) is not a real
  // mutation: js is lazy, so it backtracks past the quote and returns the same hit
  // whenever a quote follows. It diverges only where NO quote follows, which upstream is
  // a malformed url. Pinned so "the paren terminates" is a stated contract rather than
  // an accident of quantifier ambiguity.
  ['urls', 'an unquoted url() with no quote after it still ends at the paren', () => {
    const u = srcUrls('src:url(x.woff2');
    return { ok: u.length === 1 && u[0] === 'x.woff2', detail: JSON.stringify(u) };
  }],
  ['urls', 'a url() outside any @font-face is not a face reference', () => {
    const t = faceTally(faceBlocks('.a{background:url(bg.png)}' + face('x.woff2') + '.b{background:url(o.png)}'));
    return { ok: t.urls.length === 2 && !t.files.includes('bg.png'), detail: 'files ' + JSON.stringify(t.files) };
  }],

  // ---- tally: the classification of each reference ------------------------------
  ['tally', 'a data: URI is counted as data:, never as a file', () => {
    const t = faceTally([dataFace()]);
    return { ok: t.data.length === 1 && t.files.length === 0 && t.distinct.length === 0,
      detail: t.files.length + ' file ref(s), ' + t.data.length + ' data: ref(s)' };
  }],
  ['tally', 'a path reference is reduced to its basename, and two spellings collapse to one distinct file', () => {
    // The second face names the same file by a DIFFERENT path, once absolute and once
    // relative: 3 refs (the third being the remote url()), 1 distinct file.
    const t = faceTally(faceBlocks(face('x.woff2') + '@font-face{font-family:I;font-display:swap;src:url(assets/x.woff2)}'));
    return { ok: t.files.length === 3 && t.distinct.length === 1 && t.distinct[0] === 'x.woff2',
      detail: t.files.length + ' refs -> ' + JSON.stringify(t.distinct) };
  }],
  ['tally', 'font-display: swap is matched; an omitted display is not', () => {
    const t = faceTally([face('x.woff2', 'swap'), face('x.woff2', 'block'), dataFace()]);
    return { ok: t.swap === 2, detail: t.swap + ' of 3 -- the live claim is 13 of 13' };
  }],
  ['tally', 'families are counted per face, from the font-family declaration', () => {
    const t = faceTally([face('x.woff2'), bareFace('y.woff')]);
    return { ok: t.families.Inter === 1 && t.families.Old === 1, detail: JSON.stringify(t.families) };
  }],

  // ---- set: the comparison, BOTH directions ------------------------------------
  ['set', 'a referenced file that is not on disk is reported absent', () => {
    const r = orphanReport(['x.woff2', 'gone.woff2'], ['x.woff2']);
    return { ok: r.missing.length === 1 && r.missing[0] === 'gone.woff2' && r.orphans.length === 0,
      detail: JSON.stringify(r) };
  }],
  ['set', 'a font on disk that nothing references is reported as an orphan', () => {
    const r = orphanReport(['x.woff2'], ['x.woff2', 'stray.woff2']);
    return { ok: r.orphans.length === 1 && r.orphans[0] === 'stray.woff2' && r.missing.length === 0,
      detail: JSON.stringify(r) };
  }],
  ['set', 'an .eot/.otf/.ttf in the build counts as a font, so its orphan is visible', () => {
    const r = orphanReport(['x.woff2'], ['x.woff2', 'legacy.ttf', 'legacy.eot', 'legacy.otf']);
    return { ok: r.orphans.length === 3, detail: 'orphans ' + JSON.stringify(r.orphans) + ' -- the disk population is every font binary' };
  }],
  ['set', 'agreeing sets report nothing in either direction', () => {
    const r = orphanReport(['a.woff2', 'b.woff2'], ['b.woff2', 'a.woff2']);
    return { ok: r.missing.length === 0 && r.orphans.length === 0, detail: JSON.stringify(r) };
  }],

  // ---- defective: predicates no count can see ----------------------------------
  ['defective', 'a .woff reference is named as a likely woff2 miss', () => {
    const got = woff2Likely(['x.woff', 'y.woff2']);
    return { ok: got.length === 1 && got[0] === 'x.woff', detail: JSON.stringify(got) };
  }],
  ['defective', 'a remote HOST embedded in a font path is named', () => {
    const got = remoteHostRefs(['fonts.gstatic.com-inter.woff2', 'inter.woff2']);
    return { ok: got.length === 1 && got[0].includes('gstatic'), detail: JSON.stringify(got) + " -- the CSP is font-src 'self' data:" };
  }],
  ['defective', 'a local font path is NOT reported as remote', () => {
    const got = remoteHostRefs(['inter-latin-400.woff2']);
    return { ok: got.length === 0, detail: JSON.stringify(got) };
  }],

  // ---- claims: the declaration check-font-claims.mjs types in by hand ----------
  // The numbers below are CURRENT_BUNDLE's own fields, so the case cannot drift from
  // the constant it pins; what it proves is that the ASSERTIONS accept a bundle of
  // exactly that shape -- which the live 13-face sheet is, per the report.
  ['claims', 'a bundle of exactly the declared shape produces no finding', () => {
    const { blocks, t, report } = syntheticBundle(CURRENT_BUNDLE.files, CURRENT_BUNDLE.data, CURRENT_BUNDLE.swap);
    const bad = bundleClaims(blocks, t, report);
    return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : blocks.length + ' blocks, ' + t.urls.length + ' refs = ' + t.files.length + ' files + ' + t.data.length + ' data: -- no finding' };
  }],
  ['claims', 'one block short of the declaration is a finding (no slack in the literal)', () => {
    const { blocks, t, report } = syntheticBundle(CURRENT_BUNDLE.files - 1, CURRENT_BUNDLE.data, CURRENT_BUNDLE.swap);
    const bad = bundleClaims(blocks, t, report);
    return { ok: bad.length > 0 && bad.some((b) => b.startsWith('@font-face blocks')), detail: bad.join('; ') };
  }],
  ['claims', 'a declaration of 13 graded against a sheet with ZERO faces is a finding', () => {
    const bad = bundleClaims([], faceTally([]), orphanReport([], []));
    return { ok: bad.length > 0, detail: bad.length + ' finding(s) -- 13 === 0 is false, which is the guard stated as code' };
  }],

  // ---- vacuous: an EMPTY input must be LOUD, never a clean zero ----------------
  ['vacuous', 'a build with NO assets directory exits 2', () => {
    const { code } = buildExit(fs.mkdtempSync(path.join(os.tmpdir(), 'font-bundle-none-')));
    return { ok: code === ASSETS_MISSING, detail: 'exit ' + code };
  }],
  ['vacuous', 'an EMPTY assets directory exits 2 instead of reporting 0 fonts across 0 files', () => {
    const { code } = buildExit(tmpBuild({}));
    return { ok: code === ASSETS_MISSING, detail: 'exit ' + code + ' -- 0 would be the vacuous pass' };
  }],
  ['vacuous', 'an assets directory with no stylesheet at all exits 2', () => {
    const { code } = buildExit(tmpBuild({ 'x.woff2': 'w', 'index.js': 'j' }));
    return { ok: code === ASSETS_MISSING, detail: 'exit ' + code };
  }],
  ['vacuous', 'a stylesheet declaring NO face prints 0 face-carrying sheets, and the declared bundle fails on it', () => {
    const state = readBuild(tmpBuild({ 'index.css': '.a{color:red}', 'index.js': 'j' }), { freshness: freshness() });
    const bad = bundleClaims([], faceTally([]), orphanReport([], state.onDiskFonts));
    return { ok: state.tallies.length === 0 && bad.length > 0,
      detail: state.tallies.length + ' face-carrying sheet(s), ' + bad.length + ' claim finding(s) -- zero faces FAILS the declaration' };
  }],

  // ---- live: a healthy build renders, and the comparison can PASS --------------
  ['live', 'a build whose sheet names the font it ships reports 0 absent and 0 orphans', () => {
    const state = readBuild(tmpBuild(HEALTHY), { freshness: freshness() });
    const s = state.tallies[0];
    const ok = state.tallies.length === 1 && s.report.missing.length === 0 && s.report.orphans.length === 0
      && s.tally.distinct.length === 1;
    return { ok, detail: 'missing ' + JSON.stringify(s.report.missing) + ', orphans ' + JSON.stringify(s.report.orphans) };
  }],
  // Every ref broken at once -- a renamed asset directory, a base path that moved. The
  // named set stays non-empty, so the ABSENT check is the only arm that can fire, and
  // the count is 2: a predicate that only inspects the shipped side cannot pass it.
  ['live', 'a build where EVERY referenced font is missing reports them all absent', () => {
    const state = readBuild(tmpBuild({ 'index.css': face('a.woff2') + face('b.woff2'), 'index.js': 'j' }), { freshness: freshness() });
    const s = state.tallies[0];
    // face() names the remote url() first, so the two local names are a.woff2 and b.woff2
    // (the third absent entry is the remote basename, correctly reported too).
    const both = ['a.woff2', 'b.woff2'].every((f) => s.report.missing.includes(f));
    return { ok: both && s.report.missing.length === 3 && s.report.orphans.length === 0, detail: JSON.stringify(s.report) };
  }],
  ['live', 'the SAME healthy build goes red when one font is deleted from it', () => {
    const files = { ...HEALTHY };
    delete files['x.woff2'];
    const state = readBuild(tmpBuild(files), { freshness: freshness() });
    const s = state.tallies[0];
    return { ok: s.report.missing.length === 1 && s.report.missing[0] === 'x.woff2', detail: JSON.stringify(s.report) };
  }],
  ['live', 'the SAME healthy build goes red when an unreferenced font is added to it', () => {
    const state = readBuild(tmpBuild({ ...HEALTHY, 'stray.woff2': 's' }), { freshness: freshness() });
    const s = state.tallies[0];
    return { ok: s.report.orphans.length === 1 && s.report.orphans[0] === 'stray.woff2', detail: JSON.stringify(s.report) };
  }],
  ['live', 'a sheet whose face points at an .woff is reported on the rendered line', () => {
    const state = readBuild(tmpBuild({ 'index.css': bareFace('old.woff'), 'old.woff': 'o', 'index.js': 'j' }), { freshness: freshness() });
    const text = renderReport(state).join('\n');
    return { ok: /woff where/.test(text) && /old\.woff/.test(text), detail: 'rendered line present: ' + /woff where[^\n]*/.exec(text)?.[0] };
  }],
  ['live', 'a healthy build renders no defect line', () => {
    const text = renderReport(readBuild(tmpBuild(HEALTHY), { freshness: freshness() })).join('\n');
    return { ok: !/woff where|remote HOST/.test(text), detail: 'quiet output for a healthy build -- both defect lines absent' };
  }],

  // ---- verdict: a zero must not read as agreement ------------------------------
  ['verdict', 'no suspects and no commits is CURRENT', () => {
    return { ok: freshnessVerdict({}) === 'CURRENT: 0 stylesheets newer than the build and 0 commits on the font surface since it', detail: freshnessVerdict({}) };
  }],
  ['verdict', 'ZERO commits with a stylesheet modified after the build is STALE, not current', () => {
    const v = freshnessVerdict({ suspects: 2 });
    return { ok: v.startsWith('STALE'), detail: v };
  }],
  ['verdict', 'commits on the font surface make it STALE even when every mtime is older', () => {
    const v = freshnessVerdict({ commits: 3 });
    return { ok: v.startsWith('STALE'), detail: v };
  }],
  ['verdict', 'git unable to answer is UNKNOWN, never CURRENT', () => {
    const a = freshnessVerdict({ headKnown: false });
    const b = freshnessVerdict({ suspects: 1, unknownGit: 1 });
    return { ok: a.startsWith('UNKNOWN') && b.startsWith('UNKNOWN'), detail: a + ' | ' + b };
  }],
  ['verdict', 'the rendered report carries the verdict line', () => {
    const text = renderReport(readBuild(tmpBuild(HEALTHY), { freshness: freshness({ suspects: 1, dirty: 1 }) })).join('\n');
    return { ok: /verdict: STALE/.test(text), detail: 'a dirty tree with 0 commits renders STALE, not "current with HEAD"' };
  }],
];
const invoked = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exit(main());