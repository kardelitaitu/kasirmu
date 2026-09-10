# Orchestrator Agent 1: Cloud Gateway, Midtrans API & Webhooks

**Document:** `todo-payment-agents-1.md`  
**Role:** Orchestrator Agent 1 (Payment Cloud Gateway Architect)  
**Goal:** Implement server-side Midtrans Core-API integration, dynamic QRIS generation endpoints, webhook signature verification (`SHA512`), and asynchronous sale settlement reconciliation in `apps/cloud-server`.

**Target Crate:** `apps/cloud-server/src/`  
**Sibling Documents:**
- [`todo-payment-agents-2.md`](./todo-payment-agents-2.md) (Agent 2 — Hardware Abstraction Layer & LAN EDC Drivers)
- [`todo-payment-agents-3.md`](./todo-payment-agents-3.md) (Agent 3 — Checkout UI, Dynamic QR & Payment Polling)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(payment-cloud): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/cloud-server/src/payments/` (NEW)
     - `midtrans_client.rs`
     - `webhook_receiver.rs`
     - `signature.rs`
   - `apps/cloud-server/src/routes/payments.rs` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `crates/oz-hal/src/drivers/edc/` (Owned by Agent 2).
   - DO NOT edit `PaymentModal.tsx` or UI files (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Inspect Midtrans references in `todo-payment.md`.
- [ ] Review existing webhook handlers in `apps/cloud-server/src/webhooks.rs`.

### Phase 1.1: Implement Midtrans Client & Charge API
- [ ] Create `apps/cloud-server/src/payments/midtrans_client.rs`.
- [ ] Implement `POST /v2/charge` for QRIS (reads `qr_string` response).
- [ ] Support server key injection via environment variable and tenant secret resolver.
- [ ] Verify unit tests pass with mock HTTP server.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-cloud): implement Midtrans Core-API client and QRIS charge endpoint"
  ```

### Phase 1.2: Implement Webhook Receiver & Signature Verification
- [ ] Create `/api/webhooks/midtrans` endpoint.
- [ ] Verify `signature_key = SHA512(order_id + status_code + gross_amount + serverKey)`.
- [ ] Drive sale settlement and trigger `finalize_sale` transition upon `settlement` or `capture` status.
- [ ] Add idempotency check to prevent duplicate settlement callbacks.
- [ ] Verify: `cargo test -p oz-cloud-server payments`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-cloud): implement Midtrans webhook receiver and SHA512 signature validation"
  ```
