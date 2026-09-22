// ── Dev-mock staff + role trash ───────────────────────────────────
//
// The trash is three commands the preview would otherwise answer with null:
// scripts/verify-ipc-parity.py fails on an unanswerable UI command, and a
// browser preview that silently returns null renders the empty trash for a
// backend that has rows in it. These pin the mock against the real surface
// rather than against itself:
//   - crates/kasirmu-core/src/db/staff.rs — soft_delete_user REFUSES an active
//     account and restore_user brings the member back INACTIVE;
//   - crates/kasirmu-core/src/db/roles.rs — soft_delete_role keeps the row and
//     restore_role returns it, so the mock moves the role rather than splicing it;
//   - the DTOs in ui/src/api/staff.ts — `deleted_at` is set ONLY on a row that
//     came from the trash, and that is what the screen keys off.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock — the
// same path a browser preview takes.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import type { RoleDto, StaffMemberDto } from '@/api/staff';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const listStaff = (): Promise<StaffMemberDto[]> =>
  invoke<StaffMemberDto[]>('list_staff_scoped', { sessionToken: 'mock-token' });

const listStaffTrash = (): Promise<StaffMemberDto[]> =>
  invoke<StaffMemberDto[]>('list_staff_trash_scoped', { sessionToken: 'mock-token' });

const listRoleTrash = (): Promise<RoleDto[]> =>
  invoke<RoleDto[]>('list_role_trash_scoped', { sessionToken: 'mock-token' });

const listRoles = (): Promise<RoleDto[]> =>
  invoke<RoleDto[]>('list_roles_scoped', { sessionToken: 'mock-token' });

const deleteStaff = (id: string) =>
  invoke<null>('delete_staff_scoped', { sessionToken: 'mock-token', id });

const restoreStaff = (id: string) =>
  invoke<StaffMemberDto>('restore_staff_scoped', { sessionToken: 'mock-token', id });

describe('dev-mock staff trash', () => {
  it('refuses an ACTIVE member, as soft_delete_user does', async () => {
    // staff-1 is the owner and active. A mock that trashed them would let the
    // preview exercise a flow the backend refuses, which is the one thing a
    // dev mock must not do.
    await expect(deleteStaff('staff-1')).rejects.toThrow(/deactivate this member/i);
  });

  it('moves an inactive member out of the roster and into the trash', async () => {
    // staff-5 is seeded inactive precisely so this flow is reachable here.
    const before = await listStaff();
    expect(before.some((m) => m.id === 'staff-5')).toBe(true);

    await deleteStaff('staff-5');

    const after = await listStaff();
    expect(after.some((m) => m.id === 'staff-5')).toBe(false);
    // The live rows must not carry deleted_at: the screen uses its presence to
    // tell a trash row from a roster row, so leaking one here would file a live
    // member under the trash.
    expect(after.every((m) => m.deleted_at == null)).toBe(true);

    const trash = await listStaffTrash();
    const trashed = trash.find((m) => m.id === 'staff-5');
    expect(trashed?.deleted_at).toBeTruthy();
    // A second delete cannot restart the retention clock.
    await expect(deleteStaff('staff-5')).rejects.toThrow(/already in the trash/i);
  });

  it('restores a member INACTIVE, back onto the roster and out of the trash', async () => {
    const restored = await restoreStaff('staff-5');
    expect(restored.is_active).toBe(false);
    expect(restored.deleted_at == null).toBe(true);

    const roster = await listStaff();
    expect(roster.find((m) => m.id === 'staff-5')?.is_active).toBe(false);
    expect((await listStaffTrash()).some((m) => m.id === 'staff-5')).toBe(false);
  });

  it('refuses to restore a member who is not in the trash', async () => {
    // NotFound rather than a silent success, because "restored" and "there was
    // nothing to restore" are different answers to the operator.
    await expect(restoreStaff('staff-1')).rejects.toThrow(/not found/i);
  });
});

describe('dev-mock role trash', () => {
  it('keeps a deleted role restorable instead of dropping it', async () => {
    const authored = (await listRoles()).find((r) => r.id === 'role-night-manager');
    expect(authored).toBeTruthy();

    await invoke<null>('delete_role_scoped', { sessionToken: 'mock-token', id: 'role-night-manager' });
    expect((await listRoles()).some((r) => r.id === 'role-night-manager')).toBe(false);

    const trashed = (await listRoleTrash()).find((r) => r.id === 'role-night-manager');
    expect(trashed?.name).toBe('Night Manager');
    expect(trashed?.deleted_at).toBeTruthy();

    const restored = await invoke<RoleDto>('restore_role_scoped', { sessionToken: 'mock-token', id: 'role-night-manager' });
    expect(restored.id).toBe('role-night-manager');
    expect((await listRoles()).some((r) => r.id === 'role-night-manager')).toBe(true);
    expect((await listRoleTrash()).some((r) => r.id === 'role-night-manager')).toBe(false);
  });
});
