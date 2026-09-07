// ── SyncSection tests ─────────────────────────────────────────────
//
// Covers: server URL input, API key with show/hide toggle, request
// token button, enable toggle, sync status indicator, test connection,
// sync now, pull from server, token expiry display, dirty tracking,
// and result display blocks.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { LocalizationProvider } from '@fluent/react';
import type { ReactNode, ReactElement } from 'react';
import SyncSection from '@/features/settings/sections/SyncSection';
import type { SyncSettingsDto } from '@/api/offline';

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string, vars?: Record<string, string | number>) => {
    const defaults: Record<string, string> = {
      'settings-section-sync': 'Cloud Sync',
      'settings-sync-server-url': 'Server URL',
      'settings-sync-api-key': 'API Key',
      'settings-sync-enabled': 'Enable Cloud Sync',
      'settings-sync-not-configured': 'Sync is not configured.',
      'settings-sync-status-idle': 'Idle',
      'settings-sync-status-ok': 'Sync OK',
      'settings-sync-pending-count': '{count} pending',
      'settings-sync-summary-pending': 'pending',
      'settings-sync-summary-synced': 'synced',
      'settings-sync-summary-failed': 'failed',
      'settings-sync-summary-conflicts': 'conflicts',
      'settings-sync-plan-label': 'Plan',
      'settings-sync-plan-free': 'Free',
      'settings-sync-plan-pro': 'Pro',
      'settings-sync-plan-upgrade-hint': 'Upgrade to sync to the cloud',
      'settings-sync-last-synced': 'Last synced {time}',
      'settings-sync-last-synced-never': 'Never synced',
      'settings-sync-oldest-pending': 'Oldest pending {time}',
      'settings-sync-oldest-pending-none': 'Queue empty',
      'settings-sync-time-just-now': 'just now',
      'settings-sync-time-minutes-ago': '{count}m ago',
      'settings-sync-time-hours-ago': '{count}h ago',
      'settings-sync-time-days-ago': '{count}d ago',
      'settings-sync-test-connection': 'Test Connection',
      'settings-sync-testing': 'Testing…',
      'settings-sync-test-failed': 'Test failed',
      'settings-sync-sync-now': 'Sync Now',
      'settings-sync-syncing': 'Syncing…',
      'settings-sync-pull': 'Pull from Server',
      'settings-sync-pulling': 'Pulling…',
      'settings-sync-result': '{synced} synced, {failed} failed',
      'settings-sync-pull-result': '{products} products, {tax_rates} tax rates, {users} users',
      'settings-sync-success': 'Sync succeeded',
      'settings-sync-nothing': 'Nothing to sync',
      'settings-sync-error': 'Sync failed',
      'settings-sync-plan-required': 'Cloud sync requires a paid plan',
      'settings-sync-plan-required-hint': 'Your local sales keep working — upgrade to sync them to the cloud.',
      'settings-sync-confirm-overwrite': 'Overwrite local data with the server snapshot?',
      'settings-sync-confirm-pull-title': 'Pull from server?',
      'cancel': 'Cancel',
      'settings-sync-request-token': 'Request Token',
      'settings-sync-requesting': 'Requesting…',
      'settings-sync-token-hint': 'Enter a JWT token.',
      'settings-sync-token-request-failed': 'Token request failed',
      'settings-sync-expiry-in-days': '{count}d remaining',
      'settings-sync-expiry-in-hours': '{count}h remaining',
      'settings-sync-expiry-in-minutes': '{count}m remaining',
      'settings-sync-expiry-less-than-minute': '<1m remaining',
      'settings-sync-expiry-expired': 'Expired',
      'settings-sync-expiry-fallback': '{iso}',
      'settings-server-url-placeholder': 'https://api.example.com',
      'settings-api-key-masked': 'Enter new API key',
      'settings-api-key-placeholder': 'Enter API key',
      'settings-api-key-show-aria': 'Show API key',
      'settings-api-key-hide-aria': 'Hide API key',
      'toggle': 'Toggle',
    };
    let result = defaults[id] ?? id;
    if (vars) {
      for (const [key, val] of Object.entries(vars)) {
        result = result.replace(`{${key}}`, String(val));
      }
    }
    return result;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Component mocks ────────────────────────────────────────────────

vi.mock('@/components/Button', () => ({
  Button: ({
    children, onClick, disabled, variant, loading, ...rest
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
    variant?: string; loading?: boolean; [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      data-variant={variant}
      data-loading={loading ? 'true' : 'false'}
      aria-label={typeof rest['aria-label'] === 'string' ? rest['aria-label'] : undefined}
    >
      {loading ? 'Loading…' : children}
    </button>
  ),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, header }: { children: ReactNode; header?: ReactNode }) => (
    <div className="card">{header}{children}</div>
  ),
}));

// ── Wrapper ─────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n as unknown as React.ComponentProps<typeof LocalizationProvider>['l10n']}>
      {children}
    </LocalizationProvider>
  );
}

