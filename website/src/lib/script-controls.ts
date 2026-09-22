/**
 * The controls a SCRIPT builds — the half of the accessibility rule that no
 * build output can show.
 *
 * `check-seo` check 13 and the twin in `__tests__/accessibility.test.ts` both
 * judge markup that EXISTS: dist for composed pages, the source for the HTML
 * that ships verbatim. Neither sees a control a script creates at runtime, and
 * that class is not small: `/admin/index.html` is a shell whose `#content`
 * `admin.js` fills in (39 `innerHTML` sites, one of them a live button), the
 * dashboard's search field, dialog inputs and range selector are built by the
 * `el(tag, cls, text)` factory, and `prototypes/app.js` builds two buttons with
 * `document.createElement`. Nothing in dist carries any of them.
 *
 * So this module judges what SOURCE can decide, and declares the rest rather
 * than passing it silently:
 *
 *   • `literals` — control markup written as a string, concatenations joined and
 *     non-literal operands kept as `{expr}`, so `'<button>' + t('retry') +
 *     '</button>'` is one element with content, named by its text. Only CODE is
 *     read: comments are stripped, and in a markup-bearing file (`.astro`,
 *     `.tsx`, `.html`) only the script regions are read, so a JSX attribute —
 *     `class="flex"`, which is a quoted string to a naive scanner — cannot be
 *     mistaken for markup.
 *   • `constructed` — `document.createElement('button')`, named where the
 *     element is used (`up.setAttribute('aria-label', …)`), or in the statement
 *     run when the call's result is not bound to a variable. An icon-only
 *     `innerHTML` is not a name: `innerHTML = '<svg …>'` is the shape that made
 *     the prototype's scroll-to-top button unnamed.
 *   • `factoryControls` — the call sites of a local element factory,
 *     `function el(tag, cls, text) { document.createElement(tag) … }`, when the
 *     tag is a literal: `el('button', 'btn', t('search'))` is named by that
 *     third argument, `el('input', 'input')` needs a name set beside it. This
 *     one arm reaches 46 of the dashboard's controls, none of which is a
 *     `createElement` call or a markup string.
 *   • `opaqueWrites` — markup written into the DOM from a VALUE rather than a
 *     literal (`box.innerHTML = donut.svg`, `tmp.innerHTML = html`). There is no
 *     string at that site to read, so before this arm existed the write produced
 *     no evidence at all: no literal, no control, nothing to report — which is
 *     how 22 sites across four files passed unseen while `UNJUDGEABLE` sat
 *     empty. It is evidence now, answerable only by a declaration in
 *     `OPAQUE_MARKUP` that names the SHAPES the file reads markup from. A
 *     partially literal right-hand side counts (`COPY_ICON + '<span>Copy</span>'`):
 *     the half this rule can read is judged, the half it cannot is declared.
 *     Each declared shape carries a `source`, because a declaration that names
 *     an expression is not the same as one that measured it: a `builder` is run
 *     and measured by the twin's probe, a `literal` is read in place by the arm
 *     above, and a `caller` shape is measured by nothing at all and must say
 *     where its markup comes from instead.
 *   • `NOT_OPERABLE` — controls that are real but deliberately unnamed, such as
 *     the off-screen textarea `AccountLicense` creates, focuses and removes to
 *     drive the execCommand clipboard fallback.
 *   • `UNJUDGEABLE` — files whose controls cannot be enumerated from source at
 *     all. It is EMPTY, and the honest reason is narrow: the dashboard's generic
 *     factory was the one entry and following its call sites closed that hole.
 *     It does NOT mean every file is decidable — an opaque write is decided by
 *     a declaration, not by extraction, and a control built by a script this
 *     walk never reads is neither. Emptiness here is a statement about the files
 *     walker sees, not about what the site builds.
 *
 * EVERY DECLARATION IS ENFORCED IN BOTH DIRECTIONS. A file that builds a control
 * must be judged or declared with a reason; a declaration whose file no longer
 * needs it is stale and fails; a tag this module cannot read is REPORTED rather
 * than skipped; an undeclared opaque write is reported with its line and
 * right-hand side; a shape a declared file writes but the declaration omits
 * fails, and a declared shape no write reads any more fails too. That last pair
 * is the difference between a declaration and a place to hide: the exemption is
 * for the expressions someone looked at, not for the file. A declared shape
 * must carry a source, and a `caller` shape must say where its markup comes
 * from, so no shape can look verified when nothing checked it.
 *
 * TWO CALLERS, ONE RULE, ONE SET OF FILES, ONE VERDICT. `scripts/check-seo.mjs`
 * runs `scriptControlVerdict()` as its check 14 — the gate's arm, and the only
 * post-build guard these controls have — while
 * `__tests__/script-controls.test.ts` is the twin, run by `npm test` before the
 * build. Both read the boundary from `SOURCE_ROOTS`/`SKIPPED_SEGMENTS` through
 * `collectScriptSources()`, so neither can judge a file the other does not, and
 * the gate takes its findings and its printed boundary from ONE pass, so a
 * finding cannot appear twice or in one place only. That matters: this module
 * previously exposed two verdict functions whose outputs overlapped, and the
 * gate called both, printing every script-control defect twice (`FAIL 2` for one
 * defect).
 *
 * What remains uncovered after that is stated in the gate's own output and in
 * the twin: the DOM `admin.js` builds behind its own login and API calls, which
 * needs a browser, a session and mocked endpoints — a harness too expensive to
 * be the gate — and any script outside `SOURCE_ROOTS`. A tag assembled from
 * variables, and markup from a value, are no longer in that list: they are
 * findings a declaration has to answer for.
 */

// The name rule itself comes from the accessibility module: one owner for "what
// counts as a name", applied to dist, to templates and to script literals alike.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { unnamedControls } from './accessibility.ts';

