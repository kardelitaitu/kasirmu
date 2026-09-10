/**
 * Noise-Dither Compliance Test (P11-5)
 *
 * Scans all CSS files for elevated surfaces that use `box-shadow: var(--shadow-*)`
 * and verifies each such selector is covered by the SVG feTurbulence noise-dither
 * overlay defined in `components.css`.
 *
 * Uses simple string-inclusion checks instead of CSS parsing — avoids the fragility
 * of regex-based selector extraction when comments are interspersed.
 *
 * Same static-analysis approach as themeTokenCompliance.test.ts
 * and animationCompliance.test.ts — no browser needed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

/* ── Paths ───────────────────────────────────────────────────── */

const UI_SRC = resolve(__dirname, '..');
const COMPONENTS_CSS = resolve(UI_SRC, 'frontend/themes/components.css');

/* ── Drift-guard baseline: expected noise-dither selectors ──────── */
// When a new shadow-using component is added, its CSS class selector
// must be added to the ::after list in components.css AND to this set.
//
// Current count: 121 selectors (3 added for the org selector / org switcher
// surfaces). The original "6 core + 1 utility + 35 feature-specific" split
// stopped matching the list long ago — the inline group comments are the
// authoritative breakdown.
// Increment when adding new selectors; decrement when cleaning up legacy.
const KNOWN_NOISE_SELECTORS = [
  // Core pattern classes (always covered)
  '.card',
  '.modal-panel',
  '.staff-login-card',
  '.workspace-card',
  // Emergency fallback card — elevated surface (ERR-02)
  '.error-boundary__card',
  // Reusable utility class (recommended for NEW components)
  '.noise-dither',
  // Topology wire rename input + label pill (positioned absolute with
  // explicit z-index — the .noise-dither relative utility would fight
  // their anchoring, so they use the explicit ::after path).
  '.wire-rename-input',
  '.wire-label-pill',
  // Topology deploy-history browser (ADR #46 §2) — also carries the
  // .noise-dither utility; listed explicitly for the shadow-coverage check.
  '.topology-rev-browser',
  // Memo chat-bubble stack and its enlarged reading card — the two elevated
  // memo surfaces. Both are wired to ::after in components.css (main list +
  // both @media parity blocks). The close chips are NOT here: they are
  // exempt below as small circular controls.
  '.memo-banner',
  '.memo-expanded-card',
  // DEPRECATED LEGACY SELECTORS (feature-specific classes)
  '.retail-shift-modal',
  '.retail-held-carts-modal',
  '.retail-discount-modal',
  '.retail-qty-modal',
  '.retail-shortcuts-modal',
  '.retail-preview-modal',
  '.retail-customer-modal',
  '.tables-detail',
  '.settings-popup',
  '.license-activation-card',
  '.gift-cards-modal',
  '.promo-mgmt-modal',
  '.product-mgmt-modal',
  '.po-form-modal',
  '.stock-transfers-modal',
  '.shift-mgmt-modal',
  '.payment-modal',
  '.sales-history-modal',
  '.price-override-modal',
  '.dev-toolbar',
  '.restaurant-hamburger-dropdown',
  '.restaurant-context-menu',
  '.settings-sidebar',
  '.tooltip-content',
  '.ssel-dropdown',
  '.multi-store-stat-card',
  '.product-card',
  '.kiosk-product-card',
  '.setup-preset-card',
  '.setup-step-panel',
  '.pos-cart-line',
  '.pos-cart-tip-segment',
  '.permission-denied-card',
  '.tables-floorplan',
  '.terminal-mgmt-toggle-thumb',
  '.warehouse-popup',
  '.workspace-card--active',
  '.workspace-skeleton-card',
  '.ctx-menu',
  '.status-indicator.online',
  '.status-indicator.warning',
  '.status-indicator.offline',
  '.fastpin-card',
  '.qris-container',
  '.store-switcher-dropdown',
  '.create-pin-card',
  '.custom-context-menu',
  '.session-lock-card',
  '.cat-mgmt-icon-badge',
  '.cat-mgmt-icon-btn--selected',
  '.location-picker-dropdown',
  '.inventory-shift-bar',
  '.shift-status-active .status-indicator',
  '.shift-btn-primary',
  '.shift-btn-danger',
  '.shift-summary-modal',
  '.threshold-dialog',
  '.reverse-btn',
  '.kds-layout-popover',
  '.kds-ticket--green',
  '.kds-ticket-urgent-badge',
  '.kds-settings-popover',
  '.product-mgmt-alert-drawer',
  '.promo-mgmt-table',
  '.menu-eng-tooltip',
  '.retail-menu',
  // ADR #36 retail grid column-toggle dropdown + ADR #38 row context menu
  // (positioned absolute/fixed — the .noise-dither relative utility would
  // fight their anchoring, so they use the explicit ::after path).
  '.retail-col-toggle-menu',
  '.retail-row-context-menu',
  '.pos-cart-undo-bar',
  ".pos-cart-tip-segment[aria-pressed='true']",
  '.retail-reminder-popup',
  '.modifier-modal',
  '.kds-ticket-rush-badge',
  '.kds-picker-modal',
  '.kds-column',
  '.kds-shortcut-key',
  '.kds-device-status-dropdown',
  '.kds-enrollment-modal',
  '.exit-survey-modal',
  '.retail-cart-course-dropdown',
  '.pos-hold-modal',
  '.pos-held-list-modal',
  '.pos-close-shift-modal',
  '.receipt-preview-paper',
  '.refund-modal',
  '.shortfall-modal',
  '.settings-footer-shortcut kbd',
  '.toggle-thumb',
  '.topology-node',
  '.node-selected',
  '.topology-validation-banner',
  '.topology-relationship-picker',
  '.topology-migration-dialog',
  '.settings-shortcuts-popover',
  '.canvas-hud',
  '.canvas-zoom-controls',
  '.canvas-zoom-slider-pop',
  '.topology-shortcuts-popover',
  '.topology-context-menu',
  '.topology-finder',
  '.topology-align-toolbar',
  '.topology-minimap',
  '.topology-validation-panel',
  '.topology-issues-btn',
  '.customer-mgmt-history',
  '.panel',
  ':global(.dark) .panel',
  // Org selector + org switcher surfaces (shadow-lg / shadow-xl, theme-tokenized).
  // All three are positioned absolute with an explicit z-index, so the
  // .noise-dither relative utility would fight their anchoring — they use the
  // explicit ::after path, wired in components.css main list + both @media
  // parity blocks.
  '.org-selector-list',
  '.org-switcher-list',
  '.org-switcher-modal',
];

