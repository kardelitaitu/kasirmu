// ── Tools catalogue — access matrix + route parity (todo-tools.md) ──
//
// Data-level tests, no rendering. Pins the agreed role/tier matrix and
// verifies every tool route resolves to a registered page (no dead
// tiles) and that the home policy is never LOOSER than the route gate
// (home-stricter is the documented policy choice — e.g. the Settings
// card is admin-locked on the home while the route gate stays
// `manager` + authoritative `settings:read` until the §H scope pass).
//
// `settings/topology` and `settings/sync` are deep links into kept
// sections of the Settings hub, not standalone page routes.

import { describe, it, expect, beforeAll } from 'vitest';
import { TOOLS, TOOL_GROUP_ORDER, resolveToolLock } from '@/features/workspaces/tools';
import { getPage } from '@/registries/page-registry';
import { registerAllFeatures } from '@/features';
import { TIER_LEVEL, tierSatisfies, type TierKey } from '@/utils/tierLevel';

const ROLE_LEVEL: Record<string, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  staff: 2,
  auditor: 1,
};

beforeAll(() => {
  registerAllFeatures();
});

// ── The lock decision under a loading subscription (2026-10-08) ────
//
// MEASURED: `caps` starts null and `state` starts 'loading'
// (SubscriptionContext.tsx:50-51). The role-only path already stayed open
// during the first fetch, but the TIER path did not — `tierSatisfies(null, …)`
// is false by contract and `useAdminGate` locks on anything but `active` —
// so every pro/premium tool flashed a locked card on every cold start, the
// exact thing WorkspaceHome's "loading stays open" comment forbids. The
// route's own gate re-checks fail-closed, so the optimistic-open here is
// cosmetic only.
describe('resolveToolLock — the first entitlement fetch must not flash-lock', () => {
  const pro = TOOLS.find((t) => t.id === 'analytics')!; // minimumTier 'pro'
  const free = TOOLS.find((t) => t.id === 'settings')!; // minimumTier 'free'

  it('keeps tier-gated tools open while the first fetch is loading', () => {
    expect(
      resolveToolLock(pro, {
        roleName: 'admin',
        subscriptionState: 'loading',
        capsTier: undefined,
        adminLocked: true,
      }),
    ).toBe('none');
  });

  it('still fails closed once the fetch resolves to anything but active/grace', () => {
    expect(
      resolveToolLock(pro, {
        roleName: 'admin',
        subscriptionState: 'unavailable',
        capsTier: undefined,
        adminLocked: true,
      }),
    ).toBe('subscription');
  });

  it('grace never re-opens the admin-gated tier tools (§B)', () => {
    expect(
      resolveToolLock(pro, {
        roleName: 'admin',
        subscriptionState: 'grace',
        capsTier: 'pro',
        adminLocked: true,
      }),
    ).toBe('subscription');
  });

  it('grace keeps role-only tools working (operational continuity)', () => {
    expect(
      resolveToolLock(free, {
        roleName: 'manager',
        subscriptionState: 'grace',
        capsTier: undefined,
        adminLocked: true,
      }),
    ).toBe('none');
  });

  it('an active subscription unlocks by tier as before', () => {
    const ctx = {
      roleName: 'admin',
      subscriptionState: 'active' as const,
      capsTier: 'pro' as const,
      adminLocked: false,
    };
    expect(resolveToolLock(pro, ctx)).toBe('none');
    expect(
      resolveToolLock(TOOLS.find((t) => t.id === 'promotions')!, ctx),
    ).toBe('tier');
  });

  it('an unknown role fails closed exactly as before', () => {
    expect(
      resolveToolLock(pro, {
        roleName: 'ghost',
        subscriptionState: 'active',
        capsTier: 'pro',
        adminLocked: false,
      }),
    ).toBe('hidden');
  });
});

// ── Access matrix (the agreed role/tier table, todo-tools.md) ─────

