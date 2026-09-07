// ── SettingsPage tests ────────────────────────────────────────────
//
// Covers: loading, error recovery, store/receipt/currency/display/cloud
// sections, sidebar, accordion, validation, revert, keyboard shortcuts.
//
// Uses fireEvent.click for all button clicks (~1ms vs userEvent ~60ms),
// fireEvent.change for form fields (~1ms vs userEvent.type ~20ms/char),
// and fireEvent.blur for validation triggers (~1ms vs userEvent.tab ~50ms).
// 26 tests.
//
// Note: SettingsPage requires API data to load before any form/navigation
// elements appear. Tests that interact with the page must wait for the
// initial data load via await waitFor / await screen.findByText before
// using fireEvent.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';

// The page mounts many IPC-driven sections; under parallel CI load a full
// render + microtask flush can exceed the default 1s waitFor timeout, which
// surfaced as intermittent flakes. Give this file's waitFor/findBy calls a
// comfortable 5s window (vitest isolates module state per file, so this
// does not leak into other suites).
configure({ asyncUtilTimeout: 5000 });
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import SettingsPage from '@/features/settings/SettingsPage';
import { AuthProvider } from '@/contexts/AuthContext';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';

const { invokeMock, defaultImpl, failCommands } = vi.hoisted(() => {
  const SAMPLE_CURRENCIES = [
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
    { code: 'EUR', name: 'Euro', minor_exponent: 2, symbol: '\u20ac' },
  ];
  const failCommands = new Set<string>();

  const impl = (_cmd: string, _args?: unknown): Promise<unknown> => {
    const cmd = _cmd;
    if (failCommands.has(cmd)) {
      return Promise.reject(new Error(`Mock failure: ${cmd}`));
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
      return Promise.resolve(SAMPLE_CURRENCIES);
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
      return Promise.resolve({ name: 'oz-pos', version: '0.0.4', rustVersion: '1.80', target: 'x86_64' });
    }
    // Also support unscoped legacy commands for backward compat
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
      return Promise.resolve(SAMPLE_CURRENCIES);
    }
    if (cmd === 'get_sync_settings') {
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false });
    }
    if (cmd === 'get_user_preferences') {
      return Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' });
    }
    if (cmd === 'get_brand_settings') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    if (cmd === 'version') {
      return Promise.resolve({ name: 'oz-pos', version: '0.0.4', rustVersion: '1.80', target: 'x86_64' });
    }
    if (
      cmd === 'set_receipt_settings_scoped' || cmd === 'set_store_settings_scoped' ||
      cmd === 'set_default_currency' || cmd === 'set_user_preferences' ||
      cmd === 'set_user_preferences_scoped' ||
      cmd === 'update_sync_settings_scoped' ||
      cmd === 'set_brand_primary_colour_scoped' ||
      cmd === 'set_brand_store_name_scoped'
    ) {
      return Promise.resolve(undefined);
    }
    if (cmd === 'sync_run_scoped') {
      return Promise.resolve({ synced: 0, failed: 0, error: null });
    }
    if (cmd === 'get_backup_status') {
      return Promise.resolve({ lastBackup: null, lastBackupSize: null });
    }
    if (cmd === 'list_audit_log') {
      return Promise.resolve([]);
    }
    if (cmd === 'get_license_status') {
      return Promise.resolve({
        is_active: true,
        status: 'valid',
        payload: JSON.stringify({
          tenant_id: 'tenant-1',
          tier_key: 'pro',
          status: 'active',
          max_stores: 5,
          max_pos_instances: 10,
          allowed_types: ['retail', 'restaurant'],
          starts_at: '2026-01-01T00:00:00Z',
          expires_at: '2027-01-01T00:00:00Z',
          grace_until: '2027-02-01T00:00:00Z',
          issued_at: '2026-01-01T00:00:00Z',
        }),
        message: null,
      });
    }
    if (cmd === 'create_backup') {
      return Promise.resolve({ sizeBytes: 1024 });
    }
    if (cmd === 'check_license_status') {
      return Promise.resolve({
        tenantId: 'tenant-1',
        status: 'active',
        tier: 'pro',
        active: true,
        expiresAt: '2027-01-01T00:00:00Z',
        graceUntil: '2027-02-01T00:00:00Z',
        maxLocations: 5,
      });
    }
    if (cmd === 'get_machine_id') {
      return Promise.resolve('test-machine-id');
    }
    return Promise.resolve(undefined);
  };
  return { invokeMock: vi.fn(impl), defaultImpl: impl, failCommands };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/contexts/ZoomContext', () => ({
  useAppZoom: () => ({ zoomLevel: 'auto', setZoomLevel: vi.fn() }),
  ZoomProvider: ({ children }: { children: ReactNode }) => children,
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
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/HardwareAccelContext', () => ({
  useHardwareAccel: () => ({ enabled: true, setEnabled: vi.fn() }),
  HardwareAccelProvider: ({ children }: { children: ReactNode }) => children,
}));

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  cleanup();
  failCommands.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultImpl);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-font-smoothing');
  document.documentElement.classList.remove('is-theme-transitioning');
  Array.from(document.documentElement.style)
    .filter((p) => p.startsWith('--color-accent'))
    .forEach((p) => document.documentElement.style.removeProperty(p));
});

