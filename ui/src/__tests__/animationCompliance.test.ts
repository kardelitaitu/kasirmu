import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, normalize } from 'path';

/**
 * Scans a directory recursively for CSS files, returning absolute paths.
 */
function findCssFiles(dir: string, results: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      findCssFiles(fullPath, results);
    } else if (entry.name.endsWith('.css')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Blanks every CSS block comment before the walker looks at a sheet, and does it
 * LENGTH-PRESERVING: each comment byte becomes a space except newlines, so every
 * character offset the patterns match and every line number a violation prints
 * still addresses the same place in the real file.
 *
 * WHY. Every read below is a regex over sheet text — the declaration search, the
 * @keyframes lookup, the no-preference brace walk, and the reduce-block test that
 * grants Pattern B's file-wide amnesty. A comment is text CSS never parses, so any
 * of those four can be opened by prose. Measured in this tree before the blank:
 * features/sales/CartPanel.css:484 and :510 each matched a declaration named
 * "slides" out of a header reading "Cart entry animation: slides from right with
 * overshoot jiggle", and features/kds/KdsScreen.css:2288 matched an "animation:
 * none" that sits inside a comment describing what tokens.css does globally. Three
 * phantom declarations, two of them counted as graded and one as excused-by-value,
 * plus one phantom transition in the instrumentation total. The amnesty is the
 * hazard worth naming: a comment merely mentioning a reduced-motion block would
 * excuse every animation in its sheet, which is why hasReduceBlock reads blanked
 * text too (no sheet's amnesty is comment-only as of this commit — reduce-block
 * sheets measured 30 both ways — so nothing here is excused by prose).
 *
 * Scope is block comments only, deliberately: string literals and url() contents
 * are left alone, and no line-comment form is invented, because that is not a CSS
 * comment and eating text that CSS does parse would trade one phantom class for
 * another.
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

/**
 * Keyframe names that are UX-essential (loading indicators, feedback,
 * status pulses). These may play even with reduced-motion preference.
 */
const ESSENTIAL_KEYFRAMES = new Set([
  // Spinners
  'btn-spin', 'spinner-rotate', 'login-spin', 'staff-login-spin',
  'fastpin-spin', 'qris-spin', 'kds-enrollment-spin',
  // Skeleton / shimmer
  'skeleton-pulse', 'ws-shimmer', 'machine-id-shimmer',
  'license-skeleton-pulse', 'license-live-pulse',
  // Feedback
  'login-card-shake', 'theme-wiggle', 'ws-shake',
  // Status / connection
  'pulse', 'kds-pulse', 'shift-pulse', 'table-occupied-pulse',
  'ws-dot-pulse', 'ws-glow-breath',
  // New-ticket arrival highlight (functional feedback — must pulse to
  // catch the kitchen's attention when a ticket is sent)
  'kds-new-ticket',
  // Urgent-ticket blink (critical kitchen alarm — must keep blinking
  // even with reduced-motion; the shake/sweep stay gated)
  'kds-urgent-blink',
  // Tooltip / toast
  'toast-slide-in', 'ctx-menu-enter',
  // Update banner (functional — must show/hide)
  'update-banner-slide-in', 'update-banner-slide-out',
  // Resize / breathing indicators
  'retail-resize-pulse', 'retail-breathe',
  'scale-pulse', 'product-card-price-pulse', 'kiosk-price-pulse',
  'search-pulse', 'ws-bg-shift', 'ws-particle-float',
  'ws-card-hover-sway',
  // Settings toggle
  'toggle-pulse',
  // Rate-limit status indication
  'login-rate-limit-pulse',
  // Entrance / decorative
  'fadeIn',
]);

/**
 * Find the character position of a `@keyframes <name>` definition.
 * Returns the position or -1 if not found.
 */
function findKeyframePosition(css: string, name: string): number {
  const regex = new RegExp(`@keyframes\\s+${name}\\s*\\{`);
  const match = regex.exec(css);
  return match ? match.index : -1;
}

/**
 * Check if a character position falls inside a
 * `@media (prefers-reduced-motion: no-preference)` block specifically.
 */
function positionInsideNoPreference(css: string, position: number): boolean {
  const mediaRegex = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = mediaRegex.exec(css)) !== null) {
    if (match.index > position) break;

    let braceCount = 1;
    let i = match.index + match[0].length;
    while (i < css.length && braceCount > 0) {
      if (css[i] === '{') braceCount++;
      else if (css[i] === '}') braceCount--;
      i++;
    }

    if (position > match.index && position < i) {
      return true;
    }
  }
  return false;
}