describe('Tools catalogue — access matrix (todo-tools.md)', () => {
  it('pins the agreed minimum tiers', () => {
    const tierOf = (id: string) =>
      TOOLS.find((t) => t.id === id)!.access.minimumTier;
    expect(tierOf('analytics')).toBe('pro');
    expect(tierOf('reports')).toBe('pro');
    expect(tierOf('audit')).toBe('premium');
    expect(tierOf('memo')).toBe('pro');
    expect(tierOf('promotions')).toBe('premium');
    expect(tierOf('settings')).toBe('free');
    expect(tierOf('staff')).toBe('free');
    expect(tierOf('locations')).toBe('free');
    expect(tierOf('terminals')).toBe('free');
    expect(tierOf('shifts')).toBe('free');
    expect(tierOf('topology')).toBe('free');
  });

  it('pins the agreed minimum roles', () => {
    const roleOf = (id: string) =>
      TOOLS.find((t) => t.id === id)!.access.minimumRole;
    expect(roleOf('settings')).toBe('manager');
    expect(roleOf('topology')).toBe('manager');
    expect(roleOf('analytics')).toBe('admin');
    expect(roleOf('staff')).toBe('manager');
    expect(roleOf('locations')).toBe('manager');
    expect(roleOf('terminals')).toBe('manager');
    expect(roleOf('shifts')).toBe('manager');
    expect(roleOf('reports')).toBe('manager');
    expect(roleOf('audit')).toBe('manager');
    expect(roleOf('memo')).toBe('manager');
    expect(roleOf('promotions')).toBe('manager');
  });

  it('no card is role-locked on home grid (managers can access Settings directly)', () => {
    const roleLocked = TOOLS.filter((t) => t.access.lockBelowRole);
    expect(roleLocked).toHaveLength(0);
  });

  it('every tool belongs to a declared group and every declared group has tools', () => {
    for (const tool of TOOLS) {
      expect(TOOL_GROUP_ORDER, `tool "${tool.id}"`).toContain(tool.group);
    }
    for (const group of TOOL_GROUP_ORDER) {
      expect(
        TOOLS.some((t) => t.group === group),
        `group "${group}" has no tools`,
      ).toBe(true);
    }
  });

  it('Operations groups the agreed IA entries in order', () => {
    const operations = TOOLS.filter((t) => t.group === 'operations').map(
      (t) => t.id,
    );
    expect(operations).toEqual([
      'staff',
      'locations',
      'terminals',
      'shifts',
      'memo',
      'promotions',
    ]);
  });
});

// ── Route parity (todo-tools.md #7) ───────────────────────────────

describe('Tools catalogue — route parity (no dead tiles)', () => {
  it('every tool route resolves to a registered page', () => {
    for (const tool of TOOLS) {
      if (tool.route.startsWith('settings/')) {
        expect(
          getPage('settings'),
          `${tool.route} deep link needs the settings hub`,
        ).toBeDefined();
        continue;
      }
      expect(
        getPage(tool.route),
        `tool "${tool.id}" routes to unregistered "${tool.route}"`,
      ).toBeDefined();
    }
  });

  it('home minimumRole is never looser than the route requiredRole', () => {
    for (const tool of TOOLS) {
      const route = tool.route.startsWith('settings/')
        ? getPage('settings')
        : getPage(tool.route);
      expect(route, `route for "${tool.id}"`).toBeDefined();
      if (!route?.requiredRole) continue; // permission-only / absent route gate
      const homeLevel = ROLE_LEVEL[tool.access.minimumRole];
      const routeLevel = ROLE_LEVEL[route.requiredRole];
      expect(homeLevel, `homeLevel for "${tool.access.minimumRole}"`).toBeDefined();
      expect(routeLevel, `routeLevel for "${route.requiredRole}"`).toBeDefined();
      expect(homeLevel!, `tool "${tool.id}" vs route "${tool.route}"`).toBeGreaterThanOrEqual(
        routeLevel!,
      );
    }
  });
});

// ── Canonical tier ordering (todo-tools.md #4) ────────────────────

describe('tierLevel — canonical ordering', () => {
  it('orders free < plus < pro < premium < enterprise', () => {
    const order: TierKey[] = ['free', 'plus', 'pro', 'premium', 'enterprise'];
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const lower: TierKey = order[i]!;
        const higher: TierKey = order[j]!;
        expect(tierSatisfies(higher, lower)).toBe(true);
        expect(tierSatisfies(lower, higher)).toBe(false);
      }
    }
    expect(TIER_LEVEL.enterprise).toBeGreaterThan(TIER_LEVEL.premium);
  });

  it('fails closed on unknown or absent current tiers', () => {
    expect(tierSatisfies(null, 'plus')).toBe(false);
    expect(tierSatisfies(undefined, 'plus')).toBe(false);
    expect(tierSatisfies('', 'plus')).toBe(false);
    expect(tierSatisfies('platinum', 'plus')).toBe(false);
    // A `free` minimum trivially passes — role-only tools enforce
    // subscription validity separately.
    expect(tierSatisfies('platinum', 'free')).toBe(true);
    expect(tierSatisfies(null, 'free')).toBe(true);
  });
});
