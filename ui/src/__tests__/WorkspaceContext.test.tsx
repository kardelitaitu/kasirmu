import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { createContext } from 'react';
import type { ReactNode } from 'react';
import {
  WorkspaceProvider,
  useWorkspace,
  useWorkspaceScope,
} from '@/contexts/WorkspaceContext';
import type { LoginSessionDto, CreateSessionResult } from '@/api/staff';
import type { WorkspaceDto } from '@/api/workspaces';
import { withFluent } from '@/locales/test-utils';

// ── Opt out of the global WorkspaceContext stub ──────────────────────
// The setupFile installs a safe-default mock for useWorkspace and
// useWorkspaceScope so screens render without an explicit provider.
// This file exercises the real provider so it must NOT receive the
// stub. `vi.unmock` is hoisted to the top of the file and removes
// the mocking for this test file's module resolution.
vi.unmock('@/contexts/WorkspaceContext');

// ── Hoisted mock state ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listWorkspaceScreens: vi.fn(),
  resolveBootStore: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  refreshPickerTicket: vi.fn(),
  getDeviceId: vi.fn(),
}));

// ── Mock context for AuthContext ───────────────────────────────────────

interface MockAuthCtxValue {
  session: LoginSessionDto | null;
  pickerTicket: string | null;
}

const MockAuthCtx = createContext<MockAuthCtxValue>({
  session: null,
  pickerTicket: null,
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useContext(MockAuthCtx),
}));

// Mock API modules
vi.mock('@/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
  listWorkspaceScreens: (...args: unknown[]) => mocks.listWorkspaceScreens(...args),
  resolveBootStore: (...args: unknown[]) => mocks.resolveBootStore(...args),
}));

vi.mock('@/api/staff', () => ({
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  destroySession: (...args: unknown[]) => mocks.destroySession(...args),
  // Previously absent from this mock, which meant every hot-swap test silently took the
  // `catch { /* use the existing ticket */ }` branch in swapSessionToken: calling an undefined
  // function throws, and the fallback is exactly the path that reads `pickerTicket`. Having it
  // here as a controllable fn is what makes both branches testable.
  refreshPickerTicket: (...args: unknown[]) => mocks.refreshPickerTicket(...args),
}));

vi.mock('@/api/system', () => ({
  getDeviceId: (...args: unknown[]) => mocks.getDeviceId(...args),
}));

// ── Test data ─────────────────────────────────────────────────────────

const DEFAULT_SESSION: LoginSessionDto = {
  user_id: 'user-1',
  display_name: 'Alice',
  role_name: 'cashier',
  role_id: 'role-cashier',
  permissions: [],
};

function makeWorkspace(overrides: Partial<WorkspaceDto> = {}): WorkspaceDto {
  return {
    instance_id: 'inst-restaurant',
    type_key: 'restaurant-pos',
    store_id: 'store-1',
  store_name: 'Main Store',
  purpose_key: 'general',
  name: 'Restaurant POS',
    description: 'Restaurant terminal',
    icon: 'restaurant',
    layout_mode: 'fullscreen',
    colour: null,
    is_default: true,
    ...overrides,
  };
}

const STORE_POS: WorkspaceDto = {
  instance_id: 'inst-store',
  type_key: 'store-pos',
  store_id: 'store-1',
  store_name: 'Main Store',
  purpose_key: 'general',
  name: 'Store POS',
  description: 'Retail terminal',
  icon: 'store',
  layout_mode: 'fullscreen',
  colour: null,
  is_default: false,
};

function makeSessionResult(overrides: Partial<CreateSessionResult> = {}): CreateSessionResult {
  return {
    session_token: 'tok-abc-123',
    context: {
      userId: 'user-1',
      roleId: 'role-cashier',
      storeId: 'store-1',
      instanceId: 'inst-restaurant',
      typeKey: 'restaurant-pos',
      terminalId: '',
    },
    ...overrides,
  };
}

