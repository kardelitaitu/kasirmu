// ── Screen CSS extraction integrity tests ─────────────────────────
//
// Regression guard: for every screen component with companion
// stylesheet(s), we assert that:
//   1. Every className used in the TSX has a CSS rule defined
//   2. No className is duplicated across multiple files
//   3. No dead classes exist (soft warning)
//
// Add a new screen by appending an entry to the SCREENS array below.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractClassSelectors,
  extractUsedClassNames,
} from './screenExtraction.utils';

// ── File layout ───────────────────────────────────────────────────
// This test lives at  ui/src/__tests__/screenExtraction.test.ts
// Screens + CSS live at ui/src/features/*/

const FEATURES_DIR = path.resolve(process.cwd(), 'src', 'features');

interface ScreenEntry {
  /** Display name for the test suite (e.g. "ProductLookupScreen"). */
  name: string;
  /** Path to the TSX file, relative to src/features/. */
  tsx: string;
  /** Path(s) to companion CSS files, relative to src/features/. */
  css: string[];
  /**
   * Class-name prefixes whose BEM‑like modifiers are constructed
   * at runtime via template literals or returned from helper
   * functions.  The static analysis cannot extract the full
   * modifier class names, so these prefixes are excluded from the
   * dead‑class check.
   *
   * Example: `['kds-column--', 'inv-adjust-stock--']`
   * would acknowledge classes like `kds-column--pending` and
   * `inv-adjust-stock--ok` as reachable at runtime even though
   * they never appear verbatim in the TSX source.
   */
  dynamicClassPrefixes?: string[];
  /**
   * Class names that are legitimately referenced in companion CSS
   * but belong to child / imported components rather than the
   * screen's own TSX. These are excluded from the dead‑class check.
   *
   * Example: `['card', 'tab-list']` for a page that uses a <Card>
   * component rendering a `.card` class internally.
   */
  externalClasses?: string[];
  /**
   * String values that the static `extractUsedClassNames` parser
   * falsely extracts as CSS class names because they appear inside
   * template-literal interpolations (e.g. `flashRows.has('backup')`).
   * Unlike `dynamicClassPrefixes` (which handles BEM-like dynamic
   * modifiers), these fragments are NOT real CSS classes — they are
   * function arguments, comparison values, or other string literals
   * that happen to look like class names to the regex parser.
   *
   * Entries here are excluded from the "used but not defined" check.
   */
  knownDynamicFragments?: string[];
  /**
   * Additional TSX files (beyond the primary `tsx` file) to scan for
   * used class names. Useful when a screen's inline JSX has been
   * extracted into sub-components that share the same CSS file.
   *
   * Paths are relative to src/features/, same as `tsx`.
   */
  additionalTsx?: string[];
}