/**
 * The coverage boundary, in one place because two callers enforce it: the gate
 * (`scripts/check-seo.mjs`, check 14) and the twin
 * (`__tests__/script-controls.test.ts`). A root added here is judged by both; a
 * root missing here is judged by neither, so the limit is a declaration rather
 * than a silence. A path listed in `SKIPPED_SEGMENTS` is the same kind of
 * decision, and the summary the gate prints reports both.
 */
export const SOURCE_ROOTS = ['website/src', 'website/public', 'prototypes'];

/**
 * Path segments excluded from the walk. Matched against the key with a leading
 * slash, so a segment can be anchored at the start of a root-relative path
 * (`/website/public/dev/…`) as well as found in the middle (`/__tests__/…`).
 * Matching the raw key instead is what let the generated `public/dev` copy of
 * every prototype be walked a second time under a path a clean checkout does not
 * have — the same markup judged twice, and the file set depending on whether a
 * build had run.
 */
export const SKIPPED_SEGMENTS = [
  // The rule's own tests, and the twin's synthetic fixtures.
  '/__tests__/',
  // Generated: `prebuild` copies `prototypes/` here, so judging it would judge
  // the same markup twice under a path a clean checkout does not have.
  '/website/public/dev/',
  // Vendored: mdBook/rustdoc/TypeDoc output staged by scripts/import-portal.sh.
  // Checks 12 and 13 exempt this same tree by page class (`vendored portal`),
  // and the reason is identical here — nobody edits generated vendor HTML to
  // satisfy this repository's accessibility rule, so a finding in it is a false
  // positive that blocks whoever ran the import script.
  '/website/public/docs-portal/',
];

/** The source extensions a control can be built from. */
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|astro|html?)$/;

