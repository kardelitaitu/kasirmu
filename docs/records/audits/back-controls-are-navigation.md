# Back controls are navigation, and a variable hides an id from the scan (round 282)

## The last of the "none" column

Round 276 classified the then-12 uncovered ids as chrome or field plumbing, and this round
re-derived the same list from the scan after the coverage numbers had moved. Three of them
survived on three screens:

```
restaurant-receipts-back-btn     restaurant-payments-back-btn     restaurant-settings-back-btn
```

**Round 276 filed those as chrome. They were wrong.** A back button NAVIGATES — it is how an
operator leaves a settings screen without a mouse — and the same control on the tables and
history screens IS asserted there (`tables-back-btn`, `sales-history-back-btn`). The omission was
a gap, not a convention.

## 6 passed, both profiles

| Screen | What is asserted |
|---|---|
| receipts | pressing back removes the receipts header |
| payments | pressing back removes the payments header |
| settings | pressing back removes the settings header |

What each pins is that pressing back CHANGES the screen — a button that rendered and did nothing
would pass any presence assertion and would strand the operator.

**Kill-tested**: making the payments back control inert fails its case. Restored to HEAD.

## The trap in the payments route

`payment-card-toggle-cash` — the anchor this screen uses elsewhere — resolves but is **HIDDEN**:
it is a `role=switch` INPUT styled out of the layout. Round 263 recorded the same for the EDC
card, and this is the third surface where the toggle is not the visible thing.

## A variable hides an id from the scan, and the first commit was blind to it

The first version threaded the testids through a helper:

```ts
async function assertBackLeaves(page, backId: string, anchorId: string) { … }
```

**The scan did not move** — because round 270's rule counts an id only when it appears inside a
selector, and a variable reference is invisible to it. The ids were spelled out literally and the
numbers moved:

```
before   payments 20/32  receipts 12/15  settings 10/12
after    payments 22/32  receipts 14/15  settings 11/12
```

**The instrument was right and the code was opaque to it.** That is worth stating plainly because
it is the opposite of the last three rounds, where the instrument was the thing that was wrong.

## Verified

| Item | Result |
|---|---|
| New spec | 6 passed (3 screens x desktop/tablet) |
| Kill-test | 1 failed |
| `RestaurantPaymentsScreen.tsx` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## The remaining ids, re-derived

```
screen        covered   used   unit  none
payments      22/32   22/32     6    4
receipts      14/15   14/15     0    1
settings      11/12   11/12     0    1
editor        19/21   19/21     0    2
tables        21/21   21/21     0    0
CartPanel      9/10    9/10     1    0
CartLineItem  17/17   17/17     0    0
```

**`none` is now 8, and every one is a title or an icon** — the literal chrome round 276 was
claiming the back buttons were. Nothing that navigates, nothing that writes, and nothing that
reports is left.

## What this round changes about round 276

Round 276 concluded no behavioural work remained by classifying each id from source alone.
**Reading a JSX tag is not enough: it classified a navigation control as a glyph.** Three of its
eleven conclusions were wrong in exactly that way, and the cheap check — is this id asserted by
a testid anywhere, including on other screens — would have caught all three.

> last audited 15-10-26 by docs-auditor