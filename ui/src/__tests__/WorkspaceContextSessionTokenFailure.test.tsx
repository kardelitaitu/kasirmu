// Operator-visibility probe for a REJECTED create_session in WorkspaceProvider.
//
// The token-creation effect used to catch the rejection and only console.warn,
// leaving sessionToken null with nothing on screen: every token-taking command
// downstream then failed or no-opped with no explanation, on both shells, for
// every rejection reason (clock rollback, denied workspace type, expired
// subscription, invalid signature). These cases pin the replacement contract:
// an error toast is raised, sessionError records the localized reason, the
// token stays null, and retrySessionToken re-runs the command.
//
// Kept separate from WorkspaceContext.test.tsx (a 605-line green suite) so the
// failure path is readable on its own and that file stays the baseline this
// change must not disturb.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import type { LoginSessionDto, CreateSessionResult } from '@/api/staff';
import type { WorkspaceDto } from '@/api/workspaces';
import { withFluent } from '@/locales/test-utils';

// Opt out of the global WorkspaceContext stub installed by the setup file:
// this file exercises the REAL provider.
vi.unmock('@/contexts/WorkspaceContext');

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listWorkspaceScreens: vi.fn(),
  resolveBootStore: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  refreshPickerTicket: vi.fn(),
  getDeviceId: vi.fn(),
  addToast: vi.fn(),
}));

// The provider surfaces the failure through the shared toast queue. Mocking the
// Toast module (the repo's dominant pattern for toast assertions) also keeps
// this harness from needing a ToastProvider ancestor.
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: (...args: unknown[]) => mocks.addToast(...args) }),
}));

const MockAuthCtx = createContext<{
  session: LoginSessionDto | null;
  pickerTicket: string | null;
}>({ session: null, pickerTicket: null });

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useContext(MockAuthCtx),
}));

vi.mock('@/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
  listWorkspaceScreens: (...args: unknown[]) => mocks.listWorkspaceScreens(...args),
  resolveBootStore: (...args: unknown[]) => mocks.resolveBootStore(...args),
}));

vi.mock('@/api/staff', () => ({
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  destroySession: (...args: unknown[]) => mocks.destroySession(...args),
  refreshPickerTicket: (...args: unknown[]) => mocks.refreshPickerTicket(...args),
}));

