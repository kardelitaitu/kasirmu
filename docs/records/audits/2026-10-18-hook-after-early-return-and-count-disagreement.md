# A hook registered after eight early returns, and a count its two readers disagreed about

Date: 2026-10-18 (round 134). Commits: `101404934` — *fix(sales): register the
restaurant add-product hook above the early returns*; `66ccc3e74` — *fix(offline): floor
the pending count so the badge and Sync All agree*.

## Finding 1 — `handleRestaurantAddProduct` was never registered on a sub-view

`npm run lint` reported one error the previous rounds had not:

```
ui/src/features/sales/PosScreen.tsx
  2161:38  error  React Hook "useCallback" is called conditionally.
           React Hooks must be called in the exact same order in every component render.
```

It arrived with commit `4b7d5cf4c` (another lane, committed not in-flight).
`handleRestaurantAddProduct` sat at `:2161`, i.e. AFTER every sub-screen early return in
the component — MEASURED, eight of them: `showTables` (`:1899`), Sales History, Stock
Inquiry, Receipts, Payments, Settings, plus three more below. React requires every hook
to run in the same order on every render, so on any sub-view this one never registered,
and `RestaurantMenu`'s `onAddProduct` (`:2224`) resolved to `undefined` there.

The hook's only dependency is `handleAddProduct`, destructured from `usePosCartActions`
at `:573` — long before any early return — so moving it above them is behaviour-
preserving on the sale view and fixes the sub-view path. Moved to `:1914`; lint and
typecheck both clean afterwards.

Worth stating plainly: this defect was found by the LINTER, not by me. Six rounds of
reading this file produced nothing; one `npm run lint` produced a hard error. The full
suite had been green the whole time, and `PosScreenCoreFlow`'s 43 cases never covered
adding a restaurant product from a sub-view.

## Finding 2 — one untrusted count, two readers, opposite conclusions

`OfflineQueueScreen` reads `pending_offline_count_scoped`, which DECLARES a number and
nothing enforces at the IPC boundary — the same gap `asArray` covers for the list beside
it. The count reached `setPendingCount` raw at both write sites (`:196`, `:251`), and
the two render sites then disagreed:

```
badge    `pendingCount > 0`     -> hidden for 'three' and for -5
button   `pendingCount === 0`   -> ENABLED for both, since neither equals 0
```

MEASURED with a queue item on screen and the count answering `'three'`: the row
rendered (`deleteVisible=true`), no pending badge appeared (`badge=null`), and Sync All
stayed clickable (`syncDisabled=false`). So the one affordance telling an operator that
work is queued vanished, while the action that would clear it stayed armed.

Fixed with an `asCount` helper beside the component (`asArray`'s sibling), flooring at 0
so both readers share one footing. After the fix, both hostile values give
`syncDisabled=true` and no badge — the two agree.

## Verification

* RED first for Finding 2: with `'three'`, `-5` and `NaN`, `syncDisabled=false` while
  the badge was absent.
* KILL: reverting `asCount` at both sites makes all three new cases fail with
  `expected false to be true`. Restored and verified byte-identical.
* Finding 1: `eslint src/features/sales/PosScreen.tsx` clean after the move (it errored
  before), `npm run typecheck` clean, and `npm run lint` overall back to
  `114 problems (0 errors, 114 warnings)` from `115 (1 error, ...)`.
* Affected suites: `PosScreenCoreFlow`, `PosScreen.integration`, `PosScreen`,
  `RestaurantMenu`, `OfflineQueueScreen` — `232 passed / 1 skipped` (233).
* Full suite: `811 passed | 2 failed (813)` files, `12911 passed | 2 failed` tests —
  the same two `nativeDialogCompliance` / `noiseDitherCompliance` failures from commit
  `4347b36d2`. This round adds three tests.

## The method note that matters

Rounds 131-133 were all comment-citation work, and all three found the same class: a
document that read as verified. This round changed the instrument — from reading to
running the linter — and found a hard error plus a real UI inconsistency in the first
hour.

Two things follow. First, `npm run lint` reports ONE error today and it was sitting
there through six rounds of audit; the gates are cheap and I had been reading instead
of running them. Second, both findings are in code I had already READ in previous
rounds (`PosScreen.tsx` in 126, 130, 131, 133; `OfflineQueueScreen.tsx` this round) and
read without noticing. Reading finds claims; running finds behaviour.

> last audited 18-10-26 by docs-auditor
