import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react';

import { Localized, useLocalization } from '@fluent/react';
import {
  setReceiptSettingsScoped,
  setStoreSettingsScoped,
  setUserPreferencesScoped,
  setSettingScoped,
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import { setDecimalSep } from '@/utils/storage';
import { useAuth } from '@/contexts/AuthContext';
import { roleAtLeast } from '@/utils/role';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  updateSyncSettingsScoped,
  type SyncSettingsDto,
} from '@/api/offline';

import {
  setBrandPrimaryColour,
  setBrandStoreName as setBrandStoreNameApi,
} from '@/api/branding';
import { useBrand } from '@/contexts/BrandContext';
import { deriveAccentPalette, applyAccentPalette } from '@/utils/color';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { useOptionalTheme, type Theme } from '@/frontend/shell/ThemeProvider';
import Tooltip from '@/frontend/shell/Tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';
// ── Lazy-loaded flat-IA screens (blank scaffolds from the screens commit;
//    selective migration fills each one in) ──
const GeneralScreen = lazy(() => import('./screens/GeneralScreen').then((m) => ({ default: m.GeneralScreen })));
const LicenseSubscriptionScreen = lazy(() => import('./screens/LicenseSubscriptionScreen').then((m) => ({ default: m.LicenseSubscriptionScreen })));
const DevicesConnectivityScreen = lazy(() => import('./screens/DevicesConnectivityScreen').then((m) => ({ default: m.DevicesConnectivityScreen })));
const BusinessDefaultsScreen = lazy(() => import('./screens/BusinessDefaultsScreen').then((m) => ({ default: m.BusinessDefaultsScreen })));
const FeaturesModulesScreen = lazy(() => import('./screens/FeaturesModulesScreen').then((m) => ({ default: m.FeaturesModulesScreen })));
const SecurityAccountScreen = lazy(() => import('./screens/SecurityAccountScreen').then((m) => ({ default: m.SecurityAccountScreen })));
const DataSyncScreen = lazy(() => import('./screens/DataSyncScreen').then((m) => ({ default: m.DataSyncScreen })));
const DataManagementScreen = lazy(() => import('./screens/DataManagementScreen').then((m) => ({ default: m.DataManagementScreen })));
const SyncStatusScreen = lazy(() => import('./screens/SyncStatusScreen').then((m) => ({ default: m.SyncStatusScreen })));
const OfflineQueueScreen = lazy(() => import('./screens/OfflineQueueScreen').then((m) => ({ default: m.OfflineQueueScreen })));
const SyncConflictReviewScreen = lazy(() => import('../sync/SyncConflictReviewScreen').then((m) => ({ default: m.SyncConflictReviewScreen })));
const TaxConfigurationScreen = lazy(() => import('./screens/TaxConfigurationScreen').then((m) => ({ default: m.TaxConfigurationScreen })));
const ExchangeRatesScreen = lazy(() => import('./screens/ExchangeRatesScreen').then((m) => ({ default: m.ExchangeRatesScreen })));
const SystemDiagnosticsScreen = lazy(() => import('./screens/SystemDiagnosticsScreen').then((m) => ({ default: m.SystemDiagnosticsScreen })));

import { useContextMenu, ContextMenu } from '@/frontend/shared';

import SettingsNavTree, {
  NAV_ITEMS as NAV_ITEMS_REF,
  NAV_L10N_KEYS as NAV_L10N_KEYS_REF,
} from './SettingsNavTree';

import './SettingsPage.css';
import './SettingsNavTree.css';

/**
 * Sections the settings hub actually still has. Deep-links (`#/settings/<section>`) from
 * the workspace tool cards are matched against this, so a bookmark to a tab that was
 * removed in the hub redesign is ignored and the page opens on its default instead of an
 * empty body. Module scope on purpose: the hash effect in the component closes over this
 * and must not see a new Set on every render.
 */
const KEPT_SECTIONS = new Set([
  'general', 'license-subscription', 'devices-connectivity', 'business-defaults',
  'features-modules', 'security-account', 'data-sync', 'data-management',
  'sync-status', 'sync-conflicts', 'offline-queue', 'tax-configuration', 'exchange-rates', 'system-diagnostics',
]);

/** Snapshot of initial loaded values for the Revert-to-saved button. */
interface SettingsSnapshot {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
}

// ── Clock helper ──────────────────────────────────────────────────

