# Four red tests, and what each one actually proved — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 93 · status: 4 defects corrected,
     suite restored to green · branch: 0.0.41 · commit: `a4b37b0da` -->

<!- - Scope: the full `ui` vitest suite, run as a health baseline. 5 failures across 4 files.
     Each diagnosed to a cause; none was flake. Baseline before this round: 12,858 passed,
     5 failed, 3 skipped, 3 todo (12,869 total, 811 files). -->

## Why this round happened

Round 92 closed the stale-absolute-qty class and reported green on its own files. A full-suite
run then found five failures elsewhere — three of them caused by THIS campaign's own earlier
commits, and a fourth by a test that had been passing for the wrong reason. The lesson is the one
already in the record: a fix verified only against its own test file is not verified.

## The four findings

### 1. `restaurantPosCrashIsolation` — the detector broke, not the code

`<MenuItemGrid` reported at depth 0, i.e. unwrapped. The component IS wrapped: the real JSX
sits at `RestaurantMenu.tsx:759` inside the boundary opened at :758. The scanner is a line-by-line
TEXT scan (its own doc says so), and round 87's memoization commit added a comment at :642 reading
*"at the `<MenuItemGrid>` call site"*. That comment sat ABOVE the boundary, so the first match
was prose at depth 0.

**The failure was the detector's, and that is the dangerous direction** — a guard that goes red on
a correct tree trains its readers to dismiss it, so the next genuinely-unwrapped component is
ignored. Fixed by skipping block and line comments in the walk, and KILL-TESTED both ways: with
the boundary removed the case fails on depth 0 for the right reason; with it present it passes.
The file restored byte-identical (`git hash-object` == `git rev-parse :`).

### 2. `RetailPosAttributes` — a fixture grew and the index-derived scores drifted

`attrProducts = retailProducts.map((p, i) => ({ ...popularity_score: 100 - i * 10 }))`. Round 81
appended `SKU-SVC` ("Installation Fee") to `retailProducts`. Index 4 therefore carried score 60
instead of the score the last retail row used, and the two ordering assertions — which pinned the
last element to "Aqua 600ml" — failed.

Two separate wrongs were corrected:

- **The scores are now keyed on the SKU**, not the array index, so appending a fixture row cannot
  shift the ordering they encode. An index-derived value is a coordinate, not an identity.
- **The assertions pin the whole order**, not just both ends, and name the service item as the
  new floor. Round 81's own fixture update (`MockFactoriesCompile.test.tsx:323`) bumped the count
  here and missed this file — the pattern of one fixture shared by N consumers, each asserting a
  different slice of it.

A regression introduced while fixing it is recorded because it is instructive: simplifying the map
to constant `brand`/`rack_location` values broke `getByText('R-01')` with "found multiple
elements". Per-row distinctness is required BY the column-toggle case, so only the score was
moved to SKU-keyed.

### 3. `useEdcTenderPhase` — a stale expectation pinning the very value that was a bug

Expected `gatewayStatus: 'captured'`. The hook writes `'settled'` (:225-229), because
`'captured'` is not in the `payments.gateway_status` CHECK vocabulary (ADR-64 D4, migration
`20261018`) and INSERTing it failed the whole transaction — a paid sale that could not be
recorded. Round 83 corrected the writer and left this expectation behind;
`PaymentModalSaleFlow.test.tsx:2224` already read `'settled'`, which is what made the straggler
visible.

### 4. `PosScreen.integration` — a test passing for the wrong reason, exposed by the real fix

`- key triggers handler on focused line` asserted `expect(firstLine).toBeInTheDocument()` after
the keypress. That held only because the old `updateQty(id, -1)` was rejected by its own
`qty <= 0` guard: the tap silently did NOTHING and the row stayed. Rounds 89-92's
`changeQty(lineId, -1)` resolves the delta and filters a line reaching 0 — correct till
behaviour — so the row legitimately disappears and the assertion can no longer hold.

Rewritten to state the real claim: the cart panel SURVIVES (a throw would unmount it) and the line
count drops 2 → 1. A regression to the no-op form now fails, where the old form could not.

## Verification

- Full suite: **0 failed** (see the run summary pinned by this commit).
- `npm run typecheck` exit 0.
- `npm run lint` 0 errors (113 pre-existing `react-refresh` warnings, none in the four paths).

> last audited 18-10-26 by autonomous-goal-round-93
