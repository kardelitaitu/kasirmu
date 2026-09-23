# Payment resilience — the design the code was written before

**Status:** design doc, first draft. **Not** an ADR — nothing here is decided by a lane.
**Author's brief:** `todo-open-debt-program.md` Phase 4 box `:276`, *"an R5 design doc"*. Owner ruling: **R9** in `todo-owner-rulings.md`.
**Provenance:** every measurement below was taken in this checkout at HEAD `cd638e98f` (2026-09-18). Each is paired with the command that produced it, so a reader checks rather than trusts.
**Sibling records:** `docs/plans/payment-methods-plan.md` (the method/rail configuration this decorates), `docs/records/audit-open-findings.md` (the `BR-*` findings), `crates/kasirmu-payment/src/resilience.rs` (the code this describes).

---

## 0. Why this doc exists, and the inversion it is here to correct

The box asked for this doc and asserted there was *"no `ResilientProcessor`"*. **The code landed; the doc did not.** That is the inversion the box was written to prevent, and it changes what this document is: not a design preceding an implementation, but a design that **audits one already shipped and unwired**.

| | State, measured |
|---|---|
| `ResilientProcessor`, `CircuitBreaker` (Closed/Open/HalfOpen), `ResilientProcessorConfig` | **implemented** — `crates/kasirmu-payment/src/resilience.rs`, 256 lines |
| re-exported | **yes** — `crates/kasirmu-payment/src/lib.rs:70` |
| `method -> Vec<processor>` chain | **implemented** — `register_method_fallback` / `method_processors` / `execute_with_fallback`, `crates/kasirmu-payment/src/registry.rs:57-119` |
| **wired into any dispatch path** | **no** — `grep -c "resilience\|Resilient" crates/kasirmu-payment/src/registry.rs` → **0** |
| **any production caller** | **no** — §1.1 |
| a live design doc | **none before this file** — `grep -rliE 'ResilientProcessor\|circuit.?breaker' docs/` → `docs/archived/manager-2-journal.md` and this document |

**The finding that frames every decision below: the production payment path does not use the registry at all.** Measured:

```bash
grep -rn "execute_with_fallback\|register_method_fallback\|ResilientProcessor" \
  --include=*.rs crates/ platform/ apps/ | grep -v "registry.rs\|resilience"
# → 4 hits, ALL in crates/kasirmu-payment/src/registry_tests.rs
```

So the entire fallback-and-resilience layer is **test-only today**, and its three green tests (`resilient_processor_retries_transient_error_and_succeeds`, `resilient_processor_does_not_retry_terminal_error`, `circuit_breaker_trips_and_fails_fast`) are evidence that it compiles and that its author's model of it is self-consistent — not that the payment path is protected. It is not.

**An unwired resilience decorator is the worst of the three states.** Wired, it buys fault isolation. Deleted, it buys nothing and costs nothing. Unwired, it carries the full maintenance cost of shipped code, invites a reader to believe money is protected, and defers every decision below to whoever wires it, with no doc to check it against. That is the state today, and it is why R9 recommends *write the doc, then wire it* rather than *leave it*.

---

## 1. What actually runs, and where

### 1.1 The production surface is one endpoint

There is exactly **one** place in the tree where a `PaymentRequest` is built outside the payment crate's own internals or its tests:

```bash
grep -rn "PaymentRequest {" --include=*.rs crates/ platform/ apps/ | grep -vE "_tests?\.rs|/tests/"
# → crates/kasirmu-payment/src/drivers/square.rs:72, :364   (Square's own request DTO + its builder)
#   crates/kasirmu-payment/src/types.rs:43                  (the struct definition)
#   apps/cloud-server/src/payment_api.rs:239                ← the one production construction
```

That site is the QRIS charge endpoint, and it is decisive for this whole document:

- **It holds a concrete driver, not a registry entry.** `AppState.processor: Option<QrisPaymentProcessor>` (`payment_api.rs:79`), built by `build_qris_processor` (`:132-135`). **`PaymentProcessorRegistry` is not involved.** Wiring the decorator into the registry — the obvious reading of *"wire it"* — would therefore protect **nothing** in production.
- **It calls `sale`.** `processor.sale(&request)` at `:251`. `sale` is exactly one of the methods `ResilientProcessor` retries.
- **The gateway key is optional and caller-supplied.** `idempotency_key: body.idempotency_key.clone()` (`:246`) — straight off the HTTP body, so it may be `None`.
- **`sale_id` is required.** `if body.sale_id.trim().is_empty() { … "sale_id is required" }` (`:222-224`), and it is already carried as `reference: Some(body.sale_id.clone())` (`:244`).

### 1.2 The three pieces, and the seam between them

**(a) The chain** — `execute_with_fallback(method, operation)`. Walks `method -> Vec<Arc<dyn PaymentProcessor>>` in order. On an error it inspects `err.classify()` and **escalates to the next processor unless the class is `Terminal`** — with one carve-out, `PaymentError::Unsupported`, which escalates despite classifying terminal (`registry.rs:107`). Returns the last error if the chain exhausts.

**(b) The decorator** — `ResilientProcessor`. Wraps **one** `Arc<dyn PaymentProcessor>`. On a `Transient` error it retries up to `max_retries` with exponential backoff, then records a failure against its own `CircuitBreaker`. On `Open` it fails fast without calling the inner processor.

**(c) The breaker** — one `CircuitBreaker` per `ResilientProcessor` instance, and **unkeyed**: a single `(state, consecutive_failures, opened_at)` triple.

`ErrorClass` is the shared vocabulary — `Transient | Terminal | Deferred` (`crates/kasirmu-payment/src/error.rs:14-23`). Both mechanisms branch on it and **they branch differently**: the chain escalates on anything that is not `Terminal`; the decorator retries only on `Transient`. That asymmetry is correct and worth preserving, but nothing states it, so it reads as an oversight in both files.

### 1.3 A name collision that must be read before touching any key

Two different fields are called `idempotency_key`, they mean different things, and the codebase has already been bitten by the confusion:

| Field | Scope | Guarded by | Absent means |
|---|---|---|---|
| `PaymentSplitArg.idempotency_key` | the local **`payments` row** | `stamp_attempt_split_keys` (`crates/kasirmu-bridge/src/pos.rs:1152`) + `UNIQUE INDEX idx_payments_idempotency_key` (`20260813_init.sql:1204`, `.pg.sql:2804`) + the `20261001_sale_idempotency` table | **unguarded, and deliberately legal** |
| `PaymentRequest.idempotency_key` | the **gateway** dedupe key | nothing — the driver mints a fresh one per call | **no dedupe: a retry is a second charge** |

`crates/kasirmu-core/migrations/20261001_sale_idempotency.sql:18` states the first contract in as many words: *"Absent, empty and whitespace-only are all UNGUARDED. Those rows store NULL, and NULL is distinct in a SQL unique index in both engines, so it never matches: **unbounded unguarded sales per tenant stay legal**."* And `:20` names the second one as a precedent it deliberately does **not** reuse: *"idx_payments_idempotency_key on payments is the tenant-blind precedent this index deliberately does NOT reuse."*

**Consequence for this document: the sale-level regime is mature and the gateway-level one is absent.** §2 is about the second column only. Anything that reads *"the idempotency key is optional"* and concludes the codebase is careless is reading the wrong column — and, conversely, anything that proposes making `PaymentRequest.idempotency_key` mandatory by citing the sale-level regime would be **contradicting a documented contract**, not extending it.

---

## 2. The load-bearing decision: retry is only safe behind a gateway key

**This is the rule the design hangs on, and the current decorator violates it.**

`ResilientProcessor::execute_with_resilience` (`resilience.rs:178-209`) retries `authorize`, `sale`, `capture`, `refund` and `void` on a `Transient` error with no condition on the request. Whether that is safe depends on the gateway seeing the retry as the *same* operation, which depends on a key the caller may not have supplied.

**The evidence, each file in its own words:**

