/**
 * @file RoleAuthoringScreen.test.tsx
 * @description Tests for the custom-role authoring screen
 * (todo-global-saas-3.md, ADR #47 ruling 4).
 *
 * Covers:
 *   - Built-in rows offer no Edit/Delete, including role-custom — the trap
      the name invites: role-custom is a preset, so the flag decides, never the name
 *   - An authored row offers both, and a referenced one disables Delete
 *   - Create and update send the camelCase wire keys Tauri actually binds
 *     (Amendment 3 defect 1: a snake_case key typechecks and fails at runtime)
 *   - The grant set is replaced, not merged, on update
 *   - Delete goes through the confirm dialog
 *   - A session-token-less render fires no authoring calls
 *   - A failed load renders the alert
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import staffFtl from '@/locales/staff.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import RoleAuthoringScreen from '@/features/staff/RoleAuthoringScreen';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

const { invokeMock, handler } = vi.hoisted(() => {
  let h: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
  const impl = (cmd: string, args?: unknown): Promise<unknown> => {
    if (h) return h(cmd, args);
    return Promise.resolve(undefined);
  };
  return {
    invokeMock: vi.fn(impl),
    handler: {
      set: (next: typeof h) => {
        h = next;
      },
      clear: () => {
        h = null;
      },
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const workspaceValue = {
  activeWorkspace: 'admin' as const,
  setActiveWorkspace: vi.fn(),
  activeInstance: null,
  setActiveInstance: vi.fn(),
  availableWorkspaces: [],
  workspaceScreens: [],
  loading: false,
  error: null,
  retry: vi.fn(),
  lastWorkspace: null,
  switchStore: vi.fn(),
  resolvedStoreId: 'default',
  sessionToken: 'test-token',
  swapSessionToken: vi.fn(),
  terminalId: '',
};

/** A role payload shaped like the Rust RoleDto (snake_case wire names). */
function roleDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'role-night-manager',
    name: 'Night Manager',
    description: '',
    permissions: ['sales:view'],
    is_builtin: false,
    reference_count: 0,
    ...over,
  };
}

const PRESET = roleDto({ id: 'role-owner', name: 'Owner', is_builtin: true, reference_count: 3 });
// id is the preset; the display name deliberately is NOT "Custom", so a
// passing assertion cannot be an accident of the badge text matching the name.
const CUSTOM_PRESET = roleDto({ id: 'role-custom', name: 'Flexible', is_builtin: true, permissions: [] });
const AUTHORED = roleDto({ id: 'role-night-manager', name: 'Night Manager' });
const IN_USE = roleDto({ id: 'role-warehouse', name: 'Warehouse Lead', reference_count: 2 });

const PERMISSION_KEYS = [
  { key: 'sales:view', family: 'sales', sensitive: false, description: 'View sales records.' },
  { key: 'sales:void', family: 'sales', sensitive: true, description: 'Void a completed sale.' },
  { key: 'staff:read', family: 'staff', sensitive: false, description: 'View staff members.' },
];

/**
 * The brand settings ThemeProvider reads on mount. Unrelated to this
 * screen, but a test handler that answers every command must not leave it
 * undefined or the render throws before any assertion runs.
 */
const BRAND_SETTINGS = { primary_colour: '#4f46e5', logo_path: null, store_name: '' };

function seed(roles = [PRESET, CUSTOM_PRESET, AUTHORED, IN_USE]) {
  handler.set(async (cmd) => {
    if (cmd === 'get_brand_settings') return BRAND_SETTINGS;
    if (cmd === 'list_roles_scoped') return roles;
    if (cmd === 'list_permission_keys_scoped') return PERMISSION_KEYS;
    if (cmd === 'create_role_scoped' || cmd === 'update_role_scoped') return roles[2];
    if (cmd === 'delete_role_scoped') return null;
    return undefined;
  });
}

function renderScreen(withToken = true) {
  vi.mocked(useWorkspace).mockReturnValue({
    ...workspaceValue,
    sessionToken: withToken ? HARNESS_SESSION_TOKEN : null,
  });
  return renderWithProvidersSync(<RoleAuthoringScreen />, staffFtl, sharedFtl);
}

const callsFor = (cmd: string) =>
  invokeMock.mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

beforeEach(() => {
  invokeMock.mockClear();
  seed();
});

afterEach(() => {
  handler.clear();
  cleanup();
});

