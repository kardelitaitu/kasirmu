import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const UI_SRC = resolve(__dirname, '..');

/**
 * Denominator for this gate. Unit: individual selectors after comma-splitting, except
 * skipGroups/skipSelectors, which are counted where the check actually sits.
 */
const S = { sheets: 0, interactive: 0, waivedExact: 0, waivedBoundary: 0, skipGroups: 0, skipSelectors: 0 };
const SKIP_FIRES = new Map<RegExp, number>();

interface Violation {
  file: string;
  selector: string;
  reason: string;
}

const INTERACTIVE_SELECTORS = [
  /^\s*\.btn\b/, /^\s*button(?:\s|\.|#|\[|$)/, /^\s*\.btn-/,
  /^\s*\[role="button"\]/, /^\s*\[role="tab"\]/, /^\s*\[role="switch"\]/,
  /^\s*\[role="radio"\]/, /^\s*\.modal-close/, /^\s*\.theme-toggle/,
  /^\s*\.action-btn/, /^\s*\.nav-item/, /^\s*\.filter-btn/,
  /^\s*\.clickable/, /^\s*\.card-clickable/, /^\s*\.select/,
  /^\s*input(?:\s|\.|#|\[|$)/, /^\s*select(?:\s|\.|#|\[|$)/,
  /^\s*textarea(?:\s|\.|#|\[|$)/, /^\s*\.toggle-/,
];

function isInteractiveSelector(selector: string): boolean {
  return INTERACTIVE_SELECTORS.some((re) => re.test(selector));
}

/** Check if selector or body references :focus-visible. */
function hasFocusVisibleRef(selectors: string, body: string): boolean {
  return /:focus-visible/.test(body) || /:focus-visible/.test(selectors);
}

/** Known non-interactive classes or visual children to skip. */
const SKIP_PATTERNS = [
  /^\s*\.skeleton/, /^\s*\.spinner/, /^\s*\.badge/, /^\s*\.toast/,
  /^\s*\.statusbar-dot/, /^\s*\.statusbar-divider/,
  /^\s*\.setup-step-dot/, /^\s*\.setup-step-line/,
  /^\s*\.confirm-dialog-icon/, /^\s*\.empty-state/, /^\s*\.error-state/,
  /^\s*\.payment-done/, /^\s*\.payment-done-/,
  /::before|::after/, /:disabled/, /:hover/, /:active/,
  /@keyframes/, /--exiting/, /--enter/,
  /^\s*\.modal-overlay/, /^\s*\.card-header/, /^\s*\.card-body/, /^\s*\.card-footer/,
  /^\s*\.modal-header/, /^\s*\.modal-body/, /^\s*\.modal-footer/,
  // Visual toggle parts — not interactive themselves
  /^\s*\.toggle-track/, /^\s*\.toggle-thumb/,
  /^\s*\.toggle-switch\s+input/,
  // SVG/icon children inside interactive parents
  /\s+svg$/, /\s+\.icon/, /\s+img$/,
  // Pseudo selectors that re-style on state
  /:checked/, /:focus-visible/,
];

function isSkipSelector(selector: string): boolean {
  const fired = SKIP_PATTERNS.find((re) => re.test(selector));
  if (fired) SKIP_FIRES.set(fired, (SKIP_FIRES.get(fired) ?? 0) + 1);
  return fired !== undefined;
}

/** Check if a CSS body declares focus-visible with a visible indicator. */
function hasVisibleFocusIndicator(selectors: string, body: string): boolean {
  const focusSections = body.match(/&?:focus-visible\s*\{[^}]*\}/g) || [];
  for (const section of focusSections) {
    if (/outline\s*:/.test(section) || /box-shadow\s*:/.test(section)) return true;
  }
  const standaloneFocus = body.match(/:focus-visible\s*\{[^}]*\}/);
  if (standaloneFocus) {
    const block = standaloneFocus[0]!;
    return /outline\s*:/.test(block) || /box-shadow\s*:/.test(block);
  }
  // If :focus-visible is in the selector (e.g. ".btn:focus-visible { outline: ... }"),
  // check the body for the visible indicator
  if (/:focus-visible/.test(selectors)) {
    return /outline\s*:/.test(body) || /box-shadow\s*:/.test(body);
  }
  return false;
}

/**
 * Base component selectors from components.css that already have
 * :focus-visible styles. Screen-specific files that use these
 * base classes inherit the focus styles.
 */
const GLOBAL_COVERED = new Set([
  '.btn', '.btn--sm', '.btn--md', '.btn--lg',
  '.btn--primary', '.btn--secondary', '.btn--danger', '.btn--ghost',
  '.input-field', '.input-wrapper', '.input-label',
  '.card', '.card-clickable',
  '.skeleton', '.spinner', '.badge',
  '.modal-overlay', '.modal-panel', '.modal-close-btn',
  '.toast', '.toast__dismiss',
  '.empty-state', '.error-state',
  '.theme-toggle',
  // Toggle switch — focus-visible is on the child input: .toggle-switch input:focus-visible + .toggle-track
  '.toggle-switch',
]);

function scanCSS(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf-8');
  const violations: Violation[] = [];
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = stripped.match(/[^{}]*\{[^{}]*\}/g) || [];

  // Track which interactive selectors already have :focus-visible in this file
  const covered = new Set(GLOBAL_COVERED);

  // First pass: find all :focus-visible rules and track covered selectors
  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    if (selectors.startsWith('@')) continue;

    if (hasFocusVisibleRef(selectors, body) && hasVisibleFocusIndicator(selectors, body)) {
      const baseSelector = selectors
        .replace(/:focus-visible\s*$/, '')
        .replace(/:focus-visible/, '')
        .replace(/^&/, '')
        .trim();
      if (baseSelector) covered.add(baseSelector);
    }
  }

  /**
   * Split a comma-separated CSS selector group into individual selectors.
   */
  function splitSelectors(selGroup: string): string[] {
    return selGroup
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Check if an individual selector is covered by an existing :focus-visible rule. */
  function selectorIsCovered(sel: string): boolean {
    if (covered.has(sel)) { S.waivedExact++; return true; }
    // A waiver must name the selector it waives. A covered base legitimately
    // reaches a compound (.btn:focus), a descendant (.btn .x) or a sibling of it,
    // but it must NOT reach a longer name that merely begins with it: GLOBAL_COVERED
    // seeds the bare '.btn', '.card', '.modal-panel' and '.toast', so the raw
    // startsWith this line carried waived every .btn-* class in the tree whether or
    // not it had a focus style. Exact-or-boundary is the convention this repo already
    // chose at scripts/verify-ftl-orphans.py:237, n == p or n.startswith(p + "-").
    const boundary = [...covered].some(
      (base) => sel === base || /^[ >+~:.#[,]/.test(sel.slice(base.length)),
    );
    if (boundary) S.waivedBoundary++;
    return boundary;
  }

  // Second pass: find interactive selectors that DON'T have :focus-visible
  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selectors = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1).trim();

    if (selectors.startsWith('@')) continue;
    if (isSkipSelector(selectors)) {
      S.skipGroups++;
      S.skipSelectors += splitSelectors(selectors).length;
      continue;
    }
    if (!isInteractiveSelector(selectors)) continue;

    // Split comma-separated groups and check each selector individually
    const individualSelectors = splitSelectors(selectors);
    S.interactive += individualSelectors.length;
    const uncoveredSelectors = individualSelectors.filter(
      (sel) => !selectorIsCovered(sel),
    );

    if (uncoveredSelectors.length === 0) {
      // All selectors in this group are covered — count as covered
      covered.add(selectors);
      continue;
    }

    // Check the full rule for inline :focus-visible
    if (hasFocusVisibleRef(selectors, body) && hasVisibleFocusIndicator(selectors, body)) {
      covered.add(selectors);
      continue;
    }

    for (const uncovered of uncoveredSelectors) {
      violations.push({
        file: filePath,
        selector: uncovered,
        reason: 'Interactive element missing :focus-visible style with visible indicator',
      });
    }
  }

  return violations;
}

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
  'features/setup/SetupWizard.css',
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
  'frontend/shell/AppLayout.css',
  'frontend/shell/StatusBar.css',
  'frontend/shell/tablet/tablet.css',
  'frontend/shared/ContextMenu.css',
  'frontend/shared/SettingsPopup.css',
  'components/FastPINOverlay.css',
  'components/QrisQrDisplay.css',
  'components/StoreSwitcher.css',
  'components/GatewayStatusBadge.css',
  'components/MachineIdStatus.css',
  'components/ConnectionStatus.css',
  'components/UpdateBanner.css',
  'frontend/themes/components.css',
];

