/**
 * Stylesheet Import-Edge Compliance
 *
 * THE INVARIANT (the rule a component must satisfy):
 *   If a component PAINTS a class, the stylesheet that DEFINES it must be reachable
 *   through THAT component's own imports -- not through the module graph of whichever
 *   sibling happened to be rendered alongside it.
 *
 * Why it is not self-enforcing: a stylesheet has no linter, no hook step and no
 * ESLint config that reads it, and a component that borrows a class from a sheet it
 * never imports still renders, still passes `tsc --noEmit`, still passes `eslint`.
 * The coupling is invisible until the borrowing screen mounts WITHOUT the lender --
 * then the class paints unstyled and nothing in the build says so.
 *
 * THE FAMILY THIS GUARD PROVES IT ON: `sc-badge` plus its four state modifiers
 * (`--draft`, `--in_progress`, `--completed`, `--cancelled`), painted by three
 * stock-count screens. Detail and History used to borrow the List screen's sheet
 * through an incidental static import at `StockCountsFlow.tsx:2`
 * (`import StockCountsScreen from './StockCountsScreen'`). `960d00568` hoisted the
 * five rules into `features/inventory/StockCountBadge.css` and gave all three
 * painters a direct import of that sheet.
 *
 * TWO ASSERTIONS, deliberately narrow:
 *   (a) each painter imports `StockCountBadge.css` DIRECTLY, in its own file (its own
 *       import statement, resolving to that exact sheet -- not an ancestor's), and
 *   (b) every `.sc-badge` / `.sc-badge--*` rule under `ui/src` lives INSIDE that one
 *       sheet, so the family can be neither re-duplicated across screen sheets nor
 *       re-homed into a sheet the painters do not import.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT ASSERT -- a KNOWN UNCOVERED INSTANCE of the
 * same class, named so no later reader mistakes this for a whole-tree proof:
 *   `pos-cart-deduction-override` is painted by
 *   `ui/src/features/restaurant/components/MenuPreferencesMenu.tsx:281` while its only
 *   definition is `ui/src/features/sales/CartPanel.css:202` (the block quoted at
 *   `:200` in the note that recorded it; that sheet is being edited in another session,
 *   so the line is that file's current position, not a stable address), and the
 *   restaurant component has no import edge to it. That use is ANOTHER SESSION'S
 *   UNCOMMITTED EDIT as this guard was written -- asserting on it would take a guard
 *   red over work nobody has landed, which is how a real finding loses all credibility.
 *   So the class has two known instances today: one certified by this file, one
 *   awaiting its author. When it lands, the fix is the same shape as 960d00568 and this
 *   file gains a second family block -- do not "temporarily" assert on it before then.
 *
 * BLIND SPOTS, stated rather than papered over:
 *   - Scope is ONE class family. (a) is proven for the files that paint `sc-badge`; a
 *     borrowed class from any OTHER family (including the one named above) is not.
 *   - Reach is checked as a DIRECT import statement only. A sheet reachable through a
 *     helper module the painter imports counts as MISSING here -- the stricter reading,
 *     chosen because the bug being guarded was exactly the transitive reading.
 *   - Definitions are recognised as `.class` selector tokens. A family class reached
 *     only via an attribute matcher (`[class*="sc-badge"]`) is invisible to (b).
 *   - Paints are read from string/template literals outside comments, so a doc comment
 *     that merely MENTIONS sc-badge (three of them do, in these very files) is not a
 *     painter. JSX-attribute-built names (`sc-badge--${status}`) ARE seen, via prefix.
 *   - The walk reads the WORKING TREE through fs with no channel to any revision, so
 *     every number a run prints is a timestamp on this checkout, not a fact about a
 *     commit; with other sessions editing stylesheets here, record what was dirty.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';

const UI_SRC = resolve(__dirname, '..');
const SHEET = join(UI_SRC, 'features', 'inventory', 'StockCountBadge.css');

const FAMILY_BASE = 'sc-badge';
const FAMILY_PREFIX = 'sc-badge--';
/** A live (non-comment) class token: not glued to a preceding name character. */
const PAINTS_FAMILY = /(?:^|[^-\w])sc-badge/;

/* ── Population floors, measured on this checkout 2026-09-16 at 960d00568 ──
 * 3 painters, 5 family rules, 138 stylesheets, 663 non-test source files. Each
 * floor sits BELOW its measurement so ordinary work cannot trip it, while a walk
 * that silently reads nothing (a renamed directory, a swallowed readdir) fires. */
const MIN_PAINTERS = 3;
const MIN_FAMILY_RULES = 5;
const MIN_SHEETS = 100;
const MIN_SOURCES = 300;

/* ── Walk ───────────────────────────────────────────────────────── */
function isSkippedDir(entry: string): boolean {
  return entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.');
}

