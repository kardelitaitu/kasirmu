#!/usr/bin/env node
/**
 * scripts/check-bundle.mjs — Enforce compressed bundle budgets (PERF-02).
 *
 * Runs `vite build` (unless --no-build) and then measures the produced
 * assets, failing with a non-zero exit code when a budget is exceeded.
 *
 * Budgets (all measured in gzip bytes to approximate wire cost):
 *   • entry JS  — the JS chunk referenced from index.html
 *   • total JS  — all .js chunks in dist/assets
 *   • CSS       — all .css files in dist/assets
 *   • max chunk — the largest single .js chunk (guards accidental
 *                 giant route chunks)
 *   • woff2     — all .woff2 files in dist/assets (the font surface;
 *                 this filter was previously blind to .woff2, so a
 *                 font payload could grow without anything failing)
 *
 * Usage:
 *   cd ui && node ../scripts/check-bundle.mjs          # build + check
 *   cd ui && node ../scripts/check-bundle.mjs --no-build  # check existing dist
 *   BUDGET_ENTRY_KB=600 node ../scripts/check-bundle.mjs   # override one budget
 *   node scripts/check-bundle.mjs --self-test          # prove the classifier can FAIL
 *
 * Add a `bundle:check` npm script and wire this into check-ui.mjs /
 * scripts/check.sh so every CI run enforces the budgets.
 *
 * WHY --self-test EXISTS
 * ======================
 * Every answer this gate gives is a COMPARISON (measured bytes vs a ceiling),
 * plus two "was there anything to compare" questions (did the assets directory
 * exist, did the entry chunk named by index.html exist among the measured JS).
 * A comparison that silently stops happening — a predicate that always returns
 * true, a measurement that degrades to 0 because the file vanished, a report
 * loop that iterates nothing — reports CLEAN, and CLEAN is exactly what a real
 * pass looks like. From the outside the two are identical, and no bare run of
 * the gate can tell them apart from the inside. The cases below pin the three
 * rules the verdict is made of:
 *
 *   R1  over budget FAILS, and a size EXACTLY AT budget passes (`<=` — see
 *       checkBudgets; the boundary direction is pinned by cases one byte apart
 *       on each side);
 *   R2  a measurement set with nothing in it is REFUSED (exit 1) even when every
 *       budget it would report is satisfied — the vacuous-pass class, where a
 *       build that produced nothing and a real clean pass printed the same line;
 *   R3  an expected chunk that is GONE is a REFUSED measurement rather than
 *       "0 bytes, under budget".
 *
 * Exit codes: 0 pass, 1 budget or measurement failure, 2 self-test failure.
 */

import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

/* ── ANSI helpers ───────────────────────────────────────────────────── */
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m';

// --self-test is a FLAG, not a path: argv is read positionally below for
// --config=/--outdir=, so it is peeled off here before anything reads a value.
const SELF_TEST = process.argv.slice(2).includes('--self-test');

/* ── Budgets (KB, gzip) — override via BUDGET_* env ─────────────────── */
const budgets = {
  entry: Number(process.env.BUDGET_ENTRY_KB ?? 500),     // entry JS gzip KB
  totalJs: Number(process.env.BUDGET_TOTAL_JS_KB ?? 3500), // all JS gzip KB
  css: Number(process.env.BUDGET_CSS_KB ?? 1000),          // all CSS gzip KB
  maxChunk: Number(process.env.BUDGET_MAX_CHUNK_KB ?? 600),// largest JS chunk
  woff2: Number(process.env.BUDGET_WOFF2_KB ?? 400),       // all woff2 gzip KB
};

/** gzip byte length of a file (or empty string). */
function gzipBytes(p) {
  return gzipSync(readFileSync(p)).length;
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0) + ' KB';
}

/* ══ Measurement ══════════════════════════════════════════════════════
 * Everything from here to the entry point is pure (or filesystem-only and
 * takes its paths as arguments), so --self-test drives the REAL classifier
 * against fixtures instead of a reimplementation of its rules. Each function
 * is the single copy of the rule it states; main() is the only caller that
 * reads the real dist/ tree. */