/** A literal element tag as a call argument: `'button'`, `"h2"`. */
const TAG_ARGUMENT = /^(['"])([a-zA-Z][a-zA-Z0-9]*)\1$/;

const CONTROL_TAGS = ['button', 'a', 'input', 'select', 'textarea', 'summary'];
const CONTROL_OPEN = new RegExp(`<(${CONTROL_TAGS.join('|')})\\b`, 'i');

/** A control element whose closer is in the same fragment (or a void tag). */
const CONTROL_COMPLETE = /<(button|a|select|textarea|summary)\b[^>]*>[\s\S]*?<\/\1>/i;
const VOID_COMPLETE = /<(input)\b[^>]*>/i;

/** The DOM APIs a control-bearing string is written through. */
const DOM_WRITE = /(?:innerHTML|outerHTML|innerText|textContent)\s*[+]?=\s*$|insertAdjacentHTML\(\s*[^,]+,\s*$/;

/** A control's markup written as a string literal, with the line it starts on. */
export interface ControlLiteral {
  text: string;
  line: number;
}

/** A control built element by element, with the code that follows the constructor. */
export interface ConstructedControl {
  tag: string;
  line: number;
  /** From the constructor to the end of its statement run — where a name must be set. */
  block: string;
  /** Named where the element is used, or in the statement run when it is not bound. */
  named: boolean;
}

/** A control built by a local factory call, judged at the call site. */
export interface FactoryControl {
  tag: string;
  line: number;
  named: boolean;
}

/** What one source file builds. */
export interface ControlEvidence {
  literals: ControlLiteral[];
  constructed: ConstructedControl[];
  /** Offsets of `createElement()` calls whose tag is not a literal. */
  untaggedCreates: number[];
  /** Control markup whose element is never completed inside its own literal. */
  partial: ControlLiteral[];
  /** Controls built through a local `el(tag, …)` factory. */
  factoryControls: FactoryControl[];
  /** Lines where such a factory is called with a tag this arm cannot read. */
  unresolvedCalls: number[];
  /** Markup written into the DOM from a value this rule cannot read. */
  opaqueWrites: OpaqueWrite[];
}

/** Where a file's controls cannot be enumerated from source at all. */
export interface Declaration {
  file: string;
  reason: string;
}

export const UNJUDGEABLE: Declaration[] = [];

export const NOT_OPERABLE: Declaration[] = [
  {
    file: 'website/src/components/account/AccountLicense.tsx',
    reason:
      'a transient textarea for the execCommand clipboard fallback — created off-screen, focused, selected and removed in the same block, so no reader operates it as a control',
  },
];

/**
 * A markup write whose right-hand side this rule cannot read.
 *
 * `box.innerHTML = donut.svg` hands the DOM markup from a value, and there is
 * nothing at the write to judge: the string does not exist in the source. Before
 * this arm existed, such a site produced no evidence at all — zero literals,
 * zero names needed — so it was neither found nor reported, which is how 22
 * writes across four files went unseen (admin.js:255, prototypes/app.js:373 and
 * their neighbours).
 */
export interface OpaqueWrite {
  line: number;
  /**
   * The leading token of the right-hand side — `svgChart`, `donut`, `COPY_ICON`.
   * It is the unit a declaration answers for: a NEW right-hand side in a
   * declared file is a shape the declaration does not cover, so it fails and
   * someone has to look at it rather than inheriting the file's exemption.
   */
  shape: string;
  /** The right-hand side as written, collapsed for the message. */
  rhs: string;
}

/**
 * How a declared shape's markup can be checked — the difference between markup
 * this rule verifies and markup someone vouched for.
 *
 *   • `builder` — produced by a call. `script-controls.test.ts` holds a probe
 *     that runs the real builder under jsdom and measures its output with the
 *     same name rule, so a shape that starts emitting an unnamed control fails
 *     there, naming the shape and the file it is declared in.
 *   • `literal` — the markup is a literal in this same file, so the literal arm
 *     read it where it is written and reports a control found inside it.
 *   • `caller` — supplied at the write by whoever calls the function, so this
 *     rule cannot obtain it from the shape at all: nothing here checks it, and
 *     `note` is required to say where the content comes from instead.
 */
export type ShapeSource = 'builder' | 'literal' | 'caller';

/** One expression a file reads markup from, and how its markup can be checked. */
export interface DeclaredShape {
  /** The leading token of the right-hand side, as `opaqueWrites` reports it. */
  name: string;
  source: ShapeSource;
  /** Where a `caller` shape's markup comes from — required for that kind. */
  note?: string;
}

/**
 * Files whose markup arrives from a value, and the shapes they read it from.
 *
 * A declaration here says "these expressions build markup with no control in
 * it", and `declarationGaps` holds it to that in both directions — every opaque
 * write must be covered by a declared shape, and every declared shape must
 * still appear at a write, so neither half can drift into decoration. What the
 * shapes' `source` adds is which KIND of claim that is: a `builder` is measured
 * at runtime by the twin's probe, a `literal` is read in place, and a `caller`
 * is measured by nothing and has to say so.
 */
export interface MarkupDeclaration {
  file: string;
  shapes: DeclaredShape[];
  reason: string;
}

export const OPAQUE_MARKUP: MarkupDeclaration[] = [
  {
    file: 'website/public/admin/admin.js',
    shapes: [
      { name: 'svgChart', source: 'builder' },
      { name: 'svgBarChart', source: 'builder' },
      { name: 'svgStackedBars', source: 'builder' },
      { name: 'sparkline', source: 'builder' },
      { name: 'donut', source: 'builder' },
      { name: 'donut2', source: 'builder' },
    ],
    reason:
      'the dashboard charts, their lists and their legends — every one is an SVG or a legend string returned by the helpers in admin-utils.js, and the only controls in that markup are named where their own call site builds them',
  },
  {
    file: 'website/public/admin/admin-utils.js',
    shapes: [
      {
        name: 'icon',
        source: 'caller',
        note: 'the SVG a caller passes to `kpiC` for the span beside its own labelled element — the markup comes from the call site, not from this function',
      },
    ],
    reason: 'an icon into the span beside a button whose text is set on the button itself — an SVG string, no control in it',
  },
  {
    file: 'prototypes/app.js',
    shapes: [
      { name: 'ICON_BUSY', source: 'literal' },
      { name: 'ICON_DONE', source: 'literal' },
      { name: 'COPY_ICON', source: 'literal' },
      { name: 'CHECK_ICON', source: 'literal' },
      {
        name: 'html',
        source: 'caller',
        note: 'the parameter of `stripHtml`, which parses it into a detached div and returns its text — the markup is never inserted',
      },
    ],
    reason:
      'the icons the copy and save buttons swap between states, and `stripHtml` — a reader that parses markup into a detached div and returns its textContent, never inserting it',
  },
  {
    file: 'prototypes/kds-prototype.html',
    shapes: [
      { name: 'CARET_SVG', source: 'literal' },
      { name: 'cardHTML', source: 'literal' },
      { name: 'buckets', source: 'literal' },
      { name: 'COLOR_GROUPS', source: 'literal' },
    ],
    reason:
      'an SVG caret, the card builder whose own template literal is judged at its call site, and two `map` callbacks over constants whose template literals are judged where they are written',
  },
];

/** A file to classify: its repo-relative path and its source. */
export interface SourceFile {
  path: string;
  source: string;
}

/** `file.ts` → `file.ts`; the file's own path decides how it is read. */
const isMarkupFile = (path: string): boolean => /\.(astro|tsx|html?)$/.test(path);

/**
 * Blank out everything that is not code, keeping every character's offset and
 * every newline — so a reported line number is the file's real one. Comments
 * are blanked too: a source comment that NAMES `<button>` is documentation, and
 * reading it as markup was this extractor's first bug.
 */
function codeOnly(source: string, path: string): string {
  const masked = maskComments(source);
  if (!isMarkupFile(path)) return masked;
  // In a markup-bearing file, only the script regions can build DOM. For
  // `.astro` that is the frontmatter plus client `<script>` bodies; for `.html`
  // it is the `<script>` bodies; for `.tsx` the whole file is code (its markup
  // is JSX, which the twin's template arm already judges).
  if (/\.tsx$/.test(path)) return masked;
  const regions: [number, number][] = [];
  if (/\.astro$/.test(path)) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(masked);
    if (frontmatter) regions.push([frontmatter.index, frontmatter.index + frontmatter[0].length]);
  }
  // A script tag only opens a region at the start of a line: a `<script>`
  // mentioned mid-sentence in prose is not markup, and reading one as an
  // opening tag pulled a whole page template into the region it was judged in.
  for (const match of masked.matchAll(/^[ \t]*<script\b[^>]*>([\s\S]*?)<\/script>/gim)) {
    regions.push([match.index + match[0].indexOf('>') + 1, match.index + match[0].length - '</script>'.length]);
  }
  return regions.length ? blankOutside(masked, regions) : masked.replace(/[^\n]/g, ' ');
}

/**
 * Replace comments with spaces, preserving offsets and newlines.
 *
 * Block comments first, quote-agnostically: a `/* … *\/` cannot be entered by
 * accident. Line comments second, and quote-aware — where quote-awareness means
 * a `'` or `"` string ENDS AT ITS NEWLINE (as JS requires), which is what keeps
 * a regex literal such as `/'(x)'|`(y)`/` from opening a "string" that swallows
 * the rest of the file, comments included.
 */
function maskComments(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let j = from; j < to; j += 1) if (out[j] !== '\n') out[j] = ' ';
  };
  for (let i = 0; i < source.length - 1; i += 1) {
    if (source[i] === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const stop = close === -1 ? source.length : close + 2;
      blank(i, stop);
      i = stop - 1;
    }
  }
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '/' && source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor);
      const stop = end === -1 ? source.length : end;
      blank(cursor, stop);
      cursor = stop;
      continue;
    }
    if (char === "'" || char === '"') {
      const end = source.indexOf(char, cursor + 1);
      const lineEnd = source.indexOf('\n', cursor);
      cursor = end === -1 || (lineEnd !== -1 && end > lineEnd) ? (lineEnd === -1 ? source.length : lineEnd) : end + 1;
      continue;
    }
    cursor += 1;
  }
  return out.join('');
}

