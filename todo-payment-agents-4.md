# TODO — payment epic: absorption inventory & remaining backlog (agents-4)

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE AFTER REPAIR (rev 2 — extends the stamp below, supersedes none of it) · 12 corrections (the 9 numbered below, plus R4's interim-default-terminal evidence, R7's re-measured stub line counts, and the canonical-status declaration added under "Genuinely open"): (1) MAJOR, in R1 — this doc claimed "no online signal exists in the UI (measured)". Too strong. Measured on disk: `ui/src/hooks/useGatewayStatus.ts` answers `{name, configured, online}` (:5-9, `online` read at :61) by polling `getGatewayStatus` every 60 s, and online state also lives in `usePaymentConnection.ts`, `useKdsOffline.ts` and `ConnectionStatus.tsx`. The narrower true statement is that the CHECKOUT consumes none of it (`PaymentModal.tsx`: 0 matches for `online|useGatewayStatus`), so that leg is UNWIRED, not unbuildable — the next worker starts from a hook that already ships. (2) open_bill's "(doc :152-158)" pointed into the mermaid flow diagram; the decision text is `todo-payment.md:202-208`. (3) desktop rails commands span `local_payment.rs:41` (get) and `:62` (set) with the file ending at :77 — not ":41-69". (4) the settings card lives at `features/settings/screens/`, not `features/settings/`. (5) the QR alias is `#[serde(default, alias = "qr_string")]` on `qr_code_url: Option<String>` at `crates/oz-payment/src/drivers/qris.rs:136-137`. (6) "the modal test suites exist and are green" downgraded to a file/case count — greenness is a runtime observation this pass did not make. (7) the agents-1 row now carries CODE anchors because its closing commit `3143b6a0b` is DOCS-ONLY (it touches `todo-payment-agents-1.md` and `todo-payment.md` and nothing else): a docs commit proves the doc moved, not that the route exists. (8) NAMING TRAP worth repeating, because both paths live in the same file pair and are easy to conflate: OUR charge route is `POST /api/payment/midtrans/qris` (`payment_api.rs:99`); `/v2/charge` (`crates/oz-payment/src/drivers/qris.rs:435`) is the UPSTREAM Midtrans path, and `payment_api_tests.rs:47` mocks that upstream, not us. (9) charge 200 = QR ISSUED, not PAID (`openapi.rs:573-577`); settlement is async. · POLICY: the per-item R1-R7 verdicts are declared CANONICAL over the absorbed-table and RESULT restatements. · METHOD: read/grep against the working tree only; NO git command was available in this pass, so the "11/11 cited SHAs exist" below is carried from the manager's `git cat-file` sweep (71/71 repo-wide) rather than re-derived here. Sibling `todo-payment.md` still resolves at the repo root. -->

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
crates/oz-hal/src/drivers/mock.rs` can complete a sale), which the Phase-4 absorbed row
glossed and R4 assumed away. Added as R7; the absorbed row now carries
the qualification. A box-by-box audit of claims catches lies; it does
not catch true-but-misleading summaries — R7 was visible only by
reading the stub's own doc comment, which no checkbox asked for. -->

## Absorbed — do not re-open

| Master doc line(s) | What actually happened |
|---|---|
| Phase 0 keys + TerminalFeatureOverride | Rails shipped end-to-end: `get/set_local_payment_methods_scoped` on BOTH clients (desktop `apps/desktop-client/src/commands/local_payment.rs:41` get / `:62` set, file ends :77; tablet `apps/tablet-client/src/commands/local_payment.rs:29` get / `:46` set), `ui/src/api/local-payment.ts` (110 lines), settings UI (`ui/src/features/settings/screens/LocalPaymentSettingsCard.tsx`, `.css` alongside). The `crate::feature_key`-namespace variant was SUPERSEDED by this model. |
| Phase 0 EDC device list | `edc_terminals` table + `crates/oz-core/src/db/edc_terminals.rs` + boot-time `platform_startup::hardware::register_card_terminals` wired in both `lib.rs` (desktop `apps/desktop-client/src/lib.rs:203` - moved off :200-201 by 09-15 - , tablet `apps/tablet-client/src/lib.rs:146`) with a `BootstrapReport`. |
| Phase 1 cash constant | True as designed; nothing was ever needed. |
| Phase 2 manual confirm | Shipped twice over: `handleQrConfirmed` (3.1c builder/settle) + the cashier-assert button (`09eec83868`) which killed the demo auto-confirm. |
| Phase 3 charge/status/webhook/ledger | The whole agents-1 + agents-3 chain: `9e143fc5ca` ledger, `1f6a162a3` status, `fb9ef9042a` egress, `289be3959a` UI. Secrets cloud-side as decided (:34 rule). **CODE-BACKED, re-measured 09-14** (agents-1's closing commit `3143b6a0b` is docs-only, so the SHAs alone prove nothing): our charge route is `POST /api/payment/midtrans/qris` -> `qris_charge_handler` (`apps/cloud-server/src/payment_api.rs:99`, `:153`), status is `GET /api/payment/midtrans/{order_id}/status` (`:100-103`), the router mounts at `main.rs:688-689`, and settlement lands on `POST /api/webhooks/midtrans` (`webhooks.rs:73`, handler `:860`, `settle_like` rule `:920`) through the `midtrans_transactions` ledger (`midtrans_ledger.rs`, settlement-must-win at :185-187). HTTP 200 on charge = QR ISSUED, not PAID (`openapi.rs:573-577`). Pinned by named tests in `payment_api_tests.rs`: :80 charge_returns_qr_and_journals_issuance, :120 requires_bearer_token, :138 requires_tenant_scoped_token, :153 validates_body_before_any_gateway_call, :181 fails_closed_without_server_key, :195 gateway_error_is_502. |
| "QR field qr_string vs qr_code_url" | Practically resolved: the driver field is `qr_code_url: Option<String>` with `#[serde(default, alias = "qr_string")]` (`crates/oz-payment/src/drivers/qris.rs:130`, `08adf9fe8d`; re-anchored 09-15 - the alias sits at :152 now (`grep -nF 'alias = "qr_string"'`), :136-137 is `order_id`; the field comment at :130-135 says the alias was found wiring the cloud charge endpoint) — it ingests both. This is the UPSTREAM wire shape: Midtrans' `/v2/charge`, not our route, which is `POST /api/payment/midtrans/qris`. Sandbox confirmation remains as evidence debt, not code debt. |
| PAY-1/PAY-2/PAY-3/PAY-7/PAY-8 + COR-31 | Fixed per the driver's own stamps (2026-07-25, 2026-09-09). |
| Phase 4 registry/trait/lifecycle boxes | agents-2 shipped the driver tree; agents-3's `1a0277548f` moved bodies to `oz-bridge`; the modal wired it (`26ffd89c1c`). The doc's illustrative `edc_sale(terminal_id, Money)` snippet is STALE — the shipped wire is `edc_sale(session_token, amount_minor, currency)` single-default-terminal. **Qualification added by the 09-14 follow-up audit: "the driver tree landed" means the SKELETON landed — `crates/oz-hal/src/drivers/edc/{wired,wireless}.rs` and `crates/oz-hal/src/drivers/edc/protocol/{pax,ingenico,verifone}.rs` are all fail-closed PLANNED stubs (`HalError::Unsupported`; measured wired.rs:4/:12-14, wireless.rs:4/:7, pax.rs:4/:7), and the boot factory (`platform/startup/src/hardware.rs:213`) faithfully registers stubs. The only terminal that can answer a sale today is the dev MOCK. No real card-present sale is possible until the protocol handler lands — that item was NOT named here at first; it is R7 below.** |
| Phase 5 flows + tests | cash / QRIS manual / QRIS Auto / EDC terminal all have sections now; the modal suites exist — `ui/src/__tests__/PaymentModal.test.tsx`, `PaymentModalSaleFlow.test.tsx`, `PaymentModalEdgeCases.test.tsx` (27 + 27 `it(`/`test(` lines in the first two, anchored pattern counted with rg). **Greenness NOT re-verified by this pass**: no test command was run here, so the earlier "are green" is downgraded to "exist". |
| webhook strategy, default acquirer, server-key env, poll-vs-webhook | RULED 2026-09-07 and/or already implemented per the ruling (re-fetch webhook landed with agents-1). |

