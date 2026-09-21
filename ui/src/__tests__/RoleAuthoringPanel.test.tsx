/**
 * @file RoleAuthoringPanel.test.tsx
 * @description Tests for the Roles panel of the staff management page
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

import { createRef } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import staffFtl from '@/locales/staff.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import RoleAuthoringPanel, { type RoleAuthoringPanelHandle } from '@/features/staff/components/RoleAuthoringPanel';
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
    // Three separate numbers, because they answer three different things:
    // FK rows (gates Delete), accounts (may say "accounts"), and workspace
    // grants (block a delete with nobody holding anything).
    holder_count: 0,
    grant_count: 0,
    ...over,
  };
}

/** One holder, shaped like the Rust RoleHolderDto (snake_case wire names). */
function holderDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: 'user-a',
    username: 'ana',
    display_name: 'Ana',
    is_active: true,
    has_assignment: true,
    scope_mode: 'global',
    scope_type: 'organization',
    scope_id: null,
    branch_scope: 'all',
    workspace_scope: 'all',
    branch_count: 0,
    workspace_count: 0,
    ...over,
  };
}

/** A page of holders shaped like RoleHoldersDto. */
function holdersPage(holders: unknown[], total = holders.length) {
  return { holders, total, cap: 50 };
}

const PRESET = roleDto({ id: 'role-owner', name: 'Owner', is_builtin: true, reference_count: 3 });
// id is the preset; the display name deliberately is NOT "Custom", so a
// passing assertion cannot be an accident of the badge text matching the name.
const CUSTOM_PRESET = roleDto({ id: 'role-custom', name: 'Flexible', is_builtin: true, permissions: [] });
const AUTHORED = roleDto({ id: 'role-night-manager', name: 'Night Manager' });
// reference_count is 2 for a reason worth keeping visible: the FK total is
// NOT the account count. One holder plus one workspace grant.
const IN_USE = roleDto({
  id: 'role-warehouse',
  name: 'Warehouse Lead',
  reference_count: 2,
  holder_count: 1,
  grant_count: 1,
});

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

/** The panel's handle, set by renderScreen: the create trigger lives in the
 *  page header now, so this is the same entry point the header button uses. */
let handle: { current: RoleAuthoringPanelHandle | null };

function renderScreen(withToken = true) {
  vi.mocked(useWorkspace).mockReturnValue({
    ...workspaceValue,
    sessionToken: withToken ? HARNESS_SESSION_TOKEN : null,
  });
  handle = createRef<RoleAuthoringPanelHandle>();
  return renderWithProvidersSync(<RoleAuthoringPanel active handleRef={handle} />, staffFtl, sharedFtl);
}