/** Partition asset names by extension: { js: [...], css: [...], woff2: [...] }. */
function classify(names) {
  return {
    js: names.filter((f) => f.endsWith('.js')),
    css: names.filter((f) => f.endsWith('.css')),
    woff2: names.filter((f) => f.endsWith('.woff2')),
  };
}

/**
 * The entry chunk: the .js file the page loads as a module.
 *
 * Returns { file } when the html names one, null when it names none. A name
 * that is NOT among the measured JS is deliberately NOT resolved here —
 * resolving it to 0 bytes is the silent-zero this gate has to refuse, so that
 * judgement belongs to pickEntry, which can see both sides.
 */
function entryFromHtml(html) {
  // "<script ... src=\"/assets/x.js\">". The leading slash is optional because
  // a build with a relative `base` writes "./assets/...".
  //
  // The script tag is part of the rule, not decoration. The original regex was
  // /src="\/assets\/([^"]+\.js)"/ over the WHOLE html, so a chunk named earlier
  // in the document — a <link rel="modulepreload" href="/assets/vendor.js">,
  // which vite emits for async imports — became the "entry" and the real entry
  // chunk went unpriced. Pinned by case R4c.
  const m = String(html ?? '').match(/<script[^>]*\bsrc="(?:\.?\/)?assets\/([^"]+\.js)"/);
  return m ? { file: m[1] } : null;
}

/**
 * Decide what the "entry JS" row means for a given produced-asset set.
 *
 *   resolved      — the html names a chunk that was measured; gzip is its size
 *   unmeasurable  — an expected chunk is GONE; the budget cannot be evaluated
 *   none-expected — no entry found and no html page to find one in, so nothing
 *                   was expected to be priced
 *
 * "No entry chunk" on its own is NEVER a pass — see pickEntry's html arm and
 * the checkBudgets contract.
 */
function pickEntry(entry, js, outDir) {
  if (entry) {
    const hit = js.find((s) => s.file === entry.file);
    return hit
      ? { kind: 'resolved', file: entry.file, gzip: hit.gzip }
      : { kind: 'unmeasurable', file: entry.file,
          reason: 'entry chunk ' + entry.file + ' is named by the html but was not produced' };
  }
  if (outDir && readdirSync(outDir).includes('index.html')) {
    // An index.html exists and names no chunk. Vite always rewrites <script src>
    // for the entry, so this is a broken build (or an outDir that is not a
    // build), not a bundle with a free entry. "0 KB / 500 KB ✔" here is the
    // exact vacuous pass this gate exists to prevent.
    return { kind: 'unmeasurable', file: '(none)',
             reason: 'index.html exists but names no /assets/*.js entry chunk' };
  }
  return { kind: 'none-expected', file: '(none)' };
}

/**
 * Fold one artifact class into a measurement result: a class with no files is a
 * READ FAILURE, not a size of zero.
 *
 * This is the woff2 bug's inverse, formalised. The original file priced woff2
 * bytes as a row that could never fail; the symmetric bug is a required class
 * whose files all vanished, summing to 0 and passing. `optional` is true for
 * woff2 alone, because a CSS-only build legitimately ships no webfonts.
 */
function measureSet(label, files, optional) {
  if (files.length === 0 && !optional) {
    return { kind: 'unmeasurable', file: '(no .' + label + ' assets)',
             reason: 'no .' + label + ' assets were produced' };
  }
  return { kind: 'measured', gzip: files.reduce((acc, s) => acc + s.gzip, 0), count: files.length };
}

function measureMax(label, files) {
  if (files.length === 0) {
    return { kind: 'unmeasurable', file: '(none)',
             reason: 'no .' + label + ' assets were produced, so there is no largest ' + label + ' chunk' };
  }
  return { kind: 'measured', gzip: files.reduce((acc, s) => Math.max(acc, s.gzip), 0), count: files.length };
}

