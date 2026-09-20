// ── SetupWizard interaction tests ───────────────────────────────────
//
// Covers: preset selection, feature toggling, step navigation,
// review screen, completion flow. Uses fireEvent.click for navigation
// buttons (Next, Back, Complete, Skip) and module-level FluentBundle
// singleton to avoid re-creating Fluent resources per render.
// 21 tests (3 sync render tests moved to SetupWizardRender.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode } from 'react';
import SetupWizard, { type WizardState } from '@/features/setup/SetupWizard';
import StepAccount from '@/features/setup/components/StepAccount';
import { setShellKind } from '@/utils/shellKind';
import * as licenseApi from '@/api/license';
import settingsFtl from '@/locales/settings.ftl?raw';
import salesFtl from '@/locales/sales.ftl?raw';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from './test-utils/mocks/subscriptionCaps';

// ── Module-level FluentBundle singleton ──────────────────────────
// Avoids re-creating bundle + resources for every test render.
const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(settingsFtl));
bundle.addResource(new FluentResource(salesFtl));
const l10n = new ReactLocalization([bundle]);

function FluentWrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

// ── Navigation helpers (fireEvent.click ~1ms vs userEvent.click ~60ms) ─

function clickNext() {
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

function clickBack() {
  fireEvent.click(screen.getByRole('button', { name: /back/i }));
}

function clickComplete() {
  fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));
}

function clickLaunch() {
  fireEvent.click(screen.getByRole('button', { name: /launch kasir\.mu/i }));
}

function clickSkip() {
  fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
}

/** Select a preset card by index (0-5). */
function selectPreset(index: number) {
  fireEvent.click(screen.getAllByRole('radio')[index]!);
}

/** Navigate through remaining steps from current step to review. */
function navigateToReview() {
  for (let i = 0; i < 7; i++) {
    clickNext();
  }
}

// ── Helper functions ────────────────────────────────────────────────

/** Get all checkbox inputs currently rendered in the step. */
function getCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole('checkbox') as HTMLInputElement[];
}

/**
 * Toggle a feature by clicking its label row.
 * Uses userEvent.click because Fluent's <Localized> overrides the
 * checkbox aria-label, making getByRole('checkbox', {name: ...})
 * unreliable. fireEvent.click on a <label> doesn't forward to the
 * nested input in React's synthetic event system.
 */
async function toggleFeature(label: string) {
  const row = screen.getByText(label).closest('label');
  if (!row) throw new Error(`Feature row "${label}" not found`);
  const user = userEvent.setup();
  await user.click(row);
}

// ── Tests ───────────────────────────────────────────────────────────

// ── Account step: the ADR #54 §2.7 shell split ──────────────────────
//
// The desktop and tablet builds share this component and differ only in their
// entry point, which is why the split is a shell flag rather than a prop: the
// decision is "the Google control is excluded from the tablet build", and a
// prop would let a caller re-enable it.

describe('StepAccount — shell split (ADR #54 §2.7)', () => {
  afterEach(() => setShellKind('desktop'));

  it('offers the Google control on the desktop shell', () => {
    setShellKind('desktop');
    render(<StepAccount />, { wrapper: FluentWrapper });

    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
  });

  it('excludes the Google control from the tablet build and offers the emailed code', () => {
    setShellKind('tablet');
    render(<StepAccount />, { wrapper: FluentWrapper });

    expect(screen.queryByText('Continue with Google')).toBeNull();
    // The tablet's own route: the address, a code mailed to it, and a way to spend it.
    expect(screen.getByLabelText('Account email')).toBeInTheDocument();
    expect(screen.getByText('Email me a code')).toBeInTheDocument();
    // The code field appears only after a code has been sent, so it must not be here yet.
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
  });

  it('keeps the code field after a failed verification, so retrying costs no second email', async () => {
    // The failure message says "try again". Before this test the code field was rendered only
    // while the state was 'sent', so a wrong code collapsed it — the only way back was to
    // request another code, spending a second email and a second rate-limit slot.
    setShellKind('tablet');
    const request = vi.spyOn(licenseApi, 'requestDeviceLinkCode').mockResolvedValue(undefined);
    const consume = vi.spyOn(licenseApi, 'consumeDeviceLinkCode').mockRejectedValue(new Error('bad_code'));
    try {
      render(<StepAccount />, { wrapper: FluentWrapper });

      await userEvent.type(screen.getByLabelText('Account email'), 'owner@example.com');
      fireEvent.click(screen.getByText('Email me a code'));
      const codeField = await screen.findByLabelText('6-digit code');
      await userEvent.type(codeField, '123456');
      fireEvent.click(screen.getByText('Verify'));

      expect(await screen.findByText(/Could not link this device/)).toBeInTheDocument();
      expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
    } finally {
      request.mockRestore();
      consume.mockRestore();
    }
  });
});

