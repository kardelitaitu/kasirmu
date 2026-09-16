#!/usr/bin/env node
/**
 * Font visual audit — the artifact todo-font-system.md's Phase 3 box asks for
 * ("before and after screenshots, and the bundle-budget check").
 *
 * Why a probe and not a spec: nothing here decides how the app SHOULD look. It
 * renders ONE built document twice -- once letting the woff2 files through, once
 * aborting every one of them -- and prints what changed on screen. Same HTML, same
 * CSS, same CSP, one variable, so the pair is causal rather than a comparison of two
 * revisions that differ in a hundred other ways. The judgement "is this the look we
 * want" belongs to a human looking at the two PNGs; this tool exists so that
 * judgement starts from two pictures and two sets of numbers instead of from a green
 * unit-test run, which is the mistake the plan was written after.
 *
 * What it measured: ui/dist as it sits on disk. That directory is gitignored, so it
 * is a build of whatever tree produced it -- the stylesheet hash is printed below so
 * any report using these numbers names its own subject instead of implying one.
 *
 * Usage:
 *   node e2e/font-visual-audit.mjs [--dist ui/dist] [--out <dir, default ui/font-audit/<shell>/>] [--keep-js] [--report]
 *
 * Vitest never collects e2e/** (see ui/vite.config.ts's test.exclude), and this is
 * deliberately not a *.spec.ts: it asserts nothing, so it can never go red, and a
 * tool that cannot fail is exactly as trustworthy as its printout. Read the printout.
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
// `node:os` was imported for os.tmpdir(), the first default output location; the import
// is gone with it, because ui/eslint.config.js declares globals for this file but an
// unused import is still an error, and `UI lint` in CI runs `eslint .` over e2e/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageHours, buildTimeOf, stylesheetsNewerThan, surfaceCommitsSince } from '../../scripts/font-freshness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);

// --report tees every line this tool prints and writes them into one self-contained HTML
// page beside the PNGs, with each image embedded as a data URI. The reason is specific: the
// numbers live in this stdout and the renderings live in ui/font-audit/, which is gitignored,
// so an owner who wants to rule on a visual question currently has to read a terminal scroll
// and open files one at a time. One file, opened in a browser, no Docker, no server.
// Installed here rather than at the bottom so the `artifacts ->` line is captured too.
const REPORT = argv.includes('--report');
const TEE = [];
if (REPORT) {
  const rawLog = console.log.bind(console);
  console.log = (...args) => {
    TEE.push(args.map((v) => (typeof v === 'string' ? v : String(v))).join(' '));
    rawLog(...args);
  };
}
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
// Script-relative, not cwd-relative: `node e2e/font-visual-audit.mjs` and
// `node ui/e2e/font-visual-audit.mjs` are the same command to a human and were not
// the same path here, which is the trap AGENTS.md tells every script to avoid.
const distArg = path.resolve(flag('dist', path.join(HERE, '..', 'dist')));

/**
 * Which boot document the artifact actually contains. The two shipped apps build to
 * different directories with different filenames -- desktop-client serves ui/dist with
 * index.html, tablet-client serves ui/dist-tablet with index.tablet.html -- so a probe
 * that hardcoded one could not measure the other, and until this block existed it did
 * not: every figure in this file's history came from the desktop artifact.
 */
const BOOT_DOCS = ['index.html', 'index.tablet.html'];
const SHELL_OF = { 'index.html': 'desktop-client', 'index.tablet.html': 'tablet-client' };
const presentDocs = BOOT_DOCS.filter((f) => fs.existsSync(path.join(distArg, f)));
const pageArg = flag('page', null);
if (pageArg && !presentDocs.includes(pageArg)) {
  console.error(`--page ${pageArg} is not in ${distArg} (found: ${presentDocs.join(', ') || 'nothing'})`);
  process.exit(2);
}
if (!presentDocs.length) {
  console.error(`no boot document in ${distArg} -- looked for ${BOOT_DOCS.join(', ')}.`);
  console.error('Build first: cd ui && npm run build (desktop) or npm run build:tablet (tablet).');
  console.error('Refusing to measure a directory that does not contain the thing under test.');
  process.exit(2);
}
const pageName = pageArg ?? presentDocs[0];
if (presentDocs.length > 1 && !pageArg) {
  console.log(`note: ${distArg} holds both boot documents; measuring ${presentDocs[0]}, pass --page to choose the other`);
}

