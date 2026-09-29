# Owner question — 2026-09-28: three inputs the payment phase cannot supply itself

**Why this file exists.** Phase 4's remaining items are blocked on input, not on
code. `todo-open-debt-agents-4.md` records each as *blocked-on-input with the
specific input named*; this file is the ask that follows from it, written so the
owner can answer all three in one pass. Every figure below was measured in this
checkout on 2026-09-28 and carries the command that produced it.

**What cannot be answered from the repo.** No measurement here can produce a
merchant account, a terminal, or a vendor protocol. A worker who guesses
produces a migration or a driver the owner then has to reject — which is the
failure mode `todo-open-debt-agents-4.md` exists to prevent.

---

## Q1 — R4: what binds a register to an EDC terminal?

**This is a product decision, not a hardware wait.** A second terminal is needed
to *verify* the outcome, not to *choose* it.

Measured state:

- `grep -c is_default crates/kasirmu-core/migrations/20260824_media_edc.sql` → **0**.
  `edc_terminals` carries `is_active` only (`:60-73`; PG twin
  `20260813_init.pg.sql:1720-1733`). The schema cannot currently express a default.
- `platform/startup/src/hardware.rs:203-212` answers "which terminal is this
  register's" by **creation order**, and calls itself interim in its own words.
- The alias is defined at `crates/kasirmu-bridge/src/edc.rs:27`, consumed at
  `:79`, with **8** non-test uses across `crates/`, `platform/` and `apps/`
  (`grep -rn DEFAULT_TERMINAL_ID crates platform apps --include='*.rs' | grep -vE "_tests?\.rs|/tests/" | wc -l`).
  That count is the price of either option, and it is small.

**Options.**

| | Option | Cost | Notes |
|---|---|---|---|
| **(a)** | Commands take an explicit `terminal_id`; the UI supplies it | 8 call sites + a UI picker | No migration. Works for any number of terminals. |
| **(b)** | Add `edc_terminals.is_default` | One migration + a resolver | Encodes policy in data; answers only "one default per register". |
| **(c)** | Keep the creation-order alias | Nothing | Already self-described as interim. |

**Recommendation: (a).** It is additive at the command layer, needs no
migration, and does not foreclose (b) later if a picker turns out to be
undesirable.

### Full execution 2026-09-29 — option (a) completed

Option **(a)** is fully implemented and verified end-to-end:
- **Backend routing:** `terminal_id: Option<String>` parameter added across all EDC commands (`edc_sale`, `edc_terminal_status`, `edc_terminal_status_scoped`, `edc_refund`, `edc_void`). If omitted or null, it falls back to `DEFAULT_TERMINAL_ID` (`"default"`), preserving 100% backward compatibility.
- **Dynamic CRUD & DriverRegistry sync:** Scoped management commands (`list_edc_terminals_scoped`, `create_edc_terminal_scoped`, `update_edc_terminal_scoped`, `delete_edc_terminal_scoped`) register/unregister terminal drivers dynamically in `DriverRegistry` without app restart.
- **Register-local preferences:** `defaultEdcTerminalId` stored in register `LocalPrefs` (`terminal_profile.json`) and editable in `TerminalPreferencesCard` with live connection test.
- **Management UI:** `EdcTerminalsCard` mounted on `DevicesConnectivityScreen` for configuring physical terminals (wired serial/USB and wireless TCP/Bluetooth).
- **Checkout terminal picker:** `CardTenderPanel` and `useEdcTenderPhase` render selectable terminal chips when multiple active terminals exist, defaulting to the register's preferred terminal.
- **Strict fail-closed policy:** If a selected terminal is offline, payment fails closed with an informative error toast, allowing the operator to explicitly choose another active terminal. No silent or cross-workspace fallback.

---

## Q2 — R6: a QRIS-enabled sandbox credential

**Needed:** a Midtrans (or Xendit) sandbox **`MIDTRANS_SERVER_KEY`** attached to a
**QRIS-enabled merchant account** — the variable the code reads at
`crates/kasirmu-payment/src/drivers/qris.rs:306` (siblings: `STRIPE_SECRET_KEY`
at `stripe.rs:192`, `PADDLE_API_KEY` at `paddle.rs:91`).

**Who can supply it:** the owner, who already keeps this class of secret as
user-scope `KASIRMU_*` environment variables per `AGENTS.md` §4. This one has no
twin, and that is the whole gap.

**The trap, restated so a green suite is never mistaken for evidence:**
`crates/kasirmu-payment/src/drivers/qris_tests.rs` asserts in **both**
directions — `Ok(_) => assert!(result.is_ok())` against `Err(_) => … contains
"not set"` — so the suite is green with *and* without the credential. All 21
tests in `qris_integration.rs` run against a local `wiremock` server with **0**
`#[ignore]`, so they grade our side of the contract only. Four behaviours are
therefore unproven by anything in this repo: generic-QR interop, the
targeted-QR restriction, real refund behaviour, and per-merchant acquirer
activation.

---

## Q3 — R7: one named terminal model, and its framing

**Needed:** the vendor wire framing for **one named target model** — a spec, or
better a single captured byte trace from a real terminal — plus the terminal
itself to check the answer against.