/** The five budget rows, built only from measurements. budgets are in KB. */
function budgetRows(js, css, woff2, entryDecision) {
  const entry = entryDecision.kind === 'resolved'
    ? { kind: 'measured', gzip: entryDecision.gzip, count: 1 }
    : entryDecision;
  return [
    { label: 'entry JS',      result: entry,                            budget: budgets.entry },
    { label: 'total JS',      result: measureSet('js', js, false),      budget: budgets.totalJs },
    { label: 'CSS',           result: measureSet('css', css, false),    budget: budgets.css },
    { label: 'largest chunk', result: measureMax('js', js),             budget: budgets.maxChunk },
    { label: 'woff2',         result: measureSet('woff2', woff2, true), budget: budgets.woff2 },
  ];
}

/** The verdict: status is 'pass' | 'fail' | 'unmeasurable'. */
function checkBudgets(rows) {
  const passes = [];
  const failures = [];
  const unmeasurable = [];
  for (const row of rows) {
    // A row that could not be measured is NEVER compared. Comparing an absent
    // chunk as 0 bytes is how a vanished bundle reads as "0 KB, under budget".
    if (row.result.kind !== 'measured') {
      unmeasurable.push(row);
      continue;
    }
    if (!Number.isFinite(row.result.gzip)) {
      unmeasurable.push({ label: row.label, budget: row.budget,
        result: { kind: 'unmeasurable', reason: 'measured size is not a finite number' } });
      continue;
    }
    const actualKb = row.result.gzip / 1024;
    const over = actualKb - row.budget;
    // <= : a size EXACTLY AT budget is a PASS. Pinned by cases R1b/R1c.
    if (actualKb <= row.budget) passes.push({ ...row, actualKb, over });
    else failures.push({ ...row, actualKb, over });
  }
  // Order matters: an unmeasurable row is a REFUSAL, not a budget breach. A
  // build that produced nothing must not print "All bundle budgets satisfied",
  // and must not be reported as "you should optimise a chunk" either.
  if (unmeasurable.length > 0) return { status: 'unmeasurable', passes, failures, unmeasurable };
  if (failures.length > 0) return { status: 'fail', passes, failures, unmeasurable };
  if (passes.length === 0) {
    // The same class one level up: no rows at all is not a clean sheet.
    return { status: 'unmeasurable', passes, failures,
             unmeasurable: [{ label: '(any budget)',
               result: { kind: 'unmeasurable', reason: 'there were no budget rows to compare' } }] };
  }
  return { status: 'pass', passes, failures, unmeasurable };
}

/* ══ Self-test ════════════════════════════════════════════════════════
 * Cases drive checkBudgets / pickEntry / entryFromHtml / classify with
 * synthetic measurements, and gzipBytes against a scratch directory created
 * under os.tmpdir() and removed in a finally block (see R6; before 2026-11-06
 * the one function that turns a file into a number had no case). Nothing in
 * the repository is read or written, and the real budgets are injected so a
 * developer's BUDGET_* override cannot change what a case means.
 *
 * Fixture budgets are 100 / 300 / 600 / 600 / 400 KB, and every boundary case
 * lands exactly on one of them or one byte either side. */

const KB = 1024;

/** Run budgetRows with fixture budgets, restoring the real ones afterwards. */
function fixtureRows(set, b) {
  const saved = { ...budgets };
  Object.assign(budgets, b);
  try {
    return budgetRows(set.js ?? [], set.css ?? [], set.woff2 ?? [], set.entry);
  } finally {
    Object.assign(budgets, saved);
  }
}