/** Blank everything outside the given offsets, keeping newlines. */
function blankOutside(source: string, regions: [number, number][]): string {
  const keep = new Array(source.length).fill(false);
  for (const [start, end] of regions) for (let i = start; i < end; i += 1) keep[i] = true;
  return source
    .split('')
    .map((char, index) => (keep[index] || char === '\n' ? char : ' '))
    .join('');
}

interface RawString {
  text: string;
  start: number;
  end: number;
}

/** The index of the backtick that closes the template literal opened at `start`. */
function templateEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '$' && source[i + 1] === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      continue;
    }
    // Only a backtick at the template's own level closes it — a nested
    // template inside `${…}` would otherwise end the outer literal early, and
    // in `kds-prototype.html` the card markup lives in exactly that shape.
    if (char === '`' && depth === 0) return i;
  }
  return source.length;
}

/** Every string and template literal, template expressions walked as one piece. */
function stringsIn(source: string): RawString[] {
  const found: RawString[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== char && source[j] !== '\n') {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      if (j < source.length && source[j] === char) {
        found.push({ text: source.slice(i + 1, j), start: i, end: j + 1 });
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (char === '`') {
      const end = templateEnd(source, i);
      found.push({ text: source.slice(i + 1, end), start: i, end: end + 1 });
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return found;
}

const unescapeLiteral = (text: string): string =>
  text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(['"`\\])/g, '$1');

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

interface RawLiteral extends ControlLiteral {
  start: number;
}

/**
 * The gap between two concatenated literals. It must START with a `+`, which is
 * the anchor that keeps unrelated statements from being folded into one
 * fragment, and it may carry exactly one operand — `+ t('retry') +` — which is
 * the name of half the controls these scripts build. A `;` or `{}` means a new
 * statement, so the gap stops being a concatenation; the 200-character bound is
 * what keeps a runaway match from swallowing a function body.
 *
 * A gap that fails is not fatal to the run: the caller looks at the NEXT
 * literal, because a failed gap is what an operand's own argument looks like
 * (`+ t('retry') +` holds a quoted string, and that string is a literal too).
 */
const OPERAND_ONLY = /^\s*\+\s*(?:[^;{}]{0,200}\s*\+\s*)?$/;

/** Every literal, with the literals concatenated to it folded into one fragment. */
function concatenationsIn(source: string): RawLiteral[] {
  const literals = stringsIn(source);
  const runs: RawLiteral[] = [];
  let index = 0;
  while (index < literals.length) {
    const first = literals[index];
    let text = unescapeLiteral(first.text);
    let cursor = first.end;
    let last = index;
    for (let k = index + 1; k < literals.length; k += 1) {
      const gap = source.slice(cursor, literals[k].start);
      if (gap.length > 220) break;
      if (!OPERAND_ONLY.test(gap)) continue;
      text += '{expr}' + unescapeLiteral(literals[k].text);
      cursor = literals[k].end;
      last = k;
    }
    runs.push({ text, line: lineAt(source, first.start), start: first.start });
    index = last + 1;
  }
  return runs;
}

/** The markup of one control element, if the file writes one as a string. */
function controlLiteralsIn(code: string, path: string): { judged: ControlLiteral[]; partial: ControlLiteral[] } {
  const judged: ControlLiteral[] = [];
  const partial: ControlLiteral[] = [];
  for (const run of concatenationsIn(code)) {
    if (!CONTROL_OPEN.test(run.text)) continue;
    // In a `.ts`/`.tsx` file a control-bearing string is markup only when it is
    // written through a DOM property: a JSX attribute is a quoted string too,
    // and its value is not markup. In a plain script, markup strings are the
    // norm and there is no JSX to confuse them with.
    if (/\.(tsx|ts)$/.test(path) && !DOM_WRITE.test(code.slice(Math.max(0, run.start - 80), run.start))) continue;
    if (!CONTROL_COMPLETE.test(run.text) && !VOID_COMPLETE.test(run.text)) {
      partial.push({ text: run.text, line: run.line });
      continue;
    }
    judged.push({ text: run.text, line: run.line });
  }
  return { judged, partial };
}

/** `document.createElement('button')` with a literal tag, plus the block after it. */
function constructedControlsIn(code: string): { constructed: ConstructedControl[]; untaggedCreates: number[] } {
  const constructed: ConstructedControl[] = [];
  const untaggedCreates: number[] = [];
  const flat = blankLiteralContents(code);
  const CREATE = /document\.createElement\(\s*([^)]*?)\s*\)/g;
  CREATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREATE.exec(code))) {
    const literal = TAG_ARGUMENT.exec(match[1].trim());
    if (!literal) {
      untaggedCreates.push(match.index);
      continue;
    }
    const tag = literal[2].toLowerCase();
    if (!CONTROL_TAGS.includes(tag)) continue;
    const binding = bindingBefore(flat, match.index);
    // The block a name is set in: to the end of the statement run.
    const rest = code.slice(match.index + match[0].length);
    const stop = rest.search(/\n\s*\n/);
    constructed.push({
      tag,
      line: lineAt(code, match.index),
      block: rest.slice(0, stop === -1 ? 480 : stop),
      named: namesControl(code, match.index + match[0].length, binding),
    });
  }
  return { constructed, untaggedCreates };
}

/**
 * A local element factory: a function in the codebase that hands its own first
 * parameter to `document.createElement`, which is how `el(tag, cls, text)`
 * works in `admin-utils.js` and how every admin control is built.
 */
export interface LocalFactory {
  name: string;
  /** Parameter index whose argument becomes the element's text — a name. */
  nameParam?: number;
  line: number;
  /** Where the factory lives, and the span of its body. */
  file: string;
  start: number;
  end: number;
}

/** Replace every literal's CONTENT with spaces, keeping quotes and offsets. */
function blankLiteralContents(code: string): string {
  const chars = code.split('');
  for (const literal of stringsIn(code)) {
    for (let i = literal.start + 1; i < literal.end - 1; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/** The index of the `)` matching the `(` at `open`, or -1. */
function matchParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (!depth) return i;
    }
  }
  return -1;
}

/** The index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (!depth) return i;
    }
  }
  return -1;
}

/** Top-level arguments of a call, given the offsets of its parentheses. */
function argumentsOf(code: string, from: number, to: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i += 1) {
    const char = code[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && !depth) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = code.slice(start, to).trim();
  if (last) args.push(last);
  return args;
}

/**
 * Every factory in one file. `nameParam` is read off the body — the parameter
 * the factory assigns to `textContent` or `innerHTML` is the one a call site
 * names its control with.
 */
function factoriesIn(file: SourceFile): LocalFactory[] {
  const code = codeOnly(file.source, file.path);
  const flat = blankLiteralContents(code);
  const found: LocalFactory[] = [];
  const DECL = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\s*)?\()/g;
  DECL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECL.exec(flat))) {
    const name = match[1] ?? match[2];
    const open = flat.indexOf('(', match.index + match[0].length - 1);
    const close = matchParen(flat, open);
    if (close === -1) continue;
    const params = argumentsOf(flat, open + 1, close).filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
    if (!params.length) continue;
    const brace = flat.indexOf('{', close);
    const end = brace === -1 ? -1 : matchBrace(flat, brace);
    if (end === -1) continue;
    const flatBody = flat.slice(brace, end);
    if (!new RegExp(`createElement\\(\\s*${params[0]}\\s*\\)`).test(flatBody)) continue;
    const assigns = new RegExp(`\\.(?:textContent|innerHTML)\\s*\\+?=\\s*(${params.join('|')})\\b`).exec(flatBody);
    found.push({
      name,
      nameParam: assigns ? params.indexOf(assigns[1]) : undefined,
      line: lineAt(code, match.index),
      file: file.path,
      start: brace,
      end,
    });
  }
  return found;
}

