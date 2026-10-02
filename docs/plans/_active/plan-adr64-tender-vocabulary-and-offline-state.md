# Plan: ADR-64 Tender Vocabulary and Offline Tender State

**Status:** Active  
**Date:** 2026-10-02  
**Recorded against:** branch `0.0.41`  
**Governing ADR:** [ADR-64 (The Tender Vocabulary and the Offline Tender State)](../../decisions/2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md)  
**Related Plans:** [`docs/plans/_active/payment-methods-plan.md`](./payment-methods-plan.md), [`docs/plans/_active/payment-resilience-design.md`](./payment-resilience-design.md)  

---

## 1. Goal

Implement the technical decisions of **ADR-64 (D1–D6)** to turn payment methods into an enforceable closed set, decouple presentation enums from database persistence, eliminate the dual-meaning boolean `PaymentResult`, and establish a 7-stage state machine for offline electronic tenders.

---

## 2. Work Breakdown & Phases

### Phase 1: SQLite Schema Migration (ADR-64 D1 & D5)
- [ ] Author SQLite migration `crates/kasirmu-core/migrations/YYYYMMDD_payments_method_check.sql`:
  - Rebuild `payments` table with explicit CHECK constraint on `method`:
    ```sql
    CHECK (method IN (
      'cash', 'card', 'card_debit', 'card_credit',
      'qris_manual', 'qris', 'bank_transfer', 'ewallet',
      'open_bill', 'credit', 'pay_later', 'other'
    ))
    ```
  - Backfill existing rows: map any unrecognized method string to `'other'`.
  - Add CHECK constraint on `payment_gateways.status` / `payments.gateway_status`:
    ```sql
    CHECK (gateway_status IN (
      'pending', 'authorized', 'confirmed', 'settled',
      'failed', 'refunded', 'chargeback'
    ))
    ```
- [ ] Run `python3 scripts/generate-pg-migration.py` to keep PostgreSQL replica schema in exact parity.
- [ ] Register migration in `crates/kasirmu-core/src/migrations.rs`.

### Phase 2: Type System Decoupling & Vocabulary Alignment (ADR-64 D2)
- [ ] Document and constrain `foundation::PaymentMethod`:
  - Retain `Cash`, `Card`, `Other(String)` for coarse wire presentation.
  - Document that DB persistence requires mapping to the 12 canonical closed-set strings.
- [ ] Align `kasirmu_payment::PaymentMethod`:
  - Add doc comments clarifying it as a presentation/processor interface rather than the system of record.
- [ ] Deduplicate & align TypeScript frontend unions:
  - Extract `type CanonicalPaymentMethod` into `ui/src/api/types/payment.ts`.
  - Update `ui/src/features/sales/PaymentModal.tsx` and `ui/src/features/sales/payment/SplitTenderRows.tsx` to consume the single shared type.

### Phase 3: Two-Phase PaymentResult (ADR-64 D3)
- [ ] Refactor `PaymentResult` in `crates/kasirmu-payment/src/types.rs`:
  - Replace ambiguous `success: bool` with explicit enum or phase status:
    - Phase 1: `Issued` (e.g. Dynamic QR generated, pending customer scan).
    - Phase 2: `Confirmed` (e.g. Webhook received or cashier manual acknowledgement).
- [ ] Update `crates/kasirmu-payment/src/drivers/qris.rs` to emit `Issued` on initial intent and `Confirmed` on settlement.

### Phase 4: Offline Electronic Tender State Machine (ADR-64 D4 & D6)
- [ ] Introduce `TenderState` enum in `crates/kasirmu-payment/src/tender_state.rs`:
  - Variants: `Pending`, `Authorized`, `Confirmed`, `Settled`, `Failed`, `Refunded`, `Chargeback`.
- [ ] Remove `ErrorClass::Deferred` usage for pending payments in `crates/kasirmu-payment/src/error.rs`:
  - Pending payments are an expected lifecycle state, not an infrastructure error.
- [ ] Invariant enforcement (D6): Software-only non-custodial rule — offline tenders (cash, static QR, store credit) never require an active gateway credentials row.

---

## 3. Verification & Acceptance Criteria

Execute the acceptance command suite chained:

```bash
cargo test -p kasirmu-core --test migration_tests && cargo test -p kasirmu-payment && cd ui && npm run check:all
```

- **Acceptance 1:** `payments.method` rejects any value outside the 12 closed-set members on `INSERT`.
- **Acceptance 2:** `cargo test -p kasirmu-payment` passes with the 7-state tender lifecycle.
- **Acceptance 3:** Frontend `PaymentModal.tsx` and `SplitTenderRows.tsx` pass TypeScript checks and Vitest tests against the unified vocabulary.
