# The silent-save defect class is closed across the tree (round 166)

## Why this round

Rounds 163 and 165 found the SAME defect on two different restaurant screens — a control armed
for an action whose handler returns silently. Three instances in three rounds is either a
coincidence or a property of how these forms were written, and the answer decides whether more
of them are waiting. This round measured it.

## The survey

Two passes over all **806 `.tsx` files** under `ui/src`:

1. **Validation-regex pass.** Files containing both a silent return keyed on a
   `name`/`title`/`trim()` condition and a submit control. Four candidates, of which two were
   the screens rounds 163 and 165 had already fixed.
2. **Gate/handler pass.** Files with a `!dirty || saving` gate where a handler guards on a
   condition the gate omits. Three hits:

| File | Unguarded | Status |
|---|---|---|
| `RestaurantPaymentsScreen.tsx` | `sessionToken` | closed upstream — round 157 proved the `{!loading && …}` wrapper (`:976`) makes it unreachable |
| `RestaurantReceiptsScreen.tsx` | `loaded` | round 164's fix |
| `paymentsSaveLocationRace.test.tsx` | — | my own test asserting the round-157 gate |

## The retail twins are clean

`features/retail/AddCategoryModal.tsx` and `EditProductModal.tsx` both carry `type="submit"`
and were the live candidates left by pass 1. Checked individually: **neither has the pattern.**
`AddCategoryModal` has no `disabled={}` at all. Its `if (!name.trim()) return;` at `:42` is silent, but the input is `required` at `:98`, so the browser blocks submit before the return is reachable — which is why it is not the pattern;
`EditProductModal`'s five gates are all `imageBusy`/`MAX_IMAGES`, and its validation is reported
through `error` rather than returned from.

## Conclusion

**The class is closed.** The instances that existed were: two reachable defects (rounds 163 and
165, both fixed and kill-tested), one unreachable asymmetry (round 157, pinned by a test), and
one consistency fix (round 164). Nothing remains in the tree.

The remaining question is different from finding more instances — it is whether it STAYS closed,
which is guard work rather than sweep work. Two candidates, both rejected here:

* a script that parses every `disabled={…}` and cross-checks its handler — needs a real JSX
  parser, and a regex version produces false positives of exactly the kind that made round 152's
  version unusable;
* a lint rule — the right answer, wrong scope for this session, and it needs the same cross-file
  reasoning to be accurate.

So the finding is recorded rather than automated: four screens carried the pattern, all four are
resolved, and any NEW modal following the same shape would re-learn the lesson — which a guard
would prevent, but the risk of writing a bad guard at the end of a session is higher than its
reward.

## Verified

| Item | Result |
|---|---|
| Files surveyed | 806 `.tsx` under `ui/src`, two independent passes |
| Live candidates left | **none** |
| Retail twins | checked, clean |
| Menu-editor fix | re-probed live: `disabled={!draft || saving || !draft.name.trim()}` (`RestaurantMenuEditorScreen.tsx:994`) |
| Tree | no source changed this round |

> last audited 14-10-26 by docs-auditor
