/**
 * Tests for `page-registry` — page registration and the access-gate logic.
 *
 * The gate is the authority for which pages/nav items a user sees: a
 * registration with `requiredPermission` is authoritative when the session
 * carries granted keys (wildcard-aware, mirroring the backend
 * `has_permission`); without permission data it falls back to
 * `requiredRole`. The role hierarchy is owner > admin > manager — each
 * satisfies its own requirement and everything below it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearPages,
  getAllPages,
  getEnabledPages,
  getPage,
  hasGrantedPermission,
  isPageAccessible,
  passesGate,
  registerPage,
} from '@/registries/page-registry';

const page = (route: string, extra: Partial<Parameters<typeof registerPage>[0]> = {}) => ({
  route,
  component: () => null,
  label: route,
  ...extra,
});

describe('registerPage / getPage / clearPages', () => {
  beforeEach(() => clearPages());

  it('registers and retrieves a page', () => {
    registerPage(page('sales'));
    expect(getPage('sales')).toBeTruthy();
    expect(getPage('sales')!.label).toBe('sales');
    expect(getPage('missing')).toBeUndefined();
  });

  it('overwrites a duplicate route with the last registration', () => {
    registerPage(page('sales', { label: 'first' }));
    registerPage(page('sales', { label: 'second' }));
    expect(getAllPages()).toHaveLength(1);
    expect(getPage('sales')!.label).toBe('second');
  });

  it('getAllPages returns pages in registration order', () => {
    registerPage(page('a'));
    registerPage(page('b'));
    registerPage(page('c'));
    expect(getAllPages().map((p) => p.route)).toEqual(['a', 'b', 'c']);
  });

  it('clearPages empties the registry', () => {
    registerPage(page('a'));
    clearPages();
    expect(getAllPages()).toHaveLength(0);
  });
});

/* ── passesGate: no gates ────────────────────────────────────────── */

describe('passesGate — no gates', () => {
  it('passes when neither role nor permission is required', () => {
    expect(passesGate(undefined, undefined, undefined, undefined)).toBe(true);
    expect(passesGate(undefined, undefined, 'staff', [])).toBe(true);
  });
});

/* ── passesGate: role hierarchy ──────────────────────────────────── */

describe('passesGate — role hierarchy (owner > admin > manager)', () => {
  it('owner satisfies owner, management, and manager requirements', () => {
    expect(passesGate('owner', undefined, 'owner', undefined)).toBe(true);
    expect(passesGate('management', undefined, 'owner', undefined)).toBe(true);
    expect(passesGate('manager', undefined, 'owner', undefined)).toBe(true);
  });

  it('admin satisfies management and manager, but NOT owner', () => {
    expect(passesGate('manager', undefined, 'admin', undefined)).toBe(true);
    expect(passesGate('management', undefined, 'admin', undefined)).toBe(true);
    expect(passesGate('owner', undefined, 'admin', undefined)).toBe(false);
  });

  it('manager satisfies manager and management, but NOT owner', () => {
    expect(passesGate('manager', undefined, 'manager', undefined)).toBe(true);
    expect(passesGate('management', undefined, 'manager', undefined)).toBe(true);
    expect(passesGate('owner', undefined, 'manager', undefined)).toBe(false);
  });

  it('staff satisfies nothing above its level', () => {
    expect(passesGate('manager', undefined, 'staff', undefined)).toBe(false);
    expect(passesGate('management', undefined, 'staff', undefined)).toBe(false);
    expect(passesGate('owner', undefined, 'staff', undefined)).toBe(false);
  });

  it('supports the role- prefixed aliases', () => {
    expect(passesGate('owner', undefined, 'role-owner', undefined)).toBe(true);
    expect(passesGate('manager', undefined, 'role-admin', undefined)).toBe(true);
    expect(passesGate('owner', undefined, 'role-admin', undefined)).toBe(false);
  });

  it('rejects an undefined user role when a role is required', () => {
    expect(passesGate('manager', undefined, undefined, undefined)).toBe(false);
    expect(passesGate('owner', undefined, undefined, undefined)).toBe(false);
  });

  it('is case-insensitive on the user role', () => {
    expect(passesGate('manager', undefined, 'OWNER', undefined)).toBe(true);
  });
});

/* ── passesGate: permission precedence ───────────────────────────── */

