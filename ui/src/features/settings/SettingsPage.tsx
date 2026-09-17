import { useEffect, useState, useCallback, useRef, Suspense } from 'react';

import { Localized, useLocalization } from '@fluent/react';
import {
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import { setDecimalSep } from '@/utils/storage';
import { useAuth } from '@/contexts/AuthContext';
import { roleAtLeast } from '@/utils/role';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { type SyncSettingsDto } from '@/api/offline';

// The brand writes moved out with the save orchestration (./hooks/useSettingsSave);
// only the BrandContext refresh handle is still read here.
import { useBrand } from '@/contexts/BrandContext';
import { deriveAccentPalette, applyAccentPalette } from '@/utils/color';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { useOptionalTheme, type Theme } from '@/frontend/shell/ThemeProvider';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';
import { useSettingsHashSection } from './hooks/useSettingsHashSection';
import { useSettingsSave } from './hooks/useSettingsSave';
import SettingsNavTree from './SettingsNavTree';
import { SettingsFooter } from './components/SettingsFooter';
import { SettingsTopbar } from './components/SettingsTopbar';
// The two load-state renders moved here (both reuse this sheet's shell).
import { SettingsLoadingChrome, SettingsLoadError } from './components/SettingsLoadChrome';
// The flat-IA screens (blank scaffolds from the screens commit; selective
// migration fills each one in) are keyed to sections in ./screens/registry.
import { SETTINGS_SCREENS } from './screens/registry';

import './SettingsPage.css';
import './SettingsNavTree.css';

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
// useClock + getToday moved to ./components/SettingsFooter with their only
// consumer (the footer's date/clock span); numLocale moved with them, so this
// page no longer formats a time anywhere.

// ── Section -> screen lookup ───────────────────────────────────────────
/** The screen registered for a section key; an unknown key renders nothing,
 *  the old switch's default arm. The Suspense boundary stays at the call
 *  site so a late chunk resolves against the section container below. */
function renderSection(key: string) {
  const Screen = SETTINGS_SCREENS[key];
  return Screen ? <Screen /> : null;
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

  const [displayCardSize, setDisplayCardSize] = useState(0);
  const [displayFontSize, setDisplayFontSize] = useState(0);
  const [displayFontSmoothing, setDisplayFontSmoothing] = useState('antialiased');
  const [brandColour, setBrandColour] = useState('#147EFB');
  const [brandStoreName, setBrandStoreName] = useState('');

  // P7-4: Keyboard avoidance — scroll inputs into view on mobile
  const { containerRef: settingsKeyboardRef } = useKeyboardAvoidance();

  // ── Navigation state ────────────────────────────────────────────
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Section state + the URL deep-link contract ───────────────────
  // Moved verbatim to ./hooks/useSettingsHashSection (settings slice 2): the
  // activeSection state, navigateToSection, KEPT_SECTIONS and the hashchange
  // listener. The mobile drawer and the nav search stay here, so the hook
  // receives just the drawer setter and hands back the section and its
  // navigator - and the two rules the deep-link suite pins (query-carrying
  // hashes are never cleared; an unknown section name is ignored, not blanked)
  // live in that file now.
  const { activeSection, navigateToSection } = useSettingsHashSection({
    setMobileSidebarOpen,
  });

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

  // ── Save orchestration ───────────────────────────────────────────
  // The whole fan-out moved verbatim to ./hooks/useSettingsSave (settings
  // lane slice 1). The page KEEPS the state it writes — saving / saved /
  // isDirty / store / sync / syncApiKey and the Revert snapshot are all read
  // by the dirty dot, Revert, the close guard and the section screens — so
  // the hook receives them. Its header records that trade-off and why the
  // by-name result lookup must not be turned back into an index.
  const handleSave = useSettingsSave({
    sessionToken,
    receipt,
    store,
    defaultCurrency,
    sync,
    syncServerUrl,
    syncApiKey,
    displayCardSize,
    displayFontSize,
    displayFontSmoothing,
    brandColour,
    brandStoreName,
    setSaving,
    setSaved,
    setIsDirty,
    setStore,
    setSync,
    setSyncApiKey,
    setCtxCurrency,
    markSettingsUpdated: settingsCtx.markSettingsUpdated,
    refreshBrandSettings,
    addToast,
    l10n,
    savedSnapshotRef: initialSnapshotRef,
  });

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
    return <SettingsLoadingChrome />;
  }

  if (loadError) {
    const onRetry = () => { setInitialized(false); settingsCtx.refetch(); };
    return <SettingsLoadError errorId={loadError} onRetry={onRetry} />;
  }

  // ── Main render ──────────────────────────────────────────────

  return (
    <div className="settings-page" onContextMenu={(e) => e.preventDefault()}>
      {/* ── Top bar (child owns the context menu + breadcrumb; search/save state threaded) ── */}
      <SettingsTopbar
        activeSection={activeSection}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isDirty={isDirty}
        saving={saving}
        saved={saved}
        onRevert={handleRevert}
        onSave={handleSave}
      />

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
      <SettingsFooter
        theme={theme}
        onToggleTheme={toggleTheme}
        themeSwitcherAvailable={!!themeCtx}
        appVersion={appVersion}
      />

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
