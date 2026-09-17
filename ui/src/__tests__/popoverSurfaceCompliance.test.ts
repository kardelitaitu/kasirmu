/**
 * Popover Surface Token Compliance (THM-08)
 *
 * Floating menus / dropdowns / context menus / popovers — and any other
 * surface that overlays content (side drawers, canvas HUDs, sticky table
 * headers) — must use the dedicated `--color-bg-popover` token, which is
 * OPAQUE in every theme.
 * (--color-bg-surface and --color-bg-elevated may be semi-transparent in some
 * themes, so any floating text surface using them could blend with the
 * content it floats over.)
 *
 * Two guarantees, enforced here:
 *   1. `--color-bg-popover` is defined in all three theme blocks and resolves
 *      to an opaque colour in each.
 *   2. Every known floating surface references `--color-bg-popover` for its
 *      background — so a future refactor back to a translucent token (or a
 *      new dropdown that copies a translucent pattern) fails CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_SRC = resolve(__dirname, '..');
const TOKENS_PATH = resolve(UI_SRC, 'frontend/themes/tokens.css');

/* ── Every floating / scroll-overlaid surface ───────────────────────
 * Add a new floating or overlay surface here (selector + CSS file) when
 * you build one — it must use --color-bg-popover or this test fails. */
const POPOVER_SURFACES: ReadonlyArray<{ selector: string; file: string }> = [
  { selector: '.restaurant-context-menu', file: 'features/restaurant/RestaurantMenu.css' },
  { selector: '.restaurant-hamburger-dropdown', file: 'features/restaurant/RestaurantMenu.css' },
  { selector: '.ctx-menu', file: 'components/ContextMenu.css' },
  { selector: '.custom-context-menu', file: 'features/auth/LicenseActivationScreen.css' },
  { selector: '.store-switcher-dropdown', file: 'components/StoreSwitcher.css' },
  { selector: '.location-picker-dropdown', file: 'features/inventory/LocationPicker.css' },
  { selector: '.ssel-dropdown', file: 'features/settings/SettingsSelect.css' },
  { selector: '.retail-cart-course-dropdown', file: 'features/retail/RetailPosScreen.css' },
  { selector: '.retail-menu', file: 'features/retail/RetailPosScreen.css' },
  { selector: '.settings-shortcuts-popover', file: 'features/settings/SettingsNavTree.css' },
  // `.kds-settings-popover` retired with KdsSettingsPanel (renders nowhere;
  // todo-kds-agents-6). Its companion stylesheet was deleted with the
  // component, so the entry would throw ENOENT exactly like the
  // layout-popover one below.
  { selector: '.kds-enrollment-modal', file: 'features/kds/components/KdsEnrollmentModal.css' },
  // `.kds-layout-popover` was listed here until the layout switcher was
  // removed in the Phase 6 cleanup (fece7524). Its stylesheet went with it,
  // so the entry threw ENOENT and failed both compliance tests.
  { selector: '.menu-eng-tooltip', file: 'features/reports/MenuEngineeringScreen.css' },
  { selector: '.retail-reminder-popup', file: 'features/retail/RetailPosScreen.css' },
  { selector: '.pos-cart-undo-bar', file: 'features/sales/CartPanel.css' },
  { selector: '.product-mgmt-alert-drawer', file: 'features/products/ProductManagementScreen.css' },
  { selector: '.kds-picker-modal', file: 'features/kds/components/KdsProductPickerModal.css' },
  { selector: '.node-inspector-drawer', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.canvas-hud', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.canvas-zoom-controls', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.canvas-zoom-slider-pop', file: 'features/locations/NodeTopologyEditor.css' },
  // topology-shortcuts-popover removed with the shortcuts feature (agent-1 UX merge)
  { selector: '.topology-context-menu', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.topology-align-toolbar', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.topology-minimap', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.topology-validation-panel', file: 'features/locations/NodeTopologyEditor.css' },
  { selector: '.dev-toolbar', file: 'features/design/DevToolbar.css' },
  // Sticky header over scrolling rows — rows must not bleed through (THM-08).
  { selector: '.custom-report-table th', file: 'features/reports/CustomReportScreen.css' },
];

const THEME_BLOCKS: ReadonlyArray<{ label: string; open: RegExp }> = [
  { label: 'dark', open: /:root\s*\{/ },
  { label: 'light', open: /\[data-theme=['"]light['"]\]\s*\{/ },
  { label: 'dark', open: /\[data-theme=['"]dark['"]\]\s*\{/ },
];

/** Extract the bodies of every rule whose selector list contains `selector`
 *  at a boundary (start, comma, or whitespace) — e.g. matches
 *  `.retail-menu {` but not `.retail-menu-header {` or `.retail-menu-overlay`. */
function ruleBodiesFor(file: string, selector: string): string[] {
  const content = readFileSync(resolve(UI_SRC, file), 'utf-8');
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Pseudo-class / pseudo-element rules (:hover, ::after) are excluded —
  // they tint/hover over the opaque panel and are not the surface chrome.
  const re = new RegExp(`(?:^|[,\\s])${esc}\\s*\\{([^{}]*)\\}`, 'g');
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) bodies.push(m[1]!);
  return bodies;
}

/** Pull the background/background-color declaration out of a rule body. */
function bgOf(body: string): string | null {
  const m = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+);/);
  return m ? m[1]!.trim() : null;
}

/** Resolve one level of var() indirection inside a theme block. */
function resolveVar(block: string, name: string): string | null {
  const def = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!def) return null;
  const value = def[1]!.trim();
  const ref = value.match(/^var\(--([^)]+)\)$/);
  if (ref) {
    const inner = block.match(new RegExp(`--${ref[1]}\\s*:\\s*([^;]+);`));
    return inner ? inner[1]!.trim() : value;
  }
  return value;
}

/** A colour is opaque if it has no alpha channel (hex, rgb/hsl without
 *  alpha, or rgba/hsla whose alpha resolves to 1). */
function isOpaque(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'currentcolor' || v === 'none') return false;
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return true; // 6/3-digit hex: opaque
  if (/^#[0-9a-f]{8}$/i.test(v)) return false; // 8-digit hex: carries alpha
  const alpha = v.match(
    /(?:rgba?|hsla?)\(\s*[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/,
  );
  if (alpha) return parseFloat(alpha[1]!) >= 1;
  // rgb()/hsl() without an alpha channel are opaque by definition.
  return !/^(rgba?|hsla?)\(/.test(v);
}

describe('popover surface token compliance (THM-08)', () => {
  const tokens = readFileSync(TOKENS_PATH, 'utf-8');

  it('--color-bg-popover is defined and opaque in every theme', () => {
    const failures: string[] = [];
    for (const theme of THEME_BLOCKS) {
      const block = tokens.match(new RegExp(`${theme.open.source}([\\s\\S]*?)}`))?.[1];
      if (!block) {
        failures.push(`${theme.label}: theme block not found`);
        continue;
      }
      const value = resolveVar(block, 'color-bg-popover');
      if (value === null) {
        failures.push(`${theme.label}: --color-bg-popover is not defined`);
        continue;
      }
      if (!isOpaque(value)) {
        failures.push(`${theme.label}: --color-bg-popover resolves to ${value} — must be opaque`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every floating / scroll-overlaid surface uses --color-bg-popover', () => {
    const failures: string[] = [];
    for (const s of POPOVER_SURFACES) {
      const bodies = ruleBodiesFor(s.file, s.selector);
      if (bodies.length === 0) {
        failures.push(`${s.file}: rule for ${s.selector} not found`);
        continue;
      }
      for (const body of bodies) {
        const bg = bgOf(body);
        if (bg === null) continue; // no background on this rule (e.g. overlay)
        if (!bg.includes('var(--color-bg-popover)')) {
          failures.push(
            `${s.file}: ${s.selector} must use var(--color-bg-popover) ` +
              `(got: ${bg})`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('no floating surface falls back to a translucent bg token', () => {
    // Directly assert the surfaces never reference the translucent tokens,
    // even inside theme-scoped or media-scoped overrides (which the main
    // token scanner skips because their selectors start with [data-theme).
    const translucent = [
      'var(--color-bg-surface)',
      'var(--color-bg-elevated)',
      'var(--color-bg-overlay)',
    ];
    const failures: string[] = [];
    for (const s of POPOVER_SURFACES) {
      for (const body of ruleBodiesFor(s.file, s.selector)) {
        const bg = bgOf(body);
        if (bg !== null && translucent.some((t) => bg.includes(t))) {
          failures.push(`${s.file}: ${s.selector} uses ${bg} (must be --color-bg-popover)`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});