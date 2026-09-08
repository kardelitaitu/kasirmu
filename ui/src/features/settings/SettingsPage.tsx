import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react';

/** Polling cadence for the Cloud Sync status panel while its section is open. */
const SYNC_STATUS_POLL_MS = 30_000;
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
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  type CurrencyDto,
} from '@/api/currency';
import {
  updateSyncSettingsScoped,
  syncRunScoped,
  syncPullScoped,
  getOfflineQueueStatusSummaryScoped,
  getSyncPlanScoped,
  testSyncConnectionScoped,
  requestSyncTokenScoped,
  type SyncSettingsDto,
  type SyncAttemptResult,
  type PullResult,
  type PingResult,
  type OfflineQueueSummaryDto,
  type SyncPlanResult,
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
import { TopologyScreen } from '@/features/locations';
import LicenseSettings from './LicenseSettings';
import EmailReportSettings from './EmailReportSettings';
import DiagnosticsSection from './sections/DiagnosticsSection';
const GeneralSection = lazy(() => import('./sections/GeneralSection'));
const AppearanceSection = lazy(() => import('./sections/AppearanceSection'));
const ReceiptSection = lazy(() => import('./sections/ReceiptSection'));
const SyncSection = lazy(() => import('./sections/SyncSection'));
const LocalApiSection = lazy(() => import('./sections/LocalApiSection'));
const AboutSection = lazy(() => import('./sections/AboutSection'));
import { useContextMenu, ContextMenu } from '@/frontend/shared';

import SettingsNavTree, {
  NAV_ITEMS as NAV_ITEMS_REF,
  NAV_L10N_KEYS as NAV_L10N_KEYS_REF,
} from './SettingsNavTree';

// ── Lazy-loaded workspace settings cards (ADR #22 Phase 3) ──
const WorkspaceStorePosSettings = lazy(() =>
  import('./workspace-cards/WorkspaceStorePosSettings').then((m) => ({ default: m.WorkspaceStorePosSettings })),
);
const WorkspaceRestaurantPosSettings = lazy(() =>
  import('./workspace-cards/WorkspaceRestaurantPosSettings').then((m) => ({ default: m.WorkspaceRestaurantPosSettings })),
);
const WorkspaceInventorySettings = lazy(() =>
  import('./workspace-cards/WorkspaceInventorySettings').then((m) => ({ default: m.WorkspaceInventorySettings })),
);
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
  'general', 'appearance', 'receipt', 'sync', 'email',
  'about', 'license', 'diagnostics', 'topology', 'store-pos', 'restaurant-pos', 'inventory',
]);

// ── Locations → Topology deep-link hints (todo-global-saas-2 §"Locations
// and Topology navigation") ─────────────────────────────────────────────
// The Locations dashboard routes into the scoped Topology Editor via
// `#/settings/topology?branch=<id>` (open that location's graph) and
// `#/settings/topology?create=1` (arm the add-location form). The query
// must survive until the topology section mounts: applyHashSection cannot
// clear the hash when a query is present, or the hand-off would be lost
// between the hashchange that switched the section and this wrapper's
// initializer. TopologySection consumes the hints once (the section body
// is keyed by activeSection, so each fresh deep link reaches a freshly
// mounted wrapper) and then clears the hash itself.

/** Target deep-link prefix for the topology editor's scope hints. */
const TOPOLOGY_HASH_PREFIX = '#/settings/topology';

/** Scope hints carried by a `#/settings/topology?…` deep link, or null
 *  when the current hash names no hints. */
interface TopologyHints {
  /** Location (LocationProfile id) the editor must open scoped to. */
  branchId: string | null;
  /** Arm the editor's Add Branch form (creation begins from Locations). */
  openCreate: boolean;
}

/** Parse the scope hints off the current `#/settings/topology?…` hash.
 *  Returns null for every other hash shape, including a bare
 *  `#/settings/topology` deep link (no scope requested). */
function parseTopologyHints(): TopologyHints | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(TOPOLOGY_HASH_PREFIX)) return null;
  const query = hash.slice(TOPOLOGY_HASH_PREFIX.length);
  if (!query.startsWith('?')) return null;
  const params = new URLSearchParams(query.slice(1));
  const branchId = params.get('branch');
  const openCreate = params.get('create') === '1';
  if (!branchId && !openCreate) return null;
  return { branchId, openCreate };
}