/** Open the create editor the way the header's "Add New Role" button does. */
function openCreateEditor() {
  act(() => {
    handle.current!.openCreate();
  });
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

describe('RoleAuthoringPanel', () => {
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

    // Same two controls, located the way a test has to when the label is a
    // translation: by the testid, which is what the row actions are tagged with.
    // Both render through the shared Button (a bare <button> carries no `btn`).
    const edit = screen.getByTestId('staff-role-edit-role-night-manager');
    const del = screen.getByTestId('staff-role-delete-role-night-manager');
    expect(edit.className).toMatch(/\bbtn(--|$)/);
    expect(del.className).toMatch(/\bbtn(--|$)/);
    expect(edit).toHaveAccessibleName('Edit the Night Manager role');
  });

  it('disables Delete and says why while a role is referenced', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Warehouse Lead')).toBeInTheDocument());
    expect(screen.getByLabelText('Delete the Warehouse Lead role')).toBeDisabled();
    // Disabled-by-reference, read through the testid this time.
    expect(screen.getByTestId('staff-role-delete-role-warehouse')).toBeDisabled();
    // The whole reason for the split, in one row: reference_count is 2, only
    // ONE of those rows is a person, and the label now says so — 1 account
    // and 1 workspace grant, never "2 accounts". Delete stays gated on
    // reference_count, which is the correct FK basis.
    expect(screen.getByText('Used by 1 account')).toBeInTheDocument();
    expect(screen.getByText('and 1 workspace grant')).toBeInTheDocument();
    expect(screen.queryByText(/Used by \\d+ accounts/)).not.toBeInTheDocument();
  });

  it('creates with the camelCase wire keys Tauri binds', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    openCreateEditor();
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Trainee' } });
    fireEvent.click(screen.getByLabelText('sales:view'));
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

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
    openCreateEditor();
    for (const entry of PERMISSION_KEYS) {
      expect(screen.getByLabelText(entry.key)).toBeInTheDocument();
    }
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
  });

  // ── The write paths the shipped suite never fails ──────────────────
  //
  // The eleven tests above exercise every happy path and one failure: a
  // load that throws. But this screen's whole design is that the backend
  // owns the rules — preset ids, unregistered keys, duplicate names,
  // referenced roles — and the UI only explains them. Nothing asserted
  // what happens when the backend says no to a WRITE, which is the case
  // where an optimistic UI does the most damage.

  const NEW = roleDto({ id: 'role-trainee', name: 'Trainee' });

  /** A handler with a per-command answer table and a call log. */
  function scripted(spec: {
    roleLists?: unknown[][];
    keys?: unknown[];
    fail?: 'create_role_scoped' | 'update_role_scoped' | 'delete_role_scoped';
    hang?: boolean;
    holderPage?: unknown;
    failHolders?: boolean;
  }) {
    const calls: Record<string, unknown[][]> = {};
    let listCall = 0;
    handler.set(async (cmd, args) => {
      calls[cmd] = [...(calls[cmd] ?? []), [args]];
      if (cmd === 'get_brand_settings') return BRAND_SETTINGS;
      if (cmd === 'list_permission_keys_scoped') return spec.keys ?? PERMISSION_KEYS;
      if (cmd === 'list_roles_scoped') {
        if (spec.hang) return new Promise(() => {});
        const lists = spec.roleLists ?? [[AUTHORED]];
        return lists[Math.min(listCall++, lists.length - 1)];
      }
      if (cmd === 'list_role_holders_scoped') {
        if (spec.failHolders) throw new Error('holders refused');
        return spec.holderPage ?? holdersPage([]);
      }
      if (spec.fail === cmd) throw new Error('refused by the backend');
      return undefined;
    });
    return calls;
  }

  it('surfaces a refused save without pretending the role was saved', async () => {
    // The catch in save() has to do three things at once: show that
    // something went wrong, keep the editor open so the admin can fix the
    // name they just got a conflict on, and NOT report success. Swallowing
    // the error, or toasting before the await, each pass the shipped suite.
    scripted({ roleLists: [[AUTHORED]], fail: 'create_role_scoped' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());

    openCreateEditor();
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night Manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The editor survives, with the name still typed in.
    expect(screen.getByRole('button', { name: 'Save role' })).toBeInTheDocument();
    expect(screen.getByLabelText('Role name')).toHaveValue('Night Manager');
    // And no success is claimed.
    expect(screen.queryByText(/Saved the .* role/)).not.toBeInTheDocument();
    expect(callsFor('create_role_scoped')).toHaveLength(1);
  });

  it('reloads the list after a successful save so the new row appears', async () => {
    // closeEditor() then await refresh(): without the refresh the admin
    // saves a role that does not exist on screen until they navigate away,
    // and the natural conclusion is that the save silently did nothing.
    scripted({ roleLists: [[AUTHORED], [AUTHORED, NEW]] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    expect(screen.queryByText('Trainee')).not.toBeInTheDocument();

    openCreateEditor();
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Trainee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(screen.getByText('Trainee')).toBeInTheDocument());
    expect(screen.getByText('Saved the Trainee role.')).toBeInTheDocument();
    expect(callsFor('list_roles_scoped')).toHaveLength(2);
    // The editor closes on success.
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
  });

  it('surfaces a refused delete and leaves the row in place', async () => {
    // The reference count is read when the list loads, so a role can become
    // in-use between render and click — exactly the race the pre-check in
    // delete_role exists for. The dialog closes either way, so the only
    // signal left is the alert and the row still being there.
    scripted({ roleLists: [[AUTHORED]], fail: 'delete_role_scoped' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Delete the Night Manager role'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/Deleted the .* role/)).not.toBeInTheDocument();
    expect(screen.getByText('Night Manager')).toBeInTheDocument();
    expect(callsFor('delete_role_scoped')).toHaveLength(1);
  });

  it('drops grants the registry no longer lists from the saved payload', async () => {
    // save() derives the payload as keys.filter(k => granted.has(k.key)),
    // not from the granted set. The registry is the vocabulary enforcement
    // speaks (ADR #35), so a key that has left it must not be written back
    // just because an old row still names it. Sending [...granted] would
    // re-introduce a key the gate can never grant.
    const stale = roleDto({
      id: 'role-night-manager',
      name: 'Night Manager',
      permissions: ['sales:view', 'legacy:gone'],
    });
    scripted({ roleLists: [[stale]] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit the Night Manager role'));
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(callsFor('update_role_scoped')).toHaveLength(1));
    const [payload] = callsFor('update_role_scoped');
    // The whole update payload, not only the grants: id, name and
    // description ride the same untyped literal, so this is also the
    // camelCase pin for the update path.
    expect(payload?.['args']).toEqual({
      id: 'role-night-manager',
      name: 'Night Manager',
      description: '',
      permissions: ['sales:view'],
    });
    // And the stale key is not offered in the picker either.
    expect(screen.queryByLabelText('legacy:gone')).not.toBeInTheDocument();
  });

  it('will not send a save for a name that is blank or only spaces', async () => {
    // The client mirrors the backend's empty-name rule so the button says
    // no before the round trip. The trim is the part that matters: a name
    // of three spaces passes a .length check and is rejected server-side.
    scripted({ roleLists: [[AUTHORED]] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());

    openCreateEditor();
    expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Trainee' } });
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
  });

  it('claims nothing about the role set while the list is loading', async () => {
    // The screen returns a busy skeleton before anything else, which is
    // what keeps `roles.length === 0` from rendering "No roles yet" during
    // the fetch. Remove that early return and every admin with existing
    // roles is told they have none for the length of one IPC round trip.
    scripted({ roleLists: [[]], hang: true });
    renderScreen();

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('No roles yet')).not.toBeInTheDocument();
  });

  // ── holders ────────────────────────────────────────────────────────────

  it('fetches holders only when a row is expanded, with camelCase wire keys', async () => {
    const calls = scripted({ roleLists: [[AUTHORED]], holderPage: holdersPage([holderDto()]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    // Nothing is fetched up front: with twenty roles this would be twenty
    // extra calls to answer a question about one of them.
    expect(calls['list_role_holders_scoped']).toBeUndefined();

    // The expander is the shared Button, tagged by role id.
    const toggle = screen.getByTestId('staff-role-holders-role-night-manager');
    expect(toggle.className).toMatch(/\bbtn(--|$)/);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(screen.getByTestId('staff-role-holders-role-night-manager')).toHaveAttribute('aria-expanded', 'true');
    expect(calls['list_role_holders_scoped']).toHaveLength(1);
    expect(calls['list_role_holders_scoped']?.[0]?.[0]).toEqual({
      sessionToken: HARNESS_SESSION_TOKEN,
      id: 'role-night-manager',
    });
    expect(screen.getByText('1 account')).toBeInTheDocument();
  });

  it('offers holders for a preset row, which cannot be edited or deleted', async () => {
    // The point of the surface for built-ins: an admin cannot change Owner,
    // so who holds it is the only thing they can act on. Edit/Delete are
    // absent here by the same rule that removes them elsewhere.
    const calls = scripted({ roleLists: [[PRESET]], holderPage: holdersPage([holderDto()]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    expect(screen.queryByLabelText('Edit the Owner role')).not.toBeInTheDocument();
    // A preset carries no edit/delete tag but still carries the holders one.
    expect(screen.queryByTestId('staff-role-edit-role-owner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('staff-role-holders-role-owner'));
    await waitFor(() => expect(calls['list_role_holders_scoped']).toHaveLength(1));
  });

  it('serves a re-expanded role from cache instead of refetching', async () => {
    const calls = scripted({ roleLists: [[AUTHORED]], holderPage: holdersPage([holderDto()]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    const toggle = screen.getByLabelText('Show the accounts holding the Night Manager role');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(calls['list_role_holders_scoped']).toHaveLength(1);
  });

  it('names the remainder past the cap instead of a silently clipped list', async () => {
    const calls = scripted({
      roleLists: [[AUTHORED]],
      holderPage: holdersPage([holderDto()], 60),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Night Manager role'));
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(calls['list_role_holders_scoped']).toHaveLength(1);
    // The label uses the uncapped total, and the remainder is spelled out —
    // neither may be inferred from how many rows happened to arrive.
    expect(screen.getByText('60 accounts')).toBeInTheDocument();
    expect(screen.getByText('and 59 more')).toBeInTheDocument();
  });

  it('says plainly when nobody holds the role', async () => {
    scripted({ roleLists: [[AUTHORED]], holderPage: holdersPage([]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Night Manager role'));
    await waitFor(() => expect(screen.getByText('No accounts hold this role.')).toBeInTheDocument());
  });

  it('renders a legacy account as having no assignment, not as scoped to nothing', async () => {
    const legacy = holderDto({
      has_assignment: false,
      scope_mode: null,
      scope_type: null,
      scope_id: null,
      branch_scope: null,
      workspace_scope: null,
      branch_count: null,
      workspace_count: null,
    });
    scripted({ roleLists: [[AUTHORED]], holderPage: holdersPage([legacy]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Night Manager role'));
    await waitFor(() => expect(screen.getByText('No assignment record')).toBeInTheDocument());
  });

  it('reads a zero branch count as unrestricted when the dimension says all', async () => {
    // The trap branch_scope exists to avoid. A scoped assignment covering
    // every branch has zero explicit rows, so a column rendering the count
    // alone would tell an admin this manager has no branches at all.
    const all = holderDto({
      scope_mode: 'scoped',
      scope_type: 'location',
      scope_id: 'loc-7',
      branch_count: 0,
      workspace_count: 0,
    });
    scripted({ roleLists: [[AUTHORED]], holderPage: holdersPage([all]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Night Manager role'));
    await waitFor(() => expect(screen.getByText('all branches and workspaces')).toBeInTheDocument());
    expect(screen.queryByText('0 branches')).not.toBeInTheDocument();
    expect(screen.getByText('Location loc-7')).toBeInTheDocument();
  });

  it('keeps a failed holder read inside the row', async () => {
    // A holder list that will not load is not a broken role list: the banner
    // and the editor must survive it, and the row must say what failed.
    scripted({ roleLists: [[AUTHORED]], failHolders: true });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Night Manager')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Night Manager role'));
    await waitFor(() => expect(screen.getByText('Could not load holders.')).toBeInTheDocument());
    expect(screen.getByText('Night Manager')).toBeInTheDocument();
    expect(screen.queryByText('0 accounts')).not.toBeInTheDocument();
  });

  it('states a grant-only role as a grant and never as an account', async () => {
    // The false claim in its strongest form. A role granted to a workspace
    // type and held by nobody has reference_count 1, so the original label
    // asserted one account about a role with zero accounts — and once the
    // Holders disclosure shipped, it did so directly above "No accounts hold
    // this role." Same screen, same row, permanently contradictory.
    const granted_only = roleDto({
      id: 'role-granted-only',
      name: 'Granted Only',
      reference_count: 1,
      holder_count: 0,
      grant_count: 1,
    });
    scripted({ roleLists: [[granted_only]], holderPage: holdersPage([]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Granted Only')).toBeInTheDocument());
    expect(screen.getByText('Carries 1 workspace grant')).toBeInTheDocument();
    // The accounts sentence must not render at all while holder_count is zero,
    // however many FK rows exist — that pairing is what made the number a lie.
    expect(screen.queryByText(/Used by \\d+ account/)).not.toBeInTheDocument();
    // Delete still gated: reference_count is FK truth and gates correctly.
    expect(screen.getByLabelText('Delete the Granted Only role')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Show the accounts holding the Granted Only role'));
    await waitFor(() => expect(screen.getByText('No accounts hold this role.')).toBeInTheDocument());
    // And both sentences survive side by side, because they now describe
    // different things: one foreign-key row, zero accounts.
    expect(screen.getByText('Carries 1 workspace grant')).toBeInTheDocument();
  });
});
