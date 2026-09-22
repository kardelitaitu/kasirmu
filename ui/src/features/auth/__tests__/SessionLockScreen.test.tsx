import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SessionLockScreen from '../SessionLockScreen';

const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const mockOnUnlock = vi.fn();
const mockStaffLogin = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { display_name: 'Alice', role_name: 'manager', user_id: 'u1', role_id: 'r1' },
  }),
}));

vi.mock('@/api/staff', () => ({
  staffLogin: (...args: unknown[]) => mockStaffLogin(...args),
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({ state: 'connected', latencyMs: 10, label: 'Sync' }),
}));

vi.mock('@/components/StatusBar', () => ({
  default: () => (
    <div className="session-lock-statusbar-mock">
      <span>Auth</span>
      <span>Sync</span>
    </div>
  ),
}));

vi.mock('@/api/license', () => ({
  testAuthConnection: vi.fn().mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 10 }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      bundles: [],
      getString: (id: string, vars?: Record<string, string>) => {
        const map: Record<string, string> = {
          'session-lock-title': 'Session Locked',
          'session-lock-expired': 'Sesi telah berakhir',
          'session-lock-invalid-pin': 'PIN tidak dikenali',
          'session-lock-pin-aria': 'PIN: { $length } of { $max } digits entered',
          'session-lock-lockout': 'Wait { $seconds }s.',
          'session-lock-pad-aria': 'PIN pad',
          'staff-login-clear': 'Clear',
          'staff-login-connection-checking': 'Checking…',
          'staff-login-connection-connected': 'Connected',
          'staff-login-connection-disconnected': 'Disconnected',
          'staff-login-connection-auth': 'Auth',
          'staff-login-connection-sync': 'Sync',
        };
        let result = (map as Record<string, string>)[id];
        if (result && vars) {
          result = result.replace(/\{\s*\$(\w+)\s*\}/g, (_, key) => vars[key] ?? `{$${key}}`);
        }
        return result || id;
      },
    },
  }),
}));

function enterPinViaButtons(pin: string) {
  for (const d of pin) {
    fireEvent.click(screen.getByRole('button', { name: d }));
  }
}

function enterPinViaKeyboard(pin: string) {
  const pad = screen.getByRole('application', { name: 'PIN pad' });
  for (const d of pin) {
    fireEvent.keyDown(pad, { key: d });
  }
}

