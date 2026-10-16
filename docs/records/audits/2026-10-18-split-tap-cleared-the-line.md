# The split's select-all tap cleared the line — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 104 · status: 1 defect fixed,
     1 money claim WITHDRAWN, 3 conservation properties pinned · branch: 0.0.41 ·
     commit: `fffee4152` -->

<!- - Scope: the split-bill money path. Tree verified green at 812/812 (12,892 passed)
     going in. -->

## The defect

`SplitBillModal` auto-selects the **first line at quantity 1** when it opens (:63-65) —
deliberate, "so the user immediately sees how it works". But `toggleLineFull` decided
select-all from a single test:

```ts
const next = current === 0 ? maxQty : 0;    // any nonzero -> ZERO
```

So the modal opened with line[0] at 1 of N, and the **first tap on that line** — the
gesture a waiter makes to take the whole item — read as "deselect" and emptied it.
**Measured: [1, 3] → tap → [0, 3].**

The two features are individually reasonable and combine into a defect: a helpful default
plus a two-state toggle whose "on" test is `current === 0`. Fixed by making the toggle
three-real-states — nothing → ceiling, **partial → ceiling**, full → nothing — which keeps
the auto-selection and makes it harmless.

## The claim I withdrew

The split handler in `PosScreen` persists `discountPercent`, `discountLabel`, `tipPercent`
and `serviceCharge*` into the REMAINING tab while the SELECTED half goes to payment with the
same state still live. I read that as a double-applied charge.

**It is not.** There is **no backend split model** — `grep 'split_bill' crates/` returns
zero hits — so each half is a separate SALE with its own discount, tip and service charge,
and its own per-sale `Math.floor`. That is correct semantics for two sales; asserting the
halves sum exactly would claim a contract the system does not have.

What I checked instead, and what holds: the partition itself. For every line,
`chosenQty` goes to selected and `l.qty - chosenQty` to remaining (:94-113), so quantities
sum **exactly** — no dropped unit, no duplicated one. And `updateLineQty` clamps to
`line.qty` (:74) with the increase button `disabled={count >= line.qty}` (:224): two doors
to the same ceiling, both now asserted.

## What the test file pins

The modal had a render smoke test and **no arithmetic test at all**. Three properties, all
behavioural:

1. **Conservation** — selecting the whole bill sends every unit exactly once and leaves nothing.
2. **The ceiling** — the stepper cannot exceed the line, at the DOM *and* in the handler.
3. **The remainder** — a partial selection keeps the rest on the tab, asserted as money.

Plus the fixed tap.

## Verification

- **Full suite: 813/813 files, 12,896 passed, 0 failed** (3 skipped, 3 todo).
- The tap case fails pre-fix (`expected [0, 3] to deeply equal [3, 3]`) and passes after;
  **kill test:** restoring the old rule fails exactly that case; restored byte-identical.
- `npm run typecheck` 0 errors — it rejected two casts where a bare `vi.fn()` types
  `mock.calls[0]` as `[]`, which is the same trap round 103 recorded.
- `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> Two reasonable features can combine into a defect that neither review would find alone.
> Here a helpful default (auto-select the first line) met a two-state toggle whose "on"
> test was `current === 0`, and the first tap on the pre-selected line emptied it. When a
> control's state can be reached by more than one path, the toggle has to name every state
> it can be in — not assume the only values are 0 and max.

> last audited 18-10-26 by autonomous-goal-round-104
