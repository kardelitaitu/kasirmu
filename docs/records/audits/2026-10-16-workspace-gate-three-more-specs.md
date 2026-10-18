# Three more specs navigated past the workspace gate — the same cause, found by sweep

**Date:** 2026-10-16
**Scope:** `adr22-workspace-settings` (6 red), `new-flows` (1 red), `e2e-exchange-rates` (3 red).
**Verdict:** all ten failures were the round-208 navigation defect re-appearing in specs I had
not yet run. No production code changed.

## The shape, once more

`selectWorkspace(page, WORKSPACES.ADMIN)` activates the admin workspace through the Settings
card. A subsequent raw hash write or `navigateTo` to a **non-fullscreen** route then arrives
with no workspace, and `AppShell.tsx:708` returns the picker.

The reason is structural and documented: every TOOLS entry in `workspaces/tools.tsx` resolves
to a `fullscreen: true` page, and `WorkspaceHome.handleShortcutNav`
(`WorkspaceHome.tsx:553-565`) therefore sets a workspace for **fullscreen destinations only**
— the shell's workspace-rebind effect would otherwise overwrite the route (the 2026-10-05
Staff-card defect at `:530-552`).

## The three specs, and the entry point each actually has

| Spec | Was doing | Real entry point | Measured |
|---|---|---|---|
| `adr22-workspace-settings` | `selectWorkspace(ADMIN)` + `navigateTo('locations')` | the **Locations tool card** | card -> `multiStore 1`; hash -> `multiStore 0, picker 1` |
| `new-flows` (Audit Log) | `window.location.hash = '#/audit-log'` | the **Audit Log tool card** | needs the picker left intact, so its `beforeEach` stopped calling `selectWorkspace` |
| `e2e-exchange-rates` | `selectWorkspace(ADMIN)` + hash `#/exchange-rates` | the **workspace SIDEBAR**, Finance > Exchange Rates | its own header calls it "top-level page (finance nav section, manager+)" and it registers a nav item |

The audit-log failure had a second layer: the spec's `beforeEach` selected a workspace, which
consumes the picker the tool card lives on. Fixing the card click alone still failed on
`element(s) not found`; the setup had to stop selecting a workspace.

## One hypothesis raised and disproved before acting

`locations` is registered `feature: 'multi-store'`, and the dev-mock answers
`get_enabled_features` with only `['sales','inventory','reporting','staff','settings']`. That
looked like the `restaurant-cart-line-course` cause — a feature-gated screen the mock does not
enable. It is not: clicking the tool card renders `.multi-store-dashboard` (`multiStore 1`), so
the feature IS live and the screen works. The registration gate was a red herring; the
navigation was the whole fault.

## Kill tests

Every fix was reverted and re-run; each revert went red, then was restored byte-identically
(sha256 checked):

| Reverted to | Result |
|---|---|
| `navigateTo('locations')` in adr22 | **6 failed** — exactly the six |
| hash write in new-flows | audit-log test **fails** again |
| hash write in exchange-rates | **3 failed** — exactly the three |

## Result

`adr22-workspace-settings` + `new-flows` + `e2e-exchange-rates`: **26 passed / 0 failed**
(was 19 passed / 7 failed across the three, and 11/7 for the batch). `tsc --noEmit` clean,
`lint` 0 errors. Committed `787e0eb1c`.

## Sweep

Per the round-206 lesson, every remaining spec using `selectWorkspace(ADMIN)` was checked:
nine files, of which six target `settings` (registered `fullscreen: true`, so unaffected) and
`staff-trash` / `topbar-height` were run and pass. No further instances of this cause remain
in the specs exercised so far.

> last audited 16-10-26 by docs-auditor
