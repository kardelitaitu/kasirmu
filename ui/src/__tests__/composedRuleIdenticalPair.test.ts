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
 * NO VACUOUS GREEN, in TWO layers, because one is provably not enough:
 *   (a) tree-wide — if the walk finds zero gradable pairs the suite FAILS with
 *       "parser matched nothing"; and
 *   (b) PER FILE — any sheet containing a '{' must contribute at least one
 *       recorded declaration block, else the suite names the file and prints how
 *       many braces it holds against how many blocks it parsed.
 * (b) exists because (a) cannot see a single blind sheet. Three stray ')' in
 * src/features/warehouse/WarehouseConsole.css drove the walk's paren counter
 * negative; below zero the depth-0 recording gate never fires again, so that sheet
 * stopped contributing while 104 other sheets kept the total healthy and the run
 * green. aa56aba9d deleted the three characters — the INPUT is gone, so the parser
 * is now clamped (')' never decrements below 0) and a malformed sheet can never
 * black out its own file again; and the floor is the loud half, because a clamped
 * counter silently resumes grading whatever it can parse. Measured with throwaway
 * sheets under features/sales: the unclamped walk reads a 2-block sheet as 0
 * graded pairs and prints 400/960 exactly as it did without the file at all; the
 * floor turns that same sheet into a named failure.
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
interface Frame { selector: string; decls: Decl[]; line: number; skip: boolean; declCount: number }
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
/* CSS cascade within one block: last declaration wins — EXCEPT that an !important
   declaration beats every later normal one, and among several !important ones the last
   wins. Plain last-wins mis-graded BOTH directions: '.x { color: A !important;
   background: B; color: B; }' was read as color:B background:B, i.e. reported as
   invisible text that cannot actually paint, and the mirror shape hid a real defect.
   Measured on the committed tree: exactly three !important colour-ish declarations exist
   under features/ — KdsScreen.css:741-742 (border-color, outline-color) and
   NodeTopologyEditor.css:1098 (border-color) — and none names a graded property, so
   record() never saw them: latent, not live. Choosing the important declaration is the
   cheaper rule to be right about. */
function isImportant(d: Decl): boolean { return /\s*!important\b/i.test(d.value); }
/** Last !important declaration for prop, else the last one at all. */
function pickImportant(decls: Decl[], matches: (d: Decl) => boolean): Decl | null {
  let last: Decl | null = null;
  let lastImportant: Decl | null = null;
  for (const d of decls) {
    if (!matches(d)) continue;
    last = d;
    if (isImportant(d)) lastImportant = d;
  }
  return lastImportant ?? last;
}
function lastOf(decls: Decl[], prop: string): Decl | null {
  return pickImportant(decls, (d) => d.prop === prop);
}
function lastBackground(decls: Decl[]): Decl | null {
  return pickImportant(decls, (d) => d.prop === 'background' || d.prop === 'background-color');
}

const GRADEABLE_PROPS = new Set(['color', 'background', 'background-color']);

export interface SheetTally {
  file: string; braces: number; blocksClosed: number; blocksRecorded: number; pairs: number;
}