describe('SetupWizard — OTP login flow', () => {
  // ── Preset selection ────────────────────────────────────────────

  it('selecting a preset advances to step 2', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });
    selectPreset(0);

    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
  });

  it('preset cards start unchecked and become selected on click', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });
    const presetCards = screen.getAllByRole('radio');

    for (const card of presetCards) {
      expect(card).toHaveAttribute('aria-checked', 'false');
    }

    selectPreset(0);
    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
  });

  it('Simple Retail preset pre-populates correct features', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);

    const checkboxes = getCheckboxes();
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('Restaurant preset pre-populates correct features', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(1);

    const step2Checkboxes = getCheckboxes();
    expect(step2Checkboxes[0]).toBeChecked();
  });

  it('Full Store preset pre-populates all payment features', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(2);

    const checkboxes = getCheckboxes();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });

  it('Cafe / Bakery preset pre-populates correct features', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(3);

    const checkboxes = getCheckboxes();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it('Franchise preset pre-populates correct features', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(4);

    const checkboxes = getCheckboxes();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });

  it('Custom preset starts with no features enabled', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(5);

    const checkboxes = getCheckboxes();
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked();
    }
  });

  // ── Feature toggling ────────────────────────────────────────────

  it('toggles a feature on and off', async () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);

    const checkboxes = getCheckboxes();
    expect(checkboxes[0]).toBeChecked();

    await toggleFeature('Cash');
    expect(checkboxes[0]).not.toBeChecked();

    await toggleFeature('Cash');
    expect(checkboxes[0]).toBeChecked();
  });

  it('all features in a step can be individually toggled', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(5);

    const checkboxes = getCheckboxes();
    for (const cb of checkboxes) {
      fireEvent.click(cb);
      expect(cb).toBeChecked();
    }

    for (const cb of checkboxes) {
      fireEvent.click(cb);
      expect(cb).not.toBeChecked();
    }
  });

  // ── Navigation ──────────────────────────────────────────────────

  it('navigates to the next step via Next button', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);

    expect(screen.getByText('Payment Methods')).toBeInTheDocument();

    clickNext();
    expect(screen.getByText('Products & Inventory')).toBeInTheDocument();
  });

  it('navigates back via Back button', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);

    clickNext();
    expect(screen.getByText('Products & Inventory')).toBeInTheDocument();

    clickBack();
    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
  });

  it('navigates through all 9 steps', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);

    const stepHeadings = [
      'Payment Methods',
      'Products & Inventory',
      'Staff Management',
      'Hardware & Peripherals',
      'Business Rules',
      'Data, Reporting & Cloud',
      'Your account',
      'Review Your Setup',
    ];

    for (const heading of stepHeadings) {
      expect(screen.getByText(heading)).toBeInTheDocument();
      if (heading !== 'Review Your Setup') {
        clickNext();
      }
    }
  });

  // ── Step indicator ──────────────────────────────────────────────

  it('updates step indicator dots as steps progress', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });
    const nav = screen.getByLabelText('Setup progress');

    const dots = nav.querySelectorAll('.setup-step-dot');
    expect(dots[0]).toHaveClass('setup-step-dot--active');
    expect(dots[1]).toHaveClass('setup-step-dot--pending');

    selectPreset(0);

    expect(dots[0]).toHaveClass('setup-step-dot--completed');
    expect(dots[1]).toHaveClass('setup-step-dot--active');
    expect(dots[2]).toHaveClass('setup-step-dot--pending');
  });

  // ── Review screen (Step 9) ─────────────────────────────────────

  it('review screen shows enabled and disabled feature tag clouds', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);
    navigateToReview();

    expect(screen.getByText('Review Your Setup')).toBeInTheDocument();
    expect(screen.getByText(/Simple Retail/)).toBeInTheDocument();
  });

  // ── Completion ─────────────────────────────────────────────────

  it('completion screen shows the correct feature count', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });

    selectPreset(0);
    navigateToReview();
    clickComplete();

    expect(screen.getByText('All Set!')).toBeInTheDocument();

    expect(
      screen.getByText((content) => content.includes('6') && content.includes('features enabled')),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /launch kasir\.mu/i }),
    ).toBeInTheDocument();
  });

  it('completion screen fires onComplete with WizardState', () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />, { wrapper: FluentWrapper });

    selectPreset(0);
    navigateToReview();
    clickComplete();

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state: WizardState = onComplete.mock.calls[0]![0] as WizardState;
    expect(state.preset).toBe('simple-retail');
    expect(state.features['cash-payment']).toBe(true);
    expect(state.features['card-payment']).toBeUndefined();
  });

  it('Launch button on completion fires onLaunch', () => {
    const onLaunch = vi.fn();
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} onLaunch={onLaunch} />, { wrapper: FluentWrapper });

    selectPreset(0);
    navigateToReview();
    clickComplete();
    clickLaunch();

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ── Skip ───────────────────────────────────────────────────────

  it('Skip button fires onSkip callback', () => {
    const onSkip = vi.fn();
    render(<SetupWizard onSkip={onSkip} />, { wrapper: FluentWrapper });

    clickSkip();

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it('handles Full Store preset with all features enabled in review', () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />, { wrapper: FluentWrapper });

    selectPreset(2);
    navigateToReview();
    clickComplete();

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state: WizardState = onComplete.mock.calls[0]![0] as WizardState;
    expect(state.preset).toBe('full-store');
    expect(Object.values(state.features).filter(Boolean).length).toBe(23);
  });

  it('toggle state persists across steps into review', async () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />, { wrapper: FluentWrapper });

    selectPreset(5);

    await toggleFeature('Cash');

    clickNext();
    await toggleFeature('Inventory Tracking');

    for (let i = 0; i < 6; i++) {
      clickNext();
    }

    clickComplete();

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state: WizardState = onComplete.mock.calls[0]![0] as WizardState;
    expect(state.features['cash-payment']).toBe(true);
    expect(state.features['inventory-tracking']).toBe(true);
    expect(state.features['card-payment']).toBeUndefined();
  });
});

