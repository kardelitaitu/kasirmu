# A double submit on Reserve left two open bills against one table

**Date:** 2026-10-11 · **Round:** 61 (session) · **Status:** FIXED
**Area:** `ui/src/features/tables/TableManagementScreen.tsx` — `handleConfirmReservation`

## The defect

`handleConfirmReservation` (:743) is the reserve form's `onSubmit` (:1880) and had no
`reservingTable` re-entry check.

Unlike round 60's Add Table case, the **button was already guarded** —
`disabled={!reserveModal.guestName.trim() || reservingTable}` (:1957). The gap is the
**form path**: pressing Enter in the guest-name field submits natively and never consults
the button.

The consequence is worse than a duplicate name. The handler's first write is
`holdCartScoped` (:773), which **creates** a held cart / open bill. A double submit left
**two open bills against one table**, and `updateTableStatusScoped` then flipped the table
to `reserved` twice.

Same class as rounds 57 and 60: a write that CREATES can duplicate, and the form's own
submit path is a second door the button's `disabled` does not cover.

## Fix

`if (reservingTable) return;` at the head of the handler, with `reservingTable` added to
the dep array.

## Evidence

**RED before the fix**:

```
AssertionError: a double submit created more than one reservation:
  expected 2 to be 1
```

Two `fireEvent.submit` calls with no `await` between them, against a `holdCartScoped`
mock gated on a never-resolving promise, so the first submit is provably still in flight
when the second lands.

**Kill-tested** by neutering the guard to `if (false && reservingTable)`: `2 to 1` again,
green on restore.

- `TableManagementScreen.test.tsx` **65 passed** (was 64)
- full UI suite **807 files, 12,827 passed**
- `typecheck` clean · `eslint` clean

## How this was found

Round 60's record flagged the form-submit path as the remaining risk but left the
candidates untriaged. This round first checked the five round-60 leftovers against their
buttons and found **all five already safe**: `handleCreate`, `PurchaseOrderForm.handleSave`,
`PromotionManagementScreen.handleSave` and `SuppliersScreen.handleSave` all route through a
Button with `loading={saving}` (which disables it) or a shared `SettingsPopup` whose save
control carries `loading` + `disabled` — and none of them is a form `onSubmit`.

A dedicated sweep for **async `onSubmit` handlers with no in-handler re-entry guard**
then produced 8 candidates across auth, inventory, settings, setup and tables. This was
the restaurant-POS one, and the only one confirmed by test.

The other seven are recorded as open, not fixed: `CreatePinScreen.handleSubmit`,
`LicenseActivationScreen.handleActivate`, `StaffLoginScreen.handleUsernameSubmit`,
`ShiftBar.handleStartShift`, `ThresholdConfigScreen.handleSave`,
`EdcTerminalsCard.handleSubmit` and `ProvisioningFlow.handleSubmit`. Several are
auth flows where a duplicate is refused by the backend (an existing PIN, a consumed code);
each needs the same backend-INSERT check rounds 59-60 established before it can be called
a defect.

## Related

- `add-table-double-submit-creates-two-tables.md` (60) — same file, same mechanism, found
  the round before.
- `retail-hold-double-click-two-writes.md` (57) — the `holdCartScoped` create, from the
  button side rather than the form side.
- `void-double-fire-refused-server-side.md` (59) — the triage rule: create vs set.

> last audited 11-10-26 by docs-auditor
