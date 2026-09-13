# Orchestrator Agent 1: Cloud Gateway, Midtrans API & Webhooks

<!-- Audit stamp: 2026-09-13 · DSH · status: REPAIRED against HEAD · every premise below was re-measured, not carried over. WHAT WAS WRONG IN THE PREVIOUS REVISION: (1) "Create apps/cloud-server/src/payments/midtrans_client.rs" — the Midtrans Core-API client ALREADY EXISTS and is production-shaped: crates/oz-payment/src/drivers/qris.rs (charge/capture/refund/void, sandbox+prod base URLs, MIDTRANS_SERVER_KEY env read, caller idempotency keys honored since the 09-09 PAY-2 fix, HTTP bounded per COR-31, wiremock + recorded-fixture tests, and a module audit header that honestly documents the two-phase contract: sale() success means the QR was ISSUED, not settled). Creating a second client beside it would fork that hard-won edge-case handling. (2) "routes/payments.rs" — cloud-server has NO routes/ directory; it is a flat 47-file crate and API surfaces are per-domain modules (sync_api.rs, webhooks.rs, outbound_webhooks.rs, admin.rs) merged in main.rs; the fence named a structure that does not exist. (3) "tenant secret resolver" — every gateway already integrated here (Stripe, Square) uses ONE platform env key, and tenant attribution happens at webhook time via lookup_sale_by_gateway_reference over the gateway_reference, not at key time; a per-tenant Midtrans secret store would invent a column no sibling gateway has. USER-RATIFIED 09-13: platform key model + server-side issue-time payment row (see 1.1b). (4) The order's own Goal line asked for "asynchronous sale settlement reconciliation" and its checklist scheduled none. (5) The webhook signature is genuinely missing — crates/oz-payment/src/webhook.rs is a stub whose header says "PLANNED" — and webhooks.rs verifies Stripe + Square only; that half of the order stands. -->

**Document:** `todo-payment-agents-1.md` (repaired 09-13)
**Role:** Orchestrator Agent 1 (Payment Cloud Gateway Architect)
**Goal:** Expose the EXISTING Midtrans QRIS driver through `apps/cloud-server`: an authenticated charge endpoint that records the issued transaction server-side (so settlement can be reconciled even when the device syncs late), and a webhook receiver with real signature verification that drives `finalize_sale`.

