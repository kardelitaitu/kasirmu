# A double submit on Add Table created two tables with the same name

**Date:** 2026-10-11 · **Round:** 60 (session) · **Status:** FIXED
**Area:** `ui/src/features/tables/TableManagementScreen.tsx` — `handleSaveTableModal`

## The defect

`handleSaveTableModal` (:367) had no `tableModalSaving` re-entry check.

The Save **button** is guarded — `state={tableModalSaving ? 'processing' : 'ready'}`
(:1609), and `Button`'s `isDisabled = disabled || isProcessing` (Button.tsx:72) — but the
**form** is `onSubmit={handleSaveTableModal}` (:1525). Pressing Enter in the name field
submits the form directly and never consults the button, so a second Enter lands inside
the first write's await and fires a second `createTableScoped`.

**The backend cannot catch it.** `create_table` (`kasirmu-core/src/db/tables.rs:130`) is
a plain INSERT that mints a fresh UUID per call, with **no uniqueness on `name`**. Two
submits produce two tables called "T1", and the operator then has to work out which one
the floor plan reads from.

This is the `create` half of round 59's triage rule — *does the write create, or does it
set a value?* A create can duplicate; a set cannot. `create_table` creates.

## Fix

`if (tableModalSaving) return;` at the head of the handler, with `tableModalSaving`
added to the dep array.

## Evidence

**RED before the fix**, with the duplicate counted exactly:

```
AssertionError: a double submit created more than one table:
  expected 2 to be 1
```

Two `fireEvent.submit` calls with no `await` between them, against a `createTableScoped`
mock gated on a never-resolving promise — so the first submit is provably still in flight
when the second lands.

**Kill-tested** by neutering the guard to `if (false && tableModalSaving)`: `2 to 1` again,
green on restore.

- `TableManagementScreen.test.tsx` **64 passed** (was 63)
- full UI suite **807 files, 12,826 passed**
- `typecheck` clean · `eslint` clean

## How this was found, and what it says about the sweep

Round 59's rule narrowed the round-57 list of 87 unguarded async write handlers to the
**64 that call a CREATE-shaped function**. Four detector revisions were needed to get a
list worth reading, and each one had to be *validated against a known case* before its
output meant anything:

1. matched zero handlers — the `useCallback(async` regex was wrong (found in round 57);
2. flagged 31, but ignored `loading=` on the shared `Button`, which disables it exactly
   like `disabled=` — that alone accounted for `StockTransfersScreen.handleCreate`;
3. flagged 63, because the captured setters were PascalCase (`Saving`) while the JSX
   consumes camelCase (`saving`), so the consumption check never matched;
4. **29 candidates**, of which this was one.

Most of the 29 are prints and hardware commands — `handlePrintBill`, `handleOpenCashDrawer`,
`handleTestDrawer` — where a double-fire wastes paper or buzzes a drawer rather than
duplicating a record. Triaging the rest against their backends (INSERT vs UPDATE) is the
next sweep; this round fixed the one confirmed by test.

## Related

- `retail-hold-double-click-two-writes.md` (57) — the same class on the Hold button, and
  the second confirmed `create`-shaped duplicate.
- `close-shift-enter-during-in-flight-close.md` (58) — the Enter-bypasses-the-button
  mechanism, there on an overlay handler rather than a form.
- `void-double-fire-refused-server-side.md` (59) — the triage rule: create vs set.

> last audited 11-10-26 by docs-auditor
