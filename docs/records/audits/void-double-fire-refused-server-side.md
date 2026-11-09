# The three "unguarded" write handlers are guarded server-side — and one guard was unpinned

**Date:** 2026-10-11 · **Round:** 59 (session) · **Status:** VERIFIED SOUND + REGRESSION-GUARDED
**Area:** `crates/kasirmu-core/src/db/sales_tests.rs` (new test);
`crates/kasirmu-core/src/db/sales_lifecycle.rs`, `fiscal.rs`, `kasirmu-bridge/src/settings.rs` (verified)

## What I set out to fix

Round 58 left three UI handlers open as suspected double-invocation defects:
`handleSettleCredit` (`RetailPosScreen.tsx:1504`), `handleVoid` (`VoidOrdersScreen.tsx:194`),
and `handleIssueTaxInvoice` (`PaymentModal.tsx:1760`) — each sets a busy flag that is never
wired to `disabled`, so a second press inside one await reaches the handler.

## What the audit found instead

**All three are idempotent or guarded at the backend.** The UI can double-fire; the write
cannot double-apply:

| Site | Backend behaviour |
|---|---|
| `settle_credit_scoped` (`settings.rs:638-662`) | `UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'` — setting a timestamp twice is the same state. Idempotent by outcome. |
| `void_sale` (`sales_lifecycle.rs:878-914`) | three layers: a pre-check `status != Active → Validation`, a compare-and-set `WHERE id = ?2 AND status = 'active'` inside an IMMEDIATE transaction, and `rows == 0 → Conflict` + rollback. |
| `issue_tax_invoice_for_sale` (`fiscal.rs:516`) | already explicitly tested idempotent — `issue_tax_invoice_for_sale_claims_number_and_is_idempotent` (`fiscal_tests.rs:588`) asserts a re-issue returns the SAME number without consuming another counter. |

So the three rounds-58 leads are **not defects**, and I did not "fix" them. Adding UI
guards would have been harmless but unverifiable — the failure it prevents cannot occur.

## The gap that WAS real

`void_sale`'s guard is tested twice — `void_sale_only_active_can_be_voided` and
`void_sale_completed_cannot_be_voided` (`sales_tests.rs:753, 765`) — but **neither pins the
re-void**: the shape a double-clicked Void button actually produces. Those two cover a
PENDING sale and a COMPLETED sale; the already-VOIDED sale was unasserted.

That matters because the void path WRITES as well as updates: an audit entry with action
`sale.void` (`:922-930`) and a transactional-outbox row (`:944`).
`void_sale_writes_one_void_outbox_row` (`sales_lifecycle_tests.rs:234`) pins the FIRST
one; a duplicate on a re-void would append a second audit trail entry — the record a
dispute is settled from — even though the money effect is nil.

## The new test

`void_sale_refuses_a_second_void_and_writes_no_extra_audit_row`:

1. creates a sale, moves it Active, voids it once;
2. asserts the audit counter is **> 0** (liveness — see below);
3. re-voids and requires `Validation { field: "status" }`;
4. asserts the audit count is **unchanged**.

## Evidence

**Invert-probe (the round-58 technique).** Asserting the re-void *succeeds* fails with:

```
PROBE: re-void outcome = Err(Validation { field: "status",
  message: "only active sales can be voided (current: Voided)" })
```

So the assertion measures the guard rather than passing vacuously.

**Kill-test.** Relaxing the pre-check to `if false && ...` made the test fail — and
revealed the defence in depth is real: the compare-and-set still refused, reporting
`Conflict { entity: "sale", field: "version" }`. Two independent layers, both effective.

**Liveness caught two bugs in my own test.** The `audit_after_first > 0` assertion —
added because an equality check against zero proves nothing — failed twice:

- first the query used `action = 'void'`; the real string is `sale.void`
  (`sales_lifecycle.rs:924`);
- then it used `entity_id`; the column is `target_id`
  (`migrations/20260813_init.sql:43`).

Both would have shipped as a green test asserting `0 == 0`.

- `cargo test -p kasirmu-core --lib void_sale_refuses_a_second_void` — passes
- `kasirmu-core` lib suite — no regressions

## Why this is worth recording

Eight rounds of this campaign have produced fixes. This one produced a **verified
non-finding** and a test that closes a real coverage gap, and both halves are worth the
record. A ledger of only fixes would imply these three leads were defects that got
repaired, when the truth is that the backend already refused them — and that the one
unpinned guard was fixed by *asserting* it, not by changing it.

## Related

- `close-shift-enter-during-in-flight-close.md` (58) — where these three were listed as
  open, and where the invert-probe technique was established.
- `retail-hold-double-click-two-writes.md` (57) — a genuine double-invocation defect, found
  because `holdCartScoped` appends a NEW row rather than updating one in place. That is the
  distinguishing test for this whole class: **does the write create, or does it set a
  value?** A create can duplicate; a set cannot.

> last audited 11-10-26 by docs-auditor
