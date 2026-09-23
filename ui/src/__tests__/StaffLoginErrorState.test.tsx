import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/Toast';
import StaffLoginScreen from '@/features/auth/StaffLoginScreen';
import { BrandProvider } from '@/contexts/BrandContext';

/**
 * A failed PIN must mark the control that has to be retried.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `StaffLoginScreen.test.tsx` mocks `useAuth`
 * with a frozen `error: null`, so it can render the screen but cannot express the
 * one state this behaviour is about. This file's mock is a live store the test
 * drives, which is what lets the failure actually happen.
 *
 * THE DEFECT. A wrong PIN announced itself two ways, neither of which is the
 * field: a CSS shake class (invisible to a screen reader) and a toast
 * (`role="alert"`, so it IS announced — but transient, and it fires before the
 * dots are cleared). Nothing marked the PIN region itself as invalid, so a
 * screen-reader user returning to retry found a control that looked identical to
 * the one that had just failed.
 */

const mockLogin = vi.fn();
const mockClearError = vi.fn();

/** Controllable auth state; `setError` is how a test produces a failure. */
let authError: string | null = null;
let rerender: (() => void) | null = null;

vi.mock('@/api/staff', () => ({
  checkUsername: vi.fn(() => Promise.resolve({ proceed: true })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => {
    // A local state setter lets the test push an error into the screen: the
    // real `useAuth` is a provider the test cannot reach, so the component is
    // given a subscriber it can be poked through.
    const [, force] = useState(0);
    rerender = () => force((n: number) => n + 1);
    return {
      session: null,
      loading: false,
      error: authError,
      login: mockLogin,
      logout: vi.fn(),
      clearError: mockClearError,
      isManager: false,
      isOwner: false,
    };
  },
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: () =>
    Promise.resolve({ primary_colour: '#147EFB', logo_path: null, store_name: 'kasir.mu' }),
}));

function withProviders(children: ReactNode) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(
    new FluentResource(`
staff-login-title = kasir.mu
staff-login-subtitle = Staff Login
staff-login-progress-aria =
    .aria-label = Login progress
staff-login-step-username = Enter your username
staff-login-step-pin = Enter your PIN
staff-login-username-placeholder =
    .placeholder = Username
staff-login-username-aria =
    .aria-label = Username
staff-login-next = Next
staff-login-pin-section-aria =
    .aria-label = PIN entry
staff-login-pin-aria =
    .aria-label = PIN entry: { $length } of { $max } digits
staff-login-keypad-aria =
    .aria-label = Numeric keypad
staff-login-digit-aria =
    .aria-label = { $digit }
staff-login-clear-aria =
    .aria-label = Clear
staff-login-clear = Clear
staff-login-backspace-aria =
    .aria-label = Backspace
staff-login-back = ← Back
staff-login-submit = Login
`),
  );
  const l10n = new ReactLocalization([bundle]);
  return (
    <BrandProvider>
      <LocalizationProvider l10n={l10n}>
        <ToastProvider>{children}</ToastProvider>
      </LocalizationProvider>
    </BrandProvider>
  );
}

/** Advance past the username step, where the PIN pad lives. */
async function gotoPinStep(user: ReturnType<typeof userEvent.setup>) {
  render(withProviders(<StaffLoginScreen />));
  await user.type(screen.getByRole('textbox', { name: /username/i }), 'alice');
  await user.click(screen.getByRole('button', { name: /next/i }));
}

const pinDots = () => document.querySelector('.staff-login-pin-dots')!;

describe('StaffLoginScreen — a failed PIN marks the field, not just a toast', () => {
  beforeEach(() => {
    authError = null;
    rerender = null;
    vi.clearAllMocks();
  });

  it('leaves the PIN region valid before any attempt', async () => {
    const user = userEvent.setup();
    await gotoPinStep(user);

    expect(pinDots()).not.toHaveAttribute('aria-invalid');
  });

  it('marks the PIN region invalid once an attempt has failed', async () => {
    const user = userEvent.setup();
    await gotoPinStep(user);

    // The failure lands in auth state, which is what the screen reads.
    authError = 'Wrong PIN. Try again.';
    rerender?.();

    await waitFor(() => {
      expect(pinDots()).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('clears the invalid state when the user starts retrying', async () => {
    // The mark must not outlive the failure: leaving it set would tell the user
    // their fresh attempt is already wrong.
    const user = userEvent.setup();
    await gotoPinStep(user);

    authError = 'Wrong PIN. Try again.';
    rerender?.();
    await waitFor(() => expect(pinDots()).toHaveAttribute('aria-invalid', 'true'));

    await user.click(screen.getByRole('button', { name: '1' }));

    expect(pinDots()).not.toHaveAttribute('aria-invalid');
  });
});