## Genuinely open — the real remainder, ranked

> **Which list is canonical (decided 2026-09-14).** This document is the
> **single status authority** for the payment epic, and the per-item verdicts in
> this section — the R1–R7 headings with their own CLOSED/OPEN lines — are
> **CANONICAL**. The "Absorbed — do not re-open" table above and the
> "Execution proposal — RESULT" paragraph at the end are **SUBORDINATE
> restatements** of the same set: they summarize, they do not decide. Where the
> three disagree, this section wins and the other two get corrected.
> (`todo-payment.md` is the research artifact, not a status surface; its own
> open-set line is being aligned to "R4–R7" by its owner.)

### R1 · The modal ignores the rails it owns — DONE (`bffcbda97a`)
CLOSED 2026-09-14 with one premise correction made BY MEASUREMENT during
execution: the `payment:qris-manual/:midtrans/:edc` keys this doc's R1
text inherited from the master model **never existed in code** — the
real surface is the regional slice-6 rail store (`rail_code: qris`,
`edc`, …). The checkout now reads it (`useLocalPaymentRails`): QRIS tab
and EDC button defer to `is_enabled`, fail-open on unknown/empty, with
5 tests in R1's own gating (the block at `PaymentModalSaleFlow.test.tsx:1042-1216`
now carries 7 `it(` cases — the five rails gates at :1087/:1101/:1113/:1127/:1148
plus the two static-payload cases R2 added at :1166/:1202).
The "online-capable" third leg of the master formula is NOT implemented — but
the reason this line first gave was wrong, and is corrected by measurement: it
claimed **no online signal exists in the UI**. One does. `ui/src/hooks/useGatewayStatus.ts`
answers `{name, configured, online}` (:5-9, `online` read at :61) by polling
`getGatewayStatus` every 60 s, and online state also lives in
`usePaymentConnection.ts`, `useKdsOffline.ts` and `ConnectionStatus.tsx`. The
narrower true statement is that **the checkout consumes none of it**:
`PaymentModal.tsx` has 0 matches for `online|useGatewayStatus`. So the leg is
UNWIRED, not unbuildable-from-nothing — whoever picks it up extends a hook that
already ships. That is the one honest part of R1's original text still open.

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
Single implicit terminal ships; `crates/oz-core/src/db/edc_terminals.rs`'s own header says
"commands should take a terminal_id once more than one terminal is
configured" (`crates/oz-core/src/db/edc_terminals.rs:5`, re-read 09-14). Wire it + dropdown +
per-sale routing WHEN a second terminal is real; until then R1's flag is the
honest gate. The interim default is an alias, not a design: the boot comment at
`platform/startup/src/hardware.rs:203-212` binds the first active row to
`DEFAULT_TERMINAL_ID` because `edc_terminals` has no `is_default` column, so
"which terminal is this register's" is answered by creation order.
(Priority note from the 09-14 follow-up audit: "real" is doing quiet
work in that sentence — see R7; no terminal of ANY count is real yet.)

