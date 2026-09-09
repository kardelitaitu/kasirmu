// ── Dev-mock role holders ────────────────────────────────────────
//
// list_role_holders_scoped gained a mock handler so scripts/verify-ipc-parity.py
// stops reporting it unanswerable: before this, invoke() returned null in
// browser preview and the role authoring screen rendered its holders-error path
// for every role, which is the failure mode the gate names explicitly.
//
// These pin the mock against the real surface rather than against itself:
//   - apps/desktop-client/src/commands/staff.rs — RoleHolderDto / RoleHoldersDto
//     field names and the cap it reports;
//   - crates/oz-core/src/db/roles.rs — role_holder_count and role_holders share
//     ONE WHERE clause precisely so no caller can be handed a count and a list
//     that disagree. The mock carries the same obligation, and the per-role
//     drift test below is what enforces it here.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock — the
// same path a browser preview takes.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import type { RoleHolderDto, RoleHoldersDto } from '@/api/staff';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Flat args on purpose: api/staff.ts invokes { sessionToken, id } and the real
// command takes `id` as its own named parameter rather than a boxed payload.
// invoke() unwraps an { args } envelope if one arrives, so this is the shape
// that actually reaches the handler.
const holders = (id: string): Promise<RoleHoldersDto> =>
  invoke<RoleHoldersDto>('list_role_holders_scoped', { sessionToken: 'mock-token', id });

const staffRows = (): Promise<Array<Record<string, unknown>>> =>
  invoke<Array<Record<string, unknown>>>('list_staff_scoped');

const roleRows = (): Promise<Array<{ id: string; name: string }>> =>
  invoke<Array<{ id: string; name: string }>>('list_roles_scoped');

describe('dev-mock role holders surface', () => {
  it('answers with every field the TypeScript contract declares', async () => {
    // A cast alone would not catch this: the mock returns untyped literals, so a
    // renamed or dropped field would typecheck and then render undefined in the
    // preview. Asserted in both directions, on the page and on a row.
    const page = await holders('role-owner');
    expect(Object.keys(page).sort()).toEqual(['cap', 'holders', 'total']);
    const declared = [
      'branch_count',
      'branch_scope',
      'display_name',
      'has_assignment',
      'is_active',
      'scope_id',
      'scope_mode',
      'scope_type',
      'user_id',
      'username',
      'workspace_count',
      'workspace_scope',
    ];
    const first = page.holders[0] as unknown as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(declared);
  });

  it('counts exactly the accounts the staff command returns, per role', async () => {
    // The whole reason mockRoleHolders derives from mockStaffFixtures instead of
    // restating people. If those two lists ever disagree, the preview shows a
    // role labelled one number of accounts whose own expanded list names
    // different ones — the contradiction the real backend was just fixed for.
    const staff = await staffRows();
    const roles = await roleRows();
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      const page = await holders(role.id);
      const expected = staff.filter((m) => m['role_id'] === role.id).length;
      expect(page.total, `${role.name} total`).toBe(expected);
      expect(page.holders, `${role.name} page`).toHaveLength(expected);
    }
  });

  it('refuses a role that does not exist rather than reporting nobody', async () => {
    // core's role_holders answers NotFound for the same reason: "no accounts hold
    // this role" and "there is no such role" are different facts, and only the
    // first licenses a delete. A mock returning [] would let a screen be built
    // against a typo-tolerant backend.
    await expect(holders('role-does-not-exist')).rejects.toThrow(/does not exist/);
  });

  it('reports the ceiling it applied instead of leaving 50 to be guessed', async () => {
    const page = await holders('role-admin');
    expect(page.cap).toBe(50);
    expect(page.holders.length).toBeLessThanOrEqual(page.cap);
    expect(page.total).toBeGreaterThanOrEqual(page.holders.length);
  });

  it('carries branch_scope beside the count, where zero means unrestricted', async () => {
    // The trap this row shape exists to defuse: a global assignment covers every
    // branch and so lists none, and branch_count 0 read on its own says "no
    // branches at all" about the most powerful account on the system.
    const page = await holders('role-owner');
    const owner = page.holders[0] as RoleHolderDto;
    expect(owner.branch_scope).toBe('all');
    expect(owner.workspace_scope).toBe('all');
    expect(owner.branch_count).toBe(0);
    expect(owner.workspace_count).toBe(0);
    expect(owner.scope_mode).toBe('global');
    expect(owner.scope_type).toBe('organization');
    expect(owner.scope_id).toBeNull();
    expect(owner.has_assignment).toBe(true);
  });

  it('gives a known role with nobody on it an honest empty page', async () => {
    // Night Manager is the mock's only authored role and no fixture is assigned
    // to it — the case the screen's "No accounts hold this role." copy exists
    // for. Kept distinct from the refusal above on purpose: known role, zero
    // holders is a real answer; unknown role is not.
    const page = await holders('role-night-manager');
    expect(page.holders).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.cap).toBe(50);
  });

  it('lists holders for a preset role too, since holders is not authoring', async () => {
    // A preset row cannot be edited, but an admin still needs to know where the
    // Owner role sits before revoking something that depends on it.
    const page = await holders('role-owner');
    expect(page.holders.map((h) => h.user_id)).toEqual(['staff-1']);
    expect(page.holders[0]?.display_name).toBe('Owner');
  });

  it('states the same count on the role row as in its holder page', async () => {
    // The collapsed row's label and the expanded list are two renderings of
    // one number. mockRoleCounts derives from mockRoleHolders so they cannot
    // drift; this is the guard that keeps it that way, because the drift is
    // invisible per-role and only shows as a screen that contradicts itself.
    const roles = (await roleRows()) as unknown as Array<{
      id: string;
      name: string;
      holder_count?: number;
      grant_count?: number;
    }>;
    for (const role of roles) {
      const page = await holders(role.id);
      expect(role.holder_count, `${role.name} holder_count`).toBe(page.total);
      expect(role.grant_count, `${role.name} grant_count`).toBe(0);
    }
  });
});
/**
 * Regression for 3da6a6226. Both handlers used to read `args.args`, and invoke()
 * dispatches `handler(args?.['args'] ?? args)` — the envelope is unwrapped before a
 * handler runs. So each got undefined: create hit its own
 * `if (!name) throw new Error('role name must not be empty')` on EVERY browser-mode
 * create, and update matched no role and returned quietly.
 *
 * Nothing caught that because every existing test in this family calls FLAT helpers
 * (`holders(id)`, `roleRows()`), which never exercises the enveloped path the screens
 * actually use. These two go through `invoke()` with `{ sessionToken, args }` exactly
 * as ui/src/api/staff.ts:410/:417 sends it — under the old code the first assertion
 * rejects and the second silently renames nothing.
 */