// Picker ticket the backend mints at login (audit-open-findings) — used by the
// pre-session picker until createSession returns the opaque token.
const DEFAULT_TICKET = 'ticket-abc';

function MockAuthProvider({
  children,
  session,
  pickerTicket = DEFAULT_TICKET,
}: {
  children: ReactNode;
  session: LoginSessionDto | null;
  pickerTicket?: string | null;
}) {
  return (
    <MockAuthCtx.Provider value={{ session, pickerTicket }}>
      {children}
    </MockAuthCtx.Provider>
  );
}

function renderWorkspaceHook(
  session: LoginSessionDto | null = DEFAULT_SESSION,
  // With no session there is no login → no picker ticket either (audit-open-findings).
  pickerTicket: string | null = session ? DEFAULT_TICKET : null,
) {
  // WorkspaceProvider localizes its error state, so the real provider
  // needs a Fluent ancestor (shared.ftl carries workspace-home-error-desc).
  const wrapper = ({ children }: { children: ReactNode }) =>
    withFluent(
      <MockAuthProvider session={session} pickerTicket={pickerTicket}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </MockAuthProvider>,
    );
  return renderHook(
    () => ({ workspace: useWorkspace(), scope: useWorkspaceScope() }),
    { wrapper },
  );
}

// ── Helper: flush pending microtasks synchronously ────────────────────
// Replaces waitFor(() => expect(loading).toBe(false)) which polls at
// 50ms intervals. await act(async () => {}) flushes all pending
// microtasks (resolved mock promises + React state updates) in a
// single tick, eliminating the 50ms polling overhead per call.

async function flushAsync() {
  await act(async () => {});
}

// For multi-step async flows where a single flush might not suffice,
// use waitFor with a short interval instead of the default 50ms.
const FAST_WAIT = { interval: 5, timeout: 500 } as const;

// Asserts that loading has completed (loading === false) with fast polling.
// Strictly better than flushAsync() for initial-load waits because it
// preserves the safety assertion: if a future bug makes loading stay true
// forever, the test fails instead of passing with stale state.
// For null-session tests where loading may not transition, use flushAsync().
type HookResult = { current: { workspace: { loading: boolean } } };

async function waitForLoaded(result: HookResult) {
  await waitFor(() => {
    expect(result.current.workspace.loading).toBe(false);
  }, FAST_WAIT);
}

// ── Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.resolveBootStore.mockResolvedValue({
    is_bound: false,
    store_id: 'store-1',
    instance_id: null,
  });
  mocks.listWorkspaces.mockResolvedValue([makeWorkspace(), STORE_POS]);
  mocks.listWorkspaceScreens.mockResolvedValue([
    { screen_key: 'pos', sort_order: 1 },
    { screen_key: 'orders', sort_order: 2 },
  ]);
  mocks.createSession.mockResolvedValue(makeSessionResult());
  mocks.destroySession.mockResolvedValue(undefined);
  // Default to rejecting. Before this mock existed, refreshPickerTicket was `undefined`, so the
  // call threw synchronously into the same `catch` and every hot-swap test took the
  // "use the existing ticket" fallback. A rejected promise reaches the identical branch, so this
  // preserves the existing suite's behaviour while making the other branch reachable.
  mocks.refreshPickerTicket.mockRejectedValue(new Error('no refreshed ticket in this test'));
  mocks.getDeviceId.mockResolvedValue('');
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('WorkspaceContext', () => {
  describe('initial state', () => {
    it('starts with null workspace and no error', () => {
      const { result } = renderWorkspaceHook();

      expect(result.current.workspace.activeWorkspace).toBeNull();
      expect(result.current.workspace.activeInstance).toBeNull();
      expect(result.current.workspace.error).toBeNull();
    });

    it('loads workspaces from API on mount with valid session', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(mocks.resolveBootStore).toHaveBeenCalled();
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'store-1');
      expect(result.current.workspace.availableWorkspaces).toHaveLength(2);
    });

    it('passes the device id to boot resolution for bound auto-boot', async () => {
      // A terminal with a stored device binding must auto-boot into its
      // bound store+instance; the device id has to reach resolve_boot_store.
      mocks.getDeviceId.mockResolvedValue('tablet-1');
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(mocks.resolveBootStore).toHaveBeenCalledWith('tablet-1');
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'store-1');
    });

    it('boot resolution receives undefined when no device id resolves', async () => {
      mocks.getDeviceId.mockRejectedValue(new Error('IPC unavailable'));
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(mocks.resolveBootStore).toHaveBeenCalledWith(undefined);
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'store-1');
    });

    it('does not load workspaces when session is null', async () => {
      const { result } = renderWorkspaceHook(null);

      await flushAsync();

      expect(mocks.listWorkspaces).not.toHaveBeenCalled();
      expect(result.current.workspace.availableWorkspaces).toEqual([]);
    });
  });

  describe('workspace selection', () => {
    it('sets activeWorkspace and syncs activeInstance', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });

      expect(result.current.workspace.activeWorkspace).toBe('restaurant-pos');
      expect(result.current.workspace.activeInstance?.type_key).toBe('restaurant-pos');
      expect(result.current.workspace.lastWorkspace).toBe('restaurant-pos');
    });

    it('sets activeInstance and syncs activeWorkspace', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveInstance(STORE_POS); });

      expect(result.current.workspace.activeWorkspace).toBe('store-pos');
      expect(result.current.workspace.activeInstance?.instance_id).toBe('inst-store');
    });

    it('clears selection but preserves lastWorkspace when setting null', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      act(() => { result.current.workspace.setActiveWorkspace(null); });

      expect(result.current.workspace.activeWorkspace).toBeNull();
      expect(result.current.workspace.activeInstance).toBeNull();
      // Contract (since 4fa7d14d): returning to the picker clears the
      // selection but keeps lastWorkspace so WorkspaceHome can highlight
      // the last-used card (workspace-card--active). Cleared only on a
      // fresh login/logout via handleSetActiveInstance(null).
      expect(result.current.workspace.lastWorkspace).toBe('restaurant-pos');
    });
  });

  describe('workspace screens', () => {
    it('handles race condition: stale listWorkspaceScreens does not overwrite new screens', async () => {
      let resolveScreensA!: (value: unknown) => void;
      const screensAPromise = new Promise((resolve) => { resolveScreensA = resolve; });

      // First call (for A) hangs; second call (for B) resolves immediately
      mocks.listWorkspaceScreens
        .mockImplementationOnce(() => screensAPromise)
        .mockImplementationOnce(() =>
          Promise.resolve([{ screen_key: 'pos', sort_order: 1 }]),
        );

      const { result } = renderWorkspaceHook();
      await waitForLoaded(result);

      // Select workspace A (triggers first listWorkspaceScreens call that hangs)
      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      await flushAsync();

      // Switch to B while A's screens are still loading
      act(() => { result.current.workspace.setActiveInstance(STORE_POS); });

      // Wait for B's screens to resolve
      await waitFor(() => {
        expect(result.current.workspace.workspaceScreens).toEqual(['pos']);
      }, FAST_WAIT);

      // Now resolve A's deferred promise — the stale .then() must NOT overwrite
      await act(async () => { resolveScreensA!([{ screen_key: 'orders', sort_order: 1 }]); });

      // B's screens should still be 'pos' (not overwritten by A's 'orders')
      expect(result.current.workspace.workspaceScreens).toEqual(['pos']);
    });

    it('loads screens when an instance is activated', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });

      await waitFor(() => {
        expect(result.current.workspace.workspaceScreens).toEqual(['pos', 'orders']);
      }, FAST_WAIT);
      expect(mocks.listWorkspaceScreens).toHaveBeenCalledWith(
        'ticket-abc',
        'restaurant-pos',
        'store-1',
      );
    });

    it('clears screens when instance becomes null', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      await waitFor(() => {
        expect(result.current.workspace.workspaceScreens.length).toBeGreaterThan(0);
      }, FAST_WAIT);

      act(() => { result.current.workspace.setActiveWorkspace(null); });

      expect(result.current.workspace.workspaceScreens).toEqual([]);
    });
  });

  describe('session token lifecycle', () => {
    it('creates a session token when workspace is selected', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });

      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);
    });

    it('destroys old token and creates new one when switching workspace', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);

      mocks.createSession.mockResolvedValue(makeSessionResult({ session_token: 'tok-xyz' }));

      act(() => { result.current.workspace.setActiveWorkspace('store-pos'); });

      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-xyz');
      }, FAST_WAIT);
      expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
    });
  });

  describe('switchStore', () => {
    it('destroys token, clears state, and re-resolves for new store', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);

      mocks.listWorkspaces.mockResolvedValue([STORE_POS]);

      act(() => { result.current.workspace.switchStore('store-2'); });

      expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
      expect(result.current.workspace.activeWorkspace).toBeNull();
      expect(result.current.workspace.resolvedStoreId).toBe('store-2');

      await waitForLoaded(result);
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'store-2');
    });
  });

  describe('swapSessionToken (ADR #6)', () => {
    it('preserves workspace and creates token with new user identity', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveWorkspace('restaurant-pos'); });
      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);

      mocks.createSession.mockResolvedValue(makeSessionResult({ session_token: 'tok-swapped' }));

      await act(async () => {
        await result.current.workspace.swapSessionToken('user-2', 'role-manager');
      });

      expect(result.current.workspace.activeWorkspace).toBe('restaurant-pos');
      expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
      expect(result.current.workspace.sessionToken).toBe('tok-swapped');
    });

    it('is a no-op when no instance is active', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      await act(async () => {
        await result.current.workspace.swapSessionToken('user-2', 'role-manager');
      });

      expect(mocks.destroySession).not.toHaveBeenCalled();
      expect(mocks.createSession).not.toHaveBeenCalled();
    });
  });

  describe('registered-only workspaces', () => {
    it('keeps an empty list when API returns empty (no demo fallback)', async () => {
      mocks.listWorkspaces.mockResolvedValue([]);

      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(result.current.workspace.availableWorkspaces).toEqual([]);
      expect(result.current.workspace.error).toBeNull();
    });

    it('clears the list and sets error when API throws (no demo fallback)', async () => {
      mocks.listWorkspaces.mockRejectedValue(new Error('IPC unavailable'));

      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(result.current.workspace.availableWorkspaces).toEqual([]);
      // The provider no longer holds hardcoded English: this copy resolves
      // through Fluent from shared.ftl `workspace-home-error-desc`, which the
      // withFluent wrapper loads. Asserting the resolved text keeps the test
      // honest about the key actually existing.
      expect(result.current.workspace.error).toBe(
        'Could not load your workspaces. Check your connection and try again.',
      );
    });
  });

  describe('retry', () => {
    it('re-fetches workspaces when retry is called', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      mocks.listWorkspaces.mockClear();
      act(() => { result.current.workspace.retry(); });

      expect(result.current.workspace.loading).toBe(true);

      await waitForLoaded(result);
      expect(mocks.listWorkspaces).toHaveBeenCalled();
    });

    it('is a no-op when roleId is empty (no session)', async () => {
      const { result } = renderWorkspaceHook(null);

      await flushAsync();

      mocks.listWorkspaces.mockClear();
      act(() => { result.current.workspace.retry(); });

      expect(mocks.listWorkspaces).not.toHaveBeenCalled();
    });
  });

  describe('useWorkspaceScope', () => {
    it('returns null when no workspace is active', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(result.current.scope).toBeNull();
    });

    it('returns scope derived from active instance', async () => {
      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      act(() => { result.current.workspace.setActiveInstance(makeWorkspace()); });

      expect(result.current.scope).toEqual({
        storeId: 'store-1',
        instanceId: 'inst-restaurant',
        typeKey: 'restaurant-pos',
      });
    });
  });

  describe('boot store resolution', () => {
    it('falls back to default store when resolution fails', async () => {
      mocks.resolveBootStore.mockRejectedValue(new Error('no device binding'));

      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(result.current.workspace.resolvedStoreId).toBe('default');
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'default');
    });

    it('resolves store and loads workspaces for that store', async () => {
      mocks.resolveBootStore.mockResolvedValue({
        is_bound: false,
        store_id: 'branch-5',
        instance_id: null,
      });
      mocks.listWorkspaces.mockResolvedValue([{ ...makeWorkspace(), store_id: 'branch-5', store_name: 'Branch 5' }]);

      const { result } = renderWorkspaceHook();

      await waitForLoaded(result);

      expect(result.current.workspace.resolvedStoreId).toBe('branch-5');
      expect(mocks.listWorkspaces).toHaveBeenCalledWith('ticket-abc', 'branch-5');
    });
  });

  // ── swapSessionToken reads the CURRENT picker ticket ──────────────────
  //
  // swapSessionToken is declared with `[], // stable — reads from refs` (WorkspaceContext.tsx:293),
  // and that comment is the whole point: the callback is deliberately dep-free because it is handed
  // to children whose identity must not churn. But it reads `pickerTicket` at :262, which is a value
  // from useAuth, not a ref -- so with no prior session token it sends whatever ticket existed the
  // first time the callback was built, straight into createSession's picker_ticket at :285. The
  // comment three lines above that read says the hot-swap user "needs a fresh ticket bound to THEIR
  // identity (not the previous user's)". A captured ticket is precisely the previous user's.
  describe('swapSessionToken picker ticket freshness', () => {
    function renderWithMutableTicket() {
      const ticketRef: { current: string | null } = { current: 'ticket-first-user' };
      const wrapper = ({ children }: { children: ReactNode }) =>
        withFluent(
          <MockAuthCtx.Provider value={{ session: DEFAULT_SESSION, pickerTicket: ticketRef.current }}>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </MockAuthCtx.Provider>,
        );
      const hook = renderHook(() => useWorkspace(), { wrapper });
      return { ...hook, ticketRef };
    }

    it('sends the ticket current at swap time, not the one captured when the callback was built', async () => {
      const { result, rerender, ticketRef } = renderWithMutableTicket();

      // A second cashier signs in behind the scenes and the auth context now carries a different
      // ticket. This is a re-render the provider must observe.
      ticketRef.current = 'ticket-second-user';
      await act(async () => {
        rerender();
      });

      await act(async () => {
        result.current.setActiveInstance(STORE_POS);
      });

      await act(async () => {
        await result.current.swapSessionToken('user-2', 'role-2');
      });

      const call = mocks.createSession.mock.calls.at(-1);
      const sent = (call?.[0] as { picker_ticket?: string } | undefined)?.picker_ticket;
      expect(sent).toBe('ticket-second-user');
    });
  });

  // The suite-wide default makes the refresh REJECT (the note at :209-213 explains why), so
  // every hot-swap case in this file has always taken the fallback branch. The branch that
  // ASSIGNS the refreshed ticket had no coverage at all -- and that is precisely the branch a
  // tablet could not reach either, until `refresh_picker_ticket` was registered (683c9f2b9).
  // One case per side of the `try`, so the next change to the fallback is a decision rather
  // than an accident.
  describe('swapSessionToken picker-ticket refresh', () => {
    async function swapWithPriorSession() {
      const { result } = renderWorkspaceHook();
      await waitForLoaded(result);
      act(() => {
        result.current.workspace.setActiveWorkspace('restaurant-pos');
      });
      await waitFor(() => {
        expect(result.current.workspace.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);
      mocks.createSession.mockResolvedValue(makeSessionResult({ session_token: 'tok-swapped' }));
      return result;
    }

    it('sends the refreshed ticket, not the login-time one, when the refresh succeeds', async () => {
      const result = await swapWithPriorSession();
      mocks.refreshPickerTicket.mockResolvedValue({ picker_ticket: 'ticket-refreshed' });

      await act(async () => {
        await result.current.workspace.swapSessionToken('user-2', 'role-manager');
      });

      // Refreshed against the token being replaced, not against the new identity: holding a
      // valid session is what proves the caller may have a ticket re-minted (ADR #4).
      expect(mocks.refreshPickerTicket).toHaveBeenCalledWith('tok-abc-123');
      const call = mocks.createSession.mock.calls.at(-1);
      const sent = (call?.[0] as { picker_ticket?: string } | undefined)?.picker_ticket;
      expect(sent).toBe('ticket-refreshed');
    });

    it('keeps the login-time ticket and says so when the refresh fails', async () => {
      const result = await swapWithPriorSession();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await act(async () => {
          await result.current.workspace.swapSessionToken('user-2', 'role-manager');
        });

        const call = mocks.createSession.mock.calls.at(-1);
        const sent = (call?.[0] as { picker_ticket?: string } | undefined)?.picker_ticket;
        expect(sent).toBe(DEFAULT_TICKET);
        // The swap still proceeds. Whether a stale ticket should ABORT it is the question
        // T15 deliberately leaves open, so no test here may freeze the answer either way --
        // this one pins only that the fallback is what runs, and that it announces itself.
        expect(result.current.workspace.sessionToken).toBe('tok-swapped');
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('picker-ticket refresh failed'),
          expect.anything(),
        );
      } finally {
        // afterEach only clearAllMocks(), which does not restore spies; leaking a silenced
        // console.warn would mute the rest of this file's diagnostics.
        warn.mockRestore();
      }
    });
  });

  // ── A failed server-side session teardown must be observable ───────────────
  //
  // Four sites in WorkspaceContext destroy the server-side session and swallow the
  // rejection (`destroySession(token).catch(() => {})`). On a shared POS terminal the
  // operator then sees a signed-out screen while the server session can still be live
  // for the next person at the till. The change under test is ONLY the silence: each
  // case asserts (a) the failure is REPORTED, in this file's message shape
  // (`"WorkspaceContext: <what failed>", err`, the shape used for its four degraded
  // reads -- "failed to list workspaces", "picker-ticket refresh failed", "failed to
  // create session token", "boot store resolution failed") but at ERROR level -- a
  // session that may still be live
  // on the till the next operator stands at is a security event, not a degraded read,
  // so it does not get to share a volume with "failed to list workspaces" -- and (b)
  // the local token clear and the navigation that follows it are unchanged. Nothing
  // here may require a retry, a UI state or a toast.
  describe('failed server-side session teardown', () => {
    const TEARDOWN = 'server-side session teardown failed';

    /**
     * The LEVEL is part of the contract, so the spy captures both: `console.error`
     * must carry the teardown failure and `console.warn` must not. A text-only spy on
     * whichever level the code happens to use passes either way -- that is the hole
     * `expectReportedAtErrorLevel` closes. Both are restored in the test's `finally`:
     * afterEach only clearAllMocks(), which does not unspy, and a leaked silenced
     * console.error would mute the rest of this file.
     */
    function spyLevels() {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      return {
        error,
        warn,
        restore: () => {
          error.mockRestore();
          warn.mockRestore();
        },
      };
    }

    function expectReportedAtErrorLevel(log: ReturnType<typeof spyLevels>) {
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining(TEARDOWN),
        expect.anything(),
      );
      expect(log.warn).not.toHaveBeenCalledWith(
        expect.stringContaining(TEARDOWN),
        expect.anything(),
      );
    }

    /** The auth session is mutable so a test can walk the provider through a logout. */
    function renderWithMutableSession() {
      const sessionRef: { current: LoginSessionDto | null } = {
        current: DEFAULT_SESSION,
      };
      const wrapper = ({ children }: { children: ReactNode }) =>
        withFluent(
          <MockAuthCtx.Provider
            value={{
              session: sessionRef.current,
              pickerTicket: sessionRef.current ? DEFAULT_TICKET : null,
            }}
          >
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </MockAuthCtx.Provider>,
        );
      const hook = renderHook(() => useWorkspace(), { wrapper });
      return { ...hook, sessionRef };
    }

    /** Renders the provider and mints a token for the restaurant instance. */
    async function withLiveToken() {
      const view = renderWithMutableSession();
      await waitFor(() => {
        expect(view.result.current.availableWorkspaces).toHaveLength(2);
      }, FAST_WAIT);
      act(() => {
        view.result.current.setActiveWorkspace('restaurant-pos');
      });
      await waitFor(() => {
        expect(view.result.current.sessionToken).toBe('tok-abc-123');
      }, FAST_WAIT);
      expect(mocks.destroySession).not.toHaveBeenCalled();
      return view;
    }

    function rejectingTeardown() {
      mocks.destroySession.mockRejectedValue(
        new Error('destroy_session rejected (simulated)'),
      );
    }

    // Site 1 of 4 (the brief's :266) -- the login/logout reset effect.
    it('logout: reports a failed teardown and still clears the local token', async () => {
      const log = spyLevels();
      try {
        const { result, rerender, sessionRef } = await withLiveToken();
        rejectingTeardown();

        sessionRef.current = null; // the operator signed out
        await act(async () => {
          rerender();
        });
        await flushAsync();

        // Behaviour unchanged: the local token is cleared regardless of the IPC result.
        expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
        expect(result.current.sessionToken).toBeNull();
        // The only thing that changed: the failure is no longer silent -- and it is
        // silent-or-error, never a warning sharing the degraded reads' volume.
        expectReportedAtErrorLevel(log);
      } finally {
        log.restore();
      }
    });

    // Site 2 of 4 (the brief's :325) -- switchStore.
    it('switchStore: reports a failed teardown and still completes the switch', async () => {
      const log = spyLevels();
      try {
        const { result } = await withLiveToken();
        rejectingTeardown();

        act(() => {
          result.current.switchStore('store-2');
        });
        await flushAsync();

        // Behaviour unchanged: local clear + navigation to the new store.
        expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
        expect(result.current.sessionToken).toBeNull();
        expect(result.current.resolvedStoreId).toBe('store-2');
        expectReportedAtErrorLevel(log);
      } finally {
        log.restore();
      }
    });

    // Site 3 of 4 (the brief's :384) -- swapSessionToken, the ADR #6 hot-swap on a
    // shared touchscreen.
    it('swapSessionToken: reports a failed teardown and still completes the swap', async () => {
      const log = spyLevels();
      try {
        const { result } = await withLiveToken();
        rejectingTeardown();
        mocks.createSession.mockResolvedValue(
          makeSessionResult({ session_token: 'tok-swapped' }),
        );

        await act(async () => {
          await result.current.swapSessionToken('user-2', 'role-manager');
        });

        // Behaviour unchanged: the swap finishes on the new cashier's token.
        expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
        expect(result.current.sessionToken).toBe('tok-swapped');
        expectReportedAtErrorLevel(log);
      } finally {
        log.restore();
      }
    });

    // Site 4 of 4 (the brief's :600) -- the token-creation effect re-entering with a
    // previous token.
    it('re-minting on a new workspace: reports a failed teardown of the previous token', async () => {
      const log = spyLevels();
      try {
        const { result } = await withLiveToken();
        rejectingTeardown();
        mocks.createSession.mockResolvedValue(
          makeSessionResult({ session_token: 'tok-xyz' }),
        );

        act(() => {
          result.current.setActiveWorkspace('store-pos');
        });
        await waitFor(() => {
          expect(result.current.sessionToken).toBe('tok-xyz');
        }, FAST_WAIT);
        await flushAsync();

        // Behaviour unchanged: the old token is dropped and the new one minted.
        expect(mocks.destroySession).toHaveBeenCalledWith('tok-abc-123');
        expect(result.current.sessionToken).toBe('tok-xyz');
        expectReportedAtErrorLevel(log);
      } finally {
        log.restore();
      }
    });
  });
});
