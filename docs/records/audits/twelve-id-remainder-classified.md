# The 12-id remainder, verified class by class (round 276)

## Why round 275's table is not yet a conclusion

Round 275 added a `none` column — the ids NOTHING asserts anywhere — and this round's job is to check
that the 12 in it really are chrome and architecture, rather than believing a summary the session's
own rule says to measure.

## The result

| Screen | Id | What it is | Verdict |
|---|---|---|---|
| payments | restaurant-payments-header | a Localized title span | chrome |
| payments | restaurant-payments-icon | an aria-hidden glyph | chrome |
| payments | stripe-currency-select | SettingsSelect; onChange writes updateRailParams('stripe', {currency}) | field plumbing |
| payments | stripe-reader-select | SettingsSelect; writes updateRailParams('stripe', {reader}) | field plumbing |
| payments | qris-static-payload-input | a text input; same write-through as the other QRIS fields | field plumbing |
| receipts | restaurant-receipts-header | title | chrome |
| receipts | restaurant-receipts-icon | glyph | chrome |
| settings | restaurant-settings-icon | glyph | chrome |
| editor | restaurant-menu-editor-icon | glyph | chrome |
| editor | restaurant-menu-editor-title | title | chrome |
| CartPanel | pos-cart-conflict-alert | needs a SECOND TERMINAL | architecture |
| CartPanel | pos-cart-conflict-takeover-btn | same | architecture |

**7 chrome, 3 field plumbing, 2 architecture.** Every one has a named class, and none is an uncovered
behaviour.

## Why the field-plumbing three stay uncovered

Both Stripe selects and the QRIS payload share one thing with every other field on the screen that
IS covered:

```tsx
onChange={(v) => { setX(v); updateRailParams('stripe', { currency: v }); }}
```

Every credential-ish write goes through `updateRailParams`, whose ALLOW-LIST is round 183's unit
test. So a new field cannot smuggle a provider secret into a market row — the security invariant
these three could violate is covered at the boundary, once, rather than three more times at the
keystroke. Round 263 concluded this for Midtrans; the same reading now covers Stripe.

**That conclusion was argued, not measured, before this round read the three call sites.**

## Verified

| Item | Result |
|---|---|
| Ids re-derived from the scan | 12, matching round 275's count |
| Source lines read for each | all 12 |
| Source changed | none |
| New tests | zero |

## What this settles

**Every uncovered testid across all seven restaurant surfaces is now classified from source, not
from a prior round's prose.** The coverage figure and the classification agree for the first time in
this session, and the agreement is the thing worth having — rounds 267 and 269 both found gaps
precisely where a summary had stood in for a measurement.

## Where that leaves the goal

No restaurant surface has an uncovered control left. The remaining work is of a different kind:
`VIEW_GATED` and the `none` column are both EXEMPTION lists, and an exemption list's correctness is a
judgement about the codebase that a test can only pin for one snapshot.

That is closed as far as it can be in this workspace (rounds 261, 273, 274, 275). **The honest next
step is not another coverage round** — it is picking one of the two second-terminal items and
checking whether a mock seam could make it reachable, the way round 268's `?plan=empty` seam did for
the plan-empty state.