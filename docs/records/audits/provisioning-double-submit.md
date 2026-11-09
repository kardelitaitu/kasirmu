# A double submit on first-run provisioning ran it twice

**Date:** 2026-10-11 · **Round:** 63 (session) · **Status:** FIXED
**Area:** `ui/src/features/setup/ProvisioningFlow.tsx` — `handleSubmit`

## The defect

`handleSubmit` (:564) sets `busy` (:575) but has no `busy` re-entry check, and it is the
form's `onSubmit` (:654). The submit button IS guarded — `disabled={!canSubmit || busy}`
(:1331) — but pressing **Enter in a text field** submits the form natively and never
consults the button.

This is the **fourth** instance of the round-60 mechanism (table Save, Reserve, EDC
terminal) and by far the most consequential:
`provisionDevice` (:592-608) CREATES the device, the location **and the owner account**
in one call, and this is the one-shot first-run operation. A second call while the first
is in flight either duplicates all three or fails on the owner's username uniqueness —
and the merchant is sitting at the first-run screen either way, which is the worst place
to be stuck.

## Fix

`if (busy) return;` at the head of the handler, with `busy` added to the dep array.

## Evidence

**RED before the fix**:

```
AssertionError: a double submit provisioned the device twice:
  expected 2 to be 1
```

The new test in `ProvisioningFlow.test.tsx` drives the real wizard — `provision-mode-local`
then the existing `fillBasicForm()` helper — then fires two `fireEvent.submit` calls with no
`await`, against a `provisionDevice` mock gated on a never-resolving promise.

**Kill-tested** by neutering the guard to `if (false && busy)`: `2 to 1` again, green on
restore.

- `ProvisioningFlow.test.tsx` **50 passed** (was 49 — one new)
- full UI suite **808 files, 12,829 passed**
- `typecheck` clean · `eslint` clean

## The sweep, and why I am not claiming the rest

Applying round 62's one-sentence rule to every `<form onSubmit={async …}>` in `ui/src`
produced **9 such forms, 7 of which the sweep called unguarded**.

**The sweep was wrong on three of them** — `CreatePinScreen.handleSubmit`,
`StaffLoginScreen.handleUsernameSubmit` and `ShiftBar.handleStartShift` all do have
guards, verified by reading each one (`disabled={loading || …}` at CreatePinScreen:247,
`disabled={!username || usernameChecking}` at StaffLoginScreen:665). The detector looked
for a guard as an *early `return`* rather than a flag the caller consumes, so it reported
guarded code as unguarded. I checked each candidate by hand rather than acting on the
list.

Of the remainder, `ThresholdConfigScreen.handleSave` is safe at the backend (an upsert)
and `LicenseActivationScreen.handleActivate` is an auth flow I did not finish triaging this
round. Both are recorded as open, not fixed.

## The rule, with four instances

> For any `<form onSubmit={async handler}>`, the handler needs its own re-entry check —
> `disabled` on the submit button cannot cover Enter.

Found at: `TableManagementScreen.handleSaveTableModal` (60),
`.handleConfirmReservation` (61), `EdcTerminalsCard.handleSubmit` (62),
`ProvisioningFlow.handleSubmit` (63).

That is a consistent enough hit rate that the remaining `onSubmit` handlers are worth
checking by hand against the sentence above — which is exactly what this round did and what
produced the finding.

## Related

- `edc-terminal-form-double-submit.md` (62) — the third instance, and the checklist rule.
- `add-table-double-submit-creates-two-tables.md` (60),
  `reserve-table-double-submit-two-open-bills.md` (61).

> last audited 11-10-26 by docs-auditor
