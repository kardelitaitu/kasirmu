# Stale absolute quantity writes — a tree-wide sweep, and one more money defect — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 92 · status: SWEPT CLEAN after 1 defect fixed ·
     branch: 0.0.41 · commit: `ab2de8fe4` -->

<!- - Scope: every `setX((prev) => ...)` updater in `ui/src` that writes a quantity key from an
     argument rather than from `prev`. This closes the class of defect found in rounds 89-91
     (retail till, shared POS cart, KDS picker). -->

## The defect, in one shape

A stepper computes the next quantity from the value it last RENDERED and then writes that
number absolutely into state:

```tsx
const updateQty = (lineId: string, qty: number) => {
  setSelectedLines((prev) => ({ ...prev, [lineId]: qty }));   // absolute
};
// ...
onClick={() => updateQty(line.id, selectedQty + 1)}            // snapshot + arithmetic
```

`selectedQty` is `selectedLines[line.id] ?? 0` read during render. Two taps landing in one React
batch close over the SAME snapshot, both compute the same sum, and the absolute write applies it
twice — so the second tap is lost. The fix is always the same: resolve the arithmetic INSIDE the
updater, where `prev` is the value the previous step actually committed.

## Why this is a money bug and not a cosmetic one

In `RefundModal` the refunded amount is DERIVED from `selectedQty` (:295), so a lost tap refunds a
cash amount smaller than the operator asked for. Nothing downstream re-checks the operator's
intent; the modal reads as "I selected 2" while it will hand back 2 units' worth of money for a
3-unit request.

## The ceiling does not protect you

The increase button carries `disabled={selectedQty >= line.qty}` (:289), which is why the shared
test fixture — `line-1` at `qty: 2` — could never have caught this: it is already AT the ceiling,
so the second tap is refused at the DOM and the case passes either way. The defect is exposed for
every tap BELOW the maximum, i.e. on any line sold with qty >= 3. The regression test therefore
carries its own 5-unit line and steps 1 -> 3, with the assertion covering both the count and the
amount.

## The detector, and why a 0-hit sweep proved nothing

The first two regex versions returned **0 hits on the known-bad file** `git show
HEAD~1:ui/src/features/sales/RefundModal.tsx`. Both were broken in the anchor: they required the
line to BEGIN with `...prev` (or put the qty literal inside a dict-key group), while the real line
is `return { ...prev, [lineId]: qty };` — a `return { ...prev, ` prefix that the optional group
cannot match because it is optional only when it comes FIRST. A detector validated against the
known-bad case, not against zero, is the whole point: it must fire on `[lineId]: qty` and must NOT
fire on the fixed `[lineId]: next`.

That correction mattered — a green sweep here would otherwise have closed the class silently.

## What the corrected sweep found

| Site | Shape | Verdict |
|---|---|---|
| `ui/src/features/sales/RefundModal.tsx` | `[lineId]: qty` from a render snapshot | **DEFECT — fixed** (`ab2de8fe4`) |
| `ui/src/features/sales/RefundModal.tsx:44` | `[lineId]: maxQty` on select-all | Clean — selects the full line, no arithmetic to lose |
| `ui/src/features/sales/components/SplitBillModal.tsx:71` | `Math.min(maxQty, current + delta)` resolved inside the updater | Clean — the correct pattern, already |
| `ui/src/features/sales/components/ItemModifierModal.tsx` | `[groupId]: current` where current is a Set of modifier ids | Clean — a set, not a batched quantity |
| `ui/src/features/restaurant/components/MenuItemContextMenu.tsx` | `[sku]: hex` colour pin | Clean — not a quantity |

**`KioskScreen.tsx` is clean too, and its own name is misleading.** `updateQty(sku, delta)`
(:94) resolves `c.qty + delta` inside `setCart` and clamps with `Math.max(0, ...)`, then filters
`qty > 0` — the delta signature is what the class wants. Only the parameter NAME says
"absolute". Carried as a suspect from an earlier round's grep, it was not re-verified until now;
the record corrects it.

## Verification

- `npx vitest run src/__tests__/RefundModal.test.tsx` — 20/20 pass.
- **Kill test, two attempts.** The first kill edit replaced only the delta with `+1` and the case
  failed EARLY, on the setup step (`Unable to find an element with the text: 1`), because it also
  broke the decrement. That red is not evidence about the fix. The faithful kill restores the
  original two-part shape — `changeQty(line.id, selectedQty + 1)` at the call site AND `const next =
  delta` (absolute) in the updater — and the case fails on the assertion that matters: `Unable to
  find an element with the text: 3`.
- `npm run typecheck` exit 0; `npm run lint` 0 errors (113 pre-existing `react-refresh`
  warnings, none in the two touched paths — confirmed by filtering the output for `RefundModal`).

## Standing rule

> A quantity stepper must resolve its arithmetic inside the state updater. A `qty` argument to a
> setter, paired with `selectedQty ± 1` at the call site, is the smell — regardless of how correct
> the `disabled` guards look.

> last audited 18-10-26 by autonomous-goal-round-92
