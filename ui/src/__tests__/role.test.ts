import { describe, expect, it } from 'vitest';
import { normalizeRole, roleAtLeast } from '@/utils/role';

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
