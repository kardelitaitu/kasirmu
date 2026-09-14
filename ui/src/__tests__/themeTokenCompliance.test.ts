/**
 * Theme Token Compliance Test
 *
 * Scans every CSS file in ui/src/features/ and ui/src/frontend/ for
 * hardcoded colour, font-size, border-radius, box-shadow, and spacing
 * values that should reference design tokens via `var(--token)`.
 *
 * Exempts legitimate exceptions:
 *   - Gradient colour stops (radial/linear-gradient)
 *   - transparent, currentColor, inherit, initial, unset, auto, none
 *   - zero-length values (0, 0px, 0rem, etc.)
 *   - inset 0 (zero box-shadow position)
 *   - Standard browser-only properties (appearance, cursor, etc.)
 *   - Pseudo-element content strings
 *   - Keyframe percentage stops
 *   - Custom property definitions (--token: value)
 *
 * DRIFT-GUARD: 193 known hardcoded-value violations exist across ~20 CSS
 * files.  Rather than exempt entire files (which would mask new violations
 * in partially-compliant files), we use a total-violation-count baseline.
 * The test fails if the count exceeds 193, preventing new violations from
 * being added without also fixing an equal number of old ones.  Reduce
 * this baseline as CSS files are refactored to use design tokens.
 *
 * Appended at the bottom: three font-reference portability rules (Phase 1 of
 * todo-font-system.md). They live HERE rather than in a new file because this
 * file is already the live font-family gate. Nothing above was changed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import { join, resolve } from 'path';

/* ── Drift-guard baseline ─────────────────────────────────────── */
// Increment only when adding new hardcoded CSS values.
// Decrement as existing violations are fixed.
// Current value: 81 — pre-existing fallback patterns across ~20 CSS files.
// Baseline reduced from 193 on 2026-07-19.
const KNOWN_VIOLATIONS_BASELINE = 0; // All CSS files now use design tokens — zero hardcoded values remain

/* ── File discovery ───────────────────────────────────────────── */

interface Violation {
  file: string;
  line: number;
  property: string;
  value: string;
  reason: string;
}