describe('RoleAuthoringScreen', () => {
  it('renders every role with its preset or custom badge', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    expect(screen.getByText('Night Manager')).toBeInTheDocument();
    expect(screen.getAllByText('Built-in')).toHaveLength(2);
    expect(screen.getAllByText('Custom')).toHaveLength(2);
    expect(screen.getByText('Flexible')).toBeInTheDocument();
  });

  it('offers no Edit or Delete on a preset row', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    expect(screen.queryByLabelText('Edit the Owner role')).toBeNull();
    expect(screen.queryByLabelText('Delete the Owner role')).toBeNull();
  });

  it('offers no Edit or Delete on role-custom, which is a preset', async () => {
    // The trap the name invites. role-custom is one of ROLE_PRESETS — the
    // empty-grant placeholder the picker offers — so seeding rewrites it and
    // it is not authorable. Only the is_builtin flag decides; a UI that keyed
    // off the name would offer Edit and then take a backend refusal.
    renderScreen();
    await waitFor(() => expect(screen.getByText('Flexible')).toBeInTheDocument());
    expect(screen.queryByLabelText('Edit the Flexible role')).toBeNull();
    expect(screen.queryByLabelText('Delete the Flexible role')).toBeNull();
  });

  it('offers Edit and Delete on an authored row', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    expect(screen.getByLabelText('Edit the Night Manager role')).toBeEnabled();
    expect(screen.getByLabelText('Delete the Night Manager role')).toBeEnabled();
  });

  it('disables Delete and says why while a role is referenced', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Warehouse Lead')).toBeInTheDocument());
    expect(screen.getByLabelText('Delete the Warehouse Lead role')).toBeDisabled();
    expect(screen.getByText('Used by 2 accounts')).toBeInTheDocument();
  });

  it('creates with the camelCase wire keys Tauri binds', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Create a new custom role'));
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Trainee' } });
    fireEvent.click(screen.getByLabelText('sales:view'));
    fireEvent.click(screen.getByLabelText('Save this role'));

    await waitFor(() => expect(callsFor('create_role_scoped')).toHaveLength(1));
    const [args] = callsFor('create_role_scoped');
    // sessionToken, not session_token: the invoke args object is an untyped
    // literal, so a wrong key passes typecheck and fails at runtime.
    expect(args).toHaveProperty('sessionToken', HARNESS_SESSION_TOKEN);
    expect(args).not.toHaveProperty('session_token');
    expect(args).toHaveProperty('args', {
      name: 'Trainee',
      description: '',
      permissions: ['sales:view'],
    });
  });

  it('replaces the grant set on edit rather than merging it', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit the Night Manager role'));
    // The row starts granted sales:view; add one and drop the original.
    fireEvent.click(screen.getByLabelText('staff:read'));
    fireEvent.click(screen.getByLabelText('sales:view'));
    fireEvent.click(screen.getByLabelText('Save this role'));

    await waitFor(() => expect(callsFor('update_role_scoped')).toHaveLength(1));
    const [args] = callsFor('update_role_scoped');
    expect(args).toHaveProperty('sessionToken', HARNESS_SESSION_TOKEN);
    expect((args as { args: { permissions: string[] } }).args.permissions).toEqual([
      'staff:read',
    ]);
    expect((args as { args: { id: string } }).args.id).toBe('role-night-manager');
  });

  it('deletes only through the confirm dialog', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Delete the Night Manager role'));
    // The click alone must not delete.
    expect(callsFor('delete_role_scoped')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(callsFor('delete_role_scoped')).toHaveLength(1));
    const [args] = callsFor('delete_role_scoped');
    expect(args).toHaveProperty('sessionToken', HARNESS_SESSION_TOKEN);
    expect(args).toHaveProperty('id', 'role-night-manager');
  });

  it('fires no authoring call without a session token', async () => {
    renderScreen(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(callsFor('list_roles_scoped')).toHaveLength(0);
    expect(callsFor('list_permission_keys_scoped')).toHaveLength(0);
  });

  it('surfaces a failed load as an alert', async () => {
    handler.set(async (cmd) => {
      if (cmd === 'get_brand_settings') return BRAND_SETTINGS;
      if (cmd === 'list_roles_scoped') throw new Error('boom');
      return [];
    });
    renderScreen();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('feeds the picker from the registry rather than a constant', async () => {
    // The list rendered is exactly what the command returned; a hardcoded
    // picker would drift from the keys the gate honors (ADR #35).
    seed([PRESET, AUTHORED]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Create a new custom role'));
    for (const entry of PERMISSION_KEYS) {
      expect(screen.getByLabelText(entry.key)).toBeInTheDocument();
    }
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
  });
});
