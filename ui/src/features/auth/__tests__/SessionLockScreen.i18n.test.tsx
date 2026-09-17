import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionLockScreen from '../SessionLockScreen';

// ── mocks ────────────────────────────────────────────────────────
const mockOnUnlock = vi.fn();
const mockOnActivated = vi.fn();
const mockStaffLogin = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    // A valid session is present (user is logged in, screen was locked).
    session: { display_name: 'Alice', role_name: 'manager', user_id: 'u1', role_id: 'r1' },
    login: mockStaffLogin,
  }),
}));

vi.mock('@/api/staff', () => ({
  staffLogin: (...args: unknown[]) => mockStaffLogin(...args),
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({ state: 'connected', latencyMs: 10, label: 'Sync' }),
}));

vi.mock('@/api/license', () => ({
  testAuthConnection: vi.fn().mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 10 }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

// Mock @fluent/react so <Localized> renders children and useLocalization
// returns a getString that resolves KNOWN keys to distinct localized strings.
// A correct implementation must route ALL user-visible strings through
// Fluent, so the component must call getString with a stable key — we return
// a deliberately non-English value so the test can prove the rendered text is
// Fluent-sourced rather than a hardcoded English literal.
vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      bundles: [],
      getString: (id: string, vars?: Record<string, string>) => {
        const map: Record<string, string> = {
          // Keys under test — must return non-English values to prove Fluent-sourcing
          'session-lock-title': 'Session Locked',
          'session-lock-expired': 'Sesi telah berakhir', // "Session expired"
          'session-lock-invalid-pin': 'PIN tidak dikenali', // "PIN not recognized"
          // Rendering keys — needed so the PIN pad and UI render correctly
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

const FAST_WAIT = { interval: 5, timeout: 500 } as const;

function enterPin(pin: string) {
  const pad = screen.getByRole('application', { name: 'PIN pad' });
  for (const d of pin) {
    fireEvent.keyDown(pad, { key: d });
  }
}

describe('SessionLockScreen — i18n parity (Axis 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
  });

  it('BUG#1a: expired-session error must be Fluent-sourced, not a hardcoded English literal', async () => {
    // No 'current-username' in sessionStorage → unlock path cannot recover.
    render(<SessionLockScreen onUnlock={mockOnUnlock} />);

    enterPin('1234');

    const banner = await screen.findByRole('alert', {}, FAST_WAIT);
    // Correct (post-fix) behavior: the banner shows the Fluent-localized string.
    expect(banner.textContent).toContain('Sesi telah berakhir');
    // The hardcoded English literal must not be present.
    expect(banner.textContent).not.toContain('Session expired. Please log in again.');
  });

  it('BUG#1b: generic PIN failure fallback must be Fluent-sourced, not a hardcoded English literal', async () => {
    sessionStorage.setItem('current-username', 'alice');
    // Reject with a value that has NO `message` field so the component hits its
    // hardcoded 'Invalid PIN' fallback literal (bypassing Fluent).
    mockStaffLogin.mockRejectedValue({} as unknown as Error);
    render(<SessionLockScreen onUnlock={mockOnActivated} />);

    enterPin('1234');

    const banner = await screen.findByRole('alert', {}, FAST_WAIT);
    // Correct (post-fix) behavior: the banner shows the Fluent-localized string.
    expect(banner.textContent).toContain('PIN tidak dikenali');
    // The hardcoded English literal must not be present.
    expect(banner.textContent).not.toContain('Invalid PIN');
  });
});
