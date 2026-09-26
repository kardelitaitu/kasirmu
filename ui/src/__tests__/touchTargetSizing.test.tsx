import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join, relative } from 'path';

/* ── Constants ───────────────────────────────────────────────────── */

const UI_SRC = resolve(__dirname, '..');
const BASE_SIZE = 16;
const BACKTICK = String.fromCharCode(96);

/**
 * Minimum interactive target, in CSS px.
 *
 * Source of truth is the token pair at ui/src/theme/tokens.css:277-278:
 *   --touch-target-min: 44px;           <- this floor
 *   --touch-target-comfortable: 48px;   <- preferred size for primary controls
 *
 * A declaration that references either token passes without arithmetic: the
 * scanner must not re-implement the token value, or the token stops being the
 * single source of truth (R4: "raise to the existing token").
 */
const MIN_TARGET_PX = 44;

const TOKENS_CSS = resolve(UI_SRC, 'theme/tokens.css');
const CATCH_ALL_CSS = resolve(UI_SRC, 'theme/components.css');
const COARSE_QUERY_RE = /pointer\s*:\s*coarse/;

interface Violation {
  file: string;
  line: number;
  selector: string;
  declaration: string;
  reason: string;
}

interface ParsedRule {
  selectors: string;
  body: string;
  inPointerCoarse: boolean;
}

/* ── Token + value resolution ────────────────────────────────────── */

