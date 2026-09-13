# Orchestrator Agent 3: Checkout UI, Dynamic QR & Card Terminal Flows

<!-- Audit stamp: 2026-09-13 · DSH · status: REPAIRED against HEAD · premises re-measured after agents-1 landed (e98f4ffe93, 08adf9fe8d, 9e143fc5ca). WHAT WAS WRONG: (1) "Inspect existing QrisQrDisplay.tsx" — no such file exists anywhere (target-file claim fabricated; `git ls-files ui/src/components | grep -i qris` empty). (2) "generateDynamicQrisScoped IPC API" — never existed and could not have: the cloud charge endpoint this order assumes is reachable was built a day AFTER this roadmap was written. It exists now (`9e143fc5ca`). (3) "GET /api/v1/payments/:id/status" — the polling target does not exist; the real ledger keys on the Midtrans `order_id`, not a payment id, and lives in cloud territory (agents-1's fence, not agent 3's). Rescoped as 3.1a below; `:id` colon syntax also panics at router build under axum 0.8 — braces only. (4) "QR expiration window (e.g. 15 minutes)" — Midtrans QRIS validity is 300 s (driver constant QRIS_EXPIRY_SECS; the 500 s figure would keep a dead QR on screen for a third of a minute of trust). (5) Phase 3.2 claimed the EDC UI was greenfield while ignoring that `edc_sale/edc_refund/edc_void/edc_terminal_status(_scoped)` ALL SHIPPED in `apps/desktop-client/src/commands/edc.rs` (with the rest of agents-2's driver tree, stamped 25dfa... era) — and simultaneously failing to notice the UI never calls any of them: zero `edc_` references in `ui/src/api`, so the commands are unwired exactly like the QRIS driver was. (6) The order never mentions the terminal-scoped visibility machinery that already exists (`local_payment.rs` get/set_local_payment_methods_scoped, keys `payment:qris-manual`/`payment:midtrans`/`payment:edc` per the master doc's config model) — the tabs must gate on it, not invent their own flag. What is TRUE: the modal does have a `'qris'` method today (manual: static QR + cashier confirmation), `qrcode.react` is already a dependency, and PaymentModal has a live test suite (PaymentModal.test / EdgeCases / SaleFlow) to extend. -->

**Document:** `todo-payment-agents-3.md` (repaired 09-13)
**Role:** Orchestrator Agent 3 (Payment Checkout Experience Architect)
**Goal:** Bring the shipped server and hardware halves to the cashier: dynamic QRIS tender (issue → render → countdown → poll → settle) and an EDC card flow that actually drives the terminal — both gated by the existing per-terminal payment-method config.

**Target layers & the real current state:**
- cloud `payment_api.rs` — charge + ledger DONE (agents-1); **status endpoint MISSING** → 3.1a.
- device IPC — `edc_*` DONE but UNWIRED; cloud-egress commands MISSING → 3.1b.
- `ui/` — QRIS-manual flow shipped; QRIS-Auto + EDC overlays MISSING; `QrisQrDisplay.tsx` to be CREATED (not inspected).

