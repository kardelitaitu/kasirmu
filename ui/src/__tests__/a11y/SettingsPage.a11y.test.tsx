//! A11y regression tests for SettingsPage.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import SettingsPage from '@/features/settings/SettingsPage';

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
    sessionToken: 'test-token-123',
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { username: 'test', role: 'owner', displayName: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: true,
  }),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: () =>
    Promise.resolve({
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: 'kasir.mu',
    }),
  getBrandSettingsScoped: () =>
    Promise.resolve({
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: 'kasir.mu',
    }),
}));

vi.mock('@/api/settings', () => ({
  getReceiptSettingsScoped: vi.fn(() => Promise.resolve({ showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '', paperWidth: 'standard', showTableNumber: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 })),
  getStoreSettingsScoped: vi.fn(() => Promise.resolve({ name: 'Test Store', address: '', taxId: '', currency: 'IDR', branch: '' })),
  getUserPreferencesScoped: vi.fn(() => Promise.resolve({})),
  // SettingsPage mounts SettingsProvider, which subscribes via this wrapper
  // (ui/src/api/settings.ts); a11y tests do not exercise the event bus.
  onSettingsUpdated: vi.fn(() => Promise.resolve(async () => {})),
}));

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ tier: 'pro', valid: true })),
}));

vi.mock('@/api/system', () => ({
  getVersionScoped: vi.fn(() => Promise.resolve({ version: '0.0.19' })),
}));

vi.mock('@/api/currency', () => ({
  listCurrenciesScoped: vi.fn(() => Promise.resolve([{ code: 'IDR', name: 'Rupiah', symbol: 'Rp' }])),
}));

vi.mock('@/api/offline', () => ({
  getSyncSettingsScoped: vi.fn(() => Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false })),
  updateSyncSettings: vi.fn(),
  syncRun: vi.fn(),
  syncPull: vi.fn(),
  pendingSyncCount: vi.fn(() => Promise.resolve(0)),
  testSyncConnection: vi.fn(),
  requestSyncToken: vi.fn(),
}));


vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

describe('SettingsPage a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<SettingsPage />);
    await checkA11y(container);
  });
});
