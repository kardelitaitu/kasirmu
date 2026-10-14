# Round 185's wait rule applied fleet-wide, and proven against a half-loaded screen (round 186)

## Why this round

Round 185 ended by generalising a rule: **an editor that renders its chrome before its data
needs a data-shaped wait, not a chrome-shaped one.** This round checked whether the OTHER
specs followed it — and one did not.

The survey of every restaurant spec's wait strategy:

| Spec | Waits on |
|---|---|
| `restaurant-sidebar-entries` | **the menu-editor header**, then `.restaurant-card` count 0 |
| `mock-payment-rails-persist` | the save button |
| `restaurant-receipt-preview-documents` | the preview tabs (data) |
| `restaurant-settings-toggles` | load-error absence + toggle state (data) |

Only the sidebar spec waited on pure chrome.

## The defect that created

`RestaurantMenuEditorScreen.tsx:913` renders the header — and the back button —
**unconditionally**, before the loading branch. Probed rather than reasoned:

```
AT_HEADER_VISIBLE: bulk=0 cards=0
```

So the moment the header is visible the screen has **no items and no bulk controls**. The old
assertion could pass against a half-loaded editor — and a later round that added an item-count
assertion after it would have been flaky for no visible reason.

## The fix

Wait on `restaurant-menu-editor-bulk-avail`, which only renders WITH items — the same control
rounds 184 and 185 already use. Three lines became eight, six of them comment.

Not applied elsewhere: the payments and receipts specs already wait on data, and the settings
spec waits on load-error absence plus toggle state. Only the editor case was wrong.

## Verified

| Item | Result |
|---|---|
| Probe: header visible with data absent | bulk=0 cards=0 — the hazard is real |
| Fixed spec | 10 passed |
| --repeat-each=2 | 20 passed, no flake |
| eslint | 0 |
| Full UI suite | 12,703 passed |

## What this did NOT prove

It did not make the old version flaky on demand — the load usually resolves before the next
assertion, which is why this survived since round 149. The evidence is the ORDER OF RENDERING
(`bulk=0` at header-visible), not an observed failure. That is a weaker claim than a reproduced
flake and is recorded as one.