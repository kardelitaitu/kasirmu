# Re-deriving the coverage claims, and a key I invented (round 189)

## Applying round 188's own lesson

Round 188 found that a previous round's *"fully covered"* claim was false, and concluded that a
coverage count ending a round is itself a claim to re-derive rather than repeat. This round did
that, for every restaurant screen:

| Screen | Covered |
|---|---|
| menu editor | **16 / 21** |
| receipts | 5 / 15 |
| settings | **4 / 12** |
| tables | 2 / 17 |
| payments | **2 / 32** |

No screen is close to fully covered, and the payments screen is at 6% — which corrects a
reading a casual glance at the testid sweep could give.

> **Two figures corrected 2026-10-14 (docs-auditor).** (a) settings is **4 / 12**, not 3 — the
> covered four are `restaurant-settings-header`, `-load-error`, `-save-btn` and
> `settings-card-order-entry`, re-derived at this record's own commit `058a37df0`.
> (b) payments was **2 / 32 when this round wrote the table**, which is right for its own tip
> and not for a later one: a lane then covered the custom-rail form, so the screen stands at
> **7 / 32**. The 7 counts the five literal testids plus the two dynamically built
> `payment-card-toggle-${id}` toggles the custom-rail spec asserts
> (RestaurantPaymentsScreen.tsx:207) — a literal-only grep structurally misses those two. Recorded so the next round picks a
screen from the numbers rather than from whichever file it happened to open.

## What landed: the settings screen

Its five cards are the screen's information architecture — `order-entry`, `workflow`,
`dining-ops`, `kitchen`, `interaction` — and nothing asserted them. Round 149's history shows a
row disappearing changes what an operator can reach, and this suite reports a missing CARD
rather than a missing toggle.

`ui/e2e/restaurant-settings-cards.spec.ts` — 4 passed on both projects:

| Case | Asserts |
|---|---|
| card structure | all five render, and each carries at least one `role=switch` — a card that lost its toggles fails |
| toggle change flow | Course Firing flips (defaults off), Save arms, and the save reaches `restaurant.course_firing` |

**Kill-tested**: renaming the persisted key fails both projects. Restored, byte-identical to HEAD.

## The error this round, and why it is the same class as round 188

My first draft asserted `localStorage.getItem('pos.course_firing')` — a **mirror key I invented**
by analogy with the F6 interaction pair round 157 pinned. It does not exist: the settings screen
writes no localStorage, and the value travels to `restaurant.course_firing` through
`setSettingsScoped`.

The probe that caught it was the failure itself — `Received: null` on a save that had worked.

**This is round 188's class again: asserting a remembered shape instead of a measured one.** The
screen's real keys were one grep away, and the two-key distinction is now written into the spec's
comment so the next reader does not repeat it: `restaurant.course_firing` is the DB-side key; the
F6 `pos.*` mirror belongs to the interaction pair only.

## Verified

| Item | Result |
|---|---|
| Coverage re-derived | 5 screens, table above |
| New spec | 4 passed |
| Kill-test | 2 failed |
| Settings screen source | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

> last audited 14-10-26 by docs-auditor