- `PaymentRequest.idempotency_key: Option<String>` — `types.rs:50-52`: *"Idempotency key (UUIDv7) to prevent duplicate charges on retry. **If `None`, the processor will generate a fallback key.**"*
- `PaymentProcessor::refund` doc — `processor.rs:78-80`: *"When `None` (legacy callers), the driver generates a fresh key per call, which provides no deduplication — **a timeout+retry may double the refund**."*
- QRIS driver header — `drivers/qris.rs:5`: *"`order_id_for()` reuses `PaymentRequest.idempotency_key` **only WHEN THE CALLER SUPPLIES ONE** and falls back to a fresh `order_id` otherwise, so a timeout is safe only on the subset of calls that carry a key. A timed-out QR issuance retried without a key mints **a second live QR for the same basket**."*
- Square driver — `drivers/square.rs:341` `idempotency_key_for` has the identical shape: honour the caller's key, else mint a fresh `Uuid::now_v7()`.

A `Transient` error is by definition the class where the request **may have reached the gateway** — a timeout, a dropped connection, a 502 after the gateway committed. Retrying without a key is not a retry; it is a second charge.

**The rule.**

> `ResilientProcessor` may retry a money-moving operation **only when that operation carries a caller-supplied gateway key**. With no key it forwards the call **once** and surfaces the error unchanged. The guard belongs on the decorator, not the driver, because the decorator is the only place that knows a retry is happening.

### 2.1 The good news, and it is the reason this is cheap: a deterministic key is already available

`qris.rs:5` names the two acceptable repairs itself — *"**Either require the key or make the fallback deterministic** before bounding the client."* The second is available at the one production site without any client change:

`payment_api.rs:222-224` already **rejects** a charge whose `sale_id` is empty, and `:244` already sends that `sale_id` as `reference`. So `sale_id` is a required, stable, per-charge identifier sitting at the call site. Deriving the gateway key from it — `Some(body.idempotency_key.clone().unwrap_or_else(|| format!("qris:{sale_id}")))` at `:246` — makes every retry of that charge dedupe at the gateway, **including the retries that happen today with no key at all**.

**That single change is the highest-value item in this document**, because it converts §2 from a behavioural regression (turn retries off) into a pure improvement (make the existing retries safe), and it needs no client, no schema and no type change.

### 2.2 Options, if the derivation is not taken

- **(i) Guard in the decorator (recommended fallback).** `execute_with_resilience` takes a `RetryPolicy` — `Keyed` or `SingleShot` — derived from the request. `authorize`/`sale` read `request.idempotency_key.is_some()`; `capture`/`void` take only a `transaction_id`, so they are `SingleShot`; `refund` already takes `idempotency_key: Option<&str>`.
- **(ii) Make the key mandatory in the type.** `idempotency_key: String` in `PaymentRequest`. Strongest guarantee, and it is a breaking change across the ~36 in-crate construction sites — **and it would contradict `20261001_sale_idempotency.sql:18`'s "unbounded unguarded sales stay legal"** if applied to the sale-level column by mistake (§1.3). Scope this carefully if it is chosen.
- **(iii) Leave retry unconditional and hope callers supply a key.** What the code assumes today. `processor.rs:78-80` explicitly names the callers who do not ("legacy callers"), so this is not a design, it is an unstated risk.

**Recommendation: §2.1 first, then (i).** §2.1 removes the double-charge risk on the path that exists. (i) is the structural guard that keeps it removed when a second endpoint appears.

**One consequence that is easy to miss.** `capture` and `void` take a bare `transaction_id` and have no key parameter. Under (i) they become `SingleShot`, which **reduces** current behaviour. That is the honest reading — a capture retried without a key can double-capture — but it means (i) is not purely additive, and the reduction should be named in the commit message rather than discovered later.

---

## 3. Where the decorator sits

**§1.1 changes the answer to the question the box implies.** *"Wire it into the registry"* is the natural reading and it is the wrong one: the production path holds a concrete `QrisPaymentProcessor` and never touches `PaymentProcessorRegistry`. Wiring the registry would produce a green test, a merged commit, and an unprotected payment path — the worst possible outcome, because it would look like the job was done.

**Wiring rule: the decorator is applied at processor construction, wherever a processor is built.** Concretely, `build_qris_processor` (`payment_api.rs:132`) returns the decorated type, and `AppState.processor` holds it. That is the one site that matters today.

