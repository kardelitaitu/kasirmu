// ── LocalApiSection tests ──────────────────────────────────────────
//
// Covers: status fetch on mount (stopped vs running), enable/disable
// toggle wiring, port validation + apply, token minting display, and
// toast feedback on failures. The API client is mocked; the Rust side
// is covered by local_api_tests.rs.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalizationProvider } from '@fluent/react';
import type { ReactNode, ReactElement } from 'react';
import LocalApiSection from '@/features/settings/sections/LocalApiSection';
import type { LocalApiStatusDto } from '@/api/localApi';

// ── API + context mocks ────────────────────────────────────────────

const api = vi.hoisted(() => ({
  getLocalApiStatusScoped: vi.fn(),
  setLocalApiEnabledScoped: vi.fn(),
  setLocalApiPortScoped: vi.fn(),
  setLocalApiStoreScoped: vi.fn(),
  rotateLocalApiSecretScoped: vi.fn(),
  mintLocalApiTokenScoped: vi.fn(),
}));
vi.mock('@/api/localApi', () => api);

const storesApi = vi.hoisted(() => ({
  listLocationsScoped: vi.fn(),
}));
vi.mock('@/api/locations', () => storesApi);

const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/frontend/shared/Toast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-token' }),
}));

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

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string, vars?: Record<string, string | number>) => {
    const defaults: Record<string, string> = {
      'settings-section-local-api': 'Local API',
      'settings-local-api-intro': 'Run your own scripts.',
      'settings-local-api-enabled': 'Enable Local API',
      'settings-local-api-port': 'Port',
      'settings-local-api-port-apply': 'Apply',
      'settings-local-api-port-invalid': 'Port must be between 1024 and 65535.',
      'settings-local-api-port-applied': 'Port updated.',
      'settings-local-api-port-failed': 'Could not change the port.',
      'settings-local-api-store': 'Served store',
      'settings-local-api-store-primary': 'primary',
      'settings-local-api-store-hint': 'Scripts see exactly one store.',
      'settings-local-api-store-changed': 'Now serving the selected store.',
      'settings-local-api-store-failed': 'Could not switch the served store.',
      'settings-local-api-start-failed': 'Could not start the local API server.',
      'settings-local-api-toggle-failed': 'Could not change the Local API setting.',
      'settings-local-api-stopped': 'The local API is stopped.',
      'settings-local-api-token-label': 'Script name',
      'settings-local-api-token-label-placeholder': 'my-integration',
      'settings-local-api-generate': 'Generate Token',
      'settings-local-api-token': 'API token',
      'settings-local-api-token-hint': 'The token grants read access.',
      'settings-local-api-token-expires': 'Expires {expires}',
      'settings-local-api-copy-url': 'Copy URL',
      'settings-local-api-copy-token': 'Copy',
      'settings-local-api-url-copied': 'Base URL copied.',
      'settings-local-api-token-copied': 'Token copied.',
      'settings-local-api-copy-failed': 'Copy failed.',
      'settings-local-api-mint-failed': 'Could not generate a token.',
      'settings-local-api-rotate': 'Rotate secret',
      'settings-local-api-rotate-warning': 'Rotating invalidates every minted token.',
      'settings-local-api-rotate-confirm': 'Confirm rotate',
      'settings-local-api-rotate-cancel': 'Cancel',
      'settings-local-api-rotate-done': 'Signing secret rotated.',
      'settings-local-api-rotate-failed': 'Could not rotate the signing secret.',
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

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n as unknown as React.ComponentProps<typeof LocalizationProvider>['l10n']}>
      {children}
    </LocalizationProvider>
  );
}

const STOPPED: LocalApiStatusDto = {
  enabled: false,
  running: false,
  port: 3099,
  baseUrl: null,
  storeId: 'default',
};

const RUNNING: LocalApiStatusDto = {
  enabled: true,
  running: true,
  port: 3099,
  baseUrl: 'http://127.0.0.1:3099/api/v1',
  storeId: 'default',
};

const STORE_DEFAULT = {
  id: 'default', name: 'Main', address: '', tax_id: '', currency: 'USD',
  timezone: 'UTC', is_primary: true, created_at: '', updated_at: '',
};
const STORE_B = {
  id: 'store-b', name: 'Beach Club', address: '', tax_id: '', currency: 'USD',
  timezone: 'UTC', is_primary: false, created_at: '', updated_at: '',
};

