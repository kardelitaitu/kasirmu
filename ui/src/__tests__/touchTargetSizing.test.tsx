import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/* ── Helpers ─────────────────────────────────────────────────── */

const UI_SRC = resolve(__dirname, '..');
const BASE_SIZE = 16;

interface Violation {
  file: string;
  line: number;
  selector: string;
  declaration: string;
  reason: string;
}

function parsePxValue(value: string): number | null {
  const trimmed = value.trim();
  const px = trimmed.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const rem = trimmed.match(/^(\d+(?:\.\d+)?)rem$/);
  if (rem) return Number(rem[1]) * BASE_SIZE;
  if (trimmed.startsWith('calc(')) {
    let total = 0;
    const terms = trimmed.replace(/^calc\(|\)$/g, '').match(/[\d.]+(?:px|rem)/g);
    if (terms) for (const t of terms) { const v = parsePxValue(t); if (v !== null) total += v; }
    return total;
  }
  return null;
}

function referencesTouchTarget(value: string): boolean {
  return /--touch-target-(?:min|comfortable)/.test(value);
}

function isAdequate(px: number | null, value: string): boolean {
  if (referencesTouchTarget(value)) return true;
  if (px !== null && px >= 44) return true;
  return false;
}

/* ── Interactive element patterns ────────────────────────────── */

const INTERACTIVE_SELECTOR_RE =
  /\.(?:btn|button|tab|switch|toggle|close|clickable|action-btn|nav-item|filter-btn|modal-close|line-remove|theme-toggle|card-clickable|action-button|icon-btn|cat-mgmt-(?:edit|delete|icon)-btn|cat-mgmt-colour-swatch)\b/i;

// Restaurant surface (resto-pos tackle-all Phase 5): exact-match controls
// from the menu sheet. The scanner tests the selector STRING, so a \b-style
// alternation over-matched every decorative descendant (card parts, state
// classes); the exact set below is the graded population — verify with the
// suite's own violation print, not by widening this list.
//
// Two deliberate non-matches: `.restaurant-card` is the product tile itself
// and is graded by the card-height suite rather than by a height declaration
// (the scanner cannot resolve its calc() of --space-* tokens and mis-reads
// it as 22px); the colour swatches are decorative fill (no text) and are
// graded by their focus treatment, not their size.
const RESTAURANT_INTERACTIVE_RE =
  /^\s*\.(?:restaurant-sidebar-btn|restaurant-hamburger-btn|restaurant-sidebar-item|restaurant-hamburger-item|restaurant-category-pill|restaurant-search-clear|restaurant-context-item|restaurant-size-btn)\s*$/i;

/** Selectors to skip — known false positives (decorative parts of custom controls). */
const SKIP_SELECTOR_RE = [
  // Custom toggle switch: hidden native checkbox, visual track/thumb
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
];

function isSkipSelector(selectors: string): boolean {
  return SKIP_SELECTOR_RE.some((re) => re.test(selectors));
}

/* ── CSS scanner ─────────────────────────────────────────────── */

const SIZING_PROPS = /^\s*(?:min-)?height\s*:/;
const HEIGHT_AUTO_RE = /^\s*(?:min-)?height\s*:\s*auto\s*;?\s*$/;

function scanCSS(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf-8');
  const violations: Violation[] = [];

  // Strip block comments for easier parsing
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');

  /** State: track whether we're in a @media (pointer: coarse) block. */
  let inPointerCoarse = false;

  // Parse rule-by-rule
  const rules = stripped.match(/[^{}]*\{[^{}]*\}/g) || [];

  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    // @media rules — track pointer: coarse context
    if (selectors.startsWith('@')) {
      if (/pointer\s*:\s*coarse/.test(selectors)) {
        inPointerCoarse = true;
      } else {
        inPointerCoarse = false;
      }
      continue;
    }

    // Inside @media (pointer: coarse) — these are the touch-target overrides, skip them entirely
    if (inPointerCoarse) continue;

    // Reset flag on next non-media rule (we've left the media query block)
    inPointerCoarse = false;

    // Skip known false-positive selectors
    if (isSkipSelector(selectors)) continue;

    // Skip non-interactive selectors
    if (!INTERACTIVE_SELECTOR_RE.test(selectors) && !RESTAURANT_INTERACTIVE_RE.test(selectors)) continue;

    // Check each declaration
    const decls = body.split(';');
    for (const decl of decls) {
      const trimmedDecl = decl.trim();
      if (!SIZING_PROPS.test(trimmedDecl)) continue;

      // Skip height: auto (valid responsive value)
      if (HEIGHT_AUTO_RE.test(trimmedDecl)) continue;

      const colonIdx = trimmedDecl.indexOf(':');
      if (colonIdx === -1) continue;

      const prop = trimmedDecl.slice(0, colonIdx).trim();
      const value = trimmedDecl.slice(colonIdx + 1).trim();
      const px = parsePxValue(value);

      if (!isAdequate(px, value)) {
        // Find actual line in original file
        const searchStr = selectors.split(',')[0]!.trim();
        const idx = content.indexOf(searchStr);
        const lineNum = idx !== -1 ? content.slice(0, idx).split('\n').length : 0;

        violations.push({
          file: filePath,
          line: lineNum,
          selector: selectors,
          declaration: `${prop}: ${value}`,
          reason: px !== null
            ? `${px}px < 44px minimum touch target`
            : `"${value}" not computable to >= 44px`,
        });
      }
    }
  }

  return violations;
}

