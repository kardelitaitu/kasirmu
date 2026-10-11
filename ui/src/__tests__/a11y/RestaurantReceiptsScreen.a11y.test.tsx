//! A11y regression tests for RestaurantReceiptsScreen.
//!
//! The receipt/printer settings screen is the densest control surface in the
//! restaurant POS — 9 switches, 4 margin inputs, segmented groups, the live
//! receipt preview and the printer hardware card — and it had no axe coverage
//! while RestaurantMenu and RestaurantSidebar did. Renders the screen with the
//! same API mocks RestaurantReceiptsScreen.test.tsx uses so the cards mount
//! fully rather than showing the load-error branch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { useSubscription } from '@/contexts/SubscriptionContext';
import RestaurantReceiptsScreen from '@/features/restaurant/screens/RestaurantReceiptsScreen';

beforeEach(() => {
  vi.mocked(useSubscription).mockReturnValue({
    caps: null,
    state: 'active',
    loading: false,
    refresh: vi.fn(),
  });
});

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

vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>();
  return {
    ...actual,
    getUserPreferencesScoped: vi.fn().mockResolvedValue({}),
    setUserPreferencesScoped: vi.fn().mockResolvedValue(undefined),
    getReceiptSettingsScoped: vi.fn().mockResolvedValue({ showTableNumber: false }),
    setReceiptSettingsScoped: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/api/receipt-format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/receipt-format')>();
  return {
    ...actual,
    getReceiptFormatScoped: vi.fn().mockResolvedValue({
      layout: {
        paperWidthMm: 80,
        marginTopMm: 5,
        marginBottomMm: 8,
        marginLeftMm: 3,
        marginRightMm: 3,
        showLogo: null,
        printCopies: null,
        showTableNumber: false,
        footerNote: '',
      },
      content: {
        showTax: true,
        showCurrency: false,
        footerText: '',
        decimalSeparator: 'dot',
        requiredFields: [],
      },
      contentSource: 'workspace',
      layoutSource: 'workspace',
    }),
    setReceiptLayoutScoped: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@/api/hardware', async () => {
  const actual = await vi.importActual<typeof import('@/api/hardware')>('@/api/hardware');
  return {
    ...actual,
    listDisplays: vi.fn(() => Promise.resolve([])),
    displayShow: vi.fn(() => Promise.resolve()),
    displayClear: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sales')>();
  return { ...actual, printSalesReceipt: vi.fn().mockResolvedValue({ printed: true }) };
});

describe('RestaurantReceiptsScreen a11y', () => {
  it('has no axe violations with the settings cards mounted', async () => {
    const { container } = renderWithProviders(<RestaurantReceiptsScreen />);
    // Let the async settings/hardware reads settle so the printer card and the
    // preview render their real content rather than the loading state.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-receipts-save-btn"]')).toBeTruthy();
    });
    await checkA11y(container);

    // Guard against a VACUOUS pass: if the settings read failed, the screen
    // renders only the load-error banner, which axe would also clear — so a
    // green result would say nothing about the control surface. Pin that the
    // preview, the display switches and the printer card actually mounted.
    expect(container.querySelector('.resto-receipt-paper')).toBeTruthy();
    expect(container.querySelectorAll('.resto-switch-btn').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelector('#resto-hw-printer-conn')).toBeTruthy();
    // And that the load-error branch did NOT take over.
    expect(container.querySelector('[data-testid="restaurant-receipts-load-error"]')).toBeNull();
  });
});