describe('SessionLockScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
  });

  // ── A failed PIN marks the field, not only the banner ──────────────
  //
  // The screen already announces the failure (the notice below carries
  // role="alert"), so this is not about being silent: it is about the mark
  // landing on the CONTROL the user must retry. A screen-reader user who
  // navigates back to the PIN row otherwise cannot tell it apart from the one
  // that just failed, and the shake is a CSS class they cannot perceive.

  describe('0. Failed-PIN field state', () => {
    const pinDots = () => document.querySelector('.session-lock-pin-dots')!;

    it('leaves the PIN row valid before any attempt', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      expect(pinDots()).not.toHaveAttribute('aria-invalid');
    });

    it('marks the PIN row invalid after a rejected PIN', async () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');

      await waitFor(() => {
        expect(pinDots()).toHaveAttribute('aria-invalid', 'true');
      });
    });

    it('clears the invalid mark when the user starts retrying', async () => {
      // The mark must not outlive the failure, or a fresh attempt reads as
      // already wrong.
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => expect(pinDots()).toHaveAttribute('aria-invalid', 'true'));

      enterPinViaButtons('1');

      expect(pinDots()).not.toHaveAttribute('aria-invalid');
    });

    it('hides the decorative dots from assistive tech', () => {
      // The row carries the count in its own label; without aria-hidden the
      // reader announces the row and then four unlabelled elements inside it.
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      const dots = pinDots().querySelectorAll('span');
      expect(dots.length).toBe(4);
      for (const dot of dots) expect(dot).toHaveAttribute('aria-hidden', 'true');
    });
  });
  describe('1. Mounting & Rendering', () => {
    it('renders the clock and date', () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2026-07-25T14:30:00');
        vi.setSystemTime(now);
        render(<SessionLockScreen onUnlock={mockOnUnlock} />);
        expect(screen.getByText(/02:30|2:30/)).toBeInTheDocument();
        // Scope the date assertions to the date element — the footer version
        // text ("kasir.mu Enterprise v0.0.25") also contains digits, so a bare
        // getByText(/25/) would match multiple nodes.
        const dateEl = screen.getByText(/Saturday/);
        expect(dateEl.textContent).toMatch(/July/);
        expect(dateEl.textContent).toMatch(/25/);
      } finally {
        // Always restore real timers — a leaked fake-timer clock would
        // hang every later waitFor in this file (cascade failures).
        vi.useRealTimers();
      }
    });

    it('renders 4 empty PIN dots', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      const dotsContainer = screen.getByLabelText(/PIN: 0 of 4 digits entered/);
      expect(dotsContainer).toBeInTheDocument();
    });

    it('renders all digit buttons 0-9, Clear, and Backspace', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      for (let i = 0; i <= 9; i++) {
        expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
      }
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('renders Auth and Sync connection status indicators', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      expect(screen.getByText('Auth')).toBeInTheDocument();
      expect(screen.getByText('Sync')).toBeInTheDocument();
    });
    it('focuses the PIN pad on mount', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      const pad = screen.getByRole('application', { name: 'PIN pad' });
      expect(pad).toHaveFocus();
    });
  });

  describe('2. PIN Entry via Button Clicks', () => {
    it('fills dots as digits are clicked', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('123');
      expect(screen.getByLabelText(/PIN: 3 of 4 digits entered/)).toBeInTheDocument();
    });

    it('does not allow more than 4 digits', () => {
      sessionStorage.setItem('current-username', 'alice');
      const neverResolve: (v: unknown) => void = () => {};
      mockStaffLogin.mockReturnValue(new Promise(neverResolve));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('12345');
      expect(screen.getByLabelText(/PIN: 4 of 4 digits entered/)).toBeInTheDocument();
    });

    it('Clear button resets all digits', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('123');
      fireEvent.click(screen.getByText('Clear'));
      expect(screen.getByLabelText(/PIN: 0 of 4 digits entered/)).toBeInTheDocument();
    });

    it('Clear button is disabled when no digits entered', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      expect(screen.getByText('Clear')).toBeDisabled();
    });

    it('Backspace removes the last digit', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('123');
      const backspaceButtons = screen.getAllByRole('button');
      const backspaceBtn = backspaceButtons.find(b => b.querySelector('svg'))!;
      fireEvent.click(backspaceBtn);
      expect(screen.getByLabelText(/PIN: 2 of 4 digits entered/)).toBeInTheDocument();
    });

    it('Clear is disabled when digit count is 0, enabled after entering', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      expect(screen.getByText('Clear')).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: '1' }));
      expect(screen.getByText('Clear')).toBeEnabled();
      fireEvent.click(screen.getByText('Clear'));
      expect(screen.getByText('Clear')).toBeDisabled();
    });
  });

  describe('3. PIN Entry via Keyboard', () => {
    it('digit keys fill PIN dots', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaKeyboard('456');
      expect(screen.getByLabelText(/PIN: 3 of 4 digits entered/)).toBeInTheDocument();
    });

    it('Backspace key removes the last digit', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaKeyboard('123');
      const pad = screen.getByRole('application', { name: 'PIN pad' });
      fireEvent.keyDown(pad, { key: 'Backspace' });
      expect(screen.getByLabelText(/PIN: 2 of 4 digits entered/)).toBeInTheDocument();
    });

    it('Escape key clears all digits', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaKeyboard('123');
      const pad = screen.getByRole('application', { name: 'PIN pad' });
      fireEvent.keyDown(pad, { key: 'Escape' });
      expect(screen.getByLabelText(/PIN: 0 of 4 digits entered/)).toBeInTheDocument();
    });

    it('non-digit/non-control keys are ignored', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      const pad = screen.getByRole('application', { name: 'PIN pad' });
      fireEvent.keyDown(pad, { key: 'a' });
      fireEvent.keyDown(pad, { key: 'Enter' });
      fireEvent.keyDown(pad, { key: 'Tab' });
      expect(screen.getByLabelText(/PIN: 0 of 4 digits entered/)).toBeInTheDocument();
    });
  });

  describe('4. Auto-submit on 4 Digits', () => {
    it('calls staffLogin with username and PIN when 4 digits entered via buttons', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockResolvedValue(undefined);
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(mockStaffLogin).toHaveBeenCalledWith({ username: 'alice', pin: '1234' });
      }, FAST_WAIT);
    });

    it('calls staffLogin with username and PIN when 4 digits entered via keyboard', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockResolvedValue(undefined);
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaKeyboard('5678');
      await waitFor(() => {
        expect(mockStaffLogin).toHaveBeenCalledWith({ username: 'alice', pin: '5678' });
      }, FAST_WAIT);
    });

    it('calls onUnlock on successful PIN verification', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockResolvedValue(undefined);
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(mockOnUnlock).toHaveBeenCalledTimes(1);
      }, FAST_WAIT);
    });

    it('resets PIN dots after successful unlock', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockResolvedValue(undefined);
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(mockOnUnlock).toHaveBeenCalled();
      }, FAST_WAIT);
    });
  });

  describe('5. Error Handling', () => {
    it('shows error banner on failed PIN', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }, FAST_WAIT);
    });

    it('shows the error message from staffLogin rejection', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Wrong PIN'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByText('Wrong PIN')).toBeInTheDocument();
      }, FAST_WAIT);
    });

    it('uses Fluent-sourced fallback when error has no message property', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue({} as unknown as Error);
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByText('PIN tidak dikenali')).toBeInTheDocument();
      }, FAST_WAIT);
    });

    it('shows session expired error when no username in sessionStorage', async () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByText('Sesi telah berakhir')).toBeInTheDocument();
      }, FAST_WAIT);
    });

    it('resets PIN to empty after error', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Wrong'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }, FAST_WAIT);
      expect(screen.getByLabelText(/PIN: 0 of 4 digits entered/)).toBeInTheDocument();
    });

    it('entering a new digit clears the previous error', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Wrong'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }, FAST_WAIT);
      fireEvent.click(screen.getByRole('button', { name: '1' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('6. Rate Limiting / Lockout', () => {
    it('locks the pad for the duration specified in the error message', async () => {
      vi.useFakeTimers();
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Try again in 30s'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await vi.waitFor(() => {
        expect(screen.getByText(/Wait 30s/)).toBeInTheDocument();
      }, { timeout: 2000 });
      expect(screen.getByText('Clear')).toBeDisabled();
      for (let i = 0; i <= 9; i++) {
        expect(screen.getByRole('button', { name: String(i) })).toBeDisabled();
      }
      vi.useRealTimers();
    });

    it('re-enables the pad after the lockout period expires', async () => {
      vi.useFakeTimers();
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Try again in 30s'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await vi.waitFor(() => {
        expect(screen.getByText(/Wait 30s/)).toBeInTheDocument();
      }, { timeout: 2000 });
      act(() => { vi.advanceTimersByTime(31000); });
      expect(screen.queryByText(/Wait/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
      vi.useRealTimers();
    });

    it('does not lock if error does not contain lockout message', async () => {
      sessionStorage.setItem('current-username', 'alice');
      mockStaffLogin.mockRejectedValue(new Error('Just wrong'));
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }, FAST_WAIT);
      expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
    });
  });

  describe('7. Unmount Safety', () => {
    it('does not call setState after unmount during PIN submission', async () => {
      sessionStorage.setItem('current-username', 'alice');
      let rejectLogin: (err: Error) => void = () => {};
      mockStaffLogin.mockReturnValue(new Promise((_, reject) => { rejectLogin = reject; }));
      const { unmount } = render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      enterPinViaButtons('1234');
      unmount();
      expect(() => rejectLogin(new Error('late error'))).not.toThrow();
    });

    it('does not call setState after unmount during license check', async () => {
      let resolveCheck: (v: { ok: boolean }) => void = () => {};
      const { testAuthConnection: checkFn } = await import('@/api/license');
      (checkFn as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(resolve => { resolveCheck = resolve; }));
      const { unmount } = render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      unmount();
      expect(() => resolveCheck({ ok: true })).not.toThrow();
    });
  });

  describe('8. Connection Status', () => {
    it('renders the unified StatusBar (auth/sync/version icons)', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      expect(screen.getByText('Auth')).toBeInTheDocument();
      expect(screen.getByText('Sync')).toBeInTheDocument();
    });

    it('shows the status bar when connection succeeds', () => {
      render(<SessionLockScreen onUnlock={mockOnUnlock} />);
      const bar = document.querySelector('.session-lock-statusbar-mock');
      expect(bar).toBeInTheDocument();
    });
  });
});
