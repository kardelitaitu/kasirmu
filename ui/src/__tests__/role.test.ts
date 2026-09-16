import { describe, expect, it } from 'vitest';
import { normalizeRole, roleAtLeast } from '@/utils/role';
import type { RoleFloor } from '@/utils/role';

describe('normalizeRole', () => {
  it('returns staff for null', () => {
    expect(normalizeRole(null)).toBe('staff');
  });

  it('returns staff for undefined', () => {
    expect(normalizeRole(undefined)).toBe('staff');
  });

  it('returns staff for empty string', () => {
    expect(normalizeRole('')).toBe('staff');
  });

  it('returns staff for whitespace-only', () => {
    expect(normalizeRole('   ')).toBe('staff');
  });

  it('recognises owner', () => {
    expect(normalizeRole('owner')).toBe('owner');
  });

  it('recognises admin', () => {
    expect(normalizeRole('admin')).toBe('admin');
  });

  it('recognises manager', () => {
    expect(normalizeRole('manager')).toBe('manager');
  });

  it('recognises staff', () => {
    expect(normalizeRole('staff')).toBe('staff');
  });

  it('recognises auditor', () => {
    expect(normalizeRole('auditor')).toBe('auditor');
  });

  it('recognises role-prefixed preset ids', () => {
    expect(normalizeRole('role-owner')).toBe('owner');
    expect(normalizeRole('role-admin')).toBe('admin');
    expect(normalizeRole('role-manager')).toBe('manager');
    expect(normalizeRole('role-staff')).toBe('staff');
    expect(normalizeRole('role-auditor')).toBe('auditor');
  });

  it('falls back to staff for retired cashier', () => {
    expect(normalizeRole('cashier')).toBe('staff');
    expect(normalizeRole('role-cashier')).toBe('staff');
  });

  it('falls back to staff for retired kitchen and its aliases', () => {
    expect(normalizeRole('kitchen')).toBe('staff');
    expect(normalizeRole('role-kitchen')).toBe('staff');
    expect(normalizeRole('kds')).toBe('staff');
    expect(normalizeRole('chef')).toBe('staff');
  });

  it('falls back to staff for unknown roles', () => {
    expect(normalizeRole('administrator')).toBe('staff');
    expect(normalizeRole('supervisor')).toBe('staff');
    expect(normalizeRole('waiter')).toBe('staff');
  });

  it('is case-insensitive', () => {
    expect(normalizeRole('OWNER')).toBe('owner');
    expect(normalizeRole('Admin')).toBe('admin');
    expect(normalizeRole('Manager')).toBe('manager');
    expect(normalizeRole('STAFF')).toBe('staff');
    expect(normalizeRole('Auditor')).toBe('auditor');
    expect(normalizeRole('CASHIER')).toBe('staff');
  });

  it('trims whitespace', () => {
    expect(normalizeRole('  owner  ')).toBe('owner');
    expect(normalizeRole('\tmanager\n')).toBe('manager');
  });

  it('handles mixed case with whitespace', () => {
    expect(normalizeRole('  AuDiToR  ')).toBe('auditor');
  });
});

