# TODO — payment epic: absorption inventory & remaining backlog (agents-4)

<!-- Audit stamp: 2026-09-14 · DSH · status: MEASURED against HEAD after the
epic closed (agents-1..3 + `09eec83868`). Method: every open box in
todo-payment.md was re-tested with git grep against the code, not against
memory. The master doc is a research artifact written BEFORE the epic;
roughly half its boxes have since shipped (many under other commits than
the order that planned them), several were SUPERSEDED by decisions the
epic made on the wire, and the genuine remainder is small enough to name
exactly. Numbers below are file:line at this commit, not recollections.

One near-miss worth keeping in the record: the driver's findings header
still lists "PAY-1 HIGH parse_amount unwrap_or(0)" — an almost-claimed
live money bug. It is HISTORY: parse_amount now returns
`Result<i64, PaymentError>` (qris.rs:321, the zeroing quoted at :317 is
the comment describing the OLD defect). The header is a stale ledger,
not a triage queue. Claim-first-measure twice. -->

## Absorbed — do not re-open

| Master doc line(s) | What actually happened |
|---|---|
| Phase 0 keys + TerminalFeatureOverride | Rails shipped end-to-end: `get/set_local_payment_methods_scoped` on BOTH clients (desktop `commands/local_payment.rs:41-69`, tablet :29), `ui/src/api/local-payment.ts`, settings UI (`LocalPaymentSettingsCard.tsx`). The `crate::feature_key`-namespace variant was SUPERSEDED by this model. |
| Phase 0 EDC device list | `edc_terminals` table + `db/edc_terminals.rs` + boot-time `platform_startup::hardware::register_card_terminals` wired in both `lib.rs` (desktop :200, tablet :146) with a `BootstrapReport`. |
| Phase 1 cash constant | True as designed; nothing was ever needed. |
| Phase 2 manual confirm | Shipped twice over: `handleQrConfirmed` (3.1c builder/settle) + the cashier-assert button (`09eec83868`) which killed the demo auto-confirm. |
| Phase 3 charge/status/webhook/ledger | The whole agents-1 + agents-3 chain: `9e143fc5ca` ledger, `1f6a162a3` status, `fb9ef9042a` egress, `289be3959a` UI. Secrets cloud-side as decided (:34 rule). |
| "QR field qr_string vs qr_code_url" | Practically resolved: the driver field is `qr_code_url` with `#[serde(alias = "qr_string")]` (`08adf9fe8d`) — it ingests both. Sandbox confirmation remains as evidence debt, not code debt. |
| PAY-1/PAY-2/PAY-3/PAY-7/PAY-8 + COR-31 | Fixed per the driver's own stamps (2026-07-25, 2026-09-09). |
| Phase 4 registry/trait/lifecycle boxes | agents-2 shipped the driver tree; agents-3's `1a0277548f` moved bodies to `oz-bridge`; the modal wired it (`26ffd89c1c`). The doc's illustrative `edc_sale(terminal_id, Money)` snippet is STALE — the shipped wire is `edc_sale(session_token, amount_minor, currency)` single-default-terminal. |
| Phase 5 flows + tests | cash / QRIS manual / QRIS Auto / EDC terminal all have sections now; the modal test suites exist and are green. |
| webhook strategy, default acquirer, server-key env, poll-vs-webhook | RULED 2026-09-07 and/or already implemented per the ruling (re-fetch webhook landed with agents-1). |

## Genuinely open — the real remainder, ranked

### R1 · The modal ignores the rails it owns — DONE (`bffcbda97a`)
CLOSED 2026-09-14 with one premise correction made BY MEASUREMENT during
execution: the `payment:qris-manual/:midtrans/:edc` keys this doc's R1
text inherited from the master model **never existed in code** — the
real surface is the regional slice-6 rail store (`rail_code: qris`,
`edc`, …). The checkout now reads it (`useLocalPaymentRails`): QRIS tab
and EDC button defer to `is_enabled`, fail-open on unknown/empty, with
5 tests. The "online-capable" third leg of the master formula is NOT
implemented because **no online signal exists in the UI** (measured) —
inventing one was out of order scope; it remains the one honest part of
R1's original text still open.

### R2 · Manual QRIS still renders a DEMO QR grid — DONE (`903b30a718`)
CLOSED 2026-09-14: the 441-cell pseudo-QR is deleted, not hidden. The
merchant's static EMVCo string now lives in the qris rail's parameters
bag (`static_qr_payload` — market metadata, the credential guard already
protects this bag), is editable in the settings card, reaches the
manual dialog's REAL-QR branch, and the unconfigured state says so
plainly while keeping the cashier-assert path. The 441-cell pin retired
with the grid it pinned.

### R3 · Typed error classification (Resilience C)
`classifyError` still string-matches English messages
(`PaymentModal.tsx:201-203`) while the backend returns typed `kind`s.
Delete-the-string-match has a precondition the doc missed: the bridge
must surface `HalErrorKind`/`PaymentError` variants through to the UI
error payload (partially true — `plainErrorMessage` flattens them today).

### R4 · Multi-terminal EDC
Single implicit terminal ships; `db/edc_terminals.rs`'s own header says
"commands should take a terminal_id once more than one terminal is
configured". Wire it + dropdown + per-sale routing WHEN a second
terminal is real; until then R1's flag is the honest gate.

### R5 · Resilience cluster (fallback chain, breaker, reconciliation job)
`registry.rs::build_from_config` remains a documented PLANNED stub
(:57-67 fails closed); no `method -> Vec<processor>` chain, no
`ResilientProcessor`, no expiry/reconciliation job (pending-sale cleanup
currently relies on cashier cancel + webhook). The basket-preservation UX
is half-done (errors keep the modal open; there's no offered fallback).
Largest remaining slice; cloud+crate blast radius; do NOT start without
per-item design passes.

### R6 · Evidence debt (un-doable from this checkout)
Sandbox probe (generic-QR interop, targeted-QR restriction, refund
behavior, per-merchant acquirer activation). These gate final answers on
R1's acquirer config and the qr-string naming; they need credentials and
a merchant account, not code.

## Explicitly NOT part of any phase (decided elsewhere)
- open_bill as tender — resolved: park action, not a tab (doc :152-158).
- credit/AR — still TBD by design; the union carries the label, no flow.
- SnapBi, Node BFF, cloud-stored device secrets — ruled NO.

## Execution proposal — RESULT

Proposed: agents-5 = R1+R2. **Executed** 2026-09-14 (`bffcbda97a` +
`903b30a718`), both boxes ticked above with their premise corrections
recorded where the claims were made. R3-R6 stay open as written; R5
still requires its own design doc before any boxes.