**When the registry does get used** — i.e. when the multi-gateway fallback chain becomes real — the same rule applies at registration, not at lookup:

| Shape | Breaker scope | Attempts, chain of *n*, `max_retries = r` | Verdict |
|---|---|---|---|
| **(A) wrap each processor at registration** | per gateway | up to `n × (r + 1)` | **recommended** |
| **(B) wrap the chain executor** | per method | up to `r + 1` | wrong scope |
| **(C) wrap per request** | none — state discarded | `r + 1` | useless |

**(A)** because the breaker is a statement about **one gateway's health**. (B) would open a single breaker when *any* member fails and then fail fast for a method whose second processor is healthy — the exact case the chain exists to serve. (C) is what careless wiring produces: `CircuitBreaker::new` per request means `consecutive_failures` never survives to reach `failure_threshold`, so the breaker can never trip. Wrapping at lookup lands in (C), which is why the rule is *at construction*.

**The latency budget must be stated, because a cashier is waiting.** With the shipped defaults (`max_retries = 2`, `initial_backoff_ms = 100`, `max_backoff_ms = 2000`) a two-member chain sleeps up to `(100 + 200) × 2 = 600 ms` before the second gateway is even tried, on top of two network round trips per member. Defensible for a card authorisation, indefensible if the chain grows to three. **Design position: the chain is capped at two members, and the retry budget is a UX property, not a per-gateway one** — so `max_retries` stays a code constant (§7).

**A note on `sale`'s two-phase contract.** `payment_api.rs:249-250` records that `sale` *"charges and returns as soon as the QR exists; it does NOT poll for settlement (PAY-6)."* A `Transient` failure from `sale` is therefore ambiguous in a way a card decline is not: the QR may exist. That ambiguity is precisely why §2.1's deterministic key matters more here than anywhere else, and why §6's reconciliation job is not optional for QRIS.

---

## 4. Breaker keying: per gateway is not enough, and the schema says why

Today the breaker is unkeyed. R9's own text names `(tenant_id, gateway)` keying, and the schema supports it — but the crate has no such concept, which is the gap:

```bash
grep -rn "tenant_id" crates/kasirmu-payment/src/          # → 0 hits
grep -n "payment_gateways" crates/kasirmu-core/migrations/20260813_init.pg.sql
#   ('payment_gateways', 'tenant_id', 'TEXT', '''default''', true)   ← column exists, PG only
```

**Note the asymmetry:** `payment_gateways` exists in the **Postgres** init and has **no SQLite counterpart** — `grep -inE "gateway|payment_method" crates/kasirmu-core/migrations/20260813_init.sql` returns only two unrelated column hits (`:371`, `:608`). So the *"switching gateways is a config change, not a code change"* promise `registry.rs:11-13` makes is backed by a **cloud-only** table, and a terminal that has never synced has no gateway config at all. That is a Phase-4 scope question in its own right (§9).

**Why per-gateway keying alone is wrong.** `payment_gateways` is per-tenant, so two tenants can point at **the same Midtrans endpoint with different merchant accounts**. A breaker keyed on the gateway alone would let one tenant's revoked API key — a tenant-scoped outage — open the breaker for every tenant on that endpoint, failing fast for merchants whose credentials are fine.

**Options.** (a) per gateway; (b) per `(tenant, gateway)`; (c) per `(tenant, gateway, method)`.

**Recommendation: (b).** (c) over-splits: `qris` and `card` on one merchant account share an outage, so splitting them triples the state for no gain. (b) matches the schema's own unit of configuration.

**Shape, and the one API change it forces.** `PaymentProcessorRegistry` gains `breakers: RwLock<HashMap<(String, String), Arc<CircuitBreaker>>>`, resolved at construction. `ResilientProcessor` then takes an `Arc<CircuitBreaker>` rather than building its own — because `ResilientProcessor::with_config` (`resilience.rs:157-164`) currently constructs its breaker internally, so **the breaker cannot be shared or keyed as written.** That is the single place where the shipped API actively prevents the right design.

---

