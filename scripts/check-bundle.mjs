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
 *
 * Add a `bundle:check` npm script and wire this into check-ui.mjs /
 * scripts/check.sh so every CI run enforces the budgets.
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, '..', 'ui');
process.chdir(uiDir);

/* ── ANSI helpers ───────────────────────────────────────────────────── */
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m';

/* ── Budgets (KB, gzip) — override via BUDGET_* env ─────────────────── */
const budgets = {
  entry: Number(process.env.BUDGET_ENTRY_KB ?? 500),     // entry JS gzip KB
  totalJs: Number(process.env.BUDGET_TOTAL_JS_KB ?? 3500), // all JS gzip KB
  css: Number(process.env.BUDGET_CSS_KB ?? 1000),          // all CSS gzip KB
  maxChunk: Number(process.env.BUDGET_MAX_CHUNK_KB ?? 600),// largest JS chunk
  woff2: Number(process.env.BUDGET_WOFF2_KB ?? 400),       // all woff2 gzip KB
};

/* ── Args ───────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');
const config = args.find((a) => a.startsWith('--config='))?.slice('--config='.length);  // Default outDir by config; allow explicit override via --outdir=.
  const outDirArg = args.find((a) => a.startsWith('--outdir='))?.slice('--outdir='.length);
  const outDir = resolve(
    uiDir,
    outDirArg ?? (config?.includes('tablet') ? 'dist-tablet' : 'dist'),
  );

/** gzip byte length of a file (or empty string). */
function gzipBytes(p) {
  return gzipSync(readFileSync(p)).length;
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0) + ' KB';
}

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

  const jsFiles = files.filter((f) => f.endsWith('.js'));
  const cssFiles = files.filter((f) => f.endsWith('.css'));

  const jsSizes = jsFiles.map((f) => {
    const raw = statSync(join(assetsDir, f)).size;
    return { file: f, raw, gzip: gzipBytes(join(assetsDir, f)) };
  });
  const cssSizes = cssFiles.map((f) => {
    const raw = statSync(join(assetsDir, f)).size;
    return { file: f, raw, gzip: gzipBytes(join(assetsDir, f)) };
  });
  const woff2Files = files.filter((f) => f.endsWith('.woff2'));
  const woff2Sizes = woff2Files.map((f) => {
    const raw = statSync(join(assetsDir, f)).size;
    return { file: f, raw, gzip: gzipBytes(join(assetsDir, f)) };
  });

  // entry JS = referenced from the build output html. Vite preserves the
  // input html basename (index.html for desktop, index.tablet.html for the
  // tablet build), so pick the html that actually exists in outDir.
  let entryGzip = 0;
  let entryFile = '(none)';
  try {
    const htmlCandidates = ['index.html', 'index.tablet.html'];
    const htmlName = htmlCandidates.find((n) =>
      readdirSync(outDir).includes(n),
    );
    if (htmlName) {
      const html = readFileSync(join(outDir, htmlName), 'utf8');
      const m = html.match(/src="\/assets\/([^"]+\.js)"/);
      if (m) {
        entryFile = m[1];
        const hit = jsSizes.find((s) => s.file === entryFile);
        entryGzip = hit?.gzip ?? 0;
      }
    }
  } catch {
    // no html in outDir — fall back to the largest chunk
  }

  const totalJsGzip = jsSizes.reduce((acc, s) => acc + s.gzip, 0);
  const totalCssGzip = cssSizes.reduce((acc, s) => acc + s.gzip, 0);
  const totalWoff2Gzip = woff2Sizes.reduce((acc, s) => acc + s.gzip, 0);
  const maxChunk = jsSizes.reduce((acc, s) => Math.max(acc, s.gzip), 0);

  // ── Report ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${CYAN}═══ Bundle Budget Report (gzip) ═══${NC}`);
  const rows = [
    ['entry JS', entryGzip, budgets.entry],
    ['total JS', totalJsGzip, budgets.totalJs],
    ['CSS', totalCssGzip, budgets.css],
    ['largest chunk', maxChunk, budgets.maxChunk],
    ['woff2', totalWoff2Gzip, budgets.woff2],
  ];

  let failures = 0;
  for (const [label, actual, budget] of rows) {
    const ok = actual / 1024 <= budget;
    if (!ok) failures += 1;
    const icon = ok ? GREEN + '✔' + NC : RED + '✘' + NC;
    const over = ok ? '' : `  (${(actual / 1024 - budget).toFixed(0)} KB over)`;
    console.log(`  ${icon} ${label.padEnd(16)} ${kb(actual)} / ${budget} KB budget${over}`);
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

  if (failures > 0) {
    console.error(`\n${RED}${BOLD}✘ Bundle budget exceeded. Optimize or raise BUDGET_* .${NC}\n`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}✔ All bundle budgets satisfied${NC}\n`);
}

main();