/* ── CSS files to audit ─────────────────────────────────────────── */

const CSS_FILES = [
  'features/restaurant/RestaurantMenu.css',
  'features/retail/RetailPosScreen.css',
  'features/sales/PaymentModal.css',
  'features/sales/PosScreen.css',
  'features/sales/PriceOverrideModal.css',
  'features/sales/RefundModal.css',
  'features/sales/CartPanel.css',
  'features/sales/CartPanelActions.css',
  'features/sales/CartPanelCourseBar.css',
  'features/sales/CartPanelFooterTotals.css',
  'features/sales/CartPanelLineItem.css',
  'features/sales/CartPanel.brand.css',
  'features/sales/components/ItemModifierModal.css',
  'features/sales/SalesHistoryScreen.css',
  'features/sales/EodReportScreen.css',
  'features/sales/VoidOrdersScreen.css',
  'features/settings/SettingsPage.css',
  'features/settings/SettingsSelect.css',
  'features/settings/LicenseSettings.css',
  'features/settings/DataManagementScreen.css',
  'features/settings/FeatureToggleScreen.css',
  'features/stock-transfers/StockTransfersScreen.css',
  'features/purchasing/PurchaseOrderForm.css',
  'features/purchasing/PurchaseOrdersScreen.css',
  'features/purchasing/SuppliersScreen.css',
  'features/loyalty/LoyaltyManagementScreen.css',
  'features/products/ProductManagementScreen.css',
  'features/products/ProductLookupScreen.css',
  'features/categories/CategoryManagementScreen.css',
  'features/currency/ExchangeRateScreen.css',
  'features/tax/TaxConfigurationScreen.css',
  'features/customers/CustomerManagementScreen.css',
  'features/staff/StaffManagementScreen.css',
  'features/shifts/ShiftManagementScreen.css',
  'features/terminals/TerminalManagementScreen.css',
  'features/tables/TableManagementScreen.css',
  'features/promotions/PromotionManagementScreen.css',
  'features/kiosk/KioskScreen.css',
  'features/kds/KdsScreen.css',
  'features/gift-cards/GiftCardsScreen.css',
  'features/auth/LicenseActivationScreen.css',
  'features/auth/StaffLoginScreen.css',
  'features/auth/CreatePinScreen.css',
  'features/inventory/StockCountDetail.css',
  'features/inventory/StockCountForm.css',
  // 'features/setup/SetupWizard.css' left this list with the retired wizard
  // (ADR #56 §2.3, 2026-09-23). Its StepAccount atoms briefly moved to
  // ProvisioningFlow.css and were then removed with StepAccount itself, which
  // had no importer once the wizard was gone.
  'features/workspaces/WorkspaceHome.css',
  'features/reports/DashboardScreen.css',
  'features/reports/SalesReportScreen.css',
  'features/reports/InventoryReportScreen.css',
  'features/reports/MenuEngineeringScreen.css',
  'features/offline/OfflineQueueScreen.css',
  'features/audit/AuditLogScreen.css',
  'features/design/DesignSystem.css',
  'features/design/TooltipPreview.css',
  'features/locations/MultiStoreDashboardScreen.css',
  'features/locations/TerminalStatusPanel.css',
  'app/AppLayout.css',
  'app/StatusBar.css',
  'app/tablet/tablet.css',
  'components/ContextMenu.css',
  'components/SettingsPopup.css',
  'components/FastPINOverlay.css',
  'components/QrisQrDisplay.css',
  'components/StoreSwitcher.css',
  'components/GatewayStatusBadge.css',
  'components/MachineIdStatus.css',
  'components/ConnectionStatus.css',
  'components/UpdateBanner.css',
  'theme/components.css',
];

/* ── Tests ───────────────────────────────────────────────────── */

describe('Touch target sizing compliance', () => {
  let allViolations: Violation[];

  beforeAll(() => {
    allViolations = [];

    for (const file of CSS_FILES) {
      const fullPath = resolve(UI_SRC, file);
      if (!existsSync(fullPath)) continue;
      const result = scanCSS(fullPath);
      allViolations.push(...result);
    }
  });

  it('all interactive elements meet minimum 44px touch target sizing', () => {
    const message =
      allViolations.length > 0
        ? `Touch target violations found (${allViolations.length}):\n\n${allViolations
            .map(
              (v, i) =>
                `  ${i + 1}. ${v.file}:${v.line}\n     Selector: ${v.selector}\n     Declaration: ${v.declaration}\n     Reason: ${v.reason}`,
            )
            .join('\n\n')}`
        : 'All interactive elements pass 44px touch target sizing';

    expect(allViolations, message).toHaveLength(0);
  });
});
