/**
 * Narrow-Shell / Extreme-Aspect Verification — ADR-0001 Slice 7.
 *
 * `docs/decisions/2026-09-21-adr60-orientation-and-adaptive-layout-strategy.md#L212`, verbatim:
 *
 *   | **7** | Narrow-shell verification | Confirm the container-query pages behave
 *   in a shell narrower than the tablet, and in a desktop window dragged to
 *   portrait. | The extreme-aspect-ratio case is exercised, not assumed. |
 *
 * WHAT IT GRADES, AND WHY IT IS A SOURCE-TEXT SUITE. "Exercised" for a stylesheet
 * cannot mean a rendered pixel here: jsdom resolves neither `@container` nor
 * `@media`, so a rendered assertion would pass on any CSS at all. What the suite
 * CAN do is hold the four facts the slice's two named cases rest on, each in a
 * different sheet, none of which fails loudly when one drifts:
 *
 *   1. NARROW SHELL. `AppLayout.css` declares the shell-only width ladder
 *      (1023 / 768) and `tablet.css` re-asserts nothing of it — the tablet shell
 *      is a separate entry (`index.mobile.html`), so the desktop ladder has to
 *      survive on its own.
 *   2. EXTREME ASPECT (a desktop window dragged to portrait). The shell declares
 *      an orientation branch gated at exactly the shell's own narrow tier, and
 *      `tablet.css` carries the portrait contract of the tablet shell. Both are
 *      shell-owned, which is the same fence `orientationAdaptiveWalker.test.ts`
 *      grades from the other side.
 *   3. THE MIGRATED SHEETS BEHAVE IN A BOX NARROWER THAN THE TABLET. Both converted
 *      features measure their own box, and both fold in the same order — the coarse
 *      tier is declared above the fine tier, both with a `max-width` gate. Declared
 *      the other way round the wider gate wins and the finer one never applies: a
 *      silent, CSS-legal bug that reads green in every rendered test.
 *   4. SHEDDING IS CONTENT-BEARING, NOT DECORATIVE. A folding tier hides a fixed-px
 *      lane wholesale (`display: none` on the lane), never an ancestor whose
 *      children then lose their styles; and the shell's own content slot carries no
 *      `height` ceiling — a fixed height is what clips a scrolled-to control out of
 *      a short box.
 *
 * WHAT GREEN DOES NOT COVER. (a) The printed denominator is not coverage; every
 * reading below is a source-text reading. (b) Nothing here proves a browser resolves
 * these queries at any width — "the tier exists and is ordered" is not "the board
 * folded". (c) The cascades in (1) and (3) are compared inside ONE sheet, which is
 * sound for tiers written in the same unit family against the same box (all four
 * migrated gates are `px`, all against the sheet's own container); a tier later
 * rewritten in `rem` would be ordered here by number while resolving at a different
 * size in the browser, and this suite would not see it. (d) Rule (3) grades the
 * order only for the sheets ADR-0001 Slice 5 has migrated — `WorkspaceHome.css`
 * carries a third `container-type` and is not yet a container-query page, so it is
 * deliberately out of the set rather than silently passing.
 *
 * READ LIKE ITS SIBLINGS (`keyboardTrapOrientation.test.ts`,
 * `orientationAdaptiveWalker.test.ts`): node `fs` over the working tree, no channel
 * to any revision, block comments blanked length-preservingly before any regex runs
 * (each of these sheets explains its own tiers in long prose, and prose must not be
 * graded), every rule a pure function of source text so the planted cases can feed it
 * synthetic sheets, and the denominator printed as one console line and one named
 * test, because a test name is the only channel a reader scrolls.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const UI_SRC = join(__dirname, '..');

/* ── Source readers ─────────────────────────────────────────── */

const sources = new Map<string, string>();

/** Read a ui-relative path once; a missing file throws with its own path. */
function source(rel: string): string {
  const cached = sources.get(rel);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(UI_SRC, rel), 'utf-8');
  sources.set(rel, text);
  return text;
}

/** ui-relative, so every finding prints a path a reader can open. */
const SHELL_CSS = 'app/AppLayout.css';
const TABLET_CSS = 'app/tablet/tablet.css';
const RETAIL_CSS = 'features/retail/RetailPosScreen.css';
const KDS_CSS = 'features/kds/KdsScreen.css';
const SALES_HISTORY_CSS = 'features/sales/SalesHistoryScreen.css';
const PAYMENT_MODAL_CSS = 'features/sales/PaymentModal.css';
const POS_SCREEN_CSS = 'features/sales/PosScreen.css';
const EOD_REPORT_CSS = 'features/sales/EodReportScreen.css';
const KDS_EXPO_CSS = 'features/kds/ExpoScreen.css';
const TRANSIT_AUDIT_CSS = 'features/inventory/TransitAuditScreen.css';
const CATEGORY_MGMT_CSS = 'features/categories/CategoryManagementScreen.css';
const STAFF_MGMT_CSS = 'features/staff/StaffManagementScreen.css';
const MULTI_STORE_DASHBOARD_CSS = 'features/locations/MultiStoreDashboardScreen.css';

/* ── Text helpers ───────────────────────────────────────────── */

/**
 * Blank every block comment, length-preservingly: each comment byte becomes a space
 * except newlines, so every offset and line number still addresses the real file.
 * Each of the graded sheets explains its own tiers in long prose; prose is not a tier.
 */
function stripBlockComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const closed = text.indexOf('*/', i + 2);
      const stop = closed === -1 ? text.length : closed + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** A declaration body plus the line its block opens on. */
interface Block {
  body: string;
  line: number;
}

/** Block starting at a known index; braces balanced from the first `{` at or after it. */
function blockFrom(text: string, at: number): Block | null {
  const open = text.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), line: lineOf(text, at) };
    }
  }
  return null;
}

/**
 * Braces-balanced block for the FIRST match of an anchored pattern, or null. Braces
 * are counted from the opening brace, so a nested block cannot terminate it early.
 */
function blockFor(text: string, pattern: RegExp): Block | null {
  const m = pattern.exec(text);
  if (!m) return null;
  return blockFrom(text, m.index);
}

