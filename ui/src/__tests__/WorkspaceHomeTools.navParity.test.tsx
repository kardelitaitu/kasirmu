// ── Tools catalogue — nav (menu) registry IA parity (todo-tools.md) ──
//
// Additive to WorkspaceHomeTools.test.tsx, which pins the page-registry
// route parity (getPage) and the agreed role/tier access matrix. This
// file pins the OTHER axis of the information architecture: every home
// Tool must ALSO be a real sidebar navigation entry, and the home gate
// must not be LOOSER than the nav item's required role. Home-stricter
// is the documented policy choice (e.g. the Settings card is admin-
// locked on the home while the route gate stays `manager`), so the
// assertion is homeLevel >= navLevel, never the reverse.
//
// `settings/topology` and `settings/sync` are deep links into the
// Settings hub, so they are matched against the `settings` nav item.

import { describe, it, expect, beforeAll } from 'vitest';
import { TOOLS } from '@/features/workspaces/tools';
import { getNavItems } from '@/platform/ui/menu-registry';
import { registerAllFeatures } from '@/features';

const ROLE_LEVEL: Record<string, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  staff: 2,
  auditor: 1,
};

// Map the registry RequiredRole vocabulary (owner | manager | management)
// onto the same numeric scale. `management` means manager-or-above, so it
// sits at the manager level.
function navRoleLevel(role: string | undefined): number | undefined {
  if (!role) return undefined;
  if (role === 'management') return 3;
  return ROLE_LEVEL[role];
}

let navByRoute: Map<string, { route: string; requiredRole?: string }>;

beforeAll(() => {
  registerAllFeatures();
  // owner passes every role gate and no feature filter is applied, so this
  // returns the full nav registry regardless of gate.
  navByRoute = new Map(
    getNavItems(undefined, 'owner').map((n) => [n.route, n]),
  );
});

describe('Tools catalogue — nav registry IA parity', () => {
  it('every tool route is reachable from the sidebar nav (no orphan cards)', () => {
    for (const tool of TOOLS) {
      const navRoute = tool.route.startsWith('settings/')
        ? 'settings'
        : tool.route;
      expect(
        navByRoute.has(navRoute),
        `tool "${tool.id}" (route "${tool.route}") has no nav entry for "${navRoute}"`,
      ).toBe(true);
    }
  });

  it('home minimumRole is never looser than the nav item requiredRole', () => {
    for (const tool of TOOLS) {
      const navRoute = tool.route.startsWith('settings/')
        ? 'settings'
        : tool.route;
      const nav = navByRoute.get(navRoute);
      expect(nav, `nav for "${tool.id}"`).toBeDefined();
      const navLevel = navRoleLevel(nav!.requiredRole);
      if (navLevel === undefined) continue; // permission-only / absent nav gate
      const homeLevel = ROLE_LEVEL[tool.access.minimumRole];
      expect(
        homeLevel,
        `homeLevel for "${tool.access.minimumRole}"`,
      ).toBeDefined();
      expect(
        homeLevel!,
        `tool "${tool.id}" home gate ${tool.access.minimumRole} looser than nav ${nav!.requiredRole}`,
      ).toBeGreaterThanOrEqual(navLevel);
    }
  });
});
