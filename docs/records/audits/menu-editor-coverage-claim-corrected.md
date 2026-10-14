# Round 187's coverage claim was wrong, and finishing it found two real fields (round 188)

## The check that started it

Round 187's record closed with *"the editor is covered across every operator surface except
the icon and colour pickers, which are cosmetic."* This round re-ran the coverage check
rather than carrying that forward — and it was wrong:

| Claim | Actual |
|---|---|
| *"except the icon and colour pickers"* | 7 testids uncovered, three of them substantive |

```
restaurant-menu-editor-icon             cosmetic
restaurant-menu-editor-title            cosmetic
restaurant-menu-editor-sort-select      operator control
restaurant-menu-editor-draft-category   operator edit
restaurant-menu-editor-notes            operator edit
restaurant-menu-editor-add-group-btn    modifier groups
restaurant-menu-editor-manage-recipe-btn  recipe/BOM editor
```

The gap was small but real, and the cause is worth naming: the previous round counted the
testids its own spec left over and called the remainder cosmetic without opening them.

## What landed

A fourth case in `restaurant-menu-editor-filters.spec.ts` — 8 passed on both projects:

| Field | Why it matters |
|---|---|
| category select | moving an item between sections decides which filter chip finds it, so a frozen select files items wrong with nothing reported |
| notes | the description the kitchen chit prints (`restaurant-receipt-kot-note`) — dropped text is lost context for the cook |

Both read the DOM for their inputs: the options are read from the select and the target is the
first differing option. No fixture literal.

**Kill-tested**: freezing the category select's `onChange` fails the case. Restored,
byte-identical to HEAD.

## Still uncovered, deliberately

| Testid | Why deferred |
|---|---|
| `manage-recipe-btn` | opens a whole BOM editor with its own modal, IPC and save path — a slice, not a case |
| `add-group-btn` | modifier groups, same shape |
| `sort-select` | ordering; verified present, behaviour left for a later round |
| `icon`, `title` | cosmetic |

Recording them rather than closing with another *fully covered* claim is the point of this
round: **the previous closing claim was the defect.**

## Verified

| Item | Result |
|---|---|
| Spec | 8 passed (4 cases x desktop/tablet) |
| Kill-test | fails |
| Screen source | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |