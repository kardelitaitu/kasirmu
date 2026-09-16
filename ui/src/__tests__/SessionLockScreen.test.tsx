import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from '@/frontend/shared/Toast';
import SessionLockScreen from '@/features/auth/SessionLockScreen';

// vi.hoisted ensures the mock references exist before vitest hoists the
// vi.mock() factories to the top of the file.  Without this, vitest
// throws "Cannot access 'mockStaffLogin' before initialization".
const { mockOnUnlock, mockStaffLogin, mockCheckLicenseStatus } = vi.hoisted(() => ({
  mockOnUnlock: vi.fn(),
  mockStaffLogin: vi.fn(),
  mockCheckLicenseStatus: vi.fn(() => Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 })),
}));

vi.mock('@/api/staff', () => ({
  staffLogin: mockStaffLogin,
}));

vi.mock('@/api/license', () => ({
  testAuthConnection: () => mockCheckLicenseStatus(),
}));

// The footer reads its version from the `version` command instead of a literal
// string, so the screen now calls this on mount. Mocked at the module boundary
// like the other two API imports.
vi.mock('@/api/system', () => ({
  getVersion: () =>
    Promise.resolve({
      name: 'oz-pos',
      version: '0.0.36',
      rustVersion: '1.80',
      target: 'x86_64',
    }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: {
      user_id: 'user-1',
      username: 'testuser',
      role_name: 'cashier',
      token: 'mock-token',
      role_id: 'role-1',
      display_name: 'Kasir Test',
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({
    state: 'connected' as const,
    latencyMs: 42,
    error: null,
  }),
}));

const STAFF_FTL = `
staff-login-connection-checking = Checking…
staff-login-connection-connected = Connected
staff-login-connection-disconnected = Disconnected
staff-login-connection-auth = Auth
staff-login-connection-sync = Sync
staff-login-clear = Clear
statusbar-group-aria = Connection and version status
statusbar-version-label = Version
statusbar-checking-msg = { $name } · Checking…
statusbar-offline-msg = { $name } · Offline
statusbar-latency-msg = { $name } · { $ms }ms
statusbar-version-latest-msg = Version up to date
statusbar-version-update-msg = Update available
session-lock-expired = Session expired. Please log in again.
session-lock-invalid-pin = Invalid PIN
session-lock-pin-aria = PIN: { $length } of { $max } digits entered
session-lock-pad-aria = PIN pad
session-lock-lockout = Wait { $seconds }s.
`;

function withProviders(children: ReactNode): ReactElement {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(STAFF_FTL));
  const l10n = new ReactLocalization([bundle]);

  return (
    <LocalizationProvider l10n={l10n}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </LocalizationProvider>
  );
}

function renderScreen() {
  return render(withProviders(<SessionLockScreen onUnlock={mockOnUnlock} />));
}

/** Return all PIN-dot elements (always 4). */
function getDots(): Element[] {
  return Array.from(document.querySelectorAll('.session-lock-pin-dot'));
}

/** Whether dot i is filled. */
function isDotFilled(i: number): boolean {
  return getDots()[i]?.classList.contains('session-lock-pin-dot--filled') ?? false;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStaffLogin.mockResolvedValue(undefined);
  mockCheckLicenseStatus.mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 10 });
  sessionStorage.setItem('current-username', 'testuser');
});

// ── Rendering ───────────────────────────────────────────────────