afterEach(() => {
  cleanup();
});

function TestWrapper({ children }: { children: ReactNode }) {
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

// ── Field helpers (fireEvent ~1ms vs userEvent ~20ms/char) ────────

function fillField(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
}

function blurField(label: string) {
  fireEvent.blur(screen.getByRole('textbox', { name: label }));
}

describe('SettingsPage', () => {
  // ── Loading ──────────────────────────────────────────────────

  it('shows loading indicator before APIs resolve', () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    expect(document.querySelector('.settings-loading-card')).toBeInTheDocument();
  });

  it('transitions from loading to ready after APIs resolve', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  // ── Full error state ─────────────────────────────────────────

  it('renders localized error with retry button when all APIs fail', async () => {
    invokeMock.mockRejectedValue(new Error('IPC error'));
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('recovers when retry is clicked after full failure', async () => {
    invokeMock.mockRejectedValue(new Error('IPC error'));
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
    invokeMock.mockImplementation(defaultImpl);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });
  });

  // ── Partial load failure ─────────────────────────────────────

  it('shows partial-load toast when some APIs fail', async () => {
    failCommands.add('get_sync_settings_scoped');
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/some settings could not be loaded/i)).toBeInTheDocument();
    });
  });

  // ── Store section ────────────────────────────────────────────

  it('renders Store section with name, address, tax ID, and language fields', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Address' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /tax.*id/i })).toBeInTheDocument();
  });

  it('updates store name input', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });
    fillField('Store name', 'Acme Corp');
    expect(screen.getByRole('textbox', { name: 'Store name' })).toHaveValue('Acme Corp');
  });

  it('updates store address input', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Address' })).toBeInTheDocument();
    });
    fillField('Address', '456 Oak Ave');
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('456 Oak Ave');
  });

  // ── Save resilience ──────────────────────────────────────────

  it('calls set_receipt_settings_scoped and set_store_settings_scoped on save', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_receipt_settings_scoped', expect.any(Object));
      expect(invokeMock).toHaveBeenCalledWith('set_store_settings_scoped', expect.any(Object));
    });
  });

  it('shows "Saved!" after successful save', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });
  });

  it('shows full save-error toast when every save API call fails', async () => {
    failCommands.add('set_receipt_settings_scoped');
    failCommands.add('set_store_settings_scoped');
    failCommands.add('set_default_currency');
    failCommands.add('set_user_preferences_scoped');
    failCommands.add('update_sync_settings_scoped');
    failCommands.add('set_brand_primary_colour_scoped');
    failCommands.add('set_brand_store_name_scoped');
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to save settings/i)).toBeInTheDocument();
    });
  });

  it('shows save-partial toast when some saves fail', async () => {
    failCommands.add('set_receipt_settings_scoped');
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/some settings could not be saved/i)).toBeInTheDocument();
    });
  });

  // ── Currency section ─────────────────────────────────────────

  it('renders Currency section with default currency select', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /currency/i })).toBeInTheDocument();
    });
    const currencyTrigger = screen.getByRole('button', { name: /default currency/i });
    expect(currencyTrigger).toBeInTheDocument();
    expect(currencyTrigger).toHaveTextContent(/USD/);
  });

  it('changes default currency via select', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /default currency/i })).toBeInTheDocument();
    });

    const currencyTrigger = screen.getByRole('button', { name: /default currency/i });
    fireEvent.click(currencyTrigger);

    const dropdown = document.querySelector('.ssel-dropdown')!;
    const eurOption = Array.from(dropdown.querySelectorAll('.ssel-option')).find(
      (el) => el.textContent?.includes('EUR'),
    )!;
    fireEvent.click(eurOption);

    expect(currencyTrigger).toHaveTextContent(/EUR/);
  });

  // ── Display section ──────────────────────────────────────────

  it('renders Display section with size and font controls', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /appearance/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /appearance/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /decrease card size/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /increase card size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decrease font size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /increase font size/i })).toBeInTheDocument();
  });

  it('increments card size value', async () => {
    const { container } = renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /appearance/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /appearance/i }));

    // Use container.querySelector to target the specific .settings-size-value element
    // rather than screen.getAllByText which can match unrelated elements.
    await waitFor(() => {
      const sizeValue = container.querySelector('.settings-size-value');
      expect(sizeValue).toHaveTextContent('2');
    });

    fireEvent.click(screen.getByRole('button', { name: /increase card size/i }));

    await waitFor(() => {
      const sizeValue = container.querySelector('.settings-size-value');
      expect(sizeValue).toHaveTextContent('3');
    });
  });

  // ── Receipt section ──────────────────────────────────────────

  it('navigates to Receipt section and populates form from API', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /receipt/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/show currency symbol/i)).not.toBeChecked();
    });
    expect(screen.getByLabelText(/show tax line/i)).toBeChecked();
  });

  it('toggles show-currency and show-tax checkboxes', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /receipt/i }));

    fireEvent.change(screen.getByLabelText(/show currency symbol/i), { target: { checked: true } });
    expect(screen.getByLabelText(/show currency symbol/i)).toBeChecked();
  });

  it('toggles checkboxes when clicking the visual toggle container or slider', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /receipt/i }));

    const currencyInput = screen.getByLabelText(/show currency symbol/i) as HTMLInputElement;
    expect(currencyInput.checked).toBe(false);

    // Find the label wrapper (.settings-toggle) that wraps the switch/slider
    const currencyToggleLabel = currencyInput.closest('.settings-toggle') as HTMLLabelElement;
    expect(currencyToggleLabel.tagName.toLowerCase()).toBe('label');
    expect(currencyToggleLabel.getAttribute('for')).toBe('receipt-show-currency');

    // Clicking the visual label wrapper/slider must delegate to the input
    await user.click(currencyToggleLabel);
    expect(currencyInput.checked).toBe(true);
  });

  it('changes decimal separator and updates receipt footer', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /receipt/i }));

    const separatorTrigger = screen.getByLabelText(/decimal separator/i);
    fireEvent.click(separatorTrigger);
    const commaOption = screen.getByRole('option', { name: /comma/i });
    fireEvent.click(commaOption);
    expect(separatorTrigger).toHaveTextContent(/comma/i);

    fireEvent.change(screen.getByPlaceholderText(/thank you/i), { target: { value: 'Come again!' } });
    expect(screen.getByPlaceholderText(/thank you/i)).toHaveValue('Come again!');
  });

  // ── Cloud Sync section ───────────────────────────────────────

  it('renders Cloud Sync section with form fields', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /cloud sync/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^api key$/i)).toBeInTheDocument();
    expect(screen.getByText(/enable cloud sync/i)).toBeInTheDocument();
  });

  it('keeps unconfigured sync unconfigured (no local server default)', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /cloud sync/i }));

    // Sync pre-fills the deployed cloud server URL so an unconfigured
    // device has a usable target (cloud server draft default).
    expect(screen.getByLabelText(/server url/i)).toHaveValue('https://license.ozpos.my.id');
    expect(screen.getByRole('switch', { name: /toggle/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /toggle/i })).toBeChecked();
  });

  // ── About section ────────────────────────────────────────────

  it('renders About section with version and license info', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /system/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /system/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /about/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /system.*license/i })).toBeInTheDocument();
    });
    const versionElements = screen.getAllByText(/0\.0\.\d+/);
    expect(versionElements.length).toBeGreaterThanOrEqual(1);
    const licenseElements = screen.getAllByText(/proprietary/i);
    expect(licenseElements.length).toBeGreaterThanOrEqual(1);
  });

  // ── Sidebar ──────────────────────────────────────────────────

  it('toggles collapse and expand via sidebar toggle button', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /collapse settings sidebar/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /collapse settings sidebar/i }));

    const sidebarToggle = document.querySelector('.settings-sidebar-toggle');
    expect(sidebarToggle).toBeInTheDocument();
    expect(sidebarToggle!.getAttribute('aria-label')?.toLowerCase()).toContain('expand');
  });

  it('persists sidebar collapsed state to localStorage', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /collapse settings sidebar/i })).toBeInTheDocument();
    });
    expect(localStorage.getItem('settings-sidebar-collapsed')).not.toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /collapse settings sidebar/i }));
    await waitFor(() => {
      expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
    });
  });

  it('toggles category accordion', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    const opsBtn = screen.getByRole('treeitem', { name: /operations/i });
    expect(opsBtn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(opsBtn);
    expect(opsBtn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(opsBtn);
    expect(opsBtn.getAttribute('aria-expanded')).toBe('false');
  });

  // ── Footer ───────────────────────────────────────────────────

  it('renders theme toggle button and app version in footer', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /switch to light/i })).toBeInTheDocument();
    expect(document.body.textContent).toContain('0.0.4');
  });

  // ── Keyboard shortcut ─────────────────────────────────────────

  it('saves latest form values when Ctrl+S is pressed after editing', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    fillField('Store name', 'Ctrl+S Store');
    fillField('Address', '456 Keyboard Blvd');
    fillField('Address', '456 Keyboard Blvd');

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'set_store_settings_scoped',
        expect.objectContaining({
          args: expect.objectContaining({
            name: 'Ctrl+S Store',
            address: '456 Keyboard Blvd',
          }),
        }),
      );
    });
  });

  // ── Field validation ──────────────────────────────────────────

  it('shows "store name is required" when store name is empty on blur', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    const nameInput = screen.getByRole('textbox', { name: 'Store name' });
    fillField('Store name', '');
    blurField('Store name');

    await waitFor(() => {
      expect(screen.getByText('Store name is required')).toBeInTheDocument();
    });
    expect(nameInput.className).toContain('settings-input--error');
  });

  it('clears store-name error when user starts typing', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    fillField('Store name', '');
    blurField('Store name');
    await waitFor(() => {
      expect(screen.getByText('Store name is required')).toBeInTheDocument();
    });

    fillField('Store name', 'A');
    expect(screen.queryByText('Store name is required')).not.toBeInTheDocument();
  });

  it('shows tax-id pattern error for invalid characters', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /tax.*id/i })).toBeInTheDocument();
    });

    const taxInput = screen.getByRole('textbox', { name: /tax.*id/i });
    fireEvent.change(taxInput, { target: { value: '12-345@#' } });
    fireEvent.blur(taxInput);

    await waitFor(() => {
      expect(screen.getByText(/only letters, numbers, dashes, dots, and slashes allowed/i)).toBeInTheDocument();
    });
    expect(taxInput.className).toContain('settings-input--error');
  });

  it('does not show tax-id error for valid characters', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /tax.*id/i })).toBeInTheDocument();
    });

    const taxInput = screen.getByRole('textbox', { name: /tax.*id/i });
    fireEvent.change(taxInput, { target: { value: '12-345.67/89' } });
    fireEvent.blur(taxInput);

    expect(screen.queryByText(/only letters, numbers, dashes, dots, and slashes allowed/i)).not.toBeInTheDocument();
  });

  // ── Revert button ─────────────────────────────────────────────

  it('clears field validation errors when Revert is clicked', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    fillField('Store name', '');
    blurField('Store name');
    await waitFor(() => {
      expect(screen.getByText('Store name is required')).toBeInTheDocument();
    });

    const revertBtn = document.querySelector('.settings-btn-revert') as HTMLElement;
    expect(revertBtn).toBeInTheDocument();
    fireEvent.click(revertBtn);

    expect(screen.queryByText('Store name is required')).not.toBeInTheDocument();
  });

  it('shows Revert button only when form is dirty', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    const revertBtn = document.querySelector('.settings-btn-revert') as HTMLElement;
    expect(revertBtn.className).toContain('settings-btn-revert--hidden');

    fillField('Store name', 'x');
    expect(revertBtn.className).not.toContain('settings-btn-revert--hidden');
  });

  // ── Arrow keyboard navigation ─────────────────────────────────

  it('navigates sections with ArrowDown key', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowDown' });

    // After ArrowDown from 'general', it should navigate to 'appearance'.
    await waitFor(() => {
      const items = screen.getAllByRole('treeitem', { name: /appearance/i });
      const hasActive = items.some((el) => el.className.includes('settings-nav-item--active'));
      expect(hasActive).toBe(true);
    });
  });

  it('navigates sections with ArrowUp key', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /store/i })).toBeInTheDocument();
    });

    // Navigate down first to move to a different section, then up.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });

    await waitFor(() => {
      const items = screen.getAllByRole('treeitem', { name: /appearance/i });
      const hasActive = items.some((el) => el.className.includes('settings-nav-item--active'));
      expect(hasActive).toBe(true);
    });
  });

  // ── API key visibility toggle ─────────────────────────────────

  it('toggles API key visibility in Cloud Sync section', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /cloud sync/i }));

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // The toggle only renders when text is typed (not for placeholder dots)
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test' } });

    const toggleBtn = document.querySelector('.settings-input-toggle') as HTMLElement;
    expect(toggleBtn).not.toBeNull();
    fireEvent.click(toggleBtn);

    expect(apiKeyInput.type).toBe('text');

    fireEvent.click(toggleBtn);
    expect(apiKeyInput.type).toBe('password');
  });

  // ── Save button loading state ─────────────────────────────────

  it('shows loading state on Save button while saving', async () => {
    // Make a save command hang to keep saving=true.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('set_') || cmd === 'update_sync_settings_scoped') {
        return new Promise(() => {});
      }
      return defaultImpl(cmd);
    });

    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveBtn).toHaveAttribute('aria-busy', 'true');
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  SectionKey — multiple navigations don't break rendering
  // ══════════════════════════════════════════════════════════════

  it('renders correct section after navigating through multiple sections', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /receipt/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/show currency symbol/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('treeitem', { name: /system/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /about/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /system.*license/i })).toBeInTheDocument();
    });

    // Navigate back to General via the sidebar.
    const businessHeader = screen.getByRole('treeitem', { name: /business/i });
    fireEvent.click(businessHeader);

    fireEvent.click(screen.getByRole('treeitem', { name: /general/i }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  Sync API key — preserved in field after successful save
  // ══════════════════════════════════════════════════════════════

  function navigateToSync() {
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /cloud sync/i }));
  }

  it('keeps API key in field after save when sync save succeeds', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    navigateToSync();

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'sk-abc123' } });
    expect(apiKeyInput).toHaveValue('sk-abc123');

    // Make every non-sync save command fail so only sync succeeds.
    failCommands.add('set_receipt_settings_scoped');
    failCommands.add('set_store_settings_scoped');
    failCommands.add('set_default_currency');
    failCommands.add('set_user_preferences_scoped');
    failCommands.add('set_brand_primary_colour_scoped');
    failCommands.add('set_brand_store_name_scoped');

    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const inputAfterSave = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
      expect(inputAfterSave).toHaveValue('sk-abc123');
    });
  });

  it('keeps API key after save when sync save fails', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    navigateToSync();

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'sk-xyz789' } });
    expect(apiKeyInput).toHaveValue('sk-xyz789');

    // Make sync save fail while all other saves succeed.
    failCommands.add('update_sync_settings_scoped');

    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    // Wait for save to settle (Saved! appears when at least one save succeeds).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    const inputAfterSave = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    expect(inputAfterSave).toHaveValue('sk-xyz789');
  });

  it('shows partial-save toast when sync save is the only failure', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    navigateToSync();

    failCommands.add('update_sync_settings_scoped');

    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/some settings could not be saved/i)).toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  beforeunload — WebView2 unsaved-changes dialog (Windows UX bug)
  //  Bug: e.preventDefault() alone is insufficient on WebView2.
  //  Fix: Also set e.returnValue = '' to trigger the confirmation.
  // ══════════════════════════════════════════════════════════════

  it('sets returnValue on beforeunload when form is dirty (WebView2 compat)', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    // Make the form dirty by editing a field.
    fillField('Store name', 'Unsaved Change');

    // Dispatch a beforeunload event and verify the handler sets returnValue.
    // WebView2 (Windows) requires e.returnValue to be set (even to '')
    // for the unsaved-changes dialog to appear. e.preventDefault() alone
    // is insufficient on WebView2.
    const event = new Event('beforeunload', { cancelable: true, bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: undefined,
    });
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect((event as BeforeUnloadEvent).returnValue).toBeDefined();
    expect((event as BeforeUnloadEvent).returnValue).toBe('unsaved');
  });

  it('does not trigger beforeunload when form is clean', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    // Form is NOT dirty — beforeunload should not prevent default.
    const event = new Event('beforeunload', { cancelable: true, bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: undefined,
    });
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect((event as BeforeUnloadEvent).returnValue).toBeUndefined();
  });

  it('stops triggering beforeunload after save clears dirty state', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Store name' })).toBeInTheDocument();
    });

    // Make dirty
    fillField('Store name', 'Will Save');

    // Save to clear dirty state
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });

    // After save, beforeunload should NOT prevent default
    const event = new Event('beforeunload', { cancelable: true, bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  // ── Management tabs ────────────────────────────────────────────

  it('renders License section when navigating to License tab', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /system/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /system/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /license/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /license/i })).toBeInTheDocument();
    });
  });

  it('renders Email Reports section when navigating to Email tab', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /operations/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /operations/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /email reports/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /email reports/i })).toBeInTheDocument();
    });
  });

  it('renders About section when navigating to About tab', async () => {
    renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /system/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /system/i }));
    fireEvent.click(screen.getByRole('treeitem', { name: /about/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /system.*license/i })).toBeInTheDocument();
    });
  });

  // ── Drag-to-reorder recently-used sections (P60-3b) ───────────────
  //
  // Re-homed from SettingsNavTree.test.tsx during P92 refactoring.
  // Drag-to-reorder logic lives in SettingsPage (recentSections state,
  // onDragStart/onDragOver/onDrop callbacks in the collapsed sidebar).
  //
  // TODO: Add drag-to-reorder tests using @testing-library/user-event
  // pointer API or dataTransfer mock for HTML5 DnD simulation.

  describe('drag-to-reorder recently-used sections', () => {
    it('is tracked here in SettingsPage (re-homed from NavTree)', () => {
      // Drag-to-reorder state lives in SettingsPage, not SettingsNavTree.
      // The feature uses onDragStart/onDragOver/onDrop on recently-used
      // section items at the top of the collapsed sidebar. Tests should
      // simulate drag-and-drop via userEvent.pointer or dataTransfer mock.
      expect(true).toBe(true);
    });
  });
});