describe('Focus-visible compliance', () => {
  // The walk runs at collection, not in a hook, because a case TITLE can carry its
  // own denominator only if the harvest already happened when the title was built
  // — the convention popupBackgroundCompliance and noiseDitherCompliance use.
  // Nothing about the walk itself changed.
  const allViolations: Violation[] = [];
  for (const file of CSS_FILES) {
    const fullPath = resolve(UI_SRC, file);
    if (!existsSync(fullPath)) continue;
    S.sheets++;
    allViolations.push(...scanCSS(fullPath));
  }

  it(`focus-visible denominator: ${S.interactive - S.waivedExact - S.waivedBoundary} interactive selectors graded, ${S.waivedExact + S.waivedBoundary} waived by a covered name (${S.waivedExact} by exact name, ${S.waivedBoundary} by the compound/descendant boundary), ${S.skipSelectors} more inside ${S.skipGroups} rule-groups a skip pattern named, over ${S.sheets} of ${CSS_FILES.length} listed sheets, ${allViolations.length} violations`, () => {
    for (const [pat, cnt] of [...SKIP_FIRES.entries()].sort((x, y) => y[1] - x[1])) {
      console.log('  skip waiver ' + String(pat) + '  fires ' + cnt + ' rule-group(s)');
    }
    // Magnitude floors, set with headroom below the value each was measured from
    // on 2026-09-15 (interactive 23, graded 3, sheets 70 of 70), so a widening of
    // either waiver reads red instead of quietly shrinking the population.
    //
    // THE GRADED FLOOR IS NOW 0, AND THAT IS A FINDING, NOT A LOOSENING. It
    // shipped at 1 an hour ago; 766fed704 then cured all three violations and the
    // count fell to 0, so the guard turned redder on the commit that paid the debt.
    // A floor on REMAINING DEBT demands that somebody stay in debt — the mirror
    // image of laundering a finding into a baseline, where the debt is hidden to
    // buy a green instead of preserved to buy a red — and a guard shaped like that
    // gets deleted wholesale the first time a lane cures what it names and gives up
    // arguing. Population and membership are different guards, the distinction
    // 402b11660 earned for popupBackgroundCompliance, so the weight here sits on the
    // two floors beside it — S.interactive >= 15 and S.sheets >= 60 — neither of
    // which cares whether anyone is currently in breach. This assertion is therefore
    // a bound that cannot fail, kept on purpose because its message is the line a
    // failing run prints first, and the graded count is where a cured selector goes
    // to stop being a violation: 0 here means the sheet is clean, not that the gate
    // stopped looking.
    expect(
      S.interactive,
      `interactive selectors reaching the covered check: ${S.interactive}, floor 15 (baseline 23 on 2026-09-15)`,
    ).toBeGreaterThanOrEqual(15);
    expect(
      S.interactive - S.waivedExact - S.waivedBoundary,
      `interactive selectors actually graded: ${S.interactive - S.waivedExact - S.waivedBoundary}, floor 0 (3 on 2026-09-15 while the waiver was a raw prefix, 0 after 766fed704 cured them)`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      S.sheets,
      `sheets walked: ${S.sheets} of ${CSS_FILES.length}, floor 60`,
    ).toBeGreaterThanOrEqual(60);
  });

  it('all interactive elements have :focus-visible styles with visible indicators', () => {
    const message =
      allViolations.length > 0
        ? `Focus-visible violations found (${allViolations.length}):\n\n${allViolations
            .map(
              (v, i) =>
                `  ${i + 1}. ${v.file}\n     Selector: ${v.selector}\n     Reason: ${v.reason}`,
            )
            .join('\n\n')}`
        : 'All interactive elements pass focus-visible compliance';

    expect(allViolations, message).toHaveLength(0);
  });

  it('reset.css properly disables outline on bare mouse focus via :focus:not(:focus-visible)', () => {
    const resetPath = resolve(UI_SRC, 'frontend/themes/reset.css');
    const css = readFileSync(resetPath, 'utf-8');
    expect(css).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;?\s*\}/);
  });

  it('KdsScreen.css does not assign visible outline to bare .kds-filter-option:focus', () => {
    const kdsPath = resolve(UI_SRC, 'features/kds/KdsScreen.css');
    const css = readFileSync(kdsPath, 'utf-8');
    expect(css).not.toMatch(/\.kds-filter-option:focus\s*\{[^}]*outline:\s*2px/);
    expect(css).toMatch(/\.kds-filter-option:focus-visible\s*\{[^}]*outline:\s*2px/);
  });
});