describe('SessionLockScreen rendering', () => {
  it('renders the lock badge on the card corner', () => {
    renderScreen();
    const lockIcon = document.querySelector('.session-lock-lock-badge');
    expect(lockIcon).toBeTruthy();
    expect(lockIcon?.querySelector('svg')).toBeTruthy();
  });

  it('displays the current time', () => {
    renderScreen();
    const timeEl = document.querySelector('.session-lock-time');
    expect(timeEl).toBeTruthy();
    expect(timeEl?.textContent).toBeTruthy();
  });

  it('displays the current date', () => {
    renderScreen();
    const dateEl = document.querySelector('.session-lock-date');
    expect(dateEl).toBeTruthy();
    expect(dateEl?.textContent).toBeTruthy();
  });

  // The footer used to be a hardcoded `v0.0.34` that sat two releases behind
  // without anything noticing. This asserts the rendered value is the one the
  // `version` command returned, so a regression to a literal -- or a fetch that
  // silently never resolves -- fails here.
  it('shows the version reported by the version command, not a literal', async () => {
    renderScreen();
    const versionEl = await waitFor(
      () => {
        const el = document.querySelector('.session-lock-footer-version');
        expect(el?.textContent).toContain('0.0.36');
        return el;
      },
      { timeout: 2000 },
    );
    expect(versionEl?.textContent).not.toContain('0.0.34');
  });

  // The login screen's footer is a version + copyright pair
  // (.staff-login-footer-version / .staff-login-footer-copyright). The lock
  // screen had only the version line, so the two screens looked different.
  it('pairs the version line with a copyright line, like the login footer', async () => {
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.session-lock-footer-version')).toBeTruthy();
    }, { timeout: 2000 });

    const copyright = document.querySelector('.session-lock-footer-copyright');
    expect(copyright).toBeTruthy();
    expect(copyright?.textContent).toContain(String(new Date().getFullYear()));
    // Both lines live in the same footer column, so they stack like the login's.
    expect(copyright?.parentElement)
      .toBe(document.querySelector('.session-lock-footer-version')?.parentElement);
  });

  // Regression guard for the reported bug: the browser dev-mock answered the
  // `version` command with a literal that drifted from the app (it said 0.0.9
  // while the app shipped 0.0.37), so the lock screen showed a stale version
  // in dev. It must derive from package.json, which bump-version.ps1 updates.
  // The handler moved from tauri-api.ts into handlers/system.ts with the
  // dev-mock extraction (T6); the guard follows its subject, not its history.
  it('dev-mock derives its version from package.json rather than a literal', () => {
    const mockSrc = readFileSync(resolve(__dirname, '../dev-mock/handlers/system.ts'), 'utf8');
    expect(mockSrc).toMatch(/version:\s*pkg\.version/);
    expect(mockSrc).toMatch(/import pkg from '\.\.\/\.\.\/\.\.\/package\.json'/);
    expect(mockSrc).not.toMatch(/version:\s*'\d+\.\d+\.\d+'/);
  });


  it('renders 4 PIN dots (all unfilled)', () => {
    renderScreen();
    const dots = getDots();
    expect(dots).toHaveLength(4);
    dots.forEach((dot) => {
      expect(dot.classList.contains('session-lock-pin-dot--filled')).toBe(false);
    });
  });

  it('renders the PIN pad with digit keys 0-9', () => {
    renderScreen();
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
  });

  it('renders Clear and backspace buttons', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    // Backspace is an SVG-only button — verify there are 2 --action keys
    const pad = document.querySelector('.session-lock-pad');
    expect(pad).toBeTruthy();
    const actionKeys = pad!.querySelectorAll('.session-lock-pad-key--action');
    expect(actionKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('shows auth and sync connection status indicators', () => {
    renderScreen();
    const indicators = document.querySelectorAll('.statusbar-item');
    expect(indicators.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Auth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
  });
});

// ── PIN entry ────────────────────────────────────────────────────

describe('SessionLockScreen PIN entry', () => {
  it('fills PIN dots as digits are entered', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    expect(isDotFilled(0)).toBe(true);
    expect(isDotFilled(1)).toBe(false);

    await user.click(screen.getByRole('button', { name: '2' }));
    expect(isDotFilled(1)).toBe(true);
  });

  it('auto-submits after 4 digits and calls staffLogin', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() => {
      expect(mockStaffLogin).toHaveBeenCalledWith({
        username: 'testuser',
        pin: '1234',
      });
    });
  });

  it('calls onUnlock after successful PIN verification', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() => {
      expect(mockOnUnlock).toHaveBeenCalled();
    });
  });

  it('shows error message on invalid PIN', async () => {
    mockStaffLogin.mockRejectedValueOnce({ message: 'Invalid PIN' });
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '1' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid PIN')).toBeInTheDocument();
    });
  });

  it('clears PIN dots after a failed attempt', async () => {
    mockStaffLogin.mockRejectedValueOnce({ message: 'Invalid PIN' });
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() => {
      getDots().forEach((dot) => {
        expect(dot.classList.contains('session-lock-pin-dot--filled')).toBe(false);
      });
    });
  });
});

