# The course chip, behind a setting that is off by default (round 205)

## What the surface is

The line's COURSE chip is the other operator-facing control on a `CartLineItem`, after round
204's status badges and note. Behind it is a real service mechanic:

```ts
export type CoursingStatus = 'hold' | 'fired';   // types/domain.ts:57
```

Items on hold wait to be fired to the kitchen — the mechanic the `restaurant.course_firing`
setting switches on. The chip opens a listbox (`cart-line-course-dropdown`) whose options are
`cart-line-course-option-none` plus one per COURSES entry, and it renders its state as the word
'Course', an emoji+label, or those with ✓ / ⏸ (`CartLineItem.tsx:247-269`).

## The error, and it was a good one

The first version of the spec did NOT enable course firing, and **all six cases failed against an
empty subtree**:

```
LINES=1  CHIPS=0  FIRING_BAR=0
```

`DEFAULT_RESTAURANT_SETTINGS.courseFiring` is `false` (`restaurantSettingsModel.ts:60`), and both
the chip and the firing bar are gated on `courseFiringEnabled !== false` (`CartPanel.tsx:961`,
`:1003`). **The feature is off by default, and that is correct** — an operator turns it on.

Before concluding that, the wiring was traced end to end because a `CHIPS=0` can also mean dead
UI: `assignCourse` flows from `usePosState.ts:198` through `PosScreen` (`:137`, `:1757`) into
`CartPanel` (`:1004`), and `CartPanel.test.tsx:337-367` already pins both gates. The code is
correct; the spec's premise was wrong.

## What the spec does now

It seeds `restaurant.course_firing` through the dev-mock's settings slice with `addInitScript`,
which also exercises the link an operator actually uses: the Settings screen's Course Firing
toggle (rounds 105, 189) is what puts the chip on the till.

**3 passed** on desktop:

| Case | Asserts |
|---|---|
| assign a course | the chip is a TOGGLE (listbox closed, then open, then closed on choose) and the chosen course lands ON the chip |
| remove a course | `None` clears it — the way back exists, so a mis-assignment is not permanent |
| listbox state | `aria-expanded` follows the chip, and exactly one option is `aria-selected` |

`None` is deliberately asserted in the first case: an operator who mis-files a dish must be able
to undo it, and a listbox with no 'clear' is a trap.

**Kill-tested**: making `assignCourse` a no-op fails 2 of 3. Restored byte-identical.

## The portrait constraint, now a fourth instance

The three cases skip on tablet with the reason in the file — the cart is a bottom sheet whose
backdrop covers the grid in portrait, and dismissing it unmounts the panel. That is now recorded
in four specs; it is a property of the layout rather than a limitation of any one test.

## Verified

| Item | Result |
|---|---|
| New spec | 3 passed, 3 skipped (portrait) |
| Kill-test | 2 of 3 fail |
| `usePosState.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,707 passed |

> last audited 14-10-26 by docs-auditor