/** The factories across a set of files — one is defined in a shared helper. */
export function factoryRegistry(files: SourceFile[]): LocalFactory[] {
  return files.flatMap((file) => factoriesIn(file));
}

/** The attribute names that name an element, as source spells them. */
const NAME_ATTRIBUTES = 'aria-label|aria-labelledby|title';

/** The variable a call's result is bound to, when the call is `const x = f(`. */
function bindingBefore(flat: string, at: number): string | undefined {
  const before = flat.slice(Math.max(0, at - 160), at);
  return /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)?.[1];
}

/**
 * Whether the code names the control built at `at`.
 *
 * The subject is the VARIABLE the element is bound to — `const el = …;` then
 * `el.setAttribute('aria-label', …)` — because "some `.textContent =` assignment
 * within the next 500 characters" is not the same claim: in `admin.js` the
 * grant dialog's selects and number fields sit four to a statement run, and a
 * block-scoped rule read the error line's `textContent` as their own name and
 * passed all of them. Where a call's result is not bound to a variable the
 * statement run is all there is, so that is what a name may be found in.
 */
function namesControl(source: string, at: number, binding?: string): boolean {
  const scope = binding ? source.slice(at) : source.slice(at, at + 480);
  const subject = binding ? `${binding.replace(/\$/g, '\\$')}\\s*\\.\\s*` : '';
  // Read on the raw scope, NOT on `blankLiteralContents`: the attribute name
  // this looks for is itself a string literal (`setAttribute('aria-label', …)`),
  // and blanking literal contents — which the innerHTML arm needs — erased it
  // and reported every named-by-setAttribute control as unnamed.
  if (new RegExp(`${subject}setAttribute\\(\\s*['"](?:${NAME_ATTRIBUTES})['"]`).test(scope)) return true;
  if (new RegExp(`${subject}(?:ariaLabel|ariaLabelledBy|title)\\s*=`).test(scope)) return true;
  if (new RegExp(`${subject}(?:textContent|innerText)\\s*[+]?=\\s*[^;\\s]`).test(scope)) return true;
  if (new RegExp(`${subject}htmlFor\\s*=`).test(scope)) return true;
  // `innerHTML` names the element only when the literal it is given carries
  // text: `innerHTML = '<svg …>'` is an icon, and an icon-only button is the
  // classic unnamed control.
  const literals = stringsIn(scope);
  for (const write of scope.matchAll(new RegExp(`${subject}innerHTML\\s*[+]?=`, 'g'))) {
    const next = literals.find((literal) => literal.start > write.index);
    if (next && visibleText(unescapeLiteral(next.text))) return true;
  }
  return false;
}

/** Whether a literal's markup carries text a reader hears (a name for a control). */
const visibleText = (literal: string): boolean =>
  unnamedControls(`<button>${literal}</button>`).length === 0;

/**
 * The controls a local factory builds, judged at each call site that passes a
 * literal control tag. This is the arm that reaches the admin dashboard: not
 * one of its controls is a `createElement` call or a markup string.
 */