function selfTest() {
  const problems = [];
  let count = 0;

  const want = (name, got, expected) => {
    count += 1;
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      problems.push(name + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(got));
    } else {
      console.log('  ok  ' + name);
    }
  };

  const b = { entry: 100, totalJs: 300, css: 600, maxChunk: 600, woff2: 400 };
  const asset = (file, gzip) => ({ file, gzip, raw: gzip });

  // A build whose every artifact is present and inside budget.
  const healthy = {
    js: [asset('index-aaa.js', 50 * KB), asset('vendor-bbb.js', 100 * KB)], // 150 KB total
    css: [asset('index-ccc.css', 30 * KB)],
    woff2: [asset('inter-latin-ddd.woff2', 20 * KB)],
    entry: { kind: 'resolved', file: 'index-aaa.js', gzip: 50 * KB },
  };
  // 'entry' stays in the set so every fixture prices an entry chunk unless the
  // case says otherwise — a fixture that silently omits the row would make
  // "passes" mean less than it looks.
  const rows = (set) => {
    // Spread first, then default — the other way round let a case that omits
    // `entry` silently inherit the healthy one.
    const full = { ...set };
    if (!('entry' in full)) full.entry = healthy.entry;
    return fixtureRows(full, b);
  };
  const verdict = (set) => checkBudgets(rows(set));

  // ── R1: the comparison ──────────────────────────────────────────────
  want('R1a every size under budget passes', verdict(healthy).status, 'pass');

  // The boundary direction. The code compares actual/1024 <= budget, so AT is a
  // PASS; both sides are pinned one byte apart so neither < nor > on the wrong
  // side can survive.
  want('R1b a size EXACTLY AT budget passes (<=, not <)',
    verdict({ ...healthy, js: [asset('index-aaa.js', 100 * KB)],
              entry: { kind: 'resolved', file: 'index-aaa.js', gzip: 100 * KB } }).status,
    'pass');

  const oneByteOver = { ...healthy,
    js: [asset('index-aaa.js', 100 * KB + 1)],
    entry: { kind: 'resolved', file: 'index-aaa.js', gzip: 100 * KB + 1 } };
  want('R1c one byte over budget fails', verdict(oneByteOver).status, 'fail');
  want('R1c the failure names the offending row',
    verdict(oneByteOver).failures.map((f) => f.label),
    ['entry JS']);

  want('R1d an over-budget TOTAL fails even when no single chunk is over',
    (() => { const v = verdict({ ...healthy,
      js: [asset('index-aaa.js', 50 * KB), asset('vendor-bbb.js', 251 * KB)] }); // 301 > 300
      return [v.status, v.failures.map((f) => f.label)]; })(),
    ['fail', ['total JS']]);

  want('R1e an over-budget CSS aggregate fails',
    verdict({ ...healthy, css: [asset('index-ccc.css', 400 * KB), asset('app-ddd.css', 201 * KB)] })
      .failures.map((f) => f.label),
    ['CSS']);

  want('R1f an over-budget woff2 aggregate fails (the row that used to only print)',
    verdict({ ...healthy, woff2: [asset('inter-latin-ddd.woff2', 20 * KB),
                                  asset('serif-latin-eee.woff2', 381 * KB)] }) // 401 > 400
      .failures.map((f) => f.label),
    ['woff2']);

  // ── R2: the vacuous-pass class ──────────────────────────────────────
  const bare = { js: [], css: [], woff2: [], entry: pickEntry(null, []) };
  want('R2a an empty JS set is REFUSED, not reported as 0 KB under budget',
    verdict(bare).status, 'unmeasurable');
  want('R2a an empty CSS set is REFUSED too',
    verdict({ ...bare, js: healthy.js, entry: healthy.entry }).status, 'unmeasurable');
  // The entry row on its own can never be the thing that saves a 0-file build:
  // an empty JS set makes the entry chunk unresolvable as well.
  want('R2a the refusal is a REFUSAL, not a pass (status carries it, unsat rows aside)',
    verdict(bare).status, 'unmeasurable');
  want('R2a an optimisable woff2 row cannot rescue an otherwise empty build',
    verdict({ js: [], css: [], woff2: healthy.woff2, entry: pickEntry(null, []) }).status,
    'unmeasurable');
  want('R2a the refusal names the class that produced nothing',
    // woff2 is legitimately optional, so four of the five rows are refused and
    // the woff2 row is the one thing a produced-nothing build can still "pass".
    // That single pass is exactly why R2a's neighbour case below matters: the
    // status, not the pass count, is what carries the refusal.
    verdict(bare).unmeasurable.map((r) => r.label).sort(),
    ['CSS', 'entry JS', 'largest chunk', 'total JS']);
  // A build with no webfonts is legitimate. Made explicit so the two rules
  // cannot be collapsed into one blanket "empty means broken".
  want('R2b a build with NO woff2 files is legitimate and passes',
    verdict({ ...healthy, woff2: [] }).status, 'pass');
  want('R2c no budget rows at all is REFUSED, not a clean sheet',
    checkBudgets([]).status, 'unmeasurable');
  want('R2d a NaN measurement is REFUSED, not treated as under budget',
    verdict({ ...healthy, css: [asset('index-ccc.css', NaN)] }).status, 'unmeasurable');

  // ── R3: a missing expected chunk ────────────────────────────────────
  want('R3a an entry chunk named by the html but not produced is UNMEASURABLE',
    pickEntry({ file: 'index-gone.js' }, healthy.js).kind, 'unmeasurable');
  want('R3a the refusal names the vanished chunk',
    pickEntry({ file: 'index-gone.js' }, healthy.js).file, 'index-gone.js');
  want('R3b a present entry chunk resolves to its measured gzip size',
    pickEntry({ file: 'index-aaa.js' }, healthy.js),
    { kind: 'resolved', file: 'index-aaa.js', gzip: 50 * KB });
  want('R3c no html entry at all is NONE-EXPECTED, never a resolved 0',
    pickEntry(null, healthy.js).kind, 'none-expected');
  // End to end: the vanished chunk must not read as "entry JS 0 KB / 100 KB ✔".
  want('R3d a vanished entry chunk blocks the whole verdict',
    verdict({ ...healthy, entry: pickEntry({ file: 'index-gone.js' }, healthy.js) }).status,
    'unmeasurable');
  want('R3e an entry chunk that was measured is priced, not skipped',
    verdict(healthy).passes.map((r) => r.label).includes('entry JS'), true);

  // ── R4: the html -> entry-chunk rule ────────────────────────────────
  want('R4a the vite module tag names the entry chunk',
    entryFromHtml('<script type="module" crossorigin src="/assets/index-aaa.js"></script>'),
    { file: 'index-aaa.js' });
  want('R4b a relative base is matched too',
    entryFromHtml('<script type="module" src="./assets/index-aaa.js"></script>'),
    { file: 'index-aaa.js' });
  // THE FIXTURE THAT MAKES THE <script> ANCHOR LOAD-BEARING, and the first version of
  // this case did not: with vite's own tag the preload link carries its url in `href=`,
  // and plain `/src="..."/` matches inside `href=` too, so an unanchored scan still
  // landed on the entry and this case stayed green under the mutation. MEASURED — a
  // `src=` preceded by a backslash cannot match at offset 26, so the fixture below puts
  // the preload's url where an unanchored scan reaches it FIRST and the anchored one
  // cannot: the unanchored scan answers "vendor-bbb.js", the anchored scan "index-aaa.js".
  want('R4c a preload carrying src= of its own is NOT mistaken for the entry',
    entryFromHtml('<link rel="modulepreload" src="/assets/vendor-bbb.js">'
      + '<script type="module" src="/assets/index-aaa.js"></script>'),
    { file: 'index-aaa.js' });
  // Vite's own spelling (href=), kept because it is what really ships.
  want('R4c vite\'s href= preload ahead of the entry tag still resolves to the entry',
    entryFromHtml('<link rel="modulepreload" href="/assets/vendor-bbb.js">'
      + '<script type="module" src="/assets/index-aaa.js"></script>'),
    { file: 'index-aaa.js' });
  want('R4e a preload alone (no entry tag) yields nothing, never a preloaded chunk',
    entryFromHtml('<link rel="modulepreload" src="/assets/vendor-bbb.js">'),
    null);
  // Vite's OWN output order is the other way round: the stylesheet and the entry are
  // linked first and the modulepreloads follow. Pinned so a scanner cannot be made
  // "correct" by an ordering that only this fixture happens to use.
  want('R4f the entry tag ahead of the preloads still resolves to the entry',
    entryFromHtml('<script type="module" crossorigin src="/assets/index-aaa.js"></script>'
      + '<link rel="modulepreload" crossorigin href="/assets/vendor-bbb.js">'),
    { file: 'index-aaa.js' });
  want('R4d an html naming no module chunk yields nothing',
    entryFromHtml('<html><body><div id="root"></div></body></html>'), null);

  // ── R5: the extension classifier ────────────────────────────────────
  want('R5a assets are partitioned by extension, case-sensitively',
    classify(['a.js', 'b.css', 'c.woff2', 'd.png', 'e.JS', 'f.js.map']),
    { js: ['a.js'], css: ['b.css'], woff2: ['c.woff2'] });

  // ── R6: the measurement itself ─────────────────────────────────────
  // gzipBytes() is where every number this gate compares comes from, and it had no
  // case: the sabotage sweep scored it SURVIVED on 2026-11-06. The dangerous mutation
  // is not a crash — `return 0` turns every row into "0 KB / budget ✔", the silent
  // zero this whole file exists to refuse. The scratch dir is created here and removed
  // in the finally block; nothing in the repository is touched.
  const scratch = mkdtempSync(join(tmpdir(), 'kasirmu-bundle-'));
  try {
    const smallPath = join(scratch, 'small.js');
    writeFileSync(smallPath, 'const a = 1;\n');
    const emptyPath = join(scratch, 'empty.js');
    writeFileSync(emptyPath, '');
    const bigPath = join(scratch, 'big.js');
    writeFileSync(bigPath, 'a'.repeat(100 * KB));

    const gSmall = gzipBytes(smallPath);
    want('R6a gzipBytes measures a real file (finite, positive)',
      Number.isFinite(gSmall) && gSmall > 0, true);
    want('R6b an EMPTY file is not 0 bytes (the silent-zero shape)',
      gzipBytes(emptyPath) > 0, true);
    want('R6c 100 KB of one byte compresses far below its raw size',
      gzipBytes(bigPath) < (100 * KB) / 10, true);
    want('R6d the same file measures the same twice', gzipBytes(smallPath) === gSmall, true);
    want('R6e a larger payload measures larger', gzipBytes(bigPath) > gSmall, true);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    for (const p of problems) console.error('  FAIL ' + p);
    console.error('SELF-TEST FAILED (' + problems.length + ' of ' + count + ' cases)');
    process.exit(2);
  }
  console.log('SELF-TEST OK (' + count + ' cases, one scratch dir removed)');
  process.exit(0);
}

