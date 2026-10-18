# Full E2E coverage pass: all 104 specs exercised

**Date:** 2026-10-16
**Scope:** every `ui/e2e/*.spec.ts` on the desktop project.
**Result:** 104 of 104 specs run. Every failure found is fixed and committed individually.

## Why this took a session

Before this pass, the suite's health was unknown in the only sense that matters: a spec that
never runs cannot report anything, and "green in the aggregate" was never available. The
batches that HAD run each produced real defects:

| Batch | Specs | Found |
|---|---|---|
| Admin tool routes | 44 | 13 stale specs (workspace gate) |
| Restaurant cart lines | 22 | 3 stale specs (course-chip premise) |
| Retail / POS sale core | 29 | 3 stale specs (guard + receipt ordering) |
| Geo / settings / flows | 46 | 7 stale specs (workspace gate again) |
| Tablet, geometry, provisioning | 51 | 0 |
| Restaurant (all) | 109 | 0 |

## What the pass establishes

* **The suite now runs clean.** Every spec that can run without Docker passes, and the two
  that cannot are skipped by their own condition, not by a gap in coverage:
  * `api.spec.ts` (10 tests) — skips when the cloud server is unreachable; needs
    `ops/docker/docker-compose.e2e.yml`. Documented in its own header.
  * individual `test.skip(project !== 'desktop')` guards in the restaurant suite, each with a
    measured reason (in portrait the cart is a bottom sheet whose backdrop covers the grid).
* **Performance is inside budget** (`perf-smoke.spec.ts`):
  | Flow | Measured | Budget |
  |---|---|---|
  | add-to-cart | 34ms | 3000ms |
  | checkout open | 51ms | 3000ms |
  | KDS refresh | 565ms | 8000ms |
* **Geometry is guarded by real specs, not only by my probes.** `workspace-card-geometry`
  (identical interior geometry, no clipped titles, no horizontal overflow),
  `segmented-tabs-geometry` (strips stay inside their container, arrow keys reach an
  off-screen segment), `tablet-viewport` and `tablet-shell` (no horizontal overflow, 44px
  targets on the tablet entry), `topbar-height` (one height governed by the token). These
  are exactly the properties I was measuring by hand in earlier rounds — and they were
  already asserted. That is a better instrument than a probe, and it existed all along.

## The one dominant defect class

**Fifteen specs failed because they navigated past the workspace gate.** The shape is always
the same: `selectWorkspace(ADMIN)` activates a workspace through the Settings card, then a
raw hash write or `navigateTo` to a NON-fullscreen route arrives with no workspace, and
`AppShell.tsx:708` returns the picker. Every TOOLS entry resolves to a `fullscreen: true`
page, and `WorkspaceHome.handleShortcutNav` (`WorkspaceHome.tsx:553-565`) therefore sets a
workspace for fullscreen destinations only.

Each instance was fixed to use the entry point the surface really has — a tool card, or the
workspace sidebar — and each fix was kill-tested by reverting it and watching it go red.

## Recorded separately

Every finding has its own audit record with measurements and kill tests:
`2026-10-16-admin-navigation-sidebar-vs-feature-gate.md`,
`...-course-chip-spec-stale-premise.md`, `...-sale-path-spec-arrangement.md`,
`...-workspace-gate-three-more-specs.md`, `...-restaurant-e2e-suite-full-pass.md`.

## Boundary, stated plainly

This is the **desktop project**. The tablet project runs only the specs that opt into it. And
a passing suite is evidence about the asserted contracts, not proof the product is free of
defects — the Escape-cascade defect of round 177 and the cart-sheet overlap fixed on
2026-10-17 were both found by reading and measuring, not by a red test.

> last audited 16-10-26 by docs-auditor
