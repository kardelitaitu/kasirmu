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
