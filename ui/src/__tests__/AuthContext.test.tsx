import { describe, it, expect, vi } from 'vitest';
// `render` is kept in the import below — the 'throws when used outside
// AuthProvider' test relies on a synchronous throw during render, so
// `renderInAct`'s async boundary cannot be used there.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// ── mock staff login API ──────────────────────────────────────────────
const mockStaffLogin = vi.fn();

vi.mock('@/api/staff', () => ({
  staffLogin: (...args: unknown[]) => mockStaffLogin(...args),
}));

// ── test consumer ─────────────────────────────────────────────────────
function TestConsumer() {
  const { session, pickerTicket, loading, error, login, logout, clearError, isManager, isOwner, swapSession } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? 'no-error'}</span>
      <span data-testid="session">{session ? session.display_name : 'no-session'}</span>
      <span data-testid="ticket">{pickerTicket ?? 'no-ticket'}</span>
      <span data-testid="role">{session?.role_name ?? 'none'}</span>
      <span data-testid="userId">{session?.user_id ?? 'none'}</span>
      <span data-testid="isManager">{String(isManager)}</span>
      <span data-testid="isOwner">{String(isOwner)}</span>
      <button data-testid="login-btn" onClick={() => login('alice', '1234')}>
        Login
      </button>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
      <button data-testid="clear-btn" onClick={clearError}>
        Clear error
      </button>
      <button
        data-testid="swap-btn"
        onClick={() => swapSession({ display_name: 'Bob', role_name: 'cashier', user_id: 'u2', role_id: 'r2', permissions: [] })}
      >
        Swap
      </button>
    </div>
  );
}

async function renderProvider() {
  await renderInAct(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>,
  );
}

