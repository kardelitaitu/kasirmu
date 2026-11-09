# Two gates that disagreed about what "fireable" means — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 106 · status: 1 latent
     inconsistency fixed; 2 candidate areas examined and found CLEAN ·
     branch: 0.0.41 · commit: `e0cca2789` -->

<!- - Scope: continuing round 105's "loud but false" class into course firing and the KDS
     offline surface. Tree verified green at 813/813 (12,897 passed) going in. -->

## The inconsistency

`CourseSelectorBar` gates its two controls differently:

```ts
// per-course (:24-26)
l.courseId === course.id && l.coursingStatus === 'hold'
// Fire All (:40-41)
l.coursingStatus === 'hold'
```

`fireCourse` requires BOTH, so a hold with **no course** is fireable by nothing — yet it
raised the Fire All control. **Measured:** constructing that state renders
`data-testid="fire-all-courses"` while the per-course row is empty.

**It is unreachable through the UI today**, and that is why this is not a live bug:
`assignCourse` is the only writer of `'hold'` (usePosState.ts:237) and always sets a real
`courseId`, while clearing drops `coursingStatus` — an invariant its own doc spells out
("a status left at 'hold' on a line with no course keeps the 'Fire All' button alive and
inflates its count") and `courseFiring.test.ts:132` pins.

So the fix is not urgent. It is still correct: two gates disagreeing about a shared
concept is exactly the shape this feature has already paid for once, and the two now read
from **one definition** (`fireableCount`) so they agree by construction rather than by
coincidence.

## Two areas examined and found clean

Recorded because a clean result is information, and because both were checked rather than
assumed:

- **The KDS offline banners.** `kds-offline-queued` interpolates the real
  `pendingQueueLength` and renders a Retry button beside it; `storageUnavailable` is set
  at **all four** `writeLS` failure sites (`useKdsOffline.ts:314, 328, 345, 360`) so
  `kds-offline-storage-unavailable` is not a dead banner. Both promises are kept.
- **The `coursingStatus` invariant.** 30 test references, including the clearing drops-both
  case and "unassigned items have undefined courseId and coursingStatus". The single writer
  and the component agree.

## Verification

- **Full suite: 813/813 files, 12,898 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix (`expected <button …fire-all-courses> to be null`) and passes
  after; **kill test** restores the broad gate and fails it; file restored byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> When two controls decide the same question, they must read the same predicate. Here one
> asked "is it on hold?" and the other "is it on hold AND assigned?", so the broader control
> offered an action the narrower one could never perform. The state being unreachable today
> is what made it latent rather than live — and an invariant that holds only because another
> function happens to be correct is worth making explicit at the point that depends on it.

> last audited 18-10-26 by autonomous-goal-round-106