describe('passesGate — permission precedence', () => {
  it('permission is authoritative when granted keys are provided', () => {
    // Owner role but the granted keys do NOT include analytics:view.
    expect(passesGate('owner', 'analytics:view', 'owner', ['sales:view'])).toBe(false);
    expect(passesGate('owner', 'analytics:view', 'owner', ['analytics:view'])).toBe(true);
  });

  it('falls back to the role requirement when permission data is absent', () => {
    // No granted keys → role gate decides.
    expect(passesGate('owner', 'analytics:view', 'manager', undefined)).toBe(false);
    expect(passesGate('owner', 'analytics:view', 'owner', undefined)).toBe(true);
  });

  it('with no role fallback, a permission-gated page passes when keys are absent', () => {
    expect(passesGate(undefined, 'analytics:view', 'staff', undefined)).toBe(true);
  });

  it('permission requirement wins even over the global wildcard mismatch', () => {
    // Wildcard only covers its own domain.
    expect(passesGate('owner', 'analytics:view', 'owner', ['sales:*'])).toBe(false);
  });
});

/* ── hasGrantedPermission ────────────────────────────────────────── */

describe('hasGrantedPermission', () => {
  it('matches an exact key', () => {
    expect(hasGrantedPermission(['analytics:view'], 'analytics:view')).toBe(true);
  });

  it('matches the global wildcard (Owner preset)', () => {
    expect(hasGrantedPermission(['*'], 'analytics:view')).toBe(true);
    expect(hasGrantedPermission(['*'], 'anything:else')).toBe(true);
  });

  it('matches a domain wildcard', () => {
    expect(hasGrantedPermission(['analytics:*'], 'analytics:view')).toBe(true);
    expect(hasGrantedPermission(['analytics:*'], 'analytics:export')).toBe(true);
  });

  it('does NOT match a different domain wildcard', () => {
    expect(hasGrantedPermission(['sales:*'], 'analytics:view')).toBe(false);
  });

  it('handles keys without a domain', () => {
    expect(hasGrantedPermission(['sales'], 'sales')).toBe(true);
    expect(hasGrantedPermission(['sales:*'], 'sales')).toBe(true);
  });

  it('returns false for undefined or empty grants', () => {
    expect(hasGrantedPermission(undefined, 'analytics:view')).toBe(false);
    expect(hasGrantedPermission([], 'analytics:view')).toBe(false);
  });
});

/* ── isPageAccessible / getEnabledPages ──────────────────────────── */

describe('isPageAccessible', () => {
  it('passes when the registration is missing', () => {
    expect(isPageAccessible(undefined, 'staff')).toBe(true);
  });

  it('delegates to the gate', () => {
    const gated = page('analytics', { requiredRole: 'owner' });
    expect(isPageAccessible(gated, 'owner')).toBe(true);
    expect(isPageAccessible(gated, 'manager')).toBe(false);
  });
});

describe('getEnabledPages', () => {
  beforeEach(() => clearPages());

  it('filters by feature set', () => {
    registerPage(page('a', { feature: 'pro' }));
    registerPage(page('b', { feature: 'base' }));
    registerPage(page('c')); // no feature gate
    const enabled = getEnabledPages(new Set(['base']));
    expect(enabled.map((p) => p.route)).toEqual(['b', 'c']);
  });

  it('returns all pages when enabledFeatures is omitted', () => {
    registerPage(page('a', { feature: 'pro' }));
    registerPage(page('b'));
    expect(getEnabledPages()).toHaveLength(2);
  });

  it('combines feature and role gating', () => {
    registerPage(page('a', { feature: 'pro', requiredRole: 'owner' }));
    registerPage(page('b', { feature: 'pro' }));
    const enabled = getEnabledPages(new Set(['pro']), 'manager');
    expect(enabled.map((p) => p.route)).toEqual(['b']);
  });

  it('fails closed when userRole is omitted for a role-gated page', () => {
    // The gate treats a missing userRole as denied — a role-gated page is
    // hidden rather than shown (fail-closed is the safe default; the old
    // doc comment claiming gating is "skipped" was wrong).
    registerPage(page('a', { requiredRole: 'owner' }));
    registerPage(page('b')); // ungated
    expect(getEnabledPages(undefined).map((p) => p.route)).toEqual(['b']);
  });
});
