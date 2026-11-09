# Two blocked items whose blocker had expired — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 181 · status: TWO plan items marked
     blocked/still-open were ALREADY FIXED; both re-verified green and the stale notes
     corrected · branch: 0.0.41 · commit: 6eac9c295 -->

<!-- Scope: work the restaurant reliability plan; it named two parked items with one blocker. -->

## The finding

`todo-restaurant-pos-reliability.md` carried two items parked on the SAME constraint — not a
technical problem, but *"another lane's uncommitted change to that file"*:

> `RestaurantPaymentsScreen.tsx:454-455` is a **real instance still open** … blocked on
> another lane's uncommitted change to that file.

> **Still open:** `RestaurantPaymentsScreen` (10 `aria-label`s). ⚠️ That file is
> currently DIRTY with another lane's uncommitted change … this is a coordination
> constraint, not a technical one.

I checked the constraint first. **The file is clean** — `git status --porcelain` returns nothing
for that path. The lane committed. Both items had therefore been workable for some unknown
number of rounds, and the plan still said "blocked".

## Both were already fixed

| item | what the plan prescribed | what the tree holds |
|---|---|---|
| F4 gateway reads | stop `.catch(() => null)`ing them silently | `:482-489` sets `setLoadFailed(true)` in BOTH catch arms |
| 10 `aria-label`s | add them | 9 `aria-label`s + a passing a11y suite |

The F4 repair is exactly what the finding asked for, so it was not a workaround that happened
to satisfy the letter of it. And the guard that names the symptom already existed:

```
e2e/restaurant-payments-load-failure.spec.ts:41
  ✓ a failed gateway read is reported instead of looking clean
  ✓ Retry clears the failure once the gateway read succeeds
```

Ran, not read:

```
RestaurantPaymentsScreen.test.tsx            49 passed
a11y/RestaurantPaymentsScreen.a11y.test.tsx   1 passed   (50 total)
restaurant-payments-load-failure.spec.ts      2 passed
restaurant-payments-credential-boundary.spec.ts 3 passed  (5 total)
```

## The lesson, which is the opposite direction of this file's own recurring one

The plan records, six times over, its header going stale because *"a pin lands and the
summary is not re-read"* — work completed and described as open. This is the mirror: the work
was BLOCKED, the blocker cleared, and nothing re-checked. Both are the same failure — a status
field that was true when written and is never revisited.

**A blocked item needs its BLOCKER re-verified, not just its own status.** "Blocked on another
lane" has a lifecycle the blocked item does not control: it expires silently at someone else's
commit. Without a re-check, "blocked" decays into "abandoned" — and it looks identical to
"deliberately deferred", which is why nothing flags it.

The cheap fix is the one I ran: before working a parked item, `git status --porcelain -- <path>` on
the path the park names. One command, and here it re-opened two items that had been listed as
out of reach.

## Evidence

- The blocker check that started it: `git status --porcelain -- .../RestaurantPaymentsScreen.tsx` → empty.
- Both repairs read in the working tree at the lines given, not inferred from the plan text.
- 55 tests run green across four suites (50 unit/a11y + 5 E2E).
- The plan-doc guards re-run after the edit: `planStatusAccuracy.test.ts` (10) and
  `planHeaderMatchesPinnedDefects.test.ts` (1) — 11 passed. The edit does not fight the
  guards that police this file.
- Committed as `6eac9c295`, one file, 25 insertions / 6 deletions.

## Still open, and unchanged

The round-177 Escape-cascade defect remains the top reliability item. `PosScreen.tsx` is
**still dirty** (hash `ff144486f`), so it stays blocked in the real sense — the file has
uncommitted content that is not mine. That blocker must be re-checked each round by the rule
above, not assumed.

> last audited 18-10-26 by docs-auditor
