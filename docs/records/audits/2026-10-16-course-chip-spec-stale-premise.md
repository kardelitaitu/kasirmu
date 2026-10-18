# The course chip spec was asserting a state the till never produces

**Date:** 2026-10-16
**Scope:** `ui/e2e/restaurant-cart-line-course.spec.ts` (3 of its 4 cases red).
**Verdict:** the assertions were stale, not the product. No production code changed.

## Symptom

Batch run of nine restaurant cart specs: 19 passed, 3 failed — all three in
`restaurant-cart-line-course.spec.ts`, all on the same first assertion:

    Locator: [data-testid="cart-line-course-chip"]
    Expected pattern: /course/i
    Received string:  "🥤 Beverage⏸"

The chip presented a course when the spec demanded the unassigned placeholder.

## Cause — a feature, read as a fault

`handleRestaurantAddProduct` (`PosScreen.tsx:2072`) runs
`inferCourseForProduct(product)` and forwards the result as the new line's meta:

    const defaultCourse = meta?.courseId ?? inferCourseForProduct(product) ?? undefined;

`inferCourseForProduct` (`types/domain.ts:74`) resolves a course from the product's
category (`resolveCourseFromCategory`, `:60`) and falls back to name keywords. Every
dev-mock catalog item is a 'Beverage' category, so **every line lands pre-coursed**.

Measured 2026-10-17 on the desktop project — the first SIX tiles, each added and read back:

| Tile | Chip on first render |
|---|---|
| Caffè Latte | `🥤 Beverage⏸` `--set --hold` |
| Cappuccino | `🥤 Beverage⏸` `--set --hold` |
| Espresso Shot | `🥤 Beverage⏸` `--set --hold` |
| Kopi Tubruk | `🥤 Beverage⏸` `--set --hold` |
| Teh Tarik | `🥤 Beverage⏸` `--set --hold` |
| Iced Coffee | `🥤 Beverage⏸` `--set --hold` |

The inference is deliberate and has exactly one caller: it is how the runner learns the
kitchen station and firing round without the cashier picking a course per dish. The spec's
premise (`'Unassigned: the chip reads the placeholder'`) was simply false, and 3 of its 4
cases were unreachable from their first line as a result.

## Fix — move the assertions to where the states actually are

The full round trip was measured first, then re-asserted against it:

| Step | Chip | Class | aria-selected |
|---|---|---|---|
| initial | `🥤 Beverage⏸` | `--set --hold` | `beverage: true` |
| listbox open | unchanged | `--set --hold` | — |
| pick Main Course | `🍽️ Main Course⏸` | `--set --hold` | — |
| pick None | `Course` | *(no `--set`)* | listbox closed |

The unassigned assertion is **kept**, moved to where it is reachable: through `None`,
which is also the only way an operator undoes a wrong inference — so it now pins the
recovery path rather than an impossible opening state.

## Kill tests — proving the rewritten cases discriminate

Both mutations were applied to PRODUCTION code and reverted byte-identically
(`git diff --stat` empty afterwards):

| Mutation | Result |
|---|---|
| `inferCourseForProduct` forced to return `null` | **3 of 4 fail** — exactly the three asserting the pre-coursed state |
| `onAssignCourse(line.id, '')` → re-assigns instead of clearing | **the "can be removed" case fails** — the one that must catch it |

Case 2 correctly survives mutation 1: it selects `None` from whatever state exists, so it
is inference-independent by construction. Neither case is vacuous.

## Result

`restaurant-cart-line-course.spec.ts`: **4 passed** (was 1 passed / 3 failed).
With its two neighbours (`restaurant-cart-line-badges`, `restaurant-course-firing`):
**10 passed / 0 failed**. `tsc --noEmit` clean; `lint` 0 errors.
Committed `57b3bc95e`.

> last audited 16-10-26 by docs-auditor
