// ── Tools catalogue — nav (menu) registry IA parity (todo-tools.md) ──
//
// Additive to WorkspaceHomeTools.test.tsx, which pins the page-registry
// route parity (getPage) and the agreed role/tier access matrix. This
// file pins the OTHER axis of the information architecture: a home Tool
// must reach a real destination, and the home gate must not be LOOSER than
// the destination's own role gate.
//
// ADDED 2026-09-19 — the "must be a sidebar entry" form was a REACHABILITY
// proxy, not the invariant. Staff management and role authoring became
// dedicated fullscreen settings pages (`features/staff/register.tsx`
// registers `fullscreen`, so AppShell renders them without AppLayout and
// they carry no `registerNavItem` entry; the user ruling was "dedicated
// setting, drop the sidebar"). Under the old rule the `staff` card was an
// orphan by construction and the only ways out were deleting a card that
// works or muting the check. So the rule now names what it always meant: a
// card is reachable through a sidebar entry OR through a registered
// fullscreen page — either way `getPage` resolves the route the card
// navigates to. The exemption is READ OFF the registration, never a
// hand-kept list, and the graded population is floored so the fullscreen
// door cannot quietly become the only door.
//
// `settings/topology` and `settings/sync` are deep links into the
// Settings hub, so they are matched against the `settings` nav item (and
// `settings` is itself registered `fullscreen`).

import { describe, it, expect, beforeAll } from 'vitest';
import { TOOLS } from '@/features/workspaces/tools';
import { getNavItems } from '@/registries/menu-registry';
import { getPage } from '@/registries/page-registry';
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
  it('every tool route reaches a real destination (sidebar entry, or a registered fullscreen page)', () => {
    // Counted, not assumed: a rule every card can satisfy through the
    // fullscreen door grades nothing, so the sidebar population is floored
    // below rather than left to whatever the catalogue happens to contain.
    let gradedBySidebar = 0;
    for (const tool of TOOLS) {
      const navRoute = tool.route.startsWith('settings/') ? 'settings' : tool.route;
      if (navByRoute.has(navRoute)) {
        gradedBySidebar += 1;
        continue;
      }
      expect(
        getPage(tool.route)?.fullscreen === true,
        `tool "${tool.id}" (route "${tool.route}") is an orphan card: no nav entry for "${navRoute}", ` +
          'and no registered fullscreen page at the route itself',
      ).toBe(true);
    }
    expect(
      gradedBySidebar,
      'no tool reached its destination through the sidebar, so the parity rule above graded nothing',
    ).toBeGreaterThan(10);
  });

  it('home minimumRole is never looser than the nav item requiredRole', () => {
    for (const tool of TOOLS) {
      // A fullscreen destination has no nav item to be looser than: its own
      // `requiredRole` + `requiredPermission` at the route are the gate, and
      // the card's role/tier access is the home front door (tools.tsx).
      if (getPage(tool.route)?.fullscreen === true) continue;
      const navRoute = tool.route.startsWith('settings/') ? 'settings' : tool.route;
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
