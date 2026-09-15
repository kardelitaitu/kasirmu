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
 *   node e2e/font-visual-audit.mjs [--dist ui/dist] [--out <dir>] [--keep-js]
 *
 * Vitest never collects e2e/** (see ui/vite.config.ts's test.exclude), and this is
 * deliberately not a *.spec.ts: it asserts nothing, so it can never go red, and a
 * tool that cannot fail is exactly as trustworthy as its printout. Read the printout.
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
// Script-relative, not cwd-relative: `node e2e/font-visual-audit.mjs` and
// `node ui/e2e/font-visual-audit.mjs` are the same command to a human and were not
// the same path here, which is the trap AGENTS.md tells every script to avoid.
const distArg = path.resolve(flag('dist', path.join(HERE, '..', 'dist')));
const outDir = path.resolve(flag('out', path.join(os.tmpdir(), 'ozpos-font-audit')));
fs.mkdirSync(outDir, { recursive: true });

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
 * The desktop shell's own CSP, read from its config rather than restated here,
 * because font-src is one of the things under test and a copy of it in a probe would
 * be a claim about the shipped policy that could drift from it.
 */
function shellCsp() {
  const confPath = path.join(HERE, '..', '..', 'apps', 'desktop-client', 'tauri.conf.json');
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
  return conf?.app?.security?.csp ?? null;
}

function serve(root, csp) {
  return new Promise((resolveReady, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(root, rel === '/' ? 'index.html' : rel);
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

function banner(title, o, net) {
  console.log(`\n--- ${title} ---`);
  console.log(`  element              ${o.element}  "${o.text}"  font-size ${o.usedFontSize}`);
  console.log(`  declared stack       ${o.declaredStack}`);
  console.log(`  label box            ${o.labelWidth} x ${o.labelHeight} at x=${o.labelX}`);
  console.log(`  64px probe width     ${o.probeWidth}   (serif ${o.probeWidthSerif}, monospace ${o.probeWidthMono})`);
  console.log(`  fonts.check          Inter Variable=${o.checkInter}  JetBrains Mono Variable=${o.checkMono}`);
  console.log(`  faces loaded in page ${o.loadedFaces} ${JSON.stringify(o.loadedSample)}`);
  console.log(`  woff2 over network   ${net.count} request(s), ${net.kb} KB`);
}

async function run() {
  if (!fs.existsSync(path.join(distArg, 'index.html'))) {
    console.error(`no ui/dist/index.html at ${distArg} -- build first (cd ui && npm run build), or pass --dist <dir>`);
    process.exit(2);
  }
  const csp = shellCsp();
  const server = await serve(distArg, csp);
  console.log(`serving ${distArg} at ${server.url}`);
  console.log(`CSP from apps/desktop-client/tauri.conf.json: ${csp ? (csp.match(/font-src[^;]*/)?.[0] ?? 'no font-src clause') : 'none'}`);

  const browser = await chromium.launch();
  const results = {};
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
    const rows = await bench(page);
    const shot = path.join(outDir, `splash-${mode}.png`);
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
    banner(mode === 'with-fonts' ? 'AFTER -- the bundled faces are allowed' : 'BEFORE -- every woff2 request aborted, so only the fallback tails remain', o, net);
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
  console.log('\nRead this as the bundle-budget half of the box too: the woff2 numbers above');
  console.log('are what a customer downloads before the first pixel of type is theirs.');
  console.log('\nWhat this tool cannot do: decide whether either rendering is the one the');
  console.log('design language wants. That is the owner ruling the same plan still holds open.');

  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
