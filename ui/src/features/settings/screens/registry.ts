/**
 * key -> screen component for the settings hub's flat IA.
 *
 * Slice of the settings extraction: the 14 `lazy()` declarations that were
 * module-scope consts in SettingsPage.tsx, plus the key arms of that page's
 * 14-case `renderSection` switch, collapsed into one map. Every screen name
 * used to be written twice in the page (const + case arm) and every section
 * key a third time; each now appears once. The `.then()` unwrap is kept
 * verbatim: each screen module exports a named function and `lazy()` needs a
 * default.
 *
 * THREE LISTS, DELIBERATELY INDEPENDENT -- do not derive one from another:
 *   * NAV_ITEMS (../SettingsNavTree.tsx) owns the sidebar: labels, icons, order.
 *   * KEPT_SECTIONS (../hooks/useSettingsHashSection.ts) owns the URL contract:
 *     which `#/settings/<section>` deep links are accepted.
 *   * this map owns which component mounts.
 * They agree today, and SettingsPage.test.tsx asserts it in both directions
 * against this registry. Deriving any one of the three from another turns
 * that assertion into a list compared with itself.
 *
 * EVERY SCREEN IN THIS MAP NOW RENDERS REAL CONTENT. VERIFIED ON THE TABLET
 * 2026-10-07 (Redmi 23073RPBFG, debug APK embedding commit 7198980), over CDP
 * against the running app: navigating each sidebar entry and reading
 * `.settings-section-content`, NO section reported "This page is being rebuilt"
 * and every one rendered its controls —
 *
 *   Data & Sync     8 controls  ("Server URL", "Server in use: … (pinned)")
 *   Sync Status     3 controls  (status "Ready", Test Connection / Sync Now / Pull)
 *   General         9 controls  (Store name / Address / Tax-VAT ID / Branch / …)
 *   Security & Account  RoleBadge: name "Adikara Dwi Atmaja", role chip "Owner",
 *                       and the logout control — the signed-in identity the
 *                       tablet previously showed nowhere.
 *
 * As of 2026-10-06 the
 * settings rebuild is complete: no file in this folder renders the
 * "This page is being rebuilt" notice any more
 * (`git grep 'id="settings-screen-placeholder"' -- ui/src/features/settings/screens`
 * returns nothing). The path there ran through several shapes, and a future
 * edit should know which one a given screen took rather than assume:
 *
 *   * COMPOSITION (most of them) — the scaffold renders an existing section as
 *     its body: LicenceSettings, DiagnosticsSection, GeneralSection, SyncSection,
 *     FeatureToggleScreen, DataManagementScreen, OfflineQueueScreen, the currency
 *     screen, and the tax screen. The composed feature keeps its own stylesheet,
 *     so each entry cites it through `parentCss` rather than muting the names.
 *   * STATE-LIFT (three of them) — General, Data Sync and Sync Status could not
 *     compose: their sections are presentational and take 11 / 34 / 34 props that
 *     the flat-IA rebuild deleted the suppliers of. Those props now come from
 *     `../hooks/useStoreDraft.ts` and `../hooks/useDataSyncDraft.ts`.
 *   * INLINE (Security & Account) — the only greenfield screen, with no source
 *     section to compose; it renders the shared RoleBadge directly.
 *
 * The Suspense boundary is deliberately NOT here: it stays at the page's use
 * site, so a late chunk resolves against the section container the page owns.
 */
import { lazy, type ComponentType } from 'react';

/** Section key -> its screen. An unknown key simply misses (no fallback screen). */
export const SETTINGS_SCREENS: Record<string, ComponentType> = {
  general: lazy(() => import('./GeneralScreen').then((m) => ({ default: m.GeneralScreen }))),
  'license-subscription': lazy(() => import('./LicenseSubscriptionScreen').then((m) => ({ default: m.LicenseSubscriptionScreen }))),
  'devices-connectivity': lazy(() => import('./DevicesConnectivityScreen').then((m) => ({ default: m.DevicesConnectivityScreen }))),
  'business-defaults': lazy(() => import('./BusinessDefaultsScreen').then((m) => ({ default: m.BusinessDefaultsScreen }))),
  'features-modules': lazy(() => import('./FeaturesModulesScreen').then((m) => ({ default: m.FeaturesModulesScreen }))),
  'security-account': lazy(() => import('./SecurityAccountScreen').then((m) => ({ default: m.SecurityAccountScreen }))),
  'data-sync': lazy(() => import('./DataSyncScreen').then((m) => ({ default: m.DataSyncScreen }))),
  'data-management': lazy(() => import('./DataManagementScreen').then((m) => ({ default: m.DataManagementScreen }))),
  'sync-status': lazy(() => import('./SyncStatusScreen').then((m) => ({ default: m.SyncStatusScreen }))),
  'offline-queue': lazy(() => import('./OfflineQueueScreen').then((m) => ({ default: m.OfflineQueueScreen }))),
  'sync-conflicts': lazy(() => import('../../sync/SyncConflictReviewScreen').then((m) => ({ default: m.SyncConflictReviewScreen }))),
  'tax-configuration': lazy(() => import('./TaxConfigurationScreen').then((m) => ({ default: m.TaxConfigurationScreen }))),
  'exchange-rates': lazy(() => import('./ExchangeRatesScreen').then((m) => ({ default: m.ExchangeRatesScreen }))),
  'system-diagnostics': lazy(() => import('./SystemDiagnosticsScreen').then((m) => ({ default: m.SystemDiagnosticsScreen }))),
};
