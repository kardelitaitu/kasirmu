// ── Screen CSS extraction integrity tests ─────────────────────────
//
// SCOPE — read this before quoting a green run. This is a
// REGISTRATION guard over an explicit list, NOT a sweep of the tree.
// Each of the three checks below runs once per entry in the SCREENS
// array and reads only the files THAT ENTRY names: `tsx` plus
// `additionalTsx` for the used-class walk, `css` for the
// defined-rule walk. There is no readdir, no glob, no default entry.
// A screen that is not registered here is invisible to all three
// checks — it cannot fail, so it cannot be counted as clean.
//
// One case breaks that rule, deliberately: `stylesheet coverage` near the
// foot of this file DOES readdir, and its whole question is "did anyone
// claim this sheet?" — it walks the tree only to ask whether a path is
// named, never what any class in it means. Every assertion ABOUT a class
// still reads only the files an entry names.
//
// The same limit is stated in the plan this file serves, at
// todo-refactor-kds-agents-merged.md:121, and the contrast it draws
// there is the one a reader needs next to the mechanism:
//
//   `screenExtraction.test.ts` is a **REGISTRATION** guard — it checks
//   only the files a screen's `additionalTsx` list names. Skip the
//   step and it says NOTHING: the moved classes read as dead CSS while
//   the suite stays green. **SILENT failure mode**; the bullet above it
//   exists because of this one.
//   `nativeTooltipCompliance.test.ts` is an **AUTO-WALKING** guard —
//   `collectTsxFiles` at :47 sweeps every `.tsx` under `ui/src`, with
//   `__tests__` filtered at the call site (`:115`), so there is **no
//   registration step to forget**. A new file is caught on sight and
//   the run goes **LOUD** the moment markup moves. **The opposite
//   failure mode: it cannot be skipped, only answered.**
//
// Measured against this file, not against that sentence: SCREENS holds
// 61 entries while `find ui/src/features -name '*Screen.tsx' | wc -l`
// counts 66 *Screen.tsx files — and the two numbers are not even the
// same kind of thing, since several entries are modals, panels and
// shared placeholder sheets rather than screens. A large share of the
// tree is therefore read by none of the three checks. The cleanest
// statement of what that costs is the one this header used to be
// missing: **none of this guard's three checks — including "every
// className used has a CSS rule", and including the dead-class check —
// ever reads the sales tender surface.** sales/PaymentModal.tsx
// (1,912 lines) over sales/PaymentModal.css (1,165 lines) is the
// largest instance today; the note in the Sales section below records
// why that entry is pending rather than registered.
//
// CASE ARITHMETIC, so the total is never read as code health: every
// entry contributes exactly 3 cases, the extractor self-tests at the foot
// of this file contribute 4 more, and stylesheet coverage adds 1 —
// 3 x entries + 4 + 1. That is 188 today (61 x 3 + 4 + 1). The number
// moves when the LIST moves and never when the tree's CSS health changes:
// a registration adds three green cases whether or not anything got
// better. Read the entry count for coverage and the failures for health.
// Coverage case +1 is the sole exception, and it is fixed: it is ONE case
// over the whole tree, so an unregistered stylesheet makes it RED, never
// MORE CASES — the total stops being a health signal in exactly one
// direction and starts carrying a named failure in the other.
//
// For each REGISTERED entry we assert:
//   1. Every className used in its TSX has a CSS rule defined  (HARD)
//   2. No className is duplicated across its CSS files         (HARD)
//   3. No dead classes (CSS rule with no reference in the walked
//      TSX) — reported via `expect.soft`, and soft is soft in NAME
//      only: a soft failure still fails the run.
//
// Add a new screen by appending an entry to the SCREENS array below;
// when markup moves OUT of a registered screen, append the receiving
// component to that entry's `additionalTsx` in the same change-set and
// prove the line is load-bearing by deleting it and re-running (see
// todo-refactor-kds-agents-merged.md:115).

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
   * Shared "parent" stylesheets this entry INHERITS from but does not own
   * — a sheet a whole family of entries cites, e.g. the settings scaffolds'
   * `screens/screens-placeholder.css`.
   *
   * The two directions are deliberately NOT symmetric: the used-vs-defined
   * check resolves against `css` UNION `parentCss`, while the duplicate check
   * and the dead-class check keep walking `css` ALONE. Why, at the two maps
   * in the runner below.
   *
   * Paths are relative to src/features/, same as `css`.
   */
  parentCss?: string[];
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
      'kds/components/KdsHeaderRight.tsx',
      'kds/components/KdsHeaderTabs.tsx',
      'kds/components/KdsMainContent.tsx',
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
    additionalTsx: ['settings/components/BackupSection.tsx', 'settings/components/ImportSection.tsx', 'settings/components/ExportSection.tsx'],
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
  // PaymentModal is deliberately NOT registered yet, and this is the
  // note that keeps that gap from being silent. Its companion sheet
  // (sales/PaymentModal.css, 1,165 lines) and its 1,912-line TSX are
  // read by NO check in this file, which is precisely the blind spot the
  // header describes. Attempting the entry — tsx + css + the four
  // extracted tender panels (payment/CashTenderPanel, CardTenderPanel,
  // QrisTenderPanel, SplitTenderRows) — produced two findings, and
  // neither is a runtime-composed modifier that dynamicClassPrefixes
  // may excuse:
  //   1. HARD, case "every className used in PaymentModal has a CSS rule
  //      defined": payment-method-name (PaymentModal.tsx:1544,:1581),
  //      payment-qris-upgrade (payment/QrisTenderPanel.tsx:57) and
  //      payment-qris-btn--dynamic (same file,:90) are static
  //      classNames with NO rule in any .css in the repo (verified:
  //      git grep '\\.(payment-method-name|payment-qris-upgrade|payment-qris-btn--dynamic)'
  //      over ui/src returns 0 css hits). Unstyled markup, not parser
  //      blindness — and dynamicClassPrefixes cannot reach this check
  //      anyway, since a prefix only suppresses the dead-class walk.
  //   2. SOFT-BUT-FAILING, case "every className defined in CSS is
  //      reachable from PaymentModal": the twelve payment-loyalty-*
  //      rules. These are NOT debt: payment/LoyaltyTenderPanel.tsx
  //      renders them (mounted at PaymentModal.tsx:36,:1703 since
  //      6ddf49f1e). They are the rule at
  //      todo-refactor-kds-agents-merged.md:115 firing exactly as
  //      designed — markup left the screen, the extraction did not
  //      append its new file to this list, so ten-plus live classes
  //      read as dead CSS.
  // So the entry needs one of two out-of-fence changes first: three new
  // rules in PaymentModal.css (or the three classNames dropped), and
  // LoyaltyTenderPanel.tsx added to additionalTsx alongside the other
  // four. The four animation classes the pass was scoped around
  // (payment-overlay--enter/--exit, payment-modal--enter/--exit) ARE
  // runtime-composed — PaymentModal.tsx:1150-1151 selects each by
  // ternary into a local and interpolates the LOCAL, which
  // extractUsedClassNames strips — and would be excused by the two
  // prefixes 'payment-overlay--' and 'payment-modal--', each of which
  // covers exactly the enter/exit pair and nothing else
  // (PaymentModal.css:17,:21,:49,:53). Registering them is the next
  // pass's job; swallowing 1 and 2 to get green is not.
  //
  // THE OWNERSHIP IS TWO-STEP AND NEITHER STEP IS INSIDE A TEST FILE.
  // Step 1, sales lane: give the three classNames above a rule in
  // PaymentModal.css, or delete them from the markup — a real
  // used-but-undefined class is unstyled markup, and only the owner of
  // the sheet can say which of the two it wants. Step 2, whoever lands
  // step 1: add the entry above with the two prefixes, plus
  // payment/LoyaltyTenderPanel.tsx in `additionalTsx` beside the other
  // four panels. Verification each time is `npx vitest run
  // src/__tests__/screenExtraction.test.ts`: 3 cases per entry, so the
  // run should read 190, and both PaymentModal cases must pass without
  // any prefix added beyond the two named above.
  //
  // THREE OTHER CANDIDATES WERE MEASURED ON THIS PASS AND NONE OF THEM
  // LANDS EITHER, each for a different reason worth keeping straight:
  //   - memo/MemosScreen.tsx — REACHABLE (memo/register.tsx:5 lazy
  //     import, registerPage route 'memos' + registerNavItem, wired by
  //     features/index.ts:27,:103). Its 4 raw dead classes are the
  //     runtime-composed `memos-badge--draft/published/stopped/muted`
  //     family and one prefix 'memos-badge--' clears all four; but
  //     registering it then fails case 1 with two genuine findings,
  //     `memos-form` and `memos-field` (MemosScreen.tsx:315,:319), for
  //     which no .css in the repo defines a rule. Verified by a live
  //     run, not by probe: 1 failed | 189 passed (190), "MemosScreen:
  //     className(s) used but not defined: memos-form, memos-field".
  //   - sales/PosScreen.tsx — REACHABLE, but its markup already lives in
  //     eight sales/components/*.tsx and its classes in six CartPanel*.
  //     css sheets it imports at :46-52. Registered as a single-screen
  //     entry it reports 55 dead + 1 undefined; given all eight
  //     components and all six sheets it still reports 34 undefined
  //     `modifier-*` classes owned by components/ItemModifierModal.css.
  //     That is a scoping pass, not a registration.
  //   - inventory/TransactionLogScreen.tsx — NOT REACHABLE: the only
  //     importers are in __tests__ (inventory/register.tsx mounts
  //     InventoryAdjustmentScreen and StockCountsFlow, never this; no
  //     route names it). Registering it would have bought a green over
  //     markup no user can reach, which is a worse outcome than the
  //     blind spot it closes. It stays out until someone shows the
  //     mount.

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

  // ── Settings cards ─────────────────────────────────────────
  // Four real settings surfaces (1,486 lines of markup between them) that
  // grew under settings/screens/ while the scaffolds below stayed blank.
  // Each owns its own sheet and borrows exactly ONE name from the settings
  // scaffold — settings-section-title, defined only at
  // settings/SettingsPage.css:514 — which is what parentCss is for: case 1
  // resolves it through css UNION parentCss, while cases 2 and 3 keep
  // walking the card's own sheet alone. Listing SettingsPage.css in css:
  // instead would grade its whole class inventory against one card and make
  // the entry unsatisfiable, the way the 13 placeholder entries are not.
  // Every one of these four paths was removed from BASELINE_UNCITED as it
  // was cited here: the array went 54 -> 50, four lines, one per entry.
  {
    name: 'ReceiptFormatSettingsCard',
    tsx: 'settings/screens/ReceiptFormatSettingsCard.tsx',
    css: ['settings/screens/ReceiptFormatSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 13 classes, audited clean at 9836cf960: fiscalnum-overview-title keeps
    // living as an id=/aria-labelledby= pair (StatutoryNumberingCard.tsx:345,
    // :347), not as a className token, and fiscalnum-error is rendered by the
    // card's own markup as well as asserted by the SettingsPage.test marker
    // list — so this entry grades both without any exemption.
    name: 'StatutoryNumberingCard',
    tsx: 'settings/screens/StatutoryNumberingCard.tsx',
    css: ['settings/screens/StatutoryNumberingCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 12 classes, audited at zero orphans; regional-settings-empty is both the
    // card's rendered empty state and a SettingsPage.test.tsx marker, and the
    // markup carries no className={{ expression for the parser to trip over.
    name: 'RegionalSettingsCard',
    tsx: 'settings/screens/RegionalSettingsCard.tsx',
    css: ['settings/screens/RegionalSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
  },
  {
    // 19 classes, audited at zero orphans, and the largest of the four by
    // borrowed-name risk: settings-section-title at :165 is the only name in
    // its markup that its own sheet does not define.
    name: 'LocalPaymentSettingsCard',
    tsx: 'settings/screens/LocalPaymentSettingsCard.tsx',
    css: ['settings/screens/LocalPaymentSettingsCard.css'],
    parentCss: ['settings/SettingsPage.css'],
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
  ({ name, tsx, css, parentCss, dynamicClassPrefixes, externalClasses, knownDynamicFragments, additionalTsx }: ScreenEntry) => {
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

    // ── Two reverse maps (className -> [file, ...]), split by DIRECTION ──
    //
    // The asymmetry IS the mechanism, so it gets stated rather than guessed:
    //
    //   case 1 (used -> defined)  walks own css UNION parentCss
    //   cases 2 and 3            walk own css ONLY
    //
    // Case 1 asks "can this class resolve at all?", and a shared parent sheet
    // really does provide it to this screen, so resolving short of the parent
    // would invent a missing-class failure for markup that renders fine.
    //
    // Cases 2 and 3 ask "is THIS ENTRY's sheet honest?", and answering them
    // over a union breaks. Grading case 3 (dead classes) against the union is
    // precisely what makes a shared sheet unsatisfiable: a parent's classes
    // are consumed across the whole family of children, never necessarily by
    // one of them, so every child would report the siblings' classes dead.
    // The mirror is measured, not hypothetical — screens-placeholder.css is
    // cited by 13 entries and all 13 screens use all 3 of its classes, which
    // is why those 13 case-3 bodies are provably empty today: scoped to the
    // citing entry's own css, that sheet has nothing left to call dead.
    // Scoping is also what keeps case 2 meaningful — see the note above the
    // scaffold entries.
    const ownIndex = new Map<string, string[]>();
    const definedIndex = new Map<string, string[]>();

    // Track unique files to avoid counting the same path twice
    // when the same class appears in the same file via compound selectors.
    const cssPaths = css.map((c) => path.join(FEATURES_DIR, c));
    const parentPaths = (parentCss ?? []).map((c) => path.join(FEATURES_DIR, c));

    const index = (target: Map<string, string[]>, cssPath: string) => {
      for (const cls of extractClassSelectors(fs.readFileSync(cssPath, 'utf8'))) {
        if (!target.has(cls)) {
          target.set(cls, []);
        }
        target.get(cls)!.push(cssPath);
      }
    };
    for (const cssPath of cssPaths) {
      index(ownIndex, cssPath);
      index(definedIndex, cssPath);
    }
    for (const cssPath of parentPaths) {
      index(definedIndex, cssPath);
    }

    it(`every className used in ${name} has a CSS rule defined`, () => {
      const fragments = new Set(knownDynamicFragments ?? []);
      const missing: string[] = [];
      for (const cls of used) {
        // Resolves against own css UNION parentCss — see the two maps above.
        if (!definedIndex.has(cls) && !fragments.has(cls)) {
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
      // Own css ONLY: a parent sheet is shared, so a duplicate inside it is
      // the parent's owner's finding, not this entry's.
      for (const [cls, files] of ownIndex) {
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
      // Own css ONLY — grading this over the union would make every shared
      // parent sheet unsatisfiable. See the two maps above.
      for (const [cls] of ownIndex) {
        if (!used.has(cls) && !external.has(cls) && !prefixes.some((p) => cls.startsWith(p))) {
          dead.push(cls);
        }
      }
      // Soft in NAME only. `expect.soft` does NOT "log a warning
      // rather than hard-fail" — it records a real failed assertion and
      // the run exits non-zero, so a dead class here fails the suite as
      // surely as cases 1 and 2 do. What soft actually buys is
      // sequencing: it lets this case report every dead class (and lets
      // the other two cases in this entry still run) instead of
      // aborting the file on the first one. The `console.warn` below is
      // the informative half; this line is the gate. Do not read the
      // word "soft", or that warn, as "advisory".
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


// ── Stylesheet coverage ──────────────────────────────────────────
//
// The three per-entry cases above only read what an entry NAMES, so the
// guard cannot see a stylesheet nobody cited. This one case auto-walks
// src/features/**/*.css and asks the single whole-tree question a
// registration guard can answer honestly: is every sheet claimed?
//
// BASELINE_UNCITED is a BASELINE, not a MUTE, and the difference is the
// whole point. `knownDynamicFragments` excuses a FINDING — the extractor
// read real markup on a registered screen and produced a claim about it,
// and this list says that claim is wrong. A path here postpones a CLAIM
// about a file nobody has read yet: nothing in it is asserted false, and
// every one of its 54 entries is a named path, not a prefix, not a
// pattern, not a directory. So the array can only shrink — registering a
// sheet (slice 2) or deleting one removes a line; nothing adds one except
// a new stylesheet that has not been read. A stale line that is now cited
// is inert, and deleting it is the courtesy, not the requirement.
//
// Why a baseline instead of asserting the whole tree today: the repo
// already chose this shape for the same problem. `verify-ftl-orphans.py`
// runs `--staged-only` as a HARD gate and `--census` as informational,
// because a whole-tree blocker is unusable — 93 honest candidates, of
// which an unknown fraction are detection gaps, means the first red run
// gets the gate disabled rather than the debt paid. Same here: blocking
// on 54 unread sheets would buy nothing, so the 54 are frozen, named, and
// every NEW sheet fails loud with its own filename.
const BASELINE_UNCITED: string[] = [
  'analytics/AnalyticsScreen.css',
  'auth/CreatePinScreen.css',
  'auth/LicenseActivationScreen.css',
  'auth/SessionLockScreen.css',
  'design/DesignSystem.css',
  'design/DevToolbar.css',
  'design/TooltipPreview.css',
  'design/brand-tokens.css',
  'inventory/LocationPicker.css',
  'inventory/ShiftBar.css',
  'inventory/StockAlertPanel.css',
  'inventory/ThresholdConfigScreen.css',
  'inventory/TransactionLogScreen.css',
  'inventory/TransitAuditScreen.css',
  'kds/components/KdsDeviceStatusIndicator.css',
  'kds/components/KdsEnrollmentModal.css',
  'kds/components/KdsProductPickerModal.css',
  'locations/NodeTopologyEditor.css',
  'locations/TopologyApplyConfirm.css',
  'locations/TopologyRevisionBrowser.css',
  'locations/TopologyScreen.css',
  'marketplace/AddonsMarketplace.css',
  'memo/MemoBanner.css',
  'memo/MemosScreen.css',
  'reports/CustomReportScreen.css',
  'reports/MenuEngineeringScreen.css',
  'retail/RetailPosScreen.css',
  'sales/CartPanel.brand.css',
  'sales/CartPanel.css',
  'sales/CartPanelActions.css',
  'sales/CartPanelCourseBar.css',
  'sales/CartPanelFooterTotals.css',
  'sales/CartPanelLineItem.css',
  'sales/PaymentModal.css',
  'sales/PosScreen.css',
  'sales/PromotionsModal.css',
  'sales/ReceiptPreview.css',
  'sales/StockShortfallDialog.css',
  'sales/WeightScaleWidget.css',
  'sales/components/ItemModifierModal.css',
  'sales/widgets/widgets.css',
  'settings/LicenseSettings.css',
  'settings/SettingsNavTree.css',
  'settings/SettingsScopeTag.css',
  'settings/SettingsSelect.css',
  'settings/WorkspaceSettingsModal.module.css',
  'settings/sections/DiagnosticsSection.css',
  'setup/components/LiveSetupPreview.css',
  'staff/RoleAuthoringScreen.css',
  'warehouse/WarehouseConsole.css',
];

describe('stylesheet coverage', () => {
  it('every .css under src/features is cited by an entry, or listed in BASELINE_UNCITED', () => {
    const cited = new Set<string>();
    for (const entry of SCREENS) {
      for (const c of entry.css) cited.add(c);
      for (const c of entry.parentCss ?? []) cited.add(c);
    }

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, dirent.name);
        if (dirent.isDirectory()) walk(p);
        else if (dirent.name.endsWith('.css')) {
          found.push(path.relative(FEATURES_DIR, p).split(path.sep).join('/'));
        }
      }
    };
    walk(FEATURES_DIR);

    const offenders = found
      .filter((sheet) => !cited.has(sheet) && !BASELINE_UNCITED.includes(sheet))
      .sort();

    expect(
      offenders,
      `uncited: ${offenders.length} (baseline ${BASELINE_UNCITED.length}) — sheet(s) no entry cites via css or parentCss and no line of BASELINE_UNCITED names: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

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