function factoryControlsIn(
  code: string,
  factories: LocalFactory[],
): { judged: FactoryControl[]; unresolved: number[] } {
  const flat = blankLiteralContents(code);
  const judged: FactoryControl[] = [];
  const unresolved: number[] = [];
  for (const factory of factories) {
    const CALL = new RegExp(`(?<![\\w$.])${factory.name}\\s*\\(`, 'g');
    CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL.exec(flat))) {
      // The factory's own definition is not one of its call sites.
      if (/function\s+$/.test(flat.slice(Math.max(0, match.index - 12), match.index))) continue;
      const open = flat.indexOf('(', match.index + match[0].length - 1);
      const close = matchParen(flat, open);
      if (close === -1) continue;
      const args = argumentsOf(code, open + 1, close);
      const tag = TAG_ARGUMENT.exec(args[0] ?? '');
      if (!tag) {
        // Not decidable — the tag is a variable and this arm cannot follow it.
        // Recorded rather than skipped, so the limit is a gap it reports and an
        // author has to declare, instead of a silence nobody can see.
        unresolved.push(lineAt(code, match.index));
        continue;
      }
      if (!CONTROL_TAGS.includes(tag[2].toLowerCase())) continue;
      const nameArg = factory.nameParam === undefined ? undefined : args[factory.nameParam];
      const named =
        (nameArg !== undefined && !/^['"]{2}$/.test(nameArg) && nameArg !== 'undefined' && nameArg !== 'null') ||
        namesControl(code, close + 1, bindingBefore(flat, match.index));
      judged.push({ tag: tag[2].toLowerCase(), line: lineAt(code, match.index), named });
    }
  }
  return { judged, unresolved };
}

/**
 * The DOM APIs that take MARKUP rather than text. `textContent`/`innerText` are
 * deliberately absent: they cannot carry an element, so a value given to them is
 * not an unreadable control.
 */
