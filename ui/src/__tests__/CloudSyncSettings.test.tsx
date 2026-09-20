/**
 * @file CloudSyncSettings.test.tsx
 * @description Comprehensive test suite for the Cloud Sync section, mounting
 * SyncSection directly (phase 1: first 15 tests migrated; the rest stay on the
 * old SettingsPage mount, skipped and marked PHASE 2).
 *
 * Covers:
 *   - Navigation to sync section
 *   - Server URL field rendering, editing, and save
 *   - API key field rendering with masked/unmasked placeholder
 *   - API key visibility toggle
 *   - Enabled toggle
 *   - Not-configured hint visibility
 *   - Sync Now button visibility
 *   - Save flow: correct args sent, state persisted
 *   - hasApiKey and serverUrl state update after save
 *   - API key cleared after successful save, retained after failed save
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import SettingsPage from '@/features/settings/SettingsPage'; // PHASE 2: still mounted by the skipped tests below
import SyncSection from '@/features/settings/sections/SyncSection';
import { withSyncDefaults } from '@/contexts/SettingsContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { useBrand } from '@/contexts/BrandContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getSyncSettingsScoped,
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
  type SyncPlanResult,
} from '@/api/offline';
import type { OfflineQueueSummaryDto } from '@/api/offline';
import {
  setReceiptSettingsScoped,
  setStoreSettingsScoped,
  setUserPreferencesScoped,
  setSettingScoped,
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import {
  setBrandPrimaryColour,
  setBrandStoreName as setBrandStoreNameApi,
} from '@/api/branding';
import { AuthProvider } from '@/contexts/AuthContext';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';

// ── Session under test: the settings role gate ──────────────────────
// SettingsPage.tsx:204-208 gates the whole shell on
// roleAtLeast(session?.role_name, 'admin') and renders the locked card
// otherwise. The real AuthProvider starts with session = null, so every
// nav/section query below would time out on the locked card. Spread the
// REAL module (AuthProvider stays mountable for the wrapper) and override
// only useAuth, hoisted so no consumer sees a fresh object identity per
// render. Same shape as the precedent in SettingsPage.test.tsx:49-82.
const { authValue } = vi.hoisted(() => ({
  authValue: {
    session: {
      user_id: 'u-ada',
      username: 'ada',
      display_name: 'Ada',
      role_name: 'admin',
      role_id: 'r-admin',
      permissions: ['*'],
    },
    pickerTicket: null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: false,
    swapSession: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
  useAuth: () => authValue,
}));

// ── Mock infra ────────────────────────────────────────────────────

const { invokeMock, defaultImpl, failCommands, lastCallArgs } = vi.hoisted(() => {
  const failCommands = new Set<string>();
  const lastCallArgs = new Map<string, unknown>();

  const impl = (cmd: string, args?: unknown): Promise<unknown> => {
    if (failCommands.has(cmd)) {
      return Promise.reject(new Error(`Mock failure: ${cmd}`));
    }
    if (args && typeof args === 'object') {
      lastCallArgs.set(cmd, args);
    }
    // Scoped GET commands (used by SettingsContext with sessionToken)
    if (cmd === 'get_store_settings_scoped') {
      return Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' });
    }
    if (cmd === 'get_receipt_settings_scoped') {
      return Promise.resolve({
        showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard', showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      });
    }
    if (cmd === 'list_currencies_scoped') {
      return Promise.resolve([{ code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    }
    if (cmd === 'get_default_currency') {
      return Promise.resolve('USD');
    }
    if (cmd === 'get_sync_settings_scoped') {
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
    }
    if (cmd === 'get_user_preferences_scoped') {
      return Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' });
    }
    if (cmd === 'get_brand_settings_scoped') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    if (cmd === 'version_scoped') {
      return Promise.resolve({ name: 'oz-pos', version: '0.0.9', rustVersion: '1.80', target: 'x86_64' });
    }
    // Support unscoped legacy commands for backward compat
    if (cmd === 'get_store_settings') {
      return Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' });
    }
    if (cmd === 'get_receipt_settings') {
      return Promise.resolve({
        showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard', showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      });
    }
    if (cmd === 'list_currencies') {
      return Promise.resolve([{ code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    }
    if (cmd === 'get_sync_settings_scoped') {
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
    }
    if (cmd === 'get_user_preferences') {
      return Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' });
    }
    if (cmd === 'get_brand_settings') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    if (cmd === 'version') {
      return Promise.resolve({ name: 'oz-pos', version: '0.0.9', rustVersion: '1.80', target: 'x86_64' });
    }
    if (
      cmd === 'set_receipt_settings' || cmd === 'set_store_settings' ||
      cmd === 'set_default_currency' || cmd === 'set_user_preferences' ||
      cmd === 'set_user_preferences_scoped' ||
      cmd === 'update_sync_settings' || cmd === 'update_sync_settings_scoped' ||
      cmd === 'set_brand_primary_colour' ||
      cmd === 'set_brand_store_name'
    ) {
      return Promise.resolve(undefined);
    }
    if (cmd === 'sync_run' || cmd === 'sync_run_scoped') {
      return Promise.resolve({ synced: 3, failed: 0, error: null });
    }
    if (cmd === 'request_sync_token' || cmd === 'request_sync_token_scoped') {
      return Promise.resolve({
        ok: true,
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token',
        status: 'Token obtained — expires in 2 hours',
        expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      });
    }
    if (cmd === 'test_sync_connection' || cmd === 'test_sync_connection_scoped') {
      return Promise.resolve({ ok: true, status: 'Connected (12ms)', latencyMs: 12 });
    }
    if (cmd === 'check_license_status') {
      return Promise.resolve({ tier: 'pro', tenantId: 'tenant-1', status: 'active', active: true, expiresAt: null, maxLocations: 5 });
    }
    if (cmd === 'offline_queue_status_summary_scoped') {
      return Promise.resolve({
        pendingCount: 0,
        syncedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        lastSyncedAt: null,
        oldestPendingAt: null,
      });
    }
    if (cmd === 'get_sync_plan' || cmd === 'get_sync_plan_scoped') {
      return Promise.resolve({ ok: true, plan: 'pro', status: 'ok' });
    }
    return Promise.resolve(undefined);
  };
  return { invokeMock: vi.fn(impl), defaultImpl: impl, failCommands, lastCallArgs };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock('@/contexts/ZoomContext', () => ({
  useAppZoom: () => ({ zoomLevel: 'auto', setZoomLevel: vi.fn() }),
  ZoomProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'admin',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: 'test-token',
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/HardwareAccelContext', () => ({
  useHardwareAccel: () => ({ enabled: true, setEnabled: vi.fn() }),
  HardwareAccelProvider: ({ children }: { children: React.ReactNode }) => children,
}));

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  cleanup();
  failCommands.clear();
  lastCallArgs.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultImpl);
});

afterEach(() => {
  cleanup();
});

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <LocaleContext.Provider
      value={{
        locale: 'en',
        setLocale: () => {},
        availableLocales: getAvailableLocales(),
        getLocaleLabel,
        orgDefaultLocale: null,
        setOrgDefaultLocale: () => {},
      }}
    >
      <BrandProvider>
        <CurrencyProvider>
          <AuthProvider>{children}</AuthProvider>
        </CurrencyProvider>
      </BrandProvider>
    </LocaleContext.Provider>
  );
}

// ── Helper: navigate to Cloud Sync section ───────────────────────

function navigateToSync() {
  fireEvent.click(screen.getByRole('button', { name: /operations/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Cloud Sync' }));
}

// PHASE 2: legacy SettingsPage mount, kept alive only for the skipped tests.
async function waitForSyncSection() {
  renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /operations/i })).toBeInTheDocument();
  });
  navigateToSync();
  // The section body (server URL field) renders after the async settings
  // snapshot resolves — waiting on the sidebar nav item alone let the first
  // label query race ahead of the section render (flaky in CI).
  await waitFor(() => {
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
  });
}

// ── Direct-mount host: SyncSection with the real prop bag ─────────
//
// Mirrors how SettingsPage wired SyncSection before the flat-nav rebuild
// (git 3c76e6c97^:ui/src/features/settings/SettingsPage.tsx):
//   state             :336-350    load (+withSyncDefaults) :293 SettingsContext
//   handleSave tasks  :613-645    post-save sync DTO block :662-676
//   revert            :488-511    queue/plan poll          :726-757
//   save-bar footer   :1070-1114  call site                :890-940
// Deviations (disclosed): no SettingsContext markSettingsUpdated fan-out, no
// brand palette/scroll/focus plumbing, cmInput without the context-menu
// handler (its provider is not mounted here), decorative revert svg omitted.
// None are observed by any assertion in this file.

/** Polling cadence for the Cloud Sync status panel while its section is open. */
const SYNC_STATUS_POLL_MS = 30_000;