type MockRoleResult = {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_builtin: boolean;
};

const createRole = (name: string, permissions: string[] = []) =>
  invoke<MockRoleResult>('create_role_scoped', {
    sessionToken: 'mock-token',
    args: { name, description: `mock ${name}`, permissions },
  });

describe('dev-mock role authoring through the invoke envelope', () => {
  it('creates the role the payload names, not a validation error', async () => {
    const created = await createRole('Floor Supervisor', ['sales:void']);
    expect(created.name).toBe('Floor Supervisor');
    expect(created.permissions).toEqual(['sales:void']);
    expect(created.is_builtin).toBe(false);
    // And it lands in the list the screen reads back, so the create is not just
    // echoing an argument.
    const rows = (await roleRows()) as unknown as Array<{ id: string; name: string }>;
    expect(rows.some((r) => r.id === created.id && r.name === 'Floor Supervisor')).toBe(
      true,
    );
  });

  it('targets the id in the payload and leaves sibling roles alone', async () => {
    const kept = await createRole('Shift Lead A', ['reports:view']);
    const target = await createRole('Shift Lead B');
    // The mock mints ids as `role-${Date.now()}`; two creates in the same
    // millisecond would collide and the update would rename the wrong row. invoke()
    // delays 50ms per call so these cannot collide, and the assertion makes that
    // dependency visible instead of trusting it silently.
    expect(target.id).not.toBe(kept.id);

    const updated = await invoke<MockRoleResult>('update_role_scoped', {
      sessionToken: 'mock-token',
      args: { id: target.id, name: 'Shift Lead B renamed', permissions: [] },
    });
    expect(updated.id).toBe(target.id);
    expect(updated.name).toBe('Shift Lead B renamed');

    const rows = (await roleRows()) as unknown as Array<{ id: string; name: string }>;
    expect(rows.find((r) => r.id === kept.id)?.name).toBe('Shift Lead A');
    expect(rows.find((r) => r.id === target.id)?.name).toBe('Shift Lead B renamed');
  });
});