/* ══ Entry point ══════════════════════════════════════════════════════ */

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, '..', 'ui');

if (SELF_TEST) {
  selfTest();
}

/* ── Args ───────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');
// Default outDir by config; allow explicit override via --outdir=, which is
// resolved against ui/ like the default so a caller never needs an absolute path.
const config = args.find((a) => a.startsWith('--config='))?.slice('--config='.length);
const outDirArg = args.find((a) => a.startsWith('--outdir='))?.slice('--outdir='.length);
const outDir = resolve(
  uiDir,
  outDirArg ?? (config?.includes('mobile') ? 'dist-mobile' : 'dist'),
);

process.chdir(uiDir);

/* ── Main ───────────────────────────────────────────────────────────── */
function main() {
  if (shouldBuild) {
    process.stdout.write(`  ${CYAN}▶${NC} vite build${config ? ` (${config})` : ''} ... `);
    try {
      execSync(`npx vite build${config ? ` --config ${config}` : ''}`, {
        stdio: 'pipe',
        timeout: 300_000,
      });
      console.log(`${GREEN}PASS${NC}`);
    } catch {
      console.log(`${RED}FAIL${NC}`);
      console.error(`\n${RED}── vite build failed ──${NC}`);
      try {
        execSync(`npx vite build${config ? ` --config ${config}` : ''}`, { stdio: 'inherit' });
      } catch {
        // already reported
      }
      process.exit(1);
    }
  }

  // ── Measure ─────────────────────────────────────────────────────────
  const assetsDir = join(outDir, 'assets');
  let files;
  try {
    files = readdirSync(assetsDir);
  } catch {
    console.error(`${RED}✘ No build output at ${assetsDir}${NC}`);
    console.error(`  Run "npm run build" first, or pass --no-build after a build.`);
    process.exit(1);
  }

  const { js: jsFiles, css: cssFiles, woff2: woff2Files } = classify(files);

  const sized = (f) => {
    const raw = statSync(join(assetsDir, f)).size;
    return { file: f, raw, gzip: gzipBytes(join(assetsDir, f)) };
  };
  const jsSizes = jsFiles.map(sized);
  const cssSizes = cssFiles.map(sized);
  const woff2Sizes = woff2Files.map(sized);

  // entry JS = referenced from the build output html. Vite preserves the
  // input html basename (index.html for desktop, index.mobile.html for the
  // tablet build), so pick the html that actually exists in outDir.
  let entryFile = '(none)';
  let entryFrom = null;
  try {
    const htmlCandidates = ['index.html', 'index.mobile.html'];
    const htmlName = htmlCandidates.find((n) =>
      readdirSync(outDir).includes(n),
    );
    if (htmlName) {
      const html = readFileSync(join(outDir, htmlName), 'utf8');
      entryFrom = entryFromHtml(html);
    }
  } catch {
    // no html in outDir — nothing to find an entry chunk in
  }
  const entryDecision = pickEntry(entryFrom, jsSizes, outDir);
  if (entryDecision.file) entryFile = entryDecision.file;

  const rows = budgetRows(jsSizes, cssSizes, woff2Sizes, entryDecision);

  // ── Report ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${CYAN}═══ Bundle Budget Report (gzip) ═══${NC}`);
  const verdict = checkBudgets(rows);
  for (const row of rows) {
    const measured = row.result.kind === 'measured';
    const ok = measured && row.result.gzip / 1024 <= row.budget;
    const icon = ok ? GREEN + '✔' + NC : RED + '✘' + NC;
    const shown = measured ? kb(row.result.gzip) : 'NOT MEASURED';
    const over = measured && !ok ? `  (${(row.result.gzip / 1024 - row.budget).toFixed(0)} KB over)` : '';
    console.log(`  ${icon} ${row.label.padEnd(16)} ${shown} / ${row.budget} KB budget${over}`);
  }

  // Top 8 chunks for visibility
  console.log(`\n  ${BOLD}Top chunks:${NC}`);
  [...jsSizes, ...cssSizes]
    .sort((a, b) => b.gzip - a.gzip)
    .slice(0, 8)
    .forEach((s, i) => {
      console.log(`    ${String(i + 1).padEnd(2)} ${kb(s.gzip).padEnd(8)} ${s.file}`);
    });

  console.log(`\n  entry file: ${entryFile}`);

  if (verdict.status === 'unmeasurable') {
    console.error(`\n${RED}${BOLD}✘ Bundle measurements are incomplete — refusing to report a budget verdict.${NC}`);
    for (const row of verdict.unmeasurable) {
      console.error(`    ${row.label}: ${row.result.reason ?? 'not measured'}`);
    }
    console.error('  A budget that could not be measured is not a budget that was met.\n');
    process.exit(1);
  }
  if (verdict.status === 'fail') {
    console.error(`\n${RED}${BOLD}✘ Bundle budget exceeded. Optimize or raise BUDGET_* .${NC}\n`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}✔ All bundle budgets satisfied${NC}\n`);
}

main();