function walk(dir: string, accept: (name: string) => boolean, where: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // A directory that cannot be listed removes its own subtree from the
    // population, so the walk reads SMALLER rather than red. Name it.
    where.push(`${relative(UI_SRC, dir).split('\\').join('/')} -> ${String(err)}`);
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (isSkippedDir(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) found.push(...walk(full, accept, where));
    else if (st.isFile() && accept(entry)) found.push(full);
  }
  return found;
}

const isCss = (name: string): boolean => name.endsWith('.css');
const isSource = (name: string): boolean =>
  (name.endsWith('.tsx') || name.endsWith('.ts')) && !name.endsWith('.d.ts');

const UNLISTABLE: string[] = [];
const CSS_FILES = walk(UI_SRC, isCss, UNLISTABLE);
const SOURCE_FILES = walk(UI_SRC, isSource, UNLISTABLE);

/* ── Comment masking, length-preserving ─────────────────────────── */
/**
 * Comments must not reach the graded text, but deleting them shifts every later
 * byte and turns a reported line into a fiction. Blanking each non-newline char
 * with a space keeps the masked copy the SAME LENGTH as the file, so a position in
 * it is a position in the file -- which is what makes the rule addresses below
 * file addresses by construction rather than by an offset added back correctly.
 */
function maskCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

interface StringLiteral {
  text: string;
  line: number;
}

/**
 * Single pass over the real chars: blank comments, collect string / template
 * literals. Quotes are honoured so a `//` inside `'https://…'` is not a comment,
 * and comments are honoured so a quoted word inside a comment is not a literal.
 * Template literals are read to their closing backtick without tracking
 * interpolation nesting -- adequate here because a class name never lives inside
 * a `${…}` expression, only beside one.
 */
function scanTs(text: string): { masked: string; literals: StringLiteral[] } {
  const out = text.split('');
  const literals: StringLiteral[] = [];
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < text.length && text[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
      const end = Math.min(j + 2, text.length);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i + 1;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch) break;
        j++;
      }
      literals.push({ text: text.slice(start, Math.min(j, text.length)), line: lineAt(text, i) });
      i = Math.min(j + 1, text.length);
      continue;
    }
    i++;
  }
  return { masked: out.join(''), literals };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/* ── (b) Where the family is DEFINED ────────────────────────────── */
interface FamilyRule {
  file: string;
  selector: string;
  line: number;
}

/** `.name` class tokens of a selector, CSS ident rules (leading hyphen allowed). */
function classTokens(selector: string): string[] {
  const tokens: string[] = [];
  const re = /\.(-?[A-Za-z_][-\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) tokens.push(m[1] as string);
  return tokens;
}

const isFamilyToken = (token: string): boolean =>
  token === FAMILY_BASE || token.startsWith(FAMILY_PREFIX);

/**
 * Every rule whose selector names a family class, at ANY nesting depth -- so a
 * re-duplicated copy parked inside a `@media` block is still found. An at-rule
 * prelude is descended into and never itself graded; a declaration's `;` and a
 * block's `}` both reset the pending selector.
 */
function familyRulesIn(file: string, css: string): FamilyRule[] {
  const masked = maskCssComments(css);
  const rules: FamilyRule[] = [];
  let pendingStart = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') {
      const raw = masked.slice(pendingStart, i);
      const selStart = pendingStart + (raw.length - raw.trimStart().length);
      const selector = raw.trim();
      if (selector && !selector.startsWith('@')) {
        for (const token of classTokens(selector)) {
          if (isFamilyToken(token)) {
            // one entry per RULE, not per token: `.sc-badge.sc-badge--x` is one rule
            rules.push({ file, selector, line: lineAt(masked, selStart) });
            break;
          }
        }
      }
      pendingStart = i + 1;
    } else if (ch === '}' || ch === ';') {
      pendingStart = i + 1;
    }
  }
  return rules;
}

/* ── (a) Who PAINTS the family, and what they import ────────────── */
interface Painter {
  file: string;
  paints: number;
  edges: string[];
}

function importSpecifiers(masked: string): string[] {
  const specs: string[] = [];
  const forms = [
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of forms) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) specs.push(m[1] as string);
  }
  return specs;
}

function painterOf(file: string): Painter | null {
  const raw = readFileSync(file, 'utf8');
  const { masked, literals } = scanTs(raw);
  let paints = 0;
  for (const lit of literals) {
    let rest = lit.text;
    while (PAINTS_FAMILY.test(rest)) {
      paints++;
      const at = rest.search(PAINTS_FAMILY);
      rest = rest.slice(at + FAMILY_BASE.length);
    }
  }
  if (paints === 0) return null;
  const dir = dirname(file);
  const edges = importSpecifiers(masked)
    .filter((s) => s.endsWith('.css'))
    .map((s) => (s.startsWith('.') ? resolve(dir, s) : s))
    .filter((p) => p === SHEET);
  return { file, paints, edges };
}