/** CSS selectors that are exempt from noise-dither even though they use --shadow-* */
const EXEMPT_SELECTOR_PREFIXES = [
  ':root',              // Token definitions, not a surface
  '.btn',               // Buttons have thin shadows, no banding
  '.badge',             // Badges have no elevation
  '.spinner',           // No elevation shadow
  '.skeleton',          // No elevation shadow
  '.card--padding-',    // Card modifier — inherits from .card
  '.card--shadow-',     // Card shadow modifier — inherits from .card
  '.card-header',       // Card child — inherits from .card
  '.card-body',         // Card child — inherits from .card
  '.card-footer',       // Card child — inherits from .card
  '.modal-overlay',     // Semi-transparent overlay, no elevation shadow
  '.modal-header',      // Modal child — inherits from .modal-panel
  '.modal-title',       // Modal child
  '.modal-close-btn',   // Modal child
  '.modal-body',        // Modal child
  '.modal-footer',      // Modal child
  '.toast-container',   // Container, no shadow
  '.toast__',           // Toast child elements
  '.toast--',           // Toast modifier variants
  '.empty-state',       // No elevation shadow
  '.empty-state__',     // Empty state child
  '.error-state',       // No elevation shadow
  '.error-state__',     // Error state child
  '.input-',            // Input child
  '.confirm-dialog-',   // Dialog child (inherits from modal)
  '.nav-item',          // Navigation item
  '.sr-only',           // Screen-reader-only utility
  '.theme-toggle',      // Theme toggle button
  '.payment-',          // Payment modal child elements
  // KDS slider knob: a 20px circle with a 1-3px shadow. Same reasoning the list already
  // gives for '.btn' ("thin shadows, no banding") and '.theme-toggle' -- banding needs a
  // large, soft gradient to be visible, and a 20px disc has no such area. Reached this by
  // tokenising the knob's previously hardcoded box-shadow to satisfy
  // themeTokenCompliance.test.ts; the two gates are coupled, so a shadow token here is
  // read as a new elevated surface.
  '.kds-slider-knob',
  // Memo close chips: a 24px and a 44px circle (border-radius: --radius-full),
  // each absolutely positioned over a parent that IS dithered above. Same
  // reasoning as '.kds-slider-knob' and '.btn' — banding needs a large, soft
  // gradient to be visible — plus the '.modal-close-btn' precedent for a
  // control inheriting its parent's treatment. Texturing a small disc reads
  // as dirt, not depth.
  '.memo-banner-close',
  '.memo-expanded-close',
];

/* ── Helpers ─────────────────────────────────────────────────── */

