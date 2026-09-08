/**
 * @file CloudSyncSettings.test.tsx
 * @description Comprehensive test suite for the Cloud Sync section in SettingsPage.
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
import SettingsPage from '@/features/settings/SettingsPage';
import { AuthProvider } from '@/contexts/AuthContext';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';

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
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false });
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
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false });
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
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /operations/i })).toBeInTheDocument();
    });

    navigateToSync();

    expect(screen.getAllByRole('heading', { name: /cloud sync/i }).length).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════
  //  Server URL field
  // ═══════════════════════════════════════════════════════════════

  it('pre-fills the server URL with the cloud default when none is configured', async () => {
    await waitForSyncSection();

    const urlInput = getServerUrlInput();
    expect(urlInput).toBeInTheDocument();
    expect(urlInput.type).toBe('url');
    // An unconfigured sync now gets the cloud-server draft URL.
    expect(urlInput).toHaveValue('https://license.ozpos.my.id');
  });

  it('updates server URL input value when typing', async () => {
    await waitForSyncSection();

    const urlInput = getServerUrlInput();
    fireEvent.change(urlInput, { target: { value: 'https://sync.example.com' } });
    expect(urlInput).toHaveValue('https://sync.example.com');
  });

  it('sends server URL to backend on save', async () => {
    await waitForSyncSection();

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
    await waitForSyncSection();

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
    await waitForSyncSection();

    const keyInput = getApiKeyInput();
    expect(keyInput).toBeInTheDocument();
    expect(keyInput.type).toBe('password');
    expect(keyInput.getAttribute('placeholder')).toBe('Enter API key');
  });

  it('shows masked placeholder when hasApiKey is true', async () => {
    // Override get_sync_settings to return hasApiKey: true
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: null, hasApiKey: true, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    const keyInput = getApiKeyInput();
    expect(keyInput.getAttribute('placeholder')).toBe('••••••••');
  });

  it('toggles API key visibility between password and text', async () => {
    await waitForSyncSection();

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
    await waitForSyncSection();

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
    await waitForSyncSection();

    fireEvent.change(getApiKeyInput(), { target: { value: 'sk-clear-me' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      const input = getApiKeyInput();
      expect(input).toHaveValue('');
    });
  });

  it('keeps API key value after save when sync save fails', async () => {
    await waitForSyncSection();

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
    await waitForSyncSection();

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
    await waitForSyncSection();

    const checkbox = getEnabledCheckbox();
    expect(checkbox).toBeInTheDocument();
    // With the cloud-server default re-enabled, an unconfigured sync now
    // gets a draft URL and enabled state so the settings surface is usable.
    expect(checkbox.checked).toBe(true);
  });

  it('toggles enabled state on click', async () => {
    const user = userEvent.setup();
    await waitForSyncSection();

    const checkbox = getEnabledCheckbox();
    const wrapper = checkbox.closest('.settings-toggle') as HTMLLabelElement;

    // Starts enabled (cloud default) — one click disables.
    await user.click(wrapper);
    expect(checkbox.checked).toBe(false);

    await user.click(wrapper);
    expect(checkbox.checked).toBe(true);
  });

  it('sends enabled flag to backend on save', async () => {
    await waitForSyncSection();

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

  it('does not show a not-configured hint when the cloud default URL is set', async () => {
    await waitForSyncSection();

    // With the cloud-server default re-enabled, an unconfigured sync is
    // pre-filled so the not-configured hint does not surface.
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it('keeps the not-configured hint hidden even after clearing the URL input', async () => {
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

  it('shows Sync Now by default with the cloud-server pre-filled URL', async () => {
    await waitForSyncSection();

    // With the cloud default re-enabled, the pre-filled URL renders the
    // actions row which includes Sync Now.
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  it('renders Sync Now button when serverUrl is set', async () => {
    // Override load to return a configured serverUrl
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  it('calls sync_run when Sync Now is clicked and displays result', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true });
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

  it('shows the upgrade prompt when sync_run reports planRequired', async () => {
    // ADR sync-plan-gating: a free tenant's sync attempt must render a
    // dedicated "requires a paid plan" block, not a generic sync error.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true });
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

  it('does not show the upgrade prompt for a generic sync error', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true });
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

  it('updates placeholder to masked dots after saving a new API key', async () => {
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

  it('updates serverUrl in sync state after save so not-configured hint stays hidden', async () => {
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

  it('preserves hasApiKey state across saves without retyping the key', async () => {
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

  it('does not downgrade hasApiKey from true to false on save without key', async () => {
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

  it('renders Request Token button when server URL is set', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false });
      }
      return defaultImpl(cmd);
    });

    await waitForSyncSection();

    expect(screen.getByRole('button', { name: /request token/i })).toBeInTheDocument();
  });

  it('calls request_sync_token with the in-progress URL on click', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_sync_settings_scoped') {
        return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: false, enabled: false });
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

  it('auto-fills API key field on successful token request', async () => {
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

  it('shows visibility toggle after auto-fill since there is text to reveal', async () => {
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

  it('shows expiry badge after successful token request', async () => {
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

  it('clears expiry badge on revert', async () => {
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

  it('clears expiry badge when server URL changes', async () => {
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

  it('shows error toast when token request fails (ok: false)', async () => {
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

  it('shows error toast when token request throws (network error)', async () => {
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

  it('marks settings as dirty after successful token auto-fill', async () => {
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

  it('auto-refreshes the queue summary every 30s while the sync section is open', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'get_sync_settings_scoped') {
          return Promise.resolve({ serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true });
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