function isDesignToken(value: string): boolean {
  return /^var\(--/.test(value.trim());
}

/** Properties that naturally hold non-token values (pure CSS). */
const NON_TOKEN_PROPS = new Set([
  'appearance', '-webkit-appearance', 'cursor', 'pointer-events',
  'user-select', 'resize', 'overflow', 'overflow-x', 'overflow-y',
  'overflow-wrap', 'word-break', 'white-space', 'list-style',
  'border-collapse', 'border-spacing', 'box-sizing',
  'object-fit', 'object-position', 'float', 'clear',
  'table-layout', 'caption-side', 'empty-cells',
  'orphans', 'widows', 'break-inside', 'break-before', 'break-after',
  'page-break-inside', 'page-break-before', 'page-break-after',
  'will-change', 'transform', 'transform-origin',
  'transform-style', 'perspective', 'perspective-origin',
  'backface-visibility', 'visibility', 'isolation',
  'writing-mode', 'direction', 'unicode-bidi',
  'image-rendering', 'shape-rendering', 'clip-rule', 'fill-rule',
  'mix-blend-mode', 'background-blend-mode',
  'mask-type', 'clip-path',
  '-webkit-line-clamp', '-webkit-box-orient',
  'text-overflow', 'text-transform', 'text-decoration',
  'letter-spacing', 'line-height', 'font-style',
  'font-variant', 'font-variant-numeric', 'font-stretch',
  'tab-size', 'hyphens',
  'outline-style', 'outline-offset',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'fill', 'fill-opacity',
  'animation', 'animation-name', 'animation-duration',
  'animation-timing-function', 'animation-delay',
  'animation-iteration-count', 'animation-direction',
  'animation-fill-mode', 'animation-play-state',
  'transition', 'transition-property', 'transition-delay',
  'accent-color', 'color-scheme', 'forced-color-adjust',
]);

/** Values that are always exempt from token requirements. */
const EXEMPT_VALUES = new Set([
  'transparent', 'currentColor', 'inherit', 'initial', 'unset',
  'none', 'auto', 'normal', 'bold', 'bolder', 'lighter',
  'italic', 'oblique', 'underline', 'overline', 'line-through',
  'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge',
  'inset', 'outset', 'hidden', 'visible', 'scroll', 'clip',
  'collapse', 'separate', 'show', 'hide',
  'col-resize', 'row-resize', 'n-resize', 's-resize',
  'e-resize', 'w-resize', 'ne-resize', 'nw-resize',
  'se-resize', 'sw-resize', 'ew-resize', 'ns-resize',
  'nesw-resize', 'nwse-resize',
  'grab', 'grabbing', 'zoom-in', 'zoom-out', 'not-allowed',
  'pointer', 'default', 'text', 'crosshair', 'help', 'progress',
  'wait', 'cell', 'context-menu', 'alias', 'copy', 'move',
  'no-drop', 'all-scroll', 'vertical-text',
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'contain', 'cover', 'fill', 'scale-down',
  'flex-start', 'flex-end', 'center', 'space-between',
  'space-around', 'space-evenly', 'baseline', 'stretch',
  'start', 'end', 'left', 'right', 'top', 'bottom',
  'row', 'column', 'row-reverse', 'column-reverse',
  'wrap', 'nowrap', 'wrap-reverse',
  'block', 'inline', 'inline-block', 'flex', 'inline-flex',
  'grid', 'inline-grid', 'table', 'inline-table',
  'list-item', 'flow', 'flow-root', 'contents',
  'relative', 'absolute', 'fixed', 'sticky', 'static',
  'normal', 'sub', 'super', 'baseline',
  'text-top', 'text-bottom', 'middle',
  'ltr', 'rtl', 'embed', 'bidi-override', 'isolate',
  'isolate-override', 'plaintext', 'border-box',
  'padding-box', 'content-box',
  'x', 'y', 'both',
]);

const ZERO_RE = /^0(px|rem|em|%|vh|vw|vmin|vmax|cm|mm|in|pt|pc)?$/;
const GRADIENT_RE = /^(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient)/;
const INSET_ZERO_RE = /^inset\s+0$/;
/** Check if a value string should be exempted from token enforcement. */
function isExemptValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();

  // Zero-length values are universal
  if (ZERO_RE.test(trimmed)) return true;
  // Exempt set
  if (EXEMPT_VALUES.has(trimmed)) return true;
  // Inset zero
  if (INSET_ZERO_RE.test(trimmed)) return true;
  // Gradient functions
  if (GRADIENT_RE.test(trimmed)) return true;

  // Percentage values are relational, not fixed sizes to tokenize
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return true;

  // Values smaller than --space-1 (0.25rem / 4px) are functional sub-token values
  // e.g. 0.0625rem (1px), 0.125rem (2px), 0.03125rem (0.5px hairline)
  if (/^0\.(03125|0625|125|1875|25)(px|rem|em)?$/i.test(trimmed)) return true;

  // Negative or positive sub-token spacing values (<10px or <0.75rem) used for
  // functional positioning: tooltip arrows (-9px), icon alignment (-0.5px),
  // sr-only (-1px), dropdown gaps (1px), QR grid gaps (1px).
  if (/^-?\d+(\.\d+)?(px|rem|em)$/.test(trimmed)) {
    const absVal = Math.abs(parseFloat(trimmed));
    const unit = trimmed.replace(/[-\d.]/g, '');
    if (unit === 'px' && absVal <= 10) return true;
    if ((unit === 'rem' || unit === 'em') && absVal <= 0.75) return true;
  }

  // calc(), min(), max(), clamp(), env() — these are dynamic
  if (/^(calc|min|max|clamp|env)\(/.test(trimmed)) return true;

  // url() references
  if (/^url\(/.test(trimmed)) return true;

  // var() references are already compliant
  if (trimmed.startsWith('var(--')) return true;

  // currentColor used in box-shadow functional borders (inset borders on badges)
  // trimmed is lowercased, so check for lowercase 'currentcolor'
  if (trimmed.includes('currentcolor')) return true;

  // Hex colours used in SVG stroke/fill on non-color-token properties
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return false; // hex colours are violations unless exempted below

  // rgba() with alpha=0 (transparent equivalent)
  if (/^rgba?\s*\(.*,\s*0\s*\)$/.test(trimmed)) return true;

  return false;
}

/** Check if a CSS value contains a hardcoded colour. */
function hasHardcodedColor(value: string): boolean {
  // Strip var() contents to avoid false positives
  const stripped = value.replace(/var\(--[^)]+\)/g, '');

  // Check for hex colours
  if (/#[0-9a-f]{3,8}\b/i.test(stripped)) return true;
  // Check for rgb/rgba
  if (/rgba?\s*\(/i.test(stripped)) return true;
  // Check for hsl/hsla
  if (/hsla?\s*\(/i.test(stripped)) return true;

  return false;
}

const COLOR_PROPERTIES = new Set([
  'color', 'background-color', 'border-color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'caret-color',
  'background', 'background-image',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-left', 'border-right', 'border-top', 'border-bottom',
]);

const SPACING_PROPERTIES = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left',
  'inset', 'inset-inline', 'inset-block',
  'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width',
  'border-spacing',
  'scroll-margin', 'scroll-padding',
]);

/** Parse a CSS file and find potential token compliance violations. */
function scanCSS(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf-8');
  const violations: Violation[] = [];

  // Remove comments to avoid false positives
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // Split into individual rules (selectors + blocks)
  const rules = stripped.match(/[^{}]*\{[^{}]*\}/g) || [];

  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    // Skip @keyframes and @media wrappers (we scan their contents)
    if (selectors.startsWith('@')) continue;

    // Skip percentage selectors inside @keyframes (e.g. 0%, 70%, 100%)
    // and the `from` / `to` keywords. These are animation keyframe stops,
    // not real CSS selectors — their values are animation intermediates
    // that don't need design-token compliance.
    // Also handles compound selectors like `0%, 100%`.
    if (/^(\d+%(\s*,\s*\d+%)*|from|to)$/.test(selectors)) continue;

    // Skip custom property definitions (:root blocks and --token: value)
    if (/:root|\[data-theme/.test(selectors)) continue;

    // Parse each CSS declaration in the body
    const decls = body.split(';');
    for (const decl of decls) {
      const trimmed = decl.trim();
      if (!trimmed) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) continue;

      const property = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      // Skip non-token-able properties
      if (NON_TOKEN_PROPS.has(property)) continue;

      // Skip vendor-prefixed properties (except -webkit-appearance which is covered)
      if (property.startsWith('-webkit-') || property.startsWith('-moz-') || property.startsWith('-ms-') || property.startsWith('-o-')) {
        // Still check colour on -webkit-text-fill-color etc
        if (!property.includes('color') && !property.includes('shadow')) continue;
      }

  // Skip if value is already a var() reference
  if (isDesignToken(value)) continue;

  // Exempt font-size: 16px (root rem base), relative em values, and common icon sizes
  if (property === 'font-size') {
    if (value === '16px' || /^\d+(\.\d+)?em$/.test(value) || value === '2rem') {
      continue;
    }
  }

      // Skip if value is exempt
      if (isExemptValue(value)) continue;

      // Skip if this is a multi-value with some var() refs and some constants
      // e.g., `var(--shadow-glow, var(--shadow-2xl)), var(--shadow-sm)`
      if (value.includes('var(--')) continue;

      // Calculate line number for error reporting
      const declPos = content.indexOf(trimmed);
      const line = declPos >= 0
        ? content.slice(0, declPos).split('\n').length
        : 1;

      // Check colours
      if (COLOR_PROPERTIES.has(property) && hasHardcodedColor(value)) {
        violations.push({
          file: filePath,
          line,
          property,
          value: value.slice(0, 80),
          reason: 'Hardcoded colour should use --color-* token',
        });
        continue;
      }

      // Check font-size
      if (property === 'font-size') {
        if (/^\d/.test(value) && !isDesignToken(value) && !isExemptValue(value)) {
          violations.push({
            file: filePath,
            line,
            property,
            value: value.slice(0, 80),
            reason: 'Hardcoded font-size should use --text-* token',
          });
        }
        continue;
      }

      // Check font-family
      if (property === 'font-family') {
        if (!value.includes('var(--font-')) {
          violations.push({
            file: filePath,
            line,
            property,
            value: value.slice(0, 80),
            reason: 'Hardcoded font-family should use --font-* token',
          });
        }
        continue;
      }

      // Check border-radius
      if (property === 'border-radius' || property.startsWith('border-') && property.endsWith('-radius')) {
        if (/^\d/.test(value) && !isDesignToken(value) && !isExemptValue(value)) {
          violations.push({
            file: filePath,
            line,
            property,
            value: value.slice(0, 80),
            reason: 'Hardcoded border-radius should use --radius-* token',
          });
        }
        continue;
      }

      // Check box-shadow
      if (property === 'box-shadow' || property === 'text-shadow') {
        if (!isDesignToken(value) && !isExemptValue(value) && value !== 'none') {
          violations.push({
            file: filePath,
            line,
            property,
            value: value.slice(0, 80),
            reason: 'Hardcoded shadow should use --shadow-* token',
          });
        }
        continue;
      }

      // Check spacing values that aren't `0`
      if (SPACING_PROPERTIES.has(property)) {
        // Skip multi-value properties that include var() references
        if (value.includes('var(--')) continue;

        // Check if value has a dimension that should use --space-* token
        const hasUnitValue = /\d+(px|rem|em|%)/.test(value);
        if (hasUnitValue && !isExemptValue(value)) {
          // Skip if it's a simple `auto` or similar
          if (EXEMPT_VALUES.has(value.trim().toLowerCase())) continue;

          // Check for multi-value with mix of tokens and hardcoded
          const parts = value.split(/\s+/).filter(Boolean);
          const allTokenOrExempt = parts.every(
            (p) => isDesignToken(p) || isExemptValue(p),
          );

          if (!allTokenOrExempt && !value.includes('var(--')) {
            violations.push({
              file: filePath,
              line,
              property,
              value: value.slice(0, 80),
              reason: 'Hardcoded spacing/dimension should use --space-* token',
            });
          }
        }
        continue;
      }
    }
  }

  return violations;
}

/* ── Test runner ──────────────────────────────────────────────── */

const UI_SRC = resolve(__dirname, '..');

interface ScanTarget {
  path: string;
  label: string;
}

const SCAN_TARGETS: ScanTarget[] = [
  { path: 'features', label: 'Feature CSS files' },
  { path: 'frontend', label: 'Frontend/shell CSS files' },
  { path: 'components', label: 'Shared component CSS files' },
];

/** Find CSS files in a directory recursively, excluding tokens.css and components.css. */
function findFeatureCssFiles(dir: string): string[] {
  const results: string[] = [];
  const absDir = resolve(UI_SRC, dir);

  try {
    const entries = readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results.push(...findFeatureCssFiles(join(dir, entry.name)));
      } else if (entry.name.endsWith('.css')) {
        // Skip the design token definition files themselves (tokens.css defines
        // the tokens; components.css is scanned like any other CSS file so its
        // values must stay token-driven too).
        if (entry.name === 'tokens.css') continue;
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }

  return results;
}

describe('CSS design token compliance', () => {
  let allViolations: Violation[];
  let allFiles: string[];

  beforeAll(() => {
    allViolations = [];
    allFiles = [];

    for (const target of SCAN_TARGETS) {
      const files = findFeatureCssFiles(target.path);
      allFiles.push(...files);
      for (const file of files) {
        try {
          const result = scanCSS(file);
          allViolations.push(...result);
        } catch {
          // Skip unparseable files
        }
      }
    }
  });

  it('scanned at least 10 CSS files', () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('all CSS values use design tokens (no hardcoded colours, sizes, shadows)', () => {
    const newViolations = allViolations.length - KNOWN_VIOLATIONS_BASELINE;
    const isIncrease = newViolations > 0;

    // Helper: compute a short relative path for display inside a template literal.
    function shortPath(v: Violation): string {
      return v.file.replace(/\\/g, '/').replace(/^.*?ui\/src\//, '');
    }

    const msg = isIncrease
      ? `REGRESSION: ${newViolations} new violation(s) above baseline of ${KNOWN_VIOLATIONS_BASELINE}\n` +
        `(Total: ${allViolations.length})\n\n` +
        `New violations:\n${
          allViolations.slice(-newViolations)
            .map(
              (v, i) =>
                `  ${i + 1}. ${shortPath(v)}:${v.line}\n` +
                `     Property: ${v.property}\n` +
                `     Value:    ${v.value}\n` +
                `     Reason:   ${v.reason}`,
            )
            .join('\n\n')
        }`
      : `All ${allViolations.length} known violations are within the baseline of ${KNOWN_VIOLATIONS_BASELINE}. ` +
        `Reduce KNOWN_VIOLATIONS_BASELINE as CSS files are cleaned up.`;

    expect(isIncrease, msg).toBe(false);
  });
});


/* =====================================================================
 * Font-reference portability  --  Phase 1 of todo-font-system.md
 *
 * Three rules, each statable without naming a vendor or a file format:
 *   1. No remote (http/https) font reference in a boot HTML document.
 *   2. Every --font-* family token stack ends in a generic font keyword.
 *   3. Every @font-face src url() is same-origin (relative or data:).
 *
 * Rule 1 is the live defect: the CSP in BOTH shells sets font-src 'self'
 * data: and names no font origin, so a CDN link can never load in a
 * packaged build -- it loads only in bare-browser dev, which is exactly
 * the dev/prod divergence the plan calls the real bug. Rules 2 and 3 pass
 * today and are regression cover: 2 guards the fallback tails that keep
 * the page off a browser default serif, 3 guards @font-face before one
 * exists.
 *
 * Every rule is paired with a probe case that feeds its detector a
 * violating input. A real-data assertion over inputs that are all clean
 * cannot fail, and a detector that quietly stopped parsing would
 * otherwise read as coverage while checking nothing.
 * ===================================================================== */

const UI_ROOT = resolve(UI_SRC, '..');

/** Boot documents that paint before any chunk or stylesheet has loaded. */
const HTML_ENTRIES: string[] = [
  join(UI_ROOT, 'index.html'),
  join(UI_ROOT, 'index.tablet.html'),
];

const ABSOLUTE_URL_RE = /https?:\/\//i;
/** url(//host/...) is remote too -- it inherits the page's own scheme. */
function isProtocolRelativeUrl(line: string): boolean {
  const i = line.toLowerCase().indexOf('url(');
  if (i < 0) return false;
  return line.slice(i + 4).replace(/^[\s'\"]+/, '').startsWith('//');
}

/**
 * What makes an absolute URL a font reference rather than some other
 * asset: a font CDN origin, a font package on a general CDN, a family=
 * font query, or a font file extension. Deliberately broader than the one
 * link being deleted, so a different CDN cannot re-open the same hole.
 */
const FONT_REF_RES: RegExp[] = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /(?:cdn\.jsdelivr\.net|unpkg\.com)\/[^)'"]*font/i,
  /[?&]family=/i,
  /\.(?:woff2?|ttf|otf|eot)(?![a-z0-9])/i,
];

interface FontRefHit {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Blank out comments while keeping every line in place, so a URL that only
 * appears in prose can never fail the gate -- and the reported line numbers
 * still point at the real file.
 */
function blankComments(text: string): string {
  const keepLines = (m: string): string => m.replace(/[^\n]/g, '');
  return text
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/\/\*[\s\S]*?\*\//g, keepLines)
    .replace(/^[ \t]*\/\/.*$/gm, keepLines);
}

function shortFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^.*?\/ui\//, 'ui/');
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function findRemoteFontRefs(file: string, text: string): FontRefHit[] {
  const lines = blankComments(text).split(/\r?\n/);
  const hits: FontRefHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!ABSOLUTE_URL_RE.test(line) && !isProtocolRelativeUrl(line)) continue;
    if (!FONT_REF_RES.some((re) => re.test(line))) continue;
    hits.push({ file: shortFile(file), line: i + 1, snippet: line.trim().slice(0, 120) });
  }
  return hits;
}

/** CSS custom properties holding a font-family stack, not a weight or size. */
interface FontStack {
  name: string;
  value: string;
  file: string;
  line: number;
}

const FONT_TOKEN_DECL_RE = /(^|[\s;{])(--[a-zA-Z0-9_-]*(?:font|family)[a-zA-Z0-9_-]*)\s*:\s*([^;]*);/gi;

function fontStacksFromCss(file: string, text: string): FontStack[] {
  const stripped = blankComments(text);
  const out: FontStack[] = [];
  FONT_TOKEN_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null = FONT_TOKEN_DECL_RE.exec(stripped);
  while (m) {
    const name = m[2] ?? '';
    const value = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    const scalar = /^[-+]?[\d.\s]+$/.test(value)
      || /^[-+]?\d*\.?\d+(?:px|rem|em|%|pt|pc|in|cm|mm|ex|ch|vh|vw|vmin|vmax|ms|s)$/i.test(value)
      || /^(?:normal|bold|bolder|lighter|italic|oblique|inherit|initial|unset|auto|none)$/i.test(value);
    if (value && !scalar) {
      const lead = m[1] ?? '';
      out.push({ name, value, file: shortFile(file), line: lineOf(stripped, m.index + lead.length) });
    }
    m = FONT_TOKEN_DECL_RE.exec(stripped);
  }
  return out;
}

/** CSS Fonts 4 generic families -- the last name in a stack must be one. */
const GENERIC_FONT_KEYWORDS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji',
]);

function genericTail(value: string): string {
  const parts = value.split(',');
  const last = (parts[parts.length - 1] ?? '').trim().replace(/^['"]|['"]$/g, '');
  return last.toLowerCase();
}

function stacksWithoutGenericTail(stacks: FontStack[]): FontStack[] {
  return stacks.filter((s) => !GENERIC_FONT_KEYWORDS.has(genericTail(s.value)));
}

const FONT_FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;

/**
 * data: is allowed: it is self-contained and both shells already permit
 * font-src 'self' data:. Anything naming a host does not pass.
 */
function absoluteFontFaceUrls(file: string, text: string): FontRefHit[] {
  const stripped = blankComments(text);
  const hits: FontRefHit[] = [];
  FONT_FACE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null = FONT_FACE_BLOCK_RE.exec(stripped);
  while (m) {
    const body = m[1] ?? '';
    const baseLine = lineOf(stripped, m.index);
    const bodyLines = body.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i] ?? '';
      if (!/url\(/i.test(line)) continue;
      if (!ABSOLUTE_URL_RE.test(line) && !isProtocolRelativeUrl(line)) continue;
      hits.push({ file: shortFile(file), line: baseLine + i, snippet: line.trim().slice(0, 120) });
    }
    m = FONT_FACE_BLOCK_RE.exec(stripped);
  }
  return hits;
}

function collectCssFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const HTML_SOURCES = HTML_ENTRIES
  .filter((f) => existsSync(f))
  .map((f) => ({ file: f, text: readFileSync(f, 'utf-8') }));

const CSS_SOURCES = collectCssFiles(UI_SRC).map((f) => ({ file: f, text: readFileSync(f, 'utf-8') }));

function describeHits(hits: FontRefHit[]): string {
  return hits.map((h) => '  ' + h.file + ':' + h.line + '  ' + h.snippet).join('\n');
}

/* Rule 4 -- value SHAPE for any custom property whose NAME says font.
 *
 * Rule 2 asks a stack to END in a generic keyword; it cannot see a value that
 * is malformed as a whole. A family stack is a comma-separated LIST, so each
 * name is quoted only when it needs it. Wrap the list in one pair of quotes
 * and CSS sees a single family named "Inter, sans-serif" -- which no engine
 * has -- so the declaration resolves to the browser default font and even the
 * sans-serif entry is gone. That is exactly what scripts/sync-branding.ps1
 * emitted for every whitelabel tenant until this change, and the name pattern
 * had to widen from --font-* to catch it: --brand-font-family never matched
 * --font-[a-z0-9-]+ because the property name does not start with it.
 *
 * Quoting is NOT banned by this rule: 'Inter', system-ui and
 * "DM Sans", "Inter", sans-serif are both valid lists and both pass. Only
 * a value that is ONE quoted string holding a comma fails, plus any property
 * that pulls such a value in through var() -- the indirect route is the one
 * that finally reaches a browser.
 */

const FAMILYISH_NAME_RE = /(?:font|family)/i;

const ANY_CUSTOM_DECL_RE = /(^|[\s;{])(--[a-zA-Z0-9_-]+)\s*:\s*([^;]*);/g;

interface CustomPropDef {
  name: string;
  value: string;
  file: string;
  line: number;
}

function customPropsFromCss(file: string, text: string): CustomPropDef[] {
  const stripped = blankComments(text);
  const out: CustomPropDef[] = [];
  ANY_CUSTOM_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ANY_CUSTOM_DECL_RE.exec(stripped);
  while (m) {
    const lead = m[1] ?? '';
    const value = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    if (value) {
      out.push({ name: m[2] ?? '', value, file: shortFile(file), line: lineOf(stripped, m.index + lead.length) });
    }
    m = ANY_CUSTOM_DECL_RE.exec(stripped);
  }
  return out;
}

/** True when the whole value is one quoted string whose inside contains a comma. */
function isWrappedCommaList(value: string): boolean {
  const v = value.trim();
  const q = v[0];
  if (q !== "'" && q !== '"') return false;
  const close = v.indexOf(q, 1);
  if (close < 0) return false;
  // Anything after the closing quote means it is a list, not one string.
  if (v.slice(close + 1).trim().length > 0) return false;
  return v.slice(1, close).includes(',');
}

interface FamilyShapeViolation extends CustomPropDef {
  kind: 'wrapped list' | 'var() chain';
  origin: string;
}

function wrappedFamilyLists(defs: CustomPropDef[]): FamilyShapeViolation[] {
  const direct = defs.filter(
    (d) => FAMILYISH_NAME_RE.test(d.name) && isWrappedCommaList(d.value),
  );
  const out: FamilyShapeViolation[] = direct.map((d) => ({ ...d, kind: 'wrapped list' as const, origin: d.name }));
  const badNames = new Set(direct.map((d) => d.name));
  const seen = new Set<string>();
  for (const d of defs) {
    const re = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
    let m: RegExpExecArray | null = re.exec(d.value);
    while (m) {
      const ref = m[1] ?? '';
      m = re.exec(d.value);
      if (!badNames.has(ref)) continue;
      const key = d.file + ':' + d.line + ':' + d.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...d, kind: 'var() chain' as const, origin: ref });
    }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

function describeFamilyViolations(bad: FamilyShapeViolation[]): string {
  return bad.map((b) => '  ' + b.file + ':' + b.line + '  ' + b.name + ': ' + b.value
    + '   [' + b.kind + ' -> ' + b.origin + ']').join('\n');
}

function describeStacks(stacks: FontStack[]): string {
  return stacks.map((s) => '  ' + s.file + ':' + s.line + '  ' + s.name + ': ' + s.value).join('\n');
}

describe('font-reference portability', () => {
  it('scanned the boot documents and the ui/src CSS tree', () => {
    expect(HTML_SOURCES.length).toBeGreaterThanOrEqual(1);
    expect(CSS_SOURCES.length).toBeGreaterThanOrEqual(10);
  });

  it('rule 1: no remote font reference in a boot HTML document', () => {
    const hits = HTML_SOURCES.flatMap(({ file, text }) => findRemoteFontRefs(file, text));
    expect(
      hits.length,
      'Remote font references found. The packaged app blocks them (CSP '
        + "font-src 'self' data: in both tauri.conf.json files), so they never "
        + 'load for a customer -- they only make bare-browser dev and the '
        + 'shipped build render different typefaces. Ship a same-origin face or '
        + 'drop the reference; do not widen the CSP.\n'
        + describeHits(hits),
    ).toBe(0);
  });

  it('rule 1 probe: rejects a CDN link, its preconnect and a remote url()', () => {
    const probe = [
      '  <!-- example only: https://fonts.googleapis.com/css2?family=Inter -->',
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
      '  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      '  <link',
      '    href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"',
      '    rel="stylesheet"',
      '  />',
      '  <link rel="manifest" href="https://example.com/site.webmanifest" />',
      '  <style>@import url("https://cdn.example.com/fonts/inter-latin.woff2");</style>',
    ].join('\n');
    const hits = findRemoteFontRefs('probe.html', probe);
    // Line 1 is prose inside a comment, line 3 a relative icon, line 8 an
    // absolute URL that is not a font -- none of those may be reported.
    expect(hits.map((h) => h.line)).toEqual([2, 5, 9]);
  });

  it('rule 2: every --font-* family token ends in a generic font keyword', () => {
    const stacks = CSS_SOURCES.flatMap(({ file, text }) => fontStacksFromCss(file, text));
    const bad = stacksWithoutGenericTail(stacks);
    // The floor is load-bearing: without it, a moved token file or a regex
    // that stopped matching would pass by finding nothing.
    expect(stacks.length).toBeGreaterThanOrEqual(2);
    expect(
      bad.length,
      'Font family token(s) with no generic keyword last -- such a stack '
        + 'resolves to the browser default face (serif on every engine) as soon '
        + 'as the named faces are unavailable:\n'
        + describeStacks(bad),
    ).toBe(0);
  });

  it('rule 2 probe: numeric tokens are skipped, a missing tail is caught', () => {
    const probe = [
      ':root {',
      "  --font-sans: 'Inter', system-ui, sans-serif;",
      "  --font-mono: 'JetBrains Mono', ui-monospace, monospace;",
      '  --font-weight-normal: 400;',
      '  --font-line-height: 1.5;',
      "  --font-serif: 'Georgia', 'Times New Roman';",
      '}',
    ].join('\n');
    const stacks = fontStacksFromCss('probe.css', probe);
    expect(stacks.map((s) => s.name)).toEqual(['--font-sans', '--font-mono', '--font-serif']);
    const bad = stacksWithoutGenericTail(stacks);
    expect(bad.map((s) => s.name + ':' + s.line)).toEqual(['--font-serif:6']);
  });

  it('rule 3: every @font-face src url() is same-origin (relative or data:)', () => {
    const hits = [...CSS_SOURCES, ...HTML_SOURCES]
      .flatMap(({ file, text }) => absoluteFontFaceUrls(file, text));
    // Insurance, not the finding: 0 @font-face rules exist in ui/src today --
    // the probe below is what makes this rule real coverage.
    expect(
      hits.length,
      '@font-face src references a host instead of a bundled same-origin file:\n'
        + describeHits(hits),
    ).toBe(0);
  });

  it('rule 3 probe: relative and data: pass, remote and protocol-relative fail', () => {
    const probe = [
      '@font-face {',
      "  font-family: 'Inter var';",
      '  src: url("/fonts/inter-latin.woff2") format("woff2");',
      '  src: url(data:font/woff2;base64,d09GMgABAAAA) format("woff2");',
      "  src: url('https://fonts.gstatic.com/s/inter-latin.woff2') format('woff2');",
      '}',
      '@font-face { font-family: X; src: url(//cdn.example.com/x.woff2) format("woff2"); }',
    ].join('\n');
    const hits = absoluteFontFaceUrls('probe.css', probe);
    expect(hits.map((h) => h.line)).toEqual([5, 7]);
  });
  it('rule 4: no font-named property is one quoted comma-list, nor chained by var()', () => {
    const defs = CSS_SOURCES.flatMap(({ file, text }) => customPropsFromCss(file, text));
    const bad = wrappedFamilyLists(defs);
    // Floor, same reason as rule 2: a parse that found nothing must not read
    // as compliance.
    expect(defs.length).toBeGreaterThanOrEqual(10);
    expect(
      bad.length,
      'A font-family value is wrapped in a single pair of quotes, so CSS reads '
        + 'it as ONE family name that does not exist and the declaration falls '
        + 'back to the browser default font. Quote each family separately, or '
        + 'not at all:\n'
        + describeFamilyViolations(bad),
    ).toBe(0);
  });

  it('rule 4 probe: wrapped list and its var() chain fail; real stacks pass', () => {
    const probe = [
      ':root {',
      "  --brand-font-family: 'Inter, sans-serif';",
      '  --brand-font-family-alt: "DM Sans", "Inter", sans-serif;',
      "  --font-mixed: 'Inter', system-ui;",
      "  --brand-company: 'OZ POS Inc.';",
      '  --kds-font-md: 15px;',
      '  --font-weight-normal: 400;',
      '}',
      '.splash { --fallback-stack: var(--brand-font-family); }',
      '.real { --good-stack: var(--brand-font-family-alt); }',
    ].join('\n');
    const defs = customPropsFromCss('probe.css', probe);
    expect(defs.length).toBe(8);
    const bad = wrappedFamilyLists(defs);
    expect(bad.map((b) => b.name + ':' + b.line + ':' + b.kind)).toEqual([
      '--brand-font-family:2:wrapped list',
      '--fallback-stack:9:var() chain',
    ]);
  });
});

/* ── var() token existence (added 2026-09-15) ──────────────────────
 *
 * Everything above asks whether a value SHOULD have been a var(). Nothing
 * asked whether the var() it already wrote names a token that exists. A
 * reference to an undefined custom property is not a parse error: CSS makes
 * the whole declaration invalid-at-computed-value-time, so color:
 * var(--text-primary) paints the INHERITED colour and box-shadow:
 * var(--shadow-foo) paints nothing, silently, in every theme. No existing
 * gate sees it: eslint matches no config for .css and exits 0, the pre-commit
 * hook never names a .css path, themeTokenCompliance forbids literal VALUES
 * and never resolves a name, and composedRuleIdenticalPair skips anything that
 * is not a bare hex. This is the existence grade those shapes all leave open.
 *
 * A token counts as DEFINED when it is declared in tokens.css (in ANY block)
 * or in any sheet under features/, or when production code establishes it at
 * runtime through a style object key or el.style.setProperty. The third lane
 * is not a loophole: 12 of the tokens features reference are values React
 * computes per element (--card-size, --thumb-hue, --preview-colour-*), and a
 * gate that called those missing would be wrong on its first run. Test files
 * are EXCLUDED from that lane on purpose -- a value only a test sets does not
 * exist for a cashier, which is what turned --mouse-x/--mouse-y up here.
 *
 * The :root question was measured before this rule was written, and it is the
 * reason ANY block is safe rather than generous: of the 363 distinct tokens
 * features/ references, 66 are redefined in all three blocks, 137 only in
 * :root, and ZERO are defined anywhere without also being in :root. So every
 * reference resolves under the default theme today and this case asserts
 * existence, not per-block parity -- it takes no position on the parked
 * question of whether :root should equal dark.
 *
 * LANDS WITH A BASELINE. 29 token names across 84 sites were already
 * unresolved at HEAD before this case existed, so the honest form is
 * shrink-only naming, exactly like BASELINE_UNCITED in
 * screenExtraction.test.ts. Both directions fail: a name outside the list is
 * new debt, and a listed name that no longer resolves to a miss is stale.
 *
 * 63 of the 84 sites carry a comma fallback and so render a literal; the 21
 * that do not (the eight NO-FALLBACK names below) render nothing at all.
 */

const TOKENS_CSS = join(UI_SRC, "frontend", "themes", "tokens.css");

/** A custom-property DECLARATION at its own boundary -- not a var() read. */
const CUSTOM_PROP_DEF_RE = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
const VAR_REF_RE = /var\(\s*(--[A-Za-z0-9_-]+)([^)]*)\)/g;
const SET_PROPERTY_RE = /setProperty\(\s*["'`](--[A-Za-z0-9_-]+)/g;
const STYLE_KEY_RE = /["'`](--[A-Za-z0-9_-]+)["'`]\s*:/g;

/** The token universe gains a name from a nested read exactly as from an outer one. */
interface VarRef {
  file: string;
  line: number;
  token: string;
  /** True when the reference reads `var(--x, <literal>)` -- the costume. */
  hasFallback: boolean;
  /**
   * True when this name was reached INSIDE another reference's fallback: the
   * `--b` of `var(--a, var(--b, #fff))`. VAR_REF_RE stops its tail capture at the
   * first `)`, so before this flag existed those names were recorded nowhere --
   * they passed the existence gate, missed the foreign-scheme freeze and never
   * reached the block-relation case, while the printed denominator counted the
   * outer reference and looked healthy. Measured at the commit that adds this:
   * 85 nested reads carrying 25 distinct names.
   */
  nested?: boolean;
}

/** Same shape as VAR_REF_RE, applied to a captured tail rather than to a sheet. */
const NESTED_VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)([^)]*)/g;

/**
 * Every var() name a sheet reads, outer and nested.
 *
 * Invariant this function must keep: the OUTER refs are exactly what they were --
 * same count, same `hasFallback` classification, same order -- because the
 * tail-classifying cases (the foreign freeze, the block-relation worklist) are
 * built on them. A nested name is emitted WITH `nested: true` so a caller can
 * choose: existence and the freeze take both, tail classification takes the
 * outers only. `line` points at the inner read when the tail is on the same
 * line, which is where a fallback always lives today.
 */
function varRefsFromCss(file: string, text: string): VarRef[] {
  const blanked = blankComments(text);
  const hits: VarRef[] = [];
  const short = shortFile(file);
  for (const m of blanked.matchAll(VAR_REF_RE)) {
    const outerLine = lineOf(blanked, m.index ?? 0);
    const tail = m[2] ?? '';
    hits.push({
      file: short,
      line: outerLine,
      token: m[1] as string,
      hasFallback: /^\s*,/.test(tail),
    });
    // Walk the fallback: a nested var() is a reference, not decoration.
    let frontier: Array<{ tail: string; at: number }> = tail ? [{ tail, at: (m.index ?? 0) + m[0].indexOf(tail) }] : [];
    for (let depth = 0; depth < 8 && frontier.length; depth++) {
      const next: Array<{ tail: string; at: number }> = [];
      for (const node of frontier) {
        NESTED_VAR_RE.lastIndex = 0;
        for (const inner of node.tail.matchAll(NESTED_VAR_RE)) {
          const itail = inner[2] ?? '';
          hits.push({
            file: short,
            line: lineOf(blanked, node.at + (inner.index ?? 0)),
            token: inner[1] as string,
            hasFallback: /^\s*,/.test(itail),
            nested: true,
          });
          if (itail) next.push({ tail: itail, at: node.at + (inner.index ?? 0) + itail.length * 0 + 1 });
        }
      }
      frontier = next;
    }
  }
  return hits;
}

function customPropNamesIn(text: string): string[] {
  const blanked = blankComments(text);
  return [...blanked.matchAll(CUSTOM_PROP_DEF_RE)].map((m) => m[1] as string);
}

/** .ts/.tsx under dir -- production code only: no __tests__, no *.test.*, no spec. */
function collectScriptFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectScriptFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      if (/\.(test|spec)\.[tj]sx$/i.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function jsProvidedTokens(dir: string): Set<string> {
  const found = new Set<string>();
  for (const f of collectScriptFiles(dir)) {
    const text = readFileSync(f, "utf-8");
    for (const re of [SET_PROPERTY_RE, STYLE_KEY_RE]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) found.add(m[1] as string);
    }
  }
  return found;
}

const FEATURE_CSS_SOURCES = collectCssFiles(join(UI_SRC, "features"))
  .map((f) => ({ file: f, text: readFileSync(f, "utf-8") }));

const TOKEN_DEFINED: Set<string> = (() => {
  const defined = new Set<string>();
  if (existsSync(TOKENS_CSS)) {
    for (const n of customPropNamesIn(readFileSync(TOKENS_CSS, "utf-8"))) defined.add(n);
  }
  for (const s of FEATURE_CSS_SOURCES) {
    for (const n of customPropNamesIn(s.text)) defined.add(n);
  }
  for (const n of jsProvidedTokens(UI_SRC)) defined.add(n);
  return defined;
})();

const FEATURE_REF_HARVEST: VarRef[] = FEATURE_CSS_SOURCES.flatMap((s) => varRefsFromCss(s.file, s.text));
/** Outer refs only -- the population every existing assertion was calibrated on. */
const VAR_REFS: VarRef[] = FEATURE_REF_HARVEST.filter((r) => !r.nested);
/** Names reached only inside another token's fallback -- harvested, and existence-checked. */
const NESTED_REFS: VarRef[] = FEATURE_REF_HARVEST.filter((r) => r.nested === true);

function unresolvedByToken(refs: VarRef[], defined: Set<string>): Map<string, VarRef[]> {
  const out = new Map<string, VarRef[]>();
  for (const r of refs) {
    if (defined.has(r.token)) continue;
    const bucket = out.get(r.token);
    if (bucket) bucket.push(r);
    else out.set(r.token, [r]);
  }
  return out;
}

function describeUnresolved(misses: Map<string, VarRef[]>): string {
  return [...misses.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tok, sites]) => {
      const shown = sites.slice(0, 3).map((s) => s.file + ":" + s.line).join(", ");
      return "  " + tok + "  (" + sites.length + (sites.length > 1 ? " sites" : " site") + ") -> "
        + shown + (sites.length > 3 ? " ..." : "");
    })
    .join("\n");
}

/**
 * Shrink-only, and keyed by NAME rather than file:line on purpose: five lanes
 * are editing these sheets tonight, and a line-number baseline would rot
 * within the hour (RetailPosScreen.css moved 25 lines during the census alone)
 * while a token name stays a name. Delete a line when a sheet is fixed; never
 * add one.
 */
const UNRESOLVED_VAR_TOKENS_BASELINE: string[] = [
  "--accent-color", // 3 - settings/screens/*Card.css use a foreign naming scheme
  "--accent-contrast", // 3 - the same three cards
  "--animation-play", // 1 - warehouse/WarehouseConsole.css
  "--bg-primary", // 3
  "--bg-secondary", // 1
  "--border-color", // 8
  "--border-subtle", // 2 - settings/sections/DiagnosticsSection.css
  "--color-surface-alt", // 1 - staff/RoleAuthoringScreen.css
  "--color-warning-pos-darker", // 1 - retail/RetailPosScreen.css
  "--danger-500", // 4 NO FALLBACK - a colour that renders nothing
  "--danger-700", // 1 NO FALLBACK
  "--danger-text", // 1 - settings/screens/StatutoryNumberingCard.css
  "--info-500", // 1 NO FALLBACK
  "--mouse-x", // 2 - only a TEST sets these, so nothing exists at runtime
  "--mouse-y", // 2
  "--rotate-x", // 1 - workspaces/WorkspaceHome.css
  "--rotate-y", // 1
  "--status-danger", // 3
  "--status-success", // 3
  "--success-500", // 2 NO FALLBACK
  "--success-bg", // 1
  "--text-muted", // 1
  "--text-primary", // 10
  "--text-secondary", // 8
  "--text-tertiary", // 7
];

describe("var() token existence", () => {
  it(`reads a real population (never a vacuous green): ${VAR_REFS.length} outer refs + ${NESTED_REFS.length} nested reads carrying ${new Set(NESTED_REFS.map((r) => r.token)).size} inner names`, () => {
    // Four floors, each one a way this case could pass while checking
    // nothing. Same discipline as the per-file floor 6efb2ec42 added to
    // composedRuleIdenticalPair: a parser that matched nothing must not
    // read as compliance.
    expect(FEATURE_CSS_SOURCES.length, "no feature sheets were collected").toBeGreaterThanOrEqual(100);
    expect(existsSync(TOKENS_CSS), "tokens.css missing -- every var() would read as undefined").toBe(true);
    expect(TOKEN_DEFINED.size, "definition set is empty -- the def regex matched nothing").toBeGreaterThanOrEqual(300);
    expect(VAR_REFS.length, "not one var() reference was parsed").toBeGreaterThanOrEqual(10000);
    expect(new Set(VAR_REFS.map((r) => r.token)).size).toBeGreaterThanOrEqual(300);
    // The nested population is asserted, not assumed: a harvest that stopped seeing
    // inside fallbacks would drop these to 0 and leave the outer count looking fine.
    expect(NESTED_REFS.length, "no nested var() read was harvested -- the fallback walk is dead").toBeGreaterThanOrEqual(60);
    expect(new Set(NESTED_REFS.map((r) => r.token)).size, "nested names vanished").toBeGreaterThanOrEqual(15);
    expect(NESTED_ALL_REFS.length, "nested reads over all of ui/src").toBeGreaterThanOrEqual(NESTED_REFS.length);
  });

  it("every sheet that mentions var() contributes at least one parsed reference", () => {
    const silent = FEATURE_CSS_SOURCES
      .filter((s) => /var\(/.test(s.text) && varRefsFromCss(s.file, s.text).length === 0)
      .map((s) => shortFile(s.file));
    expect(silent, "sheets hold a literal var() the parser did not record:\n  " + silent.join("\n  ")).toEqual([]);
  });

  it("no feature sheet references a token that is defined nowhere, beyond a named baseline", () => {
    const misses = unresolvedByToken([...VAR_REFS, ...NESTED_REFS], TOKEN_DEFINED);
    const names = [...misses.keys()];
    const unexpected = names.filter((n) => !UNRESOLVED_VAR_TOKENS_BASELINE.includes(n));
    const stale = UNRESOLVED_VAR_TOKENS_BASELINE.filter((n) => !misses.has(n));
    const subset = new Map(unexpected.map((n) => [n, misses.get(n) ?? []]));
    expect(
      unexpected,
      "These var() references name a token no CSS file or runtime setter defines. A site "
        +
        "that carries no comma fallback renders NOTHING in every theme; one that does "
        +
        "silently renders its fallback literal instead of a token:\n"
        + describeUnresolved(subset),
    ).toEqual([]);
    expect(
      stale,
      "These baseline names no longer resolve to a miss. The debt was paid: "
        +
        "delete their lines -- the list is shrink-only in both directions.",
    ).toEqual([]);
    expect(misses.size, "the miss set moved off its own baseline").toBe(UNRESOLVED_VAR_TOKENS_BASELINE.length);
  });

  it("probe: a renamed token is caught; a runtime-set token is not", () => {
    const sheets = [
      { file: "a.css", text: ":root { --ok: 4px; } .x { padding: var(--ok); margin: var(--ok-typo); }" },
      { file: "b.css", text: ".y { color: var(--js-set); box-shadow: 0 0 0 1px var(--nope, #fff); }" },
    ];
    const refs = sheets.flatMap((s) => varRefsFromCss(s.file, s.text));
    // The parser ran. Without this line a dead VAR_REF_RE makes the probe
    // green, which is the exact failure 6efb2ec42 was written against.
    expect(refs.length).toBe(4);
    const defined = new Set([...sheets.flatMap((s) => customPropNamesIn(s.text)), "--js-set"]);
    const misses = unresolvedByToken(refs, defined);
    expect([...misses.keys()]).toEqual(["--ok-typo", "--nope"]);
    expect(misses.get("--ok-typo")?.map((m) => m.file + ":" + m.line)).toEqual(["a.css:1"]);
    expect(describeUnresolved(misses)).toContain("(1 site) -> a.css:1");
  });
});

/* ── Foreign-scheme freeze (added 2026-09-15) ───────────────────────
 *
 * The existence case above refuses a name nothing defines. This one names
 * the shape that refusal describes when it is written on purpose: a
 * reference to a token declared NOWHERE in ui/src that carries a literal
 * fallback, so `color: var(--text-primary, #1f2937)` resolves -- through the
 * literal, not the token. That is a second palette living inside fallbacks,
 * invisible to the token ladder, unwritten in tokens.css, and free to spread
 * one line at a time. Renaming any of it is parked with the ink cluster
 * (measured: not one of these names has a candidate token that matches in all
 * three blocks -- the two closest match in light only, so a rename would turn
 * a white card into #1c1f27 under the shipped dark default). This case does
 * not migrate and does not judge the colour: it freezes the population.
 *
 * The predicate, not the vocabulary, is the rule: a FIFTEENTH foreign name --
 * or a sixteenth site of a known one -- is a new (name @ file, count) pair and
 * fails. Scope is every .css under ui/src, not just features/, because 24 of
 * the 88 sites sit in ui/src/components/*.css, which the existence case above
 * never reads. Both directions are enforced, like UNRESOLVED_VAR_TOKENS_BASELINE
 * and for the same reason: a list nobody prunes is how a freeze becomes a mute.
 */

const ALL_CSS_SOURCES = collectCssFiles(UI_SRC).map((f) => ({ file: f, text: readFileSync(f, "utf-8") }));

/** Every custom property declared by ANY stylesheet under ui/src, plus the runtime lane. */
const ALL_DECLARED: Set<string> = (() => {
  const d = new Set<string>();
  for (const s of ALL_CSS_SOURCES) for (const n of customPropNamesIn(s.text)) d.add(n);
  for (const n of jsProvidedTokens(UI_SRC)) d.add(n);
  return d;
})();

const ALL_REF_HARVEST: VarRef[] = ALL_CSS_SOURCES.flatMap((s) => varRefsFromCss(s.file, s.text));
const ALL_VAR_REFS: VarRef[] = ALL_REF_HARVEST.filter((r) => !r.nested);
const NESTED_ALL_REFS: VarRef[] = ALL_REF_HARVEST.filter((r) => r.nested === true);

/**: (name @ sheet) -> site count, for the frozen foreign-scheme population. * */
function foreignSchemePairs(refs: VarRef[], declared: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of refs) {
    if (declared.has(r.token) || !r.hasFallback) continue;
    const key = r.token + " @ " + r.file;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Grandfathered instances, measured at HEAD 35011a227. Shrink-only in both
 * directions. The 15 names the settings audit enumerated are the palette fork
 * proper; the rest (--surface, --accent, --border, --muted, --danger,
 * --accent-subtle, --surface-input, --accent-bg, --color-text-on-danger,
 * --mouse-x/-y, --rotate-x/-y, --animation-play, --color-warning-pos-darker,
 * --color-surface-alt) share the signature and are frozen with them, because a
 * freeze that only covered the named 15 would leave the pattern unpoliced.
 */
const FOREIGN_SCHEME_BASELINE: Array<[string, string, number]> = [
  ["--accent", "ui/src/components/ExitSurveyModal.css", 2],
  ["--accent", "ui/src/components/OrgSwitcher.css", 2],
  ["--accent-bg", "ui/src/components/ExitSurveyModal.css", 1],
  ["--accent-color", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--accent-color", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 1],
  ["--accent-color", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--accent-contrast", "ui/src/components/OrgSwitcher.css", 1],
  ["--accent-contrast", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--accent-contrast", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 1],
  ["--accent-contrast", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--accent-subtle", "ui/src/components/OrgSelector.css", 1],
  ["--accent-subtle", "ui/src/components/OrgSwitcher.css", 1],
  ["--animation-play", "ui/src/features/warehouse/WarehouseConsole.css", 1],
  ["--bg-primary", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--bg-primary", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 1],
  ["--bg-primary", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--bg-secondary", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--border", "ui/src/components/ExitSurveyModal.css", 2],
  ["--border-color", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 4],
  ["--border-color", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 2],
  ["--border-color", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--border-color", "ui/src/features/settings/screens/StatutoryNumberingCard.css", 1],
  ["--border-subtle", "ui/src/components/OrgSelector.css", 2],
  ["--border-subtle", "ui/src/components/OrgSwitcher.css", 5],
  ["--border-subtle", "ui/src/features/settings/sections/DiagnosticsSection.css", 2],
  ["--color-surface-alt", "ui/src/features/staff/RoleAuthoringScreen.css", 1],
  ["--color-text-on-danger", "ui/src/components/StockAlertBell.css", 1],
  ["--color-warning-pos-darker", "ui/src/features/retail/RetailPosScreen.css", 1],
  ["--danger", "ui/src/components/OrgSwitcher.css", 1],
  ["--danger-text", "ui/src/features/settings/screens/StatutoryNumberingCard.css", 1],
  ["--mouse-x", "ui/src/features/locations/NodeTopologyEditor.css", 1],
  ["--mouse-x", "ui/src/features/workspaces/WorkspaceHome.css", 1],
  ["--mouse-y", "ui/src/features/locations/NodeTopologyEditor.css", 1],
  ["--mouse-y", "ui/src/features/workspaces/WorkspaceHome.css", 1],
  ["--muted", "ui/src/components/ExitSurveyModal.css", 1],
  ["--rotate-x", "ui/src/features/workspaces/WorkspaceHome.css", 1],
  ["--rotate-y", "ui/src/features/workspaces/WorkspaceHome.css", 1],
  ["--status-danger", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--status-danger", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 1],
  ["--status-danger", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--status-success", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 1],
  ["--status-success", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 1],
  ["--status-success", "ui/src/features/settings/screens/RegionalSettingsCard.css", 1],
  ["--success-bg", "ui/src/features/settings/sections/DiagnosticsSection.css", 1],
  ["--surface", "ui/src/components/ExitSurveyModal.css", 1],
  ["--surface", "ui/src/components/OrgSelector.css", 1],
  ["--surface", "ui/src/components/OrgSwitcher.css", 2],
  ["--surface-input", "ui/src/components/OrgSwitcher.css", 1],
  ["--text-muted", "ui/src/features/settings/sections/DiagnosticsSection.css", 1],
  ["--text-primary", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 3],
  ["--text-primary", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 4],
  ["--text-primary", "ui/src/features/settings/screens/RegionalSettingsCard.css", 2],
  ["--text-primary", "ui/src/features/settings/screens/StatutoryNumberingCard.css", 1],
  ["--text-secondary", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 2],
  ["--text-secondary", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 2],
  ["--text-secondary", "ui/src/features/settings/screens/RegionalSettingsCard.css", 2],
  ["--text-secondary", "ui/src/features/settings/screens/StatutoryNumberingCard.css", 2],
  ["--text-tertiary", "ui/src/features/settings/screens/LocalPaymentSettingsCard.css", 2],
  ["--text-tertiary", "ui/src/features/settings/screens/ReceiptFormatSettingsCard.css", 2],
  ["--text-tertiary", "ui/src/features/settings/screens/RegionalSettingsCard.css", 2],
  ["--text-tertiary", "ui/src/features/settings/screens/StatutoryNumberingCard.css", 1],
];

describe("foreign-scheme token freeze", () => {
  const harvested = foreignSchemePairs([...ALL_VAR_REFS, ...NESTED_ALL_REFS], ALL_DECLARED);
  const baseline = new Map(FOREIGN_SCHEME_BASELINE.map(([tok, file, n]) => [tok + " @ " + file, n]));

  it("reads a real population (never a vacuous freeze)", () => {
    // Same discipline as the existence case: a harvest that matched nothing
    // would make both directions below trivially true.
    expect(ALL_CSS_SOURCES.length, "no stylesheets were collected over ui/src").toBeGreaterThanOrEqual(130);
    expect(ALL_VAR_REFS.length, "not one var() parsed over ui/src").toBeGreaterThanOrEqual(14000);
    const silent = ALL_CSS_SOURCES
      .filter((s) => /var\(/.test(s.text) && varRefsFromCss(s.file, s.text).length === 0)
      .map((s) => shortFile(s.file));
    expect(silent, "sheets hold a literal var() the parser did not record:\n  " + silent.join("\n  ")).toEqual([]);
    expect(harvested.size, "the foreign-scheme predicate matched no pair").toBeGreaterThanOrEqual(50);
    expect([...harvested.values()].reduce((a, n) => a + n, 0)).toBeGreaterThanOrEqual(80);
  });

  it("no new foreign-scheme reference appears, and no frozen one silently vanished", () => {
    const grown = [...harvested].filter(([k, n]) => baseline.has(k) && baseline.get(k) !== n)
      .map(([k, n]) => k + " grew/shrank " + baseline.get(k) + " -> " + n);
    const spread = [...harvested.keys()].filter((k) => !baseline.has(k)).sort()
      .map((k) => k + " (" + harvested.get(k) + " site(s))");
    const stale = [...baseline.keys()].filter((k) => !harvested.has(k)).sort();
    expect(
      spread,
      "A var() now reads a token declared nowhere in ui/src through a literal "
        +
        "fallback in a sheet the freeze does not name. Declare the token in "
        +
        "tokens.css (in every theme block it must survive) and point the "
        +
        "reference at it -- do not add a line here:\n  " + spread.join("\n  "),
    ).toEqual([]);
    expect(
      grown,
      "A frozen site count moved. A freeze is an EXACT population: if a site "
        +
        "was fixed, delete or shrink its line here; if one was added elsewhere "
        +
        "in the same sheet, that is spread wearing an old name:\n  " + grown.join("\n  "),
    ).toEqual([]);
    expect(
      stale,
      "These frozen pairs no longer resolve to a reference -- the debt was paid. "
        +
        "Delete the lines; leaving them makes the freeze a mute:\n  " + stale.join("\n  "),
    ).toEqual([]);
    expect(harvested.size).toBe(FOREIGN_SCHEME_BASELINE.length);
  });
});

/* ── Block relation: when is a literal tail reachable? ─────────────────
 *
 * ef6b4d5bf deleted 126 literal tails on the hand-checked premise that each
 * name is declared in all three blocks of tokens.css, so no theme could ever
 * reach the tail. This is that premise, made machine-checkable, with two
 * clauses because the premise hides two different claims:
 *
 *  1. UNREACHABILITY (a law, no baseline): a `var(--x, <literal>)` tail can
 *     render only in a theme where --x has no value. :root is inherited by
 *     both themes, and light+dark together cover both themes, so a token
 *     declared in :root, or in both theme blocks, has a provably dead tail.
 *     A token declared in ONE theme block and not in :root has a tail that is
 *     live in the other theme -- that is the shape this case refuses, and it
 *     is exactly what no diff can show: the file that changes is not the file
 *     that decides. Measured at HEAD: 334 tailed references to a tokens.css
 *     name, of which 0 are live, so the gate lands green.
 *  2. VALUE IDENTITY (a freeze, shrink-only): three blocks agreeing on the
 *     value is a different claim from three blocks having a value, and it is
 *     NOT free -- 156 tailed sites sit on names whose declarations do not
 *     read identically across the blocks they appear in (:root duplicates
 *     dark in this theme and light differs, so most colour tokens vary by
 *     design). Those are not visual bugs, so a hard assertion here would
 *     fire 156 times on correct code and the next lane would mute it. They
 *     are frozen instead: no NEW tail may land on a value-varying token, and
 *     every site a sweep clears deletes a line -- which is also the worklist
 *     ef6b4d5bf left behind (46 such tails stood in its own 29 sheets).
 *
 * EQUALITY AS IMPLEMENTED: byte-identical declaration text after collapsing
 * runs of whitespace and trimming, first declaration of a name per block --
 * `#fff` vs `white`, or a reordered rgba(), read as differing. That is
 * deliberate: a tail is being judged against a value a reader must be able
 * to compare, and the two spellings are the drift this gate exists to see.
 *
 * ONE CAVEAT the next lane must not rediscover: three of the names this sweep
 * cleared are ALSO written at runtime by ui/src/utils/color.ts:133-135
 * (--color-accent, --color-accent-hover, --color-primary). Any per-theme
 * CONTRAST claim about those three has to be graded against color.ts, not
 * against tokens.css -- the block table below is not the whole story for them.
 */

interface ThemeBlockTables {
  root: Map<string, string>;
  light: Map<string, string>;
  dark: Map<string, string>;
}

/**
 * tokens.css split by top-level block instead of flattened into a set. This is
 * the ONLY reader that keeps block membership; customPropNamesIn stays the union
 * it always was, so TOKEN_DEFINED and ALL_DECLARED -- and therefore both
 * baselines that consume them -- read byte-identical sets after this addition.
 */
function themeBlockTables(cssText: string): ThemeBlockTables {
  const tables: ThemeBlockTables = { root: new Map(), light: new Map(), dark: new Map() };
  const src = blankComments(cssText);
  let i = 0;
  for (;;) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (end < src.length && depth > 0) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}") depth--;
      end++;
    }
    const sel = src.slice(src.lastIndexOf("}", open) + 1, open).replace(/\s+/g, "");
    const which =
      sel === ":root" ? "root" : sel.includes("light") ? "light" : sel.includes("dark") ? "dark" : null;
    if (which) {
      for (const m of src.slice(open + 1, end - 1).matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) {
        const value = (m[2] as string).replace(/\s+/g, " ").trim();
        if (!tables[which].has(m[1] as string)) tables[which].set(m[1] as string, value);
      }
    }
    i = end;
  }
  return tables;
}

const TOKEN_BLOCKS = themeBlockTables(readFileSync(TOKENS_CSS, "utf-8"));

/** Tokens.css membership + value relation for one name. */
function tailRelation(name: string): { inTokens: boolean; liveTail: boolean; agrees: boolean } {
  const inRoot = TOKEN_BLOCKS.root.has(name);
  const inLight = TOKEN_BLOCKS.light.has(name);
  const inDark = TOKEN_BLOCKS.dark.has(name);
  if (!inRoot && !inLight && !inDark) return { inTokens: false, liveTail: false, agrees: false };
  // A tail renders only where the token has no value: not :root, and not both themes.
  const liveTail = !(inRoot || (inLight && inDark));
  const values = [inRoot && TOKEN_BLOCKS.root.get(name), inLight && TOKEN_BLOCKS.light.get(name), inDark && TOKEN_BLOCKS.dark.get(name)].
    filter((v): v is string => typeof v === "string");
  const agrees = values.length === 1 ? true : values.length === 3 && new Set(values).size === 1;
  return { inTokens: true, liveTail, agrees };
}

const TAILED_TOKEN_REFS = ALL_VAR_REFS.filter((r) => r.hasFallback && tailRelation(r.token).inTokens);

/**
 * Grandfathered: tailed references to a tokens.css name whose declarations do
 * not agree byte-for-byte, keyed (name @ sheet) with its site count. Measured
 * at 42e6c8201 -- 98 pairs / 156 sites, paid down to 83 pairs / 133 sites by
 * refactor(css): pay down the frozen literal tails the block gate can still certify. Shrink-only in BOTH directions, like the
 * two baselines above it.
 */
const DISAGREEING_TAIL_BASELINE: Array<[string, string, number]> = [
  ["--color-accent", "ui/src/features/sales/CartPanelCourseBar.css", 5],
  ["--color-accent", "ui/src/frontend/themes/reset.css", 1],
  ["--color-accent-hover", "ui/src/features/restaurant/RestaurantMenu.css", 1],
  ["--color-accent-hover", "ui/src/features/sales/CartPanel.brand.css", 1],
  ["--color-accent-secondary", "ui/src/features/sales/EodReportScreen.css", 1],
  ["--color-accent-secondary", "ui/src/features/sales/widgets/widgets.css", 1],
  ["--color-accent-subtle", "ui/src/features/design/DevToolbar.css", 4],
  ["--color-accent-subtle-fg", "ui/src/features/locations/MultiStoreDashboardScreen.css", 1],
  ["--color-bg", "ui/src/frontend/themes/reset.css", 1],
  ["--color-bg-elevated", "ui/src/features/sales/PromotionsModal.css", 1],
  ["--color-bg-hover", "ui/src/components/ConnectionStatus.css", 1],
  ["--color-bg-hover", "ui/src/features/auth/SessionLockScreen.css", 1],
  ["--color-bg-hover", "ui/src/features/auth/StaffLoginScreen.css", 2],
  ["--color-bg-hover", "ui/src/features/sales/EodReportScreen.css", 2],
  ["--color-bg-hover", "ui/src/features/sales/widgets/widgets.css", 1],
  ["--color-bg-input", "ui/src/frontend/themes/reset.css", 2],
  ["--color-bg-overlay", "ui/src/features/settings/WorkspaceSettingsModal.module.css", 2],
  ["--color-bg-secondary", "ui/src/features/offline/OfflineQueueScreen.css", 2],
  ["--color-bg-secondary", "ui/src/features/settings/SettingsPage.css", 2],
  ["--color-bg-subtle", "ui/src/features/staff/StaffManagementScreen.css", 1],
  ["--color-bg-surface", "ui/src/features/design/DevToolbar.css", 1],
  ["--color-bg-surface", "ui/src/frontend/themes/reset.css", 1],
  ["--color-border", "ui/src/features/design/DevToolbar.css", 5],
  ["--color-border", "ui/src/features/offline/OfflineQueueScreen.css", 2],
  ["--color-border", "ui/src/features/settings/DataManagementScreen.css", 4],
  ["--color-border", "ui/src/features/settings/FeatureToggleScreen.css", 1],
  ["--color-border", "ui/src/features/settings/SettingsPage.css", 2],
  ["--color-border", "ui/src/frontend/themes/reset.css", 2],
  ["--color-border-hover", "ui/src/features/design/DevToolbar.css", 1],
  ["--color-border-subtle", "ui/src/features/sales/ReceiptPreview.css", 1],
  ["--color-danger", "ui/src/frontend/shared/SettingsPopup.css", 2],
  ["--color-danger", "ui/src/frontend/shell/UpdateBanner.css", 7],
  ["--color-danger", "ui/src/frontend/themes/components.css", 1],
  ["--color-danger-bg", "ui/src/components/FastPINOverlay.css", 1],
  ["--color-danger-bg", "ui/src/features/inventory/StockCountDetail.css", 1],
  ["--color-danger-bg", "ui/src/features/products/ProductManagementScreen.css", 1],
  ["--color-danger-bg", "ui/src/features/sales/CartPanelLineItem.css", 1],
  ["--color-danger-bg", "ui/src/features/settings/AppearanceSettings.css", 1],
  ["--color-danger-bg", "ui/src/features/settings/FeatureToggleScreen.css", 1],
  ["--color-danger-bg", "ui/src/features/settings/SettingsPage.css", 2],
  ["--color-danger-bg", "ui/src/frontend/shared/SettingsPopup.css", 1],
  ["--color-danger-bg", "ui/src/frontend/themes/components.css", 1],
  ["--color-danger-border", "ui/src/features/tax/TaxConfigurationScreen.css", 1],
  ["--color-danger-dim", "ui/src/features/settings/AppearanceSettings.css", 1],
  ["--color-danger-dim", "ui/src/features/settings/SettingsPage.css", 1],
  ["--color-danger-hover", "ui/src/features/sales/SalesHistoryScreen.css", 1],
  ["--color-danger-subtle", "ui/src/frontend/shell/UpdateBanner.css", 1],
  ["--color-fg", "ui/src/frontend/themes/reset.css", 5],
  ["--color-fg-inverse", "ui/src/frontend/themes/reset.css", 1],
  ["--color-fg-muted", "ui/src/features/sales/PromotionsModal.css", 4],
  ["--color-info", "ui/src/frontend/themes/components.css", 1],
  ["--color-info-bg", "ui/src/frontend/themes/components.css", 1],
  ["--color-link", "ui/src/features/sales/EodReportScreen.css", 2],
  ["--color-link", "ui/src/features/sales/VoidOrdersScreen.css", 1],
  ["--color-link", "ui/src/frontend/themes/reset.css", 1],
  ["--color-link-hover", "ui/src/frontend/themes/reset.css", 1],
  ["--color-success-bg", "ui/src/features/settings/SettingsPage.css", 1],
  ["--color-success-dim", "ui/src/features/offline/OfflineQueueScreen.css", 1],
  ["--color-success-dim", "ui/src/features/settings/SettingsPage.css", 1],
  ["--color-text", "ui/src/features/inventory/ShiftBar.css", 1],
  ["--color-warning", "ui/src/features/staff/StaffManagementScreen.css", 1],
  ["--color-warning", "ui/src/features/tax/TaxConfigurationScreen.css", 2],
  ["--color-warning", "ui/src/frontend/shell/UpdateBanner.css", 5],
  ["--color-warning", "ui/src/frontend/themes/components.css", 1],
  ["--color-warning-bg", "ui/src/features/inventory/LocationPicker.css", 1],
  ["--color-warning-bg", "ui/src/features/offline/OfflineQueueScreen.css", 1],
  ["--color-warning-bg", "ui/src/features/settings/SettingsPage.css", 2],
  ["--color-warning-bg", "ui/src/features/staff/StaffManagementScreen.css", 1],
  ["--color-warning-bg", "ui/src/features/tax/TaxConfigurationScreen.css", 1],
  ["--color-warning-bg", "ui/src/frontend/themes/components.css", 1],
  ["--color-warning-border", "ui/src/features/staff/StaffManagementScreen.css", 1],
  ["--color-warning-border", "ui/src/features/tax/TaxConfigurationScreen.css", 1],
  ["--color-warning-dim", "ui/src/features/offline/OfflineQueueScreen.css", 1],
  ["--color-warning-dim", "ui/src/features/settings/SettingsPage.css", 1],
  ["--color-warning-fg", "ui/src/features/inventory/LocationPicker.css", 1],
  ["--color-warning-subtle", "ui/src/frontend/shell/UpdateBanner.css", 1],
  ["--modal-backdrop-blur", "ui/src/components/FastPINOverlay.css", 2],
  ["--modal-backdrop-blur", "ui/src/components/QrisQrDisplay.css", 2],
  ["--modal-backdrop-blur", "ui/src/features/kds/KdsScreen.css", 2],
  ["--modal-backdrop-blur", "ui/src/features/memo/MemoBanner.css", 2],
  ["--modal-backdrop-blur", "ui/src/frontend/themes/components.css", 2],
  ["--neutral-300", "ui/src/frontend/themes/reset.css", 1],
  ["--neutral-400", "ui/src/frontend/themes/reset.css", 1],
];

describe("literal tail vs block relation", () => {
  it("reads a real population, and knows a live tail when it sees one", () => {
    expect(TOKEN_BLOCKS.root.size, "tokens.css :root parsed empty -- the block reader is broken").toBeGreaterThanOrEqual(200);
    expect(TOKEN_BLOCKS.light.size).toBeGreaterThanOrEqual(100);
    expect(TOKEN_BLOCKS.dark.size).toBeGreaterThanOrEqual(40);
    // Calibration history, all of it downward and none of it silent: 334 measured before
    // the first sweep, 241 after the 93 cleared in refactor(css): clear the :root-only
    // fallback tails that no theme can reach, 218 after the 23 paid at 2374161e9, and
    // **153** after style(ui): drop the fallbacks on tokens no theme can leave undefined
    // in two shared sheets swept 65 more (49 in components/FastPINOverlay.css across 11
    // names, 16 in frontend/themes/reset.css across 13; 218 - 65 = 153, and the assertion
    // below failing at exactly 153 was the measurement). style(ui): drop the last three
    // fallbacks whose tokens no theme can leave undefined then took it to 150 (one site each in
    // components/ImpersonationBanner.css, PermissionDenied.css and QrisQrDisplay.css), which is
    // where the floor now sits EXACTLY: 150 >= 150 passes with zero headroom, so the next
    // sweep of this class cannot land without a deliberate decision about this line -- that is
    // the tree stating the boundary, not a comment asking politely. The floor VALUE is not
    // moved by that commit; it was lowered once, at 218 -> 153, and stopped.
    // The 9 root-only sites still in the tree (features/analytics/AnalyticsScreen.css:69,
    // features/kds/KdsScreen.css:730/1728/1738, features/sales/ReceiptPreview.css:30/227,
    // features/workspaces/WorkspaceHome.css:498/1398/1401) are deliberately NOT swept: 150
    // minus any of them is a red, and a floor lowered twice in one night is a ratchet.
    // below failing at exactly 153 was the measurement). The floor is calibration, not
    // law -- it exists to prove this case has an input, so it must stay far above zero and
    // it moves down as debt is paid and never up past what the tree holds. 150 is chosen
    // with a reason rather than as headroom: it sits ABOVE the 133 sites of the frozen
    // disagreeing-tail worklist below, so a tree thin enough to fail this floor is also
    // one where that worklist has lost its input, and it sits 3 below today's 153 so the
    // next sweep has to be deliberate rather than free.
    expect(TAILED_TOKEN_REFS.length, "no tailed reference to a tokens.css name parsed").toBeGreaterThanOrEqual(150);
    // The classifier must be capable of the red it reports green for today.
    const live = TAILED_TOKEN_REFS.filter((r) => tailRelation(r.token).liveTail);
    const disagreeing = new Set(TAILED_TOKEN_REFS.filter((r) => !tailRelation(r.token).agrees).map((r) => r.token));
    expect(disagreeing.size, "no tokens.css name in this population varies by value -- the identity clause would be vacuous").toBeGreaterThanOrEqual(20);
    expect(live.length, "unexpected live tails today -- the first assertion below would be graded against them, not against zero").toBe(0);
  });

  it("no literal tail sits on a token a theme can leave undefined", () => {
    const offenders = TAILED_TOKEN_REFS.filter((r) => tailRelation(r.token).liveTail).
      map((r) => r.file + ":" + r.line + "  var(" + r.token + ", <literal>) -- declared in one theme block only");
    expect(
      offenders,
      "A fallback here is a LIVE value in the theme that does not define the "
        +
        "token, so it was never dead text and deleting it (or adding it) changes pixels. "
        +
        "Declare the token in :root, or in both [data-theme=] blocks -- do not "
        +
        "relax this list:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("no new literal tail lands on a token whose blocks disagree (frozen population)", () => {
    const harvested = new Map<string, number>();
    for (const r of TAILED_TOKEN_REFS) {
      const rel = tailRelation(r.token);
      if (rel.agrees) continue;
      const key = r.token + " @ " + r.file;
      harvested.set(key, (harvested.get(key) ?? 0) + 1);
    }
    const baseline = new Map(DISAGREEING_TAIL_BASELINE.map(([t, f, n]) => [t + " @ " + f, n]));
    const grown = [...harvested].filter(([k, n]) => baseline.has(k) && baseline.get(k) !== n).
      map(([k, n]) => k + " " + baseline.get(k) + " -> " + n);
    const spread = [...harvested.keys()].filter((k) => !baseline.has(k)).sort();
    const stale = [...baseline.keys()].filter((k) => !harvested.has(k)).sort();
    expect(spread, "New tail on a value-varying token: the literal can never render, so "
        +
        "delete it instead of listing it here:\n  " + spread.join("\n  ")).toEqual([]);
    expect(grown, "A frozen tail count moved -- a site was fixed (shrink the list) or added "
        +
        "somewhere new (that is spread with an old name):\n  " + grown.join("\n  ")).toEqual([]);
    expect(stale, "Paid-down tails still on the list; delete them so the freeze stays a worklist:\n  "
        + stale.join("\n  ")).toEqual([]);
    expect(harvested.size).toBe(DISAGREEING_TAIL_BASELINE.length);
  });
});
