# Owner rulings needed — the decision queue behind the open work

**Document:** `todo-owner-rulings.md`
**Role:** Decision queue. Every item below is blocked on a human choice, not on work.
**How to use it:** each entry is `what is blocked` → `the fork` → `the options` → `recommendation` → `the price`. A ruling is recorded by writing one line under the entry and dating it; do not edit an entry's measured text, correct it forward.
**Provenance:** every entry was re-derived in this checkout at HEAD `19437867c` (2026-09-18). The commands that produced each measurement are printed beside it, so a reader checks rather than trusts. Sibling records: `todo-open-debt-program.md` (the program these phases belong to), `docs/records/audit-open-findings.md` (the `BR-*` findings the ADR #49 ceilings cite), `docs/decisions/` (ADRs, for anything that graduates to a decision record). **R20 was added after publication**, at HEAD `83540df69`, and carries its own provenance — it is numbered last rather than folded into Phase 3 so that no existing entry's number moves.

---

## 0. The index, ordered by what it unblocks

| # | Ruling | Blocks | My recommendation | Price of being wrong |
|---|---|---|---|---|
| R1 | The parked licence arm | Phase 1 boxes | Leave parked, record | Low |
| R2 | The `sync_tests.rs` debug gate | Phase 1 box | Declare it explained, tick | None |
| R3 | Default-role seeding in `complete_setup` | Phase 2, a live tablet gap | Seed on both shells | Medium — data |
| R4 | The `AppState` → `BridgeCtx` seam | Phase 2 box | Partial seam | Medium — APK size |
| R5 | The organisation scope axis | Phase 3b entirely | Commission the design doc | High — schema |
| R6 | Register ↔ terminal binding (R4) | Phase 4 R4 | Explicit `terminal_id` | Medium — schema |
| R7 | A QRIS sandbox credential (R6) | Phase 4 R6 | Supply the key | Low |
| R8 | A vendor wire protocol (R7) | Phase 4 R7 | Simulator first, then one model | Low |
| R9 | R5 resilience: doc, and wire or delete | Phase 4 `:276` | Write the doc, then wire it | Medium |
| R10 | **Which shell's gate set is authoritative** | 4 ADR #49 ceilings, ~16 doors | The scope-aware gate, wherever they disagree | **High — security** |
| R11 | The `debug_upgrade` audit flag (BR-S10) | 1 door | Audit must not depend on build profile | Medium |
| R12 | `verify-pg-tests-ran.py`: gate or runner | Phase 5 | Runner now, gate when proven | Low |
| R13 | The 2 Redis arms | Phase 5 | Leave, record | None |
| R14 | nextest retries hiding flake | Phase 5 | One no-retry CI leg | Low |
| R15 | Adopt the `slow-tests` idiom | Phase 5, if funded | Adopt `pg-tests = []` | None |
| R16 | Dev Postgres 16 vs CI 17 | Phase 5 figures | Move dev to 17 | Low |
| R17 | The skip message that misdiagnoses | Phase 5 | Drop the parenthetical | None |
| R18 | Split the program doc? | Dispatch | Split by phase | None |
| R19 | Commit-scope allowlist? | Nothing | Leave permissive | None |
| R20 | **The home Tools grid's vocabulary** | **Phase 3a.2** | **Keep the rank, narrow 3a.2** | Medium — visibility |

**Already ruled — do not re-open:** the fail-closed default for an unknown role floor (owner, 2026-09-16: an unknown floor on an admin-tool gate must **deny**; landed as `a8c1fb4c5`).

---

## Phase 1 — the release profile

### R1 — The parked licence arm

**What is blocked.** `todo-open-debt-program.md` `:113`. The release-only arm at `crates/kasirmu-bridge/src/license.rs:670-683` — an expired-past-grace licence returning `is_active: false` + `Expired` — cannot be executed from this crate.

**The fork.** Reaching it needs a payload whose signature **verifies**. `verify_license_signature` takes no key parameter and reads a build-time `include_str!` public key (`crates/kasirmu-core/src/license_verification.rs:36`), while the private half is gitignored (`*.key`) and absent — `ls crates/kasirmu-core/*.key*` returns only the `.pub`. So **no fixture in this crate can mint a signature that verifies**, and the arm is unreachable by construction, not by oversight.

**The options.**
- **(i) Leave it parked and record the reason in the doc comment.** No production change.
- **(ii) Inject a verification seam** on the call path (a trait object or `#[cfg(test)]` override) so a test can substitute a verifier.
- **(iii) Compile a test key into the crate** under `#[cfg(test)]` and mint a real signature in the fixture.

**Recommendation: (i).** Both alternatives make a test reachable by changing the licence path itself — (ii) puts a substitution point on the one code path whose job is to refuse forged licences, and (iii) ships a private key in the source tree. The payoff is one branch of an expiry ladder whose siblings are already covered. This is the rare case where the honest answer is "parked", and the doc's own recommendation on record agrees.

**Price of being wrong.** Low. The arm is a status payload, not an authorisation decision; if it ever regresses, the symptom is a licence that reports active past grace, and the both-profile test at `auth_tests.rs:400-402` still pins the forged-row refusal.

### R2 — The `sync_tests.rs` debug gate

**What is blocked.** `:111`. `crates/kasirmu-bridge/src/sync_tests.rs:35-37` is `#[cfg(test)]` + `#[cfg(debug_assertions)]`, which is the whole of the debug/release total gap (`1318 − 1317 = 1`).

**The fork.** The box offers two ways out: run it in release (drop the `cfg`), or stop presenting the gap as unexplained. The test covers a `LOCAL_DEV_SYNC_URL` fallback (`sync.rs:172-173`) that **exists only under `#[cfg(debug_assertions)]`**, so dropping the gate would test a fallback release does not have.

**Options.** (i) Keep the gate and treat the gap as explained — the second branch of the box; (ii) drop the gate and fork the assertion per profile.

**Recommendation: (i), and tick the box.** The explanation now exists in this file, which is exactly what the box's second branch asked for. A per-profile fork here buys coverage of a dev-only fallback.

---

## Phase 2 — tablet ↔ desktop wire parity

### R3 — Default-role seeding in `complete_setup`  ⚠️ the one with a live symptom

**What is blocked.** `:168`, recorded as an open question rather than resolved. It is filed as a *divergence*; measured this pass it is closer to a **gap on the mobile shell**.

**The fork.** The bridge's `complete_setup` seeds the role presets as its **leading** step — `store.seed_default_roles()?` at `crates/kasirmu-bridge/src/setup.rs:99`. The tablet's `write_setup` runs **six** legs (`apps/mobile-tauri/src/commands/setup.rs:110-156`: features, prune, preset name, setup-complete flag, default currency, dismiss wizard) and **none of them seeds**, by an explicit decision recorded at `:108-109` — *"the bridge's leading `seed_default_roles` is deliberately not mirrored here"*.

**What makes it a gap rather than a taste difference, measured this pass:**
- `seed_default_roles` has **47 call sites in the mobile shell and every one is a `*_tests.rs` file** — `grep -rn 'seed_default_roles' apps/mobile-tauri/src` returns production hits **only in comments**. So production mobile code never calls it.
- The one command that does seed on demand, `seed_default_roles_scoped`, is **registered in the desktop shell only** — `apps/desktop-tauri/src/lib.rs:1092`. The mobile shell does not register it.
- **No migration seeds the presets either.** `grep -rn 'INSERT INTO role_presets' crates/kasirmu-core/migrations/*.sql` → nothing; the table is not populated by the init SQL.

So if the tablet's setup wizard is the creation path, a fresh tablet install reaches a state where the preset rows were never written, and the shell exposes no command to write them.

**The options.**
- **(i) Seeding is part of `complete_setup`** → mirror the leading `seed_default_roles()` into `write_setup`, as leg 0.
- **(ii) Seeding is a separate step** → register `seed_default_roles_scoped` on the mobile shell so the path exists at all.
- **(iii) The tablet never seeds by design** → say so, and say what populates the table instead. Nothing in the tree does today.

**Recommendation: (i) as the immediate fix, and (ii) as the belt-and-braces.** (i) is a one-line mirror in a function whose legs are already a documented mirror of the bridge's, and it closes the fresh-install hole. (ii) matters because the desktop can re-seed on demand and the tablet cannot, which is a reachability gap independent of `complete_setup`. If (iii) is true, it needs a sentence naming the seeder — I could not find one, and "we decided not to" is not the same as "something else does".

**Price of being wrong.** Medium, and it is data-shaped. `seed_default_roles` **upserts and overwrites** every preset row (`crates/kasirmu-core/src/db/staff.rs:69`, doc at `:11`), so seeding in the wrong place can rewrite a preset a tenant has edited — though `roles.rs:14-16` notes preset ids are not authorable through the UI, which limits the blast radius. Confirm that before shipping (i).

### R4 — The `AppState` → `BridgeCtx` seam

**What is blocked.** `:169`. Measured field-by-field and deferred: **7 of 14** fields match; `Arc`-ing `db`/`terminal_id` is mechanical; `plugins` would drag the `mlua` Lua VM into the Android APK for a field that is forever `None` on that shell.

**Options.** (i) Merge fully into one `BridgeCtx`; (ii) share the mechanical fields and keep `plugins` shell-local; (iii) leave two contexts.

**Recommendation: (ii).** The seam is worth having for the nine fields that can move; it is not worth having at the price of a Lua VM in the mobile binary for a field mobile never populates. This also needs a Phase-1-fence decision on the bridge side, since the change lands in `crates/kasirmu-bridge`.

---

## Phase 3 — the permission vocabulary

### R5 — The organisation scope axis

**What is blocked.** `:219` and `:220` — all of 3b. **Nothing about the axis is inferable from the code**: the `roles` table declares exactly `id, name, description, permissions, created_at, updated_at` with **no parent/clone column** (`crates/kasirmu-core/migrations/20260813_init.sql`), the assignment tables carry **branch and workspace dimensions only**, and ADR #47's own non-goals section declined this layer. A worker who invents the axis produces a migration you then reject — which is what `:219` says in as many words.

**The three questions a design doc must answer**, and they are the fork:
1. **Which entity owns the organisation axis** — a new `organisations` table in the global identity DB, or a derived grouping over existing stores?
2. **How a terminal-scoped assignment resolves at the enforcement boundary**, given ADR #4 keeps store data in per-store DBs while roles live in the global identity DB. This is the hard one: a scope that spans stores cannot be enforced by a per-store gate.
3. **What "explicit `all`" means** on each new axis.

**Options.** (i) Rule the axis is needed, owned by the global identity DB, and commission the design doc; (ii) derive the axis from existing branch/workspace data with no new table; (iii) decline the axis — roles stay branch/workspace-scoped and 3b closes as out-of-scope.

**Recommendation: (i) if the product needs org-wide roles, otherwise (iii).** The decision the owner can make today is binary and cheap — *does any customer need a role that spans stores?* If yes, commission the doc and expect question 2 to dominate it. If no, (iii) is strictly cheaper than (ii): (ii) buys a new axis with no new table and still has to answer question 2, because a derived grouping is still a cross-store scope.

**Price of being wrong.** High. This is the only ruling in this document that produces a **migration**, and a wrong axis is a migration plus an evaluation path plus gate wiring to unwind.

### R20 — The home Tools grid's vocabulary: rank or permission  ⚠️ blocks Phase 3a.2, and the block is a green test

**What is blocked.** `todo-open-debt-program.md` box `3a.2` — *"Replace the rank comparisons with permission checks"*, one gate at a time, each pinned by *"a custom role holding the gate permission passing the same way a preset would"*. Added to this queue after publication, so it carries the next free number rather than a Phase-3 one.

**Why it cannot be executed as written, measured at HEAD `83540df69`.** The grid's rank is not a preference recorded in prose — it is **pinned by a live, green test**, and that test's assertion is *structurally coupled to the field 3a.2 removes*. `ui/src/__tests__/WorkspaceHomeTools.navParity.test.tsx:63-77`:

```js
const navLevel = navRoleLevel(nav!.requiredRole);
if (navLevel === undefined) continue;          // permission-only / absent nav gate
const homeLevel = ROLE_LEVEL[tool.access.minimumRole];
expect(homeLevel, `homeLevel for "${tool.access.minimumRole}"`).toBeDefined();
expect(homeLevel!, …).toBeGreaterThanOrEqual(navLevel);
```

Replace `minimumRole` with a permission and `ROLE_LEVEL[undefined]` is `undefined`, so `toBeDefined()` fails. **Proven by execution, not by reading.** A scratch probe (written, run, deleted — no tracked file touched; it stripped `minimumRole` in memory and re-ran the same expression) reports **17 of 17** catalogue entries failing, not only the six that would widen. So 3a.2's *first* gate turns this file red for **every** tool, and the repair is not a test update — it is the deletion of the assertion.

**And that assertion is where the policy lives.** Its header, `:1-11`, states it: *"the home gate must not be LOOSER than the nav item's required role. Home-stricter is the documented policy choice … so the assertion is `homeLevel >= navLevel`, never the reverse."*

**The two documents the earlier finding blamed are not both live.** `docs/records/audit-open-findings.md:1539` cites `todo-tools.md:730-732` as the policy's source. That path does not resolve: the file is **`.agents/done-todo-tools.md`** — `done-`-prefixed and archived — and the passage is at `:730-734`, the *"home `minimumRole` is never LOOSER than the route's `requiredRole` (home-stricter is the documented policy choice; Settings stays `manager` + authoritative `settings:read` at the route until the §H scope pass)"* sentence inside its "Tests (57 green)" paragraph. So the policy survives in three carriers and only one is live code; two of the three cite the doc by its dead name (`audit-open-findings.md:1539`; `WorkspaceHomeTools.test.tsx:1` and `:30`).

**What the grid actually is.** Not a duplicate of the route gate — a **front-door filter** deliberately stricter than it. Measured this pass across the catalogue:

| tool | home `minimumRole` | route (register) | route `requiredRole` | route `requiredPermission` | who gains if gated on the permission |
|---|---|---|---|---|---|
| `staff` | manager | `staff` (`staff/register.tsx:13`) | manager | `staff:read` | auditor |
| `shifts` | manager | `shifts` (`shifts/register.tsx:8`) | manager | `shifts:view_any` | auditor |
| `reports` | manager | **`dashboard`** (`reports/register.tsx:12`) | manager | `reports:view` | auditor |
| `audit` | manager | **`audit-log`** (`audit/register.tsx:9`) | manager | `audit:view` | auditor |
| `settings` | **admin** | `settings` (`settings/register.tsx:10`) | manager | `settings:read` | auditor |
| `analytics` | **admin** | `analytics` (`analytics/register.tsx:12`) | manager | `analytics:view` | **manager** |

Two of the six do not carry their own id as their route — the `reports` tool opens `dashboard` and the `audit` tool opens `audit-log` — which is why the parity test matches on `tool.route` rather than `tool.id`, and why a census keyed on ids silently compares the wrong pair. (`reports/register.tsx:23` also registers a *separate* `reports` route with the same gate; it is not the tool's target.)

The route's permission arm is authoritative — `passesGate` (`ui/src/registries/page-registry/index.ts:139`) returns `hasGrantedPermission(...)` and never consults `requiredRole` when the session carries granted keys — and the preset that holds those keys but not the rank is the **auditor** (`platform/core/src/rbac_presets.rs:262-272`: `STAFF_READ`, `SETTINGS_READ`, `REPORTS_VIEW`, `AUDIT_VIEW`, `SHIFTS_VIEW_ANY`), plus, for `analytics`, the **manager** (`:84`, inside the `builtin_roles::MANAGER` block opening at `:49`).

Permission-gating the grid therefore makes the card **exactly equal** to the route gate for those tools — not looser. The inequality `home >= route` would still hold numerically. What breaks is that the inequality is *expressed in a vocabulary 3a.2 deletes*, and the visible effect is a **read-only role gaining five cards** it cannot act on.

**The options.**
- **(i) The rank stays authoritative for the home grid; 3a.2 is narrowed to the gates that have no route twin, and the policy is cited at the site.** `ui/src/features/workspaces/tools.tsx:19-31` already documents the split; add the `done-todo-tools.md` citation, re-point the three dead citations, and let `roleAtLeast` remain the home vocabulary.
- **(ii) The permission wins and the home grid mirrors the nav.** Every manager sees Analytics; every auditor sees Staff, Shifts, Reports, Audit and Settings. `navParity.test.tsx:63-77` is deleted or rewritten to compare permissions, and 3a.2 proceeds.
- **(iii) Both vocabularies coexist on the card** — keep `minimumRole` as the front door and add a permission as a second arm. The only option that lets 3a.2 run without deleting the test, and the one 3a.3 would then have to unwind.

**Recommendation: (i).** Three reasons, in order of weight. **First, there is no violation to fix** — the 2026-09-16 census (`docs/records/audit-open-findings.md:1565-1579`) found **0 of 17** tools carrying a home gate looser than the route, and the test guaranteeing it is green (11 tests across the two files, re-run this pass). 3a.2 is written as a repair; nothing is broken. **Second, (ii) is a widening on an admin surface** — five cards to a read-only role — landed by what would read as a refactor commit. **Third, the box's own required test is unsatisfiable under the current policy**: it asks for *"a custom role holding the gate permission passing the same way a preset would"*, but the preset holding `analytics:view` is `manager`, exactly the role the home gate excludes, so the test can only pass if the home gate stops excluding it — i.e. if (ii) is chosen first. That is a decision, not a lane's judgement.

**If (ii) is chosen**, it belongs in a separate, deliberate commit that names the widening in its message, and 3a.3 (delete `roleAtLeast`/`ROLE_HIERARCHY`) becomes its natural second half. **If (i) is chosen**, 3a.2 shrinks to the two catalogue entries with no registered page (`settings/topology`, `settings/sync`) and to `ui/src/features/workspaces/WorkspaceHome.tsx:373`/`:423` — the two comparisons `roleAtLeast` did **not** already absorb (`:387` was migrated and now fails closed, per the comment at `:377-381`; the box's own anchors `:363`/`:372`/`:378`/`:414` are stale by 1–9 lines).

**Price of being wrong.** **Medium, and it is a visibility change either way.** (i) leaves a read-only role unable to see cards for pages it can open from the nav — the mismatch `audit-open-findings.md:1532` describes, cosmetic but real, and what makes this feel like a bug. (ii) hands five admin-surface cards to the auditor, which is not cosmetic. The asymmetry is the argument: (i)'s cost is a confusing nav/grid mismatch, (ii)'s cost is an authorisation widening, and only one of those is reversible by a later commit.

---

## Phase 4 — payment

### R6 — Register ↔ terminal binding (R4)

**What is blocked.** `:249` and `:278`. Single implicit terminal ships; the question the code asks — *which terminal is this register's?* — is currently answered by **creation order**, and `platform/startup/src/hardware.rs:203-212` says so in its own words: *"The alias is interim, not design."*

**The fork, stated precisely.** `edc_terminals` (migration `crates/kasirmu-core/migrations/20260824_media_edc.sql`) carries `is_active` and **0 occurrences of `is_default`** (`grep -c is_default` → 0), so the schema cannot currently express a default at all.

**Options.**
- **(i) Add `edc_terminals.is_default`.** Cheap, but it answers a **tenant-wide** question — "which terminal is the default" — not the **per-register** question the code actually asks. Two registers would share one answer, and the column needs a partial unique index to forbid two defaults.
- **(ii) Commands take an explicit `terminal_id` and the UI supplies it.** Honest about the fact that a register knows its own terminal, and the UI already has the terminal list.
- **(iii) Keep the creation-order alias** and record it as the design.

**Recommendation: (ii).** A register is bound to a terminal; that binding belongs to the register, and `is_default` on the terminal table cannot express it without a second table to hold the register side. The price is recorded and small — **8 non-test `DEFAULT_TERMINAL_ID` sites** across `crates/`, `platform/` and `apps/` (`grep -rn DEFAULT_TERMINAL_ID … | grep -v tests | wc -l`), plus a UI that already lists terminals. A second physical terminal is needed only to **verify** the outcome, not to make the call, so this is answerable from the checkout today.

**Price of being wrong.** Medium. Either choice touches the schema and the alias; (i) additionally needs a uniqueness constraint to stay honest, and would need revisiting the moment a second register exists.

### R7 — A QRIS-enabled sandbox credential (R6)

**What is blocked.** `:250` and `:279`. Four acquirer behaviours are unproven by anything in this repo: generic-QR interop, the targeted-QR restriction, real refund behaviour, and per-merchant acquirer activation.

**The named input.** A Midtrans/Xendit sandbox `MIDTRANS_SERVER_KEY` attached to a **QRIS-enabled merchant account** — the variable the code reads at `crates/kasirmu-payment/src/drivers/qris.rs:306` (siblings `STRIPE_SECRET_KEY` at `stripe.rs:192`, `PADDLE_API_KEY` at `paddle.rs:91`). You already keep this class of secret as user-scope `OZPOS_*` variables; this one has no `OZPOS_` twin, and that is the whole gap.

**The trap that must be read before citing any green.** A missing key does **not** read as a failure: `crates/kasirmu-payment/src/drivers/qris_tests.rs:40` asserts in **both** directions (`Ok(_) => assert!(result.is_ok())` against `Err(_) => …contains("not set")`), so the suite is green with and without the credential, and all 21 tests in `crates/kasirmu-payment/tests/qris_integration.rs` run against a local `wiremock` with **0 `#[ignore]`** — they grade our side of the contract only. **A green QRIS suite is not R6 evidence.**

**Options.** (i) Supply the sandbox key and run the four behaviours against a real acquirer; (ii) declare R6 unverifiable in-repo and close it as accepted risk with the four behaviours named; (iii) strengthen the mock contract only.

**Recommendation: (i).** It is one secret of a class you already hold, and (iii) is the tempting wrong answer — it makes the suite look stronger while proving nothing about interop. If (i) is not available, (ii) is honest and costs nothing; what is not acceptable is closing R6 on a green mock suite.

### R8 — A vendor wire protocol (R7)

**What is blocked.** `:250` and `:280`. The repo holds **no spec, no capture and 0 fixtures**: `crates/kasirmu-hal/src/drivers/edc/wired.rs` (112 lines), `wireless.rs` (132) and `protocol/{pax,ingenico,verifone}.rs` (46 each) are self-labelled PLANNED stubs failing closed with `HalError::Unsupported`, and `protocol/protocol_tests.rs` holds no golden vectors.

**The named input.** The framing for **one** named target model — a spec, or better a single captured byte trace — plus the terminal to check the answer against.

**Options.** (i) Name one model and obtain its spec or a capture; (ii) decline EDC hardware support and delete the stubs; (iii) build the loopback terminal simulator only.

**Recommendation: (iii) now, (i) if a merchant relationship exists.** The simulator covers the state machine — timeout, retry, cancel, receipt, fail-closed on an incomplete read — with **no vendor at all**, and it is a lane's work rather than a business decision. Asking *which single model is the target* is a cheap question with a 3-documents-or-1-capture answer, and it is the only thing that unblocks (i). **Do not invent framing from a plausible reading of a third-party document** — an invented codec passes its own tests and fails at a counter.

### R9 — R5 resilience: write the doc, then wire it or delete it

**What is blocked.** `:276`, and the box is now **inverted** (measured this pass). It asks for an R5 **design doc** and states there is *"no `ResilientProcessor`"* — but the code has since landed: `crates/kasirmu-payment/src/resilience.rs` **implements** `ResilientProcessor`, a 3-state `CircuitBreaker` (Closed/Open/HalfOpen) and `ResilientProcessorConfig`, `lib.rs:70` re-exports them, and `registry.rs:57-67` is `register_method_fallback(method, chain: Vec<Arc<dyn PaymentProcessor>>)` — the `method -> Vec<processor>` chain the row said did not exist.

**The half that is still open, and it is the load-bearing one.** No design doc exists anywhere live — `grep -rliE 'ResilientProcessor|circuit.?breaker' docs/` returns only `docs/archived/manager-2-journal.md`. And the decorator is **not wired**: `registry.rs` contains **no** reference to `resilience` or `Resilient`, so the breaker sits beside the dispatch path rather than in it. An unwired resilience decorator is the worst of both — it carries the maintenance cost of shipped code and delivers none of the fault isolation.

**Options.** (i) Write the design doc retroactively **and** wire it into the registry; (ii) write the doc and delete the decorator as speculative; (iii) wire it with no doc.

**Recommendation: (i), or (ii) if the product has no multi-processor fallback requirement.** The doc is cheap now that the code exists — the hard part (breaker keying, expiry/reconciliation) is a writing task, not a design task. What is not acceptable is (iii): an undocumented breaker on the payment path is exactly the artefact the box was written to prevent, and it would land a `(tenant_id, gateway)` keying decision that has never been reviewed.

**The doc half is now written — 2026-09-18, `docs/plans/payment-resilience-design.md`, no owner input needed.** So the "no design doc exists anywhere live" finding above is discharged, and what remains of R9 is the fork itself. Writing it surfaced three measurements that **change the price of (i) and should be read before ruling**, because they mean the obvious wiring is the wrong one:

- **"Wire it into the registry" would protect nothing.** The one production `PaymentRequest` construction is `apps/cloud-server/src/payment_api.rs:239`, on a **concrete** `QrisPaymentProcessor` (`:79`, built `:132-135`), calling `processor.sale()` at `:251`. `PaymentProcessorRegistry` is not on that path, and the whole fallback/resilience layer has **0 production callers** — the only references outside `registry.rs`/`resilience.rs` are in `registry_tests.rs`. So (i)'s price is *one construction site*, not a registry campaign — **cheaper than this entry assumed**.
- **The double-charge hole is real and cheap to close.** `:246` takes the gateway key off the HTTP body, so it can be `None`; `sale` is what the decorator retries; a keyless retry mints a fresh gateway key (`drivers/qris.rs:5`, `processor.rs:78-80`). But `sale_id` is required (`:222-224`) and already sent as `reference` (`:244`), so a deterministic fallback key is available server-side. **That makes the safe version of (i) additive rather than a behaviour reduction** — it fixes retries that are unsafe today instead of removing them.
- **One trap that would corrupt the fix.** Two fields are named `idempotency_key`: the local `payments` row (deliberately optional, contract at `20261001_sale_idempotency.sql:18`) and the gateway key (unguarded). A lane that makes the former mandatory to fix the latter is breaking a written contract. The doc's §1.3 separates them; a ruling on (i) should say *gateway key* explicitly.

---

## The ADR #49 ceilings — one ruling settles four items

### R10 — Which shell's gate set is authoritative  ⚠️ the highest-stakes ruling here

**What is blocked.** The five ceilings named in `todo-open-debt-program.md` and `docs/records/audit-open-findings.md`: `customers` (6 refusals), `history` (5 export doors), `settings` (the gate-mechanism swap), `branding` (4), `receipt_format` (2). Roughly **16 doors** stay un-ported behind this one question, and ADR #49 §4 forbids an extraction from widening or narrowing a gate — so the question cannot be answered by a lane.

**The fork, in the four measured shapes it takes.** All four are the *same* question: where the two shells disagree, whose gate is the design?

1. **Gate kind — `customers`, BR-S8.** The tablet gates with the **non-scope-aware** `require_customer_permission` (`apps/mobile-tauri/src/commands/customers.rs`, on the global identity db), where the bridge uses the scope-aware `ctx.require_session_permission` (`crates/kasirmu-bridge/src/customers.rs:428`). The bridge's own doc block asserts the shell used the scope-aware form — true of desktop, false of mobile.
2. **Gate order — `customers`, BR-X4.** The tablet opens the store db **before** the gate (`resolve_scope` → gate) in five commands; the bridge twins gate first and open afterwards. This matters because `open_store` is not free: on a cache miss it creates the directory, creates the database file and runs migrations (`platform/core/src/database/manager.rs:73-103`). So against an unopenable store an **unauthorized** caller gets `Internal("opening store db: …")` on the tablet and `PermissionDenied` on the desktop — an authorisation failure leaking as an infrastructure error, and doing filesystem work first.
3. **Gate kind and order — `history`'s five export doors.** Classified `no_session_resolution` (case 3): both differ, so neither shell's body can be adopted as-is.
4. **Gate mechanism — `settings`' scoped setters.** Measured this pass: `crates/kasirmu-bridge/src/settings.rs` calls `require_permission_for_user` (the **unscoped** helper) at `:1079`, `:1098`, `:1117`, `:1141`, while its **scoped reads** call `require_session_permission` — the same scope-aware gate the shell runs. So here the *bridge* is the laxer side, and `settings.rs` is stuck precisely because its reads ported and its setters could not.

**Options.**
- **(i) The scope-aware, gate-first gate is authoritative wherever the two disagree.** Concretely: `customers` adopts the bridge's scope-aware form and gate-first order; `settings`' bridge setters adopt the scope-aware form the shell already runs; `history` and `receipt_format` get the stronger of the two on each axis.
- **(ii) The tablet's set is authoritative** — the desktop's stricter gate is relaxed to match. A security regression on an admin surface.
- **(iii) Keep the fork**, record it, delegate nothing, and accept the ceilings as permanent.

**Recommendation: (i), and it is the only one of the three that is defensible.** The scope-aware gate is *strictly stronger* — that is ADR #35 D5's own words — so (i) moves every disagreement toward the stricter behaviour, and (ii) moves it toward the weaker one on a surface that gates customer data. (iii) is what the repo has effectively been doing, and it is why 16 doors have been stuck for a week; the cost of (iii) is not zero, it is that every future lane re-derives the same ceiling. **Fold the gate-order half in explicitly** — (i) alone does not fix BR-X4's filesystem-work-before-authorisation, and that half is the one with a leak rather than merely a divergence.

**Price of being wrong.** **High, and it is the one item here I would not ship without a written ruling.** (i) is a behaviour change: roles that could act on the tablet may stop being able to, and vice versa. That is correct if the tablet's gate was the bug, and a denial-of-service on legitimate users if the tablet's laxer gate was deliberate. It must be a ruling rather than a lane's judgement, which is exactly what §4 says.

### R11 — The `debug_upgrade` audit flag (BR-S10)

**What is blocked.** `update_staff_scoped` cannot be delegated because the two shells disagree on **what gets audited**. `Store::record_security_event(event, debug_upgrade)` (`crates/kasirmu-core/src/db/audit_security.rs:382-392`) drops the write for a confirmed Free tier, and `debug_upgrade` decides whether the desktop's dev Free→Premium promotion applies first. The tablet wrapper passes **`false`**, the bridge passes **`true`**.

**The fork.** Delegating would begin writing security events for Free-tier staff updates on the tablet in **debug** builds — so the audit trail would differ between build profiles, which is the shape that makes an audit trail untrustworthy. The core doc states the intent: *"tablet passes `false` so it never mirrors the desktop divergence"* — i.e. the tablet's behaviour is the deliberate one and the desktop's is named as a divergence.

**Options.** (i) `false` is authoritative — the recorder stops depending on a debug-only tier promotion, and the bridge changes; (ii) `true` is authoritative — the tablet starts writing them; (iii) keep the fork.

**Recommendation: (i).** **An audit record must not depend on the build profile.** That principle decides it without needing to know which shell was ported from which, and it points at the bridge as the side to change — which is the opposite of what (i) in R10 does, and worth stating so the two are not conflated: R10 moves gates toward the stricter side, and this moves the recorder toward the profile-independent side. The two happen to select different shells, and that is correct.

---

## Phase 5 — the PG local-green liar

### R12 — `verify-pg-tests-ran.py`: gate or runner

**What is blocked.** `:513`. Adding a `scripts/gates.json` row would move the status census that `AGENTS.md` quotes (**53 required / 16 retired / 1 advisory**), which that page and its `.agents/AGENTS.md` mirror both carry; `verify-agents-mirrors.py` compares gate counts, so a row is a mirror edit in two files plus a policy call. The script is currently **nothing's acceptance command**.

**Options.** (i) Make it a gate — a `check.sh` step plus a `gates.json` row plus the two mirror edits; (ii) name it in the acceptance line of each plan doc whose box needs PG (free); (iii) leave it unbound.

**Recommendation: (ii) now, (i) once the container half is proven.** Its green half is *unsatisfiable without Docker*, so a gate added today is a gate that can only fail — and a permanently-red gate is one people learn to ignore, which is worse than no gate.

### R13 — The 2 Redis arms

**What is blocked.** `:512`. `redis_backend_tests.rs` carries 2 skip arms inside `test_backend()`, unreachable behind three `#[ignore]`s. The honest options are to delete them or to drop the ignores and add a Redis service — not to keep dead skip code implying a live skip path.

**Recommendation: leave them and record the choice**, which is the recommendation already on record and the one I would repeat: dropping the ignores costs a dev-CI service nobody asked for, and deleting the arms invites the next lane to re-add the helper's guards. A recorded choice is not the same as dead code.

### R14 — nextest retries hiding real flakiness

**What is blocked.** `:503`. `.config/nextest.toml:15` sets `retries = { backoff = "exponential", count = 2, delay = "1s" }` and **CI runs that profile** — `dev-ci.yml:246` is `cargo nextest run --workspace --all-features` with no `--profile`, and `--profile` occurs **0 times** in the workflow. So every test is retried twice before it is allowed to fail, and the intermittent `pg_isolates_locations_by_tenant` failure seen in a libtest run would be **absorbed and reported green**.

**The naming trap.** `[profile.ci]` is **not** what CI runs — its only caller is `scripts/release.sh:65`. `[profile.quick]` is the only no-retry profile and nothing invokes it.

**Options.** (i) Teach the guard to read nextest's JUnit XML (a second parser, different semantics); (ii) add one CI leg that runs with **no retries**, so a flake is visible once; (iii) accept retries.

**Recommendation: (ii).** One extra job answers the actual question — *is CI hiding flakes?* — for the cost of a job, and it does not require the guard to learn a second log format. (i) is the thorough answer and can follow if (ii) finds real flakes. Note this is the **third** masking layer on this suite, independent of the other two: print-then-`return` turns a non-run into a pass, libtest suppresses a passing test's stdout, and retries turn an intermittent failure into a pass.

### R15 — Adopt the `slow-tests` idiom

**What is blocked.** `:507`, gated on "if this phase is ever funded". The mechanism already exists three directories from the debt: a no-op feature plus `#[cfg_attr(not(feature = "X"), ignore)]`.

**Recommendation: adopt `pg-tests = []` if the phase is funded.** It satisfies every constraint at once — CI keeps the tests because CI passes `--all-features`; a local run without the container stops reading as a pass because both runners print `N ignored` **in the summary line**, which needs no `--nocapture`; and the skip is reversible by one flag instead of 64 call sites. One coupling to carry: the guard's source floor is baseline **64** and this migration deletes the arms it counts, so `ARM_FLOOR` will fire — that is the floor working, and the re-baseline belongs in the same commit.

### R16 — Dev Postgres 16 vs CI 17

**What is blocked.** `:506`, and it is the reason every local PG figure in the program doc was produced on a major version CI does not test. `dev-ci.yml:209` is `postgres:17-alpine`, while `scripts/reset-dev-pg.sh` names **16** twice — in its usage comment (`:22`) and in the message it prints (`:43`).

**Recommendation: move the script to 17.** Two string literals. Local figures should be produced on the version CI tests; if 16 is deliberate for dev, the script should say why, and nothing currently does.

### R17 — The skip message that misdiagnoses

**What is blocked.** `:502`. `crates/kasirmu-api/src/pg_tests.rs:598-600` collapses every failure of `throwaway_test_pool` into one string: `eprintln!("PG REST RLS test skipped (Postgres unreachable at {url})")`. In the run that fired it, Postgres **was** reachable — `1085 passed; 0 failed` printed around it and `psql` answered on that port the same minute. So the arm emits a **network** diagnosis for a **catalog** failure it never tested, and a lane dispatched on that message checks the container, the port and the firewall and finds nothing wrong.

**Options.** (i) Have the helper distinguish connect-failure from create-failure; (ii) drop the parenthetical and print only what was observed.

**Recommendation: (ii) first, (i) when the race is settled.** (ii) is one line and removes a false diagnosis immediately. (i) is the better message and needs the race decision, because the two failure modes are the two candidate explanations for the race itself. Separately, the race's own status is **"moved or revealed, undetermined"** and settling it needs a clean A/B — revert the fix, re-run the same six-run protocol — which is cheap, unfunded, and nobody has done it. That is a lane's job, not a ruling; it is listed here only because it is the prerequisite for (i).

**Ruling (ii) is implemented — 2026-09-18, commit `0384d6681`, no owner input needed.** All **seven** arms were corrected, not only the one quoted above: the `unreachable` parenthetical is gone from `crates/kasirmu-api/src/pg_tests.rs`, and each arm now prints the observation (`… skipped: throwaway_test_pool returned None ({url})`). Two facts found while doing it, both of which strengthen the case and neither of which was in this entry: (a) `raw_pool:153` **already** prints the real error (`PG integration: admin pool get failed: {e}`) before returning `None`, so for a genuine connection failure the parenthetical was a *worse duplicate* of a message already on stderr; (b) the file's own older arms already used the correct shape — `:236`, `:901`, `:1340` name the stage and carry the server error — so the parenthetical was the outlier against this file's own convention, not a convention. The helper's doc block (`:174`) now records the contract: `None` comes from four stages and the last three are **silent**. **(i) remains open and still needs the race A/B** — nothing here changes that.

---

## Program-level and housekeeping

### R18 — Should the program doc be split?

**What is blocked.** Dispatch ergonomics. `todo-open-debt-program.md` carries 29 open boxes across five phases, each with its own fence and one owner ruling.

**Options.** (i) Split by phase into `todo-open-debt-agents-N.md`; (ii) keep one file.

**Recommendation: (i), and the file already says why.** Its own `:18` records that the fences already partition the tree, so no cross-file coordination is lost, and `:19` records that there is no program-level command — which is the whole reason a single filename misleads. Do not split by *task*, only by phase.

### R19 — Should the commit-scope token have an allowlist?

**What is blocked.** Nothing; recorded as an open item. `.githooks/commit-msg` enumerates types but leaves the scope as "non-empty and parenthesis-free", with no allowlist — its own comment says "Optional scope". A typo in the area is accepted silently.

**Recommendation: leave it permissive.** An allowlist needs maintenance and the rebrand is still moving names — the same rename that made this document necessary would make a hard-coded area list wrong twice over.

### Housekeeping — not rulings, but they will be asked about

- **`skill-drift-report.md` is a stray root file** tripping `verify-root-policy.py` (1 finding). Either add it to `ROOT_FILE_ALLOWLIST` in `scripts/verify-root-policy.py` or move it. It is the only root-policy finding on the tree.
- **`.agents/skills/northflank-deploy-diagnosis/` is untracked** (`??`). Commit or delete — an untracked skill is invisible to everyone but the session that wrote it.
- **The same name-rot this document's sibling was just cured of is live in 12 other docs.** `check-dead-refs.py` (`.agents/skills/docs-auditor/scripts/check-dead-refs.py`) reports **22 unresolved references in 12 live docs**, and the census of the targets is the rebrand, not a mystery: `crates/oz-bridge/src/topology` (4), `crates/oz-core/src/ozpkg.rs` (2), `crates/oz-core` (2), `crates/oz-bridge/src` (2), `crates/oz-api` (2), then one each for `crates/oz-security`, `oz-plugin`, `oz-lua`, `oz-hal`, `oz-crypto/src`, `oz-core/migrations`, `oz-bridge`. Three more are restructure casualties rather than renames — `ui/src/locales` (P9a moved the `.ftl` corpus to `shared-ui/locales/`), `ui/src/frontend`, `platform/ui`. Worst hit: `docs/security/data-residency-and-retention.md` (3) and `docs/security/lua-sandbox-audit.md` (2). **This is mechanical, not a ruling** — the header name map in `todo-open-debt-program.md` is reusable as the lookup table, and `crates/oz-core/src/ozpkg.rs` needs a real answer rather than a rename, because no `ozpkg.rs` exists under any name in `crates/kasirmu-core/src/`.
- **`AGENTS.md` is 16,805 bytes against a guidance cap it is meant to respect**, so its tail is being truncated in agent context. This has been flagged across sessions and is unaddressed; the fix is consolidation, not a bigger cap.
- **`AGENTS.md` §4 points at `check-dead-refs.py` as though it were in `scripts/`**; it actually lives at `.agents/skills/docs-auditor/scripts/check-dead-refs.py`. The rule still holds — the `todo-`/`plan-`/`prd-` token is what exempts a doc — but the path in the guidance is wrong.
- **The dead-class campaign's five boxes** (`:400`-`:405` in the pre-refresh numbering) are **analysis debt, not rulings**: they record that 84 class names still survive on a prefix alone, that the widening is permissive by design, that one of four shipped mechanisms has zero real sites, and that two censuses of overlapping names disagree. No decision is being withheld; they need a lane, not a ruling.

---

## If you rule on only three

**R10** (which shell's gate set is authoritative) — it unblocks ~16 doors, it is the only item with a security consequence either way, and it is the reason five modules have been stuck for a week. **R3** (default-role seeding) — it is the only item here with a *live symptom* rather than a divergence: the mobile shell has zero production callers of the seeder and does not register the command that would seed on demand. **R5** (the organisation axis) — one binary question, *does any customer need a role that spans stores?*, and the answer decides whether Phase 3b is a design doc or a closure.

**A cheap fourth — R20** (the home Tools grid's vocabulary). It blocks all of Phase 3a.2, and unlike the three above it needs no design and no migration: the code is *already* consistent (0 of 17 violations, test-enforced), so the ruling is only about which vocabulary the front door should speak. It is answerable in one sentence and it is the difference between a two-line citation fix and a deliberate authorisation widening.
