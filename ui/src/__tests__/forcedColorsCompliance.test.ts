import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const UI_SRC = resolve(__dirname, '..');

interface Requirement {
  file: string;
  selector: string;
  reason: string;
}

const SYSTEM_COLORS = /ButtonText|ButtonFace|CanvasText|Canvas|Highlight|GrayText|LinkText|SelectedItemText/;

/**
 * Status-critical indicators that communicate state purely through
 * colour/glow/gradient in normal mode. Each MUST have a
 * `@media (forced-colors: active)` fallback that restores the state via
 * structural cues (border style, fill vs hollow) or a system colour, so
 * the information survives Windows high-contrast / forced-colors.
 */
const COLOR_ONLY_INDICATORS: Requirement[] = [
  // Status bar connection dots — colour + glow only
  { file: 'app/StatusBar.css', selector: '.statusbar-dot--online', reason: 'status dot (colour + glow only)' },
  { file: 'app/StatusBar.css', selector: '.statusbar-dot--offline', reason: 'status dot (colour + glow only)' },
  { file: 'app/StatusBar.css', selector: '.statusbar-dot--checking', reason: 'status dot (colour + glow only)' },
  // Gateway status badge dots
  { file: 'components/GatewayStatusBadge.css', selector: '.gateway-badge__dot.online', reason: 'gateway status dot (colour only)' },
  { file: 'components/GatewayStatusBadge.css', selector: '.gateway-badge__dot.offline', reason: 'gateway status dot (colour only)' },
  // Connection status indicators
  { file: 'components/ConnectionStatus.css', selector: '.status-indicator.checking', reason: 'connection status indicator (colour only)' },
  { file: 'components/ConnectionStatus.css', selector: '.status-indicator.online', reason: 'connection status indicator (colour only)' },
  { file: 'components/ConnectionStatus.css', selector: '.status-indicator.warning', reason: 'connection status indicator (colour only)' },
  { file: 'components/ConnectionStatus.css', selector: '.status-indicator.offline', reason: 'connection status indicator (colour only)' },
  // Stock alert severity dots
  { file: 'features/inventory/StockAlertPanel.css', selector: '.stock-alert-severity-dot', reason: 'severity dot (colour only)' },
  { file: 'features/inventory/StockAlertPanel.css', selector: '.stock-alert-severity-dot--warning', reason: 'severity dot (colour only)' },
  // Stock alert card left-border severity
  { file: 'features/inventory/StockAlertPanel.css', selector: '.stock-alert-card--critical', reason: 'card severity border (colour only)' },
  { file: 'features/inventory/StockAlertPanel.css', selector: '.stock-alert-card--warning', reason: 'card severity border (colour only)' },
];

/**
 * Interactive elements whose focus ring relies on a CSS custom-property
 * colour. Under forced-colors the ring must switch to the system
 * Highlight colour so keyboard focus remains visible.
 */
const FOCUS_RING_REQUIREMENTS: Requirement[] = [
  { file: 'app/StatusBar.css', selector: '.statusbar-btn:focus-visible', reason: 'status bar button focus ring' },
  { file: 'components/StockAlertBell.css', selector: '.stock-alert-bell:focus-visible', reason: 'stock alert bell focus ring' },
  { file: 'features/inventory/StockAlertPanel.css', selector: '.stock-alert-ack-btn:focus-visible', reason: 'stock alert acknowledge focus ring' },
];

/**
 * Extract the body of every `@media (forced-colors: active)` block in the
 * given CSS text (supports nested braces inside the block).
 */
function extractForcedColorsBlocks(css: string): string[] {
  const blocks: string[] = [];
  const mediaRe = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = mediaRe.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(match.index, i));
  }
  return blocks;
}

/**
 * Split a CSS block into individual `selector { body }` rules, trimming
 * nesting so rules can be matched against a selector independently.
 */
function extractRules(block: string): { selectors: string; body: string }[] {
  const rules: { selectors: string; body: string }[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(block)) !== null) {
    const selectors = match[1]!.trim();
    const body = match[2]!.trim();
    if (!selectors || !body) continue;
    // Skip nested at-rules (e.g. @keyframes) — selectors only
    if (selectors.startsWith('@')) continue;
    rules.push({ selectors, body });
  }
  return rules;
}

describe('Forced-colors (Windows high-contrast) compliance', () => {
  const cssCache = new Map<string, string>();

  const readCss = (file: string): string => {
    if (!cssCache.has(file)) {
      const fullPath = resolve(UI_SRC, file);
      if (!existsSync(fullPath)) {
        throw new Error(`Missing CSS file referenced by compliance gate: ${file}`);
      }
      cssCache.set(file, readFileSync(fullPath, 'utf-8'));
    }
    return cssCache.get(file)!;
  };

  const blocksFor = (file: string): string[] => extractForcedColorsBlocks(readCss(file));

  /**
   * Find the specific rule whose selector group mentions `selector` inside
   * the first forced-colors block of `file`. Returns the rule or undefined.
   */
  const ruleFor = (file: string, selector: string) => {
    const block = blocksFor(file)[0];
    if (!block) return undefined;
    return extractRules(block).find((r) =>
      r.selectors.split(',').map((s) => s.trim()).includes(selector),
    );
  };

  it('every colour-only status indicator has a forced-colors fallback with structural/system-colour cues', () => {
    const violations: string[] = [];

    for (const req of COLOR_ONLY_INDICATORS) {
      const rule = ruleFor(req.file, req.selector);

      if (!rule) {
        violations.push(
          `${req.file}: "${req.selector}" (${req.reason}) has no @media (forced-colors: active) rule`,
        );
        continue;
      }
      // The indicator's own rule must carry the structural/system-colour
      // cue — not merely a sibling rule elsewhere in the block.
      if (!SYSTEM_COLORS.test(rule.body)) {
        violations.push(
          `${req.file}: forced-colors rule for "${req.selector}" does not use a system colour (ButtonText/ButtonFace/Canvas/Highlight) or structural border cue`,
        );
      }
    }

    const msg = violations.length
      ? `Forced-colors violations found (${violations.length}):\n\n${violations.join('\n')}`
      : 'All colour-only status indicators have forced-colors fallbacks';
    expect(violations, msg).toHaveLength(0);
  });

  it('interactive elements switch their focus ring to system Highlight under forced-colors', () => {
    const violations: string[] = [];

    for (const req of FOCUS_RING_REQUIREMENTS) {
      const rule = ruleFor(req.file, req.selector);

      if (!rule) {
        violations.push(`${req.file}: "${req.selector}" has no forced-colors focus ring rule`);
        continue;
      }
      if (!/Highlight/.test(rule.body)) {
        violations.push(
          `${req.file}: forced-colors focus ring for "${req.selector}" does not use the system Highlight colour`,
        );
      }
    }

    const msg = violations.length
      ? `Forced-colors focus-ring violations found (${violations.length}):\n\n${violations.join('\n')}`
      : 'All interactive focus rings switch to system Highlight under forced-colors';
    expect(violations, msg).toHaveLength(0);
  });
});
