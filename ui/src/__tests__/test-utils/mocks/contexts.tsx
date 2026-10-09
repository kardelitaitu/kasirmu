// ── Shared context mocks ────────────────────────────────────────────
//
// These mock factories are used by RetailPosScreen, PosScreen, AppShell,
// PaymentModal, and other test files that need AuthContext / WorkspaceContext
// providers. Import and use with `createAuthContextMock()` or call the
// factory directly inside a `vi.mock()` block.
//
// Usage:
//   import { createAuthContextMock, createWorkspaceContextMock } from
//     '@/__tests__/test-utils/mocks/contexts';
//
//   vi.mock('@/contexts/AuthContext', () => ({
//     useAuth: createAuthContextMock(),
//   }));

import { vi } from 'vitest';
import type { ReactNode } from 'react';

// ── AuthContext ───────────────────────────────────────────────────

export interface AuthContextOverrides {
  userId?: string;
  username?: string;
  roleName?: string;
  roleId?: string;
  token?: string;
  displayName?: string;
  isManager?: boolean;
  isOwner?: boolean;
  /** Effective permission keys (mirrors the backend registry; empty = none). */
  permissions?: string[];
}

/**
 * Create a mock `useAuth()` return value. Defaults to a cashier session.
 * Pass overrides for specific test scenarios (e.g. manager, owner).
 *
 * The returned function matches the `useAuth` hook signature so it can
 * be used directly in `vi.mock('@/contexts/AuthContext', () => ({
 *   useAuth: createAuthContextMock({ isManager: true }),
 * }))`.
 */
export function createAuthContextMock(overrides: AuthContextOverrides = {}) {
  const {
    userId = 'user-1',
    username = 'testuser',
    roleName = 'cashier',
    roleId = 'role-1',
    token = 'mock-token',
    displayName = 'Kasir Test',
    isManager = false,
    isOwner = false,
    permissions = [],
  } = overrides;

  return () => ({
    session: {
      user_id: userId,
      username,
      role_name: roleName,
      token,
      role_id: roleId,
      display_name: displayName,
      permissions,
    },
    loading: false,
    error: null,
    login: vi.fn(async (_username: string, _pin: string) => {}),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
    isManager,
    isOwner,
    // Mirrors AuthContext.hasPermission exactly: the grant list decides when
    // present (wildcard-aware `*` / `domain:*`), else the caller's fallback. A
    // stub that always returned `fallback` would let a test pass while the real
    // check did something else — the divergence this session keeps finding.
    hasPermission: (perm: string, fallback: boolean): boolean => {
      if (permissions === undefined) return fallback;
      const domain = perm.includes(':') ? perm.split(':')[0]! : perm;
      return permissions.some((k) => k === perm || k === '*' || k === `${domain}:*`);
    },
  });
}

// ── WorkspaceContext ──────────────────────────────────────────────

/**
 * Optional overrides.
 *
 * `sessionToken` is read on every render, so a test can mutate a held object to
 * simulate a STORE SWITCH -- the pattern createAuthContextMock already uses for its
 * own fields.
 *
 * PASS A GETTER, NOT A SNAPSHOT. This is the whole subtlety and it cost three rounds
 * of a test that silently never raced anything (fixed in 14295df1a):
 *
 *   // WRONG -- the property is evaluated ONCE, at mock-registration time, and the
 *   // factory then reads a frozen string forever. A later mutation of wsState is
 *   // invisible, so the effect under test never re-runs and the test passes without
 *   // exercising the race at all.
 *   createWorkspaceContextMock({ sessionToken: wsState.sessionToken })
 *
 *   // RIGHT -- the factory closes over the OBJECT, so each read sees the current
 *   // value.
 *   createWorkspaceContextMock({ get sessionToken() { return wsState.sessionToken; } })
 *
 * A mock declared as `useWorkspace: () => ({ sessionToken: wsState.sessionToken })`
 * is equally live and needs no override at all -- that inline arrow is what most of
 * the suite uses, and why most files can switch stores without this parameter.
 */
export interface WorkspaceContextOverrides {
  sessionToken?: string | null;
}

/**
 * Create a mock WorkspaceContext module factory.
 *
 * Returns the full module shape that `vi.mock('@/contexts/WorkspaceContext')`
 * expects: `{ useWorkspace, useWorkspaceScope, WorkspaceProvider }`.
 *
 * Defaults to `store-pos` active workspace with a mock session token.
 * Components that need `useWorkspaceScope()` will receive non-null defaults.
 */
export function createWorkspaceContextMock(
  overrides: WorkspaceContextOverrides = {},
) {
  // Read through the overrides OBJECT on every render rather than destructuring once:
  // a test that mutates `wsState.sessionToken` after mount must be seen by the next
  // render, or a store switch silently re-reads the old token.
  const sessionToken = () => overrides.sessionToken ?? 'mock-session-token';
  return {
    useWorkspace: () => ({
      activeWorkspace: 'store-pos' as string | null,
      setActiveWorkspace: vi.fn((_key: string | null) => {}),
      activeInstance: null,
      setActiveInstance: vi.fn(),
      availableWorkspaces: [],
      workspaceScreens: [],
      loading: false,
      error: null,
      retry: vi.fn(),
      lastWorkspace: null,
      switchStore: vi.fn((_storeId: string) => {}),
      resolvedStoreId: 'default',
      sessionToken: sessionToken() as string | null,
      swapSessionToken: vi.fn(async (_newUserId: string, _newRoleId: string) => {}),
      terminalId: '',
    }),
    useWorkspaceScope: () => ({
      storeId: 'default',
      instanceId: 'default',
      typeKey: 'store-pos',
    }),
    WorkspaceProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
  };
}
