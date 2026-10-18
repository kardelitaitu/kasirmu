# The `<form onSubmit>` re-entry guard: the class is closed

**Date:** 2026-10-11 · **Round:** 64 (session) · **Status:** TRIAGE COMPLETE — no code change this round
**Area:** `ui/src/**` — every `<form onSubmit={async …}>`

## What this round did

Rounds 60-63 found four instances of one mechanism and fixed each one. Round 63's sweep
listed **9 async `onSubmit` forms, 7 flagged unguarded** — and I noted three of the seven
were false positives. This round closes the list by hand, one candidate at a time.

## The closed verdict for every candidate

| Form / handler | Outcome |
|---|---|
| `TableManagementScreen.handleSaveTableModal` | **FIXED round 60** — duplicate table names |
| `TableManagementScreen.handleConfirmReservation` | **FIXED round 61** — duplicate open bills |
| `EdcTerminalsCard.handleSubmit` | **FIXED round 62** — duplicate terminals |
| `ProvisioningFlow.handleSubmit` | **FIXED round 63** — device/location/owner created twice |
| `CreatePinScreen.handleSubmit` | safe — `disabled={loading \|\| …}` (:247), and the backend refuses a second PIN |
| `StaffLoginScreen.handleUsernameSubmit` | safe — `disabled={!username \|\| usernameChecking}` (:665) |
| `ShiftBar.handleStartShift` | safe — button guarded, and `start_inventory_shift` refuses a second active shift (`inventory.rs:393-408`), **already tested** (`inventory_tests.rs:197-204`) |
| `ThresholdConfigScreen.handleSave` | safe — the backend is an **upsert** (`inventory.rs:693-718`): the same input twice is the same state |
| `LicenseActivationScreen.handleActivate` | safe — see below |

## Why the last one is safe, in detail

`handleActivate` (:240) sets `loading` (:272) with no re-entry check, and the Activate
button is `disabled={loading || …}` (:971) — so the same form-path gap exists in principle.

What a double submit reaches, though, is `activateLicense` — a **remote HTTP POST to the
licence server** (`license_verification.rs:438-484`). It returns the signed response; it does
not INSERT a local row. The local side is one navigation (`onActivated()` at :319) and one
`refreshSubscription()`.

So a duplicate sends a second activation request to the server — which is the server's
idempotency question, not this component's. **No local record is created twice**, and no local
state is corrupted. Under the create-vs-set rule rounds 59-60 established, this is a `set`,
not a `create` — and adding a guard would prevent a duplicate network call while claiming
to fix a data defect, which is exactly the unverifiable "fix" round 59 refused to make.

## Why the sweep produced false positives

Round 63's detector looked for a guard as an **early `return`** in the handler — `if (x)
return;`. Three of the four fixes added exactly that shape, so the detector was trained on
the fixes. The three it wrongly flagged all guard differently: a flag the caller consumes
via `disabled=`/`loading=` on the button, with the form path unguarded but the button path
correct.

That limitation is worth naming: **a sweep cannot distinguish "unguarded" from "guarded by
a pattern the sweep does not know"**. Every candidate needs the hand check this round
performed, and a green sweep is never sufficient on its own.

## The checklist item, final form

> For any `<form onSubmit={async handler}>`, the handler needs its own re-entry check —
> `disabled` on the submit button cannot cover Enter.
>
> And check the handler's first write: if it CREATES, the guard is mandatory; if it SETS
> a value, the guard is a duplicate-network-call nicety, not a data defect.

Both halves are needed. The first caught four real defects; the second is what stopped this
round from "fixing" three safe forms.

## Status of the class

No remaining candidate. Every async `onSubmit` form in the codebase is either guarded in the
handler, guarded at the button with a backend that refuses duplicates, or an idempotent set.

## Related

- `edc-terminal-form-double-submit.md` (62) — the checklist rule.
- `provisioning-double-submit.md` (63) — the fourth instance, and the sweep that produced
  this triage.
- `void-double-fire-refused-server-side.md` (59) — the create-vs-set rule.

> last audited 11-10-26 by docs-auditor
