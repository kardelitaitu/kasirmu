# The Escape class I chased does not exist — but its coverage did not either — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 188 · status: a suspected defect CLASS in
     the three restaurant sub-screens was REFUTED by measurement; the real find is that all
     three had ZERO Escape coverage · branch: 0.0.41 · commit: 5232e8fb3 -->

<!-- Scope: last round concluded "the claim is the stop, not the return". Test that class. -->

## The hypothesis, and why it was reasonable

Round 187 fixed the menu editor by adding `stopPropagation()` to branches that consumed
Escape but let it travel on to PosScreen's cascade. Three sibling screens — Settings, Receipts,
Payments — are mounted the same way (sub-screens inside PosScreen, each with `onBack`) and
each binds its OWN `document` Escape listener. They looked like three more instances.

The stakes were not cosmetic. Each one's handler is:

```ts
const handleRequestBack = () => {
  if (dirty) setShowUnsavedDialog(true);   // <- the unsaved-changes safety net
  else onBack?.();
};
```

If PosScreen's cascade won, a dirty screen would close with **no warning and silent data
loss** — the round-177 symptom with a worse consequence.

## Refuted, by probing the dirty path

The measurement that mattered is what happens with UNSAVED CHANGES:

| screen | dirty? | before | after Escape | verdict |
|---|---|---|---|---|
| Settings | yes | settings 1, dialog 0 | **settings 1, dialog 1** | correct — asked, stayed |
| Payments | yes | settings 1, dialog 0 | **settings 1, dialog 1** | correct — asked, stayed |
| Receipts | n/a | header 1 | header 0 | clean screen — `onBack()` is intended |

All three behave correctly. The CLEAN-screen case I first saw "close the screen" is
`dirty:false` → `onBack()`, which is exactly right — an operator pressing Escape on a
screen with nothing to lose should leave. I had read that as the defect for a few minutes.

**So the class is one instance, not four.** The menu editor was different in a specific way: its
Escape handling had to serve a NESTED layer (the item form) that the parent could not see, so it
genuinely needed to claim the key. These three have no nested layer — one Escape, one meaning —
and their listener happens to win without needing capture.

## What the probe did find: the keyboard path was never tested

Greping the three suites for how they exercise the unsaved-changes flow:

```
RestaurantSettingsScreen.test.tsx   Escape mentions: 0   unsaved mentions:  9
RestaurantPaymentsScreen.test.tsx   Escape mentions: 0   unsaved mentions: 11
RestaurantReceiptsScreen.test.tsx   Escape mentions: 0   unsaved mentions: 16
```

**Zero, in all three.** Every one of those 36 unsaved-changes assertions drives the BACK BUTTON
— `getByTestId('restaurant-payments-back-btn')` — which calls `handleRequestBack` directly.
Escape takes a completely different route: a `document`-level listener that competes with
`PosScreen`'s cascade. **The path every operator actually uses had no test, and the
path it shares with the round-177 defect is precisely the one that was broken there.**

That is the honest finding: the screens were correct, and *nothing in the suite would have told
me if they were not.* The only thing asserting the race was a manual probe — mine, today.

## The coverage added

One case per screen, mirroring the existing back-button case exactly so the two paths are
directly comparable, plus a clean-path case on Payments:

- **dirty + Escape → the unsaved-changes dialog appears and `onBack` is NOT called** (all three);
- **clean + Escape → `onBack` IS called and no dialog** (Payments).

## Two harness traps, both recorded in the tests

1. **`fireEvent.keyDown(document, ...)` throws** — `TypeError: e.target?.closest is not a
   function`. The handlers call `e.target.closest('[role="dialog"]')`, and a document node has
   no `closest`. Dispatching from an ELEMENT inside the screen is the fix, and the comment
   says so — otherwise the next author writes `document` again and loses an hour.
2. **The first version of my own test failed for the harness reason, not a product reason.** I
   could have read "test fails" as "defect confirmed" and written the round up as three more
   bugs. The failure message is what stopped that, and it is why the TypeError is quoted above.

## Verified

| check | result |
|---|---|
| the three suites | **120 passed** |
| kill-test on Payments: remove the Escape listener | the two new cases go **red** |
| restore of the production file | byte-identical by sha256 (`f369ad3aa2f6efc1`) — no production change shipped |
| `npm run lint` / `typecheck` | 0 errors / clean |
| stray probes | none; `zz-*` removed and verified |

## Carried forward

1. The three sub-screens are CORRECT — do not re-open this class without a new reproduction.
2. `TableManagementScreen`'s detail panel is a DIFFERENT and REAL case, already documented by
   another lane in `restaurant-tables-toolbar.spec.ts:85` and `restaurant-tables-print-bill.spec.ts:80`:
   Escape there closes the whole table view, and the panel is not an ARIA modal so it could
   never own the key. Those specs work around it by clicking Close. **The workaround is
   correct but the behaviour is still arguably wrong** — worth a round if the panel is expected
   to be dismissable by keyboard.

> last audited 18-10-26 by docs-auditor
