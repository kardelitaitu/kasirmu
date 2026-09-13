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
not a triage queue. Claim-first-measure twice.

FOLLOW-UP AUDIT (same day, after agents-5 closed R1-R3): this doc's own
anchors were re-measured — 11/11 cited SHAs exist; qris.rs:321/:317,
registry.rs:57-67, local_payment.rs:41/:29 and the :200/:146 lib.rs
wiring all resolve exactly as cited (the qris.rs line survives its own
path move to src/drivers/). Two findings: (1) the RESULT paragraph still
said "R3-R6 stay open" after R3 closed — fixed; (2) MAJOR — the Pass-1
claim "the genuine remainder is small enough to name exactly" was wrong
in the direction that matters: no EDC driver is REAL (wired, wireless
and all three protocol codecs are fail-closed PLANNED stubs; only
drivers/mock.rs can complete a sale), which the Phase-4 absorbed row
glossed and R4 assumed away. Added as R7; the absorbed row now carries
the qualification. A box-by-box audit of claims catches lies; it does
not catch true-but-misleading summaries — R7 was visible only by
reading the stub's own doc comment, which no checkbox asked for. -->

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
| Phase 4 registry/trait/lifecycle boxes | agents-2 shipped the driver tree; agents-3's `1a0277548f` moved bodies to `oz-bridge`; the modal wired it (`26ffd89c1c`). The doc's illustrative `edc_sale(terminal_id, Money)` snippet is STALE — the shipped wire is `edc_sale(session_token, amount_minor, currency)` single-default-terminal. **Qualification added by the 09-14 follow-up audit: "the driver tree landed" means the SKELETON landed — `drivers/edc/{wired,wireless}.rs` and `protocol/{pax,ingenico,verifone}.rs` are all fail-closed PLANNED stubs (`HalError::Unsupported`; measured wired.rs:4/:12-14, wireless.rs:4/:7, pax.rs:4/:7), and the boot factory (`platform/startup/src/hardware.rs:213`) faithfully registers stubs. The only terminal that can answer a sale today is the dev MOCK. No real card-present sale is possible until the protocol handler lands — that item was NOT named here at first; it is R7 below.** |
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

### R3 · Typed error classification (Resilience C) — DONE (`3d50b3ac5a`)
CLOSED 2026-09-14, and its recorded precondition was itself wrong: the
claim that the bridge must "surface HalErrorKind through to the UI
payload (partially true)" understated reality — BOTH clients already
reject every command with the tagged `{kind, subKind, message}` union
(desktop + tablet `error.rs`, camelCase DTO), and `parseAppError` already
decodes it. What was missing was never plumbing: the shared boundary
classifier (`classifyRetry`, ERR-06) had ZERO screen consumers while
PaymentModal kept a private substring scan of the same question. The
modal now delegates; the scan's genuinely-transport patterns and its
terminal-wins-over-transport precedence migrated INTO the shared
fallback; 'try again' was deliberately NOT migrated (it appears in this
module's own NON-retryable user copy — scanning for it once made the
checkout offer Retry on the strength of its own fallback text). Proof
tests in both directions: hardware Timeout saying "declined" → Retry
appears; internal saying "timeout" → Retry absent.

### R4 · Multi-terminal EDC
Single implicit terminal ships; `db/edc_terminals.rs`'s own header says
"commands should take a terminal_id once more than one terminal is
configured". Wire it + dropdown + per-sale routing WHEN a second
terminal is real; until then R1's flag is the honest gate.
(Priority note from the 09-14 follow-up audit: "real" is doing quiet
work in that sentence — see R7; no terminal of ANY count is real yet.)

### R7 · No real EDC hardware driver — the first-pass inventory's blind spot
FOUND BY THE 2026-09-14 follow-up audit, not by the box-by-box pass this
doc records. Every layer of the EDC chain shipped except the one that
touches money-holding hardware: the protocol handlers behind
`drivers/edc/wired.rs`, `wireless.rs` and `protocol/{pax,ingenico,
verifone}.rs` are all documented PLANNED stubs failing closed with
`HalError::Unsupported`, so `edc_sale` on real hardware returns
Unsupported — only `drivers/mock.rs` (fails closed until `set_success`,
dev builds only) can complete a sale. The wiring, IPC, UI, ledger shape
and rail gating are all done and correct; the socket protocol is not.
`wired.rs`'s own next-line names it: "serial/USB protocol handler".
This is bigger than R4 (which assumes a first real terminal exists) and
smaller than the epic's "landed" headline admits. Status: OPEN — needs
real hardware or vendor protocol documentation to implement against;
the stubs failing closed is the honest placeholder until then.

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
recorded where the claims were made. R3 was then closed by the same
order (`3d50b3ac5a`). **R4-R7 stay open** as written; R5 still requires
its own design doc before any boxes; R7 (the real EDC protocol handler,
found by the follow-up audit that also corrected the stale "R3-R6"
count in this paragraph) needs hardware or vendor protocol docs before
ANY code can honestly be written for it.

> last audited 14-09-26 by docs-auditor
