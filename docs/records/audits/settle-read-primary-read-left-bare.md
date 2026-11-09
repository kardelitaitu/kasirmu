# `settleRead` had two consumers with a PRIMARY read left bare

**Date:** 2026-10-11 · **Round:** 51 (session) · **Status:** FIXED (both)
**Area:** `ui/src/features/shifts/ShiftManagementScreen.tsx`,
`ui/src/features/stock-transfers/StockTransfersScreen.tsx`

## Origin

Round 50 closed `settle-read.ts`'s own gap in `SalesHistoryScreen` — a primary read left as a
bare `await` inside a `Promise.all` whose catch was empty — and recorded the other
consumers of the helper as a follow-up. This round runs that audit. **Two more instances of
the same shape**, out of the ten consumers, and only by going consumer-by-consumer.

## The shape

`Promise.all` rejects on the FIRST failure. A read that is settled individually survives a
sibling's failure; a read that is a bare `await` does not — it takes the whole await down,
and the code that would have inspected the *other* reads' answers never runs.

### 1. `ShiftManagementScreen.load` — the exact wrong action

```ts
const [allShifts, active] = await Promise.all([
  listShiftsScoped(sessionToken),                                    // bare await
  settleRead('active_shift', getActiveShiftScoped(sessionToken)),
]);
```

When the **list** read rejects, the try block aborts before `active.ok` is evaluated.
`activeShiftUnknown` is never set, so the screen falls through to the no-active banner
(`:485`) whose only affordance is **Open Shift**.

The screen already ships a dedicated guard for this: `:460` renders a *different* banner
offering **Retry** instead, with a comment saying opening would be "the exact wrong action"
because the database may still hold a shift open. A failed list read — which says **nothing**
about the drawer — reached the plain banner and offered it anyway.

The existing test (`does not claim there is no active shift when the read failed`) deliberately
resolves the list read so only the active-shift failure is in play. The suite was green with
the other read unprotected, which is what hid this.

**Fix:** the list read goes through `settleRead('shifts', ...)`; a new `shiftsUnknown` gates the
history table's empty state, because an unanswered list read would otherwise render "no
shifts ever" — a claim about the store.

### 2. `StockTransfersScreen.load` — answers thrown away

Same shape, different consequence. Here the two settled reads' `unknown` state is already
rendered correctly (`terminals === null && !loading`, `:657`; `products === null`, `:710`).
But the primary read's rejection discarded their **answers**: `Promise.all` rejected, the
`if (prodRead.ok) setProducts(...)` lines never ran, and the two dropdowns reported as
unanswered when they had in fact been answered.

**Fix:** the primary read settles like its siblings, so all three answers reach state
independently; a failed list read now reports through the existing error banner instead of
the catch that would have discarded the others.

## Evidence

Both new tests **RED before their fix, green after**:

- `ShiftManagementScreen` — *does not offer Open Shift when the SHIFT LIST read failed*. RED
  output shows the defect verbatim: `No active shift` present, and `Open Shift` offered.
- `StockTransfersScreen` — *does not discard the ANSWERED dropdown reads when the transfer
  list fails*. RED: `Unable to find an element with the text: Register 9` — the answer was
  thrown away.

Each **kill-tested** by reverting its primary read to a bare `await` — both red again, then
green on restore.

- `ShiftManagementScreen.test.tsx` **22 passed** (was 20 — two new)
- `StockTransfersScreen.test.tsx` **21 passed** (was 20 — one new)
- full UI suite **807 files, 12,815 passed**
- `typecheck` clean · `eslint` clean

## The rest of the audit: clean

| Consumer | Verdict |
|---|---|
| `AppShell.tsx` | already settled, four uses |
| `OfflineQueueScreen.tsx` | settled; its comment explains the whole class |
| `useMultiCurrency.ts` | settled **arm by arm**, with a comment naming `Promise.all` as the failure mode to avoid |
| `DiagnosticsSection.tsx` | settled |
| `WarehouseCountFlow.tsx` | settled via `.then` |
| `SalesHistoryScreen.tsx` | fixed round 50 |

## What this round generalises

**A helper applied to n-1 of n reads is a finding, not a near-miss.** The round-50 record
called the follow-up "worth auditing"; it produced two substantive defects. Both were
invisible to their suites because each file's existing test arranged for the *protected* read
to fail — the green run was conditioned on the bug not firing.

Two of the three fixed sites had already written the reasoning for why the guarded read
matters (`ShiftManagementScreen`'s "exact wrong action", `useMultiCurrency`'s note on
`Promise.all` discarding answers). The pattern is well understood in this codebase; the miss
is coverage, not comprehension.

> last audited 11-10-26 by docs-auditor
