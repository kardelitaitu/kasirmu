import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Reduced-motion escapes via `!important`.
 *
 * The blanket kill is a `*` rule at specificity (0,0,0): `reset.css:206` and
 * its duplicate `AppLayout.css:41` set `animation-duration` /
 * `transition-duration: 0.01ms !important`. An `!important` declaration beats
 * any non-important one at any specificity, so that rule covers every ordinary
 * selector in the app.
 *
 * What it does NOT cover is a declaration that is *also* `!important` on a
 * selector of higher specificity — there both are important, so specificity
 * decides and the class/element rule wins. Those keep animating for a
 * reduced-motion user.
 *
 * Two shapes are therefore legal:
 *   1. a declaration that KILLS motion (`animation: none`, `transition: none`,
 *      `0.01ms`) — it is enforcing the kill, not escaping it;
 *   2. a motion-enabling declaration scoped inside
 *      `@media (prefers-reduced-motion: no-preference)` (or `: reduce`) —
 *      such a rule does not match under `reduce` at all, so nothing survives.
 *
 * Everything else is an escape.
 *
 * This gate exists because `animationCompliance.test.ts` reads animations only
 * and states in its own harvest line that "513 transition declarations are
 * never read" — every escape found was a `transition`, so the existing suite
 * could never surface them.
 */

const UI_ROOT = join(__dirname, '..', '..');
const CSS_ROOT = join(UI_ROOT, 'src');

const MOTION_PROPS = new Set([
  'transition',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'transition-delay',
  'animation',
  'animation-duration',
  'animation-name',
  'animation-timing-function',
  'animation-iteration-count',
  'animation-delay',
]);

/** `none` / zero-length values: these SUPPRESS motion, so they are allowed. */
function killsMotion(prop: string, value: string): boolean {
  const v = value.replace(/\s*!important\s*$/, '').trim().replace(/;$/, '').trim();
  if (v === 'none') return true;
  if (prop.endsWith('duration') || prop.endsWith('delay')) {
    return v === '0s' || v === '0ms' || v === '0.01ms' || v === '0';
  }
  if (prop === 'animation-iteration-count') return v === '1';
  if (prop === 'animation-name') return v === 'none';
  return false;
}

/**
 * Blanks block comments LENGTH-PRESERVING (newlines kept) so line numbers
 * still address the real file. Prose in this tree narrates animations it does
 * not contain — `KdsScreen.css` describes a global reduce block — so a comment
 * must never be able to open or close an escape.
 */
function stripBlockComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const closed = css.indexOf('*/', i + 2);
      const stop = closed === -1 ? css.length : closed + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

/** Byte ranges of every `@media (prefers-reduced-motion: <x>)` block. */
function mediaRanges(css: string, preference: 'reduce' | 'no-preference'): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = new RegExp(
    `@media\\s*\\(\\s*prefers-reduced-motion\\s*:\\s*${preference}\\s*\\)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

interface Escape {
  file: string;
  line: number;
  prop: string;
  value: string;
}

/**
 * The gate itself, over one sheet's text. Exported to the describe block as a
 * pure function so the corpus run below and the synthetic cases further down
 * exercise the SAME code path — a gate that silently stopped matching would
 * otherwise pass vacuously.
 */
function escapesIn(text: string, file = 'synthetic.css'): Escape[] {
  const clean = stripBlockComments(text);
  const scoped = [...mediaRanges(clean, 'reduce'), ...mediaRanges(clean, 'no-preference')];
  const escapes: Escape[] = [];
  const decl = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(clean)) !== null) {
    const prop = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? '';
    if (!MOTION_PROPS.has(prop)) continue;
    if (!value.includes('!important')) continue;
    if (scoped.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    if (killsMotion(prop, value)) continue;
    escapes.push({
      file,
      line: clean.slice(0, m.index).split('\n').length,
      prop,
      value: value.replace(/\s+/g, ' ').trim(),
    });
  }
  return escapes;
}

function findCssFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findCssFiles(full, results);
    else if (entry.name.endsWith('.css')) results.push(full);
  }
  return results;
}

describe('reduced-motion !important escapes', () => {
  let escapes: Escape[];

  beforeAll(() => {
    escapes = [];
    for (const file of findCssFiles(CSS_ROOT)) {
      const rel = 'src/' + file.slice(CSS_ROOT.length + 1).replace(/\\/g, '/');
      escapes.push(...escapesIn(readFileSync(file, 'utf-8'), rel));
    }
  });

  it('finds no motion-enabling !important declaration outside a reduce-scoped block', () => {
    const report = escapes
      .map((e) => `  ${e.file}:${e.line}  ${e.prop}: ${e.value}`)
      .join('\n');
    expect(escapes, `\n${report}\n`).toHaveLength(0);
  });

  // The gate must be able to say "no" — otherwise the assertion above could
  // go green because the walker broke, not because the tree is clean.
  it('flags a bare motion-enabling !important declaration', () => {
    expect(escapesIn('.card { transition: transform 0.3s ease !important; }')).toHaveLength(1);
  });

  it('accepts the same declaration once scoped to no-preference', () => {
    const sheet = `@media (prefers-reduced-motion: no-preference) {
      .card { transition: transform 0.3s ease !important; }
    }`;
    expect(escapesIn(sheet)).toHaveLength(0);
  });

  it('accepts a declaration that KILLS motion instead of enabling it', () => {
    expect(escapesIn('.card { transition: none !important; }')).toHaveLength(0);
    expect(escapesIn('.card { animation: none !important; }')).toHaveLength(0);
    expect(escapesIn('.card { transition-duration: 0.01ms !important; }')).toHaveLength(0);
    expect(escapesIn('.card { animation-iteration-count: 1 !important; }')).toHaveLength(0);
  });

  it('is not fooled by a comment that only talks about a reduce block', () => {
    const sheet = `/* .card { transition: none !important; } inside a reduce block */\n.card { transition: transform 0.3s ease !important; }`;
    expect(escapesIn(sheet)).toHaveLength(1);
  });

  it('still reads the sheets, so a vacuous corpus run is impossible', () => {
    const files = findCssFiles(CSS_ROOT).map((f) => f.replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('theme/reset.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('theme/tokens.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('kds/KdsScreen.css'))).toBe(true);
  });
});