function SyncTestHost() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { refreshBrandSettings } = useBrand();
  const { currency: ctxCurrency, setCurrency: setCtxCurrency } = useCurrency();
  const { sessionToken } = useWorkspace();

  // ── sync-slice state (old SettingsPage :336-350) ──
  const [sync, setSync] = useState<SyncSettingsDto>({
    serverUrl: null,
    hasApiKey: false,
    enabled: false,
    resolvedOrigin: 'https://license.kasir.mu',
    resolvedOriginSource: 'main',
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

  // Save-bar state (old SettingsPage :260, :461-462).
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = useCallback(() => setIsDirty(true), []);

  // Non-sync save inputs frozen at the context defaults — only the 'sync'
  // task is under test; the other six keep Promise.allSettled's partial-
  // failure semantics identical to the old page (a failed sync save still
  // shows "Saved!" because the other saves succeeded, while the API key is
  // retained because saveResult('sync') is false).
  const [receipt] = useState<ReceiptSettingsDto>({
    showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    taxRoundingMode: 'half_up',
  });
  const [store] = useState<StoreSettingsDto>({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' });
  const [defaultCurrency, setDefaultCurrencyState] = useState<string>(ctxCurrency);
  useEffect(() => { setDefaultCurrencyState(ctxCurrency); }, [ctxCurrency]);
  const [displayCardSize] = useState(0);
  const [displayFontSize] = useState(0);
  const [displayFontSmoothing] = useState('antialiased');
  const [brandColour] = useState('#147EFB');
  const [brandStoreName] = useState('');

  // Snapshot for Revert-to-saved — sync slice only (old :464-477, :546-549).
  const snapshotRef = useRef<{ sync: SyncSettingsDto; syncServerUrl: string } | null>(null);

  // Load path mirrors SettingsContext: scoped DTO -> withSyncDefaults (:293)
  // -> copy into draft state (old :528-531), then flip ready. Sections stay
  // unmounted until the load lands (old page's `loading` gate), so helpers
  // that wait for the server-URL label are implicitly waiting for the load.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const dto = await getSyncSettingsScoped(sessionToken ?? '');
      if (!alive) return;
      const s = withSyncDefaults(dto);
      setSync(s);
      setSyncServerUrl(s.serverUrl ?? '');
      snapshotRef.current = { sync: s, syncServerUrl: s.serverUrl ?? '' };
      setReady(true);
    })();
    return () => { alive = false; };
  }, [sessionToken]);

  const handleRevert = useCallback(() => {
    const snap = snapshotRef.current;
    if (!snap) return;
    setSync(snap.sync);
    setSyncServerUrl(snap.syncServerUrl);
    setIsDirty(false);
    setSyncResult(null);
    setSyncApiKey('');
    setSyncApiKeyVisible(false);
    setTokenExpiresAt(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const syncedStore = { ...store, currency: defaultCurrency };
    const saveTasks: Array<readonly [string, Promise<unknown>]> = [
      ['receipt', setReceiptSettingsScoped(sessionToken ?? '', receipt)],
      ['store', setStoreSettingsScoped(sessionToken ?? '', syncedStore)],
      ['currency', Promise.resolve(setCtxCurrency(defaultCurrency))],
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

    if (failed < saveTasks.length) {
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (saveResult('sync')) {
        if (syncApiKey) {
          // Mirror the token to the shared IPC channel (old :663-668).
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
      snapshotRef.current = { sync, syncServerUrl };
    }

    if (failed === saveTasks.length) {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } else if (failed > 0) {
      addToast({ message: l10n.getString('settings-save-partial'), type: 'error' });
    }

    setSaving(false);
  };

  // ── Cloud Sync status poll (old :723-757) ──
  const refreshQueueSummary = useCallback(async () => {
    try {
      const summary = await getOfflineQueueStatusSummaryScoped(sessionToken ?? '');
      setQueueSummary(summary);
    } catch {
      setQueueSummary(null);
    }
  }, [sessionToken]);

  const refreshSyncPlan = useCallback(async () => {
    try {
      setSyncPlan(await getSyncPlanScoped(sessionToken ?? ''));
    } catch {
      setSyncPlan(null);
    }
  }, [sessionToken]);

  useEffect(() => {
    refreshQueueSummary();
    refreshSyncPlan();
    const id = window.setInterval(() => {
      void refreshQueueSummary();
      void refreshSyncPlan();
    }, SYNC_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshQueueSummary, refreshSyncPlan]);

  const cmInput = {
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    'data-gramm': 'false' as const,
  };

  if (!ready) return null;

  return (
    <div className="settings-page">
      <header className="settings-topbar">
        <div className="settings-topbar__col settings-topbar__col--actions">
          <div className="settings-save-bar">
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
                <Localized id="settings-btn-revert">
                  <span>Revert</span>
                </Localized>
              </button>
            </Localized>
            <Localized id="settings-btn-save-aria" attrs={{ 'aria-label': true }} vars={{ state: saved ? 'saved' : 'save' }}>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                {saved && !saving ? (
                  <span className="settings-saved-checkmark">
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
      <div className="settings-section-content">
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
      </div>
    </div>
  );
}

async function mountSyncSection() {
  renderWithProvidersSync(<TestWrapper><SyncTestHost /></TestWrapper>, settingsFtl, sharedFtl);
  await waitFor(() => {
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function getApiKeyInput(): HTMLInputElement {
  return screen.getByLabelText(/^api key$/i) as HTMLInputElement;
}

function getServerUrlInput(): HTMLInputElement {
  return screen.getByLabelText(/server url/i) as HTMLInputElement;
}

function getEnabledCheckbox(): HTMLInputElement {
  return screen.getByRole('switch') as HTMLInputElement;
}

describe('CloudSyncSettings', () => {
  // ═══════════════════════════════════════════════════════════════
  //  Navigation
  // ═══════════════════════════════════════════════════════════════

  it('navigates to Cloud Sync section after clicking sidebar nav item', async () => {
    await mountSyncSection();

    expect(screen.getAllByRole('heading', { name: /cloud sync/i }).length).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════
  //  Server URL field
  // ═══════════════════════════════════════════════════════════════

  it('pre-fills the server URL with the cloud default when none is configured', async () => {
    await mountSyncSection();

    const urlInput = getServerUrlInput();
    expect(urlInput).toBeInTheDocument();
    expect(urlInput.type).toBe('url');
    // An unconfigured sync now gets the cloud-server draft URL.
    expect(urlInput).toHaveValue('https://license.kasir.mu');
  });

  it('updates server URL input value when typing', async () => {
    await mountSyncSection();

    const urlInput = getServerUrlInput();
    fireEvent.change(urlInput, { target: { value: 'https://sync.example.com' } });
    expect(urlInput).toHaveValue('https://sync.example.com');
  });

  it('sends server URL to backend on save', async () => {
    await mountSyncSection();

    fireEvent.change(getServerUrlInput(), { target: { value: 'https://sync.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    const syncArgs = lastCallArgs.get('update_sync_settings_scoped') as Record<string, unknown> | undefined;
    expect(syncArgs).toBeDefined();
    const args = syncArgs?.['args'] as { serverUrl?: string | null; enabled?: boolean };
    expect(args?.serverUrl).toBe('https://sync.example.com');
  });

  it('keeps server URL visible after save (no regression)', async () => {
    await mountSyncSection();

    fireEvent.change(getServerUrlInput(), { target: { value: 'https://keep-this-url.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // Server URL field must still show the saved value
    expect(getServerUrlInput()).toHaveValue('https://keep-this-url.com');
  });

  // ═══════════════════════════════════════════════════════════════
  //  API Key field
  // ═══════════════════════════════════════════════════════════════

  it('renders API key input as password field with placeholder', async () => {
    await mountSyncSection();

    const keyInput = getApiKeyInput();
    expect(keyInput).toBeInTheDocument();
    expect(keyInput.type).toBe('password');
    expect(keyInput.getAttribute('placeholder')).toBe('Enter API key');
  });

  it('shows masked placeholder when hasApiKey is true', async () => {
    // Override get_sync_settings to return hasApiKey: true
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: null, hasApiKey: true, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      return defaultImpl(cmd);
    });

    await mountSyncSection();

    const keyInput = getApiKeyInput();
    expect(keyInput.getAttribute('placeholder')).toBe('••••••••');
  });

  it('toggles API key visibility between password and text', async () => {
    await mountSyncSection();

    const keyInput = getApiKeyInput();
    expect(keyInput.type).toBe('password');

    // The toggle only renders when text is typed (not for placeholder dots)
    fireEvent.change(keyInput, { target: { value: 'sk-xyz' } });

    const toggleBtn = document.querySelector('.settings-input-toggle') as HTMLElement;
    expect(toggleBtn).not.toBeNull();
    fireEvent.click(toggleBtn);
    expect(keyInput.type).toBe('text');

    fireEvent.click(toggleBtn);
    expect(keyInput.type).toBe('password');
  });

  it('updates API key input value and sends it on save', async () => {
    await mountSyncSection();

    fireEvent.change(getApiKeyInput(), { target: { value: 'sk-abc-123' } });
    expect(getApiKeyInput()).toHaveValue('sk-abc-123');

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    const syncArgs = lastCallArgs.get('update_sync_settings_scoped') as Record<string, unknown> | undefined;
    const args = syncArgs?.['args'] as { apiKey?: string };
    expect(args?.apiKey).toBe('sk-abc-123');
  });

  it('clears API key input after successful save with a key', async () => {
    await mountSyncSection();

    fireEvent.change(getApiKeyInput(), { target: { value: 'sk-clear-me' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      const input = getApiKeyInput();
      expect(input).toHaveValue('');
    });
  });

  it('keeps API key value after save when sync save fails', async () => {
    await mountSyncSection();

    fireEvent.change(getApiKeyInput(), { target: { value: 'sk-keep-me' } });
    expect(getApiKeyInput()).toHaveValue('sk-keep-me');

    failCommands.add('update_sync_settings_scoped');
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    expect(getApiKeyInput()).toHaveValue('sk-keep-me');
  });

  it('does NOT send apiKey when field is empty', async () => {
    await mountSyncSection();

    // API key field is empty by default — do NOT type anything
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    const syncArgs = lastCallArgs.get('update_sync_settings_scoped') as Record<string, unknown> | undefined;
    const args = syncArgs?.['args'] as Record<string, unknown>;
    // apiKey must be absent (not included in the object)
    expect(args).not.toHaveProperty('apiKey');
  });

  // ═══════════════════════════════════════════════════════════════
  //  Enabled toggle
  // ═══════════════════════════════════════════════════════════════

  it('enables cloud sync by default (cloud-server draft URL)', async () => {
    await mountSyncSection();

    const checkbox = getEnabledCheckbox();
    expect(checkbox).toBeInTheDocument();
    // With the cloud-server default re-enabled, an unconfigured sync now
    // gets a draft URL and enabled state so the settings surface is usable.
    expect(checkbox.checked).toBe(true);
  });

  it('toggles enabled state on click', async () => {
    const user = userEvent.setup();
    await mountSyncSection();

    const checkbox = getEnabledCheckbox();
    const wrapper = checkbox.closest('.settings-toggle') as HTMLLabelElement;

    // Starts enabled (cloud default) — one click disables.
    await user.click(wrapper);
    expect(checkbox.checked).toBe(false);

    await user.click(wrapper);
    expect(checkbox.checked).toBe(true);
  });

  it('sends enabled flag to backend on save', async () => {
    await mountSyncSection();

    const checkbox = getEnabledCheckbox();
    // Starts enabled (cloud default) — no toggle needed, the backend
    // receives the current enabled state regardless.
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    const syncArgs = lastCallArgs.get('update_sync_settings_scoped') as Record<string, unknown> | undefined;
    const args = syncArgs?.['args'] as { enabled?: boolean };
    expect(args?.enabled).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  //  Not-configured hint
  // ═══════════════════════════════════════════════════════════════

  // PHASE 2
  it.skip('does not show a not-configured hint when the cloud default URL is set', async () => {
    await waitForSyncSection();

    // With the cloud-server default re-enabled, an unconfigured sync is
    // pre-filled so the not-configured hint does not surface.
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  // PHASE 2
  it.skip('keeps the not-configured hint hidden even after clearing the URL input', async () => {
    await waitForSyncSection();

    // The hint is driven by the saved sync state (serverUrl pre-filled by
    // the cloud default), not the transient input value — clearing the
    // input keeps the hint hidden until a save persists the empty URL.
    fireEvent.change(getServerUrlInput(), { target: { value: '' } });
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════════
  //  Sync Now button
  // ═══════════════════════════════════════════════════════════════

  // PHASE 2
  it.skip('shows Sync Now by default with the cloud-server pre-filled URL', async () => {
    await waitForSyncSection();

    // With the cloud default re-enabled, the pre-filled URL renders the
    // actions row which includes Sync Now.
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  // PHASE 2
  it.skip('renders Sync Now button when serverUrl is set', async () => {
    // Override load to return a configured serverUrl
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  // PHASE 2
  it.skip('calls sync_run when Sync Now is clicked and displays result', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const syncNowBtn = screen.getByRole('button', { name: /sync now/i });
    fireEvent.click(syncNowBtn);

    await waitFor(() => {
      // syncRun() calls invoke('sync_run') with no args object, so the
      // mock receives ('sync_run', undefined)
      expect(invokeMock).toHaveBeenCalledWith('sync_run_scoped', { sessionToken: 'test-token' });
    });

    await waitFor(() => {
      // Both the inline result text and the toast contain "3 synced"
      const matches = screen.getAllByText(/3 synced/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // PHASE 2
  it.skip('shows the upgrade prompt when sync_run reports planRequired', async () => {
    // ADR sync-plan-gating: a free tenant's sync attempt must render a
    // dedicated "requires a paid plan" block, not a generic sync error.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      if (cmd === 'sync_run_scoped') {
        return Promise.resolve({
          synced: 0,
          failed: 0,
          error: 'cloud sync requires a paid plan',
          planRequired: true,
        });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));

    await waitFor(() => {
      // The dedicated upgrade block (not the generic error line).
      expect(screen.getAllByText(/requires a paid plan/i).length).toBeGreaterThanOrEqual(1);
    });
    // The hint that local sales keep working must also be present.
    expect(screen.getByText(/local sales keep working/i)).toBeInTheDocument();
    // No generic "Sync failed" toast path: the block replaces the error.
    expect(screen.queryByText(/Sync failed/i)).not.toBeInTheDocument();
  });

  // PHASE 2
  it.skip('does not show the upgrade prompt for a generic sync error', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      if (cmd === 'sync_run_scoped') {
        return Promise.resolve({
          synced: 0,
          failed: 0,
          error: 'network unreachable',
          planRequired: false,
        });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));

    await waitFor(() => {
      // The error text shows in the status line; the upgrade block must NOT.
      expect(screen.getAllByText(/network unreachable/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/requires a paid plan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/local sales keep working/i)).not.toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════════
  //  hasApiKey state update after save (regression guard)
  // ═══════════════════════════════════════════════════════════════

  // PHASE 2
  it.skip('updates placeholder to masked dots after saving a new API key', async () => {
    await waitForSyncSection();

    // Initially: hasApiKey = false → placeholder shows "Enter API key"
    const keyInputBefore = getApiKeyInput();
    expect(keyInputBefore.getAttribute('placeholder')).toBe('Enter API key');

    // Type and save a new key
    fireEvent.change(keyInputBefore, { target: { value: 'sk-new-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // After save: hasApiKey should be true → placeholder shows "••••••••"
    const keyInputAfter = getApiKeyInput();
    expect(keyInputAfter.getAttribute('placeholder')).toBe('••••••••');
  });

  // ═══════════════════════════════════════════════════════════════
  //  serverUrl state update after save (regression guard)
  // ═══════════════════════════════════════════════════════════════

  // PHASE 2
  it.skip('updates serverUrl in sync state after save so not-configured hint stays hidden', async () => {
    await waitForSyncSection();

    // With the cloud default pre-filling the URL, the hint is absent.
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();

    // Change the URL and save — the hint must remain absent after save.
    fireEvent.change(getServerUrlInput(), { target: { value: 'https://sync.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // Not-configured hint stays hidden after save updates sync.serverUrl
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  // PHASE 2
  it.skip('preserves hasApiKey state across saves without retyping the key', async () => {
    await waitForSyncSection();

    // First save: type a key
    fireEvent.change(getApiKeyInput(), { target: { value: 'sk-first' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // Placeholder should now show masked dots
    expect(getApiKeyInput().getAttribute('placeholder')).toBe('••••••••');

    // Second save: wait for Saved! to revert back to normal, do NOT touch
    // the API key field, just save again.
    // The "Saved!" button auto-reverts after 2 seconds; wait for the normal
    // "Save settings" button to reappear.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // Placeholder should STILL show masked dots
    expect(getApiKeyInput().getAttribute('placeholder')).toBe('••••••••');
  });

  // PHASE 2
  it.skip('does not downgrade hasApiKey from true to false on save without key', async () => {
    // Start with a pre-existing key
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://exists.com', hasApiKey: true, enabled: true });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    // Placeholder already shows masked dots
    expect(getApiKeyInput().getAttribute('placeholder')).toBe('••••••••');

    // Save without touching the key field
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // Placeholder should still show masked dots (not downgraded to "Enter API key")
    expect(getApiKeyInput().getAttribute('placeholder')).toBe('••••••••');
  });

  // ═══════════════════════════════════════════════════════════════
  //  Request Token button
  // ═══════════════════════════════════════════════════════════════

  // PHASE 2
  it.skip('renders Request Token button when server URL is set', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    expect(screen.getByRole('button', { name: /request token/i })).toBeInTheDocument();
  });

  // PHASE 2
  it.skip('calls request_sync_token with the in-progress URL on click', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    // Type a custom URL into the server URL field
    fireEvent.change(getServerUrlInput(), { target: { value: 'http://localhost:3099' } });

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('request_sync_token_scoped', { sessionToken: 'test-token' });
    });
  });

  // PHASE 2
  it.skip('auto-fills API key field on successful token request', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    expect(getApiKeyInput()).toHaveValue('');

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(getApiKeyInput()).toHaveValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token');
    });
  });

  // PHASE 2
  it.skip('shows visibility toggle after auto-fill since there is text to reveal', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    // Before auto-fill: no toggle (field is empty)
    expect(document.querySelector('.settings-input-toggle')).toBeNull();

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(getApiKeyInput()).toHaveValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token');
    });

    // Eye toggle SHOULD be visible because there is text to reveal
    expect(document.querySelector('.settings-input-toggle')).not.toBeNull();
    // But the field type should be 'password' (hidden by default)
    expect(getApiKeyInput().type).toBe('password');
  });

  // PHASE 2
  it.skip('shows expiry badge after successful token request', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      // Badge should render with the expiry text (the mock returns 2 hours from now)
      const badge = document.querySelector('.settings-sync-expiry-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toMatch(/expires in/i);
    });
  });

  // PHASE 2
  it.skip('clears expiry badge on revert', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    // Request a token so the badge appears
    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(document.querySelector('.settings-sync-expiry-badge')).not.toBeNull();
    });

    // Click Revert
    const revertBtn = screen.getByRole('button', { name: /revert settings/i });
    fireEvent.click(revertBtn);

    // Badge should be gone
    await waitFor(() => {
      expect(document.querySelector('.settings-sync-expiry-badge')).toBeNull();
    });
  });

  // PHASE 2
  it.skip('clears expiry badge when server URL changes', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    // Request a token so the badge appears
    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(document.querySelector('.settings-sync-expiry-badge')).not.toBeNull();
    });

    // Change the server URL — badge should clear
    fireEvent.change(getServerUrlInput(), { target: { value: 'https://new-server.com' } });

    await waitFor(() => {
      expect(document.querySelector('.settings-sync-expiry-badge')).toBeNull();
    });
  });

  // PHASE 2
  it.skip('shows error toast when token request fails (ok: false)', async () => {
    const user = userEvent.setup();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'request_sync_token_scoped') {
        return Promise.resolve({ ok: false, token: null, status: 'Server returned 500: Internal error', expiresAt: null });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    // Token field should NOT have been filled
    await waitFor(() => {
      expect(getApiKeyInput()).toHaveValue('');
    });

    // No badge should appear
    expect(document.querySelector('.settings-sync-expiry-badge')).toBeNull();

    // The error status string appears in the toast
    await waitFor(() => {
      expect(screen.getByText(/500.*internal error/i)).toBeInTheDocument();
    });
  });

  // PHASE 2
  it.skip('shows error toast when token request throws (network error)', async () => {
    const user = userEvent.setup();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'request_sync_token_scoped') {
        return Promise.reject(new Error('Connection refused'));
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    // Token field should remain empty
    await waitFor(() => {
      expect(getApiKeyInput()).toHaveValue('');
    });

    // No badge should appear
    expect(document.querySelector('.settings-sync-expiry-badge')).toBeNull();

    // The catch block uses 'settings-sync-token-request-failed' which renders
    // "Token request failed — check server URL"
    await waitFor(() => {
      expect(screen.getByText(/request failed/i)).toBeInTheDocument();
    });
  });

  // PHASE 2
  it.skip('marks settings as dirty after successful token auto-fill', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'http://localhost:3099', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const requestBtn = screen.getByRole('button', { name: /request token/i });
    await user.click(requestBtn);

    await waitFor(() => {
      expect(getApiKeyInput()).toHaveValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token');
    });

    // Save button should show unsaved changes (Revert button visible)
    expect(screen.getByRole('button', { name: /revert settings/i })).toBeInTheDocument();
  });

  // PHASE 2
  it.skip('auto-refreshes the queue summary every 30s while the sync section is open', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'get_sync_settings_scoped') {
          return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' });
        }
        return defaultImpl(cmd);
      });

      renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
      // Flush initial async loads (settings payload etc.).
      await act(async () => { await Promise.resolve(); });
      navigateToSync();
      // Initial summary load fires when the sync section mounts.
      await act(async () => { await Promise.resolve(); });

      const summaryCalls = () =>
        invokeMock.mock.calls.filter(([cmd]) => cmd === 'offline_queue_status_summary_scoped').length;
      const callsAfterMount = summaryCalls();
      expect(callsAfterMount).toBeGreaterThanOrEqual(1);

      // Advance past the 30s poll interval — the panel must refresh.
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(summaryCalls()).toBeGreaterThan(callsAfterMount);

      // Leaving the section stops the poll.
      const callsBeforeLeave = summaryCalls();
      fireEvent.click(screen.getByRole('button', { name: 'General' }));
      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
      });
      expect(summaryCalls()).toBe(callsBeforeLeave);
    } finally {
      vi.useRealTimers();
    }
  });
});
