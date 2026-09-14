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
