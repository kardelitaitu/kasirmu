# The fuzzier class: guards whose fall-through loses data — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 160 - status: 0 defects found,
     1 hypothesis refuted twice, 1 regression pin added - branch: 0.0.41 - commit:
     d833beadc -->

<!- - Scope: restaurant POS reliability, per the active goal. Round 159 closed by naming a
     class rather than a file: a guard written for one case that mis-handles the next case
     reaching it, with the FALL-THROUGH branch being the one that loses data. This round
     applied that lens to the rest of the surface and reports a negative result. -->

## The class, applied

Round 159 found its defect by asking what the branch AFTER a protecting condition does. The
same question was asked of every `localStorage.removeItem` in the tree (25 production sites)
and of the two POS cart keys in particular, because those carry the operator's unsaved work.

Two candidates were worth testing, and both were refuted.

## Refutation 1: the mount-time autosave race

The restore effect is declared at `PosScreen.tsx:281` and the autosave at `:367`. The restore
reads the draft and calls `setLines`; state updates are asynchronous, so the autosave's first
pass runs with `lines` still at its initial `[]` — and its else-branch is an UNCONDITIONAL
`removeItem(ACTIVE_DRAFT_KEY)` (`:401`). If that empty pass won, the draft would be deleted on
the very mount meant to restore it: reload after an OS memory trim and the cart is gone.

It does not happen, and the mechanism is worth stating so it is not re-derived. The effects
run in declaration order within a commit, so the restore's `setLines` is applied before the
autosave re-runs; the effects that follow see the restored lines and REWRITE the draft. A
transient empty-pass delete is therefore masked by an immediate rewrite. The value on disk
after mount is correct, which is what the case asserts.

## Refutation 2: the legacy-adoption path, re-examined

Round 158 flagged `readScoped`'s legacy adoption as a suspected next target; round 159
refuted it with a probe and deleted the probe. It was re-checked here from the opposite
direction — not "does adoption misfile the value" but "can the fall-through lose it" — since
that is this round's lens. It cannot: the legacy key is never removed, so it stays readable
and re-adoptable, and the scoped value always wins the read. Both existing suites already pin
this from their own sides (`scopedStorage.test.ts`, `receiptKeysStoreScoped.test.ts`).

## The other 23 removeItem sites

Reviewed and cleared, each for a stated reason rather than by absence of a bug report:

- The other two POS cart removals are correct by design — `:341` removes the LOCKED key it
  just consumed, `:942` removes the draft after checkout (`removeItem` following a successful
  sale is the intended clear, not a loss).
- `ThemeProvider`, `LocaleContext`, `AuthContext`, `storage.ts:28` and `AppLayout` remove
  LEGACY or migrated keys after a successful read of the new spelling — adopt-then-retire, the
  same shape `readScoped` uses, and all of them read before they remove.
- `SettingsNavTree`, `useCardLayout`, `topologyExport`, `analytics-cache`, `mockTier` and
  `DevToolbar` remove keys under a user-initiated reset or a delete action, where deletion is
  the requested outcome rather than a side effect of a guard.

## The pin, and why it is not vacuous

Even where the answer is "no defect", the race is worth pinning: it is one refactor away from
becoming real — reorder the two effects, or make the autosave's dependency array stop
including `lines`, and the draft is evicted. The new case asserts both halves (the lines are on
screen AND the draft is still readable afterwards), and it was checked for discrimination
rather than assumed: disabling the restore turns it red, along with three pre-existing cases.

## Evidence

- Discrimination check: with the restore effect short-circuited, 4 cases fail including the new
  one; restored by sha256 to the byte, 81/81 pass and `git status` on the file is clean vs HEAD.
- Both refutations were reached by running code, not by reading it: the adoption probe passed
  (round 159), and the autosave race was tested through the real component rather than
  modelled.
- Gates: unaffected this round — no production file changed. Test-only change, run through
  `npx vitest run` on the integration suite: 81 passed.
- Commit: `d833beadc`, verified with `git show --name-only` -> exactly
  `PosScreen.integration.test.tsx`.
- Scratch files from rounds 157-159 (`.cmd`, `.log`, `.bak`, `_PosScreen.*`) were removed
  rather than left in the tree.

## Carried forward, and an honest note on diminishing returns

Three consecutive rounds on the POS cart have now produced two real defects and two
refutations. The cart specifically is saturated: scope isolation, boot-time migration,
park-on-collision and mount-restore are each pinned by a case that has been kill-tested.

The remaining value in this lane is no longer in that component. Two directions look
unexplored rather than merely unvisited:

1. The restaurant ORDER-TYPE surface, where round 158's own note recorded that `orderType`
   rides with the cart precisely because getting it wrong prints the wrong kitchen ticket.
   That is a correctness path with a physical consequence and it has not been audited as a
   class.
2. Whether the mount-restore pattern is right for the OTHER screens that restore unsaved
   state from localStorage — the race refuted here is structural, and a screen whose autosave
   does not depend on the restored field would actually lose the value.

> last audited 18-10-26 by docs-auditor