### R7 · No real EDC hardware driver — the first-pass inventory's blind spot
FOUND BY THE 2026-09-14 follow-up audit, not by the box-by-box pass this
doc records. Every layer of the EDC chain shipped except the one that
touches money-holding hardware: the protocol handlers behind
`crates/oz-hal/src/drivers/edc/wired.rs`, `crates/oz-hal/src/drivers/edc/wireless.rs` and `crates/oz-hal/src/drivers/edc/protocol/{pax,ingenico,verifone}.rs` are all documented PLANNED stubs failing closed with
`HalError::Unsupported`, so `edc_sale` on real hardware returns
Unsupported — only `crates/oz-hal/src/drivers/mock.rs` (fails closed until `set_success`,
dev builds only) can complete a sale. The wiring, IPC, UI, ledger shape
and rail gating are all done and correct; the socket protocol is not.
`crates/oz-hal/src/drivers/edc/wired.rs` names it in its own next-line names it: "serial/USB protocol handler".
This is bigger than R4 (which assumes a first real terminal exists) and
smaller than the epic's "landed" headline admits. Status: OPEN — needs
real hardware or vendor protocol documentation to implement against;
the stubs failing closed is the honest placeholder until then. Re-measured
09-14, re-checked 09-15 at HEAD `718dbe8e4`: `crates/oz-hal/src/drivers/edc/wired.rs` (112 lines, its header says `crate: oz-hal`) and `crates/oz-hal/src/drivers/edc/wireless.rs` (132) plus
`crates/oz-hal/src/drivers/edc/protocol/{pax,ingenico,verifone}.rs` (46 lines each; all three unique in the tree - `git ls-files -- *pax.rs` etc. return one path each) all say PLANNED in their
own headers, and `crates/oz-hal/src/drivers/mock.rs` is the only EDC that can answer — it fails
closed until `set_success()` (:506, message at :544).

