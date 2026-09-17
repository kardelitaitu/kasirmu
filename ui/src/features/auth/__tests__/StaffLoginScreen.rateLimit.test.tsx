import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import StaffLoginScreen from '../StaffLoginScreen';

// ── controllable AuthContext mock (pub/sub via useSyncExternalStore) ──
type AuthState = {
  session: unknown;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  login: ReturnType<typeof vi.fn>;
};

let authState: AuthState;
const listeners = new Set<() => void>();

function setAuth(partial: Partial<AuthState>) {
  authState = { ...authState, ...partial };
  listeners.forEach((l) => l());
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useSyncExternalStore(
    (cb: () => void) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => authState,
    () => authState,
  ),
}));

vi.mock('@/hooks/useKeyboardAvoidance', () => ({
  useKeyboardAvoidance: () => ({ containerRef: { current: null } }),
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({ state: 'connected', latencyMs: 10, label: 'Sync' }),
}));

vi.mock('@/api/license', () => ({
  testAuthConnection: vi.fn().mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 10 }),
}));

vi.mock('@/contexts/BrandContext', () => ({
  useBrand: () => ({ settings: null, loading: false, refetch: vi.fn() }),
}));

vi.mock('@/api/staff', () => ({
  // STAFF-06: uniform pre-auth response.
  checkUsername: vi.fn().mockResolvedValue({ proceed: true }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => p,
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string, args?: Record<string, unknown>) => {
        const map: Record<string, string> = {
          'staff-login-error-not-found': 'User not found',
          'staff-login-error-deactivated': 'Deactivated',
          'staff-login-error-connection': 'Connection error',
          'staff-login-attempts-remaining': `Attempts remaining: ${args?.['count']}`,
          'staff-login-lockout': `Locked for ${args?.['seconds']}s`,
          'clear-aria': 'Clear',
          'backspace-aria': 'Backspace',
          'username-aria': 'Username',
        };
        return (map as Record<string, string>)[id] || id;
      },
    },
  }),
}));

const FAST_WAIT = { interval: 5, timeout: 500 } as const;

function typeUsername(username: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

function enterPin(pin: string) {
  const pad = screen.getByRole('application', { name: /PIN/i });
  for (const d of pin) {
    fireEvent.keyDown(pad, { key: d });
  }
}

describe('StaffLoginScreen — PIN rate-limit counter (Axis 5/8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    authState = {
      session: null,
      loading: false,
      error: null,
      clearError: () => setAuth({ error: null }),
      // Each call simulates a backend that returns the SAME error message —
      // the realistic case (backend returns a stable "Invalid PIN" string).
      login: vi.fn().mockImplementation(() => {
        setAuth({ error: 'Invalid PIN' });
        return Promise.resolve({ session: null });
      }),
    };
  });

  it('BUG#2: identical repeated PIN errors must advance the attempt counter', async () => {
    render(<StaffLoginScreen />);

    // Step 1: username → pin
    await act(async () => { typeUsername('alice'); });
    await waitFor(
      () => expect(screen.getByRole('application', { name: /PIN/i })).toBeInTheDocument(),
      FAST_WAIT,
    );

    // Attempt 1: enter 4 digits → auto-submit → identical 'Invalid PIN'
    await act(async () => { enterPin('1111'); });
    await waitFor(() => expect(authState.login).toHaveBeenCalledTimes(1), FAST_WAIT);
    // First failure: counter at 1 → rate-limit text is no longer shown inline
    // (only toast shows raw error message)
    await waitFor(
      () => expect(screen.queryByText(/Attempts remaining/)).not.toBeInTheDocument(),
      FAST_WAIT,
    );

    // Attempt 2: clear and re-enter 4 digits → identical 'Invalid PIN' again.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await act(async () => { enterPin('2222'); });
    await waitFor(() => expect(authState.login).toHaveBeenCalledTimes(2), FAST_WAIT);

    // Rate-limit counter still increments internally (for lockout logic)
    // but is not displayed inline — only toast shows "Invalid PIN"
    await waitFor(
      () => expect(screen.queryByText(/Attempts remaining/)).not.toBeInTheDocument(),
      FAST_WAIT,
    );
  });
});
