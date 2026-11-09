# E2E admin navigation: the sidebar is the in-workspace path, and the feature gate is a second gate

**Date:** 2026-10-16
**Scope:** `ui/e2e/` navigation helpers; 13 red specs across `remaining-workflows`,
`reporting-workflows`, `retail-workflows`.
**Verdict:** two independent causes were being read as one. Both are now separated.

## Cause 1 — the sidebar was never found because its sections start collapsed

Thirteen specs navigated with `selectWorkspace(ADMIN)` followed by
`navigateTo(page, route)`. `navigateTo` writes `window.location.hash` directly, which
changes the ROUTE but establishes no WORKSPACE. `AppShell.tsx:708` gates every
non-fullscreen page on `activeWorkspace` and falls through to the picker when there is
none, so those specs asserted against `.workspace-home-wrapper` and timed out.

The earlier read of this was *"non-fullscreen admin routes are unreachable"*. That was
wrong, and the probe that produced it was wrong in a specific, repeatable way: it counted
`document.querySelectorAll('.app-nav-item')`. Measured on the desktop project:

| Path | `.app-nav-item` |
|---|---|
| picker → **Staff** tool card | 0 (fullscreen page, no sidebar by design) |
| picker → **warehouse** workspace card | 0 (**sections collapsed**) |
| … → click the "Reports" section header | 3+ |
| … → click the "Tools" section header | 5 |

The items are `<button class="app-nav-item">` nested in
`.app-sidebar-section > .app-sidebar-section-items`, and every section header starts
`aria-expanded="false"`. **A count of `.app-nav-item` before expanding a section is 0 on
every route in the app**, which is exactly the false negative that made a working
navigation path look dead. Same trap as the four earlier this session: a selector-scoped
query returns a confident zero.

### The real user path, measured

    picker → warehouse workspace card   → .app-layout, .app-sidebar-section ×8
    → click a section header            → .app-nav-item appear
    → click an item                     → content renders, workspace retained

Clicking `Dashboard` under **Reports** produced `.reporting-dashboard` with the picker at
0. Clicking `Sales Report` produced `.sales-report`. The workspace survives.

### Why the picker's tool cards cannot substitute

> **CORRECTION 2026-10-16 (round 219).** This paragraph originally claimed ALL
> ELEVEN tool cards resolve to `fullscreen: true` pages. **That was wrong for six of
> them.** The registry's own flags, read in the browser (`getPage(route).fullscreen`):
>
> | fullscreen: true (5) | fullscreen: false (6) |
> |---|---|
> | staff, analytics, dashboard, settings, topology | locations, terminals, shifts, memos, promotions, audit-log |
>
> The distinction matters and the wrong version obscured it: a tool card whose route is
> NOT fullscreen reaches the workspace gate at `AppShell.tsx:708` with no workspace, so
> it can only fall through to the picker. Measured with a proper reset between cards, all
> six DO open their own screen — Shifts -> `shift-mgmt`, Terminals -> `terminal-mgmt`,
> Promotions -> `promo-mgmt`, Audit Log -> `audit-log`, Locations ->
> `multi-store-dashboard`, Memos -> `permission-denied` (correct: it requires
> `memo:write`). So there is no product defect on this path; the earlier "falls back to
> the picker" readings were the probe failing to reset the picker between clicks.

Five of the eleven entries in `ui/src/features/workspaces/tools.tsx` resolve to
`fullscreen: true` pages (staff, analytics, dashboard, settings, topology). That is why
`WorkspaceHome.handleShortcutNav` (`WorkspaceHome.tsx:553-565`)
deliberately calls `setActiveWorkspace` **only when the destination is NOT fullscreen**,
and its comment at `:530-552` records the 2026-10-05 defect that produced the rule:
setting the workspace for a fullscreen page let the shell's workspace-rebind effect
overwrite the route, so the Staff card landed on the admin workspace's own screen.

So **there is no tool card for an in-workspace screen**, and the picker cannot be used to
reach one. The two surfaces are disjoint by construction:

* tool cards → standalone fullscreen pages, rendered before the workspace gate
* sidebar items → in-workspace screens, rendered inside `AppLayout` (`AppShell.tsx:806`)

### Complete measured sidebar map (desktop, admin, warehouse workspace)

| Section | Items |
|---|---|
| Sales | EOD Report |
| Products | Products, Bundles, Stock Adjust |
| Finance | Exchange Rates, Promotions |
| Customers | Customers, Loyalty |
| Reports | Dashboard, Sales Report, Inventory Report, Custom Report, Staff Analytics |
| Tools | Terminals, Audit Log, Security Trail, Offline Queue, Shifts |
| Settings | General |
| Dev | Design System, Tooltip Preview |

Item → destination content class, each clicked and read back:

| Item | Content |
|---|---|
| EOD Report | `.eod-report` |
| Products | `.product-lookup` |
| Bundles | `.bundle-mgmt` |
| Stock Adjust | `.inv-adjust` |
| Exchange Rates | `.exchange-rate-config` |
| Promotions | `.promo-mgmt` |
| Customers | `.customer-mgmt` |
| Loyalty | `.loyalty-mgmt` |

## Cause 2 — seven of the assertions target features the mock does not enable

With navigation fixed, 8 of 15 tests passed and 7 still failed. Those 7 are a **different
gate**, and it is working as designed.

`ui/src/dev-mock/handlers/system.ts:744`:

    'get_enabled_features': () => ({ features: ['sales', 'inventory', 'reporting', 'staff', 'settings'] }),

The failing screens require features that set does not contain:

| Spec | Route | Registered with |
|---|---|---|
| retail-workflows: Categories | `categories` | `feature: 'categories-enabled'` |
| retail-workflows: Tables | `tables` | `feature: 'table-management'` |
| retail-workflows: Gift Cards | `gift-cards` | `feature: 'gift-cards'` |
| retail-workflows: Kiosk | `kiosk` | `feature: 'self-service-kiosk'` |
| retail-workflows: Customers→Loyalty | `loyalty` | `requiredPermission: 'loyalty:view'` |
| remaining-workflows: Void Orders | `orders` | `feature: 'simple-retail'` |
| remaining-workflows: Sales Dashboard | `sales-dashboard` | `feature: 'simple-retail'` |
| reporting-workflows: Menu Engineering | `menu-engineering` | `feature: 'restaurant'` |

(`ui/src/features/sales/register.tsx:37,59` and the sibling `register.tsx` files.)

**These specs were asserting screens the configured feature set deliberately excludes.**
The gate is not a bug; the assertion was. Fixing this is a spec decision — either run
those specs under a preset that enables the feature, or drop the assertion — and it is
recorded here rather than papered over with a soft guard.

## Changes made

* `ui/e2e/helpers.ts` — added `establishWorkspace(page)` (no-op when `.app-layout` is
  already up, else clicks the warehouse card) and `navigateViaSidebar(page, section,
  item)`. The docstring carries the collapsed-section trap and the measured map.
* `ui/e2e/remaining-workflows.spec.ts`, `reporting-workflows.spec.ts`,
  `retail-workflows.spec.ts` — `selectWorkspace(ADMIN) + navigateTo(route)` replaced by
  the sidebar path. `navigateTo` references remaining: 0.

## Result

`remaining-workflows` + `reporting-workflows` + `retail-workflows`: **8 passed / 7 failed**,
from a prior baseline where the navigation itself failed. The 7 are all Cause 2.

> last audited 16-10-26 by docs-auditor
