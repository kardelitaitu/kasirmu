//! A11y regression tests for RestaurantSettingsScreen.
//!
//! The behaviour-settings screen is the last restaurant screen without axe
//! coverage — the eight toggles that decide how a restaurant order behaves
//! (customer name, guest count, order type, save tab, course firing, auto-print
//! kitchen, sound chime, interaction sound). It mounts with plain API mocks and
//! the REAL products + settings bundles, so every switch's accessible name is
//! the shipped copy rather than a key id.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import RestaurantSettingsScreen from '@/features/restaurant/screens/RestaurantSettingsScreen';
import productsFtl from '@/locales/products.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [productsFtl, settingsFtl];

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSettings: vi.fn(),
  getReceiptSettings: vi.fn(),
  setReceiptSettings: vi.fn(),
}));

vi.mock('@/api/settings', () => ({
  getSettingScoped: (...args: unknown[]) => mocks.getSetting(...args),
  setSettingsScoped: (...args: unknown[]) => mocks.setSettings(...args),
  getReceiptSettingsScoped: (...args: unknown[]) => mocks.getReceiptSettings(...args),
  setReceiptSettingsScoped: (...args: unknown[]) => mocks.setReceiptSettings(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-session-tok-1' }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useOptionalSettings: () => ({
    refresh: vi.fn().mockResolvedValue(undefined),
    markSettingsUpdated: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSetting.mockReset().mockResolvedValue('true');
  mocks.setSettings.mockReset().mockResolvedValue(undefined);
  mocks.getReceiptSettings.mockReset().mockResolvedValue({ showTableNumber: false });
  mocks.setReceiptSettings.mockReset().mockResolvedValue(undefined);
});

describe('RestaurantSettingsScreen a11y', () => {
  it('has no axe violations with the behaviour toggles loaded', async () => {
    const { container } = renderWithProviders(<RestaurantSettingsScreen />, ...FTL);

    // Wait for the settings read to settle, then pin that the real toggle list
    // mounted rather than the loading line (which axe would also clear).
    await waitFor(() => {
      expect(container.querySelector('[data-testid="setting-toggle-customer-name"]')).toBeTruthy();
    });
    await checkA11y(container);

    // Vacuity guard: the switch controls are the surface this case is about.
    expect(container.querySelector('[data-testid="setting-toggle-guest-count"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="setting-toggle-sound-chime"]')).toBeTruthy();
  });
});
