/**
 * Guards the tier-badge PNG export against silent upscaling.
 *
 * The bug this pins: `magick file.svg -resize 234x` rasterises the SVG at its
 * INTRINSIC size (the width/height attributes, 78x40) and then enlarges that
 * bitmap. The output file is still a valid 234x120 8-bit PNG, so every metadata
 * check passes while the glyphs are interpolated from a 1x render and look like
 * a small picture blown up. Only -density makes ImageMagick rasterise at the
 * target resolution.
 *
 * The tell is COLOUR COUNT. Antialiasing produces colour transitions along each
 * glyph edge, so a genuine 3x render has far more distinct colours than the 1x.
 * An upscale cannot invent them: interpolating a 340-colour image yields a
 * 340-colour image. These assertions compare the artifacts to each other, so
 * they hold whatever palette the badges currently use.
 *
 * Runs only when the generated PNGs are present, so a checkout without them
 * (or a run of the generator with -SvgOnly) skips rather than fails.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { describe, it, expect } from 'vitest';

/* ── Why this walks up instead of trusting process.cwd() ──────────────
 *
 * These paths used to read `path.resolve(process.cwd(), '../assets/…')`, which is
 * correct only when vitest runs with ui/ as the working directory. Run from the
 * repo root — `npx --prefix ui vitest run ui/src/__tests__/tierBadgePng.test.ts`,
 * an easy mistake that AGENTS.md §5.1 warns about without saying why — and it
 * resolves one level ABOVE the checkout:
 *     repo root -> C:\dev\assets\tier-badges\pngh      (does not exist)
 *     ui/       -> C:\dev\kasirmu\assets\tier-badges\png  (correct)
 * Every existsSync then returns false, BOTH skipIf() guards fire, and the suite
 * reports "21 skipped | exit 0" — a PASSING RUN THAT GRADED NOTHING. That is the
 * one failure mode a skip-guard cannot see, because a legitimate skip and this one
 * are the same shape.
 *
 * Measured 2026-10-07 across all nineteen suites under this directory that touch
 * process.cwd(): this was the ONLY one where a wrong cwd was silently green. The
 * rest either fail loudly (ENOENT, or vitest reporting "no tests") or are
 * cwd-robust (eodReportExportPermissionDrift walks up already; animationCompliance
 * uses cwd only to format a message). So the skip guard itself is not the defect —
 * it is doing what a skip guard does — but it makes a wrong cwd INVISIBLE here,
 * and that is what this walk removes.
 *
 * findRoot mirrors eodReportExportPermissionDrift.test.ts:53: walk up looking for
 * marker files that exist only in a checkout root, and THROW if none is found, so
 * an unresolvable root is a red rather than a skip. */
function findRepoRoot(marker: string): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, marker);
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the checkout root from ' + process.cwd());
}

const REPO_ROOT = findRepoRoot('assets/tier-badges/manifest.json');
const LOGO_DIR = path.join(REPO_ROOT, 'assets/tier-badges/logo');

const PNG_DIR = path.join(REPO_ROOT, 'assets/tier-badges/png');

/** Distinct-colour count, read from the PNG's own IHDR/IDAT-derived histogram.
 *  Parsed here rather than shelling out to ImageMagick: this test must not depend
 *  on a tool the CI image may not carry. */
/** The PNG IHDR colour type (2 = RGB, 3 = palette, 4 = grey+alpha, 6 = RGBA). */
function pngColourType(file: string): number {
  return fs.readFileSync(file).readUInt8(25);
}

function uniqueColours(file: string): number {
  const buf = fs.readFileSync(file);
  // Full decode is out of scope; inflate the IDAT and count distinct RGBA tuples
  // is not needed either. Vitest runs in node, so use the built-in zlib to
  // inflate, then walk the scanlines.
  let pos = 8; // skip signature
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colourType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  // Colour types: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA.
  // 0/4 are legitimate here — the MONOCHROME logos are single-ink artwork, and
  // ImageMagick emits them as grey+alpha (4). Rejecting those would fail on a
  // supported output.
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 4 ? 2 : colourType === 0 ? 1 : 0;
  // THROW rather than return a sentinel. A palette-mode PNG (colour type 3) is
  // exactly what the buggy exporter produced for @1x, and returning 0 for it
  // made the ratio Infinity — the test failed, but by accident and with a
  // message about ratios instead of about the real problem. Refusing to score
  // an image this helper cannot read is the honest answer: a palette PNG means
  // the export path changed and a human must look.
  if (channels === 0) {
    throw new Error(
      `${path.basename(file)} is PNG colour type ${colourType} (palette) — ` +
        'this helper cannot score it, and the exporter is not expected to emit it',
    );
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const seen = new Set<string>();
  const prev = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const line = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    // Undo the per-scanline filter, enough to compare pixels. Only 0/1/2/3/4
    // exist in PNG; 4 (Paeth) is what ImageMagick emits, so implement it.
    for (let i = 0; i < stride; i += 1) {
      // `?? 0` keeps these plain numbers under noUncheckedIndexedAccess; a
      // missing byte in a PNG scanline would be a decoder bug, and 0 is the
      // filter-neutral value, so the read stays total either way.
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= channels ? (prev[i - channels] ?? 0) : 0;
      let v = line[i] ?? 0;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < stride; x += channels) {
      // Normalise every colour type to one RGBA tuple so the counts are
      // comparable across RGB, RGBA, grey and grey+alpha exports.
      const r = line[x] ?? 0;
      const rgb =
        channels === 1
          ? `${r},${r},${r},255`
          : channels === 2
            ? `${r},${r},${r},${line[x + 1] ?? 0}`
            : `${r},${line[x + 1] ?? 0},${line[x + 2] ?? 0},${
                channels === 4 ? (line[x + 3] ?? 0) : 255
              }`;
      seen.add(rgb);
    }
    line.copy(prev);
  }
  return seen.size;
}