/**
 * Renders the topology editor with the Locations deep-link hints applied.
 * Lives at module scope (not inside SettingsPage) so its initializer can
 * read the still-consumed hash exactly once per section mount, and so the
 * hint state survives SettingsPage's own re-renders.
 */
function TopologySection() {
  const [hints, setHints] = useState<TopologyHints | null>(parseTopologyHints);

  // Re-parse on later hashchanges (e.g. a second location opened while the
  // topology section is already mounted). A hash without hints does not
  // reset the current editor — the consumed hint state is already cleared.
  useEffect(() => {
    const applyHashHints = () => {
      const parsed = parseTopologyHints();
      if (parsed) setHints(parsed);
    };
    window.addEventListener('hashchange', applyHashHints);
    return () => window.removeEventListener('hashchange', applyHashHints);
  }, []);

  // Consume: clear the hash so a stale hint cannot re-arm a later remount
  // (the deep-link intent has been handed to the editor's mount-time state).
  useEffect(() => {
    if (!hints) return;
    window.history.replaceState(null, '', window.location.pathname);
  }, [hints]);

  const branchId = hints?.branchId ?? null;
  const openCreate = hints?.openCreate ?? false;
  // Key by the resolved scope: a second Configure topology click while the
  // section is already mounted must remount the editor on the new branch
  // (the same keyed-remount contract the editor's own branch switch uses).
  const scopeKey = branchId ?? (openCreate ? 'create' : 'default');
  return (
    <div
      className="settings-topology-container"
      data-testid="topology-section"
      {...(branchId ? { 'data-initial-branch': branchId } : {})}
      {...(openCreate ? { 'data-open-create': 'true' } : {})}
    >
      <TopologyScreen
        key={scopeKey}
        {...(branchId ? { initialBranchId: branchId } : {})}
        {...(openCreate ? { openCreateOnMount: true } : {})}
      />
    </div>
  );
}

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

  // ── Updater state ─────────────────────────────────────────
  type UpdateCheckState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';
  const [updateState, setUpdateState] = useState<UpdateCheckState>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const updateInstanceRef = useRef<{ version?: string; downloadAndInstall(): Promise<void> } | null>(null);

  const handleCheckUpdates = useCallback(async () => {
    setUpdateState('checking');
    setUpdateVersion('');
    updateInstanceRef.current = null;
    try {
      const updater = await import('@tauri-apps/plugin-updater');
      const update = await updater.check();
      if (update) {
        setUpdateVersion(update.version ?? '');
        updateInstanceRef.current = update;
        setUpdateState('available');
      } else {
        setUpdateState('up-to-date');
      }
    } catch {
      setUpdateState('error');
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    const instance = updateInstanceRef.current;
    if (!instance) return;
    setUpdateState('installing');
    try {
      await instance.downloadAndInstall();
    } catch {
      setUpdateState('available');
    }
  }, []);

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
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
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
  const [syncApiKeyVisible, setSyncApiKeyVisible] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncAttemptResult | null>(null);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [queueSummary, setQueueSummary] = useState<OfflineQueueSummaryDto | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlanResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  const { session } = useAuth();
  const { sessionToken, terminalId } = useWorkspace();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const userId = session?.user_id ?? 'default';

  const [displayCardSize, setDisplayCardSize] = useState(0);
  const [displayFontSize, setDisplayFontSize] = useState(0);
  const [displayFontSmoothing, setDisplayFontSmoothing] = useState('antialiased');
  const [brandColour, setBrandColour] = useState('#147EFB');
  const [brandStoreName, setBrandStoreName] = useState('');

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

  // ── Field validation state ────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateField = useCallback((field: string, value: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (field === 'store-name' && !value.trim()) {
        next[field] = l10n.getString('settings-store-name-required');
      } else if (field === 'tax-id' && value.trim() && !/^[A-Za-z0-9-./]*$/.test(value.trim())) {
        next[field] = l10n.getString('settings-tax-id-pattern-error');
      } else {
        delete next[field];
      }
      return next;
    });
  }, [l10n]);

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  /** Navigate to a section. */
  const navigateToSection = useCallback((key: string) => {
    setActiveSection(key);
    setMobileSidebarOpen(false);
  }, []);

  // ── Read section from the URL hash (e.g. #/settings/topology) ────────
  // Only sections that still exist in the kept hub are accepted; stale
  // deep-links to removed management tabs (staff, audit, etc.) are ignored
  // so the hub opens on its default (general) section instead of an empty
  // body — the "old settings on <tab>" problem. KEPT_SECTIONS is module-scope
  // for that reason: as a render-scoped const it would be a new Set every render, so
  // listing it in the dependency array below would re-run the effect on every render and
  // tear down/re-add the listener each time. Hoisting fixes the real problem instead of
  // just silencing the lint.
  //
  // This used to be a mount-only effect (`[]`), which worked when the link arrived from
  // another workspace — AppShell remounts the page and the effect reads the hash on the
  // way in. It silently did nothing when the page was ALREADY mounted, which is the case
  // for every tool card clicked while the user is on the admin workspace: AppShell's own
  // hashchange listener refuses `settings/topology` because only `settings` is a
  // registered page, so no remount happens and nothing re-reads the hash. The URL changed
  // and the section stayed put. Listening here closes that gap; the KEPT_SECTIONS guard
  // is unchanged, so a hashchange to a removed tab is still ignored.
  useEffect(() => {
    const applyHashSection = () => {
      const hash = window.location.hash.replace(/^#\//, '');
      if (!hash.startsWith('settings/')) return;
      // A deep link may append a query scoping the target section
      // (`#/settings/topology?branch=<id>` / `?create=1` from the Locations
      // dashboard): the section name is everything before the '?'.
      const rawSection = hash.slice('settings/'.length);
      const queryIndex = rawSection.indexOf('?');
      const section = queryIndex === -1 ? rawSection : rawSection.slice(0, queryIndex);
      if (section && KEPT_SECTIONS.has(section)) {
        setActiveSection(section);
        // Clear the hash after consuming it so stale sections don't persist.
        // A hint-carrying link keeps its query: TopologySection parses the
        // scope after this listener runs, and clearing it here would lose
        // the hand-off between the hashchange and the section mount.
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
  const markDirty = useCallback(() => { setIsDirty(true); }, []);

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

  // ── Accordion state moved to SettingsNavTree.tsx ──────────────

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
    setFieldErrors({});
    setSyncResult(null);
    setSyncApiKey('');
    setSyncApiKeyVisible(false);
    setTokenExpiresAt(null);
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
      setCurrencies(s.currencies);
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

  // ── Cloud Sync diagnostics ──────────────────────────────────

  // Load the full offline queue summary (pending/synced/failed/conflict
  // counts + last-synced/oldest-pending timestamps) when the sync section
  // is active, so the Cloud Sync panel can show detailed status.
  const refreshQueueSummary = useCallback(async () => {
    try {
      const summary = await getOfflineQueueStatusSummaryScoped(sessionToken ?? '');
      setQueueSummary(summary);
    } catch {
      setQueueSummary(null);
    }
  }, [sessionToken]);

  // Poll the summary + plan while the Cloud Sync section is open so the
  // status panel (counts + last-synced + plan) stays live without manual
  // refreshes.
  const refreshSyncPlan = useCallback(async () => {
    try {
      setSyncPlan(await getSyncPlanScoped(sessionToken ?? ''));
    } catch {
      setSyncPlan(null);
    }
  }, [sessionToken]);

  useEffect(() => {
    if (activeSection !== 'sync') {
      return;
    }
    refreshQueueSummary();
    refreshSyncPlan();
    const id = window.setInterval(() => {
      void refreshQueueSummary();
      void refreshSyncPlan();
    }, SYNC_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [activeSection, refreshQueueSummary, refreshSyncPlan]);

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
        return (
          <GeneralSection
            store={store}
            setStore={setStore}
            markDirty={markDirty}
            cmInput={cmInput}
            fieldErrors={fieldErrors}
            validateField={validateField}
            clearFieldError={clearFieldError}
            currencies={currencies}
            defaultCurrency={defaultCurrency}
            setDefaultCurrencyState={setDefaultCurrencyState}
            l10n={l10n}
          />
        );

      case 'appearance':
        return (
          <AppearanceSection
            displayCardSize={displayCardSize}
            setDisplayCardSize={setDisplayCardSize}
            displayFontSize={displayFontSize}
            setDisplayFontSize={setDisplayFontSize}
            displayFontSmoothing={displayFontSmoothing}
            setDisplayFontSmoothing={setDisplayFontSmoothing}
            brandColour={brandColour}
            setBrandColour={setBrandColour}
            brandStoreName={brandStoreName}
            setBrandStoreName={setBrandStoreName}
            markDirty={markDirty}
            l10n={l10n}
          />
        );

      case 'receipt':
        return (
          <ReceiptSection
            receipt={receipt}
            setReceipt={setReceipt}
            setDecimalSep={setDecimalSep}
            markDirty={markDirty}
            l10n={l10n}
          />
        );

      case 'sync':
        return (
          <SyncSection
            sync={sync}
            setSync={setSync}
            syncServerUrl={syncServerUrl}
            setSyncServerUrl={setSyncServerUrl}
            syncApiKey={syncApiKey}
            setSyncApiKey={setSyncApiKey}
            syncApiKeyVisible={syncApiKeyVisible}
            setSyncApiKeyVisible={setSyncApiKeyVisible}
            syncing={syncing}
            setSyncing={setSyncing}
            pulling={pulling}
            setPulling={setPulling}
            syncResult={syncResult}
            setSyncResult={setSyncResult}
            pullResult={pullResult}
            setPullResult={setPullResult}
            queueSummary={queueSummary}
            syncPlan={syncPlan}
            testing={testing}
            setTesting={setTesting}
            pingResult={pingResult}
            setPingResult={setPingResult}
            requesting={requesting}
            setRequesting={setRequesting}
            tokenExpiresAt={tokenExpiresAt}
            setTokenExpiresAt={setTokenExpiresAt}
            cmInput={cmInput}
            markDirty={markDirty}
            refreshQueueSummary={refreshQueueSummary}
            testSyncConnection={() => testSyncConnectionScoped(sessionToken ?? '')}
            syncRun={() => syncRunScoped(sessionToken ?? '')}
            syncPull={(args: { confirmDestructive: boolean }) => syncPullScoped(sessionToken ?? '', args)}
            requestSyncToken={() => requestSyncTokenScoped(sessionToken ?? '')}
            l10n={l10n}
            addToast={addToast}
          />
        );

      case 'local-api':
        return <LocalApiSection />;

      case 'email':
        return <EmailReportSettings />;

      case 'about':
        return (
          <AboutSection
            appVersion={appVersion}
            updateState={updateState}
            updateVersion={updateVersion}
            handleCheckUpdates={handleCheckUpdates}
            handleInstallUpdate={handleInstallUpdate}
          />
        );

      case 'license':
        return <LicenseSettings />;

      case 'diagnostics':
        return <DiagnosticsSection />;

      case 'topology':
        return <TopologySection />;

      case 'store-pos':
        return (
          <Suspense fallback={<Skeleton variant="block" width="100%" height="12rem" />}>
            <WorkspaceStorePosSettings variant="full-page" terminalId={terminalId} userId={userId} {...(sessionToken ? { sessionToken } : {})} />
          </Suspense>
        );

      case 'restaurant-pos':
        return (
          <Suspense fallback={<Skeleton variant="block" width="100%" height="12rem" />}>
            <WorkspaceRestaurantPosSettings variant="full-page" terminalId={terminalId} userId={userId} {...(sessionToken ? { sessionToken } : {})} />
          </Suspense>
        );

      case 'inventory':
        return (
          <Suspense fallback={<Skeleton variant="block" width="100%" height="12rem" />}>
            {/* TODO: pass locationId from workspace context when available
                to enable the Deduction Rules card section */}
            <WorkspaceInventorySettings variant="full-page" userId={userId} />
          </Suspense>
        );

      default:
        return null;
    }
  }

  // ── Resolve current nav item + category for breadcrumb ─────

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
          <div className={`settings-section-content${activeSection === 'topology' ? ' settings-section-content--full' : ''}`} key={activeSection}>
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