describe('AuthContext', () => {
  it('starts with no session, no ticket, no loading, no error', async () => {
    await renderProvider();
    expect(screen.getByTestId('session').textContent).toBe('no-session');
    expect(screen.getByTestId('ticket').textContent).toBe('no-ticket');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('no-error');
  });

  it('stores the picker ticket from login and clears it on logout', async () => {
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
      picker_ticket: 'ticket-abc',
    });
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ticket').textContent).toBe('ticket-abc');
    });

    fireEvent.click(screen.getByTestId('logout-btn'));
    expect(screen.getByTestId('ticket').textContent).toBe('no-ticket');
  });

  it('isManager and isOwner are false with no session', async () => {
    await renderProvider();
    expect(screen.getByTestId('isManager').textContent).toBe('false');
    expect(screen.getByTestId('isOwner').textContent).toBe('false');
  });

  it('sets loading=true during login and resolves with session', async () => {
    mockStaffLogin.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        session: { display_name: 'Alice', role_name: 'manager', user_id: 'u1', role_id: 'r1', permissions: ['analytics:view'] },
        picker_ticket: 'ticket-1',
      }), 100)),
    );

    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    // Loading should be true immediately after click
    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('Alice');
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('sets error on login failure', async () => {
    mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Invalid PIN');
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('session').textContent).toBe('no-session');
    });
  });

  it('clears error on clearError call', async () => {
    mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Invalid PIN');
    });

    fireEvent.click(screen.getByTestId('clear-btn'));
    expect(screen.getByTestId('error').textContent).toBe('no-error');
  });

  it('logs out and clears session and error', async () => {
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
      picker_ticket: 'ticket-1',
    });
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('Alice');
    });

    fireEvent.click(screen.getByTestId('logout-btn'));
    expect(screen.getByTestId('session').textContent).toBe('no-session');
    expect(screen.getByTestId('error').textContent).toBe('no-error');
  });

  it('isManager=true for manager role', async () => {
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Bob', role_name: 'manager', user_id: 'u2', role_id: 'r2', permissions: ['analytics:view'] },
      picker_ticket: 'ticket-2',
    });
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('isManager').textContent).toBe('true');
      // A manager is NOT an owner — only 'owner' and 'role-owner' roles satisfy isOwner.
      expect(screen.getByTestId('isOwner').textContent).toBe('false');
    });
  });

  it('isOwner=true and isManager=true for the backend Owner role name', async () => {
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Eve', role_name: 'Owner', user_id: 'u3', role_id: 'role-owner', permissions: ['*'] },
      picker_ticket: 'ticket-3',
    });
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('isOwner').textContent).toBe('true');
      expect(screen.getByTestId('isManager').textContent).toBe('true');
    });
  });

  it('normalizes the backend Manager role name for permission gates', async () => {
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Mia', role_name: 'Manager', user_id: 'u4', role_id: 'role-manager', permissions: ['analytics:view'] },
      picker_ticket: 'ticket-4',
    });
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('isManager').textContent).toBe('true');
      expect(screen.getByTestId('isOwner').textContent).toBe('false');
    });
  });

  describe('swapSession (ADR #6 hot-swap)', () => {
    it('replaces session without changing loading state', async () => {
      mockStaffLogin.mockResolvedValue({
        session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
        picker_ticket: 'ticket-1',
      });
      await renderProvider();
      fireEvent.click(screen.getByTestId('login-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('session').textContent).toBe('Alice');
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      // Hot-swap to Bob — loading must NOT change
      fireEvent.click(screen.getByTestId('swap-btn'));

      expect(screen.getByTestId('session').textContent).toBe('Bob');
      expect(screen.getByTestId('userId').textContent).toBe('u2');
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    it('clears any existing error on swap', async () => {
      mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
      await renderProvider();
      fireEvent.click(screen.getByTestId('login-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Invalid PIN');
      });

      // Swap to a different user — error must be cleared
      fireEvent.click(screen.getByTestId('swap-btn'));

      expect(screen.getByTestId('error').textContent).toBe('no-error');
      expect(screen.getByTestId('session').textContent).toBe('Bob');
    });

    it('does not call staffLogin API', async () => {
      mockStaffLogin.mockResolvedValue({
        session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
        picker_ticket: 'ticket-1',
      });
      await renderProvider();
      fireEvent.click(screen.getByTestId('login-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('session').textContent).toBe('Alice');
      });

      mockStaffLogin.mockClear();
      fireEvent.click(screen.getByTestId('swap-btn'));

      expect(mockStaffLogin).not.toHaveBeenCalled();
    });
  });

  it('calls onLogin callback after successful login', async () => {
    const onLogin = vi.fn();
    mockStaffLogin.mockResolvedValue({
      session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
      picker_ticket: 'ticket-1',
    });

    await renderInAct(
      <AuthProvider onLogin={onLogin}>
        <TestConsumer />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledTimes(1);
    });
  });

  it('prevents concurrent login attempts (submittingRef guard)', async () => {
    // When login is called while a previous call is still in-flight,
    // the second call must be silently rejected.
    let resolveLogin: (v: unknown) => void;
    mockStaffLogin.mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve; }),
    );

    await renderProvider();

    // First login attempt — still in-flight.
    fireEvent.click(screen.getByTestId('login-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('true');
    });

    // Second login attempt while first is pending — should be rejected.
    fireEvent.click(screen.getByTestId('login-btn'));

    // staffLogin should only have been called once.
    expect(mockStaffLogin).toHaveBeenCalledTimes(1);

    // Resolve the first call.
    resolveLogin!({
      session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
      picker_ticket: 'ticket-1',
    });

    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('Alice');
    });

    // staffLogin still only called once.
    expect(mockStaffLogin).toHaveBeenCalledTimes(1);
  });

  it('clears previous error on next login attempt', async () => {
    // First attempt fails.
    mockStaffLogin.mockRejectedValueOnce(new Error('Wrong PIN'));
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Wrong PIN');
    });

    // Second attempt succeeds — error must be cleared.
    mockStaffLogin.mockResolvedValueOnce({
      session: { display_name: 'Alice', role_name: 'cashier', user_id: 'u1', role_id: 'r1', permissions: [] },
      picker_ticket: 'ticket-1',
    });
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('no-error');
      expect(screen.getByTestId('session').textContent).toBe('Alice');
    });
  });

  it('throws when useAuth is used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventJsdomError = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', preventJsdomError);
    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useAuth must be used within an <AuthProvider>');
    window.removeEventListener('error', preventJsdomError);
    spy.mockRestore();
  });

  // ── What copy a failed login surfaces (ERR-05 / ERR-10) ────────────
  //
  // Two kinds of failure reach this provider and they must not be confused.
  // The pre-existing test above pins the first: a server refusal's own sentence
  // is shown verbatim. These pin the second, which leaked until 2026-09-23 —
  // measured in a browser, the PIN step rendered the literal internal string
  // "network down" where a connection message belonged.

  it('replaces a transport failure with user-safe copy, never the internal message', async () => {
    // A bare Error from the IPC boundary. Its `.message` is internal detail.
    mockStaffLogin.mockRejectedValue(new Error('network down'));
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      const shown = screen.getByTestId('error').textContent!;
      expect(shown).not.toBe('network down');
      expect(shown).toMatch(/offline|connection/i);
    });
  });

  it('treats other transport vocabulary the same way', async () => {
    // The vocabulary `classifyRetry` already owns; each must not reach the user.
    await renderProvider();
    const raw = ['ECONNREFUSED', 'request timed out', 'server error', 'service unavailable'];
    for (const message of raw) {
      mockStaffLogin.mockRejectedValue(new Error(message));
      fireEvent.click(screen.getByTestId('login-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).not.toBe(message);
      });
    }
  });

  it('keeps a server refusal verbatim, because that copy is written for the user', async () => {
    // The counterpart, and the reason the fix is not simply `plainErrorMessage`:
    // that mapper would flatten "Invalid credentials" into generic validation
    // copy and lose what the login screen is designed to say.
    mockStaffLogin.mockRejectedValue(new Error('Invalid credentials'));
    await renderProvider();
    fireEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Invalid credentials');
    });
  });
});
