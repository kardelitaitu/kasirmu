# The memo stack covered the drawer diagnostic, and the cause was `position: sticky` (round 248)

## The defect round 247 found, and what caused it

Round 247 measured the collision — the drawer button at y=682 under the memo stack at y=610..747 —
and left the mechanism open. This round found it, and it is structural:

```
UP[0]  .restaurant-preview-card      position: relative
UP[1]  .restaurant-preview-column    position: STICKY   <- the containing block
```

`.restaurant-preview-column` is `position: sticky; top: 0` (`RestaurantSettingsScreens.css:160-161`).
**A sticky element does not travel with its scroller**, so the drawer button inside it had no scroll
position that could lift it clear. Measured, to rule out the obvious causes:

| Attempt | Result |
|---|---|
| `window.scrollBy(0, 400)` | button stayed at y=682 |
| setting `restaurant-settings-main.scrollTop = 400` | stayed at y=682 |
| setting it to `scrollHeight` | stayed at y=682 |
| the button's own `scrollIntoView({block:'center'})` | stayed at y=682 |

The ancestor walk settled it: only **one** element in the chain was actually scrollable
(`restaurant-settings-main`, `scrollHeight` 1467 / `clientHeight` 705), and the button was not in
the part of it that moves.

## The fix, and the precedent it follows

`StaffManagementScreen.css:219-245` documents the identical shape — *"the list does NOT overflow,
so there is no scroll position that escapes"* — and fixes it by reserving the stack's height inside
the page's scrolling region. The same rule now applies here:

```css
body:has(.memo-stack) .restaurant-settings-main {
  padding-bottom: calc(var(--space-6) + 215px);
}
```

**Measured after**: the button moved from y=682 to **y=470**, and `elementFromPoint` at its centre
returned `resto-anim-btn__content` — the button's own content — instead of `memo-banner-title`.

**Kill-tested**: removing the rule fails the drawer case. Restored, 0 leftovers.

## A gate caught a mistake in the restore

The first restore of the kill-test left a **stray `}`**, and `cssCommentIntegrity.test.ts` — a
checker that parses every stylesheet — reported it as `Unexpected }` at `:1891`. The spec's own
suite did not care, because a CSS syntax error in an unparsed tail is invisible to a browser that
is lenient. **The gate is why a broken stylesheet did not ship.**

## And a second gate caught the rule's own name

`screenExtraction.test.ts` grades every class a screen's sheet defines against that screen's
markup. `body:has(.memo-stack)` names a class the receipts screen never renders, so the rule read
dead — on **both** entries that share the sheet.

`StaffManagementScreen` already carried the allowance (`:342`), so the fix follows its own
reasoning rather than inventing one: `dynamicClassPrefixes` rather than `externalClasses`, because
an `externalClasses` value must be defined **outside** the entry's own css and this rule is inside
it. Both entries now credit `memo-stack x1`.

## The diagnostics themselves

| Control | What it pins |
|---|---|
| the cash drawer | a kick **reports itself**, and the button returns — three outcomes (`opened`, `sent-unconfirmed`, threw), the middle being the honest one for a dumb device |
| the kitchen chit | its own pre-flight ladder, reporting a **code** — same contract round 222 pinned |

The kitchen chit needed a reachability note: `restaurant-kitchen-test-chit-btn` is gated on
`hasKdsFeature && kitchenConnection !== 'disabled'` and the seed has the printer **disabled**; the
reachable twin shares `handleTestKitchenChit` and is ungated.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| Receipts specs together | 12 passed |
| `eslint` / `tsc` | 0 / 0 |
| Full UI suite | **12,716 passed — 0 failed** |

## The class this belongs to

Three screens have now hit the memo stack at a pinned edge — the workspace picker, the staff roles
list, and the receipts preview column — and each was found differently. **The stack is a fixed
overlay in a shell that does not reserve room for it**, so every screen with content at the bottom
of its scroll region is a candidate. The rule is now: if a control's centre hit-tests to
`memo-banner-title`, the screen owes a clearance rule.

> last audited 15-10-26 by docs-auditor