const SCREENS: ScreenEntry[] = [
  // ── Products ──────────────────────────────────────────
  {
    name: 'ProductLookupScreen',
    tsx: 'products/ProductLookupScreen.tsx',
    css: ['products/ProductLookupScreen.css'],
    externalClasses: ['product-card', 'product-card--added', 'product-card--disabled'],
  },
  {
    name: 'ProductManagementScreen',
    tsx: 'products/ProductManagementScreen.tsx',
    css: ['products/ProductManagementScreen.css'],
    dynamicClassPrefixes: ['product-mgmt-type--'],
    // Classes used by child StockAlertPanel component rendered inside drawer
    externalClasses: ['stock-alert-panel', 'product-mgmt-alert-badge'],
  },
  {
    name: 'BundleManagementScreen',
    tsx: 'products/BundleManagementScreen.tsx',
    css: ['products/BundleManagementScreen.css'],
  },

  // ── Staff ─────────────────────────────────────────────
  {
    name: 'StaffManagementScreen',
    tsx: 'staff/StaffManagementScreen.tsx',
    css: ['staff/StaffManagementScreen.css'],
    // The Agent 3 extraction moved the table/drawer/assignment JSX into
    // components/*.tsx; they share the screen's stylesheet (global classes).
    additionalTsx: [
      'staff/components/StaffListTable.tsx',
      'staff/components/StaffDetailDrawer.tsx',
      'staff/components/RoleAssignmentMatrix.tsx',
    ],
  },

  // ── Setup ─────────────────────────────────────────────
  {
    name: 'SetupWizard',
    tsx: 'setup/SetupWizard.tsx',
    css: ['setup/SetupWizard.css'],
  },

  // ── Customers ─────────────────────────────────────────
  {
    name: 'CustomerManagementScreen',
    tsx: 'customers/CustomerManagementScreen.tsx',
    css: ['customers/CustomerManagementScreen.css'],
  },

  // ── Inventory ─────────────────────────────────────────
  {
    name: 'InventoryAdjustmentScreen',
    tsx: 'inventory/InventoryAdjustmentScreen.tsx',
    css: ['inventory/InventoryAdjustmentScreen.css'],
    dynamicClassPrefixes: ['inv-adjust-stock--'],
  },

  // ── Auth ──────────────────────────────────────────────
  {
    name: 'StaffLoginScreen',
    tsx: 'auth/StaffLoginScreen.tsx',
    css: ['auth/StaffLoginScreen.css'],
    dynamicClassPrefixes: ['staff-login-logo', 'staff-login-card'],
    knownDynamicFragments: ['skeleton'],
    // These classes are defined in StaffLoginScreen.css but are used by the
    // StatusBar component (imported and rendered inside StaffLoginScreen).
    externalClasses: [
      'staff-login-connection-group',
      'connection-status',
      'status-indicator',
      'checking',
      'online',
      'offline',
      'connection-label',
      'connection-latency',
    ],
  },

  // ── Audit ─────────────────────────────────────────────
  {
    name: 'AuditLogScreen',
    tsx: 'audit/AuditLogScreen.tsx',
    css: ['audit/AuditLogScreen.css'],
    dynamicClassPrefixes: ['audit-log-badge--'],
  },

  // ── Categories ────────────────────────────────────────
  {
    name: 'CategoryManagementScreen',
    tsx: 'categories/CategoryManagementScreen.tsx',
    css: ['categories/CategoryManagementScreen.css'],
  },

  // ── Currency ──────────────────────────────────────────
  {
    name: 'ExchangeRateScreen',
    tsx: 'currency/ExchangeRateScreen.tsx',
    css: ['currency/ExchangeRateScreen.css'],
  },

  // ── KDS ───────────────────────────────────────────────
  {
    name: 'KdsScreen',
    tsx: 'kds/KdsScreen.tsx',
    css: ['kds/KdsScreen.css', 'kds/KdsCompletedView.css', 'kds/components/ModifierBadge.css'],
    dynamicClassPrefixes: [
      // Static array of complete names in KdsLayoutMasonry.tsx:70.
      'kds-column--',
      // `kds-ticket kds-ticket--${level}` in KdsTicketCard.tsx:271.
      'kds-ticket',
      // Built in AppShell.tsx, outside this screen's own file -- which is why a
      // KdsScreen-scoped search calls this stale and is wrong.
      'kds-workspace',
      // `status status--${order.status}` in KdsTicketCard.tsx:307.
      'status--',
      // `kds-main-track active-${activeTab}` in KdsScreen.tsx:627, resolving to
      // .active-open / .active-completed, both defined. One template literal
      // without this entry produces THREE findings: the fragment `active-` reads
      // as unstyled, and both real rules read as dead.
      'active-',
      // REMOVED, with the orphaned rules they were hiding:
      //   'kds-shortcut-', 'kds-shortcuts-'  -- the shortcuts popover was deleted
      //     from the markup in ccc932c4; nothing in ui/src names either prefix, so
      //     these muted five unreachable rules. A prefix entry suppresses BOTH
      //     directions of the check, so one matching nothing is a permanent mute
      //     over that whole name family.
      //   'kds-history-card-status--' -- 0 CSS rules and 0 references outside
      //     this test file: an entry that outlived the code it excused.
      //   'kds-main-pane--' -- both uses are complete static literals, not
      //     dynamic, so this was the wrong category; and a28edfda added the CSS,
      //     so the classes are genuinely styled and need no exemption.
    ],
    externalClasses: [
      'kds-empty',
      // `document.body.classList.toggle('no-anim', …)` at KdsScreen.tsx:127. A
      // body class is outside the component subtree the parser walks, and seven
      // rules are keyed on it.
      'no-anim',
      // REMOVED: 'leaving' and 'kds-moving' were listed as "defined in another
      // stylesheet", but both were defined in THIS one and applied by nothing --
      // the wrong category used to silence a real finding. `leaving` in
      // particular is a trap: a substring search returns 16 non-test hits, all of
      // them `const [leaving, setLeaving] = useState(false)` in
      // features/sales/PaymentModal.tsx plus prose, none of them a className.
    ],
    knownDynamicFragments: [
      'completed',
      'dark',
      'light',
      // Members of `useState<'all' | 'dinein' | 'takeaway'>` at
      // KdsScreen.tsx:111 -- TypeScript string-literal TYPES, never class names.
      'dinein',
      'takeaway',
      'active-',
      // `kds--${settings.density}` conditional density class.
      'compact',
      // Global screen-reader-only utility (frontend/themes/components.css),
      // outside this screen's scanned stylesheet list.
      'sr-only',
      // Ternary COMPARISON values inside ModifierBadge.tsx's className
      // template (`tone === 'removal' ? ' kds-modifier-badge--removal' : …`).
      // The parser fishes every quoted string out of a className template,
      // so the bare tone names read as class names. Same category as the
      // 'dinein'/'takeaway' entries above: data, not selectors.
      'removal',
      'addition',
    ],
    additionalTsx: [
      'kds/KdsLayoutMasonry.tsx',
      'kds/components/KdsTicketCard.tsx',
      'kds/components/ModifierBadge.tsx',
      'kds/KdsCompletedView.tsx',
      'kds/KdsHamburgerPanel.tsx',
      'kds/KdsScreenFooter.tsx',
      // Slice 1: the four notice banners moved out of KdsScreen.tsx:967-1081.
      // All ten classes they use (kds-error-banner + text/retry/dismiss, and
      // kds-offline-banner with its storage/deadletter variants + text/retry/
      // dismiss) are still styled by kds/KdsScreen.css above, so this entry is
      // what keeps them reachable — without it the guard would call them dead.
      'kds/components/KdsNoticeBanners.tsx',
      'kds/components/KdsHeaderLeft.tsx',
      // Zone-chips slice: the three kds-zone-chip* classes moved out of
      // KdsScreen.tsx:818-847 into components/KdsZoneChips.tsx. They are still
      // styled by kds/KdsScreen.css, which this entry already lists, so this
      // line is what keeps them reachable — drop it and the guard reads all
      // three as dead CSS while every other suite stays green.
      'kds/components/KdsZoneChips.tsx',
    ],
  },
  {
    name: 'ExpoScreen',
    tsx: 'kds/ExpoScreen.tsx',
    css: ['kds/ExpoScreen.css'],
    // The station selector shares the Expo sheet (global classes), same
    // arrangement the StaffManagementScreen/RestaurantMenu entries use.
    additionalTsx: [
      'kds/components/StationSelectorModal.tsx',
    ],
  },
  {
    // Routing-rules editor (todo-kds-agents-1 UI follow-up) — mounted by
    // KdsHamburgerPanel but styled entirely from its own sheet, so the
    // classes are checked against THIS entry, not the KdsScreen one.
    name: 'KdsRoutingRulesEditor',
    tsx: 'kds/components/KdsRoutingRulesEditor.tsx',
    css: ['kds/components/KdsRoutingRulesEditor.css'],
  },

  // ── Loyalty ───────────────────────────────────────────
  {
    name: 'LoyaltyManagementScreen',
    tsx: 'loyalty/LoyaltyManagementScreen.tsx',
    css: ['loyalty/LoyaltyManagementScreen.css'],
    dynamicClassPrefixes: ['loyalty-txn-type--'],
  },

  // ── Offline ───────────────────────────────────────────
  {
    name: 'OfflineQueueScreen',
    tsx: 'offline/OfflineQueueScreen.tsx',
    css: ['offline/OfflineQueueScreen.css'],
    dynamicClassPrefixes: ['status-'],
    knownDynamicFragments: ['free'],
  },

  // ── Promotions ────────────────────────────────────────
  {
    name: 'PromotionManagementScreen',
    tsx: 'promotions/PromotionManagementScreen.tsx',
    css: ['promotions/PromotionManagementScreen.css'],
  },

  // ── Settings ──────────────────────────────────────────
  {
    name: 'SettingsPage',
    tsx: 'settings/SettingsPage.tsx',
    css: ['settings/SettingsPage.css'],
    additionalTsx: [
      'settings/sections/GeneralSection.tsx',
      'settings/sections/AppearanceSection.tsx',
      'settings/sections/ReceiptSection.tsx',
      'settings/sections/SyncSection.tsx',
      'settings/sections/AboutSection.tsx',
      // SettingsFooter.tsx carries the settings-footer-* markup (theme switch,
      // version, Ctrl+S hint, date/clock), moved out of SettingsPage.tsx by the
      // settings lane footer slice; unregistered, the guard reads those six
      // classes as dead CSS.
      'settings/components/SettingsFooter.tsx',
      // SettingsTopbar.tsx carries the settings-topbar-* / settings-save-* markup (back
      // button, breadcrumb, search field, revert+save bar) plus the ContextMenu it
      // now owns; every one is styled by SettingsPage.css, so skipping this
      // registration reads nine of them as dead CSS (the other four are still
      // rendered by the page's loading-skeleton header).
      'settings/components/SettingsTopbar.tsx',
      // SettingsLoadChrome.tsx carries the loading-skeleton shell (the settings-topbar /
      // __col--brand / -icon / -name header mock and settings-loading-card) and the
      // fatal-load settings-error card, moved out of SettingsPage.tsx by the
      // settings lane's load-chrome slice. This registration is load-bearing in
      // the loud direction: with the markup gone from the page, dropping the line
      // fails the dead-class check on settings-loading, settings-loading-card and
      // settings-error (verified: 1 failed | 186 passed, exit 1).
      'settings/components/SettingsLoadChrome.tsx',
    ],
    knownDynamicFragments: [
      // Object-key strings inside template-literal interpolations that
      // the static class-name parser falsely extracts as CSS classes.
      'store-name',
      'address',
      'tax-id',
      'branch',
      'settings-sync-token-actions',
      'settings-sync-status-text',
      'topology',
      'free',
    ],
    externalClasses: [
      'card',
      'tab-list',
      'tooltip-content',
      'feature-toggle',
      'data-mgmt',
      'staff-mgmt',
      'terminal-mgmt',
      'multi-store-dashboard',
      'audit-log',
      'offline-queue-screen',
      'shift-mgmt',
      'tax-config',
      'exchange-rate-config',
      'promo-mgmt',
      'mobile-open',
      'visible',
      'settings-topology-container',
      // Visibility-hidden modifier classes for revert button & save-dot.
      // These are constructed via template-literal class toggling in
      // SettingsPage.tsx, so the static parser can't extract them.
      'settings-btn-revert--hidden',
      'settings-save-dot--hidden',
      // Sync status classes used in SettingsPage.tsx
      'settings-sync-dot--err',
      'settings-sync-expiry-badge--good',
      'settings-sync-expiry-badge--warn',
      'settings-sync-expiry-badge--critical',
    ],
  },
  {
    name: 'DataManagementScreen',
    tsx: 'settings/DataManagementScreen.tsx',
    css: ['settings/DataManagementScreen.css'],
    // BackupSection.tsx carries the data-mgmt-backup-* markup and its flash modifier,
    // moved out of the screen in DataManagement slice 3; unregistered, the guard
    // reads those classes as dead CSS.
    additionalTsx: ['settings/components/BackupSection.tsx'],
    dynamicClassPrefixes: ['data-mgmt-toast--'],
    knownDynamicFragments: [
      // Template-literal parameters inside flashRows.has() that the
      // static class-name parser falsely extracts as class names.
      'import-preview',
      'backup',
    ],
  },
  {
    name: 'FeatureToggleScreen',
    tsx: 'settings/FeatureToggleScreen.tsx',
    css: ['settings/FeatureToggleScreen.css'],
    dynamicClassPrefixes: [
      // Flash + checkmark classes constructed via template literals.
      // 'feature-toggle-item' covers both the base item class and
      // the --flash-enabled/--flash-disabled modifier variants.
      'feature-toggle-item',
      'feature-toggle-checkmark--',
    ],
  },

  // ── Shifts ────────────────────────────────────────────
  {
    name: 'ShiftManagementScreen',
    tsx: 'shifts/ShiftManagementScreen.tsx',
    css: ['shifts/ShiftManagementScreen.css'],
    dynamicClassPrefixes: ['shift-mgmt-status-badge--', 'shift-mgmt-close-info'],
  },

  // ── Locations (moved from stores/ in the Store→Location rename) ──
  {
    name: 'MultiStoreDashboardScreen',
    tsx: 'locations/MultiStoreDashboardScreen.tsx',
    css: ['locations/MultiStoreDashboardScreen.css'],
  },
  {
    name: 'TerminalStatusPanel',
    tsx: 'locations/TerminalStatusPanel.tsx',
    css: ['locations/TerminalStatusPanel.css'],
  },

  // ── Tables ────────────────────────────────────────────
  {
    name: 'TableManagementScreen',
    tsx: 'tables/TableManagementScreen.tsx',
    css: ['tables/TableManagementScreen.css'],
    dynamicClassPrefixes: ['tables-table--'],
  },

  // ── Tax ───────────────────────────────────────────────
  {
    name: 'TaxConfigurationScreen',
    tsx: 'tax/TaxConfigurationScreen.tsx',
    css: ['tax/TaxConfigurationScreen.css'],
  },

  // ── Terminals ─────────────────────────────────────────
  {
    name: 'TerminalManagementScreen',
    tsx: 'terminals/TerminalManagementScreen.tsx',
    css: ['terminals/TerminalManagementScreen.css'],
  },

  // ── Workspaces ────────────────────────────────────────
  {
    name: 'WorkspaceHome',
    tsx: 'workspaces/WorkspaceHome.tsx',
    css: ['workspaces/WorkspaceHome.css'],
    // The ToolCard/ToolsCategoryGrid extraction (agents-2, 09-13): the
    // workspace-tool-* classes moved WITH the JSX into these children —
    // the styles still live in the screen's CSS, so the reachability
    // walk must read the children to see them.
    additionalTsx: [
      'workspaces/components/ToolsCategoryGrid.tsx',
      'workspaces/components/ToolCard.tsx',
    ],
    dynamicClassPrefixes: ['ws-color-', 'role-badge--'],
    externalClasses: [
      'workspace-home-user',
      'workspace-card--active',
      'workspace-card-ripple',
    ],
  },

  // ── Kiosk ─────────────────────────────────────────────
  {
    name: 'KioskScreen',
    tsx: 'kiosk/KioskScreen.tsx',
    css: ['kiosk/KioskScreen.css'],
  },

  // ── Sales (those with a single companion CSS) ─────────
  {
    name: 'SalesDashboardScreen',
    tsx: 'sales/SalesDashboardScreen.tsx',
    css: ['sales/SalesDashboardScreen.css'],
  },
  {
    name: 'SalesHistoryScreen',
    tsx: 'sales/SalesHistoryScreen.tsx',
    css: ['sales/SalesHistoryScreen.css'],
  },
  {
    name: 'VoidOrdersScreen',
    tsx: 'sales/VoidOrdersScreen.tsx',
    css: ['sales/VoidOrdersScreen.css'],
  },
  {
    name: 'EodReportScreen',
    tsx: 'sales/EodReportScreen.tsx',
    css: ['sales/EodReportScreen.css'],
  },
  {
    name: 'RefundModal',
    tsx: 'sales/RefundModal.tsx',
    css: ['sales/RefundModal.css'],
  },
  {
    name: 'PriceOverrideModal',
    tsx: 'sales/PriceOverrideModal.tsx',
    css: ['sales/PriceOverrideModal.css'],
    dynamicClassPrefixes: ['price-override-pin-dot--'],
  },

  // ── Reports ───────────────────────────────────────────
  {
    name: 'DashboardScreen',
    tsx: 'reports/DashboardScreen.tsx',
    css: ['reports/DashboardScreen.css'],
    // `card`/`card-body` belong to the global Card component stylesheet;
    // `dashboard-kpi-delta--` modifiers are built via template literal.
    externalClasses: ['card', 'card-body'],
    dynamicClassPrefixes: ['dashboard-kpi-delta--'],
  },
  {
    name: 'InventoryReportScreen',
    tsx: 'reports/InventoryReportScreen.tsx',
    css: ['reports/InventoryReportScreen.css'],
  },
  {
    name: 'SalesReportScreen',
    tsx: 'reports/SalesReportScreen.tsx',
    css: ['reports/SalesReportScreen.css'],
  },

  // ── Gift Cards ─────────────────────────────────────────
  {
    name: 'GiftCardsScreen',
    tsx: 'gift-cards/GiftCardsScreen.tsx',
    css: ['gift-cards/GiftCardsScreen.css'],
    dynamicClassPrefixes: ['gift-card-status--', 'gift-card-txn-type--'],
    externalClasses: [
      'gift-cards-modal-overlay',
      'gift-cards-modal-overlay--exiting',
      'gift-cards-modal',
      'gift-cards-modal--exiting',
      'gift-cards-modal-title',
      'gift-cards-modal-form',
      'gift-cards-modal-field',
      'gift-cards-modal-label',
      'gift-cards-modal-input',
      'gift-cards-modal-error',
      'gift-cards-modal-actions',
    ],
  },

  // ── Stock Counting ─────────────────────────────────────
  {
    name: 'StockCountsScreen',
    tsx: 'inventory/StockCountsScreen.tsx',
    css: ['inventory/StockCountsScreen.css'],
    dynamicClassPrefixes: ['sc-badge--'],
    externalClasses: ['sc-card-type', 'sc-card-date', 'sc-badge'],
  },
  {
    name: 'StockCountDetail',
    tsx: 'inventory/StockCountDetail.tsx',
    css: ['inventory/StockCountDetail.css'],
    dynamicClassPrefixes: ['sc-badge--', 'sc-add-line-item--', 'sc-diff-'],
    knownDynamicFragments: [
      // String-interpolated fragments in the skeleton table header that
      // the static class-name parser falsely extracts as CSS classes.
      // These are template-literal substrings like 'sc-lines-col-' + suffix.
      'sc-lines-col-',
      'sku',
      'name',
      'expected',
      'counted',
      'diff',
    ],
  },
  {
    name: 'StockCountForm',
    tsx: 'inventory/StockCountForm.tsx',
    css: ['inventory/StockCountForm.css'],
    dynamicClassPrefixes: ['sc-type-btn--'],
  },
  {
    name: 'StockCountHistory',
    tsx: 'inventory/StockCountHistory.tsx',
    css: ['inventory/StockCountHistory.css'],
    dynamicClassPrefixes: ['sc-hist-item--'],
  },

  // ── Stock Transfers ────────────────────────────────────
  {
    name: 'StockTransfersScreen',
    tsx: 'stock-transfers/StockTransfersScreen.tsx',
    css: ['stock-transfers/StockTransfersScreen.css'],
    dynamicClassPrefixes: ['stock-transfers-badge--'],
    externalClasses: ['stock-transfers-detail'],
  },

  // ── Purchasing ─────────────────────────────────────────
  {
    name: 'SuppliersScreen',
    tsx: 'purchasing/SuppliersScreen.tsx',
    css: ['purchasing/SuppliersScreen.css'],
    dynamicClassPrefixes: ['suppliers-badge--'],
  },
  {
    name: 'PurchaseOrdersScreen',
    tsx: 'purchasing/PurchaseOrdersScreen.tsx',
    css: ['purchasing/PurchaseOrdersScreen.css'],
    dynamicClassPrefixes: ['po-status--'],
  },
  {
    name: 'PurchaseOrderForm',
    tsx: 'purchasing/PurchaseOrderForm.tsx',
    css: ['purchasing/PurchaseOrderForm.css'],
  },

  // ── Restaurant ─────────────────────────────────────────
  {
    name: 'RestaurantMenu',
    tsx: 'restaurant/RestaurantMenu.tsx',
    css: ['restaurant/RestaurantMenu.css'],
    dynamicClassPrefixes: ['restaurant-hamburger-item--', 'restaurant-card--'],
    externalClasses: ['restaurant-card', 'restaurant-pill-dot'],
    // The Agent 3 extraction moved the tile/tab-strip/grid/overlay JSX into
    // components/*.tsx; they share the screen's stylesheet (global classes).
    additionalTsx: [
      'restaurant/components/MenuItemTile.tsx',
      'restaurant/components/MenuCategoryTabBar.tsx',
      'restaurant/components/MenuItemGrid.tsx',
      'restaurant/components/MenuItemContextMenu.tsx',
      'restaurant/components/MenuPreferencesMenu.tsx',
      'restaurant/components/MenuSearchBar.tsx',
    ],
    knownDynamicFragments: [
      // Global utility from frontend/themes/components.css (not the screen's
      // own stylesheet) — the menu card's visible "Add" label moved into an
      // sr-only span when the + Add affordance became an SVG glyph.
      'sr-only',
    ],
  },

  // ── Appearance Settings ────────────────────────────────
  {
    name: 'AppearanceSettings',
    tsx: 'settings/AppearanceSettings.tsx',
    css: ['settings/AppearanceSettings.css', 'settings/SettingsPage.css'],
    dynamicClassPrefixes: [
      'settings-',
      'tooltip-content',
      'feature-toggle',
      'data-mgmt',
      'staff-mgmt',
      'terminal-mgmt',
      'multi-store-dashboard',
      'audit-log',
      'offline-queue-screen',
      'shift-mgmt',
      'tax-config',
      'exchange-rate-config',
      'promo-mgmt',
    ],
    knownDynamicFragments: [
      // Card component classes (defined in frontend/themes/components.css)
      // that are used inline in AppearanceSettings.tsx but not present
      // in the screen's own CSS files.
      'card--padding-md',
      'card--shadow-sm',
      'card-header',
    ],
    externalClasses: [
      'card',
      'tab-list',
      'collapsed',
      'mobile-open',
      'visible',
      'section-loading',
    ],
  },

  // ── Settings screen scaffolds (rebuild) ────────────────────
  // Blank placeholders under features/settings/screens/, one file per screen.
  // They share screens-placeholder.css, so each entry lists that single
  // companion sheet. The duplicate-class check is scoped to the css list of
  // one entry, so sharing one stylesheet across entries stays clean.
  // Each scaffold is swapped for the migrated screen during the settings
  // campaign, at which point its entry points at that screen's own sheet.
  {
    name: 'GeneralScreen',
    tsx: 'settings/screens/GeneralScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'LicenseSubscriptionScreen',
    tsx: 'settings/screens/LicenseSubscriptionScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DevicesConnectivityScreen',
    tsx: 'settings/screens/DevicesConnectivityScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'BusinessDefaultsScreen',
    tsx: 'settings/screens/BusinessDefaultsScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'FeaturesModulesScreen',
    tsx: 'settings/screens/FeaturesModulesScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SecurityAccountScreen',
    tsx: 'settings/screens/SecurityAccountScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DataSyncScreen',
    tsx: 'settings/screens/DataSyncScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'DataManagementScreen (placeholder)',
    tsx: 'settings/screens/DataManagementScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SyncStatusScreen',
    tsx: 'settings/screens/SyncStatusScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'OfflineQueueScreen',
    tsx: 'settings/screens/OfflineQueueScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'TaxConfigurationScreen',
    tsx: 'settings/screens/TaxConfigurationScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'ExchangeRatesScreen',
    tsx: 'settings/screens/ExchangeRatesScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
  {
    name: 'SystemDiagnosticsScreen',
    tsx: 'settings/screens/SystemDiagnosticsScreen.tsx',
    css: ['settings/screens/screens-placeholder.css'],
  },
];

// ── Tests ─────────────────────────────────────────────────────────

describe.each(SCREENS)(
  'CSS class integrity — $name',
  ({ name, tsx, css, dynamicClassPrefixes, externalClasses, knownDynamicFragments, additionalTsx }: ScreenEntry) => {
    const tsxPath = path.join(FEATURES_DIR, tsx);
    let tsxContent = fs.readFileSync(tsxPath, 'utf8');

    // Also scan additional TSX files (e.g. extracted section components)
    if (additionalTsx) {
      for (const extraTsx of additionalTsx) {
        const extraPath = path.join(FEATURES_DIR, extraTsx);
        tsxContent += fs.readFileSync(extraPath, 'utf8');
      }
    }

    const used = extractUsedClassNames(tsxContent);

    // Build reverse map: className -> [file1, file2, ...]
    const fileIndex = new Map<string, string[]>();

    // Track unique files to avoid counting the same path twice
    // when the same class appears in the same file via compound selectors.
    const cssPaths = css.map((c) => path.join(FEATURES_DIR, c));

    for (const cssPath of cssPaths) {
      const content = fs.readFileSync(cssPath, 'utf8');
      for (const cls of extractClassSelectors(content)) {
        if (!fileIndex.has(cls)) {
          fileIndex.set(cls, []);
        }
        fileIndex.get(cls)!.push(cssPath);
      }
    }

    it(`every className used in ${name} has a CSS rule defined`, () => {
      const fragments = new Set(knownDynamicFragments ?? []);
      const missing: string[] = [];
      for (const cls of used) {
        if (!fileIndex.has(cls) && !fragments.has(cls)) {
          missing.push(cls);
        }
      }
      expect(
        missing,
        `${name}: className(s) used but not defined: ${missing.join(', ')}`,
      ).toEqual([]);
    });

    it(`no className is defined in more than one CSS file for ${name}`, () => {
      const duplicates: string[] = [];
      for (const [cls, files] of fileIndex) {
        // Only flag if the class appears in multiple unique files
        const uniqueFiles = [...new Set(files)];
        if (uniqueFiles.length > 1 && used.has(cls)) {
          duplicates.push(
            `${cls} -> ${uniqueFiles.map((f) => path.basename(f)).join(', ')}`,
          );
        }
      }
      expect(
        duplicates,
        `${name}: className(s) duplicated across files:\n${duplicates.join('\n')}`,
      ).toEqual([]);
    });

    it(`every className defined in CSS is reachable from ${name} (no dead classes)`, () => {
      const prefixes = dynamicClassPrefixes ?? [];
      const external = new Set(externalClasses ?? []);
      const dead: string[] = [];
      for (const [cls] of fileIndex) {
        if (!used.has(cls) && !external.has(cls) && !prefixes.some((p) => cls.startsWith(p))) {
          dead.push(cls);
        }
      }
      // Soft assertion — logs a warning rather than hard-failing,
      // because some classes may be shared with other components.
      if (dead.length > 0) {
        console.warn(
          `[WARN] ${name}: className(s) defined in CSS but never referenced ` +
            `(consider removing if unused elsewhere):\n  ${dead.join('\n  ')}`,
        );
        expect.soft(dead, `Dead classes: ${dead.join(', ')}`).toEqual([]);
      }
    });
  },
);

// ── The extractor itself ─────────────────────────────────────────
//
// Everything above tests the SCREENS against the extractor, so a bug in the extractor
// shows up as a false finding about a screen rather than as a failure here. That is how
// the interpolation strip went unnoticed: `body.replace(/\$\{[^}]*\}/g, '')` stopped at
// the first `}` even when that brace belonged to something nested, and KdsHamburgerPanel
// :415 embeds `/^#[0-9a-f]{6}$/i` -- a quantifier brace -- inside `${...}`. The residue
// glued itself to the preceding class name, so `kds-hex-input` was reported DEAD while
// genuinely in use. These cases pin the behaviour directly, so a future regression fails
// here with a message about the extractor instead of a misleading one about a screen.

describe('extractUsedClassNames', () => {
  it('reads a plain static className', () => {
    expect(extractUsedClassNames('<div className="a b" />')).toEqual(new Set(['a', 'b']));
  });

  it('keeps the base class when an interpolation contains a regex quantifier', () => {
    // The exact shape from KdsHamburgerPanel.tsx:415.
    const src = 'className={`kds-hex-input${hexDraft?.key === key && !/^#[0-9a-f]{6}$/i.test(hexDraft.value) ? \' kds-hex-input--invalid\' : \'\'}`}';
    const got = extractUsedClassNames(src);
    expect(got.has('kds-hex-input')).toBe(true);
    expect(got.has('kds-hex-input--invalid')).toBe(true);
    // The failure mode was residue, so assert the absence explicitly rather than only
    // that "something" was found.
    expect([...got].some((c) => c.includes('0-9a-f'))).toBe(false);
  });

  it('keeps the base class through nested braces and template-in-interpolation', () => {
    const src = 'className={`pos-cart-line-wrap${items.map((i) => ` col-${i.n}`)} x`}';
    const got = extractUsedClassNames(src);
    expect(got.has('pos-cart-line-wrap')).toBe(true);
    expect(got.has('x')).toBe(true);
  });

  it('handles an interpolation that ends the template', () => {
    const got = extractUsedClassNames('className={`a${cond}`}');
    expect(got.has('a')).toBe(true);
  });
});