// Output defaults to ui/font-audit/<shell>/ -- beside dist, never inside it. The first
// version defaulted to os.tmpdir(), which made the artifacts this plan's visual box
// depends on vanish on reboot; the second version wrote ui/dist/font-audit/, and a
// sentinel planted there was DELETED by `npm run build`, because Vite empties outDir.
// A review step whose evidence is destroyed by the command used to refresh it is not a
// review step, so the location is now neither of those: build-safe and gitignored.
const outDir = path.resolve(flag('out',
  path.join(HERE, '..', 'font-audit', SHELL_OF[pageName].replace('-client', ''))));
fs.mkdirSync(outDir, { recursive: true });
console.log(`artifacts -> ${outDir}`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};

/**
 * The CSP of the shell whose document is being measured, read from its config rather
 * than restated here, because font-src is one of the things under test and a copy of it
 * in a probe would be a claim about the shipped policy that could drift from it. The
 * shell is chosen from the boot document: the first version of this tool always read
 * desktop-client's config, so pointing --dist at the tablet artifact served the tablet
 * build under the desktop policy -- identical strings in this repo today, which is
 * exactly the situation in which a mis-aimed instrument stays unnoticed.
 */
function shellCsp(doc) {
  const shellName = SHELL_OF[doc] ?? 'desktop-client';
  const confPath = path.join(HERE, '..', '..', 'apps', shellName, 'tauri.conf.json');
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
  return { csp: conf?.app?.security?.csp ?? null, confPath, shellName };
}