/** Every color:+background: pairing that shares ONE declaration block. */
function collectSameBlockPairs(cssPath: string): { pairs: Pair[]; total: number; tally: SheetTally } {
  const css = stripCommentsKeepLines(readFileSync(cssPath, 'utf8'));
  const rel = path.relative(FEATURES_DIR, cssPath).split(path.sep).join('/');
  const pairs: Pair[] = [];
  let total = 0;
  let line = 1;
  let seg = '';
  let paren = 0;
  // Per-file parse evidence for the floor: a sheet the walk cannot read must be NAMED, not
  // silently contribute nothing. braces counts '{', blocksClosed counts the matching pops,
  // blocksRecorded counts blocks that got at least ONE declaration of ANY property past
  // depth-0 recording. braces > 0 with blocksRecorded === 0 is the shape of a blackout: the
  // file was opened, parsed to nothing, and graded as if it were absent.
  let braces = 0;
  let blocksClosed = 0;
  let blocksRecorded = 0;
  const stack: Frame[] = [];

  const record = (text: string, at: number): void => {
    const frame = stack[stack.length - 1];
    if (!frame) return;
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!prop || !value) return;
    frame.declCount++;
    if (GRADEABLE_PROPS.has(prop)) frame.decls.push({ prop, value, line: at });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') { line++; seg += ch; continue; }
    if (ch === '(') { paren++; seg += ch; continue; }
    // CLAMP: a ')' below zero is malformed input, not a nesting level. Decrementing
    // unconditionally drove the counter negative — three stray ')' in
    // src/features/warehouse/WarehouseConsole.css did exactly that until aa56aba9d — and
    // once negative, the "ch === ';' && paren === 0" gate below can never fire again, so the
    // rest of the file recorded nothing while the suite stayed green. Clamping alone is NOT
    // enough: a clamped walk silently resumes grading whatever it can parse, so the per-file
    // floor is what turns a blackout into a named failure.
    if (ch === ')') { if (paren > 0) paren--; seg += ch; continue; }
    if (ch === ';' && paren === 0) { record(seg, line); seg = ''; continue; }
    if (ch === '{') {
      braces++;
      const selector = seg.trim();
      const parent = stack[stack.length - 1];
      stack.push({
        selector,
        decls: [],
        declCount: 0,
        line,
        skip: Boolean(parent?.skip) || selector.startsWith('@keyframes')
          || selector.startsWith('@-webkit-keyframes'),
      });
      seg = '';
      continue;
    }
    if (ch === '}') {
      // FLUSH BEFORE POP. The pending segment is a declaration whose author omitted the
      // trailing ';' — '.x { color: #fff; background: #eee }'. Recording it while the frame
      // is still on the stack keeps that last declaration; popping first dropped it, which
      // mis-grades BOTH ways: it can hide a real identical pair, or split one so a pair
      // never forms. Measured on the committed tree: zero such blocks today, so this is
      // latency, not a live defect.
      record(seg, line);
      const frame = stack.pop();
      if (frame) {
        blocksClosed++;
        if (frame.declCount > 0) blocksRecorded++;
      }
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
  return { pairs, total, tally: { file: rel, braces, blocksClosed, blocksRecorded, pairs: total } };
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
const tallies: SheetTally[] = [];
for (const f of sheets) {
  const walk = collectSameBlockPairs(f);
  composed.push(...walk.pairs);
  tallies.push(walk.tally);
}
const composedTotal = composed.length;
// The per-file floor's population: every sheet that opens a block at all. A sheet with no
// '{' (comment-only) is legitimately silent and is excluded by the braces > 0 test.
const blindSheets = tallies.filter((t) => t.braces > 0 && t.blocksRecorded === 0);

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

  /* PER-FILE FLOOR. The assertion above is tree-wide, so ONE blacked-out sheet passes it
     while the run prints a healthy total: three stray ')' in WarehouseConsole.css pushed the
     paren counter negative and that file stopped contributing, and 104 other sheets kept the
     average green. A floor that every readable sheet clears turns a single blind sheet into
     a named, line-numbered failure — "sheet X parsed to zero blocks" is actionable,
     "population is low" is not. */
  it('every sheet that opens a block contributes at least one recorded declaration block', () => {
    expect(
      blindSheets.length,
      'UNREADABLE SHEET(S) — the walk found braces but recorded ZERO declaration blocks, so '
      + 'nothing in them was graded:\n'
      + blindSheets
        .map((t) => '  ' + t.file + '   contains ' + t.braces + " '{' and closed " + t.blocksClosed
          + ' block(s), but contributed ' + t.blocksRecorded + ' recorded declaration block(s)'
          + ' and ' + t.pairs + ' composed pair(s)')
        .join('\n')
      + '\n\nA malformed value (an unbalanced \'(\' or \')\') anywhere above the first block can'
      + ' do this: declarations are only recorded at paren depth 0. Fix the sheet, or fix the'
      + ' parser — but do not let the file grade as if it were absent.',
    ).toBe(0);
    // The floor must have a population to be worth anything: it grades this many sheets.
    expect(tallies.filter((t) => t.braces > 0).length, 'no sheet with a brace was walked').toBeGreaterThan(50);
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
