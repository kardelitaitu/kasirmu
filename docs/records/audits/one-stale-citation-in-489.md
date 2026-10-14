# One stale test citation in the whole tree, and the nineteen that are deliberate (round 176)

## Why this round

Round 175's lesson was that a sweep's own regex produced 14 phantom defects. The productive
follow-up is not another sweep — it is running the CORRECTED check where round 175 only ran
it inside two features. So: every `.test.tsx` / `.spec.ts` citation in `ui/src`, against an
index of every test file on disk.

## The result

**489 citations checked. Exactly one was genuinely stale.**

`ui/src/features/settings/__tests__/LicenseSettings.test.tsx:902` read:

```ts
// (setShellKind), the way useAuthConnection.test.tsx and
// stepAccountCopy.test.tsx already do.
```

Present tense — *"already do"* — naming a file deleted with the setup wizard (`badd31d2e`,
which removed `SetupWizard.tsx`, its CSS, `SetupWizard.test.tsx`, `stepAccountCopy.test.tsx` and
five other files). The surviving name was kept and the dead one removed, because
`useAuthConnection.test.tsx` is the one test that both uses `setShellKind` AND is itself a
connection test — which is the likeness the sentence is drawing.

## The nineteen that are NOT defects, and how they differ

The check surfaced 20 hits; reading each one's context separated them:

| Cited name | Occurrences | Verdict |
|---|---|---|
| `NodeTopologyEditor.test.tsx` | 12 | **deliberate** — `20da3835c` SPLIT that suite into the twelve files that cite it |
| `useCartWidth.test.tsx`, `useLockedCartPersistence.test.tsx` | 3 | **deliberate** — cited as *"which drives the DEAD `posScreenHooks.ts` copy"*, a historical record |
| `setupWizardLandscape.test.ts` | 2 | **deliberate** — the walker names retired sheets it exists to keep buried |
| `UpdateBanner.test.tsx` | 1 | **deliberate** — round 152's own note: *"The twin is NOW GONE"* |
| `WeightScaleWidget.test.tsx` | 1 | **deliberate** — *"Same defect as WeightScaleWidget.test.tsx, fixed in 65971d0f"* |
| `stepAccountCopy.test.tsx` | 1 | **STALE**, fixed |

The distinction is **tense and framing**: a citation saying *"was pinned only by X"* or *"the
copy X drove is dead"* is a record of history, and removing it would delete knowledge. A
citation saying *"the way X already does"* is a claim about the present, and X must exist.

## The scanner's limit, stated rather than papered over

After the fix the scanner still reports the same name — inside MY OWN explanatory comment,
which deliberately names the deleted file to say what happened. **A substring scanner cannot
tell a citation from a mention**, and both this round and round 175 show that trying to make
it tell has a poor ratio: round 152 built a guard for it and discarded it for exactly this
reason. Recorded as the boundary rather than fixed.

## Also caught

My first edit indented the replacement comment 2 spaces too far, then 4, then 6 — visible only
by reading `git diff` each time. A comment block's indentation is not asserted by any linter
here, which is why the diff was the instrument.

## Verified

| Item | Result |
|---|---|
| Citations checked | **489** across `ui/src` |
| Genuinely stale | **1**, fixed |
| Deliberate historical citations | **19**, left intact |
| `LicenseSettings.test.tsx` | **57 passed** |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,693 passed |