vi.mock('@/api/system', () => ({
  getDeviceId: (...args: unknown[]) => mocks.getDeviceId(...args),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const SESSION: LoginSessionDto = {
  user_id: 'user-1',
  display_name: 'Alice',
  role_name: 'cashier',
  role_id: 'role-cashier',
  permissions: [],
};

const TICKET = 'ticket-abc';

const INSTANCE: WorkspaceDto = {
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
};

function makeSessionResult(
  overrides: Partial<CreateSessionResult> = {},
): CreateSessionResult {
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

function renderWorkspaceHook() {
  // withFluent auto-loads shared.ftl, which is where the new message lives.
  const wrapper = ({ children }: { children: ReactNode }) =>
    withFluent(
      <MockAuthCtx.Provider value={{ session: SESSION, pickerTicket: TICKET }}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </MockAuthCtx.Provider>,
    );
  return renderHook(() => ({ workspace: useWorkspace() }), { wrapper });
}

type HookResult = { current: { workspace: ReturnType<typeof useWorkspace> } };

/** Wait out the boot, then select a workspace: that fires createSession. */
async function selectWorkspace(result: HookResult) {
  await waitFor(() => {
    expect(result.current.workspace.loading).toBe(false);
  });
  act(() => {
    result.current.workspace.setActiveWorkspace('restaurant-pos');
  });
}

beforeEach(() => {
  mocks.resolveBootStore.mockResolvedValue({
    is_bound: false,
    store_id: 'store-1',
    instance_id: null,
  });
  mocks.listWorkspaces.mockResolvedValue([INSTANCE]);
  mocks.listWorkspaceScreens.mockResolvedValue([
    { screen_key: 'pos', sort_order: 1 },
  ]);
  mocks.createSession.mockResolvedValue(makeSessionResult());
  mocks.destroySession.mockResolvedValue(undefined);
  mocks.refreshPickerTicket.mockRejectedValue(
    new Error('no refreshed ticket in this test'),
  );
  mocks.getDeviceId.mockResolvedValue('terminal-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Cases ────────────────────────────────────────────────────────────

describe('WorkspaceContext - rejected create_session', () => {
  it('records a user-visible error and raises an error toast instead of swallowing the rejection', async () => {
    mocks.createSession.mockRejectedValue(
      new Error('clock rollback detected: token issued in the future'),
    );

    const { result } = renderWorkspaceHook();
    await selectWorkspace(result);

    // The rejection must surface as localized copy resolved from shared.ftl
    // workspace-session-token-error. Asserting the resolved TEXT (not merely
    // non-null) is what proves the key is really in the loaded bundle.
    await waitFor(() => {
      expect(result.current.workspace.sessionError).toBe(
        'Could not start the session for this workspace. Check the details and try again.',
      );
    });

    // Toast payload shape (components/Toast.tsx) — typed locally rather
    // than as Record<string, unknown>, which trips noPropertyAccessFromIndexSignature.
    type ToastPayload = { type: string; message: string; detail: string };
    expect(mocks.addToast).toHaveBeenCalledTimes(1);
    const payload = mocks.addToast.mock.calls[0]?.[0] as ToastPayload;
    expect(payload.type).toBe('error');
    expect(payload.message).toBe(
      'Could not start the session for this workspace. Check the details and try again.',
    );
    expect(payload.detail).toContain('clock rollback detected');
  });

  it('leaves sessionToken null when create_session rejects', async () => {
    mocks.createSession.mockRejectedValue(
      new Error('workspace type not permitted for this license'),
    );

    const { result } = renderWorkspaceHook();
    await selectWorkspace(result);

    await waitFor(() => {
      expect(result.current.workspace.sessionError).not.toBeNull();
    });
    expect(result.current.workspace.sessionToken).toBeNull();
  });

  it('retrySessionToken re-invokes create_session and clears the error on success', async () => {
    mocks.createSession.mockRejectedValue(new Error('subscription expired'));

    const { result } = renderWorkspaceHook();
    await selectWorkspace(result);

    await waitFor(() => {
      expect(result.current.workspace.sessionError).not.toBeNull();
    });
    expect(result.current.workspace.sessionToken).toBeNull();
    expect(mocks.createSession).toHaveBeenCalledTimes(1);

    // The retry must actually re-run the command for the SAME instance, not
    // just clear the banner.
    mocks.createSession.mockResolvedValue(
      makeSessionResult({ session_token: 'tok-after-retry' }),
    );
    mocks.createSession.mockClear();

    act(() => {
      result.current.workspace.retrySessionToken?.();
    });

    expect(result.current.workspace.sessionError).toBeNull();
    // The re-mint awaits the device-id read before it can name the command, so
    // the re-invoke is observed rather than assumed.
    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledTimes(1);
    });
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: 'store-1',
        instance_id: 'inst-restaurant',
        type_key: 'restaurant-pos',
      }),
    );

    await waitFor(() => {
      expect(result.current.workspace.sessionToken).toBe('tok-after-retry');
    });
    expect(result.current.workspace.sessionError).toBeNull();
  });

  it('retrySessionToken is a no-op before anything has been attempted', async () => {
    const { result } = renderWorkspaceHook();
    await waitFor(() => {
      expect(result.current.workspace.loading).toBe(false);
    });

    mocks.createSession.mockClear();
    act(() => {
      result.current.workspace.retrySessionToken?.();
    });
    await act(async () => {});

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(result.current.workspace.sessionError).toBeNull();
  });
});
