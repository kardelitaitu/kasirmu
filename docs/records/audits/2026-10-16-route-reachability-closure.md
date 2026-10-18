# Route reachability: 47 pages, 42 nav items, 0 dead links, 0 orphans

**Date:** 2026-10-16
**Scope:** every `register.tsx` under `ui/src/features/`.
**Verdict:** the route graph is closed. One claim in my own earlier record was wrong and is
corrected here.

## What was checked

| Property | Result |
|---|---|
| Registered pages | 47 |
| `registerNavItem` entries | 42 |
| Tool-card routes (`workspaces/tools.tsx`) | 11 |
| **Nav items with no matching page** (a clickable dead link) | **0** |
| **Pages with no nav item, no tool card, and no other code reference** | **0** |
| Restaurant routes (kds, kds-expo, tables, kiosk) registered | all |

Both directions were scanned: a nav item naming an unregistered route would be a dead link a
user can click; a registered page nothing can reach is dead code. Neither exists.

## Correction to the round-208 record

That record claimed **all eleven** tool cards in `workspaces/tools.tsx` resolve to
`fullscreen: true` pages. **That was wrong for six of them.** The registry's own flags, read
in the browser via `getPage(route).fullscreen`:

| `fullscreen: true` (5) | `fullscreen: false` (6) |
|---|---|
| staff, analytics, dashboard, settings, topology | locations, terminals, shifts, memos, promotions, audit-log |

The distinction is load-bearing and the wrong version hid it. A tool card whose route is NOT
fullscreen reaches the workspace gate at `AppShell.tsx:708` without a workspace, so it can
only fall through to the picker. Measured with a proper reset between cards:

| Card | Rendered |
|---|---|
| Shifts | `shift-mgmt` |
| Terminals | `terminal-mgmt` |
| Promotions | `promo-mgmt` |
| Audit Log | `audit-log` |
| Locations | `multi-store-dashboard` |
| Memos | `permission-denied` — correct: the route requires `memo:write` (`memo/register.tsx:12`) |

So **there is no product defect on this path.** The six all open their own screen inside a
real workspace with the sidebar. My earlier "falls back to the picker" readings were the probe
failing to reset the picker between clicks — the same instrumentation error class recorded in
`2026-10-16-reachability-vs-position-probe-correction.md`, this time in the click-reset rather
than the geometry.

The round-208 record carries an inline correction so the wrong claim is not read as fact.

## All eleven admin tool screens render

Driven with a page-error listener attached to each:

| Reading | Result |
|---|---|
| Screens reaching their own error boundary | **0** |
| `pageerror` events across all eleven | **0** |

Confirmed the previous round's Analytics fix holds and no sibling card shares its defect.

## KDS

`selectWorkspace(KDS)` renders `.kds` with no boundary and no page error (`kdsRoot: 1,
boundary: 0`), so the restaurant route the objective names is reachable and clean.

## Lesson

Two of this round's three findings were about my own instrumentation rather than the product:
a click-reset that did not reset, and an exact-text matcher that failed on a card whose
accessible name carries its description. The product finding was a correction to a claim I had
previously written down as measured fact. **A recorded measurement is not exempt from re-checking
when a later probe disagrees with it** — and the disagreement is the signal, in whichever
direction it resolves.

> last audited 16-10-26 by docs-auditor