## 5. Half-open must admit exactly one probe

`CircuitBreaker::allow_request` (`resilience.rs:108-116`) returns `Ok(())` for **both** `Closed` and `HalfOpen`:

```rust
CircuitState::Closed | CircuitState::HalfOpen => Ok(()),
```

Under a sustained outage, after `cooldown_duration` every concurrent request is admitted as a trial. On a POS during a lunch rush that is a thundering herd against a gateway that has just come back — the classic way a half-open breaker converts one outage into two.

**Rule.** `HalfOpen` admits **one** probe. Concurrent callers fail fast until it resolves; success closes the breaker, failure re-opens it. This needs a `probe_in_flight` flag on `BreakerInternal` and an explicit transition on the probe's resolution. It is the one item here that changes the behaviour of already-shipped code rather than adding wiring.

**Why the existing test cannot catch it.** `circuit_breaker_trips_and_fails_fast` drives the breaker **sequentially**. Sequential driving cannot observe a concurrency defect, so the test is green and silent on this — the same class of gap that `todo-owner-rulings.md` R20 found in the Tools parity test: a green test that does not test the property its name implies.

---

## 6. The expiry and reconciliation job

The box asks for one and nothing implements it. It is the half of R5 that is **not** in `kasirmu-payment` at all, because it needs a clock and a database.

**What it must do**, in the order money is at risk:

1. **Expire unpaid QR.** `QRIS_EXPIRY_SECS: u64 = 300` (`drivers/qris.rs:76`). A QR issued and never scanned must leave `pending` at 300s rather than linger — and note `qris.rs:5` records that a retried keyless issuance leaves the *first* QR scannable for that full 300s, which is why §2.1 is a precondition for this being meaningful.
2. **Reconcile settled against pending.** The local target already exists: `payments` carries `gateway_reference`, `gateway_status`, `gateway_response`, `settled_at`, `settled_by`, `idempotency_key` (`20260813_init.sql:364-371`). Nothing writes them from a background path today.
3. **Resolve orphans.** A payment whose gateway call timed out with an unknown outcome is the dangerous row — possibly settled at the gateway and `pending` locally. This is where `ErrorClass::Deferred` and `PaymentError::Expired` (`error.rs:72`) come from, and it is the class §2's guard cannot fix: no client-side key makes an unknown outcome known.

**Where it lives.** Not in the crate — it needs a scheduler and a DB handle. The precedent to follow is the sync daemon (`apps/mobile-tauri/src/commands/sync.rs`), already a store-scoped background loop; the cloud server is the candidate for the reconciliation half, since a terminal that is offline cannot reconcile anything.

**What this doc does not decide:** the scheduler, the interval, and whether reconciliation is a daemon or a request-triggered sweep. Inventing them here would produce exactly the artefact `todo-open-debt-program.md:234` warns about for Phase 3b — *"a worker that writes a migration without it is inventing the axis the owner has not ruled on."* The equivalent here is inventing a scheduler.

---

## 7. The config surface

`ResilientProcessorConfig` is code-level today; `payment_gateways.config_json` is the per-gateway config store. Which knob belongs where is a decision, and the split is not arbitrary:

| Knob | Home | Why |
|---|---|---|
| `failure_threshold` | **`config_json`, per gateway** | A gateway's flakiness is a property of the gateway. A sandbox acquirer and a production one need different thresholds, and an operator can know that without a release. |
| `cooldown_duration` | **`config_json`, per gateway** | Same argument: how long a vendor's outage typically lasts is vendor knowledge. |
| `max_retries`, `initial_backoff_ms`, `max_backoff_ms` | **code constants** | These are the **UX latency budget** from §3, and the cashier experiences them. A per-gateway override would let a config change silently add seconds to a checkout — a support incident, not a tuning knob. |

The rule this encodes: **a knob that changes how long a customer waits is code; a knob that changes how suspicious we are of a vendor is config.**

---

## 8. Test plan

The three existing tests cover the sequential happy paths. What is missing is everything above, and each is a **red-first** test — written to fail against the current code, then made to pass.

