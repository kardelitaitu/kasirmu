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
    } else if (entry.name.endsWith('.css') && !entry.name.endsWith('.module.css')) {
      results.push(fullPath);
    }
  }
  return results;
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
      const css = readFileSync(filePath, 'utf-8');
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
});
