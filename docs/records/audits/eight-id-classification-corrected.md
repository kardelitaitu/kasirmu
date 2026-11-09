# The 8 remaining ids, and why a tag is not a classification (round 283)

## What round 282 left

Round 282 covered the three back controls and observed that the remaining "none" entries were
"a title or an icon". This round re-derived that list and checked it **the way round 282's own
lesson demanded** — not by reading the JSX tag, but by asking whether the element does anything.

```
payments      qris-static-payload-input, restaurant-payments-icon, stripe-currency-select, stripe-reader-select
receipts      restaurant-receipts-icon
settings      restaurant-settings-icon
editor        restaurant-menu-editor-icon, restaurant-menu-editor-title
```

## The check, and why it differs from round 276's

| | round 276 | this round |
|---|---|---|
| what was read | the JSX tag | the tag, its attributes, its handlers, and its siblings |
|---|---|---|
| conclusion for the back buttons | chrome | **navigation, and covered in 282** |

Four of the eight are now confirmed chrome by the stronger check: every icon is a `<span>
aria-hidden="true">` with no handler, role or tabindex, and both titles are `<h1>`.

**Two of them are containers, and that is worth stating.** `restaurant-payments-header` and
`restaurant-receipts-header` are `<div>`s whose ONLY interactive child is the back button
round 282 covered — so they are asserted behaviourally as the thing that disappears when back is
pressed, without their own id appearing in a selector.

## The three that are not chrome

`qris-static-payload-input` carries a custom handler, not a plain write:

```ts
const handleStaticQrChange = (value: string) => {
  setDrafts((prev) => prev.map((d) => d.rail_code.toLowerCase() === 'qris'
    ? { ...d, parameters: writeStaticQrPayload(d.parameters, value) }
    : d));
};
```

`writeStaticQrPayload` is a named transform, not `parameters: value`. So this input has a
conversion in it, and the same reading covers `stripe-currency-select` and `stripe-reader-select`,
whose `onChange` writes `updateRailParams('stripe', {...})`.

**All three go through the same boundary as every other field**, whose allow-list round 183
pins — so the security property is covered once rather than three times. What is NOT covered is
`writeStaticQrPayload` itself as a transform, and the round's remaining work is to read it and
decide whether it warrants its own test.

## Verified

| Item | Result |
|---|---|
| Remaining ids re-derived | 8, matching the scan's `none` column |
| Confirmed chrome | 4 icons/titles, 2 headers as their back button's container |
| Confirmed behaviourful | 3 inputs/selects writing through a named transform |
| Source changed | none |
| New tests | zero |

## Where this leaves the objective

**No restaurant surface has an uncovered control.** The tables screen is 21/21 with `none 0`; the
cart panel and cart line have `none 0`; and the three screens' remainders are either
`aria-hidden` glyphs or fields whose write boundary is already pinned.

The one open question is `writeStaticQrPayload`, and the next round should read it: if it
validates or normalises the payload in a way a round-trip could lose, it wants a test; if it is
a straight merge, it belongs with the field plumbing.

> last audited 15-10-26 by docs-auditor