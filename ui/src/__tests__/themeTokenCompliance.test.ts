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

const FONT_TOKEN_DECL_RE = /(^|[\s;{])(--font-[a-z0-9-]+)\s*:\s*([^;]*);/gi;

function fontStacksFromCss(file: string, text: string): FontStack[] {
  const stripped = blankComments(text);
  const out: FontStack[] = [];
  FONT_TOKEN_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null = FONT_TOKEN_DECL_RE.exec(stripped);
  while (m) {
    const name = m[2] ?? '';
    const value = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    const scalar = /^[-\d.\s]+$/.test(value)
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
});