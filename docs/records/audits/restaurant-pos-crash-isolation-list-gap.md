# A guard list that was short again — the portrait cart surfaces (2026-10-12)

## What was found

`restaurantPosCrashIsolation.test.ts` guards that each restaurant POS surface sits
inside a `<LocalizedErrorBoundary>`. Its own header already records this failure
mode:

> *"These two were MISSING until round 18, which is exactly how they stayed
> unwrapped … A guard whose list is short of the thing it guards reports clean for
> the gap."*

It was short again. `PosScreen` renders the portrait cart as a pair:

```tsx
{isPortraitRestaurant && (
  <>
    <RestaurantFloatingCartBar … />          {/* no boundary */}
    <RestaurantCartSheet …>                  {/* no boundary */}
      <CartPanel … />
    </RestaurantCartSheet>
  </>
)}
```

Neither was listed, so neither was wrapped — for the same reason the header warns
about, one level up: **the list is the guard**, and nothing was checking the list
against the source.

## Why this pair matters more than its size

`isPortraitRestaurant` is the **tablet** form factor, and the tablet is where a
restaurant POS actually runs. In portrait these two components are the cashier's
only route to the cart: the bar opens the sheet, and the sheet is where the sale is
edited. Unwrapped, a throw in either — a missing line field, a bad total —
unmounted the whole POS screen and took the cart with it mid-sale. That is exactly
the F9 failure the file exists to prevent.

## How it was missed, and how to avoid missing it next time

Every other entry in the list happens to be named `*Screen` or `*Modal`. A scan
filtered on those suffixes therefore reported "no gap" — **which is what the first
pass of this round concluded**, wrongly. The question that found it was different
and simpler:

> Which components does PosScreen RENDER, versus which does this list GUARD?

Asked that way, the pair shows up immediately. The check is now repeatable: extract
`<Component` from the shell, extract `element:` from the guard, diff.

## The fix

Both are wrapped, the sheet's inner `CartPanel` with its own nested boundary (so a
cart-row throw inside the sheet does not blank the sheet's chrome), and both are
added to the guard list. `resetKeys` use the line count and workspace, so a
recovered panel does not stay broken for the rest of the shift.

Kill-tested: removing the boundary drops `RestaurantFloatingCartBar` to nesting
depth 0 and fails the guard. Verified on COPIES — the live file stayed byte-identical
(the round-45 lesson, now routine).

## Scope

26 guard cases pass; 162 PosScreen/cart tests pass; lint exit 0; typecheck clean.

Worth doing after any shell change that adds a surface: the list cannot notice
itself. This is the third time this file's coverage has been the defect (round 18,
then round 20's "boundary around a child says nothing about the parent", now this),
which is the argument for the render-vs-guard diff rather than another manual pass.

> last audited 14-10-26 by docs-auditor