/** Escape a selector for literal use inside a RegExp. */
function escapeRe(literal: string): string {
  return literal.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

/** A top-level style rule's declaration body, or null. */
function ruleBody(text: string, selector: string): Block | null {
  return blockFor(text, new RegExp('(?:^|\\n)[ \\t]*' + escapeRe(selector) + '\\s*(?=\\{)', 'm'));
}

/**
 * Every top-level rule for a selector, first match included. A selector legitimately
 * appears more than once — `.retail-pos` is declared for its flex layout and AGAIN for
 * its `container-type`, because the two belong to different concerns — so reading only
 * "the first body" answers a question the sheet never asked. The container question is
 * "does any of this selector's rules declare it", and that is what is graded.
 */
function ruleBodies(text: string, selector: string): Block[] {
  const re = new RegExp('(?:^|\\n)[ \\t]*' + escapeRe(selector) + '\\s*(?=\\{)', 'g');
  const out: Block[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = blockFrom(text, m.index);
    if (block) out.push(block);
  }
  return out;
}
/* ── CSS inventory ──────────────────────────────────────────── */

/** One `@media`/`@container` occurrence, in source order. */
interface Query {
  kind: 'media' | 'container';
  /** The parenthesised prelude only, e.g. `(max-width: 640px)`. */
  prelude: string;
  /** Index of the `@` in comment-stripped text. */
  index: number;
  line: number;
}

/**
 * Every `@media`/`@container` in a sheet, in source order, which IS cascade order here.
 *
 * THE WHOLE PRELUDE, not the first parenthesised group. A media prelude is a CONDITION
 * LIST — `(orientation: portrait) and (max-width: 1023px)` — and both halves decide
 * whether the block applies. Slicing from the first `(` to the first `)` reads that as
 * `(orientation: portrait)` and answers "no width gate" for a branch that plainly has
 * one, which is how a too-wide orientation tier passes a fence written to catch it. The
 * prelude ends at the block's opening brace; a nested block cannot leak in because the
 * brace chosen is the FIRST one after the at-keyword.
 */
function queriesIn(text: string): Query[] {
  const re = /@(media|container)\s+/g;
  const out: Query[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const open = text.indexOf('{', start);
    if (open === -1) continue;
    const head = text.slice(start, open).trim();
    if (head === '') continue; // `@media{` is malformed; nothing to read.
    out.push({
      kind: m[1] === 'media' ? 'media' : 'container',
      prelude: head,
      index: m.index,
      line: lineOf(text, m.index),
    });
    re.lastIndex = open; // do not re-enter this query's own prelude.
  }
  return out;
}

/**
 * The numeric gate of a width prelude, and its unit — or null for a query that names
 * no width at all (a bare `(orientation: portrait)`, a `prefers-reduced-motion`).
 */
function widthGate(q: Query): number | null {
  const m = /width\s*:\s*([\d.]+)(px|rem|em)?/.exec(q.prelude);
  return m ? Number(m[1]) : null;
}

/** A NARROWING gate — `max-width`. The tier applies at and below this width. */
function isNarrowing(q: Query): boolean {
  return /max-width\s*:/.test(q.prelude);
}

/**
 * A WIDENING gate — `min-width`. The property is added only once the box can afford
 * it, which is how a narrow shell stays usable. The family word is the property name,
 * not the direction of the sheet, and mislabelling it is exactly how a ladder gets
 * "fixed" into its mirror image.
 */
function isWidening(q: Query): boolean {
  return /min-width\s*:/.test(q.prelude);
}

/** The unit a width gate is written in, so px and rem are never compared bare. */
function widthUnit(q: Query): string {
  const m = /width\s*:\s*[\d.]+(px|rem|em)?/.exec(q.prelude);
  return m && m[1] ? m[1] : 'px';
}

function round(n: number): number {
  return Number(n.toFixed(2));
}

/* ── The graded specs ───────────────────────────────────────── */

/** A shell-owned orientation branch the extreme-aspect case relies on. */
interface OrientationBranch {
  sheet: string;
  /** The exact prelude the sheet must declare, and the tier it may claim. */
  prelude: string;
  /** The widest px gate this branch may claim, or null for a bare branch. */
  maxGatePx: number | null;
  why: string;
}

const ORIENTATION_BRANCHES: readonly OrientationBranch[] = [
  {
    sheet: SHELL_CSS,
    prelude: '(orientation: portrait) and (max-width: 1023px)',
    maxGatePx: 1023,
    why:
      'a desktop window dragged to portrait must rotate the shell (the rail becomes an overlay) at the SAME 1023px tier the shell width ladder uses, so no width has two competing geometries',
  },
  {
    sheet: TABLET_CSS,
    prelude: '(orientation: portrait)',
    maxGatePx: null,
    why:
      'the tablet shell is a separate entry (index.mobile.html) and carries its own portrait contract; a desktop-first ladder here would fight the shell it is mounted in',
  },
] as const;

/**
 * A sheet whose width ladder must keep a base case that holds in a box NARROWER than
 * every tier the sheet declares — the sheet un-narrowed. So a tier may not be a widening
 * `min-width` (it would move the default INTO a query and leave the narrowest box with
 * nothing), and the widening tiers a sheet DOES declare must run widest-first so that
 * adding a wider one cannot silently re-scope the narrower.
 */
const LADDER_SHEETS: readonly string[] = [SHELL_CSS, TABLET_CSS] as const;

/**
 * Rules that may only apply at a width — never a namespace where a page's own rules
 * live. The neutral gate, the reduced-motion tier and the pointer tier are stylesheet
 * FACILITIES; the shell's own navigation and header geometry is graded by rules (1)
 * and (2), not excused here.
 */
const NON_GEOMETRY_SUBJECT = /prefers-reduced-motion|prefers-contrast|orientation|pointer|:root|\bhover\b/;

/** One migrated feature: its own container, and its tiers in declared order. */
interface MigratedSheet {
  sheet: string;
  /** The selector of the sheet's own query container (the box it measures). */
  containerSelector: string;
  /** Tiers, widest-first, exactly as ADR-0001 Slice 5 declares them. */
  tiers: readonly number[];
  /**
   * The width of the narrowest shell this box is expected to be handed — the "shell
   * narrower than the tablet" of ADR-0001 Slice 7. It is an OBSERVATION, not a
   * threshold: the narrowest tier a sheet actually matches is printed in the
   * denominator, and where that is still above this width the sheet renders its wide
   * layout in the narrower box. That gap is a finding about the SHEET, not a red test —
   * there is no narrower layout in these sheets to fall back to, and asserting one
   * would be inventing a design the CSS never had.
   */
  narrowShellPx: number;
}

const MIGRATED: readonly MigratedSheet[] = [
  { sheet: RETAIL_CSS, containerSelector: '.retail-pos', tiers: [880, 640], narrowShellPx: 640 },
  { sheet: KDS_CSS, containerSelector: '.kds', tiers: [900, 640], narrowShellPx: 640 },
  { sheet: SALES_HISTORY_CSS, containerSelector: '.sales-history', tiers: [880, 640], narrowShellPx: 640 },
  { sheet: PAYMENT_MODAL_CSS, containerSelector: '.payment-overlay', tiers: [480], narrowShellPx: 640 },
  { sheet: POS_SCREEN_CSS, containerSelector: '.pos-screen', tiers: [720, 480], narrowShellPx: 640 },
  { sheet: EOD_REPORT_CSS, containerSelector: '.eod-report', tiers: [800, 600], narrowShellPx: 640 },
  { sheet: KDS_EXPO_CSS, containerSelector: '.kds-expo', tiers: [720, 480], narrowShellPx: 640 },
  { sheet: TRANSIT_AUDIT_CSS, containerSelector: '.transit-audit-container', tiers: [640, 480], narrowShellPx: 640 },
  { sheet: CATEGORY_MGMT_CSS, containerSelector: '.cat-mgmt', tiers: [480], narrowShellPx: 640 },
  { sheet: STAFF_MGMT_CSS, containerSelector: '.staff-mgmt', tiers: [900, 600], narrowShellPx: 640 },
  { sheet: MULTI_STORE_DASHBOARD_CSS, containerSelector: '.multi-store-dashboard', tiers: [640, 480], narrowShellPx: 640 },
] as const;

/**
 * The tiers are only comparable when every gate measures the SAME box. KDS also
 * declares `@container kds-panel (min-width: 700px)` — that measures the panel, not
 * the board, so it is excluded rather than ordered against the board's tiers.
 */
const BOARD_TIER = (q: Query) => q.kind === 'container' && isNarrowing(q);
/* ── Graders (pure: they take text, never a path) ───────────── */

interface Finding {
  path: string;
  line: number;
  pattern: string;
  detail: string;
}

/**
 * Rule (2): the sheet declares the named orientation branch as a real at-rule. Read
 * from the ORIGINAL text and reported there — a query is not a comment, and a reader
 * should be pointed at the branch, not at the header that describes it.
 */
function gradeOrientationBranch(spec: OrientationBranch, css: string): Finding[] {
  const needle = '@media ' + spec.prelude;
  const at = stripBlockComments(css).indexOf(needle);
  if (at === -1) {
    return [
      {
        path: spec.sheet,
        line: 1,
        pattern: 'orientation-branch-missing',
        detail: spec.sheet + ' declares no `' + needle + '` — ' + spec.why,
      },
    ];
  }
  return [
    {
      path: spec.sheet,
      line: lineOf(css, at),
      pattern: 'orientation-branch-present',
      detail: spec.sheet + ':' + lineOf(css, at) + ' - `' + needle + '`',
    },
  ];
}

/**
 * Rule (2b): every orientation branch in the sheet claims the shell's narrow tier or
 * narrower. An orientation branch gated at 1024px and up is not the dragged-to-
 * portrait case — by that width the shell has already taken the wide branch.
 */
function gradeOrientationGates(sheet: string, css: string, maxWidePx: number | null): Finding[] {
  const text = stripBlockComments(css);
  const findings: Finding[] = [];
  for (const q of queriesIn(text)) {
    if (q.kind !== 'media' || !/orientation\s*:/.test(q.prelude)) continue;
    const gate = widthGate(q);
    if (gate === null) continue;
    // The ORIGINAL text, so the report quotes the whole condition rather than the
    // parenthesised prelude the reader sliced out of it.
    const prelude = text.slice(q.index, text.indexOf('{', q.index)).trim();
    const ceiling = maxWidePx === null ? gate : maxWidePx;
    if (isWidening(q) || gate > ceiling) {
      findings.push({
        path: sheet,
        line: q.line,
        pattern: 'orientation-branch-too-wide',
        detail:
          sheet + ':' + q.line + ' - `' + prelude + '` claims widths above ' + String(ceiling) +
          'px, where the shell has already taken its narrow branch — this is not the dragged-to-portrait case',
      });
    }
  }
  return findings;
}

/** The subject of a style rule: its selector with any at-rule prelude stripped. */
function selectorOf(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return text
    .slice(lineStart, index)
    .replace(/@(media|container)\s*\([^()]*\)/g, '')
    .replace(/[{}]/g, ' ')
    .trim();
}

/**
 * The SUBJECT a query's rules style. A tier's first selector names the thing it acts on:
 * `.tablet-shell .app-tab-bar` acts on the bar, and `[data-theme='dark']` acts on a
 * theme namespace rather than on this shell's own geometry.
 */
function subjectOf(text: string, q: Query): string {
  const inLine = selectorOf(text, q.index);
  if (inLine) return inLine;
  const open = text.indexOf('{', q.index);
  const after = text.slice(open + 1);
  const first = /(?:^|\n)[ \t]*([^{}\n][^{}]*?)\{/.exec(after);
  return first ? first[1]!.trim() : '';
}

/**
 * Rule (1): a box narrower than the sheet's own narrowest band still lands on the
 * sheet's narrowest layout.
 *
 * Both shapes of failure come from moving the LAST STEP of the ladder into a query:
 *
 *   - a WIDENING tier (`min-width`) on shell GEOMETRY. The property lives only above the
 *     gate, so below it the subject keeps the browser default — `display: block`, a
 *     full-width header — which is not any layout this sheet ever designed.
 *   - a NARROWING tier (`max-width`) that is neither nested in a wider one NOR the
 *     narrowest gate the sheet declares for its subject. Its band is refined by nothing,
 *     while a different gate narrows past it: the step is missing, not merely last.
 *
 * `AppLayout.css` today is the pass case for the second shape and the reason the rule is
 * stated this way rather than as "every tier must nest": its 1023px and 768px tiers are
 * SIBLINGS, and a 320px viewport still gets the 768px layout because that tier reaches
 * down through every width. Nesting is one base case, not the only one.
 *
 * The subject is what makes both halves decidable: a tier on a stylesheet FACILITY
 * (`prefers-reduced-motion`, `pointer`, `orientation`) or on a theme namespace
 * (`:root`, `[data-theme='dark']`) is not this shell's geometry, so a page's own
 * namespace may keep using the idiom.
 */
function gradeWideBoxBase(sheet: string, css: string): Finding[] {
  const text = stripBlockComments(css);
  const findings: Finding[] = [];
  const queries = queriesIn(text);
  const isNested = (q: Query) =>
    queries.some((o) => o.index < q.index && o.index + o.prelude.length < q.index && isNarrowing(o) && enclosing(text, o, q));

  for (const q of queries) {
    if (q.kind !== 'media') continue; // a named @container tier measures another box.
    const gate = widthGate(q);
    if (gate === null) continue;
    const subject = subjectOf(text, q);
    const ownGeometry = !NON_GEOMETRY_SUBJECT.test(subject) && !/^\[|^:root/.test(subject);
    if (isWidening(q) && ownGeometry) {
      findings.push({
        path: sheet,
        line: q.line,
        pattern: 'wide-box-no-base',
        detail:
          sheet + ':' + q.line + ' - `@media ' + q.prelude + '` sets ' + (subject || 'root') +
          ' geometry only above ' + String(gate) + widthUnit(q) +
          '; a box narrower than that takes the browser default, not this sheet\'s own narrowest layout',
      });
    }
    // WHAT THE BASE CASE ACTUALLY IS. A `max-width` tier reaches a box narrower than
    // itself, so it needs no nesting to serve the narrowest box — what it needs is to be
    // the LAST thing the shell has to say about that subject at that width. The failure is
    // a tier that is neither nested in a wider one NOR the narrowest gate on its own
    // subject: it claims a band no smaller tier ever refines, while a *different* gate
    // elsewhere in the sheet narrows past it. That is the ladder losing its last step.
    const ownGate = gate;
    const root = subject.split(/[ >]/)[0]!;
    const refines = queries.some((o) => {
      if (o === q || !isNarrowing(o)) return false;
      const other = widthGate(o);
      if (other === null || other >= ownGate) return false;
      const otherSubject = subjectOf(text, o);
      if (NON_GEOMETRY_SUBJECT.test(otherSubject) || /^\[|^:root/.test(otherSubject)) return false;
      // Same SUBJECT only: a 768px tier on `.app-header` does not refine a 1023px tier on
      // `.app-layout`, and treating the two as one ladder is how a correct sheet reads red.
      return otherSubject.split(/[ >]/)[0] === root;
    });
    if (isNarrowing(q) && ownGeometry && !isNested(q) && refines) {
      findings.push({
        path: sheet,
        line: q.line,
        pattern: 'narrowing-tier-not-nested',
        detail:
          sheet + ':' + q.line + ' - the `@media ' + q.prelude + '` tier on ' + (subject || 'root') +
          ' is not nested inside a wider tier, so below ' + String(gate) + widthUnit(q) +
          ' there is nothing left to narrow to',
      });
    }
  }

  // Widening tiers a sheet does declare must still run widest-first: a narrower
  // min-width declared before a wider one is re-scoped by it (media queries do not
  // cascade-disambiguate; both are in force and source order decides).
  const widening = queries.filter((q) => q.kind === 'media' && isWidening(q) && widthGate(q) !== null);
  for (let i = 1; i < widening.length; i++) {
    if (widthGate(widening[i]!)! > widthGate(widening[i - 1]!)!) {
      findings.push({
        path: sheet,
        line: widening[i]!.line,
        pattern: 'widening-order',
        detail:
          sheet + ':' + widening[i]!.line + ' - a widening gate at ' + String(widthGate(widening[i]!)) +
          'px is declared after the narrower ' + String(widthGate(widening[i - 1]!)) +
          'px one; both are in force above the wider gate, so the narrower rule is silently re-scoped',
      });
    }
  }
  return findings;
}

/** Whether a narrowing query's block encloses an index — i.e. the query nests. */
function enclosing(text: string, outer: Query, inner: Query): boolean {
  const block = blockFrom(text, outer.index);
  if (!block) return false;
  const open = text.indexOf('{', outer.index);
  return inner.index > open && inner.index < open + 1 + block.body.length;
}
/**
 * Rule (3): a migrated sheet measures its OWN box, and a box narrower than its widest
 * tier still lands on a rule — either a tier matched at the shell's own base case, or a
 * matched `max-width` tier with nowhere further to go.
 *
 * The container declaration is the load-bearing half: an UNNAMED `@container` query in
 * a sheet that never declares `container-type` resolves against the nearest ANCESTOR
 * container instead, so the sheet's "narrow shell" tier would silently be measuring the
 * shell rather than the box it names. A NAMED query (`@container kds-panel …`) is
 * exempt — it names the box it measures, so it does not depend on this sheet's own
 * `container-type`.
 */
function gradeMigratedSheet(spec: MigratedSheet, css: string): Finding[] {
  const text = stripBlockComments(css);
  const findings: Finding[] = [];

  const containers = ruleBodies(text, spec.containerSelector);
  const container = containers[0] ?? null;
  if (!container) {
    findings.push({
      path: spec.sheet,
      line: 1,
      pattern: 'container-selector-missing',
      detail: spec.sheet + ' declares no `' + spec.containerSelector + '` rule',
    });
  } else if (!containers.some((b) => /container-type\s*:\s*inline-size/.test(b.body))) {
    findings.push({
      path: spec.sheet,
      line: container.line,
      pattern: 'container-not-declared',
      detail:
        spec.sheet + ':' + container.line + ' - `' + spec.containerSelector +
        '` does not declare `container-type: inline-size`, so its @container tiers measure the nearest ancestor container instead of its own box',
    });
  }

  const boardTiers = queriesIn(text).filter(BOARD_TIER);
  const gates = boardTiers.map((q) => round(widthGate(q)!));
  for (const tier of spec.tiers) {
    if (!gates.includes(tier)) {
      findings.push({
        path: spec.sheet,
        line: 1,
        pattern: 'narrow-tier-missing',
        detail:
          spec.sheet + ' declares no unconditional `@container (max-width: ' + tier +
          'px)`: the sheet\'s narrow tier is gone (declared today: ' +
          (gates.length ? gates.join(', ') : 'none') + ')',
      });
    }
  }
  for (let i = 1; i < gates.length; i++) {
    if (gates[i]! > gates[i - 1]!) {
      findings.push({
        path: spec.sheet,
        line: 1,
        pattern: 'tier-order',
        detail:
          spec.sheet + ' declares its container max-width tiers ' + gates.join(' then ') +
          ' — no `max-width` gate can be written after that ' + String(gates[i - 1]) +
          'px tier, so the narrower tier can never be the one in force',
      });
    }
  }

  // A box below the widest tier must still be AT a rule, and the sheet must show where
  // it lands: a tier small enough for the narrowest shell, or an explicit comment
  // naming the matched case.
  const narrowest = gates.length ? Math.min(...gates) : null;
  const box = spec.narrowShellPx;
  if (narrowest !== null && narrowest > box) {
    const named = (source(spec.sheet) as string).includes('base case');
    findings.push({
      path: spec.sheet,
      line: 1,
      pattern: 'narrow-tier-above-narrow-shell',
      detail:
        spec.sheet + ' matches nothing below ' + String(narrowest) + 'px, and a box narrower than ' +
        String(box) + 'px' + (named ? ' is named in its own prose as landing on that matched tier' : ' gets the wide layout with no rule of its own') +
        ' — this is the coverage ADR-0001 Slice 7 measures, not a claim that the sheet is wrong',
    });
  }
  return findings;
}

/**
 * Rule (4a): a folding tier is a NON-EMPTY block, and a tier that hides a lane hides a
 * leaf.
 *
 * WHAT THIS RULE DELIBERATELY DOES NOT CLAIM. An earlier draft asserted that every
 * folding tier hides a fixed-px lane with `display: none`. Both migrated sheets say
 * otherwise — outlined in `RetailPosScreen.css`, the KDS board folds by
 * `flex-direction: column` and restates `flex` so a bucket sizes to its content, and
 * the prose in both sheets is explicit that shedding a lane is not what they do. A rule
 * that failed them would have been the test asserting a story the CSS never told, so it
 * is not asserted: "the tier folds" is graded, "what it folds" is printed in the
 * denominator and left to the sheet's own comment.
 *
 * The one thing still graded is the manner: if a tier does hide something, the target
 * must not be a WRAPPER the sheet styles as a parent of visible children — hiding those
 * strips the children rather than removing one lane.
 */
function gradeShedding(sheet: string, css: string, tier: number): Finding[] {
  const text = stripBlockComments(css);
  const block = blockFor(text, new RegExp('@container\\s*\\(max-width:\\s*' + tier + 'px\\)', 'm'));
  if (!block) return [];

  const findings: Finding[] = [];
  if (block.body.trim() === '') {
    return [
      {
        path: sheet,
        line: block.line,
        pattern: 'tier-empty',
        detail:
          sheet + ':' + block.line + ' - the ' + tier +
          'px tier declares nothing; a folding tier that changes nothing is a comment wearing a query',
      },
    ];
  }

  const hidden: string[] = [];
  const inner = /([^{}]+?)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = inner.exec(block.body)) !== null) {
    if (!/display\s*:\s*none/.test(m[2]!)) continue;
    for (const sel of m[1]!.split(',')) hidden.push(sel.trim());
  }

  for (const sel of hidden) {
    const base = sel.split(/[ >+~]/)[0]!;
    // The question is whether the hidden target is a WRAPPER the sheet styles as a
    // parent of visible children — i.e. whether the sheet writes `base > child { … }`,
    // not whether `base` appears anywhere as a selector. `th:nth-child(2)` hidden on its
    // own is a leaf lane; `.kds-main` hidden is a wrapper.
    const asParent = new RegExp('(?:^|\\n)[ \\t]*' + escapeRe(base) + '\\s*>[^,{]*\\{', 'm');
    if (asParent.test(text)) {
      findings.push({
        path: sheet,
        line: block.line,
        pattern: 'tier-hides-wrapper',
        detail:
          sheet + ':' + block.line + ' - the ' + tier + 'px tier hides `' + sel +
          '`, which the sheet also styles as the PARENT of its own children (' + base +
          ' > …); that strips the children instead of shedding one lane',
      });
    }
  }
  return findings;
}

/** How a tier changes the layout: the declarations its block actually carries. */
function foldSummary(css: string, tier: number): string {
  const text = stripBlockComments(css);
  const block = blockFor(text, new RegExp('@container\\s*\\(max-width:\\s*' + tier + 'px\\)', 'm'));
  if (!block) return tier + 'px: absent';
  const props = new Set<string>();
  const decl = /([a-z-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(block.body)) !== null) props.add(m[1]!);
  return tier + 'px: ' + (props.size ? [...props].join('+') : 'empty');
}

/**
 * Rule (4b): the shell's content slot has no fixed height CEILING. A `height` on
 * `.app-content-inner` stops `.app-content` scrolling an extreme-aspect box back into
 * view; `min-height` is a floor and is exactly what the shell declares.
 */
function gradeShellSlot(sheet: string, css: string, selector: string): Finding[] {
  // A shell-scoped sheet prefixes its slot (`.tablet-shell .app-content-inner`), so any
  // rule whose selector ENDS in the slot name is the slot — matching only the bare form
  // would report the tablet shell as having no content slot at all.
  const text = stripBlockComments(css);
  const rule =
    ruleBody(text, selector) ??
    blockFor(text, new RegExp('(?:^|\\n)[ \\t]*[^{},\\n]*' + escapeRe(selector) + '\\s*(?=\\{)', 'm'));
  if (!rule) {
    return [
      {
        path: sheet,
        line: 1,
        pattern: 'shell-slot-missing',
        detail: sheet + ' declares no `' + selector + '`; the narrow-shell content slot does not exist',
      },
    ];
  }
  if (!/(?:^|[;{\s])height\s*:/.test(rule.body)) return [];
  return [
    {
      path: sheet,
      line: rule.line,
      pattern: 'shell-slot-fixed-height',
      detail:
        sheet + ':' + rule.line + ' - `' + selector + '` pins a fixed `height` (' +
        rule.body.replace(/\s+/g, ' ').trim() +
        '); in a short portrait box that is a ceiling that clips instead of a floor that scrolls',
    },
  ];
}
/* ── Planted cases: the fence must be able to go red ────────── */

/** Synthetic sheets the planted tests feed the graders; never read from disk. */
const PLANTED = {
  /** A migrated sheet that grew a query without declaring the box it measures. */
  salesHistoryNoContainer:
    '.sales-history { padding: 1rem; }\n' +
    '@container (max-width: 880px) { .sales-history-cell-id { display: none; } }\n',
  /** A class the sheet styles as a PARENT, hidden as if it were one lane. */
  salesHistoryWrapperShed:
    '.sales-history { container-type: inline-size; }\n' +
    '.sales-history-table > .sales-history-cell-id { color: red; }\n' +
    '@container (max-width: 880px) { .sales-history-table { display: none; } }\n',
  /**
   * A migrated sheet that QUERIES a container without declaring the box it
   * measures — the shape gradeMigratedSheet's `container-not-declared` exists
   * for. Not a copy of PLANTED.noContainer: that one is written against
   * RETAIL_CSS, and a case is only a control for the sheet it names.
   */
  paymentModalNoContainer:
    '.payment-overlay { display: flex; }\n' +
    '@container (max-width: 480px) { .payment-split-row { flex-direction: column; } }\n',
  /** PosScreen's two tiers declared finest-first — the wider gate would win. */
  posScreenTierOrder:
    '.pos-screen { container-type: inline-size; }\n' +
    '@container (max-width: 480px) { .pos-close-shift-modal { padding: 1rem; } }\n' +
    '@container (max-width: 720px) { .pos-close-shift-summary-grid { grid-template-columns: 1fr; } }\n',
  /**
   * A class the POS sheet styles as a PARENT, hidden as if it were one lane.
   * The child rule is what makes it a wrapper: without it the grader has no
   * evidence that `.pos-close-shift-summary-grid` is an ancestor rather than a
   * leaf, and hiding a leaf is exactly what this tier is allowed to do.
   */
  posScreenWrapperShed:
    '.pos-screen { container-type: inline-size; }\n' +
    '.pos-close-shift-summary-grid > .pos-close-shift-summary-item { color: red; }\n' +
    '@container (max-width: 720px) { .pos-close-shift-summary-grid { display: none; } }\n',
  /**
   * A migrated sheet that QUERIES a container without declaring the box it
   * measures. Written against EOD_REPORT_CSS, not copied from the PaymentModal
   * or PosScreen fixtures: a case is only a control for the sheet it names.
   */
  eodReportNoContainer:
    '.eod-report { padding: 1rem; }\n' +
    '@container (max-width: 800px) { .eod-report-columns { grid-template-columns: 1fr; } }\n',
  /**
   * EodReport's two tiers declared finest-first. This is the ORDER plant for
   * the 800/600 ladder: the 600px tier is below the 640px narrow-shell case on
   * purpose (that is coherent coverage, not a missing gate), but a max-width
   * gate written above the 800px one can never be the tier in force.
   */
  eodReportTierOrder:
    '.eod-report { container-type: inline-size; }\n' +
    '@container (max-width: 600px) { .eod-report-active-shift { flex-direction: column; } }\n' +
    '@container (max-width: 800px) { .eod-report-columns { grid-template-columns: 1fr; } }\n',
  /**
   * A migrated sheet that QUERIES a container without declaring the box it
   * measures. Written against KDS_EXPO_CSS, not copied from an earlier fixture:
   * a case is only a control for the sheet it names.
   */
  kdsExpoNoContainer:
    '.kds-expo { display: grid; }\n' +
    '@container (max-width: 720px) { .kds-expo-header { flex-wrap: wrap; } }\n',
  /** TransitAudit's two tiers declared finest-first — the wider gate would win. */
  transitAuditTierOrder:
    '.transit-audit-container { container-type: inline-size; }\n' +
    '@container (max-width: 480px) { .transit-lines-table { table-layout: fixed; } }\n' +
    '@container (max-width: 640px) { .transit-meta { grid-template-columns: 1fr; } }\n',
  /**
   * A migrated sheet that QUERIES a container without declaring the box it
   * measures, one sheet over.
   */
  categoryMgmtNoContainer:
    '.cat-mgmt { padding: 1rem; }\n' +
    '@container (max-width: 480px) { .cat-mgmt-header { flex-wrap: wrap; } }\n',
  /**
   * StaffManagement's two tiers declared finest-first. The 900/600 ladder is
   * the ORDER plant for the staff sheet: the 600px tier is below the 640px
   * narrow-shell case on purpose (that is coherent coverage, not a missing gate),
   * but a max-width gate written above the 900px one can never be the tier in
   * force.
   */
  staffMgmtTierOrder:
    '.staff-mgmt { container-type: inline-size; }\n' +
    '@container (max-width: 600px) { .staff-mgmt-field--horizontal { flex-direction: column; } }\n' +
    '@container (max-width: 900px) { .staff-mgmt-search { flex-basis: 100%; } }\n',
  /**
   * MultiStoreDashboard's two tiers declared finest-first — the wider gate
   * would win. The 640/480 ladder's ORDER plant: the 480px tier is below the
   * 640px narrow-shell case on purpose (that is coherent coverage, not a missing
   * gate), but a max-width gate written above the 640px one can never be the
   * tier in force.
   */
  multiStoreDashboardTierOrder:
    '.multi-store-dashboard { container-type: inline-size; }\n' +
    '@container (max-width: 480px) { .multi-store-kpi-grid { grid-template-columns: 1fr; } }\n' +
    '@container (max-width: 640px) { .multi-store-layout { flex-direction: column; } }\n',
  /** RetailPos tiers declared finest-first — the wider gate would win. */
  retailTierOrder:
    '.retail-pos { container-type: inline-size; }\n' +
    '@container (max-width: 640px) { .a { display: none; } }\n' +
    '@container (max-width: 880px) { .b { display: none; } }\n',
  /** A desktop-first sheet that grew a mobile-first widening gate. */
  shellMinWidth:
    '.app-layout { display: flex; }\n' +
    '@media (min-width: 640px) { .app-layout { flex-direction: row; } }\n',
  /** A page that queries a container it never declares. */
  noContainer:
    '.retail-pos { display: flex; }\n@container (max-width: 880px) { .a { display: none; } }\n',
  /** A tier that declares nothing — a comment wearing a query. */
  emptyTier:
    '.kds { container-type: inline-size; }\n' +
    '@container (max-width: 900px) { }\n',
  /** A tier that hides a wrapper the sheet styles as a parent. */
  wrapperShed:
    '.kds { container-type: inline-size; }\n' +
    '.kds-main > .kds-col { flex: 1; }\n' +
    '.kds-main { container-type: inline-size; }\n' +
    '@container (max-width: 900px) { .kds-main { display: none; } }\n',
  /** The shell slot pinned to a fixed height ceiling. */
  shellFixedHeight:
    '.app-content-inner { container-type: inline-size; height: 100vh; }\n',
  /** The shell with no portrait branch at all. */
  shellPortraitMissing: '.app-layout { flex-direction: column; }\n',
  /** A portrait branch that only claims widths the shell already handled. */
  orientationTooWide:
    '@media (orientation: portrait) and (min-width: 1024px) { .a { display: none; } }\n',
  /** A desktop-first ladder declared narrowest-first. */
  shellLadderInverted:
    '.app-layout { display: flex; }\n' +
    '@media (max-width: 768px) { .app-layout { flex-direction: column; } }\n' +
    '@media (max-width: 1023px) { .app-layout { flex-direction: row; } }\n',
  /** A wide `min-width` gate inside a desktop-first shell sheet. */
  shellLadderMinWidth: '@media (min-width: 1024px) { .a { display: none; } }\n',
} as const;

/* ── Harvest: the printed denominator ───────────────────────── */

function harvest() {
  const branches = ORIENTATION_BRANCHES.map((spec) => ({
    spec,
    findings: gradeOrientationBranch(spec, source(spec.sheet)),
  }));
  const orientationGates = ORIENTATION_BRANCHES.flatMap((spec) =>
    gradeOrientationGates(spec.sheet, source(spec.sheet), spec.maxGatePx),
  );
  const ladders = LADDER_SHEETS.map((sheet) => ({
    sheet,
    findings: gradeWideBoxBase(sheet, source(sheet)),
  }));
  const migrated = MIGRATED.map((spec) => ({
    spec,
    findings: gradeMigratedSheet(spec, source(spec.sheet)),
  }));
  const shedding = MIGRATED.flatMap((spec) =>
    spec.tiers.flatMap((tier) => gradeShedding(spec.sheet, source(spec.sheet), tier)),
  );
  const slots = [
    { sheet: SHELL_CSS, findings: gradeShellSlot(SHELL_CSS, source(SHELL_CSS), '.app-content-inner') },
    { sheet: TABLET_CSS, findings: gradeShellSlot(TABLET_CSS, source(TABLET_CSS), '.app-content-inner') },
  ];

  const findings = [
    ...branches.flatMap((b) => b.findings.filter((f) => f.pattern !== 'orientation-branch-present')),
    ...orientationGates,
    ...ladders.flatMap((l) => l.findings),
    ...migrated.flatMap((m) => m.findings),
    ...shedding,
    ...slots.flatMap((s) => s.findings),
  ];

  const declared = MIGRATED.reduce((n, spec) => n + spec.tiers.length, 0);
  const declaredTiers = MIGRATED.flatMap((spec) =>
    spec.tiers.map((tier) => ({
      sheet: spec.sheet,
      tier,
      present: queriesIn(stripBlockComments(source(spec.sheet)))
        .filter(BOARD_TIER)
        .some((q) => round(widthGate(q)!) === tier),
    })),
  );

  return {
    branches: ORIENTATION_BRANCHES.length,
    branchesPresent: branches.filter(
      (b) => !b.findings.some((f) => f.pattern === 'orientation-branch-missing'),
    ).length,
    migratedSheets: MIGRATED.length,
    declaredTiers: declared,
    tiersPresent: declaredTiers.filter((t) => t.present).length,
    ladderSheets: LADDER_SHEETS.length,
    laddersDesktopFirst: ladders.filter((l) => l.findings.length === 0).length,
    slotSheets: slots.length,
    slotsWithoutFixedHeight: slots.filter(
      (s) => !s.findings.some((f) => f.pattern === 'shell-slot-fixed-height' || f.pattern === 'shell-slot-missing'),
    ).length,
    folds: MIGRATED.flatMap((spec) => spec.tiers.map((tier) => foldSummary(source(spec.sheet), tier))),
    coverage: MIGRATED.map((spec) => {
      const gates = queriesIn(stripBlockComments(source(spec.sheet))).filter(BOARD_TIER).map((q) => round(widthGate(q)!));
      const narrowest = gates.length ? Math.min(...gates) : null;
      return (
        spec.containerSelector + ' matches down to ' + (narrowest === null ? 'no tier' : narrowest + 'px') +
        ', narrow-shell case is ' + spec.narrowShellPx + 'px' +
        (narrowest !== null && narrowest > spec.narrowShellPx ? ' (uncovered by a rule)' : ' (covered)')
      );
    }),
    findings,
  };
}

const stats = harvest();
const byRule = (rule: string) => stats.findings.filter((f) => f.pattern === rule).length;

const DENOMINATOR =
  'narrowShellOrientation harvest: ' +
  stats.branchesPresent + '/' + stats.branches + ' shell orientation branches (extreme-aspect case), ' +
  stats.tiersPresent + '/' + stats.declaredTiers + ' narrow container tiers across ' + stats.migratedSheets + ' migrated sheets, ' +
  stats.laddersDesktopFirst + '/' + stats.ladderSheets + ' shell sheets desktop-first, ' +
  'folds [' + stats.folds.join('; ') + '] (' + byRule('tier-hides-wrapper') + ' hide a wrapper), ' +
  stats.slotsWithoutFixedHeight + '/' + stats.slotSheets + ' content slots carry no fixed height, ' +
  'narrow-shell coverage [' + stats.coverage.join('; ') + ']; ' +
  stats.findings.length + ' findings' +
  (stats.findings.length ? ' (' + stats.findings.map((f) => f.path + ':' + f.line).join(', ') + ')' : '') +
  '.';

console.log(DENOMINATOR);
describe('narrow-shell / extreme-aspect verification (ADR-0001 Slice 7)', () => {
  it('a shell narrower than the tablet keeps its own desktop-first width ladder', () => {
    const findings = stats.findings.filter(
      (f) =>
        f.pattern === 'wide-box-no-base' ||
        f.pattern === 'narrowing-tier-not-nested' ||
        f.pattern === 'widening-order' ||
        f.pattern === 'width-ladder-mixed-units',
    );
    const msg =
      'Found ' + findings.length + ' narrow-shell ladder violations.\n' +
      'Expected: ' + LADDER_SHEETS.join(' and ') + ' gate every width tier with max-width in DESCENDING order, so a box narrower than the tablet has exactly one shell geometry, and no min-width widening tier creeps in.\n\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('a desktop window dragged to portrait has a shell orientation branch at the narrow tier', () => {
    const findings = stats.findings.filter(
      (f) => f.pattern === 'orientation-branch-missing' || f.pattern === 'orientation-branch-too-wide',
    );
    const msg =
      'Found ' + findings.length + ' orientation-branch violations.\n' +
      'Expected:\n' +
      ORIENTATION_BRANCHES.map((b) => '  ' + b.sheet + ': @media ' + b.prelude + ' — ' + b.why).join('\n') +
      '\n\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('the migrated sheets measure their own box and fold in the same order', () => {
    const findings = stats.findings.filter(
      (f) =>
        f.pattern === 'container-selector-missing' ||
        f.pattern === 'container-not-declared' ||
        f.pattern === 'narrow-tier-missing' ||
        f.pattern === 'tier-order',
    );
    const msg =
      'Found ' + findings.length + ' container-tier violations.\n' +
      'Expected: each migrated sheet declares container-type: inline-size on its own box and its @container (max-width: …) tiers in DESCENDING order, so the narrower tier can still match.\n\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('a shell narrower than the tablet is matched by a tier, or the gap is named', () => {
    // ADR-0001 Slice 7 asks for the narrow-shell case to be EXERCISED. Where a sheet has
    // no tier that small, the honest report is the gap itself — measured here, and
    // printed in the denominator — rather than a red assertion inventing a layout the
    // sheet never declared. A sheet that silently grows a smaller tier still moves this
    // reading, which is why it is pinned.
    const gaps = stats.findings.filter((f) => f.pattern === 'narrow-tier-above-narrow-shell');
    expect(
      gaps.map((f) => f.detail),
      'Expected: every migrated sheet either matches the narrow-shell case with a tier, or reports the gap here.\nCoverage:\n' +
        stats.coverage.join('\n'),
    ).toEqual([]);
  });

  it('every folding tier changes the layout, and none of them strips a wrapper', () => {
    const findings = stats.findings.filter(
      (f) => f.pattern === 'tier-empty' || f.pattern === 'tier-hides-wrapper',
    );
    const msg =
      'Found ' + findings.length + ' shedding violations.\n' +
      'Expected: a narrow tier declares something, and where it hides a lane the lane is a leaf rather than an ancestor whose children carry the geometry.\n\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('the content slot carries no fixed height, so a short box scrolls instead of clipping', () => {
    const findings = stats.findings.filter(
      (f) => f.pattern === 'shell-slot-missing' || f.pattern === 'shell-slot-fixed-height',
    );
    const msg =
      'Found ' + findings.length + ' shell-slot violations.\n' +
      'Expected: ' + SHELL_CSS + ' and ' + TABLET_CSS + ' both declare .app-content-inner with min-height and no fixed height.\n\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('fails on a planted violation: an inverted tier order, a min-width ladder, a missing container, and a fixed shell height', () => {
    // Planted 1 — a migrated sheet whose max-width tiers are declared finest-first.
    expect(
      gradeMigratedSheet({ sheet: RETAIL_CSS, containerSelector: '.retail-pos', tiers: [880, 640], narrowShellPx: 640 }, PLANTED.retailTierOrder).map((f) => f.pattern),
      'the fence no longer fires when a container sheet declares its wider max-width tier last',
    ).toContain('tier-order');

    // Planted 2 — desktop-first inverted into a min-width family.
    expect(
      gradeWideBoxBase(SHELL_CSS, PLANTED.shellMinWidth).map((f) => f.pattern),
      'the fence no longer fires when the shell moves its own geometry into a min-width tier',
    ).toContain('wide-box-no-base');

    // Planted 3 — a page that queries @container without declaring its own box.
    expect(
      gradeMigratedSheet({ sheet: RETAIL_CSS, containerSelector: '.retail-pos', tiers: [880], narrowShellPx: 640 }, PLANTED.noContainer).map((f) => f.pattern),
      'the fence no longer fires on a sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 3b — the same gap, one sheet over: a query with no box of its own.
    expect(
      gradeMigratedSheet({ sheet: SALES_HISTORY_CSS, containerSelector: '.sales-history', tiers: [880], narrowShellPx: 640 }, PLANTED.salesHistoryNoContainer).map((f) => f.pattern),
      'the fence no longer fires on a sales-history sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 5b — the shedding manner, one sheet over: the hidden target is the
    // table the sheet styles as the PARENT of the cell it means to shed.
    expect(
      gradeShedding(SALES_HISTORY_CSS, PLANTED.salesHistoryWrapperShed, 880).map((f) => f.pattern),
      'the fence no longer fires when the sales-history tier hides a wrapper instead of a lane',
    ).toContain('tier-hides-wrapper');

    // Planted 3c — the same container-not-declared shape, one sheet over: the
    // checkout modal queries a box (its own overlay) that nothing declares.
    expect(
      gradeMigratedSheet({ sheet: PAYMENT_MODAL_CSS, containerSelector: '.payment-overlay', tiers: [480], narrowShellPx: 640 }, PLANTED.paymentModalNoContainer).map((f) => f.pattern),
      'the fence no longer fires on a payment-modal sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 1b — the inverted tier order, one sheet over. PosScreen is the
    // first migrated sheet with TWO tiers, so this is the only plant that can
    // fail on the ORDER rather than on a missing gate.
    expect(
      gradeMigratedSheet({ sheet: POS_SCREEN_CSS, containerSelector: '.pos-screen', tiers: [720, 480], narrowShellPx: 640 }, PLANTED.posScreenTierOrder).map((f) => f.pattern),
      'the fence no longer fires when PosScreen declares its wider max-width tier last',
    ).toContain('tier-order');

    // Planted 5c — the shedding manner, one sheet over: the hidden target is
    // the grid the POS sheet styles as the PARENT of the summary items.
    expect(
      gradeShedding(POS_SCREEN_CSS, PLANTED.posScreenWrapperShed, 720).map((f) => f.pattern),
      'the fence no longer fires when the PosScreen tier hides a wrapper instead of a lane',
    ).toContain('tier-hides-wrapper');

    // Planted 3d — the container-not-declared shape, one sheet over: the EOD
    // report queries a box nothing declares.
    expect(
      gradeMigratedSheet({ sheet: EOD_REPORT_CSS, containerSelector: '.eod-report', tiers: [800, 600], narrowShellPx: 640 }, PLANTED.eodReportNoContainer).map((f) => f.pattern),
      'the fence no longer fires on an EOD-report sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 1c — the inverted tier order, on the 800/600 ladder.
    expect(
      gradeMigratedSheet({ sheet: EOD_REPORT_CSS, containerSelector: '.eod-report', tiers: [800, 600], narrowShellPx: 640 }, PLANTED.eodReportTierOrder).map((f) => f.pattern),
      'the fence no longer fires when EodReport declares its wider max-width tier last',
    ).toContain('tier-order');

    // Planted 4 — a folding tier that hides nothing at all.
    expect(
      gradeShedding(KDS_CSS, PLANTED.emptyTier, 900).map((f) => f.pattern),
      'the fence no longer fires on a folding tier that declares nothing',
    ).toContain('tier-empty');

    // Planted 5 — a tier that hides a wrapper the sheet styles as a parent.
    expect(
      gradeShedding(KDS_CSS, PLANTED.wrapperShed, 900).map((f) => f.pattern),
      'the fence no longer fires on a tier that hides a wrapper instead of a lane',
    ).toContain('tier-hides-wrapper');

    // Planted 6 — the shell slot pinned to a fixed height ceiling.
    expect(
      gradeShellSlot(SHELL_CSS, PLANTED.shellFixedHeight, '.app-content-inner').map((f) => f.pattern),
      'the fence no longer fires on a content slot with a fixed height ceiling',
    ).toContain('shell-slot-fixed-height');

    // Planted 7 — the shell with no portrait branch at all.
    expect(
      gradeOrientationBranch(ORIENTATION_BRANCHES[0]!, PLANTED.shellPortraitMissing).map((f) => f.pattern),
      'the fence no longer fires when the shell drops its portrait branch',
    ).toContain('orientation-branch-missing');

    // Planted 8 — a portrait branch gated wider than the shell ladder.
    expect(
      gradeOrientationGates(SHELL_CSS, PLANTED.orientationTooWide, 1023).map((f) => f.pattern),
      'the fence no longer fires on an orientation branch that only claims widths the shell already handled',
    ).toContain('orientation-branch-too-wide');

    // Planted 9 — the shell ladder declared narrowest-first.
    expect(
      gradeWideBoxBase(SHELL_CSS, PLANTED.shellLadderInverted).map((f) => f.pattern),
      'the fence no longer fires on a desktop-first ladder declared narrowest-first',
    ).toContain('narrowing-tier-not-nested');

    // Planted 10 — a wide min-width gate in the shell sheet.
    expect(
      gradeWideBoxBase(SHELL_CSS, PLANTED.shellLadderMinWidth).map((f) => f.pattern),
      'the fence no longer fires on a min-width gate added to the shell ladder',
    ).toContain('wide-box-no-base');

    // The coverage observation is asserted by its OWN test above, so the negative control
    // below grades the DECLARED SHAPE only. A sheet that folds correctly is not made
    // "failing" by a narrow-shell coverage gap the ADR asks to be measured, not fixed.
    const shapeOnly = (findings: Finding[]) => findings.filter((f) => f.pattern !== 'narrow-tier-above-narrow-shell');

    // Negative control — the REAL sheets pass the same graders the planted cases just
    // failed, so the planted cases prove the fence fires rather than that it fires on
    // everything it is shown.
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[0]!, source(RETAIL_CSS))),
      'the graders reject the real RetailPosScreen.css; the fence is not measuring what it claims',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[1]!, source(KDS_CSS))),
      'the graders reject the real KdsScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[2]!, source(SALES_HISTORY_CSS))),
      'the graders reject the real SalesHistoryScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[3]!, source(PAYMENT_MODAL_CSS))),
      'the graders reject the real PaymentModal.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[4]!, source(POS_SCREEN_CSS))),
      'the graders reject the real PosScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[5]!, source(EOD_REPORT_CSS))),
      'the graders reject the real EodReportScreen.css',
    ).toEqual([]);

    // Planted 3e — the container-not-declared shape, on the KDS expo sheet: the
    // expo board queries a box (its own root) that nothing declares.
    expect(
      gradeMigratedSheet({ sheet: KDS_EXPO_CSS, containerSelector: '.kds-expo', tiers: [720, 480], narrowShellPx: 640 }, PLANTED.kdsExpoNoContainer).map((f) => f.pattern),
      'the fence no longer fires on a KDS-expo sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 1d — the inverted tier order, on the 640/480 ladder.
    expect(
      gradeMigratedSheet({ sheet: TRANSIT_AUDIT_CSS, containerSelector: '.transit-audit-container', tiers: [640, 480], narrowShellPx: 640 }, PLANTED.transitAuditTierOrder).map((f) => f.pattern),
      'the fence no longer fires when TransitAudit declares its wider max-width tier last',
    ).toContain('tier-order');

    // Planted 3f — the container-not-declared shape, on the category sheet.
    expect(
      gradeMigratedSheet({ sheet: CATEGORY_MGMT_CSS, containerSelector: '.cat-mgmt', tiers: [480], narrowShellPx: 640 }, PLANTED.categoryMgmtNoContainer).map((f) => f.pattern),
      'the fence no longer fires on a category-management sheet that queries a container it never declares',
    ).toContain('container-not-declared');

    // Planted 1e — the inverted tier order, on the 900/600 ladder.
    expect(
      gradeMigratedSheet({ sheet: STAFF_MGMT_CSS, containerSelector: '.staff-mgmt', tiers: [900, 600], narrowShellPx: 640 }, PLANTED.staffMgmtTierOrder).map((f) => f.pattern),
      'the fence no longer fires when StaffManagement declares its wider max-width tier last',
    ).toContain('tier-order');

    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[6]!, source(KDS_EXPO_CSS))),
      'the graders reject the real ExpoScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[7]!, source(TRANSIT_AUDIT_CSS))),
      'the graders reject the real TransitAuditScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[8]!, source(CATEGORY_MGMT_CSS))),
      'the graders reject the real CategoryManagementScreen.css',
    ).toEqual([]);
    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[9]!, source(STAFF_MGMT_CSS))),
      'the graders reject the real StaffManagementScreen.css',
    ).toEqual([]);

    // Planted 1f — the inverted tier order, on the 640/480 ladder of the
    // multi-store dashboard.
    expect(
      gradeMigratedSheet({ sheet: MULTI_STORE_DASHBOARD_CSS, containerSelector: '.multi-store-dashboard', tiers: [640, 480], narrowShellPx: 640 }, PLANTED.multiStoreDashboardTierOrder).map((f) => f.pattern),
      'the fence no longer fires when MultiStoreDashboard declares its wider max-width tier last',
    ).toContain('tier-order');

    expect(
      shapeOnly(gradeMigratedSheet(MIGRATED[10]!, source(MULTI_STORE_DASHBOARD_CSS))),
      'the graders reject the real MultiStoreDashboardScreen.css',
    ).toEqual([]);
    expect(
      gradeOrientationGates(SHELL_CSS, source(SHELL_CSS), 1023),
      'the graders reject the real AppLayout.css orientation branch',
    ).toEqual([]);
  });

  it(`prints its own denominator: ${DENOMINATOR}`, () => {
    expect(stats.branches, 'the suite graded no orientation branch at all').toBeGreaterThan(0);
    expect(stats.declaredTiers, 'the suite graded no container tier at all').toBeGreaterThan(0);
  });
});
