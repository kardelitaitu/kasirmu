//! A11y regression tests for RestaurantPaymentsScreen.
//!
//! The payment-rails screen owns every tender the restaurant POS can offer —
//! cash, QRIS, card/EDC, Midtrans, Stripe, open bill and credit — across a
//! stack of expandable cards, segmented groups and inputs. It had no axe
//! coverage while RestaurantMenu, RestaurantSidebar and RestaurantReceiptsScreen
//! did. Renders with the rails/EDC/gateway mocks RestaurantPaymentsScreen.test.tsx
//! uses so the cards mount rather than the loading or load-error branch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import RestaurantPaymentsScreen from '@/features/restaurant/screens/RestaurantPaymentsScreen';

const mocks = vi.hoisted(() => ({
  getPrimary: vi.fn(),
  getMethods: vi.fn(),
  setMethods: vi.fn(),
  listEdc: vi.fn(),
  edcStatus: vi.fn(),
  hwSave: vi.fn(),
  getGateway: vi.fn(),
  setGateway: vi.fn(),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mocks.getPrimary(...args),
}));

vi.mock('@/api/local-payment', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    getLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.getMethods(...args),
    setLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.setMethods(...args),
  };
});

vi.mock('@/api/payment-gateways', () => ({
  getPaymentGatewayConfigScoped: (...args: unknown[]) => mocks.getGateway(...args),
  setPaymentGatewayConfigScoped: (...args: unknown[]) => mocks.setGateway(...args),
  listPaymentGatewaysScoped: vi.fn().mockResolvedValue([]),
  deletePaymentGatewayScoped: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: (...args: unknown[]) => mocks.listEdc(...args),
  edcTerminalStatusScoped: (...args: unknown[]) => mocks.edcStatus(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', terminalId: 'term-1' }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'test', role_name: 'manager', token: 't', role_id: 'r', display_name: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: false,
  }),
}));

vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: () => ({
    profile: {
      terminalId: 'term-1',
      hardware: {
        printer: { connection: 'usb', devicePath: '/dev/usb/lp0', paperSize: '80' as const, testPrintIp: '' },
        scale: { connection: 'none' as const, devicePath: '', baudRate: 9600, zeroOnBoot: false },
        scanner: { mode: 'keyboard' as const, deviceId: '' },
      },
      localPrefs: { defaultEdcTerminalId: '' },
      initialized: '2026-01-01T00:00:00Z',
      version: 1,
    },
    isLoading: false,
    error: null,
    updatePrinter: vi.fn(),
    updateScale: vi.fn(),
    updateScanner: vi.fn(),
    updateLocalPrefs: vi.fn(),
    save: mocks.hwSave,
    reload: vi.fn(),
  }),
}));

const RAILS = [
  { rail_code: 'cash', label: 'Cash', is_enabled: true, parameters: '{}', scope: 'entity' as const },
  { rail_code: 'qris', label: 'QRIS', is_enabled: true, parameters: '{}', scope: 'location' as const },
  { rail_code: 'card', label: 'Card', is_enabled: true, parameters: '{}', scope: 'entity' as const },
  { rail_code: 'gopay', label: 'GoPay', is_enabled: true, parameters: '{}', scope: 'location' as const },
];

beforeEach(() => {
  mocks.getPrimary.mockReset().mockResolvedValue({ id: 'loc-1' });
  mocks.getMethods.mockReset().mockResolvedValue(RAILS.map((r) => ({ ...r })));
  mocks.setMethods.mockReset().mockResolvedValue([]);
  mocks.listEdc.mockReset().mockResolvedValue([]);
  mocks.edcStatus.mockReset().mockResolvedValue({ status: 'ready' });
  mocks.hwSave.mockReset().mockResolvedValue(undefined);
  mocks.getGateway.mockReset().mockResolvedValue(null);
  mocks.setGateway.mockReset().mockResolvedValue({ id: 'gw-1' });
});

describe('RestaurantPaymentsScreen a11y', () => {
  it('has no axe violations with the payment cards mounted', async () => {
    // The axe-helper's provider stack supplies its own minimal Fluent bundle;
    // this test asserts accessible NAMES exist, not that the copy is translated
    // (the i18n sweeps cover that), so the real bundles are not needed here.
    const { container } = renderWithProviders(<RestaurantPaymentsScreen />);

    // Let the async rail reads settle, then pin that the real card list mounted.
    // Without this the axe pass could be clearing the loading line alone.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="payment-card-cash"]')).toBeTruthy();
    });
    await checkA11y(container);

    expect(container.querySelector('[data-testid="payment-card-qris"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="payment-card-card"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="restaurant-payments-load-error"]')).toBeNull();
  });
});