**Target Crate:** `apps/cloud-server/src/` (consuming `crates/oz-payment` as a dependency — the driver itself is DONE and must not be re-written or forked)
**Sibling Documents:**
- [`todo-payment-agents-2.md`](./todo-payment-agents-2.md) (Agent 2 — HAL & EDC drivers; already stamped absorbed: the PAX/Ingenico/Verifone protocol stack shipped in `crates/oz-hal/src/drivers/edc/`)
- [`todo-payment-agents-3.md`](./todo-payment-agents-3.md) (Agent 3 — Checkout UI, Dynamic QR & Payment Polling; depends on THIS order's endpoint existing)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(payment-cloud): ...`
2. **Owned Path Fence (amended to match the real layout):**
   - `apps/cloud-server/src/payment_api.rs` (NEW — charge endpoint, named after the `sync_api.rs` convention, not `routes/payments.rs`)
   - `apps/cloud-server/src/webhooks.rs` (third provider alongside stripe/square — keep the CS-1 constant-time discipline)
   - `apps/cloud-server/src/main.rs` (router merge lines only)
   - `apps/cloud-server/src/openapi.rs` (spec entries for the new paths — the suite pins them)
   - `apps/cloud-server/Cargo.toml` (add `oz-payment` dependency — nothing depends on it today)
3. **Forbidden Paths:**
   - DO NOT edit `crates/oz-payment/src/drivers/qris.rs` (the driver is absorbed, audited, and tested; if an edge case blocks integration, record it here instead of editing).
   - DO NOT edit `crates/oz-hal/src/drivers/edc/` (Agent 2), `PaymentModal.tsx` or UI files (Agent 3).
   - ⚠️ The sync lane is active on other cloud-server files (`sync_store_tests.rs`, `init.pg.sql`) — pathspec commits only, never anything under their fences.

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [x] Inspect Midtrans references in `todo-payment.md`. → Done 09-13. Master doc: QRIS Auto = Midtrans, online-only, secrets cloud-side (design :107 `POST /api/payment/midtrans/qris` — that endpoint does not exist yet; this order creates it).
- [x] Review existing webhook handlers in `apps/cloud-server/src/webhooks.rs`. → Done 09-13. Stripe+Square only; template identified: `verify_*_signature` (constant-time per CS-1), `square_event_already_processed` (idempotency), `lookup_sale_by_gateway_reference`, `enqueue_finalize_sale` (sqlite+pg arms). `crates/oz-payment/src/webhook.rs` is a PLANNED stub — do not trust it as done.

### Phase 1.1: Charge Endpoint Over the Existing Driver (was "implement client")
- [ ] Add `oz-payment` as a cloud-server dependency (workspace path dep already declared at root).
- [ ] Create `payment_api.rs`: `POST /api/payment/midtrans/qris` on the sync_api auth stack (`auth_middleware` → tenant from JWT claims, never body; `rate_limit_middleware`), body = amount (minor units, `Money` discipline) + optional `idempotency_key`; response = `{ order_id, qr_string, ... }` from `QrisPaymentProcessor::sale`'s honest two-phase contract (QR ISSUED ≠ settled — the response must say so, per PAY-6).
- [ ] **1.1b (user-ratified deviation):** the charge writes a server-side pending payment row keyed by the Midtrans `order_id` + tenant from claims — without it, a webhook arriving before the device's sync push finds no `gateway_reference` and the payment silently falls on the floor (the race this order never scheduled).
- [ ] OpenAPI spec entries for the new path (401 documented; `{param}` braces if any path param — `:id` panics at router build).
- [ ] Verify: `cargo test -p oz-cloud-server payment`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-cloud): expose Midtrans QRIS charge endpoint over the existing oz-payment driver" -- apps/cloud-server/src/payment_api.rs ...
  ```

### Phase 1.2: Webhook Receiver & Signature Verification (unchanged — genuinely open)
- [ ] Add `POST /api/webhooks/midtrans` to `webhooks.rs`.
- [ ] Verify `signature = SHA512(order_id + status_code + gross_amount + server_key)` — decode provided hex and constant-time verify (CS-1 pattern; Midtrans signs over CONCATENATED FIELDS, not the raw body, unlike Stripe/Square — do not copy their preimage).
- [ ] On `settlement`/`capture` → resolve the payment via the 1.1b row / `gateway_reference`, then `enqueue_finalize_sale`; on `expire`/`cancel` → record status, do NOT enqueue.
- [ ] Idempotency: duplicate notifications must not double-enqueue (mirror `square_event_already_processed`).
- [ ] Unmatched `order_id` → accept-with-log (Midtrans retries notifications; a 5xx invites hammering), never settle on an unverifiable body.
- [ ] Verify: `cargo test -p oz-cloud-server payments`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-cloud): verify Midtrans webhook signatures and drive finalize_sale idempotently" -- apps/cloud-server/src/webhooks.rs ...
  ```

### Phase 1.3: Reconcile
- [ ] Stamp master `todo-payment.md` QRIS-Auto sections as shipped (with SHAs) so no sibling re-plans them.
- [ ] Report residuals honestly; dynamic-QR polling/backoff + checkout UI remain agents-3's dispatch.

---

## Open questions recorded during the repair (not blockers)

- **Per-tenant merchant accounts** (one MIDTRANS_SERVER_KEY vs a store of them): deferred by D1 to the platform model. If a tenant ever needs its own account, that is a schema + resolver change across ALL gateways, not a Midtrans-only one.
- **`qr_string` vs `SCAN_QR|` message encoding**: the driver returns a pipe-joined string in `PaymentResult.message`; `payment_api.rs` should parse it at the boundary and hand the UI a JSON object — but if the driver exposes structured fields elsewhere (check during 1.1), prefer those over string parsing.