/** Custom-property values from tokens.css, so var() can be resolved to px. */
function loadTokens(): Map<string, string> {
  const css = readFileSync(TOKENS_CSS, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map<string, string>();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

function resolveVars(value: string, tokens: Map<string, string>, depth = 0): string {
  if (depth > 5) return 'UNRESOLVED';
  return value.replace(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/gi,
    (_all, name: string, fallback?: string) => {
      const v = tokens.get(name);
      if (v !== undefined) return resolveVars(v, tokens, depth + 1);
      if (fallback !== undefined) return resolveVars(fallback.trim(), tokens, depth + 1);
      return 'UNRESOLVED';
    },
  );
}

/** One numeric token, in px. A unitless number is a calc multiplier. */
function tokenToPx(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(px|rem)?$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'rem') return n * BASE_SIZE;
  return n;
}

/**
 * Evaluate a calc() body with real operator precedence.
 *
 * A naive sum over the "Npx/Nrem" matches in the string silently drops every
 * multiplier -- 'calc(var(--text-base) + 2 * var(--space-2) + 2px)' would read
 * as 14+8+2=24px instead of 32px. The number a report quotes has to be the
 * number the browser computes, so this parses it.
 *
 * Returns null when the expression cannot be evaluated in px (a percentage,
 * a viewport unit, or a var() with no known value); such declarations are
 * reported as uncomputable rather than silently skipped.
 */
function evalCalc(expr: string): number | null {
  const body = expr.replace(/^\s*calc\(/i, '').replace(/\)\s*$/, '');
  if (/%|vw|vh|vmin|vmax|UNRESOLVED|var\(/i.test(body)) return null;

  const tokens = body.match(/(\d+(?:\.\d+)?)(?:px|rem)?|[+\-*/]/g);
  if (!tokens || tokens.length === 0) return null;

  let i = 0;
  const primary = (): number | null => {
    const tok = tokens[i];
    if (tok === undefined) return null;
    if (tok === '-') { i++; const v = primary(); return v === null ? null : -v; }
    if (tok === '+') { i++; return primary(); }
    i++;
    return tokenToPx(tok);
  };
  const term = (): number | null => {
    let left = primary();
    if (left === null) return null;
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i];
      i++;
      const right = primary();
      if (right === null) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const sum = (): number | null => {
    let left = term();
    if (left === null) return null;
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i];
      i++;
      const right = term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const out = sum();
  if (out === null || i !== tokens.length) return null;
  return out;
}

function parsePxValue(value: string, tokens: Map<string, string>): number | null {
  const resolved = resolveVars(value.trim(), tokens);
  if (/UNRESOLVED/.test(resolved)) return null;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(resolved);
  if (px) return Number(px[1]);
  const rem = /^(\d+(?:\.\d+)?)rem$/.exec(resolved);
  if (rem) return Number(rem[1]) * BASE_SIZE;
  if (/^\s*calc\(/i.test(resolved)) return evalCalc(resolved);
  return null;
}

function referencesTouchTarget(value: string): boolean {
  return /--touch-target-(?:min|comfortable)/.test(value);
}

/* ── Element evidence ────────────────────────────────────────────── *
 *
 * "Is this a tap target?" is a fact about the ELEMENT, not about the class
 * name. The scanner reads that fact out of the component sources instead of
 * guessing from selector suffixes, so a decorative span whose name merely
 * contains "toggle" is not mistaken for a control, and a real button is never
 * missed because its class lacks an interactive-sounding suffix.
 *
 * The reader is a quote- and brace-aware JSX tokenizer that recurses into a
 * tag's interior, because JSX nests: 'items={xs.map((x) => (<span .../>))}'
 * puts a real element inside another tag's attribute expression.
 *
 * Limitation, stated so it is not over-read: a class name assembled entirely
 * at runtime (a variable holding a whole className string) cannot be seen.
 * A selector whose class has no element evidence is reported as a DEAD
 * SELECTOR exemption rather than passing silently.
 */

const NATIVE_INTERACTIVE_TAGS = new Set([
  'button', 'a', 'summary', 'select', 'input', 'textarea', 'option', 'label',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'tab', 'switch', 'radio', 'menuitem', 'checkbox', 'link',
]);

/**
 * The coarse-pointer catch-all at ui/src/theme/components.css:1455-1467:
 *
 *   @media (pointer: coarse) {
 *     button, a, [role="button"], input, select, textarea,
 *     [role="tab"], [role="radio"], [role="switch"], summary, label {
 *       min-height: var(--touch-target-min);
 *       min-width: var(--touch-target-min);
 *     }
 *     .btn, .card-clickable, .nav-item, [role="tablist"] [role="tab"] {
 *       min-height: var(--touch-target-comfortable);
 *       min-width: var(--touch-target-comfortable);
 *     }
 *   }
 *
 * Both shells load that sheet (ui/src/main.tsx:9 and ui/src/main.mobile.tsx:22
 * import './theme/components.css'), so on the tablet a covered element is
 * floored at 44px (48px for the class list).
 *
 * SPECIFICITY, which decides how far the rescue reaches:
 *   - 'height: 36px' / 'width: 36px' on a covered element is NOT a violation.
 *     The catch-all's min-* is a different property and wins the used-value
 *     computation (max(36, 44) = 44) whatever the selector's specificity. This
 *     is the deliberate compact-desktop / comfortable-touch split.
 *   - 'min-height: 34px' on a selector that OUTRANKS the catch-all (anything
 *     with a class, id or attribute -- '.kds-tab' is 0,1,0 against the
 *     catch-all's 0,0,1) IS a violation: min-* against min-* is the same
 *     property, and the more specific rule wins on the touch surface.
 *   - 'min-height' on a bare type selector TIES the catch-all at 0,0,1 and
 *     source order decides, which is not a guarantee -- so it is exempted only
 *     when it ties, and that exemption is labelled as order-dependent.
 *
 * A sheet may also raise its own control inside a local @media (pointer: coarse)
 * block (e.g. .license-input-clear: var(--space-8) at fine pointer, var(--space-11)
 * = 44px under coarse). That override is the intended touch behaviour and is
 * credited -- see loadCoarseOverrides().
 */
const CATCH_ALL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label']);
const CATCH_ALL_ROLES = new Set(['button', 'tab', 'radio', 'switch']);
const CATCH_ALL_CLASSES = new Set(['btn', 'card-clickable', 'nav-item']);

interface ElementEvidence {
  tags: Set<string>;
  roles: Set<string>;
  allAriaHidden: boolean;
  anyAriaHidden: boolean;
  anyOnClick: boolean;
}

function classTokens(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of raw) {
    if (/[A-Za-z0-9_-]/.test(ch)) cur += ch;
    else { if (cur) out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Read a JSX attribute value: a quoted string, or a balanced brace expression. */
function readAttr(tag: string, name: string): string | null {
  const i = tag.indexOf(name + '=');
  if (i === -1) return null;
  const j = i + name.length + 1;
  const q = tag[j];
  if (q === '"' || q === "'") {
    const e = tag.indexOf(q, j + 1);
    return e === -1 ? null : tag.slice(j + 1, e);
  }
  if (q === '{') {
    let depth = 0;
    for (let k = j; k < tag.length; k++) {
      if (tag[k] === '{') depth++;
      else if (tag[k] === '}') { depth--; if (depth === 0) return tag.slice(j + 1, k); }
    }
    return null;
  }
  return null;
}

function walkFiles(dir: string, exts: string[], out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, exts, out);
    else if (exts.some((x) => entry.name.endsWith(x))) out.push(p);
  }
  return out;
}

const IS_QUOTE = (c: string): boolean => c === '"' || c === "'" || c === BACKTICK;

/**
 * Collect opening tags from JSX source. Prose is skipped (an apostrophe in a
 * comment must not open a string), and a tag's interior is scanned again so
 * nested JSX inside a brace expression is found.
 */
function collectTags(
  text: string,
  out: Array<{ name: string; tag: string }>,
): Array<{ name: string; tag: string }> {
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== '<') { i++; continue; }
    const nm = /^<([A-Za-z][A-Za-z0-9.]*)/.exec(text.slice(i, Math.min(i + 40, n)));
    if (!nm) { i++; continue; }
    const tagName = nm[1]!;

    let j = i + 1 + tagName.length;
    let depth = 0;
    let quote: string | null = null;
    let gt = -1;
    while (j < n) {
      const c = text[j] ?? '';
      if (quote) { if (c === quote) quote = null; j++; continue; }
      if (IS_QUOTE(c)) { quote = c; j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { gt = j; break; }
      j++;
    }
    if (gt === -1) break;

    const tag = text.slice(i, gt + 1);
    out.push({ name: tagName.toLowerCase(), tag });
    collectTags(tag.slice(1 + tagName.length, tag.length - 1), out);
    i = gt + 1;
  }
  return out;
}

/** class -> evidence, harvested from every component source under ui/src. */
function harvestElementEvidence(): Map<string, ElementEvidence> {
  const map = new Map<string, ElementEvidence>();
  const sources = walkFiles(UI_SRC, ['.tsx', '.ts'], []).filter(
    (f) => !/\.test\.|__tests__|\.d\.ts$/.test(f.replace(/\\/g, '/')),
  );

  for (const file of sources) {
    for (const { name, tag } of collectTags(readFileSync(file, 'utf-8'), [])) {
      const rawClass = readAttr(tag, 'className');
      if (!rawClass) continue;
      const role = (readAttr(tag, 'role') || '').replace(/[^a-z]/g, '');
      const aria = readAttr(tag, 'aria-hidden');
      const ariaHidden = aria !== null && aria.trim() === 'true';
      const onClick = /\bonClick\b|\bonPointerDown\b/.test(tag);
      for (const cls of classTokens(rawClass)) {
        const ev = map.get(cls) ?? {
          tags: new Set<string>(), roles: new Set<string>(),
          allAriaHidden: true, anyAriaHidden: false, anyOnClick: false,
        };
        ev.tags.add(name);
        if (role) ev.roles.add(role);
        if (ariaHidden) ev.anyAriaHidden = true; else ev.allAriaHidden = false;
        if (onClick) ev.anyOnClick = true;
        map.set(cls, ev);
      }
    }
  }
  return map;
}

/* ── Selector classification ─────────────────────────────────────── */

/**
 * Interactive class vocabulary, matched as a whole hyphen/underscore/dot
 * segment, so .kds-back-btn and .sidebar-toggle match while a segment named
 * "check" on a decorative swatch does not match on an unrelated prefix.
 */
const INTERACTIVE_CLASS_RE = new RegExp(
  '(?:^|[-_.])(?:' +
    [
      'btn', 'button', 'tab', 'switch', 'toggle', 'close', 'dismiss', 'clear',
      'nav-item', 'filter-btn', 'modal-close', 'line-remove', 'theme-toggle',
      'card-clickable', 'action-button', 'icon-btn', 'clickable', 'bell',
    ].join('|') +
  ')\\b',
  'i',
);

// Restaurant surface (resto-pos tackle-all Phase 5): exact-match controls from
// the menu sheet. These names carry no interactive suffix, so they are listed
// exactly rather than matched by a pattern.
//
// Two deliberate non-matches, unchanged: .restaurant-card is the product tile
// itself and is graded by the card-height suite rather than by a height
// declaration (the scanner cannot resolve its calc() of --space-* tokens and
// mis-reads it as 22px); the colour swatches are decorative fill (no text) and
// are graded by their focus treatment, not their size.
const RESTAURANT_INTERACTIVE_RE =
  /^\s*\.(?:restaurant-sidebar-btn|restaurant-hamburger-btn|restaurant-sidebar-item|restaurant-hamburger-item|restaurant-category-pill|restaurant-search-clear|restaurant-context-item|restaurant-size-btn)\s*$/i;

/** Selectors to skip — structural non-targets. */
const SKIP_SELECTOR_RE = [
  // Custom toggle switch internals: hidden native checkbox, visual track/thumb
  /\.toggle-switch\s+input/,
  /\.toggle-track/,
  /\.toggle-thumb/,
  // SVG/icon children inside interactive parents
  /\s+svg$/,
  /\s+\.icon/,
  /\s+img$/,
  // Decorative / status elements that aren't interactive
  /\.statusbar-dot/,
  /\.statusbar-divider/,
  /\.statusbar-segment/,
  /\.setup-step-dot/,
  /\.setup-step-line/,
  // Pseudo-elements
  /::before|::after/,
  // Skeleton and spinner parts
  /\.skeleton/,
  /\.spinner/,
  /__spinner/,
  // Visually-hidden text (1px is the point, not a target)
  /\.sr-only/,
  // Parts of a control, never the control: the subject segment names one of
  // these roles, so its size is set by its parent, not by a tap target.
  /(?:^|[-_.])(?:spinner|badge|dot|count|thumb|knob|indicator|divider)\b/,
  /\.caret\b/,
];

/**
 * Explicit, deliberate exceptions. Each names a selector that is genuinely
 * small and genuinely not a tap target, and each is asserted to still be
 * needed: an exemption that no longer matches a violation fails the suite as
 * stale. Weakening MIN_TARGET_PX globally is never the correct fix.
 */
const EXPLICIT_EXEMPTIONS: Array<{ re: RegExp; why: string; matched: boolean }> = [
  {
    re: /^\.settings-toggle-switch$/,
    why: 'Visual track of a custom switch (a span over a hidden input). The interactive element is the nested input, which the coarse-pointer catch-all floors at 44px.',
    matched: false,
  },
  {
    re: /^\.terminal-mgmt-toggle-switch$/,
    why: 'Same shape as .settings-toggle-switch: a span track over a hidden input, which the catch-all floors at 44px.',
    matched: false,
  },
];

/**
 * RATCHET — the real violations this widening surfaced, named one by one.
 *
 * Every entry is a min-* floor on a selector that outranks the coarse-pointer
 * catch-all (see the specificity note above), so it DOES shrink the touch
 * target on the tablet. They are outside this slice's fence, so they are
 * recorded rather than silently dropped: the set is asserted exactly, and the
 * suite fails if it grows OR if an entry is fixed and left here. The list can
 * only shrink. Fixing them is the R4 follow-up.
 */
const KNOWN_VIOLATIONS: Array<{ key: string; why: string }> = [
  { key: 'components/SegmentedTabs.css::.segmented-tab::min-height: calc(var(--text-base) + 2 * var(--space-2) + 2px)', why: "Segmented tab strip; computes to 32px at a 16px root. Deliberately tied to .btn--md height (see that sheet header), so this is a design decision, not an oversight." },
  { key: 'features/inventory/StockCountDetail.css::.sc-remove-btn::min-height: 1.75rem', why: "Stock-count row remove control; 28px floor." },
  { key: 'features/inventory/StockCountDetail.css::.sc-remove-btn::min-width: 1.75rem', why: "Stock-count row remove control; 28px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-btn--filter::min-height: 34px', why: "KDS filter button; 34px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-btn--shift::min-height: 34px', why: "KDS shift button; 34px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-btn::min-height: 22px', why: "KDS base button; 22px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-modal-actions .kds-btn::min-height: 28px', why: "KDS modal action button; 28px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-offline-retry-btn::min-height: 1.75rem', why: "KDS offline retry control; 28px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-reset-btn::min-height: 38px', why: "KDS reset button; 38px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-status-btn::min-height: 34px', why: "KDS status button; 34px floor." },
  { key: 'features/kds/KdsScreen.css::.kds-tab::min-height: 34px', why: "KDS tab strip; 34px floor." },
  { key: 'features/kds/components/KdsRoutingRulesEditor.css::.kds-routing-btn::min-height: 34px', why: "KDS routing action button; 34px floor." },
  { key: 'features/kds/components/KdsRoutingRulesEditor.css::.kds-routing-section-btn::min-height: 34px', why: "KDS routing section toggle; 34px floor." },
  { key: 'features/kiosk/KioskScreen.css::.kiosk-load-error button::min-height: var(--space-10)', why: "Kiosk load-error retry button; 2.5rem = 40px floor. The class+type compound (0,1,1) outranks the catch-all." },
  { key: 'features/locations/NodeTopologyEditor.css::.canvas-zoom-btn::min-width: 28px', why: "Topology canvas zoom control; 28px floor." },
];

function isSkipSelector(selectors: string): boolean {
  return SKIP_SELECTOR_RE.some((re) => re.test(selectors));
}

/** The compound a rule actually styles: the last segment of its first selector. */
function subjectOfSelector(selectors: string): string {
  const first = selectors.split(',')[0]!.trim();
  const withoutPseudos = first
    .replace(/::[a-z-]+\([^()]*\)/gi, '')
    .replace(/::[a-z-]+/gi, '')
    .replace(/:[a-z-]+\([^()]*\)/gi, '')
    .replace(/:[a-z-]+/gi, '');
  const segments = withoutPseudos.split(/[\s>+~]+/).filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

function subjectClasses(subject: string): string[] {
  return [...subject.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]!);
}

function isInteractiveSelector(selectors: string): boolean {
  if (isSkipSelector(selectors)) return false;
  const subject = subjectOfSelector(selectors);
  if (subjectClasses(subject).length === 0) {
    // A bare type selector: grade only the tags the catch-all itself names.
    return CATCH_ALL_TAGS.has(subject.toLowerCase());
  }
  return INTERACTIVE_CLASS_RE.test(subject) || RESTAURANT_INTERACTIVE_RE.test(selectors);
}

/* ── CSS parsing ─────────────────────────────────────────────────── */

/**
 * Brace-matched, nesting-aware rule reader. The previous reader used a flat
 * /[^{}]*\{[^{}]*\}/ match, which cannot represent a block nested inside an
 * at-rule and left the coarse-pointer state to a flag reset by the next rule.
 * Here every rule carries the at-rule stack it sits in.
 */
function matchBrace(css: string, open: number, end: number): number {
  let depth = 0;
  for (let i = open; i < end; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return end;
}

function parseRules(
  css: string,
  out: ParsedRule[],
  start = 0,
  end = css.length,
  atStack: string[] = [],
): ParsedRule[] {
  let i = start;
  while (i < end) {
    const brace = css.indexOf('{', i);
    if (brace === -1 || brace >= end) break;
    // A declaration before the next block means we are inside a block body.
    const semi = css.indexOf(';', i);
    if (semi !== -1 && semi < brace) { i = semi + 1; continue; }

    const close = matchBrace(css, brace, end);
    const prelude = css.slice(i, brace).trim();
    if (prelude.startsWith('@')) {
      parseRules(css, out, brace + 1, close, [...atStack, prelude]);
    } else if (prelude) {
      out.push({
        selectors: prelude,
        body: css.slice(brace + 1, close),
        inPointerCoarse: atStack.some((a) => COARSE_QUERY_RE.test(a)),
      });
    }
    i = close + 1;
  }
  return out;
}

/**
 * Every stylesheet under ui/src, derived from the filesystem.
 *
 * This replaces the hand-maintained CSS_FILES list, which had drifted to 70
 * entries against 140 files on disk: 71 sheets were never scanned, and the one
 * listed path that no longer exists (features/setup/SetupWizard.css) was
 * silently skipped by an existsSync guard. A hardcoded list cannot stay honest
 * as files are added, so it is gone rather than extended.
 */
function discoverCssFiles(): string[] {
  return walkFiles(UI_SRC, ['.css'], []).sort();
}

const SIZING_PROP_RE = /^(min-)?(height|width)\s*:\s*(.+)$/;
const AUTO_VALUE_RE = /^\s*auto\s*;?\s*$/;

interface ScanResult {
  violations: Violation[];
  exemptions: Array<{ file: string; selector: string; why: string }>;
  uncomputable: string[];
  gradedRules: number;
  coarseRules: number;
}

/**
 * Selectors that a sheet raises to >= 44px inside its OWN @media (pointer:
 * coarse) block, keyed 'file::subject'. Such a control is fine-pointer compact
 * and coarse-pointer compliant by construction, so its fine-pointer min-* is
 * not a violation -- the coarse override is the touch behaviour.
 */
function loadCoarseOverrides(tokens: Map<string, string>): Set<string> {
  const raised = new Set<string>();
  for (const file of discoverCssFiles()) {
    const rel = relative(UI_SRC, file).replace(/\\/g, '/');
    const stripped = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of parseRules(stripped, [])) {
      if (!rule.inPointerCoarse) continue;
      const subject = subjectOfSelector(rule.selectors);
      for (const decl of rule.body.split(';')) {
        const m = SIZING_PROP_RE.exec(decl.trim());
        if (!m) continue;
        const px = parsePxValue(m[3]!.trim(), tokens);
        if (px !== null && px >= MIN_TARGET_PX) raised.add(rel + '::' + subject);
      }
    }
  }
  return raised;
}

function scanCSS(
  filePath: string,
  evidence: Map<string, ElementEvidence>,
  tokens: Map<string, string>,
  coarseOverrides: Set<string>,
): ScanResult {
  const content = readFileSync(filePath, 'utf-8');
  const rel = relative(UI_SRC, filePath).replace(/\\/g, '/');
  const result: ScanResult = {
    violations: [], exemptions: [], uncomputable: [], gradedRules: 0, coarseRules: 0,
  };

  // Strip block comments for easier parsing.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const rule of parseRules(stripped, [])) {
    if (rule.inPointerCoarse) result.coarseRules++;
    if (!isInteractiveSelector(rule.selectors)) continue;
    result.gradedRules++;

    const selector = rule.selectors.replace(/\s+/g, ' ').trim();
    const subject = subjectOfSelector(rule.selectors);
    const classes = subjectClasses(subject);

    // What element(s) does this rule actually style? A bare type selector names
    // its own tag; a class selector names classes whose element evidence we
    // harvested from the component sources.
    const bareTag = classes.length === 0;
    const evidenceFor = classes
      .map((c) => evidence.get(c))
      .filter((e): e is ElementEvidence => Boolean(e));
    const noElementAtAll = !bareTag && evidenceFor.length === 0;
    const hasCatchAllClass = classes.some((c) => CATCH_ALL_CLASSES.has(c));
    // Every element carrying this class is aria-hidden: decorative fill, not a
    // tap target, so its size is set by its parent.
    const decorative = !bareTag && evidenceFor.length > 0 && evidenceFor.every((ev) => ev.allAriaHidden);
    const elementTags = bareTag
      ? [subject.toLowerCase()]
      : [...new Set(evidenceFor.flatMap((ev) => [...ev.tags]))];
    const coveredByCatchAll =
      hasCatchAllClass ||
      (elementTags.length > 0 && elementTags.every((t) => CATCH_ALL_TAGS.has(t))) ||
      evidenceFor.some((ev) => [...ev.roles].some((r) => CATCH_ALL_ROLES.has(r)));

    // A bare type selector ties the catch-all's own type selector; anything
    // carrying a class, id or attribute beats it, so a competing min-* survives.
    const selectorOutranksCatchAll = /[.#[]/.test(rule.selectors);

    const explicit = EXPLICIT_EXEMPTIONS.find((e) => e.re.test(subject));
    const hasCoarseOverride = coarseOverrides.has(rel + '::' + subject);

    for (const decl of rule.body.split(';')) {
      const trimmedDecl = decl.trim();
      const match = SIZING_PROP_RE.exec(trimmedDecl);
      if (!match) continue;

      const isMin = Boolean(match[1]);
      const prop = (match[1] ?? '') + (match[2] ?? '');
      const value = (match[3] ?? '').trim();
      if (AUTO_VALUE_RE.test(value)) continue;
      if (referencesTouchTarget(value)) continue;

      const px = parsePxValue(value, tokens);
      if (px === null) {
        // Not silently dropped: an uncomputable size is reported as such, and
        // the suite bounds how many there may be.
        result.uncomputable.push(rel + ' ' + selector + ' -- ' + prop + ': ' + value);
        continue;
      }
      if (px >= MIN_TARGET_PX) continue;

      // 'height'/'width' on a covered element is floored by the catch-all's
      // min-* whatever the specificity; a min-* declaration is a different story.
      if (decorative) {
        result.exemptions.push({
          file: rel, selector,
          why: 'DECORATIVE: every element with this class is aria-hidden, so it is not a tap target',
        });
        continue;
      }
      if (!isMin && coveredByCatchAll) {
        result.exemptions.push({
          file: rel, selector,
          why: 'height/width floored by the @media (pointer: coarse) catch-all in theme/components.css',
        });
        continue;
      }
      // A min-* that ties the catch-all (both plain type selectors) is exempt
      // only because source order currently favours the catch-all.
      if (isMin && coveredByCatchAll && !selectorOutranksCatchAll) {
        result.exemptions.push({
          file: rel, selector,
          why: 'min-* ties the coarse-pointer catch-all (both are plain type selectors); source order decides',
        });
        continue;
      }
      // A min-* the sheet itself raises under coarse is the touch behaviour.
      if (isMin && hasCoarseOverride) {
        result.exemptions.push({
          file: rel, selector,
          why: 'raised to >=44px by this sheet own @media (pointer: coarse) override',
        });
        continue;
      }
      if (explicit) {
        explicit.matched = true;
        result.exemptions.push({ file: rel, selector, why: explicit.why });
        continue;
      }
      if (noElementAtAll) {
        result.exemptions.push({
          file: rel, selector,
          why: 'DEAD SELECTOR: no element in the sources carries this class',
        });
        continue;
      }

      const idx = content.indexOf(rule.selectors.split(',')[0]!.trim());
      result.violations.push({
        file: rel,
        line: idx !== -1 ? content.slice(0, idx).split('\n').length : 0,
        selector,
        declaration: prop + ': ' + value,
        reason: Math.round(px * 100) / 100 + 'px < ' + MIN_TARGET_PX + 'px minimum touch target (' + prop + ')',
      });
    }
  }

  return result;
}

/* ── Fixtures ────────────────────────────────────────────────────── */

let allViolations: Violation[];
let allExemptions: Array<{ file: string; selector: string; why: string }>;
let allUncomputable: string[];
let gradedRules = 0;
let coarseRules = 0;
let cssFiles: string[] = [];
let evidence: Map<string, ElementEvidence>;

beforeAll(() => {
  const tokens = loadTokens();
  evidence = harvestElementEvidence();
  cssFiles = discoverCssFiles();
  const coarseOverrides = loadCoarseOverrides(tokens);
  allViolations = [];
  allExemptions = [];
  allUncomputable = [];

  for (const file of cssFiles) {
    const result = scanCSS(file, evidence, tokens, coarseOverrides);
    allViolations.push(...result.violations);
    allExemptions.push(...result.exemptions);
    allUncomputable.push(...result.uncomputable);
    gradedRules += result.gradedRules;
    coarseRules += result.coarseRules;
  }
});

/* ── Tests ───────────────────────────────────────────────────────── */

describe('Touch target sizing compliance', () => {
  it('scans every stylesheet under ui/src, derived from the filesystem', () => {
    // A hardcoded list is the drift this suite exists to prevent; if the walk
    // ever returns a token set, fail loudly rather than pass vacuously.
    expect(cssFiles.length).toBeGreaterThan(100);
    expect(cssFiles.some((f) => f.endsWith(join('theme', 'tokens.css')))).toBe(true);
  });

  it('the coarse-pointer catch-all the exemptions depend on still exists', () => {
    const css = readFileSync(CATCH_ALL_CSS, 'utf-8');
    const block = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ''), [])
      .filter((r) => r.inPointerCoarse);
    expect(block.length, 'no @media (pointer: coarse) block in theme/components.css').toBeGreaterThan(0);
    const body = block.map((r) => r.body).join('\n');
    expect(body).toMatch(/min-height:\s*var\(--touch-target-min\)/);
    expect(body).toMatch(/min-width:\s*var\(--touch-target-min\)/);
    // The sheet must actually be loaded by the tablet shell.
    const mobileEntry = readFileSync(resolve(UI_SRC, 'main.mobile.tsx'), 'utf-8');
    expect(mobileEntry).toMatch(/theme\/components\.css/);
  });

  it('grades width as well as height, including inside @media (pointer: coarse)', () => {
    // If either half of the widening silently stops working, this fails.
    expect(gradedRules).toBeGreaterThan(0);
    expect(coarseRules, 'no interactive rule found inside a pointer:coarse block').toBeGreaterThan(0);
  });

  it('resolves tokens and calc(), so a quoted px figure is the computed one', () => {
    const tokens = loadTokens();
    expect(parsePxValue('var(--touch-target-min)', tokens)).toBe(44);
    expect(parsePxValue('2rem', tokens)).toBe(32);
    // Multiplication must not be dropped: 0.875rem + 2*0.5rem + 2px = 32px.
    expect(parsePxValue('calc(var(--text-base) + 2 * var(--space-2) + 2px)', tokens)).toBe(32);
    // A percentage cannot be resolved to px and must say so, not guess.
    expect(parsePxValue('calc(100% - 2px)', tokens)).toBeNull();
  });

  it('the ratchet matches the violations actually found, exactly', () => {
    const found = allViolations
      .map((v) => v.file + '::' + v.selector + '::' + v.declaration)
      .sort();
    const known = KNOWN_VIOLATIONS.map((k) => k.key).sort();

    const added = found.filter((f) => !known.includes(f));
    const fixed = known.filter((k) => !found.includes(k));

    expect(
      added,
      'NEW touch-target violations (fix these, or justify and add to KNOWN_VIOLATIONS):\n' +
        added.map((a) => '  ' + a).join('\n') +
        '\n\nAll found (' + found.length + '):\n' + found.map((f) => '  ' + f).join('\n'),
    ).toHaveLength(0);

    expect(
      fixed,
      'These KNOWN_VIOLATIONS no longer violate — remove them from the ratchet:\n' +
        fixed.map((f) => '  ' + f).join('\n'),
    ).toHaveLength(0);
  });

  it('bounds and reports declarations whose size cannot be computed', () => {
    // Not a pass-by-silence: the count is bounded and the list is printed.
    expect(
      allUncomputable.length,
      'Too many uncomputable interactive sizes (' + allUncomputable.length + '):\n' +
        allUncomputable.map((u) => '  ' + u).join('\n'),
    ).toBeLessThan(120);
  });

  it('reports the ratchet debt with a count', () => {
    // The honest partial: every entry above is a real below-floor min-* that
    // outranks the coarse-pointer catch-all, i.e. genuine tablet touch-target
    // debt. It is named and counted rather than fixed, because those sheets sit
    // outside this slice fence. This test fails if the debt is quietly enlarged
    // or if an entry is deleted without the violation being fixed.
    expect(KNOWN_VIOLATIONS.length).toBe(15);
  });

  it('every exemption is justified, and none is a silent bypass', () => {
    for (const e of allExemptions) {
      expect(e.why.length, 'exemption without a reason: ' + e.file + ' ' + e.selector).toBeGreaterThan(20);
    }
    // The harvest must be finding real elements; a broken parser would make
    // every selector look dead and exempt the whole suite.
    const interactiveClasses = [...evidence.entries()].filter(([, ev]) =>
      [...ev.tags].some((t) => NATIVE_INTERACTIVE_TAGS.has(t)) ||
      [...ev.roles].some((r) => INTERACTIVE_ROLES.has(r)));
    expect(interactiveClasses.length, 'element harvest looks broken').toBeGreaterThan(200);
    // A stale explicit exemption must not sit there forever.
    const stale = EXPLICIT_EXEMPTIONS.filter((e) => !e.matched).map((e) => e.re.source);
    expect(stale, 'stale explicit exemption(s): ' + stale.join(', ')).toHaveLength(0);
  });
});
