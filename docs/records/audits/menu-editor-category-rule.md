# The category builder and its duplicate-name rule (round 185)

## Why this surface

Rounds 163, 165 and 184 covered the menu editor's item form, its Save gate and the bulk 86
controls. The CATEGORY builder — `+ Add`, the name field, icon and colour pickers, delete — was
still untouched, and it carries the editor's only business RULE:

```ts
const isDuplicate = categories.some(
  (c) => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== categoryModal.id,
);
if (isDuplicate) {
  addToast({ message: l10n.getString('restaurant-menu-editor-category-name-exists'), type: 'error' });
  return;
}
```

Why it matters operationally: categories are both the kitchen's filing system and the
operator's filter chip. Two "Beverage" entries would silently split one set of items across two
chips, so "86 all beverages" would miss half of them.

## What the spec pins — 4 passed

`ui/e2e/restaurant-menu-editor-category.spec.ts`, two cases on both projects:

| Case | Asserts |
|---|---|
| duplicate refused | saving `Food` (already seeded) produces the `already exists` feedback AND leaves the modal open so the form is not lost |
| new category accepted | naming `E2E Category` closes the modal and the chip appears |

**Kill-tested**: disabling the duplicate check (`if (isDuplicate)` to `if (false)`) fails both
projects. Restored, byte-identical to HEAD.

## Three selector errors, all from writing rather than reading

1. `getByRole(/save/i)` matched the EDITOR's top-level Save button, which is disabled until the
   screen is dirty — the click never landed and the test timed out. The modal has its own
   `restaurant-menu-editor-cat-save` testid; that is what the spec uses.
2. My first duplicate name was `'All'`, which is not a seeded category — the guard never fired.
   Probing showed the real set: `Food`, `Snack`, `Hot Drinks`, `Cold Drinks`, `Dessert` plus
   hardware categories. The spec now uses a name that always exists.
3. The screen renders its header **before** its data: the body read `Loading menu...` with zero
   categories moments after the header appeared. Waiting on `[data-testid=...-bulk-avail]` — the
   control that only renders with items — is what makes it deterministic.

That third one is round 177's trap a third time, and the fix generalises: **an editor that
renders its chrome before its data needs a data-shaped wait, not a chrome-shaped one.**

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed |
| Kill-test | 2 failed, both projects |
| Screen source | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |