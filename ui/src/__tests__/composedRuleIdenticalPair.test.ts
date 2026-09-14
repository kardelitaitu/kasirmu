/**
 * COMPOSED-RULE IDENTICAL-PAIR CHECK — the highest-precision subset of the
 * contrast problem, and deliberately nothing else.
 *
 * DEFECT CLASS: one declaration block sets color: AND background: (or
 * background-color:), and the two tokens resolve to the SAME colour value in
 * some theme. The text is then literally invisible — ratio 1.00:1, not 3.68:1,
 * not arguable as "large text". An identical pair is an identical pair.
 *
 * WHAT IT READS: every .css file under ui/src/features, recursively, walked rule
 * including rules nested inside @media, resolved through the theme blocks of
 * ui/src/frontend/themes/tokens.css — :root (the default dark),
 * [data-theme='light'] and [data-theme='dark'] — each theme block cascaded ON
 * TOP of :root, because a theme block only redefines the tokens it changes.
 *
 * WHAT IT REFUSES TO GRADE, and why. These are skipped silently and the skip is
 * a decision, not an oversight:
 *
 *   (1) A side written as rgba()/rgb(), a gradient, currentColor, transparent,
 *   a named colour, a var() with a fallback, or anything that does not resolve
 *   through the theme to a bare #hex. The census counted 404 of the 766
 *   same-block pairs tree-wide in this shape. They are ancestor-dependent —
 *   an alpha fill means nothing until you know what is behind it — so an
 *   assertion on them is a false positive waiting to be muted, and a muted
 *   assertion is worse than no assertion at all.
 *
 *   (2) Pairs that live in DIFFERENT blocks. The measurement that forces that
 *   limit: 784 blocks across the feature sheets set only a background and 1,316
 *   set
 *   only a color. That one-sided asymmetry is exactly how the QRIS defect
 *   composed — one rule's text colour meeting another rule's fill — so a check
 *   that demanded both sides in one block cannot see it either. This file is
 *   NOT a complete contrast gate; it is the one slice of the problem that can
 *   be stated without a used value, and it says so here rather than pretending.
 *
 * WHY NOT AN AA THRESHOLD HERE: ui/src/__tests__/colorContrastCompliance.test.ts
 * asserts 22 hand-picked pairings over 3 themes plus one smoke case each = 69
 * cases, and it opens exactly ONE file, ../frontend/themes/tokens.css — the
 * string 'features/' appears nowhere in its 399 lines. The sheets it never
 * opens compose hundreds of same-block pairs, so that gate grades roughly one
 * pair per thirty-odd composed rules, and its case count is STRUCTURE, not
 * measurement: it read 69/69 both before and after a real contrast fix. This
 * file grades no ratio whatsoever — no 4.5:1, no 3:1, no large-text
 * convention — which is why a failure here cannot be argued with, and why this
 * slice is fundable while the sub-4.5:1 population is not.
 *
 * MEASURED HERE, not quoted from the census: 105 feature stylesheets, 948 blocks
 * that carry both a color: and a background-side declaration, 394 of them
 * gradable through at least one theme, and 0 identical pairs as of 268af4a6e.
 * The census's 766 and this 948 disagree because they count different things:
 * counting a color: against EACH background declaration in a block reaches a
 * larger number than counting one used-value pair per block, and this walk uses
 * the used value. See the note above collectSameBlockPairs for the one rule
 * where that difference fabricated a violation.
 *
 * NO VACUOUS GREEN: if the walk finds zero gradable pairs the suite FAILS with
 * "parser matched nothing". A check that goes quiet the moment its input
 * changes shape is how a green run starts meaning nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const FEATURES_DIR = path.resolve(process.cwd(), 'src', 'features');
const TOKENS_PATH = path.resolve(process.cwd(), 'src', 'frontend', 'themes', 'tokens.css'); 

/** The same three themes the existing gate names, each cascaded over :root. */
const THEMES = [
  { selector: ':root', label: 'Default (Dark)' },
  { selector: "[data-theme='light']", label: 'Light' },
  { selector: "[data-theme='dark']", label: 'Dark Solid' },
];

/** Comments must not be graded, but their removal must not move line numbers. */
function stripCommentsKeepLines(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Brace-matched body of one block, the same trick the existing gate uses. */
function blockBody(css: string, selector: string): string | null {
  const target = selector + ' {';
  const at = css.indexOf(target);
  if (at < 0) return null;
  let depth = 1;
  let pos = at + target.length;
  while (pos < css.length && depth > 0) {
    if (css[pos] === '{') depth++;
    else if (css[pos] === '}') depth--;
    pos++;
  }
  return depth === 0 ? css.slice(at + target.length, pos - 1) : null;
}

function parseTokenBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[m[1]!] = m[2]!.trim();
  return out;
}

const tokensCss = stripCommentsKeepLines(readFileSync(TOKENS_PATH, 'utf8'));
const rootTokens = parseTokenBlock(blockBody(tokensCss, ':root') ?? '');

const themeTokens = THEMES.map((t) => ({
  label: t.label,
  tokens: t.selector === ':root'
    ? { ...rootTokens }
    : { ...rootTokens, ...parseTokenBlock(blockBody(tokensCss, t.selector) ?? '') },
}));

interface Decl { prop: string; value: string; line: number }
interface Frame { selector: string; decls: Decl[]; line: number; skip: boolean }
interface Pair { file: string; selector: string; line: number; color: Decl; bg: Decl }

/* The census counted 766 same-block pairs; a first pass here counted more,
   because a cross-product of every color: against every background: double
   counts the fallback idiom — RetailPosScreen.css:75-76 declares
   background: var(--color-bg-elevated) and then OVERWRITES it with
   background: color-mix(...), and pairing the colour with BOTH invented a
   violation that cannot paint. So this walk grades the USED value per property
   (last declaration wins, same origin, same specificity) and one block yields
   at most one pair. Both numbers are reported: crossProduct is the census's
   shape, usedValuePairs is what this check actually grades. */
function lastOf(decls: Decl[], prop: string): Decl | null {
  for (let i = decls.length - 1; i >= 0; i--) {
    if (decls[i]!.prop === prop) return decls[i]!;
  }
  return null;
}
function lastBackground(decls: Decl[]): Decl | null {
  let best: Decl | null = null;
  for (const d of decls) if (d.prop === 'background' || d.prop === 'background-color') best = d;
  return best;
}

const GRADEABLE_PROPS = new Set(['color', 'background', 'background-color']);

/** Every color:+background: pairing that shares ONE declaration block. */
function collectSameBlockPairs(cssPath: string): { pairs: Pair[]; total: number } {
  const css = stripCommentsKeepLines(readFileSync(cssPath, 'utf8'));
  const rel = path.relative(FEATURES_DIR, cssPath).split(path.sep).join('/');
  const pairs: Pair[] = [];
  let total = 0;
  let line = 1;
  let seg = '';
  let paren = 0;
  const stack: Frame[] = [];

  const record = (text: string, at: number): void => {
    const frame = stack[stack.length - 1];
    if (!frame) return;
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (value && GRADEABLE_PROPS.has(prop)) frame.decls.push({ prop, value, line: at });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') { line++; seg += ch; continue; }
    if (ch === '(') { paren++; seg += ch; continue; }
    if (ch === ')') { paren--; seg += ch; continue; }
    if (ch === ';' && paren === 0) { record(seg, line); seg = ''; continue; }
    if (ch === '{') {
      const selector = seg.trim();
      const parent = stack[stack.length - 1];
      stack.push({
        selector,
        decls: [],
        line,
        skip: Boolean(parent?.skip) || selector.startsWith('@keyframes')
          || selector.startsWith('@-webkit-keyframes'),
      });
      seg = '';
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      if (frame && !frame.skip && frame.selector && !frame.selector.startsWith('@')) {
        const color = lastOf(frame.decls, 'color');
        const bg = lastBackground(frame.decls);
        if (color && bg) {
          total++;
          pairs.push({ file: rel, selector: frame.selector, line: color.line, color, bg });
        }
      }
      seg = '';
      continue;
    }
    seg += ch;
  }
  return { pairs, total };
}

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a directory that vanished mid-walk contributes nothing
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    // Lanes in this checkout write editor temp files (.tsx.<uuid>.tmpdir) next
    // to the real sheet, and one of them can be unlinked between readdir and
    // stat. A tree walk that throws on that would sink the suite for a reason
    // that has nothing to do with colour, so stat failure means: not a
    // directory, not a .css, skip.
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

