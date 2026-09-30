# Phase 1 Implementation Tickets — Modular Scaffolding

**Status:** Draft for execution (2026-10-02) — tickets only, no code changed by this document
**Scope:** Immediate Next Action #5 of the modular scaffolding plan (`todo-modular-scaffolding.md` §14).
Turns the five bullets of that action into tickets with acceptance criteria, evidence commands, and the
repository paths each one touches.

**Predecessors:**
- `docs/architecture/handler-census-phase0.md` — the classified handler population (Action #1).
- `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` — the seam vocabulary, D1–D8 (Action #2).
- `docs/architecture/module-namespace-governance.md` — the Phase 1 rules and table-ownership map (Action #3).
- `docs/architecture/namespaced-store-api-draft.md` — the Phase 2 API shape these tickets feed (Action #4).

**Grounding rule (learned in Phase 0):** every ticket names a repository fact verified at the time of
writing. The plan's prose is *not* treated as evidence — the Phase 0 census falsified one of its claims
(`InventoryStockHandler` 'is not orphaned') and that correction is carried through here.

---

## 1. How these tickets map to the plan

| Plan §14 #5 bullet | Ticket |
|---|---|
| Census tooling | T1 — automate the handler census |
| Handler metadata | T2 — carry `handler_type` on the handler |
| Lint rules | T3 — classify-at-registration + Rule 1 ergonomics |
| Documentation updates | T4 — reconcile the plan and stale diagrams |
| Reporting facade inventory | T5 — inventory the facade and the two facade-bypass edges |

Each ticket is sized to be independently reviewable and independently revertible. None is a prerequisite
for the others except where a `Depends on` line says so.

---

## 2. T1 — Census tooling (automate what Phase 0 did by hand)

**Problem.** The Phase 0 census (`docs/architecture/handler-census-phase0.md`) was produced by hand: grep
for `impl EventHandler`, then read each site to decide live/dead. It found one dead handler the plan
asserted was live. A hand census drifts the moment someone adds a handler, and the drift is silent.

**What already exists (verified):**
- `scripts/handler-classification.json` — the registry, 12 handler types, each with `name`, `category`,
  `topic`, `site`, `note`. Populated from the census.
- `scripts/verify-namespace-governance.py` — already scans for `impl EventHandler<T>` across
  `HANDLER_ROOTS = ('modules', 'platform', 'crates')` and fails Rule 2 when a type is absent from the
  registry. It does **not** re-grade existing rows (deliberate).

**Gap.** The checker detects a *new* handler but nothing detects a *stale* row: a handler renamed, moved,
or deleted leaves `site` pointing at a line that no longer declares it, and the census table in the doc
goes out of date with no signal.

**Ticket T1 — make the census re-derivable.**

1. Add `--census` (report-only) to `scripts/verify-namespace-governance.py`: emit the registry rows joined
   against the impls actually found, flagging: a `site` file missing or the named line no longer inside an
   `impl EventHandler` block (stale row); an impl found in a production file that is not in the registry
   (already Rule 2); a registry row whose type is no longer found at all (retired candidate).
2. Add `--emit-census` to print a Markdown table in the exact shape of `handler-census-phase0.md` §3, so
   the doc table can be regenerated rather than hand-edited (`scripts/generate-records-index.mjs` is the
   house precedent for a generator with a `--check` mode).
3. Add a self-test case: a fixture registry row with a doctored `site` must produce exactly one stale-row
   finding. **A gate that cannot fail is not a gate** — the Phase 1 checker shipped four bugs the first
   time precisely because this was skipped.

**Files:** `scripts/verify-namespace-governance.py`; `scripts/handler-classification.json` (schema
unchanged); `scripts/check.sh` (only if a new mode needs wiring); `scripts/gates.json` (note update).

**Acceptance criteria:**
- `python scripts/verify-namespace-governance.py --census` exits 0 on a clean tree and lists 0 stale rows.
- Exactly one hand-introduced stale `site` produces exactly one finding.
- `--emit-census` output, pasted over the census doc's table, is byte-identical to the committed table, or
  the differences are enumerated as intentional (the check is the point, not the diff).

**Standing caution (carried from the checker's own history):** the scanner must keep reading table names
*out of Rust string literals* and must stay lifetime-aware for `<'a>`. Two of the four Phase 1 checker bugs
were in this masker; a 'simplification' here would silently zero the findings.

**Depends on:** nothing (uses the existing registry). **Blocks:** T2 in spirit.

**Status: DONE 2026-10-02** (`scripts/verify-namespace-governance.py`). `--census` and `--emit-census`
ship report-only (always exit 0); a self-test proves a doctored site yields exactly one stale row. Clean-tree
`--census`: 12 registry rows, 0 stale, 0 retired, 0 unclassified. Two pre-existing masker bugs surfaced and
were fixed (a backslash-newline line continuation inside a string dropped its newline, shifting every later
line by one in `crates/kasirmu-lan/src/lib.rs`; Rust raw strings were not handled, blanking every impl in
`crates/kasirmu-lan/src/kds_sync.rs`). Fixing them raised the counted population from 14 to 15
`impl EventHandler` sites — `KdsSyncHandler` at `crates/kasirmu-lan/src/kds_sync.rs:245` had been silently
missed. Acceptance #3 difference is intentional: the emitted table uses the ticket's six columns
(Handler, Category, Subscribed topic(s), Site, Note, Status), while `handler-census-phase0.md` §3 carries
Registrant/Class/Live instead of Site/Status; this mode adds the tree-resolution verdict the hand table lacked.

---

## 3. T2 — Handler metadata (`handler_type` on the handler)

**Problem.** ADR-62 D4 requires every handler to *carry* a `handler_type` from the enum
`{command_contributor, projection_subscriber, query_facade, lifecycle, plugin_bridge, internal_helper}`.
Today the classification lives **only** in `scripts/handler-classification.json`, keyed by type name. The
Rust type itself declares nothing, so the JSON and the code can disagree with nothing reconciling them, a
reader of `platform/startup/src/event_handlers.rs:44` cannot tell `SaleSyncEnqueuer` is a projection
subscriber without opening the registry, and §11.3 wants the metadata *on the type*, not beside it.

**What exists (verified):** `platform/startup/src/event_handlers.rs` — `SaleSyncEnqueuer` :44,
`InventorySyncEnqueuer` :143/:182, `AuditLogHandler` :236/:306/:352, `LoyaltyEarnHandler` :415,
`SettingsUpdatedHandler` :482. `crates/kasirmu-notification/src/handlers.rs` — `OrderConfirmationHandler`
:80, `PaymentReceiptHandler` :241, `StockLowAlertHandler` :166. `crates/kasirmu-lan/src/lib.rs` —
`SaleCompletedHandler` :978, `CourseFiredHandler` :994; `crates/kasirmu-lan/src/kds_sync.rs` —
`KdsSyncHandler` :245. The kernel's `EventHandler` trait is the natural home for a defaulted constant.

**Ticket T2 — declare the classification on the type, derive the registry from it.**

1. In the kernel crate (where `EventHandler` is defined), add a provided associated constant, e.g.
   `const HANDLER_TYPE: HandlerType = HandlerType::InternalHelper;`, with a `HandlerType` enum mirroring the
   ADR-62 D4 six. Defaulting to `internal_helper` means existing impls keep compiling.
2. Override `HANDLER_TYPE` on all 12 registered handler types to the category the registry already assigns
   (the census is the source; T2 does not re-decide categories).
3. Extend T1's emit path so `scripts/handler-classification.json` is **generated** from the Rust constants,
   with `--check` failing when the committed JSON drifts. The JSON stays as a reviewable artifact but stops
   being hand-maintained.

**Why a trait constant and not an attribute macro:** no new dependency (C3 in the NamespacedStore draft),
and the plan's Phase 4 target is a compile-time or boot-time error where practical — a constant is the
smallest step that reaches 'declared on the type' without a proc-macro crate.

**Files:** the kernel trait definition; `platform/startup/src/event_handlers.rs`;
`crates/kasirmu-notification/src/handlers.rs`; `crates/kasirmu-lan/src/lib.rs`;
`crates/kasirmu-lan/src/kds_sync.rs`; `scripts/handler-classification.json` (becomes generated);
`scripts/verify-namespace-governance.py` (new `--emit-registry`/`--check`).

**Acceptance criteria:**
- `cargo check` across the affected crates is clean; no behaviour change.
- Flipping one `HANDLER_TYPE` by hand makes the checker's `--check` mode fail, naming the type and the diff.
- `InventoryStockHandler` keeps `internal_helper` **and its dead/test-only note** — re-categorising it to a
  seam category would resurrect the false 'active' claim the census retired.
- The registry JSON after regeneration is semantically identical to the committed one.

**Depends on:** T1 (the emit path). **Blocks:** §11.3 (the required-classification gate).

**Status: DONE 2026-10-02.** `foundation::contracts::HandlerType` mirrors the ADR-62 D4 six and
`EventHandler` provides `fn handler_type(&self) -> HandlerType` (default `InternalHelper`). It is a
`&self` method, not an associated const: the trait is used as `Box<dyn EventHandler<E>>` in
`platform/kernel/src/event_bus.rs`, and a const made it not dyn-compatible (E0038) — the first attempt
failed `cargo check` for exactly that reason. All 12 registered types override it (15 impl blocks,
since `InventorySyncEnqueuer` and `AuditLogHandler` each have several); `InventoryStockHandler` keeps
`InternalHelper` and carries an in-code comment saying it is deliberately not a seam. The checker gained
`--emit-registry` and `--check`: the registry's `category` is now generated from the Rust while
topic/site/note/order are kept from the committed file, so `--check` compares bytes and a hand-flip of one
`handler_type` fails with `[drift] SaleSyncEnqueuer: registry says 'projection_subscriber', Rust
handler_type says 'command_contributor'`. The registry matched on the first run; adding the method shifted
7 impl lines, which the T1 census caught as 7 stale rows before they were re-pointed — the two tickets
validating each other. `scripts/handler-classification.json` is byte-identical after regeneration.

---
## 4. T3 — Lint rules (make Rule 1 bearable, keep it honest)

**Problem.** Rule 1 ('no new cross-vertical raw SQL') is enforced by
`scripts/verify-namespace-governance.py`, which finds SQL by scanning **string literals** in production
module sources and matching table names against `TABLE_OWNERS`. Two ergonomic gaps make it easy to work
around instead of with:

1. **No escape hatch that is not the baseline.** The only way to land a legitimate new cross-vertical read
   today is to edit `scripts/namespace-governance-baseline.json` — an opaque `(rule, path, target)` tuple
   list with no owner, date, or expiry by design. That is fine for *freezing pre-existing debt*, but it is
   the wrong shape for *granting new access*, because the grant is invisible at the call site.
2. **No in-code marker.** A reviewer reading `modules/loyalty/src/repository.rs:59` sees a raw `SELECT`
   against `gift_cards` with nothing pointing at the governance doc or the grant.

**Verified facts the ticket rests on:**
- The two frozen edges are exactly: `modules/reporting/src/repository.rs:34` → `sales` (owner sales), and
  `modules/loyalty/src/repository.rs:59` → `gift_cards` (owner giftcards; `loyalty` declares only `[crm]`).
- Both are *reads*. There is no production cross-vertical *write* today — so T3 does not need a write grant
  vocabulary yet, and should not invent one.
- `modules/reporting/src/repository.rs` is scheduled to migrate onto the facade by the NamespacedStore
  draft §5 row 2.4; the reporting edge therefore wants a *retirement* path, not a permanent grant.

**Ticket T3 — a call-site marker that the checker verifies against a grant.**

1. Define an in-code comment form, e.g. `// namespace: cross-vertical read <table> granted (<reason>)`,
   placed on or immediately above the statement that crosses. The checker already parses SQL literals with
   line numbers, so it can associate the marker with the reference it excuses.
2. A cross-vertical reference is allowed **iff** it carries the marker *and* the marker is sane (names the
   target table). A marker on an *own-table* reference is a finding (stale grant), so markers self-expire
   when a module reclaims its own read.
3. Keep `scripts/namespace-governance-baseline.json` **only** for the two pre-existing edges, and
   additionally require them to carry markers. That way the baseline shrinks to zero as the draft's
   migration order lands — success is visible as an empty file, not a hidden tuple.
4. Self-test: a fixture reference with no marker → fail; with a matching marker → pass; with a marker for
   the wrong table → fail.

**What T3 must NOT do:** it must not make the two known edges newly *permitted* in a way that lets a third
hide behind the same wording. The marker is a named exception with a reason in the source, reviewed like
code — that is the whole point over a silent baseline edit.

**Files:** `scripts/verify-namespace-governance.py`; `modules/loyalty/src/repository.rs` and
`modules/reporting/src/repository.rs` (add markers); `scripts/namespace-governance-baseline.json`;
`docs/architecture/module-namespace-governance.md` §4 (document the marker grammar).

**Acceptance criteria:**
- The two known edges each carry a marker; `python scripts/verify-namespace-governance.py` still exits 0.
- Removing one marker turns the run red naming that file:line and its target.
- A new unmarked cross-vertical read is a *blocking* finding (exit 1), not informational.
- `--self-test` covers marker-present, marker-absent, and marker-wrong-table.

**Status: DONE 2026-10-02.** `GRANT_MARKER_RE` accepts
`// namespace: cross-vertical read <table> granted (<reason>)` and must sit within a four-line window
*above* the statement; `grant_for(table, literal_start, markers)` matches the marker to the table the
literal actually names. `apply_baseline` now splits three ways: a marker-granted reference is
*tracked/granted* (baselined or not), a baselined reference with no marker is **blocking** with the
missing marker named as the remediation, and a marker on an own-table reference is a new `stale-grant`
verdict. Both frozen edges (`modules/reporting/src/repository.rs:34`, `modules/loyalty/src/repository.rs:59`)
now carry markers and the run is green. The check exposed one pre-existing bug: a partial-clause literal
(`"FROM sales WHERE …"`) did not match the SELECT-anchored verb regex and was silently treated as prose,
so both edges were invisible to the gate before T3; `SQL_FRAGMENT_RE` now recognises a leading
FROM/JOIN/UPDATE/DELETE FROM clause. `--self-test` covers no-marker/wrong-table/below-statement/stale-grant
and the fixture drives the real `module_sql_findings`.

**Depends on:** nothing. **Constraint:** Rule 1 stays *soft* in Phase 1; no new gate ID beyond the existing
`namespace-governance`.

---

## 5. T4 — Documentation updates (retire the claims the census falsified)

**Problem.** The Phase 0 census corrected a plan claim that is still printed in several places. Docs that
assert a dead handler is live are exactly the 'aspirational structure' §13 of the plan forbids.

**Stale claims, each verified:**

| Location | Stale claim | Corrected fact (from the census) |
|---|---|---|
| `todo-modular-scaffolding.md` §14 item 1 ('Explicitly confirm `InventoryStockHandler` is active') | asserts it is active | it is **dead/test-only** — constructed nowhere in production; only referenced from `modules/inventory/src/handlers_tests.rs` |
| `todo-modular-scaffolding.md` §15 ('`InventoryStockHandler` is retained.') | retention as a live-seam policy | retained *as a classified test-only type*, not as a running handler |
| `todo-modular-scaffolding.md` §10 Phase 0 ('Confirm `InventoryStockHandler` remains active and documented') | same | same |
| `docs/architecture/MODULAR_APP_PLAN.md:77` ASCII diagram | still shows `SaleCompletedReporter` | removed under MSL-11; `modules/reporting/src/handlers.rs:3` and `modules/reporting/README.md:11,:40` record the removal |

**Ticket T4 — reconcile the docs with the census, without rewriting history.**

1. In `todo-modular-scaffolding.md`, do **not** delete the sentence in §15 — annotate it. The plan is the
   document that was wrong; a reader must be able to see the correction. House style is a dated
   supersession marker in place (see the `docs/plans/_active/todo.md` header for the pattern).
2. §14 item 1 and §10 Phase 0: change 'confirm it is active' to 'confirm its status against the census',
   so the instruction no longer presumes the answer.
3. `docs/architecture/MODULAR_APP_PLAN.md:77`: annotate the diagram node, pointing at
   `docs/architecture/handler-census-phase0.md` for the current handler set. Do not silently redraw the
   diagram — the same supersession-marker convention applies.
4. Add a one-line pointer from `docs/architecture/MODULAR_APP_PLAN.md` (near the topology section) to
   `docs/architecture/module-namespace-governance.md` and `docs/architecture/namespaced-store-api-draft.md`,
   so the architecture doc does not read as the only source of truth for module structure.

**Why annotate instead of delete:** the Phase 0 census's value is partly that it *falsified* a written
claim. Deleting the claim hides the lesson; the plan's own §10 exit criterion ('dead-code claims in the
plan match the repository') is satisfied by a correction the next reader can see.

**Files:** `todo-modular-scaffolding.md`; `docs/architecture/MODULAR_APP_PLAN.md`.

**Acceptance criteria:**
- `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` stays clean on both files.
- `git grep -n "InventoryStockHandler" todo-modular-scaffolding.md` shows the correction, not a bare
  'active' assertion.
- `git grep -n "SaleCompletedReporter" docs/architecture/MODULAR_APP_PLAN.md` shows the removal note.
- `python scripts/verify-debt-markers.py` stays exit 0 (no new dangling pointer introduced by the edits).

**Depends on:** T1 optionally, for the corrected table content. Can be done in either order.

**Status: DONE 2026-10-02** (commit `e33dfb83a`). All 10 plan mentions annotated and the two stale diagram
nodes commented; the plan file itself was committed at the same time (it had been left out of its own commit
and `scripts/verify-root-policy.py` already allowlists it). Evidence: `check-dead-refs.py` clean on both files,
`verify-debt-markers.py` exit 0.

---

## 6. T5 — Reporting facade inventory

**Problem.** The plan's §9.5 target shape names a `ReportingFacade` trait with four methods
(`daily_revenue`, `sales_summary`, `product_sales`, `low_stock_alerts`). The facade **exists** as inherent
`impl` methods on `Store`, but (a) there is no trait, (b) the real surface is much larger than four
methods, and (c) one of the two facade-bypass edges lives in the reporting module itself. Before any
migration (draft §5 row 2.4), the facade needs an honest inventory — the same treatment the handler set
received in Phase 0.

**Verified facade surface** (`crates/kasirmu-core/src/db/reports/`, inherent methods on `Store`):

| Submodule | Public query methods (verified) |
|---|---|
| `revenue.rs` | `daily_revenue` :133, `weekly_revenue` :207, `monthly_revenue` :282 |
| `sales_summary.rs` | `hourly_heatmap` :171, `payment_method_breakdown` :204, `voided_sales_summary` :235, `voided_items` :264, `avg_basket_size` :295, `basket_size_trend` :321, `customer_split` :350, `discounts_summary` :394, `table_turnover` :452, `hourly_table_activity` :479 |
| `product_sales.rs` | `top_products` :151, `low_stock_alerts` :219 (**deprecated**), `low_stock_alerts_at_location` :258, `active_stock_alerts` :314, `acknowledge_stock_alert` :355, `category_breakdown` :376, `inventory_turnover` :434, `inventory_trend` :470 |
| `datetime.rs` | (date-range helpers; see `datetime_tests.rs`) |

Note the facade is **not read-only**: `acknowledge_stock_alert` writes. That contradicts a plain reading of
ADR-62 D5 ('reads through it, never writes') and must be resolved explicitly, not papered over.

**Ticket T5 — inventory and reconcile the facade, then stage the reporting migration.**

1. Produce a new inventory doc (to be created at `docs/architecture/reporting-facade-inventory.md`): for each public method above — owning
   submodule, the tables it reads/writes, and whether a *module repository* duplicates it. Cross-check the
   last against `modules/reporting/src/repository.rs` (the `generate_daily_report` facade-bypass edge at
   :33).
2. Decide and record the write question: either (a) D5 is amended to 'the facade may write only
   alert-acknowledgement state, and only its own', or (b) `acknowledge_stock_alert` is reclassified as a
   command contributor outside the facade. **Do not leave the write implicit.**
3. Reconcile §9.5's four-method target trait with the real ~24-method surface: state whether the trait is
   a *narrow* facade (four methods, the plan's intent) or a *mirror* of everything. Pick narrow; a trait
   that re-exports every inherent method adds an indirection with no boundary.
4. Sequence the migration: `generate_daily_report` (`modules/reporting/src/repository.rs:34`) is the one
   named candidate; list any *other* reporting-module query that names a foreign table, so §9.5's
   'no new direct SQL' becomes a checklist rather than an aspiration.

**Files:** a new inventory doc (to be created at `docs/architecture/reporting-facade-inventory.md`); possibly an amendment line in
`docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` D5 (if option 2a is chosen — an ADR edit, not a
silent doc change).

**Acceptance criteria:**
- Every public facade method above appears in the inventory with its tables.
- The write question has a recorded decision with a rationale, not a TODO.
- The reporting-bypass set is enumerated; every member is either baselined with a marker (T3) or ticketed.
- `check-dead-refs.py` clean on the new doc.

**Depends on:** T3 for the marker vocabulary on the baselined edges. **Blocks:** NamespacedStore draft §5
row 2.4 (the reporting migration).

**Status: DONE 2026-10-02.** [docs/architecture/reporting-facade-inventory.md](reporting-facade-inventory.md)
inventories all 24 public facade methods with their submodules, line numbers and tables. Corrections it
records: the surface is 24 methods not 4; the plan's claim that reporting reads `payments` through the
facade is false (no facade SQL names it); and the facade is not read-only. The write question is decided
(option 2a — narrow the exception to alert-acknowledgement state and amend ADR-62 D5, which was done).
The trait shape is decided NARROW (the plan's four methods; not implemented in Phase 1). The
reporting-bypass set has exactly one member (`modules/reporting/src/repository.rs:34`), already baselined
with a T3 marker, and is the sole migration target. Six facade-only tables with no ownership-map entry
(`refunds`, `refund_lines`, `kds_orders`, `categories`, `stock_thresholds`, `stock_alert_events`) are
surfaced as a follow-up rather than silently assigned.

---

## 7. Execution order and what 'Phase 1 done' means

**Suggested order:** T4 (docs-only, removes the false claims first) → T1 (census tooling) → T2 (metadata,
depends on T1's emit path) → T3 (lint marker) → T5 (facade inventory). T4 and T5 are independent of the
tool chain and can run in parallel.

**Definition of done for Phase 1** (from the plan's §10 exit criteria, mapped to evidence):

| Plan exit criterion | Ticket(s) that satisfy it |
|---|---|
| Checkout remains synchronous and transactional | untouched by all five tickets (no checkout code changes) |
| Existing handlers continue to work | T2 is a metadata-only change; `cargo check` + the existing handler tests |
| New code is prevented from worsening cross-vertical coupling | T3 (rule now needs a marker), T1 (stale rows detected) |
| The team has a written seam taxonomy | done — ADR-62 (Action #2) |
| Reporting has a documented exception path | T5 (facade inventory + the write decision) |

**Explicitly out of scope** (Phase 2+, per the NamespacedStore draft): any runtime namespace enforcement,
any second connection, `ModuleContext`, and the strict gate IDs §11.3–§11.5. These tickets prepare Phase 1
only; they add no enforcement beyond the existing soft `namespace-governance` gate.

---

## 8. Open questions for the reviewer — RESOLVED 2026-10-02

1. **T2 metadata home.** RESOLVED: neither a trait associated constant nor a proc-macro. An associated
   const makes `EventHandler` not dyn-compatible (`platform/kernel/src/event_bus.rs` stores
   `Box<dyn EventHandler<E>>`; E0038), so T2 ships an object-safe provided method
   `fn handler_type(&self) -> HandlerType`. No new dependency. See the T2 status paragraph.
2. **T3 marker syntax.** RESOLVED: `// namespace: cross-vertical read <table> granted (<reason>)`, matched
   outside SQL literals by `GRANT_MARKER_RE` within a four-line window above the statement. No collision
   with the string masker (verified by `--self-test`). See the T3 status paragraph.
3. **T1 census table ownership.** RESOLVED: stays hand-written. `--emit-census`/`--census` are an audit aid
   (report-only, never fails); the census doc is the narrative and the registry JSON is the machine copy.
   `--check` guards the *registry*, not the prose table.
4. **T5 write decision.** RESOLVED by decision (option 2a): amend ADR-62 D5 to permit the facade to write
   only alert-acknowledgement state on the alert tables it already reads; `acknowledge_stock_alert` stays
   on the facade. Rationale in
   [reporting-facade-inventory.md](reporting-facade-inventory.md) §4. The D5 amendment is committed. A
   human may still prefer 2b later, but Phase 1 no longer leaves the write implicit.

---

## References

- `todo-modular-scaffolding.md` §14 item 5 (this action), §10 Phase 1 exit criteria, §11.1–§11.5 (gates),
  §9.5 (reporting facade)
- `docs/architecture/handler-census-phase0.md` (Action #1 deliverable)
- `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` (D1–D8)
- `docs/architecture/module-namespace-governance.md` (Rules 1–3, ownership map §3, inventory §4)
- `docs/architecture/namespaced-store-api-draft.md` (§5 migration order, C1–C3)
- `scripts/verify-namespace-governance.py`, `scripts/handler-classification.json`,
  `scripts/namespace-governance-baseline.json`
- `platform/startup/src/event_handlers.rs`, `crates/kasirmu-notification/src/handlers.rs`,
  `crates/kasirmu-lan/src/lib.rs`
- `crates/kasirmu-core/src/db/reports/{revenue,sales_summary,product_sales,datetime}.rs`