**Sibling Documents:**
- [`todo-payment-agents-1.md`](./todo-payment-agents-1.md) — server half: CLOSED 09-13 (`9e143fc5ca`, `3143b6a0b5`).
- [`todo-payment-agents-2.md`](./todo-payment-agents-2.md) — HAL half: absorbed except `test_edc_connection_scoped` (re-scope there if 3.2 wants a pre-flight check).

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(payment-ui): ...` for the UI slice, `feat(payment-cloud):` for 3.1a, `feat(desktop-client):`/bridge naming convention for 3.1b (each commit names its own area).
2. **Owned Path Fence:**
   - 3.1a: `apps/cloud-server/src/payment_api.rs` (+ tests, `openapi.rs`) — agents-1's files, handed over.
   - 3.1b: `crates/oz-bridge/src/` (new payment egress module), `apps/desktop-client/src/commands/`, `apps/tablet-client/src/commands/` — parity: register on BOTH clients or document the exemption in `scripts/verify-ipc-parity.py` (which the kds lane is actively editing — re-read before touching).
   - 3.1c/3.2: `ui/src/features/sales/PaymentModal.tsx`, NEW `ui/src/components/QrisQrDisplay.tsx`, NEW `ui/src/api/paymentGateway.ts`, tests, `.ftl` bundles.
3. **Forbidden:** `crates/oz-payment`, `crates/oz-hal` drivers (shipped, do not fork); `midtrans_ledger.rs` schema (extend read-only via the status handler).

---

## 📋 Task Checklist (honest decomposition)

### Phase 3.0: Baseline Audit
- [x] Inspect the REAL surface. → Done 09-13; findings in the stamp above (no QrisQrDisplay; edc_* unwired; local_payment gating exists; 300 s validity; PaymentModal test suite is the oracle).

### Phase 3.1a: Cloud status endpoint (prerequisite, was never scheduled anywhere)
- [x] `GET /api/payment/midtrans/{order_id}/status` (braces!), JWT-authed, tenant from claims; another tenant's order resolves as 404 exactly like an unknown one (no existence leak).
- [x] Response `{ order_id, status, settled }` straight off the ledger; charge response gains `expires_in_secs` (300, one source of truth for the UI countdown).
- [x] Spec + scope tests + `cargo test -p oz-cloud-server` green.

### Phase 3.1b: Device egress commands (the missing middle)
- [ ] Read how `commands/sync.rs`/ADR-49 bridge resolves cloud URL + API token; reuse, do not invent config.
- [ ] Bridge fn + scoped commands `qris_auto_charge_scoped` / `qris_auto_status_scoped` on BOTH clients (ipc-parity) with mock/offline error mapping; scoped naming per current convention; tests per client.
- [ ] Verify: `cargo check -p oz-pos-app` equivalents + the bridge test lane; `scripts/verify-ipc-parity.py` green (re-check its state first — kds lane edits it).

### Phase 3.1c: QRIS-Auto UI
- [ ] `paymentGateway.ts` api module (never `invoke` in components — AGENTS.md rule).
- [ ] NEW `QrisQrDisplay.tsx`: render `qr_string` via `qrcode.react`; countdown from `expires_in_secs` (5 min, NOT 15); expired state offers re-issue (same idempotency key = same live QR per PAY-2, so re-issue after expiry needs a fresh key — the UI owns that choice honestly).
- [ ] PaymentModal: QRIS tab consults `get_local_payment_methods_scoped` — `payment:midtrans` + online → Auto sub-flow; else current manual path unchanged (regression-guarded by the existing test suite).
- [ ] Poll with backoff (2 s→ cap ~10 s) `qris_auto_status_scoped`; on `settled` → trigger the existing manual-sync-now command so the queued `finalize_sale` lands immediately, then close with success; on expiry while unpaid → offer re-issue/cancel.
- [ ] i18n: every string via `@fluent/react`, keys in BOTH `.ftl` bundles (pre-commit bundle-parity + orphan gate will enforce).
- [ ] Gates: `npm run typecheck`, `npm run lint`, `npm run test` (PaymentModal suites + new QrisQrDisplay tests).
- [ ] **Commit Milestone:** `feat(payment-ui): dynamic QRIS tender with countdown and settlement polling`

### Phase 3.2: EDC card flow UI (was "integrate drivers" — drivers exist, the WIRE does not)
- [ ] `card` tender with `payment:edc` enabled → "Please tap/insert/swipe" overlay backed by `edc_sale_scoped` (long-running: surface its progress/timeout honestly; the mock fails closed per set_success — dev builds should demo well).
- [ ] Approved → attach gateway txn fields to the tender snapshot, complete the sale through the existing flow, print merchant+customer copies via existing receipt path; declined/cancelled → return to tender selection with the reason.
- [ ] Optional pre-flight `test_edc_connection_scoped` — decide WITH agents-2's residual rather than duplicating it.
- [ ] Gates: `npm run check:all`.
- [ ] **Commit Milestone:** `feat(payment-ui): wire EDC card flow to the shipped terminal commands`

---

## Residuals recorded during repair

- The webhook `finalize_sale` + sync-pull path is the SETTLEMENT mechanism; 3.1c's poll only *notices* it. If agents-3's UX needs instant settle confirmation without a sync round-trip, that is a design change (cloud→device push — no such transport exists; LAN `oz-lan` is kds territory now), not a missing checkbox.
- EDC commands are desktop-only today (no tablet `edc.rs` in the file list) — 3.1b parity must decide tablet's story explicitly, not inherit an accident.
