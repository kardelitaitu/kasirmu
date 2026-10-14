# The restaurant settings screen gets E2E coverage, and its toggle is styled-out (round 148)

## What was covered

Round 136 drove `RestaurantSettingsScreen` by hand — 13 toggles, correct states, and the F6
write-through working in both directions. None of it was pinned. This round converted it.

`ui/e2e/restaurant-settings-toggles.spec.ts`, three cases:

| Case | Asserts |
|---|---|
| every toggle renders | all 13 attach, report `aria-checked`, and the load-error card is ABSENT |
| Course Firing default | `aria-checked="false"` — an unset key resolves to `false` (`restaurantSettingsModel.ts`) |
| save mirrors the interaction preference | the DB key AND its `pos.interaction_*` mirror both carry the new value |

Result: **6 passed** (3 x desktop/tablet).

## Three selector facts the source handed over, each of which a record alone would have missed

1. **The testid sits on the raw `input`, which `.settings-toggle` styles out.** `toBeVisible`
   fails with `hidden` — the visible control is an `aria-hidden` span
   (`RestaurantSettingsScreen.tsx:103-116`). The right predicate is `toBeAttached`, and the
   state is an ARIA attribute, not a `checked` flag.
2. **TWO labels point at one input.** The row's text label (`:79`) and
   `.settings-toggle-switch` (`:104`) both carry `htmlFor={id}`. A `label[for=…]` selector
   is a strict-mode violation; the class disambiguates.
3. **The Settings row is permission-gated.** `effectiveIsManager` resolves to
   `hasGrantedPermission(permissions, 'settings:edit')` (`RestaurantSidebar.tsx:268-271`),
   so logging in as `staff` — whose grant is `sales:process, sales:void, reports:view` —
   renders the row **disabled** and the navigation times out. The spec logs in as `owner`.
   That gate is itself worth a case: it is the F8 fix, that a *manager* role without the
   grant must not be shown a save that the IPC boundary refuses.

## The kill-test that mattered

The F6 case first passed with its mirror REMOVED — a third non-discriminating assertion this
session, and the same reason as rounds 114-115: the assertion accepted
`db !== null || runtime !== null`, and the DB write alone satisfied it.

Tightened to `toEqual({ db: expected, runtime: expected })` and re-killed: removing
`setInteractionSoundEnabled` from the save path now fails it. The case is recorded in the
spec's own comment, naming the weak draft, so the next reader knows why it is written that
way rather than simplifying it back.

## A process note on the shared branch

The full suite finished **1 failed**, in `planHeaderMatchesPinnedDefects` — the plan header
still claims *NO open code defects* while two INERT core-rail toggles are pinned. Five files
dirty in the tree (`PaymentModal.tsx`, `StaffLoginScreen.tsx`, `coreRailToggleReach.test.ts`,
`planStatusAccuracy.test.ts`, `PaymentModalSaleFlow.test.tsx`) carry another lane's in-flight
work, and their own test file already carries the new expectation.

Verified it is not mine: `planHeaderMatchesPinnedDefects` passes in isolation, and my commit
names only my spec. Per `AGENTS.md` §7.3 a pathspec commit records the working-tree copy, so
naming it alone is what keeps another session's edits out of my history.

## Verified

| Run | Result |
|---|---|
| New spec | **6 passed** (desktop 3.2s, tablet 4.9s) |
| F6 kill-test | first draft SURVIVED; after tightening, **fails** |
| `RestaurantSettingsScreen.tsx` | identical to HEAD after the kill-test |
| `planHeaderMatchesPinnedDefects` | passes in isolation — the full-suite failure is another lane's |
| `tsc` | 0 |