beforeEach(() => {
  api.getLocalApiStatusScoped.mockResolvedValue(STOPPED);
  api.setLocalApiEnabledScoped.mockResolvedValue(RUNNING);
  api.setLocalApiPortScoped.mockResolvedValue({ ...RUNNING, port: 4010 });
  api.setLocalApiStoreScoped.mockResolvedValue({ ...RUNNING, storeId: 'store-b' });
  api.rotateLocalApiSecretScoped.mockResolvedValue(RUNNING);
  api.mintLocalApiTokenScoped.mockResolvedValue({
    token: 'jwt.abc.def',
    expires_at: '2026-10-01T00:00:00Z',
    token_id: 'tid-1',
  });
  storesApi.listLocationsScoped.mockResolvedValue([STORE_DEFAULT]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LocalApiSection', () => {
  it('fetches status on mount and renders the stopped state', async () => {
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalledWith('test-token'));
    const toggle = screen.getByRole('switch', { name: /toggle/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('local-api-stopped-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('local-api-status-row')).not.toBeInTheDocument();
  });

  it('renders the running state with base URL and token controls', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    expect(screen.getByText('http://127.0.0.1:3099/api/v1')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /toggle/i })).toBeChecked();
    expect(screen.getByText('Generate Token')).toBeInTheDocument();
  });

  it('enabling calls the scoped command and updates status', async () => {
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /toggle/i }));
    await waitFor(() => expect(api.setLocalApiEnabledScoped).toHaveBeenCalledWith('test-token', true));
    // Running row appears from the command response.
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
  });

  it('toggle failure surfaces an error toast and refetches', async () => {
    api.setLocalApiEnabledScoped.mockRejectedValueOnce(new Error('boom'));
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /toggle/i }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    // Refetch after failure (initial + refetch).
    await waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalledTimes(2));
  });

  it('applying a valid port calls the command and toasts success', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '4010' } });
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() => expect(api.setLocalApiPortScoped).toHaveBeenCalledWith('test-token', 4010));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('rejects an out-of-range port without calling the command', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '80' } });
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    expect(api.setLocalApiPortScoped).not.toHaveBeenCalled();
  });

  it('mints a token and shows it with expiry', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Script name'), { target: { value: 'stock-sync' } });
    fireEvent.click(screen.getByText('Generate Token'));
    await waitFor(() =>
      expect(api.mintLocalApiTokenScoped).toHaveBeenCalledWith('test-token', 'stock-sync'),
    );
    await waitFor(() => expect(screen.getByTestId('local-api-token-row')).toBeInTheDocument());
    expect(screen.getByDisplayValue('jwt.abc.def')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-01/)).toBeInTheDocument();
  });

  it('mint failure surfaces an error toast', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    api.mintLocalApiTokenScoped.mockRejectedValueOnce(new Error('nope'));
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Generate Token'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    expect(screen.queryByTestId('local-api-token-row')).not.toBeInTheDocument();
  });

  it('rotate needs an explicit confirm and clears the minted token', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    // Mint a token first so we can assert rotation drops it.
    fireEvent.click(screen.getByText('Generate Token'));
    await waitFor(() => expect(screen.getByTestId('local-api-token-row')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    // Confirmation step shows the warning; nothing called yet.
    expect(screen.getByTestId('local-api-rotate-warning')).toBeInTheDocument();
    expect(api.rotateLocalApiSecretScoped).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate' }));
    await waitFor(() => expect(api.rotateLocalApiSecretScoped).toHaveBeenCalledWith('test-token'));
    await waitFor(() => expect(screen.queryByTestId('local-api-token-row')).not.toBeInTheDocument());
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('rotate cancel returns to the idle row without calling the command', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-rotate-row')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.rotateLocalApiSecretScoped).not.toHaveBeenCalled();
    expect(screen.queryByTestId('local-api-rotate-warning')).not.toBeInTheDocument();
  });

  it('rotate row is hidden while the API is disabled', async () => {
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalled());
    expect(screen.queryByTestId('local-api-rotate-row')).not.toBeInTheDocument();
  });

  it('rotate failure surfaces an error toast and keeps the confirm step', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    api.rotateLocalApiSecretScoped.mockRejectedValueOnce(new Error('boom'));
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-rotate-row')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate' }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    expect(screen.getByTestId('local-api-rotate-warning')).toBeInTheDocument();
  });

  it('disabling clears a minted token (survives re-enable)', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    api.setLocalApiEnabledScoped.mockResolvedValueOnce(STOPPED).mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Generate Token'));
    await waitFor(() => expect(screen.getByTestId('local-api-token-row')).toBeInTheDocument());
    // Disable → re-enable: the token row area is back, but the stale
    // token must NOT still be shown (it was cleared on disable).
    fireEvent.click(screen.getByRole('switch', { name: /toggle/i }));
    await waitFor(() => expect(screen.queryByTestId('local-api-status-row')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch', { name: /toggle/i }));
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    expect(screen.queryByTestId('local-api-token-row')).not.toBeInTheDocument();
  });

  it('store selector stays hidden on single-store installs', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
    await waitFor(() => expect(storesApi.listLocationsScoped).toHaveBeenCalledWith('test-token'));
    expect(screen.queryByTestId('local-api-store-row')).not.toBeInTheDocument();
  });

  it('store selector appears with multiple stores and switches', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    storesApi.listLocationsScoped.mockResolvedValue([STORE_DEFAULT, STORE_B]);
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-store-row')).toBeInTheDocument());
    const select = screen.getByLabelText('Served store') as HTMLSelectElement;
    expect(select.value).toBe('default');
    fireEvent.change(select, { target: { value: 'store-b' } });
    await waitFor(() =>
      expect(api.setLocalApiStoreScoped).toHaveBeenCalledWith('test-token', 'store-b'),
    );
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    // The switched status keeps the server running.
    await waitFor(() => expect(screen.getByTestId('local-api-status-row')).toBeInTheDocument());
  });

  it('store switch failure surfaces an error toast and refetches', async () => {
    api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
    storesApi.listLocationsScoped.mockResolvedValue([STORE_DEFAULT, STORE_B]);
    api.setLocalApiStoreScoped.mockRejectedValueOnce(new Error('boom'));
    render(<Wrapper><LocalApiSection /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('local-api-store-row')).toBeInTheDocument());
    const callsBefore = api.getLocalApiStatusScoped.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Served store'), { target: { value: 'store-b' } });
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    await waitFor(() =>
      expect(api.getLocalApiStatusScoped.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('polls status while enabled but not running', async () => {
    vi.useFakeTimers();
    try {
      api.getLocalApiStatusScoped.mockResolvedValue({ ...RUNNING, running: false, baseUrl: null });
      render(<Wrapper><LocalApiSection /></Wrapper>);
      await vi.waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(api.getLocalApiStatusScoped).toHaveBeenCalledTimes(2));
      // Converged to running → polling stops.
      api.getLocalApiStatusScoped.mockResolvedValue(RUNNING);
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getLocalApiStatusScoped).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(6000);
      expect(api.getLocalApiStatusScoped).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