describe('SetupWizard — QRIS gate (Free → Plus)', () => {
  // Global beforeEach clears mock state; restore the safe `caps: null`
  // default (every gate renders open) before each test here.
  beforeEach(() => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: null,
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
  });

  it('shows QRIS as included while capabilities are loading/unavailable', () => {
    render(<SetupWizard />, { wrapper: FluentWrapper });
    selectPreset(0);

    const row = screen.getByTestId('setup-qris-row');
    expect(row).not.toHaveClass('setup-qris-row--locked');
    expect(within(row).getByText('Included')).toBeInTheDocument();
  });

  it('locks QRIS setup with an upgrade CTA on the Free tier', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'free', supportsQris: false }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    render(<SetupWizard />, { wrapper: FluentWrapper });
    selectPreset(0);

    const row = screen.getByTestId('setup-qris-row');
    expect(row).toHaveClass('setup-qris-row--locked');
    expect(within(row).getByText(/QRIS payments are a Plus feature/)).toBeInTheDocument();

    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(within(row).getByRole('button', { name: 'Upgrade to Plus' }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/pricing/#plus'),
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('shows the included badge on Plus+ tiers', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'plus', supportsQris: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    render(<SetupWizard />, { wrapper: FluentWrapper });
    selectPreset(0);

    const row = screen.getByTestId('setup-qris-row');
    expect(within(row).getByText('Included')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Upgrade to Plus' })).not.toBeInTheDocument();
  });
});