const sheets = cssFiles(FEATURES_DIR);
const composed: Pair[] = [];
for (const f of sheets) composed.push(...collectSameBlockPairs(f).pairs);
const composedTotal = composed.length;

/** A side is gradable only when it resolves to a bare #hex through this theme. */
function resolveHex(value: string, tokens: Record<string, string>): string | null {
  let v = value.replace(/\s*!important\b/i, '').trim();
  for (let hops = 0; hops < 6; hops++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m) break;
    const next = tokens[m[1]!];
    if (next === undefined) return null;
    v = next.replace(/\s*!important\b/i, '').trim();
  }
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v.toLowerCase() : null;
}

interface Violation {
  file: string; line: number; selector: string; theme: string;
  colorToken: string; bgToken: string; hex: string;
}

function tokenLabel(value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value.replace(/\s*!important\b/i, '').trim());
  return m ? m[1]! : value;
}

const violations: Violation[] = [];
let gradable = 0;
for (const p of composed) {
  let resolvable = false;
  for (const t of themeTokens) {
    const cHex = resolveHex(p.color.value, t.tokens);
    const bHex = resolveHex(p.bg.value, t.tokens);
    if (cHex === null || bHex === null) continue;
    resolvable = true;
    if (cHex === bHex) {
      violations.push({
        file: p.file, line: p.line, selector: p.selector, theme: t.label,
        colorToken: tokenLabel(p.color.value), bgToken: tokenLabel(p.bg.value), hex: cHex,
      });
      break;
    }
  }
  if (resolvable) gradable++;
}

function render(v: Violation): string {
  return '  ' + v.file + ':' + v.line + '  ' + v.selector + '   [' + v.theme + ']   color:'
    + v.colorToken + '  background:' + v.bgToken + '   both resolve to ' + v.hex
    + '   -> ratio 1.00:1';
}

describe('Composed rules: text and background resolving to one colour', () => {
  it('reads a real population (never a vacuous green)', () => {
    expect(sheets.length, 'no feature stylesheets were found').toBeGreaterThan(0);
    expect(composedTotal, 'no same-block color+background pair was found').toBeGreaterThan(0);
    if (gradable === 0) {
      throw new Error(
        'parser matched nothing: walked ' + sheets.length + ' feature stylesheets, found '
        + composedTotal + ' same-block color/background pairs, and resolved 0 of them to two'
        + ' plain #hex tokens. Either the sheets changed shape or this parser broke.'
        + ' Refusing to report a green over an empty population.',
      );
    }
    expect(gradable, 'only ' + gradable + ' gradable pairs of ' + composedTotal).toBeGreaterThan(10);
  });

  it('resolves all three theme blocks over the :root base', () => {
    for (const t of themeTokens) {
      expect(
        Object.keys(t.tokens).length,
        'theme ' + t.label + ' extracted almost no tokens from tokens.css',
      ).toBeGreaterThan(100);
    }
  });

  it('no rule sets color and background to the same resolved colour ('
    + gradable + ' pairs graded of ' + composedTotal + ' composed across ' + violations.length + ' violation)', () => {
    expect(
      violations.length,
      'INVISIBLE TEXT in ' + violations.length + ' rule(s):\n'
      + violations.map(render).join('\n')
      + '\n\npopulation: ' + sheets.length + ' feature sheets, ' + composedTotal
      + ' composed same-block pairs, ' + gradable + ' gradable through the three themes',
    ).toBe(0);
  });
});
