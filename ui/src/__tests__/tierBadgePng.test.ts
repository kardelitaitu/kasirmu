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

const PNG_DIR = path.resolve(process.cwd(), '../assets/tier-badges/png');

/** Distinct-colour count, read from the PNG's own IHDR/IDAT-derived histogram.
 *  Parsed here rather than shelling out to ImageMagick: this test must not depend
 *  on a tool the CI image may not carry. */
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
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  // THROW rather than return a sentinel. A palette-mode PNG (colour type 3) is
  // exactly what the buggy exporter produced for @1x, and returning 0 for it
  // made the ratio Infinity — the test failed, but by accident and with a
  // message about ratios instead of about the real problem. Refusing to score
  // an image this helper cannot read is the honest answer; the generator is
  // pinned to RGBA (ImageMagick emits colour type 6 with -depth 8 here), so a
  // palette PNG means the export path changed and a human must look.
  if (channels === 0) {
    throw new Error(
      `${path.basename(file)} is PNG colour type ${colourType}, not truecolour — ` +
        'this helper cannot score it, and the exporter is expected to emit RGBA',
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
      const rgb = `${line[x] ?? 0},${line[x + 1] ?? 0},${line[x + 2] ?? 0},${
        channels === 4 ? (line[x + 3] ?? 0) : 255
      }`;
      seen.add(rgb);
    }
    line.copy(prev);
  }
  return seen.size;
}

const TIERS = ['free', 'plus', 'pro', 'premium', 'enterprise'] as const;
const available = TIERS.every((t) => fs.existsSync(path.join(PNG_DIR, `tier-${t}@1x.png`)))
  && fs.existsSync(path.join(PNG_DIR, 'tier-pro@3x.png'));

describe.skipIf(!available)('tier badge PNG exports are rendered per scale', () => {
  it.each(TIERS)('%s renders each scale independently (colour ramp stays flat)', (tier) => {
    // MEASURED, then chosen. The two exporters differ in how the colour count
    // grows from 1x to 3x, because each rasterises at a different density:
    //
    //   upscaling (the bug)  3x/1x = 3.69 .. 6.43   (1x is under-antialiased,
    //                                               so enlarging it invents
    //                                               many new blended colours)
    //   density render (fix) 3x/1x = 1.76 .. 2.09   (all three scales are
    //                                               antialiased properly, so
    //                                               the ramp is gentle)
    //
    // 2.5 sits in the gap with ~20% margin on each side. A one-sided
    // 'is 3x richer than 1x?' check does NOT work: the buggy export passes it
    // (621 colours against 371), which is how the first version of this test
    // let the bug through.
    const oneX = uniqueColours(path.join(PNG_DIR, `tier-${tier}@1x.png`));
    const threeX = uniqueColours(path.join(PNG_DIR, `tier-${tier}@3x.png`));
    const ratio = threeX / oneX;
    expect(
      ratio,
      `${tier}: 3x/1x colour ratio ${ratio.toFixed(2)} (1x=${oneX}, 3x=${threeX}) — ` +
        'above 2.5 means the 3x was upscaled from a low-density 1x render',
    ).toBeLessThan(2.5);
  });

  it.each(TIERS)('%s 1x is antialiased, not a flat default-density render', (tier) => {
    // The buggy 1x comes out with 98..203 distinct colours because ImageMagick
    // rasterised it flat; a real render of these outlines gives 340..627. 300
    // separates the two populations with margin on both sides.
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
