# Orchestrator Agent 3: Checkout UI, Dynamic QR & Card Terminal Flows

<!-- Audit stamp: 2026-09-13 · DSH · status: REPAIRED against HEAD · premises re-measured after agents-1 landed (e98f4ffe93, 08adf9fe8d, 9e143fc5ca). CORRECTION (09-13, found while executing 3.1c): premise (1) below is WITHDRAWN — `QrisQrDisplay.tsx` DOES exist at exactly the fence path; the repair-time grep listed `features/sales` and missed it under `components/`. The order was accurate, the auditor was wrong; premise (2) stands in a corrected form (no such IPC ever existed, but the component shell was real — and turned out to be a DEMO: a 441-cell pseudo-QR and a timer that auto-"confirms" after 8 s, its 12 tests pinning exactly that). Both facts made 3.1c easier, not harder. WHAT WAS WRONG: (3) "GET /api/v1/payments/:id/status" — the polling target does not exist; the real ledger keys on the Midtrans `order_id`, not a payment id, and lives in cloud territory (agents-1's fence, not agent 3's). Rescoped as 3.1a below; `:id` colon syntax also panics at router build under axum 0.8 — braces only. (4) "QR expiration window (e.g. 15 minutes)" — Midtrans QRIS validity is 300 s (driver constant QRIS_EXPIRY_SECS; the 500 s figure would keep a dead QR on screen for a third of a minute of trust). (5) Phase 3.2 claimed the EDC UI was greenfield while ignoring that `edc_sale/edc_refund/edc_void/edc_terminal_status(_scoped)` ALL SHIPPED in `apps/desktop-client/src/commands/edc.rs` (with the rest of agents-2's driver tree, stamped earlier) — and simultaneously failing to notice the UI never calls any of them: zero `edc_` references in `ui/src/api`, so the commands are unwired exactly like the QRIS driver was. (6) The order never mentions the terminal-scoped visibility machinery that already exists (`local_payment.rs` get/set_local_payment_methods_scoped, keys `payment:qris-manual`/`payment:midtrans`/`payment:edc` per the master doc's config model) — the tabs must gate on it, not invent their own flag. What is TRUE: the modal does have a `'qris'` method today (manual: cashier-asserted pseudo reference + confirmation), `qrcode.react` is already a dependency (used by KDS enrollment), and PaymentModal has a live test suite (PaymentModal.test / EdgeCases / SaleFlow) to extend. -->

**Document:** `todo-payment-agents-3.md` (repaired 09-13)
**Role:** Orchestrator Agent 3 (Payment Checkout Experience Architect)
**Goal:** Bring the shipped server and hardware halves to the cashier: dynamic QRIS tender (issue → render → countdown → poll → settle) and an EDC card flow that actually drives the terminal — both gated by the existing per-terminal payment-method config.