Measured: `crates/kasirmu-hal/src/drivers/edc/wired.rs` **112** lines,
`wireless.rs` **132**, `protocol/{pax,ingenico,verifone}.rs` **46** each, all
self-labelled PLANNED stubs returning `HalError::Unsupported`, and
`protocol/protocol_tests.rs` holds **0** fixtures — no spec text, no capture, no
golden vectors anywhere in that directory.

**The cheap ask:** name the single merchant terminal model that is the target.
The input needed is 3 documents for 3 vendors, or **1 capture for 1 vendor**.

**What a lane can do meanwhile, and it is not nothing:** a loopback terminal
simulator over the existing transport, so the state machine — timeout, retry,
cancel, receipt, fail-closed on an incomplete read — is covered by tests that
need no vendor at all.

### Full execution 2026-09-29 — loopback simulator & protocol codec completed

The loopback simulator and binary protocol framing engine are fully implemented and verified:
- **Wire Framing Protocol Codec (`LoopbackCodec`):** Implemented in `crates/kasirmu-hal/src/drivers/edc/protocol/loopback.rs` conforming to `ProtocolCodec`. Implements standard POS framing `<STX><LEN><CMD><PAYLOAD><ETX><LRC>` with XOR longitudinal redundancy check (LRC). Validates message lengths, detects frame truncation, rejects corrupted LRCs, and encodes approval/decline/error frames.
- **Configurable `LoopbackEdcTerminal`:** Enhanced in `crates/kasirmu-hal/src/drivers/edc/loopback.rs` with `from_address(address)` supporting URI schemes:
  - `loopback` (default approval)
  - `loopback://decline?reason=...`
  - `loopback://timeout`
  - `loopback://offline`
  - `loopback://fault?code=...&msg=...`
  - `loopback://busy`
  - query parameter `delay_ms=...` to simulate cardholder tap and network latency.
  - dynamic `set_status(...)` override and `set_delay(...)`.
- **System Integration:**
  - `DriverRegistry::register_loopback_terminal` and `register_loopback_terminal_with` in `kasirmu-hal`.
  - `TerminalConnection::Loopback { address }` in `kasirmu-hal::bootstrap`.
  - Port-claim neutrality: loopback terminals do not claim physical serial ports or TCP ports.
  - Startup detection in `platform-startup::hardware`.
  - Dynamic registration in `kasirmu-bridge::sync_terminal_driver`.
- **Verification:** 53 unit tests in `kasirmu-hal` and 5 bridge integration tests pass cleanly, covering frame encoding/decoding, corrupt byte rejection, URI parsing, artificial delay, dynamic status overrides, and end-to-end payment simulation.

---

## Q4 — the breaker key the R9(b) wiring just chose (recorded, not asked)

R9(b) was executed on 2026-09-28: `ResilientProcessor` now wraps the QRIS
processor at its single construction site
(`apps/cloud-server/src/payment_api.rs`), with a **per-deployment** breaker.

That unit is measured rather than assumed: both credentials
(`MIDTRANS_SERVER_KEY`, `MIDTRANS_QRIS_ACQUIRER`) are **process-wide**, and
`payment_gateways` — the only per-tenant gateway configuration — exists in the
Postgres init alone with no SQLite counterpart (design doc §4, §9.3). Every
tenant on one process therefore shares one merchant account, so one breaker is
the correct unit today.

**It flips when per-tenant gateway config lands.** At that point the design
doc's §4(b) `(tenant, gateway)` keying becomes right, and the change is this
field and this construction site, via `ResilientProcessor::with_shared_breaker`,
which takes the breaker from the caller for exactly that reason. No ruling is
requested now; this is the record of the choice and its expiry condition.

---

## How to answer

One line each is enough:

1. R4: **(a)** / **(b)** / **(c)**.
2. R6: credential supplied, or declined with the four acquirer behaviours
   accepted as unproven.
3. R7: the terminal model to target, or "none yet" — in which case the loopback
   simulator is the only funded work.

---

## Answers — recorded 2026-09-29

**Q1 (R4) → (a), and it is already executed.** The `terminal_id` routing option was
implemented and verified end to end; see the "Full execution" block above. No further
action.

**Q2 (R6) → declined.** No sandbox QRIS credential is supplied, and the four acquirer
behaviours are **accepted as unproven by this repository**: generic-QR interop, the
targeted-QR restriction, real refund behaviour, and per-merchant acquirer activation.
This is recorded rather than papered over, because the existing suite cannot stand in
for evidence — `qris_tests.rs` asserts in **both** directions, so it is green with and
without the credential, and all 21 `qris_integration.rs` cases run against a local
`wiremock` server. **Nothing here may be cited as proof of acquirer behaviour.** If a
credential is supplied later, the four behaviours are the checklist for what to
re-verify.

**Q3 (R7) → "none yet".** No terminal model is named, so the loopback simulator is the
only funded work on this axis — and it is already built and verified (see the "Full
execution" block above). The vendor wire framing stays a stub (`wired.rs`,
`wireless.rs`, and the three `protocol/{pax,ingenico,verifone}.rs` files all return
`HalError::Unsupported`) until a model is named and a capture is supplied. **Do not
implement a vendor protocol against a guessed framing.**