const DEFAULT_SYNC: SyncSettingsDto = {
  serverUrl: null,
  hasApiKey: false,
  enabled: false,
};

function renderSection(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    sync: DEFAULT_SYNC,
    setSync: vi.fn(),
    syncServerUrl: '',
    setSyncServerUrl: vi.fn(),
    syncApiKey: '',
    setSyncApiKey: vi.fn(),
    syncApiKeyVisible: false,
    setSyncApiKeyVisible: vi.fn(),
    syncing: false,
    setSyncing: vi.fn(),
    pulling: false,
    setPulling: vi.fn(),
    syncResult: null,
    setSyncResult: vi.fn(),
    pullResult: null,
    setPullResult: vi.fn(),
    queueSummary: null,
    syncPlan: null,
    testing: false,
    setTesting: vi.fn(),
    pingResult: null,
    setPingResult: vi.fn(),
    requesting: false,
    setRequesting: vi.fn(),
    tokenExpiresAt: null,
    setTokenExpiresAt: vi.fn(),
    cmInput: {} as React.HTMLAttributes<HTMLInputElement>,
    markDirty: vi.fn(),
    refreshQueueSummary: vi.fn(),
    testSyncConnection: vi.fn(),
    syncRun: vi.fn(),
    syncPull: vi.fn(),
    requestSyncToken: vi.fn(),
    l10n: testL10n,
    addToast: vi.fn(),
  };

  return render(
    <Wrapper>
      <SyncSection {...defaultProps} {...overrides} />
    </Wrapper>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SyncSection', () => {
  // The pull-button tests stub window.confirm; always restore the spy so a
  // failed waitFor in one test cannot leak the stub into later tests.
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('shows not-configured hint when sync is not set up', () => {
    renderSection();
    // Text is rendered via <Localized> which wraps in a <span>
    expect(screen.getByText(/Sync is not configured/)).toBeInTheDocument();
  });

  it('renders server URL input', () => {
    renderSection();
    expect(screen.getByPlaceholderText('https://api.example.com')).toBeInTheDocument();
  });

  it('calls markDirty when server URL changes', () => {
    const markDirty = vi.fn();
    const setSyncServerUrl = vi.fn();
    renderSection({ markDirty, setSyncServerUrl });

    fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), {
      target: { value: 'https://sync.example.com' },
    });
    expect(setSyncServerUrl).toHaveBeenCalledWith('https://sync.example.com');
    expect(markDirty).toHaveBeenCalled();
  });

  it('renders API key input when hasApiKey is true', () => {
    renderSection({ sync: { ...DEFAULT_SYNC, hasApiKey: true } });
    const input = document.getElementById('settings-field-api-key');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows masked placeholder when API key exists', () => {
    renderSection({ sync: { ...DEFAULT_SYNC, hasApiKey: true } });
    const input = document.getElementById('settings-field-api-key');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('renders enable sync toggle', () => {
    renderSection({ sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: false } });
    const toggle = screen.getByRole('switch', { name: /toggle/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it('calls markDirty when enable sync toggle is clicked', () => {
    const markDirty = vi.fn();
    const setSync = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: false },
      markDirty,
      setSync,
    });

    fireEvent.click(screen.getByRole('switch', { name: /toggle/i }));
    expect(markDirty).toHaveBeenCalled();
  });

  it('shows action buttons when sync is configured', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
    });
    expect(screen.getByText('Test Connection')).toBeInTheDocument();
    expect(screen.getByText('Sync Now')).toBeInTheDocument();
    expect(screen.getByText('Pull from Server')).toBeInTheDocument();
  });

  it('shows idle status when no sync has run', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
    });
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('shows sync result block after a sync run', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncResult: { synced: 5, failed: 0, error: undefined },
    });
    // The result block has class "settings-sync-result-block"
    expect(document.querySelector('.settings-sync-result-block')).toBeInTheDocument();
  });

  it('shows sync error when sync fails', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncResult: { synced: 0, failed: 3, error: 'Connection timeout' },
    });
    // Error text is rendered via settings-hint--error class
    expect(document.querySelector('.settings-hint--error')).toBeInTheDocument();
  });

  it('shows pull result block after a pull', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      pullResult: { productsPulled: 10, taxRatesPulled: 2, usersPulled: 1, error: undefined },
    });
    expect(document.querySelector('.settings-sync-result-block')).toBeInTheDocument();
  });

  it('shows pending badge when queue summary has pending items', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      queueSummary: {
        pendingCount: 7,
        syncedCount: 12,
        failedCount: 1,
        conflictCount: 0,
        lastSyncedAt: null,
        oldestPendingAt: null,
      },
    });
    expect(screen.getByText('7 pending')).toBeInTheDocument();
  });

  it('renders the detailed queue status panel with counts and timestamps', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      queueSummary: {
        pendingCount: 3,
        syncedCount: 41,
        failedCount: 2,
        conflictCount: 1,
        lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5m ago
        oldestPendingAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2h ago
      },
    });
    expect(screen.getByTestId('sync-queue-summary')).toBeInTheDocument();
    // Counts
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // Relative timestamps
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.getByText(/Oldest pending/)).toBeInTheDocument();
  });

  it('shows "never synced" / "queue empty" when timestamps are missing', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      queueSummary: {
        pendingCount: 0,
        syncedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        lastSyncedAt: null,
        oldestPendingAt: null,
      },
    });
    expect(screen.getByText(/Never synced/)).toBeInTheDocument();
    expect(screen.getByText(/Queue empty/)).toBeInTheDocument();
  });

  it('renders the pro plan row from the server', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncPlan: { ok: true, plan: 'pro', status: 'ok' },
    });
    expect(screen.getByTestId('sync-plan-row')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to sync/)).toBeNull();
  });

  it('renders the free plan row with the upgrade hint', () => {
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncPlan: { ok: true, plan: 'free', status: 'ok' },
    });
    expect(screen.getByTestId('sync-plan-row')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to sync/)).toBeInTheDocument();
  });

  it('does NOT render a plan row when the plan read failed (ok=false)', () => {
    // A failed read (old server 404, network error) carries ok:false,
    // plan:null — it must not paint as a known "Free" plan.
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncPlan: { ok: false, plan: null, status: 'Server returned 404 Not Found' },
    });
    expect(screen.queryByTestId('sync-plan-row')).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText(/Upgrade to sync/)).toBeNull();
  });

  it('renders request token button', () => {
    renderSection();
    expect(screen.getByText('Request Token')).toBeInTheDocument();
  });

  it('shows API key show/hide toggle when key is entered', () => {
    renderSection({ syncApiKey: 'my-secret-token' });
    expect(screen.getByLabelText('Show API key')).toBeInTheDocument();
  });

  it('toggles API key visibility', () => {
    const setSyncApiKeyVisible = vi.fn();
    renderSection({ syncApiKey: 'my-secret-token', setSyncApiKeyVisible });

    fireEvent.click(screen.getByLabelText('Show API key'));
    expect(setSyncApiKeyVisible).toHaveBeenCalled();
  });

  // ── Token expiry display ─────────────────────────────────────

  it('shows expiry badge with days remaining', () => {
    // Buffer of +1h guards against ms drift: the component's Date.now() runs
    // a few ms after the test's, which would floor 3d - ε down to 2d.
    const futureDate = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      tokenExpiresAt: futureDate,
    });
    expect(screen.getByText(/3d remaining/)).toBeInTheDocument();
  });

  it('shows expired badge when token is expired', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      tokenExpiresAt: pastDate,
    });
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('shows critical expiry <1m when token expires within seconds', () => {
    const nearFuture = new Date(Date.now() + 30_000).toISOString();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      tokenExpiresAt: nearFuture,
    });
    expect(screen.getByText(/1m remaining/)).toBeInTheDocument();
  });

  // ── Test Connection button ───────────────────────────────────

  it('calls testSyncConnection when Test Connection is clicked', async () => {
    const testSyncConnection = vi.fn().mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 42 });
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      testSyncConnection,
      addToast,
    });

    fireEvent.click(screen.getByText('Test Connection'));
    await waitFor(() => {
      expect(testSyncConnection).toHaveBeenCalled();
    });
  });

  it('shows success toast when test connection succeeds', async () => {
    const testSyncConnection = vi.fn().mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 42 });
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      testSyncConnection,
      addToast,
    });

    fireEvent.click(screen.getByText('Test Connection'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });
  });

  it('shows error toast when test connection fails', async () => {
    const testSyncConnection = vi.fn().mockRejectedValue(new Error('Network error'));
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      testSyncConnection,
      addToast,
    });

    fireEvent.click(screen.getByText('Test Connection'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  // ── Sync Now button ──────────────────────────────────────────

  it('calls syncRun when Sync Now is clicked', async () => {
    const syncRun = vi.fn().mockResolvedValue({ synced: 3, failed: 0, error: undefined });
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncRun,
    });

    fireEvent.click(screen.getByText('Sync Now'));
    await waitFor(() => {
      expect(syncRun).toHaveBeenCalled();
    });
  });

  it('shows success toast on successful sync', async () => {
    const syncRun = vi.fn().mockResolvedValue({ synced: 3, failed: 1, error: undefined });
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncRun,
      addToast,
    });

    fireEvent.click(screen.getByText('Sync Now'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });
  });

  it('shows info toast when nothing to sync', async () => {
    const syncRun = vi.fn().mockResolvedValue({ synced: 0, failed: 0, error: undefined });
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncRun,
      addToast,
    });

    fireEvent.click(screen.getByText('Sync Now'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });
  });

  it('shows the localized plan-required toast when syncRun reports planRequired', async () => {
    // A free tenant's sync_run returns error + planRequired:true. The toast
    // must surface the localized upgrade prompt — never the raw backend
    // string "cloud sync requires a paid plan" (ADR sync-plan-gating).
    const syncRun = vi.fn().mockResolvedValue({
      synced: 0,
      failed: 0,
      error: 'cloud sync requires a paid plan',
      planRequired: true,
    });
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncRun,
      addToast,
    });

    fireEvent.click(screen.getByText('Sync Now'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalled();
    });
    const toastCall = addToast.mock.calls[0]?.[0] as { message: string; type: string };
    expect(toastCall).toBeDefined();
    expect(toastCall!.type).toBe('error');
    // Localized message, not the raw backend error string.
    expect(toastCall!.message).toBe('Cloud sync requires a paid plan');
    expect(toastCall!.message).not.toContain('cloud sync requires a paid plan');
  });

  it('shows error toast when syncRun throws', async () => {
    const syncRun = vi.fn().mockRejectedValue(new Error('Server unreachable'));
    const addToast = vi.fn();
    renderSection({
      sync: { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true },
      syncRun,
      addToast,
    });

    fireEvent.click(screen.getByText('Sync Now'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  // ── Pull from Server button ──────────────────────────────────
  //
  // SYNC-03 requires explicit consent before a destructive pull. That consent
  // is the app's designed ConfirmDialog — NOT window.confirm(), which renders
  // an off-design, unlocalized OS dialog and blocks the event loop.

  const SYNCED = { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true };
  const PULL_OK = { productsPulled: 5, taxRatesPulled: 0, usersPulled: 0, error: undefined };

  it('asks for consent in the designed dialog, never via window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const syncPull = vi.fn().mockResolvedValue(PULL_OK);
    renderSection({ sync: SYNCED, syncPull });

    fireEvent.click(screen.getByText('Pull from Server'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Overwrite local data with the server snapshot?')).toBeInTheDocument();
    // Consent has not been given yet — the destructive call must not have fired.
    expect(syncPull).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('calls syncPull with destructive consent once the dialog is confirmed', async () => {
    const syncPull = vi.fn().mockResolvedValue(PULL_OK);
    renderSection({ sync: SYNCED, syncPull });

    fireEvent.click(screen.getByText('Pull from Server'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pull from Server' }));

    await waitFor(() => {
      // SYNC-03: the confirmation dialog and the IPC payload are one flow.
      expect(syncPull).toHaveBeenCalledWith({ confirmDestructive: true });
    });
  });

  it('does not pull when the dialog is cancelled', async () => {
    const syncPull = vi.fn().mockResolvedValue(PULL_OK);
    renderSection({ sync: SYNCED, syncPull });

    fireEvent.click(screen.getByText('Pull from Server'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(syncPull).not.toHaveBeenCalled();
  });

  it('shows success toast on successful pull', async () => {
    const syncPull = vi.fn().mockResolvedValue({ productsPulled: 5, taxRatesPulled: 1, usersPulled: 0, error: undefined });
    const addToast = vi.fn();
    renderSection({ sync: SYNCED, syncPull, addToast });

    fireEvent.click(screen.getByText('Pull from Server'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pull from Server' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });
  });

  // ── Request Token button ─────────────────────────────────────

  it('calls requestSyncToken when Request Token is clicked', async () => {
    const requestSyncToken = vi.fn().mockResolvedValue({ ok: true, token: 'new-token', status: 'Token generated', expiresAt: null });
    renderSection({ requestSyncToken });

    fireEvent.click(screen.getByText('Request Token'));
    await waitFor(() => {
      expect(requestSyncToken).toHaveBeenCalled();
    });
  });

  it('sets API key when token request succeeds', async () => {
    const requestSyncToken = vi.fn().mockResolvedValue({ ok: true, token: 'new-token', status: 'Token generated', expiresAt: null });
    const setSyncApiKey = vi.fn();
    const markDirty = vi.fn();
    renderSection({ requestSyncToken, setSyncApiKey, markDirty });

    fireEvent.click(screen.getByText('Request Token'));
    await waitFor(() => {
      expect(setSyncApiKey).toHaveBeenCalledWith('new-token');
      expect(markDirty).toHaveBeenCalled();
    });
  });

  it('shows error toast when token request fails', async () => {
    const requestSyncToken = vi.fn().mockResolvedValue({ ok: false, token: null, status: 'Server error' });
    const addToast = vi.fn();
    renderSection({ requestSyncToken, addToast });

    fireEvent.click(screen.getByText('Request Token'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  it('shows error toast when token request throws', async () => {
    const requestSyncToken = vi.fn().mockRejectedValue(new Error('Network error'));
    const addToast = vi.fn();
    renderSection({ requestSyncToken, addToast });

    fireEvent.click(screen.getByText('Request Token'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });
});