/**
 * Instrumentation only. Re-walks the SAME three patterns the enforcement case below
 * applies, but counts every declaration it reaches instead of stopping at the ones it
 * flags, so the case can print what the walker declined to look at:
 *  - graded                    -> adjudicated per rule (pattern A, pattern C, or a violation)
 *  - excusedByEssential       -> named in ESSENTIAL_KEYFRAMES
 *  - excusedByValue           -> `animation: none` / `auto`, no keyframe at all
 *  - swallowedByFileWideReduce-> reached pattern B, which excuses EVERY animation in a
 *                                sheet because one reduce block appears somewhere in it
 * `wouldFailPerRuleCheckIfLifted` counts, inside the amnesty bucket only, how many of
 * those declarations would NOT have survived patterns A and C on their own. It is a
 * measurement, not a second check: nothing here enforces it, and the sum assertion in
 * the case below is the only thing that can go red from a harvest that stops descending.
 */
function harvestAnimationStats() {
  const cssFiles = findCssFiles(normalize(join(__dirname, '..')));
  const out = {
    sheetsWalked: cssFiles.length,
    declarations: 0,
    graded: 0,
    violations: 0,
    excusedByEssential: 0,
    excusedByValue: 0,
    swallowedByFileWideReduce: 0,
    wouldFailPerRuleCheckIfLifted: 0,
    unresolvedKeyframes: 0,
    reduceBlockSheets: 0,
    transitionDecls: 0,
  };
  for (const filePath of cssFiles) {
    const css = stripBlockComments(readFileSync(filePath, 'utf-8'));
    const hasReduceBlock = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css);
    if (hasReduceBlock) out.reduceBlockSheets++;
    out.transitionDecls += (css.match(/\btransitions?\s*:/g) ?? []).length;
    const declRegex = /animation:\s*([a-zA-Z0-9_-]+)/g;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRegex.exec(css)) !== null) {
      const keyframeName = declMatch[1];
      const declPos = declMatch.index;
      out.declarations++;
      const kfPos = findKeyframePosition(css, keyframeName!);
      // Ordered so the VALUE excuse is evaluated before the miss is counted: an
      // `animation: none` names no keyframes because it is not naming a keyframes at
      // all, and counting it made the printed denominator report legitimate
      // declarations as findings to chase. Only a declaration that survives that
      // excuse needs a name, so only one is counted here. The essential-excuse order
      // is unchanged and the two sets are disjoint, so no other bucket can move.
      if (keyframeName === 'none' || keyframeName === 'auto') { out.excusedByValue++; continue; }
      if (kfPos === -1) out.unresolvedKeyframes++;
      if (ESSENTIAL_KEYFRAMES.has(keyframeName!)) { out.excusedByEssential++; continue; }
      if (positionInsideNoPreference(css, declPos)) { out.graded++; continue; }
      if (hasReduceBlock) {
        out.swallowedByFileWideReduce++;
        if (!(kfPos !== -1 && positionInsideNoPreference(css, kfPos))) {
          out.wouldFailPerRuleCheckIfLifted++;
        }
        continue;
      }
      if (kfPos !== -1 && positionInsideNoPreference(css, kfPos)) { out.graded++; continue; }
      out.graded++; out.violations++;
    }
  }
  return out;
}

