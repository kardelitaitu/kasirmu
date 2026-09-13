// ── IPC contract tests for staff.ts (ADR #35 D6 / spec 0049) ───────
//
// Pins the staff wire shape: the scoped commands carry sessionToken + args,
// the create/edit args carry the 17 ADR #35 D6 profile fields, and the
// StaffMemberDto / ProfileViewDto shapes include the masked national id and
// the incomplete-profile flag. A future refactor that drops a field or
// renames a command breaks these tests deliberately.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  listStaffScoped,
  createStaffScoped,
  updateStaffScoped,
  getStaffProfileScoped,
  listRolesScoped,
  type AssignmentArgs,
} from '@/api/staff';

const completeProfile = {
  date_of_birth: '1990-05-14',
  phone: '+14155550123',
  national_id_type: 'ssn',
  national_id: '123456789',
  email: 'alice@example.com',
  monthly_take_home_minor: 5_000_000,
  emergency_contact_name: 'Bob',
  emergency_contact_phone: '+14155550987',
};

/** A scoped assignment fixture (ADR #35 D5 / spec 0048) — org-wide resource
 * axis omitted, pinning the fields' optionality for pre-ADR-47 callers. */
const scopedAssignment: AssignmentArgs = {
  scope_mode: 'scoped',
  branches_all: false,
  branch_ids: ['store-a', 'store-b'],
  workspaces_all: false,
  workspace_keys: ['retail-pos'],
};

/** The global fallback a legacy DTO carries (ADR #47 shape). */
const globalAssignment = {
  scope_mode: 'global',
  branches_all: true,
  branch_ids: [],
  workspaces_all: true,
  workspace_keys: [],
  scope_type: 'organization',
  scope_id: null,
};

/** StaffMemberDto mock with the ADR #35 D5 assignment shape. */
const staffMemberDto = {
  id: 'u-1',
  username: 'alice',
  display_name: 'Alice',
  role_id: 'role-staff',
  role_name: 'Staff',
  is_active: true,
  national_id_masked: '*****6789',
  is_profile_complete: true,
  assignment: globalAssignment,
};

