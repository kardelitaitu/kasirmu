# Plan: ADR-64 Tender Vocabulary and Offline Tender State

**Status:** Active  
**Date:** 2026-10-02  
**Recorded against:** branch `0.0.41`  
**Governing ADR:** [ADR-64 (The Tender Vocabulary and the Offline Tender State)](../../decisions/2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md)  
**Related Plans:** [`docs/plans/_active/payment-methods-plan.md`](./payment-methods-plan.md), [`docs/plans/_active/payment-resilience-design.md`](./payment-resilience-design.md)  
**Technical Spec:** [`docs/specs/_active/account-locked-residency-and-market-profile.md`](../../specs/_active/account-locked-residency-and-market-profile.md)  

---

## 1. Goal

Implement the technical decisions of **ADR-64 (D1–D6)** to turn payment methods into an enforceable closed set, decouple presentation enums from database persistence, eliminate the dual-meaning boolean `PaymentResult`, and establish a 7-stage state machine for offline electronic tenders.

---

## 2. Audit-Hardened Work Breakdown & Phases

### Phase 1: SQLite Schema Migration & Index Rebuild (ADR-64 D1 & D5)
- [ ] Author SQLite migration `crates/kasirmu-core/migrations/YYYYMMDD_payments_method_check.sql`:
  - **Foreign Key Safety:** Must use `PRAGMA defer_foreign_keys = ON;` during table rebuild so active sales references do not fail mid-transaction (following precedent `20260928_document_kind_check.sql`).
  - **Method CHECK Constraint:**
    ```sql
    CHECK (method IN (
      'cash', 'card', 'card_debit', 'card_credit',
      'qris_manual', 'qris', 'bank_transfer', 'ewallet',
      'open_bill', 'credit', 'pay_later', 'other'
    ))
    ```
  - **Backfill Strategy:** Pre-update any legacy method outside the 12 closed members to `'other'` before applying the CHECK:
    ```sql
    UPDATE payments SET method = 'other' WHERE method NOT IN (...);
    ```
  - **Gateway Status CHECK Constraint:**
    ```sql
    CHECK (gateway_status IN (
      'pending', 'authorized', 'confirmed', 'settled',
      'failed', 'refunded', 'chargeback'
    ) OR gateway_status IS NULL)
    ```
  - **Index Reconstruction:** Explicitly recreate `idx_payments_idempotency_key` and `idx_payments_sale_id` on the swapped table.
- [ ] Run `python3 scripts/generate-pg-migration.py` to re-sync `crates/kasirmu-core/migrations/20260813_init.pg.sql` (Pre-commit Step 5 drift guard).
- [ ] Register migration in `crates/kasirmu-core/src/migrations.rs`.

### Phase 2: UI Localization Parity & Frontend Union Unification (ADR-64 D2)
- [ ] **FTL Localization Parity (Pre-commit Step 2 Guard):**
  - Add missing tender message IDs to both `shared-ui/locales/shared.ftl` and `shared-ui/locales/shared.id.ftl`:
    - `payment-method-card-debit`
    - `payment-method-card-credit`
    - `payment-method-qris-manual`
    - `payment-method-bank-transfer`
    - `payment-method-ewallet`
    - `payment-method-pay-later`
  - Verify with `scripts/verify-bundle-parity.py` that 0 missing keys exist.
- [ ] **Type Union Unification:**
  - Define canonical `type PaymentMethod` in `ui/src/api/types/payment.ts`.
  - Update `PAYMENT_METHOD_MESSAGE_IDS: Record<PaymentMethod, string>` in `ui/src/features/sales/PaymentModal.tsx` to map all 12 variants.
  - Eliminate duplicated `SplitRowMethod` in `ui/src/features/sales/payment/SplitTenderRows.tsx` by consuming `PaymentMethod`.

### Phase 3: Type System Decoupling (ADR-64 D2)
- [ ] Document and bound `foundation::PaymentMethod`:
  - Retain `Cash`, `Card`, `Other(String)` purely for coarse IPC/transport presentation.
  - Document that DB persistence requires mapping to the 12 canonical closed-set strings.
- [ ] Document `kasirmu_payment::PaymentMethod` as a processor driver interface, not a DB persistence authority.

### Phase 4: Two-Phase PaymentResult & Gateway Fallback Fix (ADR-64 D3 & D4)
- [ ] **Refactor `PaymentResult` in `crates/kasirmu-payment/src/types.rs`:**
  - Replace ambiguous boolean `success` with phase status:
    - `Issued` (e.g. Dynamic QR generated, awaiting customer scan).
    - `Confirmed` (e.g. Webhook received or cashier manual acknowledgement).
- [ ] **Fix Gateway Fallback Bug:**
  - In `crates/kasirmu-payment/src/registry.rs:151-157`, remove `ErrorClass::Deferred` as a fallback retry trigger. A deferred/pending payment is an active intent, not an infrastructure failure that should try the next gateway.
- [ ] **Offline electronic tender lifecycle:**
  - Introduce `TenderState` enum: `Pending`, `Authorized`, `Confirmed`, `Settled`, `Failed`, `Refunded`, `Chargeback`.
  - Enforce software-only non-custodial invariant (D6): cash, static QR, and customer tabs complete without gateway credentials rows.

---

## 3. Verification & Acceptance Criteria

Execute the acceptance suite chained:

```bash
cargo test -p kasirmu-core --test migration_tests && cargo test -p kasirmu-payment && cd ui && npm run check:all
```

- **Acceptance 1:** `payments.method` rejects any value outside the 12 closed-set members on `INSERT`.
- **Acceptance 2:** Existing test suite passes with `PRAGMA defer_foreign_keys = ON;` and indexes intact.
- **Acceptance 3:** `cargo test -p kasirmu-payment` passes with two-phase QR issuance.
- **Acceptance 4:** Frontend `npm run typecheck` and `npm run lint` pass with 100% FTL bundle parity across English and Indonesian locales.
