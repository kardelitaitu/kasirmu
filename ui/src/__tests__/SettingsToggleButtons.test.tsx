/**
 * @file SettingsToggleButtons.test.tsx
 * @description Regression test suite ensuring all settings toggle buttons (enable/disable switches)
 * across the receipt/sync toggle owners (ReceiptSection/SyncSection), AppearanceSettings, and DataManagementScreen
 * are properly structured as <label htmlFor="...">
 * elements or wrap their inputs so that clicks on the visual slider track/wrapper delegate to the checkbox input.
 * Prevents regression where wrapper divs/spans blocked toggle button clicks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import ReceiptSection from '@/features/settings/sections/ReceiptSection';
import SyncSection from '@/features/settings/sections/SyncSection';
import { AppearanceSettings } from '@/features/settings/AppearanceSettings';
import DataManagementScreen from '@/features/settings/DataManagementScreen';
import { AuthProvider } from '@/contexts/AuthContext';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';
import type { ReactLocalization } from '@fluent/react';
import type { SyncSettingsDto } from '@/api/offline';
import type { ReceiptSettingsDto } from '@/api/settings';

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

// ── Mocks for AppearanceSettings & DataManagementScreen ────────────

const mockGetBrandSettings = vi.fn();
const mockSetHwAccelEnabled = vi.fn();

vi.mock('@/api/branding', () => ({
  getBrandSettings: () => mockGetBrandSettings(),
  // 5e7ee83e switched AppearanceSettings.tsx:83 to the scoped command but left this mock
  // without the export, so the suite failed with "No getBrandSettingsScoped export is defined
  // on the @/api/branding mock" -- a hard error rather than an assertion failure, which means
  // the scoped branch cannot be exercised at all. Same defect as WeightScaleWidget (65971d0f),
  // useBarcodeScanner (0b7f9e18), ScaleIndicator (29bb5586) and useWarehouseScanner (0b7f9e18's
  // twin): a scoped twin added to a component without being added to the mocks that render it.
  // Delegates to the same fn so a test asserting either path sees one value.
  getBrandSettingsScoped: (token: string) => mockGetBrandSettings(token),
  setBrandPrimaryColour: vi.fn().mockResolvedValue(undefined),
  setBrandLogoPath: vi.fn().mockResolvedValue(undefined),
  setBrandStoreName: vi.fn().mockResolvedValue(undefined),
  pickLogoFile: vi.fn().mockResolvedValue(null),
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
    sessionToken: null,
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/HardwareAccelContext', () => ({
  useHardwareAccel: () => ({ enabled: true, setEnabled: (val: boolean) => mockSetHwAccelEnabled(val) }),
  HardwareAccelProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/BrandContext', () => ({
  useBrand: () => ({
    settings: {
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: '',
    },
    refreshBrandSettings: vi.fn(),
  }),
  BrandProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/utils/color', () => {
  const mock = {
    deriveAccentPalette: vi.fn().mockReturnValue({}),
    applyAccentPalette: vi.fn(),
    applyThemeContrasts: vi.fn(),
  };
  return mock;
});

const mockAddToast = vi.fn();
vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/api/data', () => ({
  getBackupStatus: vi.fn().mockResolvedValue({ lastBackup: null, lastBackupSize: null }),
  createBackup: vi.fn().mockResolvedValue({ path: '/backups/backup.db', sizeBytes: 1000 }),
  // The AppearanceSettings/DataManagement tabs render under the harness session token, and
  // DataManagementScreen now reaches for the scoped twins; a missing export here is a hard
  // module error, not a failed assertion. See DataManagementBackup.test.tsx.
  getBackupStatusScoped: vi.fn().mockResolvedValue({ lastBackup: null, lastBackupSize: null }),
  createBackupScoped: vi.fn().mockResolvedValue({ path: '/backups/backup.db', sizeBytes: 1000 }),
  exportData: vi.fn().mockResolvedValue({ path: '/path/to/export.ozpkg', sizeBytes: 500, types: ['products'] }),
  importPreview: vi.fn().mockResolvedValue({ storeName: 'Test Store', appVersion: '0.0.9', exportedAt: '2026-01-01', counts: {} }),
  importData: vi.fn().mockResolvedValue({ inserted: 10, updated: 2, errors: [] }),
  pickExportPath: vi.fn().mockResolvedValue('/path/to/export.ozpkg'),
  pickImportFile: vi.fn().mockResolvedValue('/path/to/import.ozpkg'),
}));

// ── SettingsPage mocks ──────────────────────────────────────────────

const { invokeMock, defaultImpl } = vi.hoisted(() => {
  const SAMPLE_CURRENCIES = [
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
  ];

  const defaultImpl = async (cmd: string) => {
    switch (cmd) {
      case 'get_store_settings_scoped':
        return { name: 'Store', address: 'Address', taxId: 'TAX-1', currency: 'IDR', branch: '' };
      case 'get_receipt_settings_scoped':
        return {
          showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
          paperWidth: 'standard', showTableNumber: false, showCustomerName: true, showOrderNotes: true,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
        };
      case 'get_display_settings':
      case 'get_user_preferences_scoped':
        return { cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' };
      case 'get_cloud_sync_settings':
      case 'get_sync_settings_scoped':
        return { serverUrl: null, hasApiKey: false, enabled: false };
      case 'get_all_currencies':
      case 'list_currencies_scoped':
        return SAMPLE_CURRENCIES;
      case 'get_default_currency':
        return 'USD';
      case 'get_brand_settings_scoped':
        return { primary_colour: '#147EFB', logo_path: null, store_name: '' };
      case 'get_app_version':
      case 'version_scoped':
        return { name: 'oz-pos', version: '0.0.9', rustVersion: '1.80', target: 'x86_64' };
      case 'check_license_status':
        return { tier: 'pro', tenantId: 'tenant-1', status: 'active', active: true, expiresAt: null, maxLocations: 5 };
      case 'pending_sync_count':
        return 0;
      case 'get_device_id':
        return 'device-1';
      case 'list_terminals':
      case 'list_terminals_scoped':
        return [];
      case 'offline_queue_status_summary':
        return { pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0, lastSyncedAt: null, oldestPendingAt: null };
      case 'get_sync_plan':
        return { ok: true, plan: 'free', status: 'free' };
      default:
        console.warn('UNHANDLED INVOKE COMMAND:', cmd);
        return null;
    }
  };

  return { invokeMock: vi.fn(defaultImpl), defaultImpl };
});

vi.mock('@tauri-apps/api/core', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (cmd: string, args?: unknown) => (invokeMock as any)(cmd, args),
}));

Element.prototype.scrollIntoView = vi.fn();

// Minimal ReactLocalization stand-in: the receipt/sync toggle owners (ReceiptSection,
// SyncSection) take `l10n` as a prop. This suite only asserts their toggle DOM, so a
// pass-through getString (ids fall back to themselves via requiredLocalized) suffices.
const testL10n = {
  getString: (id: string) => id,
} as unknown as ReactLocalization;

const INITIAL_RECEIPT: ReceiptSettingsDto = {
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
};

// Stateful hosts: the old suite reached these toggles through SettingsPage, which owned
// the receipt/sync state, so clicking a wrapper flipped the checked state via the real
// setter. The hosts preserve that stateful arrangement around the direct section mounts.
function ReceiptToggleHost() {
  const [receipt, setReceipt] = useState(INITIAL_RECEIPT);
  return (
    <ReceiptSection
      receipt={receipt}
      setReceipt={setReceipt}
      setDecimalSep={vi.fn()}
      markDirty={vi.fn()}
      l10n={testL10n}
    />
  );
}

const INITIAL_SYNC: SyncSettingsDto = { serverUrl: null, hasApiKey: false, enabled: false };

function SyncToggleHost() {
  const [sync, setSync] = useState(INITIAL_SYNC);
  return (
    <SyncSection
      sync={sync}
      setSync={setSync}
      syncServerUrl=""
      setSyncServerUrl={vi.fn()}
      syncApiKey=""
      setSyncApiKey={vi.fn()}
      syncApiKeyVisible={false}
      setSyncApiKeyVisible={vi.fn()}
      syncing={false}
      setSyncing={vi.fn()}
      pulling={false}
      setPulling={vi.fn()}
      syncResult={null}
      setSyncResult={vi.fn()}
      pullResult={null}
      setPullResult={vi.fn()}
      queueSummary={null}
      syncPlan={null}
      testing={false}
      setTesting={vi.fn()}
      pingResult={null}
      setPingResult={vi.fn()}
      requesting={false}
      setRequesting={vi.fn()}
      tokenExpiresAt={null}
      setTokenExpiresAt={vi.fn()}
      cmInput={{} as React.HTMLAttributes<HTMLInputElement>}
      markDirty={vi.fn()}
      refreshQueueSummary={vi.fn()}
      testSyncConnection={vi.fn()}
      syncRun={vi.fn()}
      syncPull={vi.fn()}
      requestSyncToken={vi.fn()}
      l10n={testL10n}
      addToast={vi.fn()}
    />
  );
}

describe('Settings Toggle Buttons Regression Suite', () => {
  beforeEach(() => {
    mockSetHwAccelEnabled.mockClear();
    mockGetBrandSettings.mockResolvedValue({ primary_colour: '#147EFB', logo_path: null, store_name: '' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (invokeMock as any).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (invokeMock as any).mockImplementation((cmd: any) => defaultImpl(cmd));
  });

  it('ensures all 4 toggle buttons are structured as <label htmlFor="..."> and delegate clicks', async () => {
    const user = userEvent.setup();
    // The flat-IA settings rebuild replaced the Operations → Receipt / Cloud Sync tab tree
    // with 13 scaffold pages that intentionally render no controls (SettingsNavTree.tsx;
    // screens/GeneralScreen.tsx:5 "Intentionally renders no controls"). The receipt and sync
    // toggles still live in their owning components (sections/ReceiptSection.tsx,
    // sections/SyncSection.tsx), so this suite mounts those directly — the DOM contract under
    // test (label[for] + click delegation) is unchanged. No current page button renders them.
    renderWithProvidersSync(
      <TestWrapper>
        <ReceiptToggleHost />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    // Receipt section: show-currency, show-tax, show-table-number live here
    await waitFor(() => {
      expect(document.getElementById('receipt-show-currency')).not.toBeNull();
    });

    const expectedToggleIds = [
      'receipt-show-currency',
      'receipt-show-tax',
      'receipt-show-table-number',
    ];

    for (const inputId of expectedToggleIds) {
      const input = document.getElementById(inputId) as HTMLInputElement;
      expect(input, `Input #${inputId} should exist`).not.toBeNull();

      const toggleWrapper = input.closest('.settings-toggle') as HTMLLabelElement;
      expect(toggleWrapper, `Wrapper for #${inputId} should have .settings-toggle class`).not.toBeNull();
      expect(toggleWrapper.tagName.toLowerCase(), `Wrapper for #${inputId} MUST be a <label>`).toBe('label');
      expect(toggleWrapper.getAttribute('for'), `Wrapper for #${inputId} MUST have for="${inputId}"`).toBe(inputId);

      // Verify that clicking the label wrapper delegates click and toggles checked state
      const initialChecked = input.checked;
      await user.click(toggleWrapper);
      expect(input.checked, `Clicking .settings-toggle wrapper should toggle input #${inputId}`).toBe(!initialChecked);
    }

    // Sync section: sync-enabled lives here. The old IA reached it by clicking the
    // "Cloud Sync" nav button; the flat IA has no such page, so mount the owner directly.
    cleanup();
    renderWithProvidersSync(
      <TestWrapper>
        <SyncToggleHost />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );
    await waitFor(() => {
      expect(document.getElementById('sync-enabled')).not.toBeNull();
    });
    const syncInput = document.getElementById('sync-enabled') as HTMLInputElement;

    const syncWrapper = syncInput.closest('.settings-toggle') as HTMLLabelElement;
    expect(syncWrapper, 'Wrapper for #sync-enabled should have .settings-toggle class').not.toBeNull();
    expect(syncWrapper.tagName.toLowerCase(), 'Wrapper for #sync-enabled MUST be a <label>').toBe('label');
    expect(syncWrapper.getAttribute('for'), 'Wrapper for #sync-enabled MUST have for="sync-enabled"').toBe('sync-enabled');

    const initialSyncChecked = syncInput.checked;
    await user.click(syncWrapper);
    expect(syncInput.checked, 'Clicking .settings-toggle wrapper should toggle #sync-enabled').toBe(!initialSyncChecked);
  });

  it('ensures Hardware Acceleration toggle in AppearanceSettings uses <label htmlFor="..."> and delegates clicks', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<AppearanceSettings />, settingsFtl, sharedFtl);

    await waitFor(() => {
      // The switch's accessible name comes from the appearance-hw-accel-aria
      // message (aria-label), wired via <Localized attrs> — not from the
      // visible "Hardware Acceleration" label.
      expect(screen.getByRole('switch', { name: 'Toggle hardware acceleration' })).toBeInTheDocument();
    });

    const hwInput = document.getElementById('hw-accel-checkbox') as HTMLInputElement;
    expect(hwInput).not.toBeNull();

    const hwWrapper = hwInput.closest('.settings-toggle') as HTMLLabelElement;
    expect(hwWrapper, 'Wrapper for Hardware Acceleration should have .settings-toggle class').not.toBeNull();
    expect(hwWrapper.tagName.toLowerCase(), 'Wrapper for Hardware Acceleration MUST be a <label>').toBe('label');
    expect(hwWrapper.getAttribute('for'), 'Wrapper MUST have for="hw-accel-checkbox"').toBe('hw-accel-checkbox');

    // Clicking the toggle wrapper should trigger onChange handler
    await user.click(hwWrapper);
    expect(mockSetHwAccelEnabled).toHaveBeenCalledWith(false);
  });

  it('ensures checkbox rows in DataManagementScreen use <label htmlFor="..."> and delegate clicks', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<DataManagementScreen />, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Select all / none')).toBeInTheDocument();
    });

    const selectAllInput = document.getElementById('type-select-all') as HTMLInputElement;
    expect(selectAllInput).not.toBeNull();

    const selectAllWrapper = selectAllInput.closest('.data-mgmt-type-checkbox') as HTMLLabelElement;
    expect(selectAllWrapper).not.toBeNull();
    expect(selectAllWrapper.tagName.toLowerCase(), 'Export checkbox wrapper MUST be a <label>').toBe('label');
    expect(selectAllWrapper.getAttribute('for'), 'Export checkbox wrapper MUST have for="type-select-all"').toBe('type-select-all');

    const initialChecked = selectAllInput.checked;
    await user.click(selectAllWrapper);
    expect(selectAllInput.checked, 'Clicking export label wrapper should toggle state').toBe(!initialChecked);
  });
});