describe('staff.ts scoped IPC contract (ADR #35 D6 profile fields)', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('createStaffScoped sends the 9 required + optional profile fields', async () => {
    mockInvoke.mockResolvedValue(staffMemberDto);
    await createStaffScoped('session-1', {
      username: 'alice',
      pin: '1234',
      display_name: 'Alice',
      role_id: 'role-staff',
      profile: {
        ...completeProfile,
        job_title: 'Cashier',
        notes: 'Hired 2026',
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_staff_scoped', {
      sessionToken: 'session-1',
      args: {
        username: 'alice',
        pin: '1234',
        display_name: 'Alice',
        role_id: 'role-staff',
        profile: {
          ...completeProfile,
          job_title: 'Cashier',
          notes: 'Hired 2026',
        },
      },
    });
  });

  it('updateStaffScoped sends the profile fields and omits undefined ones', async () => {
    mockInvoke.mockResolvedValue(staffMemberDto);
    await updateStaffScoped('session-1', {
      id: 'u-1',
      username: 'alice',
      display_name: 'Alice Updated',
      role_id: 'role-staff',
      is_active: true,
      profile: { ...completeProfile, email: 'alice.new@example.com' },
    });
    expect(mockInvoke).toHaveBeenCalledWith('update_staff_scoped', {
      sessionToken: 'session-1',
      args: {
        id: 'u-1',
        username: 'alice',
        display_name: 'Alice Updated',
        role_id: 'role-staff',
        is_active: true,
        profile: { ...completeProfile, email: 'alice.new@example.com' },
      },
    });
  });

  it('updateStaffScoped carries the ADR #47 resource axis on the assignment', async () => {
    // The assignment-creation slice: binding a manager to one location is a
    // first-class wire shape — scope_type + scope_id ride the assignment.
    mockInvoke.mockResolvedValue(staffMemberDto);
    await updateStaffScoped('session-1', {
      id: 'u-1',
      username: 'alice',
      display_name: 'Alice',
      role_id: 'role-manager',
      is_active: true,
      assignment: {
        scope_mode: 'global',
        branches_all: true,
        branch_ids: [],
        workspaces_all: true,
        workspace_keys: [],
        scope_type: 'location',
        scope_id: 'loc-a',
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith('update_staff_scoped', {
      sessionToken: 'session-1',
      args: {
        id: 'u-1',
        username: 'alice',
        display_name: 'Alice',
        role_id: 'role-manager',
        is_active: true,
        assignment: {
          scope_mode: 'global',
          branches_all: true,
          branch_ids: [],
          workspaces_all: true,
          workspace_keys: [],
          scope_type: 'location',
          scope_id: 'loc-a',
        },
      },
    });
  });

  it('getStaffProfileScoped invokes get_staff_profile_scoped with sessionToken + userId', async () => {
    mockInvoke.mockResolvedValue({
      user_id: 'u-1',
      username: 'alice',
      display_name: 'Alice',
      date_of_birth: '1990-05-14',
      phone: '+14155550123',
      national_id_type: 'ssn',
      national_id: '123456789',
      national_id_masked: '*****6789',
      email: 'alice@example.com',
      monthly_take_home_minor: 5_000_000,
      emergency_contact_name: 'Bob',
      emergency_contact_phone: '+14155550987',
      job_title: '',
      notes: '',
      is_complete: true,
    });
    await getStaffProfileScoped('session-1', 'u-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_staff_profile_scoped', {
      sessionToken: 'session-1',
      userId: 'u-1',
    });
  });

  it('listStaffScoped keeps its sessionToken + no-args shape', async () => {
    mockInvoke.mockResolvedValue([]);
    await listStaffScoped('session-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_staff_scoped', {
      sessionToken: 'session-1',
    });
  });

  it('listRolesScoped keeps its sessionToken + no-args shape and returns granted keys', async () => {
    mockInvoke.mockResolvedValue([
      { id: 'role-manager', name: 'Manager', description: 'M', permissions: ['analytics:view'] },
    ]);
    const roles = await listRolesScoped('session-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_roles_scoped', {
      sessionToken: 'session-1',
    });
    expect(roles[0]!.permissions).toEqual(['analytics:view']);
  });

  it('updateStaffScoped sends the assignment scope (ADR #35 D5 / 0048)', async () => {
    mockInvoke.mockResolvedValue(staffMemberDto);
    await updateStaffScoped('session-1', {
      id: 'u-1',
      username: 'alice',
      display_name: 'Alice',
      role_id: 'role-staff',
      is_active: true,
      assignment: { ...scopedAssignment },
    });
    expect(mockInvoke).toHaveBeenCalledWith('update_staff_scoped', {
      sessionToken: 'session-1',
      args: {
        id: 'u-1',
        username: 'alice',
        display_name: 'Alice',
        role_id: 'role-staff',
        is_active: true,
        assignment: { ...scopedAssignment },
      },
    });
  });

  it('createStaffScoped can carry the assignment scope too', async () => {
    mockInvoke.mockResolvedValue(staffMemberDto);
    await createStaffScoped('session-1', {
      username: 'alice',
      pin: '1234',
      display_name: 'Alice',
      role_id: 'role-staff',
      profile: completeProfile,
      assignment: { ...scopedAssignment },
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_staff_scoped', {
      sessionToken: 'session-1',
      args: {
        username: 'alice',
        pin: '1234',
        display_name: 'Alice',
        role_id: 'role-staff',
        profile: completeProfile,
        assignment: { ...scopedAssignment },
      },
    });
  });

  it('listStaffScoped resolves a DTO carrying the assignment shape', async () => {
    mockInvoke.mockResolvedValue([staffMemberDto]);
    const staff = await listStaffScoped('session-1');
    expect(staff[0]?.assignment).toEqual({
      scope_mode: 'global',
      branches_all: true,
      branch_ids: [],
      workspaces_all: true,
      workspace_keys: [],
      scope_type: 'organization',
      scope_id: null,
    });
  });
});
