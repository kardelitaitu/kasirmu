# Two table-numbering defects, one of them mine — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 97 · status: 2 defects fixed,
     1 self-inflicted · branch: 0.0.41 · commit: `6bf36b6ae` -->

<!- - Scope: the table-number restore paths on the restaurant POS, on a tree verified
     green at 811/811 (12,876 passed) going in. -->

## Defect 1 — a tableless resume left the previous table attached

The restore is conditional:

```ts
if (typeof data.tableNumber === 'string') {
  setTableNumber(data.tableNumber);
}
```

A tab legitimately has no table — a takeaway, or a bill held before the field existed —
so the conditional simply does nothing, and whatever table was already selected stays.

**The path:** `OpenBillModals.tsx:180` calls `handleResumeOpenBill(ob.id)` straight from
the held-tabs list, with no table set by that screen. So an operator with table 5 open who
tapped a **takeaway** tab ended up with the takeaway's items under table 5.

**The consequence is on paper**, which is why it earned a round: `completedSale.ts` puts
this value in the printed args and derives the receipt NUMBER from it (:212), so the check
named a table the order did not have. That is the exact rule this file restates as
"DINE-IN ONLY" in nine places — reached here through the one field the conditional did not
read.

Fixed to set-or-clear. **Measured:** pre-fix `setTableNumber` was called ZERO times with
table 5 in state; post-fix it is called with `''`.

## Defect 2 — my own round-96 guard created a worse bug

This is the one worth the most attention, because it was introduced by the fix in the
previous round and only became visible by following the change through its callers.

`handleSelectTableFromManagement` claimed the table and then fired the resume without
awaiting:

```ts
setTableNumber(tableName);                       // synchronous, always
if (matchingBill) void handleResumeOpenBill(id); // fire-and-forget
```

That was survivable while the resume ALWAYS replaced the cart. Round 96 changed that: the
resume now **refuses** when a different tab is already open. So the operator tapped table 5,
the table number was set, and the resume was declined — **leaving the previous tab's lines
sitting under table 5**. The refusal protected the cart and mislabelled it in the same
breath, which is strictly worse than the original bug.

**The lesson, stated plainly:** a guard is not finished when its own test passes. It is
finished when every caller has been read for what its new `return`/non-effect means. Round
96 shipped a correct refusal into a caller that could not tell it had happened.

**Fix:** the resume returns `boolean` (documented on the callback), and the caller awaits
it and claims the table only on `true`. A table with no matching bill is still claimed
immediately — nothing to refuse in that case, and the guard asserts it so the fix cannot
quietly turn "open a fresh table" into a no-op.

## A guard that policed style instead of behaviour

The ordering check's first draft banned `void` outright — and **failed on the correct
code**, because `void promise.then(...)` is the idiomatic way to drop a result you have
already handled. Rewritten to look for a call with NO continuation, which is the actual
defect shape. Same family as round 95's substring-matching detector: a guard that fails on
working code trains its readers to ignore it.

## Deliberately NOT changed

Two things were examined and left, with reasons recorded rather than silently skipped:

- **The restore effect's deps array** (:274) calls `setTableNumber`, `setCustomerName`,
  `setGuestCount` and `setOrderType` without listing them. These are `useState` setters,
  referentially stable, and ESLint's exhaustive-deps correctly does not flag them — so it
  is convention, not a defect. Touching it would have been churn.
- **The `orderType` restore** (:269) is set-if-present, so a payload with no valid
  `orderType` falls back to the `dine_in` default. All three writers
  (active-draft, memory-trim, lock) always include the field, so no live payload can hit it;
  the gap is latent and its own comment already names the fallback. Changing it would
  alter behaviour for a payload that cannot currently exist.

## Verification

- **Full suite: 811/811 files, 12,876 passed, 0 failed.**
- Both new cases fail pre-fix and pass after; the table-reset case's pre-fix reading was
  `Number of calls: 0`.
- **Kill tests, two:** restoring the conditional leaves the table un-cleared; restoring the
  claim-first ordering fails the new guard on both checks (a) and (b).
- `npm run typecheck` 0 errors (it caught the two consumer types the `boolean` return
  rippled into); `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> A guard is finished when its own test passes AND every caller has been re-read for what
> its new return value means. Round 96's refusal was correct and landed in a caller that
> could not observe it — which made the code worse. The next round, not this one, found it.

> last audited 18-10-26 by autonomous-goal-round-97