// ── Backspace and Clear ─────────────────────────────────────────

describe('SessionLockScreen backspace and clear', () => {
  it('removes the last digit on backspace click', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));

    expect(isDotFilled(0)).toBe(true);
    expect(isDotFilled(1)).toBe(true);

    // Click backspace — the second .session-lock-pad-key--action button.
    const pad = document.querySelector('.session-lock-pad');
    const backspaceBtn = pad?.querySelectorAll('.session-lock-pad-key--action')[1] as HTMLButtonElement | undefined;
    if (backspaceBtn) await user.click(backspaceBtn);

    expect(isDotFilled(1)).toBe(false);
  });

  it('clears all digits on Clear button click', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));

    expect(isDotFilled(2)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    getDots().forEach((dot) => {
      expect(dot.classList.contains('session-lock-pin-dot--filled')).toBe(false);
    });
  });

  it('shows error when username is not in sessionStorage', async () => {
    sessionStorage.removeItem('current-username');
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() => {
      expect(screen.getByText('Session expired. Please log in again.')).toBeInTheDocument();
    });
  });
});

// ── Lockout (rate limiting) ──────────────────────────────────────
// Fake timers are needed here to control the lockout countdown timer.

describe('SessionLockScreen lockout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables all digit keys when locked out', async () => {
    mockStaffLogin.mockRejectedValue({ message: 'Invalid PIN' });
    renderScreen();

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        screen.getByRole('button', { name: '1' }).click();
        screen.getByRole('button', { name: '2' }).click();
        screen.getByRole('button', { name: '3' }).click();
        screen.getByRole('button', { name: '4' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }

    // State is synchronous after act() — no waitFor needed.
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('shows lockout countdown message after max attempts', async () => {
    mockStaffLogin.mockRejectedValue({ message: 'Invalid PIN' });
    renderScreen();

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        screen.getByRole('button', { name: '1' }).click();
        screen.getByRole('button', { name: '2' }).click();
        screen.getByRole('button', { name: '3' }).click();
        screen.getByRole('button', { name: '4' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }

    // The countdown div should show the lockout message.
    const countdown = document.querySelector('.session-lock-countdown');
    expect(countdown).toBeTruthy();
    expect(countdown?.textContent).toContain('Wait');
  });

  it('respects backend rate-limit instructions from error message', async () => {
    mockStaffLogin.mockRejectedValue({
      message: 'Try again in 5 seconds',
    });
    renderScreen();

    await act(async () => {
      screen.getByRole('button', { name: '1' }).click();
      screen.getByRole('button', { name: '2' }).click();
      screen.getByRole('button', { name: '3' }).click();
      screen.getByRole('button', { name: '4' }).click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const countdown = document.querySelector('.session-lock-countdown');
    expect(countdown).toBeTruthy();
    expect(countdown?.textContent).toContain('Wait');
  });
});// ── Keyboard input ──────────────────────────────────────────────

describe('SessionLockScreen keyboard input', () => {
  it('accepts digit keys from physical keyboard', async () => {
    const user = userEvent.setup();
    renderScreen();

    const pad = document.getElementById('session-lock-pin-pad');
    expect(pad).toBeTruthy();
    await user.type(pad!, '12');

    expect(isDotFilled(0)).toBe(true);
    expect(isDotFilled(1)).toBe(true);
  });

  it('handles Backspace key from physical keyboard', async () => {
    const user = userEvent.setup();
    renderScreen();

    const pad = document.getElementById('session-lock-pin-pad');
    await user.type(pad!, '12');
    await user.type(pad!, '{Backspace}');

    expect(isDotFilled(1)).toBe(false);
  });

  it('clears digits on Escape key', async () => {
    const user = userEvent.setup();
    renderScreen();

    const pad = document.getElementById('session-lock-pin-pad');
    await user.type(pad!, '123');
    await user.type(pad!, '{Escape}');

    getDots().forEach((dot) => {
      expect(dot.classList.contains('session-lock-pin-dot--filled')).toBe(false);
    });
  });
});

// ── License status ──────────────────────────────────────────────

describe('SessionLockScreen license status', () => {
  it('checks license status on mount', async () => {
    renderScreen();

    await waitFor(() => {
      expect(mockCheckLicenseStatus).toHaveBeenCalled();
    });
  });

  it('shows offline indicator when license check fails', async () => {
    mockCheckLicenseStatus.mockRejectedValue(new Error('network error'));
    renderScreen();

    await waitFor(() => {
      const offlineIndicator = document.querySelector('.statusbar-tone--bad');
      expect(offlineIndicator).toBeTruthy();
    });
  });
});

// ── Visual contract (login PIN-step parity) ───────────────────────

describe('SessionLockScreen visual contract', () => {
  it('renders the login-style 3-section card structure', () => {
    renderScreen();
    expect(document.querySelector('.session-lock-overlay')).toBeTruthy();
    expect(document.querySelector('.session-lock-backdrop')).toBeTruthy();
    expect(document.querySelector('.session-lock-stage')).toBeTruthy();
    expect(document.querySelector('.session-lock-top-bar')).toBeTruthy();
    expect(document.querySelector('.session-lock-main-area')).toBeTruthy();
    expect(document.querySelector('.session-lock-bottom-bar')).toBeTruthy();
  });

  it('places time and date in the viewport header, outside the card', () => {
    renderScreen();
    const header = document.querySelector('.session-lock-header');
    expect(header?.querySelector('.session-lock-time')?.textContent).toBeTruthy();
    expect(header?.querySelector('.session-lock-date')?.textContent).toBeTruthy();
    // Anything inside the card can reflow the keypad off its login-matching
    // box, so the clock stays out of it — and out of the top band.
    expect(document.querySelector('.session-lock-card .session-lock-header')).toBeNull();
    expect(document.querySelector('.session-lock-top-bar .session-lock-time')).toBeNull();
  });

  it('marks the lock badge decorative and pins it to the card corner', () => {
    renderScreen();
    const badge = document.querySelector('.session-lock-card > .session-lock-lock-badge');
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
  });

  it('places the PIN dots in the top bar, mirroring the login PIN step', () => {
    renderScreen();
    expect(document.querySelectorAll('.session-lock-top-bar .session-lock-pin-dot')).toHaveLength(4);
  });

  it('keeps the keypad as the sole child of the main area', () => {
    renderScreen();
    const mainArea = document.querySelector('.session-lock-main-area');
    expect(mainArea?.children).toHaveLength(1);
    expect(mainArea?.firstElementChild?.id).toBe('session-lock-pin-pad');
  });

  it('keeps the bottom band content-free', () => {
    renderScreen();
    expect(document.querySelector('.session-lock-bottom-bar')?.childElementCount).toBe(0);
  });

  it('renders notices below the card so they cannot reflow the keypad', async () => {
    mockStaffLogin.mockRejectedValueOnce({ message: 'Invalid PIN' });
    const user = userEvent.setup();
    renderScreen();

    for (const digit of ['1', '2', '3', '4']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }

    await waitFor(() => {
      expect(
        document.querySelector('.session-lock-notice .session-lock-error')?.textContent,
      ).toContain('Invalid PIN');
    });
    expect(document.querySelector('.session-lock-card .session-lock-error')).toBeNull();
  });

  it('moves the connection status pills into the login-style footer', async () => {
    renderScreen();
    const footer = document.querySelector('.session-lock-footer');
    expect(footer).toBeTruthy();
    // This asserted `toContain('v0.0.34')`, which pinned a hardcoded literal the
    // component had already fallen two releases behind on -- so the test was
    // protecting the defect and any version fix had to "break" a green test to
    // land. The point of this assertion is WHERE the pill lives, not what string
    // it happens to carry; the value is covered by the version-command test above.
    await waitFor(() =>
      expect(
        footer?.querySelector('.session-lock-footer-version')?.textContent,
      ).toBeTruthy(),
    );
    expect(footer?.querySelectorAll('.statusbar-item').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Auth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
  });

  it('keeps the card token-backed with no inline styles', () => {
    renderScreen();
    expect(document.querySelector('.session-lock-card')?.getAttribute('style')).toBeNull();
  });
});

// ── CSS integrity: the keypad suppresses focus-visible by SPECIFICITY, not by order ──
//
// Scope, so the next reader does not generalise this: the ring-free decision
// covers the PIN keypad only -- container and keys, on both PIN screens. Text
// fields are NOT in it and keep the global :focus-visible ring (the surviving
// example is `.staff-login-input:focus-visible`, guarded in
// StaffLoginScreen.test.tsx).
//
// Mirror of the `.staff-login-pin-wrap:focus-visible` guards in
// StaffLoginScreen.test.tsx, because the lock card is a structural clone of the
// login PIN step and the same defect was live here in the other form: the
// suppression used to sit in the bare `.session-lock-pad` rule. Both that rule
// and themes/reset.css's `:focus-visible { outline: 2px solid … }` are
// specificity (0,1,0), so the base-rule form won ONLY by being injected after
// reset.css. Measured in Chromium against the four real sheets: with the sheet
// order flipped, the old rule computed `solid 2px rgb(20,126,251)` and painted a
// blue box around the whole 300px keypad; the scoped
// `.session-lock-pad:focus-visible` (0,2,0) computes `none` in both orders.
// JSDOM (css:false) cannot reflect any of this, hence the source read.

describe('SessionLockScreen CSS integrity', () => {
  const css = readFileSync(
    resolve(__dirname, '..', 'features', 'auth', 'SessionLockScreen.css'),
    'utf8',
  );

  it('has a non-empty .session-lock-pad:focus-visible rule that suppresses the outline', () => {
    const ruleMatch = css.match(/\.session-lock-pad:focus-visible\s*\{([^}]*)\}/);
    expect(
      ruleMatch,
      '.session-lock-pad:focus-visible rule must exist in SessionLockScreen.css — ' +
        'the pad is focused programmatically on mount, so an unscoped suppression ' +
        'lets the browser default blue outline appear on the keypad wrapper',
    ).not.toBeNull();

    const ruleBody = ruleMatch![1]!.trim();
    expect(ruleBody, '.session-lock-pad:focus-visible rule body must not be empty').not.toHaveLength(0);
    expect(ruleBody).toContain('outline: none');
  });

  it('keeps `outline` out of the bare .session-lock-pad rule (order-dependent suppression)', () => {
    const baseMatch = css.match(/\.session-lock-pad\s*\{([^}]*)\}/);
    expect(baseMatch, '.session-lock-pad base rule must exist').not.toBeNull();
    expect(
      baseMatch![1]!,
      '`outline: none` in the bare .session-lock-pad rule ties reset.css\'s `:focus-visible` ' +
        'on specificity (0,1,0) and survives only on stylesheet order — scope it to ' +
        ':focus-visible so the suppression is structural',
    ).not.toMatch(/outline\s*:/);
  });

  it('has no focus outline on the keypad keys — the PIN pad is ring-free by decision', () => {
    const keyMatch = css.match(/\.session-lock-pad-key:focus-visible\s*\{([^}]*)\}/);
    expect(
      keyMatch,
      '.session-lock-pad-key:focus-visible must exist and suppress the outline: both PIN ' +
        'screens are keypad-ring-free by decision, so an unscoped or deleted rule here ' +
        'lets reset.css\'s :focus-visible paint a blue box on every tabbable digit. ' +
        'Reinstating a keyboard cue is a design decision to make openly, not a silent fix.',
    ).not.toBeNull();

    const keyBody = keyMatch![1]!.trim();
    expect(keyBody, '.session-lock-pad-key:focus-visible rule body must not be empty').not.toHaveLength(0);
    expect(keyBody).toContain('outline: none');
    expect(keyBody).not.toMatch(/outline:\s*2px/);
  });
});
