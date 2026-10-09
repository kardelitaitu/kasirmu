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
import { RESTAURANT_SETTING_SPECS } from '@/features/restaurant/screens/restaurantSettingsModel';
import productsFtl from '@/locales/products.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [productsFtl, settingsFtl];

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSettings: vi.fn(),
  getReceiptSettings: vi.fn(),
  setReceiptSettings: vi.fn(),
  sessionToken: 'test-session-tok-1',
  markSettingsUpdated: vi.fn(),
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
    markSettingsUpdated: mocks.markSettingsUpdated,
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

    // The "settings changed" broadcast must be the MODEL's key list, not a
    // re-typed copy. Asserting equality against RESTAURANT_SETTING_SPECS (rather
    // than the ten literals) is what makes adding a setting to the model flow
    // through here automatically: a hand-maintained list would stay at ten and
    // every other mounted surface would keep its stale value.
    expect(mocks.markSettingsUpdated).toHaveBeenCalledWith(
      RESTAURANT_SETTING_SPECS.map((s) => s.key),
    );
  });

  it('refuses to look saved when a settings read FAILS (F4 data-loss guard)', async () => {
    // A rejected read must NOT be presented as a clean screen of defaults: that
    // is what let a failed load overwrite the merchant's real configuration.
    mocks.getSetting.mockImplementation((_tok: string, key: string) => {
      if (key === 'restaurant.hold_order') return Promise.reject(new Error('ipc down'));
      return Promise.resolve('true');
    });

    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-settings-load-error')).toBeInTheDocument();
    });

    // The three properties that make the loss impossible.
    expect(screen.getByTestId('restaurant-settings-save-btn')).toBeDisabled();
    expect(screen.queryByText(/All changes saved/i)).toBeNull();
    expect(screen.getByTestId('restaurant-settings-retry-btn')).toBeInTheDocument();
  });

  it('re-reads the settings when Retry is pressed after a failure', async () => {
    let failing = true;
    mocks.getSetting.mockImplementation(() => {
      if (failing) return Promise.reject(new Error('ipc down'));
      return Promise.resolve('true');
    });

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('restaurant-settings-load-error')).toBeInTheDocument();
    });

    failing = false;
    fireEvent.click(screen.getByTestId('restaurant-settings-retry-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('restaurant-settings-load-error')).toBeNull();
    });
    expect(screen.getByTestId('setting-toggle-hold-order')).toBeInTheDocument();
  });

  it('writes the loaded DB preference through to the localStorage the runtime reads (F6)', async () => {
    // The runtime (utils/interaction.ts) reads localStorage only, so a fresh
    // device must be given the DB value on load or it keeps the default.
    localStorage.clear();
    mocks.getSetting.mockImplementation((_tok: string, key: string) => {
      if (key === 'restaurant.interaction_sound') return Promise.resolve('false');
      if (key === 'restaurant.interaction_vibration') return Promise.resolve('false');
      return Promise.resolve('true');
    });

    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-interaction-sound')).toHaveAttribute('aria-checked', 'false');
    });
    expect(localStorage.getItem('pos.interaction_sound')).toBe('false');
    expect(localStorage.getItem('pos.interaction_vibration')).toBe('false');
  });

  it('does not move the local sound mirror when the save is rejected (F5)', async () => {
    // localStorage is what the runtime reads, so a failed save that had already
    // flipped it would leave the device disagreeing with the DB.
    localStorage.clear();
    localStorage.setItem('pos.interaction_sound', 'true');
    mocks.setSettings.mockRejectedValueOnce(new Error('ipc down'));

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-interaction-sound')).toBeInTheDocument();
    });

    // Turn sound OFF, then fail the save.
    fireEvent.click(screen.getByTestId('setting-toggle-interaction-sound'));
    fireEvent.click(screen.getByTestId('restaurant-settings-save-btn'));

    await waitFor(() => {
      expect(mocks.setSettings).toHaveBeenCalled();
    });
    // The mirror must still say what the DB still says.
    expect(localStorage.getItem('pos.interaction_sound')).toBe('true');
  });


  it('surfaces the TYPED cause on a failed save, and the screen key for an untyped one', async () => {
    // The screen's `catch {}` discarded `err`, so every save failure read the generic
    // "Failed to save settings". A session that had expired — which the operator can
    // actually fix — looked identical to an unknown fault. `l10nErrorMessage` maps a typed
    // AppError to specific user-safe copy and falls back to the screen's own key otherwise
    // (utils/app-error.ts:319-325), which is the pattern RestaurantMenuEditorScreen already
    // uses at 9 sites.
    //
    // 1. A TYPED session failure must reach the operator as the session message.
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-interaction-sound')).toBeInTheDocument();
    });
    mocks.setSettings.mockRejectedValueOnce({ kind: 'invalidSession', message: 'token expired' });
    fireEvent.click(screen.getByTestId('setting-toggle-interaction-sound'));
    fireEvent.click(screen.getByTestId('restaurant-settings-save-btn'));
    await waitFor(() => {
      expect(
        screen.getByText(/session has expired/i),
        'a typed invalidSession error must surface its own actionable copy, not the ' +
          'screen\'s generic save-failure message',
      ).toBeInTheDocument();
    });
    // The raw backend text must NEVER render.
    expect(screen.queryByText(/token expired/)).toBeNull();
  });

  it('falls back to the screen key for an UNTYPED save failure', async () => {
    // The other half of the contract: an unrecognized throw keeps this screen's
    // operational context rather than collapsing to a shared generic string.
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('setting-toggle-interaction-sound')).toBeInTheDocument();
    });
    mocks.setSettings.mockRejectedValueOnce(new Error('ipc down'));
    fireEvent.click(screen.getByTestId('setting-toggle-interaction-sound'));
    fireEvent.click(screen.getByTestId('restaurant-settings-save-btn'));
    await waitFor(() => {
      expect(screen.getByText(/failed to save settings/i)).toBeInTheDocument();
    });
  });

  it('renders the setting labels from the FTL bundle, not hardcoded English (F10)', async () => {
    // The screen used to pass literal English into SettingRow. Asserting the
    // bundle VALUE (not just that text exists) is what makes a regression to a
    // hardcoded string fail: the fixtures below load the real products.ftl.
    await renderScreen();
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).toBeNull();
    });

    // Present via the bundle.
    expect(screen.getByText('Customer Name')).toBeInTheDocument();
    expect(screen.getByText('Allow capturing guest or customer name on order tickets and tabs')).toBeInTheDocument();
    expect(screen.getByText('Save Tab / Open Bill')).toBeInTheDocument();
    // The badge, which was also a literal.
    expect(screen.getByText(/Mobile\/Tablet only/)).toBeInTheDocument();
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