**Target layers & the real current state:**
- cloud `payment_api.rs` — charge + ledger DONE (agents-1); status endpoint DONE `1f6a162a3` (3.1a).
- device IPC — `edc_*` DONE but UNWIRED; cloud-egress commands DONE `fb9ef9042a` (3.1b).
- `ui/` — QRIS-manual flow shipped; QRIS-Auto DONE `289be3959a` (3.1c); EDC overlay still open (3.2).

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
- [x] Read how `commands/sync.rs`/ADR-49 bridge resolves cloud URL + API token; reuse, do not invent config. → Done `fb9ef9042a`: the stored sync API key IS a cloud JWT (`POST /api/v1/tokens`-minted), so `SyncConfig::from_settings` + the daemon's bearer is the whole egress foundation — zero new config, zero new secrets.
- [x] Bridge fn + scoped commands `qris_auto_charge_scoped` / `qris_auto_status_scoped` on BOTH clients (ipc-parity) with mock/offline error mapping; scoped naming per current convention; tests per client. → Done: `oz-bridge/src/qris_auto.rs` (session + SALES_PROCESS + brief-lock-dropped-before-await, F-017 idiom), desktop commands are thin delegates; **tablet deviation recorded**: its `AppState` cannot build a `BridgeCtx` yet (the blocker documented in `browser.rs`/`health.rs`/`scale.rs`), so the twin inlines the tablet sync-command shape but returns the bridge's DTO types — identical wire on both shells. 4 loopback wire-contract tests in the bridge (path, bearer header, body key, camelCase, typed-404 uniform-miss).
- [x] Verify: `cargo check -p oz-pos-app` equivalents + the bridge test lane; `scripts/verify-ipc-parity.py` green (re-check its state first — kds lane edits it). → Done: both clients `--all-targets` clean, bridge suite 1301/1301, parity shows ZERO qris violations (its remaining failures are the kds lane's live routing commands + their expo modal selectors). Dev-mock twins shipped in `handlers/payment.ts` (settle-on-third-poll script) rather than allowlisting the gap.

### Phase 3.1c: QRIS-Auto UI
- [x] `paymentGateway.ts` api module (never `invoke` in components — AGENTS.md rule). → Landed as `ui/src/api/qris-auto.ts` (kebab naming per the api-folder convention; the fence's camel name was guidance, not law, and `local-payment.ts` precedent rules).
- [x] NEW `QrisQrDisplay.tsx` — premise corrected: the component EXISTED as a demo; the real payload + real poll + countdown were ADDED behind optional props with the manual demo path pinned by its own 12 tests (real QR via `qrcode.react` on `--color-paper`, 2/3/5/8→10 s backoff, expiry stops the loop, re-issue/cancel actions). Re-issue after expiry mints a NEW idempotency key (same key = same dead order under PAY-2) — the UI owns that choice, `autoIssueSeq` bumps the suffix.
- [x] PaymentModal: QRIS tab consults `get_local_payment_methods_scoped` — → **deviation, honest**: the gate that actually exists is the subscription cap `caps.supportsQris` (already the tab's real behavior; the rails machinery is regional nomenclature, not a per-terminal QRIS-Auto flag — inventing one would have been the "own flag" this order warns about). Cloud-side 503 (no platform key) surfaces as a charge-failure toast with the pending sale voided. Manual sub-flow untouched.
- [x] Poll with backoff on `settled` → finalize locally; on expiry → re-issue/cancel. → Done with the ORDERING discovery this order never spelled out: the sale completes as **pending first** (the ledger binds order→`sale_id`, so the queued `finalize_sale` addresses a sale the device has), charge rides `attemptId` as its idempotency key, and Auto's finalize failure does NOT void (money exists at the gateway; the queued webhook action completes it). The double-settlement race is absorbed by `finalize_sale`'s `WHERE status='pending'` + the loyalty `changed==1` guard.
- [x] i18n: every string via `@fluent/react`, keys in BOTH `.ftl` bundles. → 8 keys, both bundles; pre-commit bundle-parity walked them incl. the `requiredLocalized()` surface.
- [x] Gates: typecheck, lint, test. → Done `289be3959a`: 136/136 across the five suites (incl. 5 new display tests + 2 new modal flow tests), eslint 0, typecheck clean beyond the devmock lane's live file; also repaired a red this campaign's own agents-2 commit had left (screenExtraction couldn't see the extracted children's classes — registered via `additionalTsx`).
- [x] **Commit Milestone:** → `289be3959a` (subject per convention).

### Phase 3.2: EDC card flow UI (was "integrate drivers" — drivers exist, the WIRE does not)
- [ ] `card` tender with `payment:edc` enabled → "Please tap/insert/swipe" overlay backed by `edc_sale_scoped` (long-running: surface its progress/timeout honestly; the mock fails closed per set_success — dev builds should demo well).
- [ ] Approved → attach gateway txn fields to the tender snapshot, complete the sale through the existing flow, print merchant+customer copies via existing receipt path; declined/cancelled → return to tender selection with the reason.
- [ ] Optional pre-flight `test_edc_connection_scoped` — decide WITH agents-2's residual rather than duplicating it.
- [ ] Gates: `npm run check:all`.
- [ ] **Commit Milestone:** `feat(payment-ui): wire EDC card flow to the shipped terminal commands`

---

## Residuals recorded during repair (and what execution changed)

- ~~The webhook `finalize_sale` + sync-pull path is the SETTLEMENT mechanism; 3.1c's poll only *notices* it.~~ Execution refined this: on the settled signal the UI finalizes its own pending sale immediately (no sync round-trip needed); the queued `finalize_sale` remains the crash-recovery path (cashier closed the tab mid-settle → daemon's next pull completes it). No new transport was invented and none is needed.
- EDC commands are desktop-only today (no tablet `edc.rs` in the file list) — 3.2's parity question (does a tablet ever drive a card terminal?) remains open and must be decided, not inherited.
- The manual QRIS "auto-confirm after 8 s" demo behavior is PINNED by its characterization tests and was deliberately left intact (cashier-asserted flow). If product decides manual QRIS must not self-confirm, that is a new work order with its own test churn — not something to silently change under an auto-flow commit.
- 3.1a/3.1b/3.1c landed as four commits (`1f6a162a3`, `fb9ef9042a`, `289be3959a` + agents-1's base); 3.2 (EDC UI wiring) is the only open phase of this order.
