# Enter during an in-flight shift close issued a SECOND close

**Date:** 2026-10-11 · **Round:** 58 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/components/ShiftModals.tsx` — the close-shift overlay

## The defect

The close-shift dialog has TWO ways to confirm, and only one was guarded:

- the **Confirm button** — `disabled={closingShift || ...}` (:192-197);
- the **overlay's Enter binding** — `if (e.key === 'Enter' && !isEditableTarget(e.target))`
  (:104), with **no `closingShift` check**.

`closingShift` is set the moment the hook starts its write and cleared only in its
`finally`, so a cashier who pressed Enter while the dialog read "Closing…" fired a
**second `closeShiftScoped`** while the first was still in flight. Closing a shift is a
money event — it freezes the drawer count and the expected-cash figure the day's
reconciliation is built from.

The button's `disabled` cannot cover it: a keydown on the overlay never consults the
button's state at all. Same class as round 57's Hold double-click, one layer up.

## Fix

The Enter binding gains `&& !closingShift` — the guard its own Confirm button already
carried two dozen lines below.

## Evidence

**RED before the fix**:

```
AssertionError: Enter during an in-flight close issued a second close:
  expected "vi.fn()" to not be called at all, but actually been called 1 times
```

**Kill-tested** by reverting the binding — red again, and the neighbouring
*still confirms on Enter when focus is not in a text field* case stays green, which is the
check that the guard is narrow rather than a removal of the affordance.

- `closeShiftEnterHazard.test.tsx` **6 passed** (was 5)
- full UI suite **807 files, 12,825 passed**
- `typecheck` clean · `eslint` clean

## The test nearly shipped vacuous — and a probe caught it

This is the round's real lesson, and it cost three attempts.

1. **First version passed before the fix.** It focused the Cancel button. But Cancel is
   `disabled={closingShift}` (:182), so `focus()` is a **no-op while in flight** and the
   keydown landed on `<body>` — never reaching the overlay. The test passed on a
   keystroke that could not have fired the handler.
2. **A probe caught it.** Inverting the assertion to `toBeGreaterThan(0)` and re-running
   showed **0 calls** — proving the test could not detect the defect even if it were
   present.
3. **Focusing the panel fixed it.** The panel is not disabled, so Enter reaches the
   overlay; the inverted probe then reported 1 call while in flight, and the restored
   `not.toHaveBeenCalled()` went red. Only then was the guard written.

The technique worth naming: **invert the assertion and confirm it fails.** If
`not.toHaveBeenCalled()` and `toHaveBeenCalled()` both pass, the test is not measuring the
code path it claims to. This is the fifth round in a row where a green result needed to be
shown capable of going red before it meant anything.

## How this was found

Round 57's sweep produced **87 async write handlers with no in-flight guard**. Narrowing
that list by checking whether each handler's caller actually consumes its busy flag found
four whose flag is never wired to `disabled` — `closingShift`, `settlingId`, and two
`voiding` sites. This is the first of those confirmed by test.

The other three are recorded as open, not fixed: `handleSettleCredit`
(`RetailPosScreen.tsx:1504`, `settlingId`), `handleVoid` (`VoidOrdersScreen.tsx:194`) and
`handleIssueTaxInvoice` (`PaymentModal.tsx:1760`). Each needs the same reachability proof
this round cost three attempts to get right, which is why they are not claimed here.

## Related

- `retail-hold-double-click-two-writes.md` (57) — the double-invocation class, invented
  there and continued here.
- `hardware-load-failure-pinned-save-shut.md` (46) — the same file family; that round's
  guard opened on one path only.

> last audited 11-10-26 by docs-auditor