function useClock(locale: string): string {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  );
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    // Align the first tick to the next minute boundary so the clock
    // is accurate from the start rather than drifting by mount time.
    const now = new Date();
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      const tick = () =>
        setClock(
          new Date().toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [locale]);
  return clock;
}

/** Return today's formatted date. The date only changes at midnight and
 *  the settings page is not expected to stay open across day boundaries,
 *  so we compute once at mount rather than polling every 60 seconds. */
function getToday(locale: string): string {
  return new Date().toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Component ─────────────────────────────────────────────────────

/** Settings hub — sidebar-driven navigation across general, appearance, features, data management, staff, terminals, multi-store, audit, offline queue, shifts, tax, currency, and promotions. */
export default function SettingsPage() {
  return (
    <SettingsProvider>
      <SettingsPageContent />
    </SettingsProvider>
  );
}

/** Inner component that consumes useSettings() — wrapped by SettingsProvider. */
function SettingsPageContent() {
  const settingsCtx = useSettings();
  const loadError = settingsCtx.error;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [appVersion, setAppVersion] = useState('');

  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const { refreshBrandSettings } = useBrand();
  const themeCtx = useOptionalTheme();
  const theme: Theme = themeCtx?.theme ?? 'dark';
  const toggleTheme = themeCtx?.toggleTheme ?? (() => {});

  const [receipt, setReceipt] = useState<ReceiptSettingsDto>({
    showCurrency: false,
    decimalSeparator: 'dot',
    showTax: true,
    footer: '',
    paperWidth: 'standard',
    showTableNumber: false,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  });

  const [store, setStore] = useState<StoreSettingsDto>({
    name: '',
    address: '',
    taxId: '',
    currency: 'IDR',
    branch: '',
  });

  const { currency: ctxCurrency, setCurrency: setCtxCurrency } = useCurrency();
  const [defaultCurrency, setDefaultCurrencyState] = useState<string>(ctxCurrency);

  // Sync local state when context currency changes externally.
  useEffect(() => { setDefaultCurrencyState(ctxCurrency); }, [ctxCurrency]);

  const [sync, setSync] = useState<SyncSettingsDto>({
    serverUrl: null,
    hasApiKey: false,
    enabled: false,
  });
  const [syncServerUrl, setSyncServerUrl] = useState('');
  const [syncApiKey, setSyncApiKey] = useState('');
  // The visible-flag is written by the save/revert mirror below but no longer
  // read on this page (the legacy sync section owned the read); the mirror
  // write stays so the saved value keeps its meaning for consumers.
  const [, setSyncApiKeyVisible] = useState(false);

  const { session } = useAuth();
  // ── Role gate: Settings is admin/owner-only ──────────────────
  // roleAtLeast fails closed (missing/blank/retired/unknown roles never
  // clear the floor), so managers, staff, auditors — and anyone with an
  // unrecognized role — get the locked card instead of the shell.
  const adminUp = roleAtLeast(session?.role_name ?? null, 'admin');
  const { sessionToken } = useWorkspace();
  const { goToWorkspacePicker } = useWorkspaceNav();

  const [displayCardSize, setDisplayCardSize] = useState(0);
  const [displayFontSize, setDisplayFontSize] = useState(0);
  const [displayFontSmoothing, setDisplayFontSmoothing] = useState('antialiased');
  const [brandColour, setBrandColour] = useState('#147EFB');
  const [brandStoreName, setBrandStoreName] = useState('');

  // Right-click copy/paste on the page's remaining inputs (the custom menu
  // replaces the natively-suppressed one; migrated screens re-wire their own
  // fields to cmInput as they come back).
  const cm = useContextMenu();

  // P7-4: Keyboard avoidance — scroll inputs into view on mobile
  const { containerRef: settingsKeyboardRef } = useKeyboardAvoidance();

  const cmInput = useMemo(() => ({
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    'data-gramm': 'false' as const,
    onContextMenu: (e: React.MouseEvent<HTMLInputElement>) => cm.open(e, e.currentTarget),
  }), [cm]);

  // ── Navigation state ────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState('general');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  /** Navigate to a section. */
  const navigateToSection = useCallback((key: string) => {
    setActiveSection(key);
    setMobileSidebarOpen(false);
  }, []);

  // ── Read section from the URL hash (e.g. #/settings/general) ────────
  // Only sections that still exist in the flat IA are accepted; stale
  // deep-links to removed sections are ignored so the hub opens on its
  // default (general) section instead of an empty body — the "old settings
  // on <tab>" problem. KEPT_SECTIONS is module-scope on purpose: as a
  // render-scoped const it would be a new Set every render, re-running the
  // effect each time. This is deliberately NOT a mount-only effect:
  // AppShell's own hashchange listener refuses `settings/...` (only
  // `settings` is a registered page), so while the page is already mounted
  // nothing else re-reads the hash — listening here closes that gap.
  useEffect(() => {
    const applyHashSection = () => {
      const hash = window.location.hash.replace(/^#\//, '');
      if (!hash.startsWith('settings/')) return;
      // A deep link may append a query scoping the target section; the
      // section name is everything before the '?'.
      const rawSection = hash.slice('settings/'.length);
      const queryIndex = rawSection.indexOf('?');
      const section = queryIndex === -1 ? rawSection : rawSection.slice(0, queryIndex);
      if (section && KEPT_SECTIONS.has(section)) {
        setActiveSection(section);
        // Clear the hash after consuming it so stale sections don't persist.
        // A query-carrying hash is left alone (scoped deep links may return).
        if (queryIndex === -1) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    };
    applyHashSection();
    window.addEventListener('hashchange', applyHashSection);
    return () => window.removeEventListener('hashchange', applyHashSection);
  }, []);

  // ── Unsaved changes tracking ────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);

  // Guard the window close against unsaved work. A `beforeunload` listener on
  // its own never surfaces its prompt in a Tauri build: the Rust event loop
  // decides whether the window goes away and the webview's handler is not
  // consulted, so the previous effect only protected the browser preview. The
  // hook wires both seams and hands back a flag that drives the app's own
  // ConfirmDialog (a native dialog would be off-design and unlocalized).
  const {
    promptOpen: unsavedPromptOpen,
    onKeepEditing,
    onDiscardAndClose,
  } = useUnsavedChangesGuard(isDirty);

  // ── Sidebar nav tree lives in SettingsNavTree.tsx (flat list) ──

  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const clock = useClock(numLocale);
  const today = getToday(numLocale);

  // ── Snapshot for Revert-to-saved ──────────────────────────

  const initialSnapshotRef = useRef<SettingsSnapshot | null>(null);

  const handleRevert = useCallback(() => {
    const snap = initialSnapshotRef.current;
    if (!snap) return;
    setReceipt(snap.receipt);
    setStore(snap.store);
    setDecimalSep(snap.receipt.decimalSeparator);
    setDefaultCurrencyState(snap.defaultCurrency);
    setSync(snap.sync);
    setSyncServerUrl(snap.syncServerUrl);
    setDisplayCardSize(snap.displayCardSize);
    setDisplayFontSize(snap.displayFontSize);
    setDisplayFontSmoothing(snap.displayFontSmoothing);
    setBrandColour(snap.brandColour);
    setBrandStoreName(snap.brandStoreName);
    // Re-apply accent palette so CSS reflects the reverted colour.
    const revertedPalette = deriveAccentPalette(snap.brandColour);
    applyAccentPalette(revertedPalette);
    setIsDirty(false);
    setSyncApiKey('');
    setSyncApiKeyVisible(false);
  // All dependencies are stable (state setters + imported functions),
  // so an empty array is correct — the callback is created once.
  }, []);

  // Sync font-smoothing to <html> whenever it changes
  useEffect(() => {
    document.documentElement.setAttribute('data-font-smoothing', displayFontSmoothing);
  }, [displayFontSmoothing]);

  // ── Initialize local draft state from SettingsContext ─────
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Once context finishes loading, copy values into local editable state.
    // Only do this on the initial load — subsequent context refetches
    // (e.g. from markSettingsUpdated) should NOT overwrite user edits.
    if (!settingsCtx.loading && !initialized) {
      const s = settingsCtx.settings;
      setReceipt(s.receipt);
      setStore(s.store);
      setSync(s.sync);
      setSyncServerUrl(s.sync.serverUrl ?? '');
      setDisplayCardSize(s.preferences.cardSize);
      setDisplayFontSize(s.preferences.fontSize);
      setDisplayFontSmoothing(s.preferences.fontSmoothing);
      setBrandColour(s.brand.colour);
      setBrandStoreName(s.brand.storeName);
      setAppVersion(s.appVersion);
      setDecimalSep(s.receipt.decimalSeparator);

      const palette = deriveAccentPalette(s.brand.colour);
      applyAccentPalette(palette);

      // Set the initial snapshot for Revert-to-saved
      initialSnapshotRef.current = {
        receipt: s.receipt,
        store: s.store,
        defaultCurrency,
        sync: s.sync,
        syncServerUrl: s.sync.serverUrl ?? '',
        displayCardSize: s.preferences.cardSize,
        displayFontSize: s.preferences.fontSize,
        displayFontSmoothing: s.preferences.fontSmoothing,
        brandColour: s.brand.colour,
        brandStoreName: s.brand.storeName,
      };

      // Show toast for partial load failures (regression guard from Phase 0b)
      if (settingsCtx.hasPartialError) {
        addToast({ message: l10n.getString('settings-load-partial'), type: 'error' });
      }

      setInitialized(true);
    }
  }, [settingsCtx.loading, settingsCtx.settings, settingsCtx.hasPartialError, initialized, defaultCurrency, addToast, l10n]);

  // Derive loading/error state from context
  const loading = settingsCtx.loading && !initialized;

  // Scroll content to top and focus the first heading when navigating sections.
  useEffect(() => {
    const contentEl = document.querySelector<HTMLElement>('.settings-content');
    if (contentEl) contentEl.scrollTop = 0;

    // P60-4f: Move focus to the first heading in the newly rendered section
    // so screen readers announce the section title and keyboard users can
    // tab into the section content naturally.
    const sectionEl = document.querySelector<HTMLElement>('.settings-section-content');
    if (sectionEl) {
      const heading = sectionEl.querySelector<HTMLElement>('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
        // Remove tabindex after blur so headings don't remain focusable via Tab
        heading.addEventListener('blur', function onBlur() {
          heading.removeAttribute('tabindex');
          heading.removeEventListener('blur', onBlur);
        }, { once: true });
      }
    }
  }, [activeSection]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    // Use allSettled so a single failing save doesn't silently block
    // the others — the user gets a warning about partial failures.
    // Sync store.currency with defaultCurrency so both parallel writes
    // below target the same value (prevents a race where setStoreSettings
    // overwrites the user's currency selection with the initial value).
    const syncedStore = { ...store, currency: defaultCurrency };

    // Every save is named, and each later decision looks its result up BY NAME.
    //
    // This block previously read `results[0]` through `results[6]` -- seven positional
    // indices into the array literal. Adding a setting is the natural edit to make here,
    // and it shifts every index after it with nothing to notice: `changedKeys` would then
    // tell SettingsContext that the WRONG keys were updated (so other components refetch
    // the wrong data and the real change stays stale), and the sync DTO block below would
    // gate on an unrelated call's success. Named lookup makes an insertion harmless.
    //
    // Promises are created in the same order as before, so concurrency and side-effect
    // sequencing are unchanged.
    const saveTasks: Array<readonly [string, Promise<unknown>]> = [
      ['receipt', setReceiptSettingsScoped(sessionToken ?? '', receipt)],
      ['store', setStoreSettingsScoped(sessionToken ?? '', syncedStore)],
      ['currency', setCtxCurrency(defaultCurrency)],
      // Scoped write matches the scoped read in SettingsContext: the
      // unscoped variant writes the global DB while every consumer reads
      // the store-scoped user_preferences table, so unscoped writes would
      // silently vanish on the next reload.
      [
        'prefs',
        sessionToken
          ? setUserPreferencesScoped(sessionToken, [
              { key: 'cardsize', value: String(displayCardSize) },
              { key: 'fontsize', value: String(displayFontSize) },
              { key: 'font-smoothing', value: displayFontSmoothing },
            ])
          : Promise.resolve(),
      ],
      [
        'sync',
        updateSyncSettingsScoped(sessionToken ?? '', {
          serverUrl: syncServerUrl || null,
          ...(syncApiKey ? { apiKey: syncApiKey } : {}),
          enabled: sync.enabled,
        }),
      ],
      ['brandColour', setBrandPrimaryColour(sessionToken ?? '', brandColour)],
      ['brandName', setBrandStoreNameApi(sessionToken ?? '', brandStoreName)],
    ];

    const settled = await Promise.allSettled(saveTasks.map(([, task]) => task));
    const saveResult = (name: string): boolean =>
      settled[saveTasks.findIndex(([k]) => k === name)]?.status === 'fulfilled';

    const failed = settled.filter((r) => r.status === 'rejected').length;

    // At least one save succeeded — show confirmation and refresh.
    if (failed < saveTasks.length) {
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Sync the React store state to match what was persisted (currency).
      setStore(syncedStore);
      // Persist the sync DTO in React state so the UI immediately
      // reflects the just-saved values (server URL, API key presence,
      // enabled flag). Without this the loaded snapshot stays stale
      // until the next page reload, causing placeholder regressions
      // like "Enter API key" after saving a new key or a blank server
      // URL field after saving a URL.
      if (saveResult('sync')) {
        if (syncApiKey) {
          // Mirror the token to the shared IPC channel so the
          // Retail Options screen (useCloudSync) can load it.
          setSettingScoped(sessionToken, 'sync.auth_token', syncApiKey)
            .catch(() => { /* best-effort */ });
          setSyncApiKey('');
        }
        setSync((prev) => ({
          ...prev,
          serverUrl: syncServerUrl || null,
          hasApiKey: syncApiKey ? true : prev.hasApiKey,
          enabled: sync.enabled,
        }));
      }
      refreshBrandSettings();

      // Update the snapshot so Revert goes to the *saved* state.
      // Use syncedStore so store.currency matches what was actually persisted.
      initialSnapshotRef.current = {
        receipt,
        store: syncedStore,
        defaultCurrency,
        sync,
        syncServerUrl,
        displayCardSize,
        displayFontSize,
        displayFontSmoothing,
        brandColour,
        brandStoreName,
      };
    }

    if (failed === saveTasks.length) {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } else if (failed > 0) {
      addToast({ message: l10n.getString('settings-save-partial'), type: 'error' });
    }

    // Notify SettingsContext so other components reflect the changes. Keyed by name for
    // the reason given at saveTasks: a positional list here would silently attribute the
    // wrong keys to the wrong save the moment one is inserted.
    const changedKeys: string[] = [];
    if (saveResult('receipt')) changedKeys.push('receipt.footer', 'receipt.showCurrency', 'receipt.showTax', 'receipt.paperWidth', 'receipt.showTableNumber', 'receipt.decimalSeparator');
    if (saveResult('store')) changedKeys.push('store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency');
    if (saveResult('currency')) changedKeys.push('currency.default');
    if (saveResult('prefs')) changedKeys.push('prefs.cardsize', 'prefs.fontsize', 'prefs.font-smoothing');
    if (saveResult('sync')) changedKeys.push('sync.serverUrl', 'sync.apiKey', 'sync.enabled');
    if (saveResult('brandColour')) changedKeys.push('brand.primary_colour');
    if (saveResult('brandName')) changedKeys.push('brand.store_name');
    if (changedKeys.length > 0) {
      settingsCtx.markSettingsUpdated(changedKeys);
    }

    setSaving(false);
  };

  // ── Sidebar search filtering moved to SettingsNavTree.tsx ─────
  // (The page-level Cloud Sync diagnostics poll went with the old sync
  // section; the flat-IA screens own their own status polling.)

  // ── Keyboard shortcuts ────────────────────────────────────

  // Keep a ref to the latest handleSave so the keyboard listener
  // never calls a stale closure (avoids re-binding on every render).
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+S / Cmd+S → save (guarded by saving flag)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!saving) handleSaveRef.current();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
     
  }, [saving]);

  // ── Role gate render: locked card instead of the whole shell ────────
  // Positioned AFTER every hook in this component so the locked shell and
  // the full shell run the same hook sequence (rules of hooks). Rendered
  // for manager/staff/auditor; admin/owner get the app.
  if (!adminUp) {
    return (
      <div className="settings-page">
        {/* role="status" (polite announcement) cannot share an element with
            aria-disabled per jsx-a11y/role-supports-aria-props, so the card
            keeps the disabled semantics and its immediate wrapper announces. */}
        <div role="status">
        <div className="settings-locked-card" aria-disabled="true" data-testid="settings-locked-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h1><Localized id="settings-locked-title">Settings restricted</Localized></h1>
          <p><Localized id="settings-locked-desc">Sign in with an administrator or owner account to manage settings.</Localized></p>
        </div>
        </div>
      </div>
    );
  }

  // ── Loading / Error states ───────────────────────────────────

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-topbar">
          {/* COL 1: mobile menu — empty in skeleton */}
          <div className="settings-topbar__col" />
          {/* COL 2: branding */}
          <div className="settings-topbar__col settings-topbar__col--brand">
            <div className="settings-topbar-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <span className="settings-topbar-name"><Localized id="settings-title">Settings</Localized></span>
          </div>
          {/* COL 3–5: empty in skeleton */}
          <div className="settings-topbar__col settings-topbar__col--search" />
          <div className="settings-topbar__col" />
          <div className="settings-topbar__col settings-topbar__col--actions" />
        </header>
        <div className="settings-body">
          <div className="settings-loading">
            <div className="settings-loading-card">
              <Skeleton variant="block" width="40%" height="1.5rem" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="60%" />
            </div>
            <div className="settings-loading-card">
              <Skeleton variant="block" width="35%" height="1.5rem" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="80%" />
            </div>
            <div className="settings-loading-card">
              <Skeleton variant="block" width="30%" height="1.5rem" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="50%" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="settings-error" role="alert">
          <p>{l10n.getString(loadError)}</p>
          <Button variant="secondary" onClick={() => { setInitialized(false); settingsCtx.refetch(); }}>
            <Localized id="settings-retry"><span>Retry</span></Localized>
          </Button>
        </div>
      </div>
    );
  }

  // ── Render section content ───────────────────────────────────

  function renderSection(key: string) {
    switch (key) {
      case 'general':
        return <GeneralScreen />;
      case 'license-subscription':
        return <LicenseSubscriptionScreen />;
      case 'devices-connectivity':
        return <DevicesConnectivityScreen />;
      case 'business-defaults':
        return <BusinessDefaultsScreen />;
      case 'features-modules':
        return <FeaturesModulesScreen />;
      case 'security-account':
        return <SecurityAccountScreen />;
      case 'data-sync':
        return <DataSyncScreen />;
      case 'data-management':
        return <DataManagementScreen />;
      case 'sync-status':
        return <SyncStatusScreen />;
      case 'offline-queue':
        return <OfflineQueueScreen />;
      case 'sync-conflicts':
        return <SyncConflictReviewScreen />;
      case 'tax-configuration':
        return <TaxConfigurationScreen />;
      case 'exchange-rates':
        return <ExchangeRatesScreen />;
      case 'system-diagnostics':
        return <SystemDiagnosticsScreen />;
      default:
        return null;
    }
  }

  // ── Resolve current nav item for the topbar icon + title ─────

  const currentNavItem = NAV_ITEMS_REF.find((n) => n.key === activeSection);

  // ── Main render ──────────────────────────────────────────────

  return (
    <div className="settings-page" onContextMenu={(e) => e.preventDefault()}>
      {cm.menu && (
        <ContextMenu
          menu={cm.menu}
          menuRef={cm.menuRef}
          onCopy={cm.handleCopy}
          onPaste={cm.handlePaste}
          onClose={cm.close}
        />
      )}
      {/* ── Top bar ────────────────────────────────────── */}
      <header className="settings-topbar">
        {/* COL 1: back button */}
        <div className="settings-topbar__col">
          <Tooltip content={l10n.getString('settings-back-aria')} fit="inline" portal>
            <button
              type="button"
              className="settings-back-btn"
              onClick={() => goToWorkspacePicker()}
              aria-label={l10n.getString('settings-back-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="16 5 8 12 16 19" />
              </svg>
            </button>
          </Tooltip>
        </div>
        {/* COL 2: branding */}
        <div className="settings-topbar__col settings-topbar__col--brand">
          <div className="settings-topbar-icon" aria-hidden="true">
            {currentNavItem?.icon ?? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
          </div>
          <h1 className="settings-topbar-name">
            <Localized id={NAV_L10N_KEYS_REF[currentNavItem?.key ?? ''] ?? 'settings-title'}>
              {currentNavItem?.label ?? 'Settings'}
            </Localized>
          </h1>
        </div>
        {/* COL 3: search */}
        <div className="settings-topbar__col settings-topbar__col--search">
          <div className="settings-topbar-search">
            <svg className="settings-topbar-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="settings-search-input"
              name="settings-search"
              className="settings-topbar-search-input"
              type="text"
              placeholder={requiredLocalized(l10n, 'settings-search-placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={l10n.getString('settings-sidebar-search-aria')}
              {...cmInput}
            />
            {searchQuery && (
              <button
                type="button"
                className="settings-topbar-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label={l10n.getString('settings-sidebar-search-clear-aria')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {/* COL 4: actions */}
        <div className="settings-topbar__col settings-topbar__col--actions">
          <div className="settings-save-bar">
            {/* Revert button is always rendered but invisible when not dirty.
                This reserves layout space and prevents the clock and save
                button from shifting on appearance/disappearance. */}
            <span
              className={`settings-save-dot${isDirty && !saving && !saved ? '' : ' settings-save-dot--hidden'}`}
              aria-hidden="true"
            />
            <Localized id="settings-btn-revert-aria" attrs={{ 'aria-label': true }}>
              <button
                type="button"
                className={`settings-btn-revert${isDirty && !saving && !saved ? '' : ' settings-btn-revert--hidden'}`}
                onClick={handleRevert}
                aria-label={l10n.getString('revert-changes-aria')}
                tabIndex={isDirty && !saving && !saved ? undefined : -1}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <Localized id="settings-btn-revert">
                  <span>Revert</span>
                </Localized>
              </button>
            </Localized>
            <Localized id="settings-btn-save-aria" attrs={{ 'aria-label': true }} vars={{ state: saved ? 'saved' : 'save' }}>
              <Button
                variant="primary"
                onClick={handleSave}
                loading={saving}
              >
                {saved && !saving ? (
                  <span className="settings-saved-checkmark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <Localized id="settings-saved"><span>Saved!</span></Localized>
                  </span>
                ) : (
                  <Localized id="settings-btn-save"><span>Save</span></Localized>
                )}
              </Button>
            </Localized>
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────── */}
      <div className="settings-body">
        {/* ── Settings sidebar navigation tree ────────────── */}
        <SettingsNavTree
          activeSection={activeSection}
          onNavigate={navigateToSection}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          mobileSidebarOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        {/* ── Main content ──────────────────────────────── */}
        <form id="settings-form" className="settings-content" onSubmit={(e) => { e.preventDefault(); handleSave(); }} ref={settingsKeyboardRef as unknown as React.Ref<HTMLFormElement>}>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Save</button>
          <div className="settings-section-content" key={activeSection}>
            <div key={activeSection}>
              <Suspense fallback={<Localized id="settings-section-loading"><div className="section-loading">Loading...</div></Localized>}>
                {renderSection(activeSection)}
              </Suspense>
            </div>
          </div>
        </form>
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="settings-footer">
        <span className="settings-footer-left">
          {themeCtx && (
            <button
              type="button"
              className="settings-footer-theme-toggle"
              onClick={toggleTheme}
              aria-label={
                theme === 'light'
                  ? l10n.getString('settings-theme-toggle-dark-aria')
                  : l10n.getString('settings-theme-toggle-light-aria')
              }
            >
              {theme === 'light' ? (
                /* Moon icon (click to go dark) */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                /* Sun icon (click to go light) */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
            </button>
          )}
          <Localized id="settings-app-version" vars={{ version: appVersion }}>
            <span>OZ-POS Enterprise v{appVersion}</span>
          </Localized>
        </span>
        <span className="settings-footer-right">
          <span className="settings-footer-shortcut">
            <kbd>Ctrl</kbd>+<kbd>S</kbd>
            <Localized id="settings-btn-save"><span>Save</span></Localized>
          </span>
          <span className="settings-footer-date">
            {today} {clock}
          </span>
        </span>
      </footer>

      {/* Close-request prompt. useUnsavedChangesGuard intercepts the Tauri
          window close while settings are dirty; this dialog decides whether the
          close proceeds. Designed dialog, not a native one. */}
      <ConfirmDialog
        open={unsavedPromptOpen}
        onCancel={onKeepEditing}
        onConfirm={onDiscardAndClose}
        title={requiredLocalized(l10n, 'settings-close-unsaved-title')}
        message={requiredLocalized(l10n, 'settings-close-unsaved-msg')}
        variant="danger"
        confirmLabel={requiredLocalized(l10n, 'settings-close-unsaved-discard')}
        cancelLabel={requiredLocalized(l10n, 'settings-close-unsaved-keep')}
      />
    </div>
  );
}