/**
 * The brand-logo PNGs share the tier badges' rasteriser, so they carry the same
 * upscaling risk and are guarded the same way. They differ in one respect: the
 * logo sources are TRANSPARENT vectors, so a correct export has an alpha channel
 * and a colour count dominated by edge blends rather than by a flat fill.
 */
const LOGOS = [
  'logo-icon',
  'logo-icon-mono',
  'logo-icon-text',
  'logo-icon-text-dark',
  'logo-icon-text-mono',
] as const;

const logosAvailable = LOGOS.every((k) =>
  fs.existsSync(path.join(LOGO_DIR, `${k}@1x.png`)),
);

describe.skipIf(!logosAvailable)('brand logo PNG exports', () => {
  it.each(LOGOS)('%s @3x is an exact 3x of its @1x', (key) => {
    const read = (suffix: string) => {
      const buf = fs.readFileSync(path.join(LOGO_DIR, `${key}${suffix}.png`));
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };
    const base = read('@1x');
    const three = read('@3x');
    // The vector is scaled by width, so the height carries a rounding remainder
    // of up to 1px per scale step. Allow exactly that, not more.
    expect(Math.abs(three.w - base.w * 3), `${key} width`).toBeLessThanOrEqual(1);
    expect(Math.abs(three.h - base.h * 3), `${key} height`).toBeLessThanOrEqual(1);
  });

  it.each(LOGOS)('%s 1x is antialiased, not a flat default-density render', (key) => {
    const colours = uniqueColours(path.join(LOGO_DIR, `${key}@1x.png`));
    // Measured floor for these transparent vector exports; an under-antialiased
    // default-density render scores far lower, the same failure the tier-badge
    // 1x check catches.
    expect(colours, `${key} 1x has only ${colours} colours`).toBeGreaterThan(24);
  });
});

const TIERS = ['free', 'plus', 'pro', 'premium', 'enterprise'] as const;
const available = TIERS.every((t) => fs.existsSync(path.join(PNG_DIR, `tier-${t}@1x.png`)))
  && fs.existsSync(path.join(PNG_DIR, 'tier-pro@3x.png'));

describe.skipIf(!available)('tier badge PNG exports are rendered per scale', () => {
  it.each(TIERS)('%s @1x is encoded truecolour, not palette', (tier) => {
    // THE ROOT SIGNAL, and the only one that proved reliable. When the exporter
    // resizes AFTER loading, the SVG is rasterised at its intrinsic size and
    // enlarged, and ImageMagick encodes that flat result as a PALETTE png —
    // colour type 3 — because it has few enough distinct colours to index. A
    // correct density render is truecolour, type 6.
    //
    // MEASURED across all five tiers: buggy @1x = type 3, correct @1x = type 6.
    // Categorical, so no threshold to tune and no false-negative margin.
    //
    // Why not a colour-count test: I tried two and both were unsound. 'Is 3x
    // richer than 1x?' passes the bug (621 vs 371). 'Is the 3x/1x ratio under
    // 2.5?' also passes when ONLY @3x is stale, because the 3x/2x ramps of the
    // two exporters are indistinguishable (corrupt 1.18-1.41, correct 1.31-1.41).
    // Colour count alone cannot separate them; the encoding can.
    const type = pngColourType(path.join(PNG_DIR, `tier-${tier}@1x.png`));
    expect(
      type,
      `${tier}@1x is PNG colour type ${type} (3 = palette) — the SVG was ` +
        'rasterised flat and enlarged rather than rendered at density',
    ).toBe(6);
  });

  it.each(TIERS)('%s @1x is antialiased, not a flat default-density render', (tier) => {
    // An independent floor, kept because it catches a flat render that ever
    // happens to encode as truecolour. A real render of these outlines gives
    // 340..627 distinct colours; the flat one gives 131 or fewer.
    const oneX = uniqueColours(path.join(PNG_DIR, `tier-${tier}@1x.png`));
    expect(oneX, `${tier} 1x has only ${oneX} colours — looks unantialiased`).toBeGreaterThan(300);
  });

  it('scales every artifact to an exact integer multiple of its 1x size', () => {
    for (const tier of TIERS) {
      const read = (suffix: string) => {
        const buf = fs.readFileSync(path.join(PNG_DIR, `tier-${tier}${suffix}.png`));
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      };
      const base = read('@1x');
      for (const scale of [2, 3] as const) {
        const scaled = read(`@${scale}x`);
        expect(scaled.w, `${tier}@${scale}x width`).toBe(base.w * scale);
        expect(scaled.h, `${tier}@${scale}x height`).toBe(base.h * scale);
      }
    }
  });
});