const MARKUP_WRITE = /(?:innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(/g;

/**
 * Markup written into the DOM from a right-hand side this rule cannot read.
 *
 * The test is deliberately blunt, and blunt is the point: either the right-hand
 * side BEGINS with a string or template literal — which the literal arm above
 * has already read, controls and all — or it is a value, and nothing at this
 * write says what it contains. A partially literal right-hand side is opaque
 * too (`COPY_ICON + '<span>Copy</span>'`): the half this rule can read is judged,
 * the half it cannot is what the declaration answers for.
 *
 * The shape is the right-hand side's leading token, because that is the unit a
 * declaration can honestly claim: `svgChart(…)` and `donut.svg` in `admin.js`
 * are SVG strings, while a NEW expression in that same file is one nobody has
 * looked at, and inherits nothing from the file's declaration.
 */
function opaqueWritesIn(code: string): OpaqueWrite[] {
  const found: OpaqueWrite[] = [];
  MARKUP_WRITE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKUP_WRITE.exec(code))) {
    let cursor: number;
    if (match[0].endsWith('(')) {
      // `insertAdjacentHTML('beforeend', markup)` — the markup is the SECOND
      // argument, so the position has to be stepped over to reach it.
      const open = match.index + match[0].length - 1;
      const close = matchParen(code, open);
      const comma = code.indexOf(',', open);
      if (close === -1 || comma === -1 || comma > close) continue;
      cursor = comma + 1;
    } else {
      cursor = match.index + match[0].length;
    }
    while (code[cursor] === '(') cursor += 1;
    // To the end of the statement: a message that ran on into the NEXT write
    // says less about this one, and the line number already locates it.
    const rhs = code
      .slice(cursor, cursor + 64)
      .split(';')[0]
      .replace(/\s+/g, ' ')
      .trim();
    // A literal right-hand side is READ, not declared — and an empty one is not
    // markup at all.
    if (!rhs || /^['"`]/.test(rhs)) continue;
    const shape = /^[A-Za-z_$][\w$]*/.exec(rhs)?.[0];
    if (!shape) continue;
    found.push({ line: lineAt(code, match.index), shape, rhs: rhs.slice(0, 44) });
  }
  return found;
}

/**
 * What one file builds, from the code it contains. `factories` is the registry
 * for the whole codebase by default, because the factory a file calls is
 * usually defined in another one (`admin-utils.js`).
 */
export function controlEvidenceIn(file: SourceFile, factories?: LocalFactory[]): ControlEvidence {
  const code = codeOnly(file.source, file.path);
  const { judged, partial } = controlLiteralsIn(code, file.path);
  const { constructed, untaggedCreates } = constructedControlsIn(code);
  const { judged: factoryControls, unresolved: unresolvedCalls } = factoryControlsIn(
    code,
    factories ?? factoriesIn(file),
  );
  return {
    literals: judged,
    constructed,
    untaggedCreates,
    partial,
    factoryControls,
    unresolvedCalls,
    opaqueWrites: opaqueWritesIn(code),
  };
}

const NAME_GAP =
  'never names it in the block that follows — no aria-label, title, textContent, text-bearing innerHTML or label it names';

/**
 * Where a control a script builds has no name, read off evidence already in
 * hand. Messages carry the line, so a failure points at the missing assignment
 * rather than at the file.
 */
function unnamedIn(evidence: ControlEvidence): string[] {
  const issues: string[] = [];
  for (const fragment of evidence.literals) {
    for (const message of unnamedControls(fragment.text).filter((issue) =>
      new RegExp(`<(${CONTROL_TAGS.join('|')})\\b`).test(issue),
    )) {
      issues.push(`line ${fragment.line}: ${message}`);
    }
  }
  for (const control of evidence.constructed) {
    if (control.named) continue;
    issues.push(`line ${control.line}: builds a <${control.tag}> with createElement and ${NAME_GAP}`);
  }
  for (const control of evidence.factoryControls) {
    if (control.named) continue;
    issues.push(`line ${control.line}: builds a <${control.tag}> through an element factory and ${NAME_GAP}`);
  }
  return issues;
}

/**
 * The same verdict for one file, parsed on its own — the per-file view the twin
 * asserts file by file. The aggregate path builds its evidence once for the
 * whole tree; this one exists so a failure can name a single file cheaply.
 */
export function scriptControlIssues(file: SourceFile, factories?: LocalFactory[]): string[] {
  return unnamedIn(controlEvidenceIn(file, factories));
}

const declared = (path: string, list: Declaration[]): Declaration | undefined =>
  list.find((entry) => entry.file === path);

/**
 * Every source file the boundary covers, read from disk.
 *
 * Paths are repo-relative with forward slashes, so a finding names the file a
 * reader can open and the two callers agree on a key. One walk, one skip list,
 * one extension list — a third caller cannot invent its own scope.
 */
export function collectScriptSources(repoRoot: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (absolute: string, relative: string): void => {
    for (const name of readdirSync(absolute).sort()) {
      const path = join(absolute, name);
      const key = `${relative}/${name}`;
      const probe = `/${key}/`;
      if (statSync(path).isDirectory()) {
        if (!SKIPPED_SEGMENTS.some((segment) => probe.includes(segment))) walk(path, key);
      } else if (SOURCE_FILE.test(name) && !SKIPPED_SEGMENTS.some((segment) => probe.includes(segment))) {
        out.push({ path: key, source: readFileSync(path, 'utf8') });
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(join(repoRoot, ...root.split('/')), root);
  return out;
}

/**
 * The paths a name declaration answers for. A declared file is held to its
 * declaration (is it still needed?) rather than judged by the name arm, so the
 * two callers must agree on which files those are — `AccountLicense` would
 * otherwise be reported as an unnamed control by the gate and silently skipped
 * by the twin.
 *
 * `OPAQUE_MARKUP` is deliberately NOT in this set: answering for a file's
 * unreadable markup strings is not a licence to stop naming the controls it
 * builds in code. `admin.js` is declared for its chart SVGs and still judged for
 * its 42 factory call sites.
 */
export const declaredFiles = (): Set<string> =>
  new Set([...UNJUDGEABLE, ...NOT_OPERABLE].map((entry) => entry.file));

/** The declaration that answers for a file's unreadable markup, if any. */
const declaredMarkup = (path: string): MarkupDeclaration | undefined =>
  OPAQUE_MARKUP.find((entry) => entry.file === path);

/** What a finding is about, so a caller can report the halves differently. */
export type FindingKind = 'name' | 'boundary' | 'opaque';

/** One verdict about one source file. */
export interface Finding {
  file: string;
  message: string;
  kind: FindingKind;
}

/**
 * What the printed boundary reports — the limit, as data rather than prose.
 *
 * Every number is the thing its name says. That is worth stating because the
 * pair this replaced was not: `opaqueFiles` counted DECLARATIONS, so a fifth
 * file writing markup nobody could read still printed "4 … 108 judged" — the
 * file was neither judged nor declared and the boundary said nothing about it.
 * `opaque.files` counts the files that write such markup, and the declaration is
 * a property of those files rather than a stand-in for counting them.
 */
export interface BoundarySummary {
  /** Files the walk produced. */
  walked: number;
  /** Of those, the ones the name arm judged — the rest are declared. */
  judged: number;
  /** Files a declaration answers for (`UNJUDGEABLE` + `NOT_OPERABLE`). */
  declared: number;
  /** The markup this rule could not read, counting files rather than promises. */
  opaque: {
    /** Files that write markup from a value at least once. */
    files: number;
    /** Of those, the ones a declaration covers. */
    declared: number;
    /** Of those, the ones reported because nothing covers them. */
    undeclared: number;
    /** Sites at which such markup is written. */
    sites: number;
  };
  /** Declared shapes by how their markup can be checked. */
  shapes: { builder: number; literal: number; caller: number };
  roots: string[];
  skipped: string[];
}

/** One pass over the tree: what each file yields, and the two verdicts from it. */
interface Survey {
  names: Finding[];
  gaps: Finding[];
  summary: BoundarySummary;
}

/**
 * The single pass every verdict comes from.
 *
 * It exists because the two halves used to be computed by two exports that each
 * re-derived the other's work: the gap list folded per-file name issues into
 * its own output while the name list produced them again, so the gate ran two
 * loops over identical data and printed every script-control defect TWICE (one
 * defect, `FAIL 2`). Here each file's evidence is built once and each verdict is
 * raised once, and the boundary the gate prints is derived from the same pass.
 */
function survey(files: SourceFile[]): Survey {
  const factories = factoryRegistry(files);
  const exempt = declaredFiles();
  const declaredShapes = OPAQUE_MARKUP.flatMap((entry) => entry.shapes);
  const ownBody = (file: string, at: number): boolean =>
    factories.some((factory) => factory.file === file && at >= factory.start && at <= factory.end);
  const names: Finding[] = [];
  const gaps: Finding[] = [];
  let declaredCount = 0;
  let opaqueFiles = 0;
  let opaqueDeclared = 0;
  let opaqueUndeclared = 0;
  let opaqueSites = 0;
  for (const file of files) {
    const evidence = controlEvidenceIn(file, factories);
    const unjudgeable = declared(file.path, UNJUDGEABLE);
    const notOperable = declared(file.path, NOT_OPERABLE);
    const markup = declaredMarkup(file.path);
    const gap = (kind: FindingKind, message: string): void => {
      gaps.push({ file: file.path, kind, message });
    };
    if (unjudgeable || notOperable) declaredCount += 1;
    // The count is of FILES THAT WRITE unreadable markup, not of declarations:
    // a fifth file doing so with no declaration is the case the old count could
    // not express, because it had no row to add to.
    if (evidence.opaqueWrites.length) {
      opaqueFiles += 1;
      if (markup) opaqueDeclared += 1;
      else opaqueUndeclared += 1;
      opaqueSites += evidence.opaqueWrites.length;
    }
    const builds =
      evidence.literals.length +
      evidence.constructed.length +
      evidence.partial.length +
      evidence.factoryControls.length +
      evidence.unresolvedCalls.length +
      evidence.untaggedCreates.length +
      evidence.opaqueWrites.length;
    if (!builds) {
      if (unjudgeable || notOperable || markup) {
        gap('boundary', 'is declared in script-controls.ts but no longer builds a control — remove the declaration');
      }
      continue;
    }
    if (unjudgeable) {
      if (!evidence.untaggedCreates.length && !evidence.unresolvedCalls.length && !evidence.opaqueWrites.length) {
        gap('boundary', 'is declared UNJUDGEABLE but everything it builds is decidable now — remove the declaration');
      }
      continue;
    }
    const unnamed = unnamedIn(evidence);
    if (notOperable) {
      if (!unnamed.length && !evidence.opaqueWrites.length) {
        gap('boundary', 'is declared NOT_OPERABLE but its controls are all named now — remove the declaration');
      }
    } else {
      for (const message of unnamed) names.push({ file: file.path, kind: 'name', message });
    }
    if (evidence.partial.length) {
      gap(
        'boundary',
        `writes control markup its own literal does not complete (line ${evidence.partial[0].line}) — judge it or declare the file in script-controls.ts`,
      );
    }
    // A factory's own `createElement(tag)` takes the tag as a parameter by
    // design — its call sites are what this rule judges — so it is not a gap.
    const untagged = evidence.untaggedCreates.filter((at) => !ownBody(file.path, at));
    if (untagged.length) {
      const code = codeOnly(file.source, file.path);
      gap(
        'boundary',
        `calls document.createElement with a tag that is not a literal (line ${lineAt(code, untagged[0])}) — declare the file in script-controls.ts`,
      );
    }
    if (evidence.unresolvedCalls.length) {
      gap(
        'boundary',
        `builds a control through an element factory whose tag is not a literal (line ${evidence.unresolvedCalls[0]}) — judge the call or declare the file in script-controls.ts`,
      );
    }
    // The markup this rule can never read. Undeclared, the first site is named —
    // which is the difference between a limit that is declared and one that is
    // silent, and the reason a live `box.innerHTML = someCard` is a finding
    // rather than a shrug.
    if (evidence.opaqueWrites.length) {
      if (!markup) {
        const first = evidence.opaqueWrites[0];
        gap(
          'opaque',
          `writes markup at line ${first.line} whose right-hand side is not a literal (\`${first.rhs}\`) — say what it builds and declare the file in OPAQUE_MARKUP`,
        );
      } else {
        const covered = new Set(markup.shapes.map((shape) => shape.name));
        const uncovered = evidence.opaqueWrites.find((write) => !covered.has(write.shape));
        if (uncovered) {
          gap(
            'opaque',
            `writes markup at line ${uncovered.line} from \`${uncovered.shape}\`, which the OPAQUE_MARKUP declaration for this file does not cover — judge the site or add the shape`,
          );
        }
      }
    }
    if (markup) {
      const written = new Set(evidence.opaqueWrites.map((write) => write.shape));
      const unused = markup.shapes.filter((shape) => !written.has(shape.name));
      if (unused.length) {
        gap(
          'opaque',
          `declares the shape${unused.length > 1 ? 's' : ''} ${unused.map((shape) => `\`${shape.name}\``).join(', ')} in OPAQUE_MARKUP but writes no markup from ${unused.length > 1 ? 'them' : 'it'} — remove ${unused.length > 1 ? 'them' : 'it'}`,
        );
      }
      // A `caller` shape is the one kind nothing here checks, so it has to name
      // where its markup comes from. Without that it reads exactly like a
      // `builder`, whose output the twin probes.
      const unexplained = markup.shapes.filter((shape) => shape.source === 'caller' && !shape.note);
      if (unexplained.length) {
        gap(
          'opaque',
          `declares \`${unexplained[0].name}\` as supplied by a caller without saying where from — a shape nothing checks has to say so`,
        );
      }
    }
  }
  return {
    names,
    gaps,
    summary: {
      walked: files.length,
      judged: files.filter((file) => !exempt.has(file.path)).length,
      declared: declaredCount,
      opaque: {
        files: opaqueFiles,
        declared: opaqueDeclared,
        undeclared: opaqueUndeclared,
        sites: opaqueSites,
      },
      shapes: {
        builder: declaredShapes.filter((shape) => shape.source === 'builder').length,
        literal: declaredShapes.filter((shape) => shape.source === 'literal').length,
        caller: declaredShapes.filter((shape) => shape.source === 'caller').length,
      },
      roots: SOURCE_ROOTS,
      skipped: SKIPPED_SEGMENTS,
    },
  };
}

/** Every unnamed control the boundary judges, attributed to the file it is in. */
export function nameIssues(files: SourceFile[]): Finding[] {
  return survey(files).names;
}

/**
 * Every file this rule cannot judge, and every declaration it no longer needs.
 * Both directions, so an exemption list cannot quietly become a place to hide.
 */
export function declarationGaps(files: SourceFile[]): Finding[] {
  return survey(files).gaps;
}

/**
 * The one verdict path. Every finding, exactly once, plus the boundary the gate
 * prints — raised in a single pass so the two can never disagree about a file.
 */
export function scriptControlVerdict(files: SourceFile[]): { findings: Finding[]; summary: BoundarySummary } {
  const done = survey(files);
  return { findings: [...done.names, ...done.gaps], summary: done.summary };
}