const stats = harvestAnimationStats();
const gradedPct = ((stats.graded / stats.declarations) * 100).toFixed(1);
console.log(
  `animationCompliance harvest: ${stats.sheetsWalked} sheets parsed; ` +
    `${stats.declarations} animation declarations = ${stats.graded} graded (${gradedPct}%) + ` +
    `${stats.excusedByEssential} excused-by-essential + ${stats.excusedByValue} excused-by-value + ` +
    `${stats.swallowedByFileWideReduce} swallowed-by-file-wide-reduce; ` +
    `${stats.wouldFailPerRuleCheckIfLifted} of those ${stats.swallowedByFileWideReduce} would fail patterns A and C alone; ` +
    `${stats.unresolvedKeyframes} declarations name no @keyframes in their own sheet (misses); ` +
    `${stats.reduceBlockSheets} sheets carry a reduce block; ${stats.transitionDecls} transition declarations are never read.`,
);

describe('CSS animation reduced-motion compliance', () => {
  const srcDir = normalize(join(__dirname, '..'));
  let cssFiles: string[];

  beforeAll(() => {
    cssFiles = findCssFiles(srcDir);
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('every decorative `animation:` is gated via one of three patterns', () => {
    const violations: string[] = [];

    for (const filePath of cssFiles) {
      const css = stripBlockComments(readFileSync(filePath, 'utf-8'));
      const hasReduceBlock = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css);

      const declRegex = /animation:\s*([a-zA-Z0-9_-]+)/g;
      let declMatch: RegExpExecArray | null;
      while ((declMatch = declRegex.exec(css)) !== null) {
        const keyframeName = declMatch[1];

        // Skip essential animations
        if (ESSENTIAL_KEYFRAMES.has(keyframeName!)) continue;
        // Skip non-keyframe values
        if (keyframeName === 'none' || keyframeName === 'auto') continue;

        const declPos = declMatch.index;

        // Pattern A: animation declaration inside @media (prefers-reduced-motion: no-preference)
        if (positionInsideNoPreference(css, declPos)) continue;

        // Pattern B: file has a @media (prefers-reduced-motion: reduce) block that overrides
        if (hasReduceBlock) continue;

        // Pattern C: @keyframes definition is inside @media (prefers-reduced-motion: no-preference)
        const kfPos = findKeyframePosition(css, keyframeName!);
        if (kfPos !== -1 && positionInsideNoPreference(css, kfPos)) continue;

        // Violation
        const relPath = relative(process.cwd(), filePath);
        const line = css.slice(0, declPos).split('\n').length;
        violations.push(`${relPath}:${line} - animation: ${keyframeName}`);
      }
    }

    const msg = `Found ${violations.length} un-gated decorative animations.\n`
      + 'Expected one of:\n'
      + '  A: `animation:` inside @media (prefers-reduced-motion: no-preference)\n'
      + '  B: @media (prefers-reduced-motion: reduce) block overrides the animation\n'
      + '  C: @keyframes definition inside @media (prefers-reduced-motion: no-preference)\n'
      + '\nViolations:\n'
      + violations.join('\n');
    expect(violations, msg).toEqual([]);
  });

  it(`prints its own denominator: ${stats.graded} of ${stats.declarations} animation declarations graded (${gradedPct}%) across ${stats.sheetsWalked} sheets; ${stats.excusedByEssential} excused-by-essential, ${stats.excusedByValue} excused-by-value, ${stats.swallowedByFileWideReduce} swallowed by a file-wide reduce block (${stats.wouldFailPerRuleCheckIfLifted} of those would fail the per-rule check if that arm were lifted), ${stats.unresolvedKeyframes} naming no @keyframes in the same sheet, ${stats.transitionDecls} transition declarations never read`, () => {
    // The parts must sum to the whole: a harvest that quietly stopped descending, or
    // gained a bucket nobody counted, cannot read green behind this print.
    expect(
      stats.graded + stats.excusedByEssential + stats.excusedByValue + stats.swallowedByFileWideReduce,
    ).toBe(stats.declarations);
    expect(stats.sheetsWalked).toBeGreaterThan(0);
    expect(stats.declarations).toBeGreaterThan(0);
    expect(stats.graded).toBeGreaterThan(0);
    expect(stats.violations).toBe(0);
  });
});