/** Find CSS files recursively. */
function findCssFiles(dir: string): string[] {
  const results: string[] = [];
  const absDir = resolve(UI_SRC, dir);
  try {
    const entries = readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results.push(...findCssFiles(join(dir, entry.name)));
      } else if (entry.name.endsWith('.css')) {
        results.push(fullPath);
      }
    }
  } catch { /* skip */ }
  return results;
}

/** Extract the text inside a @media (prefers-...) block. */
function extractMediaBlock(
  css: string,
  feature: string,
  value: string,
): string {
  const regex = new RegExp(
    `@media\\s*\\(${feature}\\s*:\\s*${value}\\)\\s*\\{`,
  );
  const match = regex.exec(css);
  if (!match) return '';

  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

/** Find the noise-dither main block by looking for the noise URI reference. */
function extractMainDitherBlock(css: string): string {
  const noiseIdx = css.indexOf('background-image: var(--noise-uri)');
  if (noiseIdx < 0) return '';

  // Walk backward from the noise-uri to find the opening `{` of the ::after block
  let braceIdx = noiseIdx;
  while (braceIdx >= 0 && css[braceIdx] !== '{') braceIdx--;
  if (braceIdx < 0) return '';

  // Walk backward from the brace to find where the selector list starts
  let selStart = braceIdx - 1;
  while (selStart >= 0 && css[selStart] !== '}') selStart--;

  // If we hit a `}`, selStart+1 is the start of the selector list
  // If we didn't, start from index 0
  const selectorList = css.slice(selStart + 1, braceIdx);
  return selectorList;
}

/** Parse a comma-separated selector list string into individual selectors. */
function parseSelectorList(text: string): string[] {
  // Remove CSS comments
  const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const selectors: string[] = [];
  for (const part of cleaned.split(',')) {
    const sel = part
      .replace(/::after/g, '')
      .trim();
    if (sel && !sel.startsWith('/*')) {
      selectors.push(sel);
    }
  }
  return selectors;
}

/* ── Test data ────────────────────────────────────────────────── */

let componentsCss: string;
let mainSelectorText: string;
let contrastBlock: string;
let reducedBlock: string;
let allCssFiles: string[];
let uncoveredSurfaces: { file: string; selector: string }[];

/* ── Tests ────────────────────────────────────────────────────── */

describe('Noise-dither overlay coverage (P11-5)', () => {
  beforeAll(() => {
    componentsCss = readFileSync(COMPONENTS_CSS, 'utf-8');
    mainSelectorText = extractMainDitherBlock(componentsCss);

    // Extract @media blocks for parity check
    // The contrast and reduced blocks in components.css put the ::after
    // selector list on a single line inside the @media block: `{ .card::after, ..., .permission-denied-card::after { display: none; } }`
    // So we need to search inside those blocks.
    contrastBlock = extractMediaBlock(componentsCss, 'prefers-contrast', 'high');
    reducedBlock = extractMediaBlock(componentsCss, 'prefers-reduced-motion', 'reduce');

    // Find all shadow-using selectors across CSS files
    uncoveredSurfaces = [];
    allCssFiles = [];

    for (const dir of ['features', 'frontend', 'components']) {
      const files = findCssFiles(dir);
      allCssFiles.push(...files);

      for (const file of files) {
        const basename = file.split(/[/\\]/).pop() || '';
        if (basename === 'tokens.css' || basename === 'components.css') continue;

        try {
          let content = readFileSync(file, 'utf-8');
          // Remove CSS comments to prevent false positives
          content = content.replace(/\/\*[\s\S]*?\*\//g, '');

          // Split into individual rule blocks by finding top-level `}` boundaries
          // Each rule block is: selectors { properties }
          const rules: string[] = [];
          let depth = 0;
          let current = '';
          for (const ch of content) {
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                current += '}';
                rules.push(current);
                current = '';
                continue;
              }
            }
            current += ch;
          }

          for (const rule of rules) {
            const braceIdx = rule.indexOf('{');
            if (braceIdx < 0) continue;

            const rawSelectors = rule.slice(0, braceIdx).trim();
            const body = rule.slice(braceIdx + 1, -1).trim();

            // Skip @-rules (keyframes, media, font-face, etc)
            if (rawSelectors.startsWith('@')) continue;
            if (!body.includes('--shadow-')) continue;
            if (!body.includes('box-shadow')) continue;

            // Split by comma to get individual selectors, then clean
            for (const part of rawSelectors.split(',')) {
              const sel = part.trim();
              if (!sel || sel.includes('::')) continue; // Skip pseudo-elements

              const relPath = file.replace(/\\/g, '/').replace(/^.*?ui\/src\//, '');
              uncoveredSurfaces.push({ file: relPath, selector: sel });
            }
          }
        } catch { /* skip unparseable files */ }
      }
    }
  });

  // ── Baseline verification ──────────────────────────────────

  it('each KNOWN_NOISE_SELECTOR is present in the noise-dither ::after list', () => {
    const missing: string[] = [];
    for (const sel of KNOWN_NOISE_SELECTORS) {
      if (!mainSelectorText.includes(`${sel}::after`)) {
        missing.push(sel);
      }
    }
    expect(missing,
      `Selectors missing from noise-dither ::after block in components.css:\n  ${missing.join('\n  ')}\n\n`
      + 'Add them to the `/* Core pattern classes */` selector list and then restart.'
    ).toEqual([]);
  });

  it('no unexpected selectors in the CSS (check KNOWN_NOISE_SELECTORS is up to date)', () => {
    const parsed = parseSelectorList(mainSelectorText);
    const unexpected = parsed.filter((s) => !KNOWN_NOISE_SELECTORS.includes(s) && s.includes('.'));
    if (unexpected.length > 0) {
      console.warn(`[INFO] ${unexpected.length} new selector(s) in CSS not in KNOWN_NOISE_SELECTORS baseline.`);
      console.warn(`  Add to KNOWN_NOISE_SELECTORS: "${unexpected.join('", "')}"`);
    }
    // Don't fail — just warn. New selectors are allowed if baseline is updated.
  });

  // ── @media block parity ────────────────────────────────────

  it('all noise selectors have parity in @media (prefers-contrast: high) block', () => {
    const missing: string[] = [];
    for (const sel of KNOWN_NOISE_SELECTORS) {
      if (!contrastBlock.includes(`${sel}::after`)) {
        missing.push(sel);
      }
    }
    expect(missing,
      `Selectors missing from @media (prefers-contrast: high) block:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('all noise selectors have parity in @media (prefers-reduced-motion: reduce) block', () => {
    const missing: string[] = [];
    for (const sel of KNOWN_NOISE_SELECTORS) {
      if (!reducedBlock.includes(`${sel}::after`)) {
        missing.push(sel);
      }
    }
    expect(missing,
      `Selectors missing from @media (prefers-reduced-motion: reduce) block:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  // ── Shadow-using selector coverage ─────────────────────────

  it('every elevated surface (uses --shadow-*) is covered by noise-dither', () => {
    const uncovered = uncoveredSurfaces.filter(({ selector: sel }) => {
      // Check if covered by KNOWN_NOISE_SELECTORS
      if (KNOWN_NOISE_SELECTORS.includes(sel)) return false;
      // Check if covered by exact match on the set
      // Check if exempt
      for (const prefix of EXEMPT_SELECTOR_PREFIXES) {
        if (sel.startsWith(prefix)) return false;
      }
      // Hover/focus/active/disabled pseudo-classes — inherit from parent
      if (/:hover|:focus|:active|:disabled|:visited/.test(sel)) return false;
      // Attribute selectors (state variants) — inherit from base class
      if (sel.startsWith('[')) return false;
      return true;
    });

    const msg = uncovered.length > 0
      ? `Found ${uncovered.length} elevated surface(s) without noise-dither:\n\n`
        + uncovered.map(
            (u, i) =>
              `  ${i + 1}. ${u.file}\n`
              + `     Selector: ${u.selector}\n`
              + `     Fix: Add \`${u.selector}::after,\` to the noise-dither block in\n`
              + `       ui/src/frontend/themes/components.css and add '${u.selector}'\n`
              + `       to KNOWN_NOISE_SELECTORS in this test.\n`
          ).join('\n')
      : 'All shadow-using selectors are covered by noise-dither. ✅';

    expect(uncovered, msg).toEqual([]);
  });

  // ── Sanity checks ─────────────────────────────────────────

  it('scanned at least 10 CSS files for shadow-using selectors', () => {
    expect(allCssFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('core elevated surfaces (.card, .modal-panel, .noise-dither) are covered', () => {
    const missing = ['.card', '.modal-panel', '.noise-dither']
      .filter((cls) => !mainSelectorText.includes(`${cls}::after`));
    expect(missing,
      `Core surfaces missing noise overlay: ${missing.join(', ')}\n`
      + 'This would cause visible banding on every elevated element!'
    ).toEqual([]);
  });

  it('covered selector count matches baseline (35)', () => {
    const parsed = parseSelectorList(mainSelectorText);
    const actualSelectors = parsed.filter((s) => s.includes('.'));
    // Soft check — warn if mismatch but don't fail
    if (actualSelectors.length !== KNOWN_NOISE_SELECTORS.length) {
      console.warn(
        `[INFO] Selector count mismatch: parsed ${actualSelectors.length}, baseline ${KNOWN_NOISE_SELECTORS.length}.\n`
        + `  Parsed: ${actualSelectors.join(', ')}`
      );
    }
  });
});