| Test | Pins | Fails today? |
|---|---|---|
| a keyless money-moving call is **not** retried | §2 | **yes** — retry is unconditional |
| a keyed `refund` **is** retried, and the driver sees **one** key | §2 | no — passes already |
| `capture`/`void` are single-shot | §2 | **yes** |
| a charge with a blank `body.idempotency_key` still dedupes on retry | §2.1 | **yes** — this is the production hole |
| two decorators over one gateway share one breaker | §3 | **yes** — `with_config` builds its own |
| a healthy second processor is tried while the first is `Open` | §3 | **yes** — not wired at all |
| concurrent callers during `HalfOpen`: exactly one probe | §5 | **yes** |
| a tenant-A outage does not open tenant-B's breaker | §4 | **yes** — no keying exists |

**The pinning convention worth carrying over from R20.** Phase 3a.2's box asks for a test that pins *"a custom role holding the gate permission passing the same way a preset would"* — a test of the **invariant**, not of the shipped preset. The analogue here is to pin the **key**, not the outcome: the retry test must assert that the driver **received the same key twice**, not merely that the call eventually succeeded. A test that only checks the outcome passes on a double charge that happens to return `Ok`.

---

## 9. What this document does not decide

Named so nothing here reads as a ruling it is not.

1. **Wire it or delete it.** R9's own fork. This doc assumes **wire**; if the product has no multi-processor fallback requirement, (ii) — delete the decorator as speculative — is cheaper, and this document becomes the record of why.
2. **The scheduler for §6.** Interval, daemon-vs-sweep, and which shell owns it.
3. **Whether `payment_gateways` needs a SQLite counterpart.** §4's measured asymmetry. A terminal with no gateway config cannot fall back at all, which affects whether the chain is meaningful offline.
4. **The `(tenant, gateway)` key's tenant source.** The crate has no tenant concept; the key must be supplied at construction by whoever knows the tenant, and that plumbing is not designed here.
5. **Whether `capture`/`void` should grow an idempotency parameter** (§2.2's consequence). A trait change.
6. **Whether the sale-level `20261001_sale_idempotency` regime and the gateway-level key should be unified.** §1.3 shows they are distinct today and the migration says the separation is deliberate; a proposal to merge them is a separate argument and this doc does not make it.

---

## 10. Acceptance

This is a design deliverable, so its acceptance is a reading, not a build. It is accepted when:

1. Each §0 "wired? no" row has an owner ruling either way, recorded in `todo-owner-rulings.md` R9.
2. §2.1 is either implemented or explicitly declined with the double-charge risk accepted in writing.
3. §4's keying is settled, because it is the decision most expensive to change after wiring — the breaker map's shape leaks into every construction site.
4. The §8 rows marked *fails today* are written or scheduled with an owner and a date.

**Re-derive every claim above in one pass:**

```bash
grep -c "resilience\|Resilient" crates/kasirmu-payment/src/registry.rs           # 0
grep -rn "execute_with_fallback\|register_method_fallback\|ResilientProcessor" \
  --include=*.rs crates/ platform/ apps/ | grep -v "registry.rs\|resilience"      # 4, all registry_tests.rs
grep -rliE 'ResilientProcessor|circuit.?breaker' docs/                           # archived journal + this file
grep -rn "PaymentRequest {" --include=*.rs crates/ platform/ apps/ \
  | grep -vE "_tests?\.rs|/tests/"                                               # 4: square.rs ×2, types.rs, payment_api.rs
sed -n '222,251p' apps/cloud-server/src/payment_api.rs                            # sale_id guard → key → sale() call
grep -rn "tenant_id" crates/kasirmu-payment/src/                                  # 0
grep -inE "gateway|payment_method" crates/kasirmu-core/migrations/20260813_init.sql   # 2 hits, neither a gateway table
grep -n "QRIS_EXPIRY_SECS" crates/kasirmu-payment/src/drivers/qris.rs             # :76 declares it; :476/:592 consume it
sed -n '364,371p' crates/kasirmu-core/migrations/20260813_init.sql                 # the payments columns
sed -n '14,22p' crates/kasirmu-core/migrations/20261001_sale_idempotency.sql       # the unguarded-is-legal contract
```