function serve(root, csp, doc) {
  return new Promise((resolveReady, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(root, rel === '/' ? doc : rel);
      const abs = path.resolve(file);
      if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      const buf = fs.readFileSync(abs);
      const headers = {
        'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store',
      };
      if (csp) headers['content-security-policy'] = csp;
      res.writeHead(200, headers).end(buf);
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolveReady({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}

/**
 * The same measurement at every step of the app's OWN type scale, taken through
 * var() so the numbers come from the shipped tokens rather than from sizes typed
 * into this file. Height is reported alongside width on purpose: the leading tokens
 * are unitless multipliers, so if any height moves between the two runs, the claim
 * that bundling is a horizontal-only problem is wrong and this table is the proof.
 */
const SCALE_TOKENS = [
  '--text-2xs', '--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg',
  '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl', '--text-5xl', '--text-hero',
];
const SAMPLE = 'Total 1.234.567,89 Rp — Shift 12 Open #42';

async function bench(page) {
  return page.evaluate(({ tokens, sample }) => {
    const root = getComputedStyle(document.documentElement);
    const stack = root.getPropertyValue('--font-sans').trim();
    return tokens.map((t) => {
      const decl = root.getPropertyValue(t).trim();
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;';
      s.style.fontFamily = stack;
      s.style.fontSize = `var(${t})`;
      s.textContent = sample;
      document.body.appendChild(s);
      const r = s.getBoundingClientRect();
      s.remove();
      return {
        token: t,
        decl: decl || 'UNRESOLVED',
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      };
    });
  }, { tokens: SCALE_TOKENS, sample: SAMPLE });
}

function printBench(a, b) {
  console.log('\n--- the whole shipped type scale, same document, faces allowed vs blocked ---');
  console.log(`  sample: "${SAMPLE}"  (${SAMPLE.length} chars) in the --font-sans stack`);
  console.log('  token        decl       no-face px  with-face px     d px     d %   height');
  let widthSum = 0;
  let heightMoved = 0;
  for (let i = 0; i < a.length; i += 1) {
    const w = a[i];
    const n = b[i];
    const dp = Math.round((w.width - n.width) * 100) / 100;
    const pct = n.width ? Math.round((dp / n.width) * 10000) / 100 : 0;
    widthSum += pct;
    if (w.height !== n.height) heightMoved += 1;
    console.log(
      `  ${w.token.padEnd(12)} ${w.decl.padEnd(9)} ${String(n.width).padStart(9)}  ${String(w.width).padStart(11)}  ${String(dp).padStart(7)}  ${String(pct).padStart(6)}   ${w.height === n.height ? `${w.height} (unchanged)` : `${n.height} -> ${w.height} MOVED`}`,
    );
  }
  console.log(`\n  mean width change: ${(Math.round((widthSum / a.length) * 100) / 100)} %  |  heights that moved: ${heightMoved} of ${a.length}`);
  console.log('  the height column is the test of a claim, not a measurement of interest: unitless');
  console.log('  line-height tokens mean the vertical rhythm cannot depend on which face paints, and');
  console.log('  any row that says MOVED contradicts that and should be chased, not admired.');
}
/** What the page actually rendered with. No expectations, only observation. */
async function observe(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.app-splash__label')
      ?? document.querySelector('[class*="splash"]')
      ?? document.body;
    const cs = getComputedStyle(label);
    const measure = (family) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;font-size:64px;';
      s.style.fontFamily = family;
      s.textContent = 'OZ POS 0123 100,00 Rp Shift';
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return Math.round(w * 10000) / 10000;
    };
    const loaded = [];
    document.fonts.forEach((f) => {
      if (f.status === 'loaded') loaded.push(`${f.family}/${f.weight}/${f.style}`);
    });
    const r = label.getBoundingClientRect();
    return {
      element: label.className ? `.${String(label.className).split(' ')[0]}` : label.tagName.toLowerCase(),
      text: (label.textContent || '').trim().slice(0, 24),
      declaredStack: cs.fontFamily,
      usedFontSize: cs.fontSize,
      labelWidth: Math.round(r.width * 100) / 100,
      labelHeight: Math.round(r.height * 100) / 100,
      labelX: Math.round(r.x * 100) / 100,
      probeWidth: measure(cs.fontFamily),
      probeWidthSerif: measure('serif'),
      probeWidthMono: measure('monospace'),
      checkInter: document.fonts.check('64px "Inter Variable"'),
      checkMono: document.fonts.check('64px "JetBrains Mono Variable"'),
      loadedFaces: loaded.length,
      loadedSample: loaded.slice(0, 4),
    };
  });
}

/**
 * Force each bundled family to load, then report. `document.fonts.check()` on the boot
 * document reports the mono face as false in BOTH modes -- nothing in the splash asks
 * for its glyphs, which is exactly the lazy `unicode-range` behaviour rule 1 of this
 * plan exists to protect, and also means the mono half of the bundle (6 of 13 declared
 * face blocks) had no runtime witness anywhere in this file's history.
 *
 * `load()` is what separates "not needed here" from "cannot load", and the width against
 * a bogus-family baseline is what makes the answer checkable rather than a boolean: a
 * loaded real face differs from the fallback, a face that never arrived does not. The
 * website lane's own probe reported a healthy mono face as unresolved for exactly this
 * reason (recorded in the `:342` repair block), so this is a probe requirement, not a
 * nicety.
 */
async function forceLoad(page) {
  return page.evaluate(async () => {
    const FAMILIES = ['Inter Variable', 'JetBrains Mono Variable'];
    const measure = (family, text) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:64px;white-space:pre;font-family:' + family;
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return Math.round(w * 10000) / 10000;
    };
    const families = {};
    for (const fam of FAMILIES) {
      const spec = '64px "' + fam + '"';
      let resolved = -1;
      try {
        // The digits and the rupiah sign are the glyphs the app actually paints in mono
        // (totals, receipt numbers); a subset that excludes them would load and still be
        // wrong, so the load is asked for WITH the text.
        resolved = (await document.fonts.load(spec, '0123456789 Rp')).length;
      } catch (e) {
        families[fam] = { error: String(e) };
        continue;
      }
      families[fam] = { resolved, checkAfter: document.fonts.check(spec) };
    }
    const loaded = [];
    document.fonts.forEach((f) => { if (f.status === 'loaded') loaded.push(f.family); });
    const MONO_TEXT = '0123456789 Rp';
    return {
      families,
      monoWidth: measure('"JetBrains Mono Variable"', MONO_TEXT),
      monoWidthBogus: measure('"no-such-family-plant-xyz"', MONO_TEXT),
      monoText: MONO_TEXT,
      loadedFaces: new Set(loaded).size,
      loadedSample: [...new Set(loaded)].slice(0, 4),
    };
  });
}

/** The boot document's own linked stylesheets. Read at runtime because the filename is
 * content-hashed and changes with every build: a remembered carrier name is already wrong
 * once (this plan's notes carried `index-DxyJyJkO.css` while the tablet build now emits
 * `index-DxyXyJkO.css` -- caught by looking, not by recalling). */
