# Every reachable screen driven: the sidebar sweep closes the last large surface

**Date:** 2026-10-16
**Scope:** all 15 sidebar destinations in the warehouse workspace.
**Result:** **0 error boundaries, 0 page errors.** No defect. This is the last large undriven
surface in the app.

## The sweep

Each destination reached through its own toolbar section and read back by content class:

| Section | Destination -> rendered content |
|---|---|
| Sales | EOD Report -> `eod-report` |
| Products | Bundles -> `bundle-mgmt`; Stock Adjust -> `inv-adjust` |
| Finance | Promotions -> `promo-mgmt` |
| Customers | Loyalty -> `loyalty-mgmt` |
| Reports | Sales Report -> `sales-report`; Inventory Report -> `inventory-report`; Custom Report -> `custom-report`; Staff Analytics -> charts |
| Tools | Terminals -> `terminal-mgmt`; Audit Log -> `audit-log`; Security Trail -> `audit-log`; Offline Queue -> `offline-queue-screen`; Shifts -> `shift-mgmt` |
| Settings | General -> settings pane |

Every one rendered, with `boundary: 0` and no `pageerror` collected during its click.

## Coverage position, after this round

Every reachable screen in the application has now been driven and measured:

* 15 sidebar destinations (this round)
* 11 admin tool cards (round 219)
* restaurant POS — desktop, tablet portrait, tablet landscape, and the real tablet shell entry
  (rounds 212, 221)
* kiosk (round 222), KDS feature gating (round 222)
* sale / refund / payment paths (round 215)

## The probe cost, recorded

This sweep took **five attempts**, and four of them produced misleading output rather than an
error:

| Attempt | What went wrong |
|---|---|
| 1 | Expanded sections by reading `aria-expanded` — but the loop ran after clicks that had already collapsed them, so 9 of 15 reported `NOT-FOUND` |
| 2 | "Expand every section first" — clicking a header TOGGLES, so already-open sections closed; `totalNavItems` fell to 2 |
| 3 | Re-expand each section on demand — headers were not found after navigation (`NO-SECTION`) |
| 4 | Same, with a corrected header selector — still `NO-SECTION` |
| 5 | **Fresh page state per item.** All 15 reached. |

The failure mode is the session's recurring one: an instrumentation error that looks like a
product result. Attempts 1-4 reported `NOT-FOUND` and `NO-SECTION` for screens that work, and
taken at face value they would have been filed as missing routes. The tell was that the same
nine always succeeded and the same six always failed — a pattern set by the loop, not by the
app.

**A sweep whose failures cluster by position rather than by subject is measuring its own loop.**

> last audited 16-10-26 by docs-auditor
