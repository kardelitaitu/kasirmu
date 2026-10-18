# Restaurant POS: all 64 E2E specs exercised in one session

**Date:** 2026-10-16
**Scope:** every `ui/e2e/restaurant*.spec.ts`.
**Result:** 64 specs / 109 test cases run against the desktop project. **Zero failures.**
The single defect class found is recorded separately and fixed
(`2026-10-16-course-chip-spec-stale-premise.md`).

## Why this pass was worth running

Before it, ~40 of the 64 restaurant specs had never been executed in this session, and the
two batches that WERE run had produced a real defect each time — 13 stale specs in the
admin-navigation batch, 3 in the cart-course batch. A suite that is never run is not
evidence of health, and "no failures" is only informative once the run actually happened.
Both of those earlier batches were green in the aggregate and red underneath.

## Batches, in the order they ran

| Batch | Specs | Cases | Result |
|---|---|---|---|
| Cart lines: course, modifiers, badges, capabilities, portrait | 9 | 22 | 19 pass / **3 fail** -> fixed |
| Order lifecycle, payment modal, tables live, back controls, exit, cart panel | 6 | 17 | 17 pass |
| Menu editor: recipe, sort, filters, bulk, category, memo clearance | 8 | 17 | 17 pass |
| Tables: merge, move, release, reserve, seating, empty states, print bill | 9 | 19 | 19 pass |
| Receipts, payments, settings — including every load-failure path | 12 | 25 | 25 pass |
| Lifecycle & races: tabs, conflicts, dispatch race, shortcuts, F4 latch | 11 | 23 | 23 pass |
| Rails, EDC, QRIS, sidebar entries, tables form/toolbar, menu editor | 11 | 26 | 26 pass |

The one failure set is the course-chip spec, diagnosed in its own record: the till
pre-courses every line by inference, and the spec asserted an unassigned opening state the
product never produces. Fixed by re-anchoring the cases to the real state machine, with
two kill tests proving the rewritten cases still discriminate.

## What the pass establishes

* **Failure paths are covered, not just happy paths.** Every "load failure" spec was run —
  `restaurant-receipts-load-failure`, `restaurant-payments-load-failure`,
  `restaurant-settings-load-failure` — and each asserts both that the failure is reported
  and that Retry clears it once the read succeeds. `restaurant-payments-load-failure`
  states the point directly: *"a failed gateway read is reported instead of looking clean."*
* **Reliability under interruption is pinned**: `restaurant-kitchen-dispatch-race` (a line
  added while the kitchen send is in flight survives), `restaurant-tab-conflict` and
  `restaurant-tables-tab-conflict` (another terminal's lease warns before takeover),
  `restaurant-shift-close-open-tab` (a shift cannot close while a customer tab is open).
* **Destructive actions are gated**: releasing an occupied table requires a confirmation
  that names the tab; an occupied table cannot be deleted mid-service; Save stays disabled
  until a name is typed on both the item and the table forms.

## Boundary honestly stated

These runs are **desktop-project only**. Most restaurant specs carry an explicit
`test.skip(testInfo.project.name !== 'desktop')` with a measured reason (in portrait the
cart is a bottom sheet whose backdrop covers the grid). The tablet project is therefore
not covered by this pass, and that gap is the specs' own design, not an assumption here.
Screen-level layout at 1024x1366 was verified separately by live probe (zero sub-44px
targets, zero overflow, zero offscreen controls).

> last audited 16-10-26 by docs-auditor