const PAINTERS: Painter[] = SOURCE_FILES.map(painterOf).filter(
  (p): p is Painter => p !== null
);
const MISSING_EDGE = PAINTERS.filter((p) => p.edges.length === 0);

/* Both helpers are declared BEFORE their first use: these run at module load, and a
 * const read above its own line is a TDZ ReferenceError, not hoisting -- the file would
 * fail to load and all three cases would report nothing. */
const REL = (p: string): string => relative(UI_SRC, p).split('\\').join('/');
const show = (rules: FamilyRule[]): string =>
  rules.map((r) => `${REL(r.file)}:${r.line} { ${r.selector} }`).join('\n      ');

const FAMILY_RULES = CSS_FILES.flatMap((f) => familyRulesIn(f, readFileSync(f, 'utf8')));
const OWNERS = [...new Set(FAMILY_RULES.map((r) => REL(r.file)))].sort();
const FOREIGN_RULES = FAMILY_RULES.filter((r) => r.file !== SHEET);

describe(`stylesheet import-edge compliance (the ${FAMILY_BASE} family)`, () => {
  it(
    `reads a real population, never a vacuous green: ${PAINTERS.length} painters and ` +
      `${FAMILY_RULES.length} ${FAMILY_BASE} rules in ${OWNERS.length} sheet, from ` +
      `${SOURCE_FILES.length} source files and ${CSS_FILES.length} stylesheets under ui/src`,
    () => {
      expect(UNLISTABLE, 'an unlistable directory shrinks the walk silently').toEqual([]);
      expect(PAINTERS.length, 'painters found by the string-literal scan').toBeGreaterThanOrEqual(MIN_PAINTERS);
      expect(FAMILY_RULES.length, 'family rules found by the CSS walk').toBeGreaterThanOrEqual(MIN_FAMILY_RULES);
      expect(CSS_FILES.length).toBeGreaterThanOrEqual(MIN_SHEETS);
      expect(SOURCE_FILES.length).toBeGreaterThanOrEqual(MIN_SOURCES);
      // The paints must be spread, not one string constant counted three ways.
      expect(new Set(PAINTERS.map((p) => REL(p.file))).size).toBeGreaterThanOrEqual(MIN_PAINTERS);
      console.log(
        `[stylesheetImportEdgeCompliance] painters=${PAINTERS.length}` +
          ` familyRules=${FAMILY_RULES.length} owners=${OWNERS.length}` +
          ` sourcesScanned=${SOURCE_FILES.length} sheetsScanned=${CSS_FILES.length}\n` +
          PAINTERS.map(
            (p) =>
              `  paints ${p.paints}x  ${REL(p.file)}  -> own import of ` +
              `${REL(SHEET)}: ${p.edges.length > 0 ? 'YES' : 'NO'}`
          ).join('\n')
      );
    }
  );

  it(
    `(a) each of the ${PAINTERS.length} ${FAMILY_BASE} painters imports ` +
      `StockCountBadge.css in its OWN file (${PAINTERS.length - MISSING_EDGE.length} do)`,
    () => {
      expect(
        MISSING_EDGE.map((p) => `${REL(p.file)} (paints ${p.paints}x)`),
        `These files paint ${FAMILY_BASE} but carry no import statement naming ` +
          `${REL(SHEET)}. Their styling therefore depends on some sibling's module ` +
          `graph -- the coupling this guard exists to fail. Give each the direct edge.`
      ).toEqual([]);
      expect(statSync(SHEET).isFile(), `${REL(SHEET)} must exist`).toBe(true);
    }
  );

  it(
    `(b) all ${FAMILY_RULES.length} ${FAMILY_BASE} / ${FAMILY_PREFIX}* rules in ui/src live ` +
      `inside StockCountBadge.css (${FOREIGN_RULES.length} sit outside it)`,
    () => {
      expect(
        FOREIGN_RULES.map((r) => `${REL(r.file)}:${r.line} { ${r.selector} }`),
        `${FAMILY_RULES.length} ${FAMILY_BASE} rules were walked across ${OWNERS.join(', ')}; ` +
          `${FOREIGN_RULES.length} of them sit outside ${REL(SHEET)}:\n      ` +
          show(FOREIGN_RULES) +
          '\n      Either the family was re-duplicated (delete the copy and import the ' +
          'owner, as 960d00568 did) or it was re-homed (then every painter needs a ' +
          'direct import edge to the new owner).'
      ).toEqual([]);
      expect(OWNERS, 'the family has exactly one owning sheet').toEqual([REL(SHEET)]);
    }
  );
});
