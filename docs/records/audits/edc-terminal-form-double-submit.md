# A double submit on the EDC terminal form configured two terminals

**Date:** 2026-10-11 · **Round:** 62 (session) · **Status:** FIXED
**Area:** `ui/src/features/settings/components/EdcTerminalsCard.tsx` — `handleSubmit`

## How this was found

Rounding off round 61's list of seven unguarded async `onSubmit` handlers. Most of the
round went on **triage, not fixing**, and that is the honest shape of it:

| Candidate | Verdict |
|---|---|
| `EdcTerminalsCard.handleSubmit` | **real defect — fixed below** |
| `StaffLoginScreen.handleUsernameSubmit` | guarded: `disabled={!username \|\| usernameChecking}` (:665) and :700 |
| `CreatePinScreen.handleSubmit` | guarded: `disabled={loading \|\| ...}` (:247) |
| `ThresholdConfigScreen.handleSave` | backend is an UPSERT — `set_stock_threshold` checks for an existing row and UPDATEs (`inventory.rs:693-718`) |
| `ShiftBar.handleStartShift` | guarded at the button (:665 pattern), and the backend refuses a second active shift (`inventory.rs:393-408`) — **already tested** (`inventory_tests.rs:197-204`) |
| `LicenseActivationScreen.handleActivate` | not reached this round — an auth/activation flow needing its own backend check |

Two of the seven were already covered by the **backend** (unique index, upsert), the same
triage rounds 59-60 established. Three were **already guarded in the UI**, and round 61's
sweep simply did not recognise their guard variable. Only one was a real defect.

## The defect

`handleSubmit` (:149) is the form's `onSubmit` (:397) and has no `submitting` re-entry
check — it only calls `setSubmitting(true)` (:170).

The Save **button** is guarded (`disabled={submitting}`, :536), but pressing **Enter in
the Terminal Name field** submits the form natively and never consults the button.
`createEdcTerminalScoped` INSERTS, so two submits configured **two terminals for one
register** — and the operator then has to work out which one the register actually uses.

This is the third instance of the round-60 mechanism: **a form's own submit path is a
second door that a button's `disabled` does not cover.**

## Fix

`if (submitting) return;` at the head of the handler.

## Evidence

**RED before the fix**:

```
AssertionError: a double submit configured more than one terminal:
  expected 2 to be 1
```

The new test (`EdcTerminalFormDoubleSubmit.test.tsx`) reached the form on its **first** run
— it failed on the assertion, not on setup — so it is not vacuous. Two `fireEvent.submit`
calls with no `await`, against a `createEdcTerminalScoped` mock gated on a
never-resolving promise.

**Kill-tested** by neutering the guard to `if (false && submitting)`: `2 to 1` again, green
on restore.

- `EdcTerminalFormDoubleSubmit.test.tsx` — 1 passed (new file)
- full UI suite **808 files, 12,828 passed**
- `typecheck` clean · `eslint` clean

## The generalisation, now with three instances

`TableManagementScreen.handleSaveTableModal` (round 60),
`TableManagementScreen.handleConfirmReservation` (round 61), and this one. All three had a
correctly-disabled button **and** a form `onSubmit` with no guard.

The rule is worth stating as a review checklist item:

> For any `<form onSubmit={async handler}>`, the handler needs its own re-entry check —
> `disabled` on the submit button cannot cover Enter.

The remaining `onSubmit` handlers in the codebase should be checked against exactly that
sentence, which is a much cheaper test than a backend audit of each one.

## Related

- `add-table-double-submit-creates-two-tables.md` (60) — first instance.
- `reserve-table-double-submit-two-open-bills.md` (61) — second instance, where the button
  was already guarded and the form path was the only gap.

> last audited 11-10-26 by docs-auditor
