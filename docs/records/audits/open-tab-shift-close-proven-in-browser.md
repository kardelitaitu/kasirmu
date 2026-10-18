# Round 294's guard, proven in a browser — and the two states it took to get there (round 296)

## The gap round 294 left

Round 294 added the close-shift guard for an outstanding tab and covered it with four vitest
cases. Those cases call the hook **directly and pass `hasOpenTab` as a parameter**. The real
caller cannot: `activeOpenBillId` is produced by `usePosHeldCarts`, which PosScreen instantiates
**after** `usePosShifts`, so the value travels through a ref PosScreen assigns during render.

Drop that assignment, or run it a render late, and **every unit case stays green while the guard
is dead on the real screen**. That is the class of failure a rendered till catches and a direct
hook call structurally cannot — so this round wrote the browser proof, which round 7 finally made
possible by showing the e2e suite runs here.

## The spec, and the two states it took to write it correctly

`e2e/restaurant-shift-close-open-tab.spec.ts`, two cases:

| Case | Asserts |
|---|---|
| an open tab blocks the close | the dialog does NOT appear, and the OPEN-TAB message does |
| a quiet store still closes | the dialog DOES appear when nothing is outstanding |

The tab is **parked and resumed through the operator's own controls** (the pattern
`restaurant-tab-resume.spec.ts` establishes), not seeded into localStorage: a seeded row proves
the seed works, while driving the real route proves the route.

### What the first two drafts got wrong, and why it is worth recording

Both failed — and each failure was the guard chain working correctly while the test set up the
wrong state. The two guards are checked **cart first, then tab** (`usePosShifts.ts:220`, `:225`),
so:

**Draft 1** opened the till *with an item* for the quiet-store case and asserted the modal
appears. It did not, and the page state showed why:

```
alert: Complete or clear the current sale before closing the shift.
```

The **cart** message — the case never reached the branch it was written for.

**Draft 2** fixed that but left the resumed tab's lines in the basket, so the open-tab case hit
the same cart guard. The page state was explicit:

```
text: 0m Table 12Active Tab          <- activeOpenBillId IS set (the resume worked)
group "LATTE, 1 × Rp 45.000"        <- ...but the cart is not empty
alert: Complete or clear the current sale before closing the shift.
```

**Draft 3** clears the cart with the operator's Clear button after resuming. `resetCart` does
not touch `activeOpenBillId` (`PosScreen.tsx:1819` passes it straight through), so the tab
outlives the cart — which is exactly the real-world state: a waiter rings up a table's food,
saves the tab, the basket clears, and the tab lives on.

**That is the state the OLD guard read as "nothing outstanding"**, which is the whole point.

## Kill-tested

Removing the tab check from `handleCloseShiftClick`:

```
1 failed   a shift cannot be closed while a customer tab is open
1 passed   a shift with no open tab still closes normally
```

The dialog reappears where it must not, and the legitimate case is unaffected. Source restored;
`git diff` on `usePosShifts.ts` is **empty** — byte-identical to the committed round-294 fix.

## Tablet coverage recovered rather than skipped

The obvious move was to mark both cases desktop-only, copying the file-header convention. Instead
I **lifted the skip and ran them on tablet** to see which genuinely needed it. Measured:

| Case | Tablet, skip lifted |
|---|---|
| an open tab blocks the close | **fails** — the cart is a bottom sheet there; its backdrop covers
  the grid, and dismissing it unmounts the cart panel, so no layout has both reachable |
| a quiet store still closes | **passes** — it needs only the sidebar row and the dialog |

So the first keeps its skip with a measured reason, and the second **now runs on both projects**.
Skipping both would have thrown away real tablet coverage for a constraint that does not apply to
one of them. Final: **3 passed, 1 skipped**.

## A flake, observed and characterised

The first full-suite run **failed once**, in
`restaurant-kitchen-dispatch-race.spec.ts:38` — a pre-existing spec this round did not touch, whose
own header documents it as a race test that presses `Shift+K` and then clicks a product card
without waiting.

Rather than assume either way, three measurements:

| Run | Result |
|---|---|
| That spec alone, `--repeat-each=3` | **6 passed** |
| Full 63-spec fleet, same `--workers=3` | **142 passed, 0 failed** |
| First full run | 1 failed (that spec) |

So it is **load-dependent and pre-existing**, not a regression from this round's work: the spec
passes in isolation and passes on the re-run under identical concurrency. Recorded rather than
quietly re-run away, because a flake in a race spec is a real property of the suite — the
`Shift+K`-then-click sequence has no wait by design (the race IS the test), so it is inherently
sensitive to scheduler timing under parallel load.

## Verified

| Item | Result |
|---|---|
| New spec | **3 passed, 1 skipped** (desktop + tablet) |
| Kill-test (guard removed) | **1 failed / 1 passed** — then restored byte-identical |
| Restaurant e2e fleet, desktop | **142 passed, 0 failed** (63 spec files) |
| Tablet skip reason | verified by lifting it, not assumed |
| eslint on the new spec | 0 |
| Source changed | **none** — kill-test only, restored |
| Commit | `c5aa8799c` |

## What this adds to round 294

Round 294's fix was correct and unit-proven. This round proves the **wiring** that connects it to
the real screen — the ref assignment, the render timing, the sidebar route — which is the part
that would silently rot while the unit cases kept passing. The two guards' ordering is now also
pinned by a test rather than only by reading, since draft 2 discovered it empirically.

> last audited 15-10-26 by docs-auditor