describe('roleAtLeast', () => {
  it('clears the admin floor as owner', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
  });

  it('clears a floor it sits exactly on', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true);
  });

  it('does not clear the owner floor as admin', () => {
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });

  it('does not clear the admin floor as manager', () => {
    expect(roleAtLeast('manager', 'admin')).toBe(false);
  });

  it('does not clear the admin floor as the role-manager preset', () => {
    expect(roleAtLeast('role-manager', 'admin')).toBe(false);
  });

  it('fails closed for a missing role name', () => {
    expect(roleAtLeast(undefined, 'staff')).toBe(false);
    expect(roleAtLeast(null, 'staff')).toBe(false);
    expect(roleAtLeast('', 'staff')).toBe(false);
  });

  it('clears the auditor floor as auditor', () => {
    expect(roleAtLeast('auditor', 'auditor')).toBe(true);
  });

  it('accepts raw role-* preset ids at their own rank', () => {
    expect(roleAtLeast('role-owner', 'admin')).toBe(true);
    expect(roleAtLeast('role-admin', 'admin')).toBe(true);
    expect(roleAtLeast('role-auditor', 'auditor')).toBe(true);
    expect(roleAtLeast('role-staff', 'manager')).toBe(false);
  });

  it('normalizes nothing itself — only the table spellings resolve', () => {
    // Case-folding and trimming belong to normalizeRole; the table carries the
    // bare names and the role-* preset ids and nothing else.
    expect(roleAtLeast('OWNER', 'admin')).toBe(false);
    expect(roleAtLeast(' owner', 'admin')).toBe(false);
    expect(roleAtLeast('Role-Admin', 'admin')).toBe(false);
  });

  it('fails closed for retired and unknown roles', () => {
    expect(roleAtLeast('cashier', 'staff')).toBe(false);
    expect(roleAtLeast('role-kitchen', 'auditor')).toBe(false);
    expect(roleAtLeast('supervisor', 'auditor')).toBe(false);
  });

  it('holds staff at the staff floor and below manager', () => {
    expect(roleAtLeast('staff', 'auditor')).toBe(true);
    expect(roleAtLeast('staff', 'staff')).toBe(true);
    expect(roleAtLeast('staff', 'manager')).toBe(false);
  });
});

describe('roleAtLeast — an unknown floor fails CLOSED (3a.2 ruling)', () => {
  // Ruled 2026-09-16: an unknown floor on an admin-tool gate must DENY, not
  // allow. The gate this pins used to be written inline in `WorkspaceHome.tsx`
  // (`canAccessTool`) as `roleLevel >= (ROLE_HIERARCHY[minimumRole] ?? 0)`, so
  // an unrecognised `minimumRole` demanded 0 and EVERY role cleared it — a
  // fail-open. `roleAtLeast` demands `Number.MAX_SAFE_INTEGER` instead, and
  // the Tools gate now routes through it, so pinning the default here pins
  // that gate too.
  //
  // The unknown-floor branch is unreachable through the type today
  // (`ToolRole` is 'owner' | 'admin' | 'manager', all present in the table),
  // which is exactly why it needs a TEST rather than an inspection: it only
  // starts to matter the day the catalogue gains a floor the table lacks.

  it('denies every role when the floor is unrecognised', () => {
    // A cast, because `RoleFloor` is a closed union: an unknown floor can only
    // arrive the way it would in production — as data the type does not cover.
    // `as unknown as` on purpose: no element of the literal array overlaps
    // `RoleFloor`, so TS rightly refuses a direct cast. That refusal IS the
    // point of the test — an unknown floor is not expressible in the type.
    for (const floor of ['supervisor', 'role-supervisor', 'CASHIER', ''] as unknown as RoleFloor[]) {
      expect(roleAtLeast('owner', floor)).toBe(false);
      expect(roleAtLeast('admin', floor)).toBe(false);
      expect(roleAtLeast('manager', floor)).toBe(false);
      expect(roleAtLeast('staff', floor)).toBe(false);
    }
  });

  it('lets no custom role clear a preset floor', () => {
    // The custom-role consequence, pinned so 3a.2's real fix is measured
    // against it: a CUSTOM role holding the gate permission still cannot pass
    // a RANK gate, because it holds no rank in the table. That is the property
    // the doctrine exists to protect, and the reason 3a.2 says to replace rank
    // comparisons with permission checks. Until that replacement lands, the
    // honest behaviour is to DENY — which is what fail-closed buys, and what
    // the previous `?? 0` would have silently granted.
    for (const role of ['store-lead', 'shift-supervisor', 'franchisee']) {
      expect(roleAtLeast(role, 'auditor')).toBe(false);
      expect(roleAtLeast(role, 'manager')).toBe(false);
      expect(roleAtLeast(role, 'owner')).toBe(false);
    }
  });
});
