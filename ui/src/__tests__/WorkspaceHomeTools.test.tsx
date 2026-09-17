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
import { TOOLS, TOOL_GROUP_ORDER } from '@/features/workspaces/tools';
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
    expect(tierOf('cloud-sync')).toBe('plus');
    expect(tierOf('data-management')).toBe('plus');
    // Basic Offline Queue visibility is available to all active tiers.
    expect(tierOf('offline-queue')).toBe('free');
  });

  it('pins the agreed minimum roles', () => {
    const roleOf = (id: string) =>
      TOOLS.find((t) => t.id === id)!.access.minimumRole;
    expect(roleOf('settings')).toBe('admin');
    expect(roleOf('topology-editor')).toBe('admin');
    expect(roleOf('analytics')).toBe('admin');
    expect(roleOf('staff')).toBe('manager');
    expect(roleOf('locations')).toBe('manager');
    expect(roleOf('terminals')).toBe('manager');
    expect(roleOf('reports')).toBe('manager');
    expect(roleOf('audit')).toBe('manager');
    expect(roleOf('memo')).toBe('manager');
    expect(roleOf('promotions')).toBe('manager');
    expect(roleOf('features')).toBe('owner');
    expect(roleOf('data-management')).toBe('owner');
  });

  it('Settings is the only role-locked card (managers see it locked, not hidden)', () => {
    const roleLocked = TOOLS.filter((t) => t.access.lockBelowRole);
    expect(roleLocked.map((t) => t.id)).toEqual(['settings']);
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
      'topology-editor',
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
