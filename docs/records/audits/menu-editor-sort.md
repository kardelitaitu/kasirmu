# The sort control, and why the assertion is the ORDER (round 266)

## What was covered

`restaurant-menu-editor-sort-select` was the menu editor's last behavioural id - its siblings are a
title, an icon, and the recipe button round 258 covered. **2 passed, desktop and tablet, first run.**

Kill-tested: inverting the `name-asc` comparator in `sortMenuItems` fails the case. Restored
byte-identical.

## The fourth dropdown shape on these screens

This one is a NATIVE `<select>` with real `<option>` elements (`:1203-1215`), so `selectOption()`
addresses it directly. Worth stating explicitly, because three other shapes live on these same
screens and choosing the wrong handle cost rounds 257, 264 and 265 their attempts:

| Surface | Handle | Round |
|---|---|---|
| SettingsSelect triggers | button[aria-haspopup=listbox] | 225, 230, 265 |
| role=switch inputs | the LABEL's htmlFor | 148, 170, 179, 228, 242 |
| portal option lists | role=option inside a portal | 225, 230 |
| native selects | selectOption() | 266 |

## The assertion is the ORDER, not the value

A control that stores its value without acting on it is the failure this guards, so the spec
asserts the rendered sequence three times:

1. IT CHANGED - polls until the order differs from the unsorted one;
2. IT IS THE ORDER THE LABEL PROMISES - name-asc equals the alphabetically sorted list;
3. THE OPPOSITE IS OPPOSITE - name-desc equals the reverse of the ascending order.

Step 2 is the one that matters. A control wired to the wrong comparator still changes the list, so
step 1 alone passes - which is exactly what the kill-test demonstrates: inverting the comparator
makes the order change AND makes it wrong, and step 2 fails.

Step 3 makes the case airtight in the other direction: asserting only step 2 passes on a control
that sorts unconditionally and ignores its value.

## The comparator itself, and why it was left alone

`sortMenuItems` (`screens/menuEditorLogic.ts:113-133`) is correct - locale-aware with
`sensitivity: 'base'`, every option handled, and already unit-covered alongside the filters.
**Nothing here needed fixing; this is coverage of a control that works.**

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 1 failed |
| menuEditorLogic.ts | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Menu editor, behaviourally complete

| Surface | Round |
|---|---|
| bulk controls | 184 |
| category rule | 185 |
| filters | 186 |
| modifier groups persist | 210 |
| recipe (BOM) | 258 |
| sort | 266 |

What remains on that screen is the title and icon - static chrome. **The menu editor is closed in
the same sense the receipts screen was closed in round 265.**

## The session's state

| Screen | Behavioural coverage |
|---|---|
| CartLineItem | 100% |
| tables | 86% - remainder needs a second terminal |
| settings | 83% - remainder is chrome |
| editor | 81% - remainder is chrome |
| receipts | 80% - remainder is chrome |
| payments | 62% - remainder is field plumbing whose invariant is covered |
| CartPanel | 50% - remainder is architecture |

**Every one of the seven surfaces is now closed for behaviour, with a named reason for each
remainder.** That is the strongest state this goal's objective has reached, and it is worth
recording as such rather than reporting the percentages alone.