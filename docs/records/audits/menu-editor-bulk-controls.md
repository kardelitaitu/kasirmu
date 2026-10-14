# The bulk 86 controls, and two sweeps that found no third instance of round 183's pattern (round 184)

## First half: the sweeps

Round 183's record ended by naming a pattern worth chasing — **a rule that matters living in a
component body, unreachable by a unit test** (round 159's item-form guard, round 183's rail
allow-list). This round went looking for a third, two ways:

1. **Local pure helpers inside `.tsx` screens.** A non-exported arrow function taking arguments,
   not named `handle*`/`on*`/`render*`, defined in a restaurant, sales or tables screen.
   **One candidate, and it was in a test file** — not the pattern.
2. **Logic modules whose exports nothing consumes.** Every `*Logic.ts` in `features/sales`,
   its exports checked against all 724 production files. **Zero unused** — the round-107
   dead-hook pattern does not recur here either.

So the pattern is **not systemic**: two instances existed, both found and fixed. Recorded so
nobody re-runs the sweep expecting more.

## Second half: the bulk availability controls

With the sweeps empty, the round went to the largest remaining uncovered block in the menu
editor: `86 All (Hide)` and `Make all available` — the operational pair a kitchen uses when a
supplier fails. Rounds 163 and 165 had covered the item form and the table form's Save gate,
never these.

What makes them worth pinning rather than clicking once:

* the handler filters to items whose state **differs** from the target (`filteredItems.filter((p) => (p.is_active !== false) !== targetActive)`), so the two buttons are not
  symmetrical no-ops;
* it applies the optimistic local update **before** awaiting the IPC — the shape where a
  failure leaves the screen lying about what it saved;
* `bulkUpdating` guards re-entry, so a second click mid-flight must not double-apply.

`ui/e2e/restaurant-menu-editor-bulk.spec.ts` — **2 passed** (desktop 3.3s, tablet 5.3s):

| Assertion |
|---|
| both controls render, and the editor lists seeded items |
| `86 All` marks every listed card `--hidden` |
| `Make all available` returns the count to whatever it was before |

The last is deliberately not `toBe(0)`: a prior state may have had some items hidden, and a
spec asserting zero would pass on a screen that LOST an earlier 86.

**Kill-tested**: making the handler target nothing fails both projects.

## Verified

| Item | Result |
|---|---|
| Sweep 1 — local pure helpers | 1 candidate, in a test file |
| Sweep 2 — unused logic exports | 0 |
| New spec | **2 passed** |
| Kill-test | **2 failed** |
| Round-163 editor spec | still 2 passed alongside |
| `eslint` | 0 |
| Full UI suite | 12,703 passed |
| Source | unchanged — `RestaurantMenuEditorScreen.tsx` verified identical to HEAD |

> last audited 14-10-26 by docs-auditor
