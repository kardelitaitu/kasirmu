//! A11y regression tests for the KDS settings (hamburger) panel.
//!
//! The panel is where a kitchen tunes the display: theme, column density,
//! auto-accept, the SLA thresholds, the per-state card colours (a native picker
//! AND a hex text field each), sound, and the routing-rules entry. It had no axe
//! coverage while the KDS ticket card and completed view did.
//!
//! Its hex text fields are the point of this file: the colour PICKER next to each
//! one carries an aria-label, but the hex field did not — measured live in the
//! running app, where six text inputs appeared with no accessible name.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsHamburgerPanel } from '@/features/kds/KdsHamburgerPanel';
import { DEFAULT_SETTINGS, type KdsSettings } from '@/features/kds/kdsSettingsModel';
import { DEFAULT_COLORS_DARK } from '@/features/kds/kdsCardColors';
import kdsFtl from '@/locales/kds.ftl?raw';

// Partial mock: the axe-helper's provider stack needs the REAL ThemeProvider,
// so only the optional hook is overridden.
vi.mock('@/app/ThemeProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/ThemeProvider')>()),
  useOptionalTheme: () => null,
}));
vi.mock('@/contexts/HardwareAccelContext', () => ({ useOptionalHardwareAccel: () => null }));
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }));
vi.mock('@/hooks/useSwipe', () => ({
  useSwipe: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn() }),
}));
vi.mock('@/features/kds/KdsCardColorsContext', () => ({
  useKdsCardColors: () => ({
    colors: { ...DEFAULT_COLORS_DARK },
    updateColor: vi.fn(),
    resetColors: vi.fn(),
  }),
}));

function makeProps(): React.ComponentProps<typeof KdsHamburgerPanel> {
  return {
    settings: { ...DEFAULT_SETTINGS } as KdsSettings,
    onChangeSound: vi.fn(),
    onChangeYellowThreshold: vi.fn(),
    onChangeRedThreshold: vi.fn(),
    onChangeAutoAcknowledge: vi.fn(),
    onChangeDensity: vi.fn(),
    showOrderId: true,
    showTableNumber: false,
    onToggleOrderId: vi.fn(),
    onToggleTableNumber: vi.fn(),
  };
}

describe('KdsHamburgerPanel a11y', () => {
  it('has no axe violations with the settings panel open', async () => {
    const { container } = renderWithProviders(<KdsHamburgerPanel {...makeProps()} />, kdsFtl);

    // The panel is closed until the topbar toggle is pressed.
    fireEvent.click(container.querySelector('[data-testid="kds-topbar-settings"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="kds-settings-colors-hex-dinein"]')).toBeTruthy();
    });

    await checkA11y(container);

    // Vacuity guard: the six colour rows' pickers and hex fields mounted, which
    // is the surface this case exists for.
    expect(container.querySelectorAll('.kds-native').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll('.kds-hex-input').length).toBeGreaterThanOrEqual(6);
  });
});
