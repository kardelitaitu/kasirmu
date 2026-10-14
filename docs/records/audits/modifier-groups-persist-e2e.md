# The end-to-end proof round 210 handed off (round 211)

## What this round was

Round 210 found that the dev-mock dropped `notes` — where modifier groups live as JSON — fixed
it, pinned it with a unit test, and **deleted** the end-to-end spec because its two halves
needed one page load and the navigation between them proved fragile. This round landed that
spec, and the navigation question is what it answered.

## The navigation, measured rather than guessed

| Question | Measurement |
|---|---|
| Does the editor's back button reach the till? | yes, in one click — `RESTAURANT_CARD=27`, `WORKSPACE_HOME=0` |
| Does it always? | **no** — with an item form open the form swallows the click, so the count depends on state |

So the spec needs no navigation at all. Save closes the form; reopening the **same item in the
same page load** proves the write survived. That is the entire claim: `MOCK_PRODUCTS` is
in-memory, so what a reload would test is persistence the mock never had, not the bug that was
fixed.

## A race the probe had hidden

The first version failed on desktop and passed on tablet. The difference was ordering:

```
probe: save.click() -> waitForTimeout(1800) -> click card    PASSED
spec : save.click() -> await toBeDisabled() -> click card    FAILED
```
`handleSaveDraft` awaits `reloadData()` and **only then** calls `setDraft(null)`
(`RestaurantMenuEditorScreen.tsx:688-690`), so Save is disabled while the form is still up — and
a card click at that moment lands on the open form.

**An 1800ms sleep passing where a precise wait failed is the tell for a race, not a missing
element.** Fixed by waiting on the form's absence, which is the thing the next step needs.

## What the spec pins — 4 passed, BOTH projects

| Case | Asserts |
|---|---|
| the group survives | the group name AND its option name and price come back after a save — the group alone would pass on a half-written payload |
| the group can be removed | removal takes effect on the form AND survives a save, so the way back is not cosmetic |

**Kill-tested**: restoring round 210's defect fails **all four** — both cases on both projects.
Restored byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (desktop + tablet) |
| Kill-test | 4 failed |
| `catalog.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## The pair round 210 left open

| Layer | Pins |
|---|---|
| `devMockProductNotes.test.ts` (round 210) | the mock KEEPS the field, driven through its own `invoke` |
| `restaurant-modifier-groups-persist.spec.ts` (this round) | the operator's save reaches that storage and comes back |

A unit test alone would not have caught the ordering race, and the e2e alone would have been a
slow way to find a one-line mock gap. Both are worth having.