### R5 · Resilience cluster (fallback chain, breaker, reconciliation job)
`crates/oz-payment/src/registry.rs::build_from_config` remains a documented PLANNED stub
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
- open_bill as tender — resolved: park action, not a tab (`todo-payment.md:421`, the section headed "### open_bill / credit reconciliation"; re-anchored 09-15 BY TITLE - the 09-14 anchor :202-208 now lands inside a block-quote of owner questions — the old ":152-158" landed inside the mermaid flow diagram, not the decision).
- credit/AR — still TBD by design; the union carries the label, no flow.
- SnapBi, Node BFF, cloud-stored device secrets — ruled NO.

## Execution proposal — RESULT

*(Subordinate summary — the R1–R7 verdicts in "Genuinely open" above
are canonical; this paragraph only restates them.)*

Proposed: agents-5 = R1+R2. **Executed** 2026-09-14 (`bffcbda97a` +
`903b30a718`), both boxes ticked above with their premise corrections
recorded where the claims were made. R3 was then closed by the same
order (`3d50b3ac5a`). **R4-R7 stay open** as written; R5 still requires
its own design doc before any boxes; R7 (the real EDC protocol handler,
found by the follow-up audit that also corrected the stale "R3-R6"
count in this paragraph) needs hardware or vendor protocol docs before
ANY code can honestly be written for it.

> last audited 14-09-26 by docs-auditor

## Acceptance — what a run could and could not decide here (2026-09-15, read-only audit at HEAD `1f83ab903`)

- **The file is a queue; a sweep that counts checkbox tokens will not see it.** `wc -l < todo-payment-agents-4.md` → **175** · open boxes `grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' todo-payment-agents-4.md` → **0** · ticked, same form with `\[[xX]\]` → **0** — **but** `grep -cE '^### R[0-9]' todo-payment-agents-4.md` → **7** rows, of which `grep -cE '^### R[0-9].*DONE'` → **3** are closed with their SHAs (R1 `bffcbda97a`, R2 `903b30a718`, R3 `3d50b3ac5a`), leaving **R4–R7 open**, which is what `:169` already says. The rows are carried as `### R·` headings with `CLOSED` and `Status: OPEN` lines (`:133`), not as checkboxes, so a zero from a checkbox grep is one grep's output and not the absence of a queue. The command count moves the same way with the pattern: **0** hits for `npm run|npx |vitest|cargo |python |exit 0|check:all|verify-`, **3** once `git ` is included — `:137` runs `git ls-files -- *pax.rs` to prove a uniqueness point.
- **Verdict: NOT OBSERVABLE as this file's acceptance command, and the reason is written in the rows themselves.** R6 at `:150` is "Evidence debt (un-doable from this checkout) … they need credentials and a merchant account, not code" (`:154`); R7 at `:122` records "Status: OPEN — needs real hardware or vendor protocol documentation to implement against" (`:133`); R4 at `:110` is deliberately deferred until "a second terminal is real"; R5 at `:141` says "do NOT start without per-item design passes" (`:147`). Four open rows, none of which a run in this checkout can close, so no command can honestly be named as *the* verdict and none is staged here as one. **Consequence under `AGENTS.md` §4: `done-payment-agents-4.md` is unreachable by any run, so these rows must be split or retired rather than “completed”** — R5 becomes a design doc plus sized boxes each carrying its own command; R7 becomes a sized plan whose acceptance is one sale completed against named hardware, which CI cannot supply, so its honest state is owner-parked; R4 and R6 are **parked-on-a-human-ruling** in §4's own vocabulary and belong in a dated header line, not in a prefix.
- **One narrow proxy does exist, runs here, and is failing today — pasted, not asserted.** R7's live claim is that five EDC layers are PLANNED stubs, so the check a stranger can re-run is: `N=$(grep -l -i PLANNED crates/oz-hal/src/drivers/edc/{wired.rs,wireless.rs,protocol/pax.rs,protocol/ingenico.rs,protocol/verifone.rs} | wc -l); [ "$N" -eq 0 ]`. Measured at `1f83ab903`: all five paths exist, `stubs still saying PLANNED: 5 of 5`, `R7 GATE: FAIL`, exit **1**. Read it for exactly what it covers and no more — a green would mean the word PLANNED has left five headers, which is **necessary and not sufficient** for R7, because the sufficient condition is a codec that completes a sale on real hardware and nothing in this checkout can observe that. It grades one row's own evidence, not the file. No heading is ticked by this section, nothing is renamed, no line above it is deleted, and no ruling is taken on R4–R7.
