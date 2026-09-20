#!/usr/bin/env node
/**
 * android-screen.mjs — look at an Android device screen from a terminal.
 *
 * `adb exec-out screencap -p` hands back a PNG, which a text-only agent
 * cannot read. This decodes that PNG with nothing but Node's built-in
 * `zlib` and prints three things a terminal can carry:
 *
 *   1. the frame size and the colours that actually cover it (with a
 *      percentage each), which is how a blank or white-screened WebView
 *      is told apart from a painted one;
 *   2. a character grid sampled from the frame, where each cell is the
 *      glyph of its nearest palette colour (dark → light: `@%#*+=-:.`),
 *      which carries layout — header bars, panels, empty regions;
 *   3. optional `--probe x,y` pixel readouts, for "is that button the
 *      brand colour" style questions.
 *
 * Usage (from the repo root):
 *
 *   node scripts/android-screen.mjs                       # live capture, 96 cols
 *   node scripts/android-screen.mjs --cols 120 --rows 40
 *   node scripts/android-screen.mjs --png shot.png        # decode a saved frame
 *   node scripts/android-screen.mjs --region 600,0,600,300
 *   node scripts/android-screen.mjs --probe 100,100 --probe 960,600
 *   node scripts/android-screen.mjs --save .tmp-android-audit/x.png
 *
 * Exit code is 1 when `adb` fails or the PNG is not an 8-bit RGB/RGBA
 * PNG, so it is safe to use as a build/verification gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { inflateSync } from "node:zlib";

/** Darkest-to-lightest ramp; index maps a palette entry to a glyph. */
const RAMP = "@%#*+=-:.";

/** Parse `--flag value` pairs without pulling in a dependency. */
function parseArgs(argv) {
  const args = { cols: 96, rows: null, png: null, region: null, probes: [], save: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--cols":
        args.cols = Number(next);
        i += 1;
        break;
      case "--rows":
        args.rows = Number(next);
        i += 1;
        break;
      case "--png":
        args.png = next;
        i += 1;
        break;
      case "--region":
        args.region = next.split(",").map(Number);
        i += 1;
        break;
      case "--probe": {
        const [x, y] = next.split(",").map(Number);
        args.probes.push([x, y]);
        i += 1;
        break;
      }
      case "--save":
        args.save = next;
        i += 1;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

/** Read one PNG chunk at `offset`; returns { type, data, next }. */
function readChunk(buf, offset) {
  const length = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + length);
  return { type, data, next: offset + 12 + length };
}

/** Paeth predictor from the PNG spec (§9.4). */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode an 8-bit RGB/RGBA non-interlaced PNG into raw pixels.
 * Android's `screencap` emits RGBA8888, and image editors re-save as
 * RGB or RGBA, so those three cases cover every frame this sees.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG (bad signature)");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buf.length) {
    const { type, data, next } = readChunk(buf, offset);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error("interlaced PNG unsupported");
      if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`unsupported PNG colour type ${colorType}`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = next;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = y * stride;
    const prev = out - stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? pixels[out + i - channels] : 0;
      const b = y > 0 ? pixels[prev + i] : 0;
      const c = y > 0 && i >= channels ? pixels[prev + i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown scanline filter ${filter}`);
      pixels[out + i] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** `#rrggbb` for the pixel at (x, y). */
function pixelHex(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  const [r, g, b] = [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Group near-identical colours by dropping the low 3 bits of each channel. */
function bucketKey(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
}

/** coverage: Map<bucketKey, { hex, count }>, sampled every `step` pixels. */
function paletteCoverage(img, step) {
  const coverage = new Map();
  let total = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const hex = pixelHex(img, x, y);
      const key = bucketKey(hex);
      const entry = coverage.get(key);
      if (entry) entry.count += 1;
      else coverage.set(key, { hex, count: 1 });
      total += 1;
    }
  }
  return { coverage, total };
}

/** Luminance 0-255, used to order the palette for the glyph ramp. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff);
}

/** Squared RGB distance, for snapping a sampled pixel to its palette entry. */
function distance(hexA, hexB) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return dr * dr + dg * dg + db * db;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let png;
  if (args.png) {
    png = readFileSync(args.png);
  } else {
    png = execFileSync("adb", ["exec-out", "screencap", "-p"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (args.save) {
      mkdirSync(dirname(args.save), { recursive: true });
      writeFileSync(args.save, png);
      console.log(`saved ${args.save}`);
    }
  }

  const img = decodePng(png);
  const [rx, ry, rw, rh] = args.region ?? [0, 0, img.width, img.height];
  const region = {
    width: Math.min(rw, img.width - rx),
    height: Math.min(rh, img.height - ry),
    originX: rx,
    originY: ry,
  };

  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 400));
  const { coverage } = paletteCoverage(img, step);
  const ranked = [...coverage.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const sampled = [...coverage.values()].reduce((sum, e) => sum + e.count, 0);

  console.log(`frame: ${img.width}x${img.height} (${img.channels} channels)`);
  console.log(`region: ${region.width}x${region.height} at ${rx},${ry}`);
  console.log("colours:");
  for (const entry of ranked) {
    console.log(`  ${entry.hex}  ${((entry.count / sampled) * 100).toFixed(1).padStart(5)}%`);
  }

  // Glyph per palette entry: darkest colour gets '@', lightest gets '.'.
  const glyphs = new Map();
  [...ranked]
    .sort((a, b) => luminance(a.hex) - luminance(b.hex))
    .forEach((entry, index) => {
      glyphs.set(entry.hex, RAMP[Math.min(index, RAMP.length - 1)]);
    });

  const cols = Math.min(args.cols, region.width);
  const rows = args.rows ?? Math.max(8, Math.round((cols * region.height) / region.width / 2));
  const legend = [];
  console.log(`grid: ${cols}x${rows}  (glyph → colour)`);
  let out = "";
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let col = 0; col < cols; col += 1) {
      const x = region.originX + Math.floor(((col + 0.5) / cols) * region.width);
      const y = region.originY + Math.floor(((row + 0.5) / rows) * region.height);
      const hex = pixelHex(img, Math.min(x, img.width - 1), Math.min(y, img.height - 1));
      let best = ranked[0].hex;
      let bestDistance = Infinity;
      for (const entry of ranked) {
        const d = distance(hex, entry.hex);
        if (d < bestDistance) {
          bestDistance = d;
          best = entry.hex;
        }
      }
      const glyph = glyphs.get(best) ?? "?";
      if (!legend.some((l) => l.glyph === glyph)) legend.push({ glyph, hex: best });
      line += glyph;
    }
    out += `${line}\n`;
  }
  process.stdout.write(out);
  console.log(legend.map((l) => `${l.glyph}=${l.hex}`).join("  "));

  for (const [x, y] of args.probes) {
    console.log(`probe ${x},${y} → ${pixelHex(img, x, y)}`);
  }
}

main();
