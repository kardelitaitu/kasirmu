//! A11y regression tests for KdsHeaderRight.
//!
//! The right header cluster: the Start/End Shift button, the device status
//! indicator and the settings hamburger panel. The shift button is the last
//! uncovered KDS control, and its two labels are STACKED in one grid cell and
//! toggled by OPACITY (KdsScreen.css:337) — an opacity:0 element is still in
//! the accessibility tree, so the button may be announced with BOTH labels at
//! once. This file measures that rather than assuming either way.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsHeaderRight } from '@/features/kds/components/KdsHeaderRight';
import { DEFAULT_SETTINGS } from '@/features/kds/kdsSettingsModel';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, kdsFtl];

const { mockListDevices } = vi.hoisted(() => ({ mockListDevices: vi.fn() }));

vi.mock('@/api/kds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/kds')>()),
  listKdsDevicesScoped: () => mockListDevices(),
}));

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
  useKdsCardColors: () => ({ colors: {}, updateColor: vi.fn(), resetColors: vi.fn() }),
}));

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    inShift: false,
    setInShift: vi.fn(),
    setConfirm: vi.fn(),
    sessionToken: 'tok',
    setShowEnrollment: vi.fn(),
    prefs: {
      layout: 'kanban',
      showOrderId: true,
      showTableNumber: false,
      kdsZone: '',
      autoAcknowledge: false,
      acknowledgeDelayMin: 2,
    },
    prefsLoading: true, // keeps the hamburger panel out of this unit's surface
    settings: { ...DEFAULT_SETTINGS },
    setSettings: vi.fn(),
    setAutoAcknowledge: vi.fn(),
    setShowOrderId: vi.fn(),
    setShowTableNumber: vi.fn(),
    cardAnimations: true,
    setCardAnimations: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof KdsHeaderRight>;
}

describe('KdsHeaderRight a11y', () => {
  it('has no axe violations out of shift', async () => {
    mockListDevices.mockResolvedValue([]);
    const { container } = renderWithProviders(<KdsHeaderRight {...makeProps()} />, ...FTL);
    await checkA11y(container);

    const shift = container.querySelector('[data-testid="kds-topbar-shift"]') as HTMLElement;
    expect(shift).toBeTruthy();

    // THE FIX THIS FILE EXISTS FOR. Both labels are in the DOM and toggled by
    // opacity, so without these two attributes the button's computed name is
    // both labels at once ("Start Shift End Shift" — measured live in Chrome).
    // axe does NOT flag that, so both halves are pinned here.
    expect(shift.getAttribute('aria-label')).toBe('Start Shift');
    // The inactive label must be hidden from assistive tech.
    const labels = Array.from(shift.querySelectorAll('span'));
    expect(labels.length).toBe(2);
    expect(labels.filter((el) => el.classList.contains('visible')).length).toBe(1);
    const hidden = labels.filter((el) => el.getAttribute('aria-hidden') === 'true');
    expect(hidden.length, 'exactly the inactive label must be aria-hidden').toBe(1);
    expect(hidden[0]!.textContent).toContain('End Shift');
  });

  it('has no axe violations in shift', async () => {
    mockListDevices.mockResolvedValue([]);
    const { container } = renderWithProviders(
      <KdsHeaderRight {...makeProps({ inShift: true })} />,
      ...FTL,
    );
    await checkA11y(container);

    const shift = container.querySelector('[data-testid="kds-topbar-shift"]') as HTMLElement;
    // In shift the offered action flips to End Shift, and so must the name.
    expect(shift.getAttribute('aria-label')).toBe('End Shift');
    const visible = Array.from(shift.querySelectorAll('span')).filter((el) =>
      el.classList.contains('visible'),
    );
    expect(visible.length).toBe(1);
    expect((visible[0]!.textContent ?? '').trim()).toBe('End Shift');
    const hidden = Array.from(shift.querySelectorAll('span')).filter(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );
    expect(hidden.length).toBe(1);
    expect(hidden[0]!.textContent).toContain('Start Shift');
  });
});
