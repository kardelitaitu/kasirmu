/**
 * @file RestaurantSettingsScreen.test.tsx
 * @description Component-level test suite for RestaurantSettingsScreen.
 * Covers:
 * - Mount and load settings from API (getSettingScoped)
 * - Rendering of the behavior toggles (customer name, guest count, order type,
 *   hold order, save tab, course firing, auto-print kitchen, sound chime)
 * - Toggling values and dirty tracking
 * - Saving settings via setSettingsScoped
 * - Unsaved changes confirmation dialog on back navigation
 *
 * Table number is deliberately NOT covered: it is no longer a control on this
 * screen. Table capture is unconditional on restaurant POS and the only
 * table-number toggle is the PRINT one in RestaurantReceiptsScreen. Asserted
 * below so a future re-add is a deliberate act rather than a regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import RestaurantSettingsScreen, { type RestaurantSettingsScreenProps } from '@/features/restaurant/screens/RestaurantSettingsScreen';
import productsFtl from '@/locales/products.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [productsFtl, settingsFtl];

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSettings: vi.fn(),
  getReceiptSettings: vi.fn(),
  setReceiptSettings: vi.fn(),
  sessionToken: 'test-session-tok-1',
}));

vi.mock('@/api/settings', () => ({
  getSettingScoped: (...args: unknown[]) => mocks.getSetting(...args),
  setSettingsScoped: (...args: unknown[]) => mocks.setSettings(...args),
  getReceiptSettingsScoped: (...args: unknown[]) => mocks.getReceiptSettings(...args),
  setReceiptSettingsScoped: (...args: unknown[]) => mocks.setReceiptSettings(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: mocks.sessionToken }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useOptionalSettings: () => ({
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

function renderScreen(props: RestaurantSettingsScreenProps = {}) {
  return renderWithProviders(<RestaurantSettingsScreen {...props} />, ...FTL);
}

describe('RestaurantSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetting.mockReset();
    mocks.setSettings.mockReset();
    mocks.getReceiptSettings.mockReset();
    mocks.setReceiptSettings.mockReset();

    mocks.getSetting.mockResolvedValue('true');
    mocks.setSettings.mockResolvedValue(undefined);
  });

  it('renders all restaurant behavior toggles after loading', async () => {
    await renderScreen();

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).toBeNull();
    });

    expect(screen.queryByTestId('setting-toggle-table-number')).toBeNull();
    expect(screen.getByTestId('setting-toggle-customer-name')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-guest-count')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-order-type')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-hold-order')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-save-tab')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-course-firing')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-auto-print-kitchen')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-sound-chime')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-interaction-sound')).toBeInTheDocument();
    expect(screen.getByTestId('setting-toggle-interaction-vibration')).toBeInTheDocument();
    expect(screen.getByText(/Mobile\/Tablet only \(not on Win\/Linux\/Mac\)/i)).toBeInTheDocument();
  });

  it('reflects loaded settings in switch roles', async () => {
    mocks.getSetting.mockImplementation((_tok: string, key: string) => {
      if (key === 'restaurant.hold_order') return Promise.resolve('false');
      if (key === 'restaurant.course_firing') return Promise.resolve('true');
      return Promise.resolve('true');
    });

    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-hold-order')).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByTestId('setting-toggle-course-firing')).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('marks screen dirty and enables save button when a toggle is changed', async () => {
    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-hold-order')).toBeInTheDocument();
    });

    const saveBtn = screen.getByTestId('restaurant-settings-save-btn');
    expect(saveBtn).toBeDisabled();

    const holdOrderSwitch = screen.getByTestId('setting-toggle-hold-order');
    fireEvent.click(holdOrderSwitch);

    expect(holdOrderSwitch).toHaveAttribute('aria-checked', 'false');
    expect(saveBtn).not.toBeDisabled();
    expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument();
  });

  it('saves settings with setSettingsScoped on clicking Save', async () => {
    const onSaved = vi.fn();
    await renderScreen({ onSaved });

    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-customer-name')).toBeInTheDocument();
    });

    // Toggle vibration off
    const vibrationSwitch = screen.getByTestId('setting-toggle-interaction-vibration');
    fireEvent.click(vibrationSwitch);

    const saveBtn = screen.getByTestId('restaurant-settings-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mocks.setSettings).toHaveBeenCalledWith(
        mocks.sessionToken,
        expect.objectContaining({
          'restaurant.interaction_vibration': 'false',
          'restaurant.interaction_sound': 'true',
        }),
      );
    });

    // The table-number key is NOT written by this screen any more: it had no
    // reader, and the value the POS reads lives in the store db.
    const written = mocks.setSettings.mock.calls.at(-1)?.[1] as Record<string, string>;
    expect(written).not.toHaveProperty('restaurant.table_number');
    expect(mocks.setReceiptSettings).not.toHaveBeenCalled();

    expect(onSaved).toHaveBeenCalled();
  });

  it('calls onBack immediately when there are no unsaved changes', async () => {
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).toBeNull();
    });

    fireEvent.click(screen.getByTestId('restaurant-settings-back-btn'));
    expect(onBack).toHaveBeenCalled();
  });

  it('prompts confirmation when navigating back with unsaved changes', async () => {
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).toBeNull();
    });

    // Make dirty
    fireEvent.click(screen.getByTestId('setting-toggle-save-tab'));

    // Click back
    fireEvent.click(screen.getByTestId('restaurant-settings-back-btn'));

    // Should NOT call onBack yet; unsaved changes dialog should appear
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('unsaved-dialog-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('unsaved-dialog-discard')).toBeInTheDocument();

    // Cancel leaves user on screen
    fireEvent.click(screen.getByTestId('unsaved-dialog-cancel'));
    expect(onBack).not.toHaveBeenCalled();

    // Click back again, and Discard
    fireEvent.click(screen.getByTestId('restaurant-settings-back-btn'));
    fireEvent.click(screen.getByTestId('unsaved-dialog-discard'));
    expect(onBack).toHaveBeenCalled();
  });
});