function linkedStylesheets(docPath) {
  const html = fs.readFileSync(docPath, 'utf-8');
  const found = new Set();
  for (const re of [
    /<link\b[^>]*?rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']/gi,
    /<link\b[^>]*?href=["']([^"']+)["'][^>]*?rel=["']stylesheet["']/gi,
  ]) {
    let m;
    while ((m = re.exec(html))) found.add(m[1]);
  }
  return [...found].filter((h) => h.endsWith('.css'));
}

/**
 * Render text in the mono token using the artifact's real stylesheet, shoot it, and report
 * whether the bundled face actually painted. The sheet and the page CSS are both served
 * same-origin so the shell's CSP is honoured rather than defeated: under `style-src 'self'`
 * an inline `style=` attribute is dropped without an error anyone would see in a PNG, and a
 * probe that did not notice would print "the face never reached this page" about a page
 * whose instructions were never read. So the block count is part of the result.
 */
async function monoSheet(page, baseUrl, csp, mode, net) {
  const SHEET_CSS_URL = new URL('/__font-audit-mono-sheet.css', baseUrl).href;
  const SHEET_URL = new URL('/__font-audit-mono-sheet', baseUrl).href;
  const sheets = linkedStylesheets(path.join(distArg, pageName));

  const sheetCss = [
    '.mono { font-family: var(--font-mono); white-space: pre; }',
    '.sans { font-family: var(--font-sans); white-space: pre; }',
    ...SCALE_TOKENS.map((tk) => `.${tk.slice(2)} { font-size: var(${tk}); }`),
  ].join('\n');

  const sheetHtml = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    ...sheets.map((h) => `<link rel="stylesheet" href="${new URL(h, baseUrl).href}">`),
    `<link rel="stylesheet" href="${SHEET_CSS_URL}">`,
    '</head><body>',
    `<div class="mono">${SAMPLE}</div>`,
    `<div class="sans">${SAMPLE}</div>`,
    ...SCALE_TOKENS.map((tk) => `<div class="mono ${tk.slice(2)}">${tk} ${SAMPLE}</div>`),
    '</body></html>',
  ].join('\n');

  const blocked = [];
  page.on('console', (msg) => {
    const x = msg.text();
    if (/content security policy|refused to|blocked by/i.test(x)) blocked.push(x.slice(0, 160));
  });

  await page.route(SHEET_CSS_URL, (r) => r.fulfill({
    status: 200, contentType: 'text/css; charset=utf-8',
    headers: csp ? { 'content-security-policy': csp } : {}, body: sheetCss,
  }));
  await page.route(SHEET_URL, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    headers: csp ? { 'content-security-policy': csp } : {}, body: sheetHtml,
  }));

  const before = { count: net.count, bytes: net.bytes };
  await page.goto(SHEET_URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.catch(() => undefined));
  const m = await page.evaluate((sample) => {
    // Width of the sample under an explicit family. `cls` alone is NOT enough: an unknown
    // class inherits the body stack, which is how the first version of this measurement
    // produced a "baseline" that was really the sans line.
    const widthUnder = (family) => {
      const s = document.createElement('span');
      s.textContent = sample;
      s.style.whiteSpace = 'pre';
      if (family) s.style.fontFamily = family;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return Math.round(w * 10000) / 10000;
    };
    const cls = (name) => {
      const s = document.createElement('span');
      s.className = name;
      s.textContent = sample;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return Math.round(w * 10000) / 10000;
    };
    const stack = getComputedStyle(document.querySelector('.mono')).fontFamily;
    const parts = stack.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()).filter(Boolean);
    const first = parts[0] ?? '';
    const tail = parts.slice(1).join(', ');
    let loaded = 0;
    document.fonts.forEach((f) => {
      if (f.status === 'loaded' && first && f.family.replace(/^["']|["']$/g, '') === first.replace(/^["']|["']$/g, '')) loaded += 1;
    });
    // Attribute the tail render: measure each candidate on its own and keep the names that
    // produce exactly the width the whole tail produced. The browser resolves a stack to
    // the first installed member, so a tie means two members share metrics -- said as a
    // tie below rather than reported as a single confident name.
    const tailOnly = widthUnder(tail);
    const attrib = [];
    for (const fam of parts.slice(1)) {
      const bare = fam.replace(/^["']|["']$/g, '');
      attrib.push({ fam: bare, w: widthUnder(fam), generic: /^(ui-monospace|monospace|system-ui|sans-serif|serif)$/.test(bare) });
    }
    return {
      mono: cls('mono'),
      sans: cls('sans'),
      tailOnly,
      uaDefault: widthUnder(null),
      first,
      tail,
      loaded,
      matches: attrib.filter((a) => a.w === tailOnly).map((a) => a.fam),
      candidates: attrib.map((a) => `${a.fam}${a.generic ? '*' : ''}=${a.w}`).join(' '),
    };
  }, SAMPLE);
  const file = path.join(outDir, `mono-sheet-${mode}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const dCount = net.count - before.count;
  const dKb = Math.round(((net.bytes - before.bytes) / 1024) * 10) / 10;

  console.log('\n--- the mono token, rendered by the artifact\'s own stylesheet ---');
  console.log(`  document           ${SHEET_URL}`);
  console.log(`  sheets linked      ${sheets.join(', ') || 'NONE -- the boot document links no stylesheet'}`);
  console.log(`  CSP applied        ${csp ? 'yes (the same value the shell sends)' : 'no CSP on this shell -- this sheet is not testing the packaged path'}`);
  console.log(`  stack in use       ${m.first} , then ${m.tail}`);
  console.log(`  width of the line  bundled ${m.mono}   stack-minus-first ${m.tailOnly}   sans ${m.sans}   UA default ${m.uaDefault}`);
  const painting = m.loaded > 0 && m.mono !== m.tailOnly;
  if (!painting && m.matches.length) {
    console.log(`  painted by           ${m.matches.join(', ')}${m.matches.length > 1 ? ' (a tie: these share metrics, so the name is not certain)' : ''}`);
    console.log(`  per-family widths    ${m.candidates}`);
  }
  console.log(`  -> ${painting
    ? `the bundled face IS painting: ${m.loaded} loaded face(s) for ${m.first}, and removing it changes the width by ${Math.round(((m.mono - m.tailOnly) / m.tailOnly) * 10000) / 100} %`
    : m.loaded > 0
      ? `the bundled face is loaded but the width matches the stack-minus-first arm -- ${m.first} is metrically indistinguishable from the tail here, so this page cannot tell them apart`
      : `${m.first} did NOT load, so whatever painted this line came from the tail${m.tailOnly !== m.uaDefault ? ' -- and the tail differs from the UA default, meaning a LOCALLY INSTALLED family is what the eye sees' : ''}`}`);
  console.log(`  woff2 this page asked for, unprompted  +${dCount} request(s), +${dKb} KB`);
  console.log(`  CSP blocked ${blocked.length} message(s)${blocked.length ? ' -- the render is NOT what the tokens ask for:' : ''}`);
  for (const b of blocked.slice(0, 3)) console.log(`                     ${b}`);
  console.log(`  artifact           ${file}`);
  return { mono: m.mono, tailOnly: m.tailOnly, loaded: m.loaded, first: m.first, matches: m.matches, file, sheets: sheets.length, blocked: blocked.length };
}

function banner(title, o, net, force, bootNet) {
  console.log(`\n--- ${title} ---`);
  console.log(`  element              ${o.element}  "${o.text}"  font-size ${o.usedFontSize}`);
  console.log(`  declared stack       ${o.declaredStack}`);
  console.log(`  label box            ${o.labelWidth} x ${o.labelHeight} at x=${o.labelX}`);
  console.log(`  64px probe width     ${o.probeWidth}   (serif ${o.probeWidthSerif}, monospace ${o.probeWidthMono})`);
  console.log(`  fonts.check          Inter Variable=${o.checkInter}  JetBrains Mono Variable=${o.checkMono}`);
  console.log(`  faces loaded in page ${o.loadedFaces} ${JSON.stringify(o.loadedSample)}`);
  // Two things this line used to get wrong: it hardcoded the declared-face census (a
  // number that belongs to check-font-bundle.mjs, not to a print), and it asserted the
  // splash was the thing that painted -- false whenever the app was allowed to boot.
  const subject = /splash/i.test(o.element) ? 'the boot splash' : `a different element (${o.element})`;
  console.log(`  woff2 fetched unprompted (passive) ${bootNet.count} request(s), ${bootNet.kb} KB  <-- the lazy-loading claim: what ${subject} needed before anything forced it; the declared-face census is printed by \`node scripts/check-font-bundle.mjs\`, not duplicated here`);
  console.log(`  woff2 after forcing both families  ${net.count} request(s), ${net.kb} KB  (+${Math.round((net.bytes - bootNet.bytes) / 1024 * 10) / 10} KB pulled only because the probe asked)`);
  if (force) {
    const parts = Object.entries(force.families)
      .map(([fam, v]) => `${fam}: load()=${v.resolved ?? v.error} check=${v.checkAfter}`);
    console.log(`  forced load          ${parts.join('   |   ')}`);
    const differs = force.monoWidth !== force.monoWidthBogus;
    console.log(`                       mono "${force.monoText}" at 64px = ${force.monoWidth} against a bogus-family baseline of ${force.monoWidthBogus}`);
    console.log(`                       -> ${differs ? 'a real mono face is painting' : 'STILL THE FALLBACK: the mono face never rendered, and no boot screen would notice'}`);
    console.log(`                       families loaded after forcing: ${force.loadedFaces} ${JSON.stringify(force.loadedSample)}`);
  }
}

async function run() {
  const { csp, confPath, shellName } = shellCsp(pageName);
  const buildCmd = pageName === 'index.tablet.html' ? 'npm run build:tablet' : 'npm run build';
  const server = await serve(distArg, csp, pageName);
  console.log(`document      ${pageName} in ${distArg}  (the ${shellName} shell; build with: cd ui && ${buildCmd})`);
  console.log(`serving ${distArg} at ${server.url}`);
  console.log(`CSP from ${path.relative(path.join(HERE, '..', '..'), confPath).replace(/\\/g, '/')}: ${csp ? (csp.match(/font-src[^;]*/)?.[0] ?? 'no font-src clause') : 'none'}`);


  // Everything printed below is a measurement of an ARTIFACT, not of this checkout:
  // ui/dist is gitignored and carries no revision stamp, which is the AGENTS.md walker
  // caveat in its sharpest form. The age of the build is therefore part of the result,
  // stated once here rather than assumed by whoever reads the table.
  const repoRoot = path.join(HERE, '..', '..');
  const assetsDir = path.join(distArg, 'assets');
  try {
    const built = buildTimeOf(assetsDir);
    const { rows, headSha } = surfaceCommitsSince(repoRoot, built);
    console.log(`artifact      built ${new Date(built).toISOString()}  ${ageHours(built)} h before this run`);
    console.log(`              ${rows.length} commit(s) on the font surface since, HEAD ${headSha}`
      + (rows.length ? '  <-- STALE: rebuild before quoting these numbers as a property of HEAD'
        : '  <-- the artifact is current with HEAD'));
    for (const r of rows.slice(0, 3)) console.log(`                ${r.slice(0, 92)}`);
    if (rows.length > 3) console.log(`                ... and ${rows.length - 3} more`);
    const fresh = stylesheetsNewerThan(repoRoot, 'ui/src', built);
    if (fresh.gitAskable && fresh.dirtyCount) {
      console.log(`              ${fresh.dirtyCount} stylesheet(s) differ from HEAD right now and cannot be in this build:`);
      for (const s of fresh.suspects.filter((x) => x.dirty).slice(0, 4)) console.log(`                ${s.rel}`);
    }
  } catch (e) {
    console.log(`artifact      could not be dated (${e.message}) -- treat every number below as unanchored`);
  }


  const browser = await chromium.launch();
  const results = {};
  const sheetShots = {};
  for (const mode of ['with-fonts', 'no-fonts']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    const net = { count: 0, bytes: 0, kb: 0 };
    ctx.on('response', (r) => {
      const u = r.url();
      if (/\.woff2?(\?|$)/.test(u)) {
        net.count += 1;
        net.bytes += Number(r.headers()['content-length'] ?? 0);
        net.kb = Math.round((net.bytes / 1024) * 10) / 10;
      }
    });
    if (!argv.includes('--keep-js')) {
      // The boot splash is removed by the app on mount; this probe is about the
      // earliest painting the customer sees, so the document is frozen at that point.
      await ctx.route('**/*.js', (r) => r.abort());
    }
    if (mode === 'no-fonts') {
      await ctx.route('**/*.woff2', (r) => r.abort());
    }
    const page = await ctx.newPage();
    await page.goto(server.url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.catch(() => undefined));
    const o = await observe(page);
    // Snapshot BEFORE forcing: these are the bytes the boot paint asked for on its own,
    // which is the lazy-loading claim. The tally after forcing is a different question and
    // printing only it would quietly replace the first claim with a worse number.
    const bootNet = { count: net.count, bytes: net.bytes, kb: net.kb };
    const force = await forceLoad(page);
    const rows = await bench(page);
    // Name the file after the thing in it. With --keep-js the app boots, removes the
    // splash, and the measured element becomes `body`; writing `splash-*.png` over the
    // handover pair for that capture was the bug, not the fallback.
    const stem = /splash/i.test(o.element)
      ? 'splash'
      : (o.element.replace(/^[.#]/, '').split(/[^A-Za-z0-9_-]/)[0] || 'page').toLowerCase().slice(0, 24);
    if (stem !== 'splash') {
      console.log(`  note: no splash was on screen (measured element ${o.element}); the artifact is named for what WAS, so it cannot overwrite the splash pair`);
    }
    const shot = path.join(outDir, `${stem}-${mode}.png`);
    await page.screenshot({ path: shot });
    // Self-verification, because the lane running this may not be able to look at a
    // picture at all (this plan's author cannot: no image input). A full-window
    // screenshot of a splash is mostly background, so its size proves little; the
    // clip around the painted text is the part that must differ between the two runs
    // if the faces changed anything on screen. Bytes are reported, not judged.
    let clipBytes = 0;
    let clipSource = '';
    // An ordered list, because a CSS attribute selector cannot take a suffix: the
    // first attempt here was `[class*="splash"]__label`, which is not valid CSS and
    // made the whole selector list throw, so the self-check silently had nothing to
    // check. An unavailable proof is printed as unavailable, never as a pass.
    const candidates = ['.app-splash__label', '.app-splash', '[data-testid="boot-splash"]', '#boot-splash'];
    let clip = null;
    for (const sel of candidates) {
      try {
        clip = await page.locator(sel).first().boundingBox({ timeout: 1500 });
        if (clip) { clipSource = sel; break; }
      } catch { /* try the next candidate */ }
    }
    if (clip) {
      const buf = await page.screenshot({ clip: { x: clip.x - 4, y: clip.y - 4, width: clip.width + 8, height: clip.height + 8 } });
      clipBytes = buf.length;
      fs.writeFileSync(path.join(outDir, `label-${mode}.png`), buf);
    } else {
      clipBytes = -1;
    }
    sheetShots[mode] = await monoSheet(page, server.url, csp, mode, net);
    banner(mode === 'with-fonts' ? 'AFTER -- the bundled faces are allowed' : 'BEFORE -- every woff2 request aborted, so only the fallback tails remain', o, net, force, bootNet);
    console.log(`  screenshot           ${shot}`);
    console.log(`  text-clip bytes      ${clipBytes < 0 ? 'unavailable (no label box found)' : `${clipBytes} of ${clipSource}`}`);
    results[mode] = { ...o, net, clipBytes, bench: rows };
    await ctx.close();
  }

  const a = results['with-fonts'];
  const b = results['no-fonts'];
  const d = Math.round(((a.probeWidth - b.probeWidth) / b.probeWidth) * 10000) / 100;
  console.log('\n--- what the faces changed, on the identical document ---');
  console.log(`  64px probe width: ${b.probeWidth} without faces -> ${a.probeWidth} with them  (${d > 0 ? '+' : ''}${d}%)`);
  console.log(`  label box:        ${b.labelWidth}x${b.labelHeight} -> ${a.labelWidth}x${a.labelHeight} (dx=${Math.round((a.labelX - b.labelX) * 100) / 100})`);
  if (a.clipBytes >= 0 && b.clipBytes >= 0) {
    console.log(`  text-clip bytes:  ${b.clipBytes} without faces -> ${a.clipBytes} with them  ${a.clipBytes === b.clipBytes ? 'IDENTICAL byte-for-byte: same glyphs, so read the widths above before believing either' : 'differ: the label really is painted with different outlines'}`);
  } else {
    console.log('  text-clip bytes:  unavailable, so the pixel half of this report is unverified');
  }
  console.log(`  declared stack identical in both runs: ${a.declaredStack === b.declaredStack}`);
  printBench(a.bench, b.bench);
  const sm = sheetShots['with-fonts'];
  const sn = sheetShots['no-fonts'];
  console.log('\n--- the mono pair, side by side ---');
  console.log(`  with faces   ${sm.mono}   ${sm.file}`);
  console.log(`  no faces     ${sn.mono}   ${sn.file}`);
  console.log(`  bundled run:  ${sm.mono} px  (${sm.loaded} loaded face(s) for ${sm.first})`);
  console.log(`  aborted run:  ${sn.mono} px against a stack-minus-first arm of ${sn.tailOnly} px, ${sn.mono === sn.tailOnly ? 'equal, so the tail painted it' : 'different, so something else did'}${sn.loaded === 0 ? ` -- with 0 bundled faces loaded, that tail resolves to ${sn.matches.length ? sn.matches.join(' or ') : 'an unnamed installed family'}, which is the masking rule 15 exists to prevent` : ''}`);
  console.log(`  the two renders ${sm.mono === sn.mono ? 'are the same width, so the bundled face changed nothing visible on this page' : `differ by ${Math.round(((sm.mono - sn.mono) / sn.mono) * 10000) / 100} %`}`);
  console.log(`  CSP blocked ${sm.blocked} message(s) with faces, ${sn.blocked} without`);
  console.log('  CAVEAT: a token-level render built for this purpose, not a screen of the running');
  console.log('          app. It shows the bundled mono face at the shipped scale in the app\'s');
  console.log('          own stylesheet; it says nothing about layout, which is what a receipt is.');
  console.log('\nRead this as the bundle-budget half of the box too: the woff2 numbers above');
  console.log('are what a customer downloads before the first pixel of type is theirs.');
  console.log('\nWhat this tool cannot do: decide whether either rendering is the one the');
  console.log('design language wants. That is the owner ruling the same plan still holds open.');

  await browser.close();
  server.close();
}

run().then(() => {
  if (!REPORT) return;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const shots = fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort();
  const figures = shots.map((f) => {
    const full = path.join(outDir, f);
    const bytes = fs.statSync(full).size;
    const b64 = fs.readFileSync(full).toString('base64');
    return `<figure><img alt="${esc(f)}" src="data:image/png;base64,${b64}">`
      + `<figcaption><b>${esc(f)}</b> &middot; ${(bytes / 1024).toFixed(1)} KB &middot; `
      + `written ${esc(fs.statSync(full).mtime.toISOString())}</figcaption></figure>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>font visual audit -- ${esc(path.basename(outDir))}</title>
<style>
 body{font:14px/1.5 system-ui;margin:2rem auto;max-width:1100px;padding:0 1rem;background:#111;color:#ddd}
 pre{background:#1b1b1b;padding:1rem;overflow:auto;border-radius:6px;font-size:12.5px;white-space:pre-wrap}
 figure{margin:1.4rem 0} img{max-width:100%;border:1px solid #444;background:#fff}
 figcaption{color:#9a9;font-size:12px;margin-top:.3rem}
 h1{font-size:1.25rem} h2{font-size:1rem;margin-top:2rem;color:#9cf}
</style>
<h1>font visual audit -- ${esc(path.basename(outDir))}</h1>
<p>Generated ${esc(new Date().toISOString())} from <code>${esc(outDir)}</code> by
<code>node e2e/font-visual-audit.mjs ${esc(argv.join(' '))}</code>. The PNGs are embedded, so this
one file is the whole review -- nothing here needs a server, a browser session, or Docker.
The transcript is the tool's own stdout, unedited.</p>
<h2>What the tool measured</h2>
<pre>${esc(TEE.join('\n'))}</pre>
<h2>The renderings (${shots.length})</h2>
${figures}
`;
  const file = path.join(outDir, 'report.html');
  fs.writeFileSync(file, html);
  const rawLog = (m) => process.stdout.write(m + '\n');
  rawLog(`\nreport           ${file}  (${(html.length / 1024).toFixed(0)} KB, ${shots.length} images embedded)`);
  rawLog('                 open this one file to review the numbers and both renderings together.');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
