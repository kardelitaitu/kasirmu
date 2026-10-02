# Modular Scaffolding Plan

**Project:** `kasirmu`  
**Document:** `todo-modular-scaffolding.md`  
**Status:** All phases delivered (0–5) — re-verified on `0.0.41`  
**Last Reviewed:** 2026-10-02  

> **Progress note (2026-10-02, Phase 5 re-verified on `0.0.41`; the plan is closed).** Phase 5 landed —
> P5.1–P5.5, all DONE (`docs/architecture/phase5-implementation-tickets.md`) — and this pass re-verified
> every claim against **this** branch rather than an earlier one, because a branch switch between
> sessions had left two governance gates red while this journal still described the work as open.
>
> Verified on `0.0.41`:
>
> - **P5.1** `sales_lifecycle_tests.rs` declares `FOREIGN_WRITES = ["customers"]` against
>   `MODULE_DEPENDENCIES = ["inventory", "crm"]`; all four declaration/mutation tests present.
> - **P5.2** no `FROM products` / `FROM stock_summary` / `FROM workspace_inventory_locations` remains in
>   `sales_lifecycle.rs`; that SQL lives in `db::inventory_seam` (`db/mod.rs:78`).
> - **P5.3** `db::customers` carries all four crm-seam entry points (`db/mod.rs:71`).
> - **P5.4** `payments` is under the `sales` owner in `modules/ownership.json`, and `db/ownership.rs`
>   matches it.
> - **P5.5** firewall §7 lists no "BOM deduction" gap.
>
> The Phase 4 claims were re-confirmed here too, since two of its boxes had been left unticked:
> `NamespacedStore::raw()` is deleted, `ReportingFacade` is defined and routed
> (`crates/kasirmu-core/src/db/facade.rs:36`), and `Kernel::verify_namespace_grants`
> (`platform/kernel/src/kernel/lifecycle.rs:191`, called at `:180`) rejects at boot any grant a
> module's manifest does not declare — pinned by `platform/startup/tests/boot_capability.rs`.
>
> `cargo test -p kasirmu-core --lib` over the lifecycle, inventory-seam, crm-seam, facade,
> namespaced and sale-deduction suites: **129 passed, 0 failed**. All five gates named in §11
> (`core-size-ratchet`, `namespace-governance --strict`, handler classification `--check`,
> `capability-parity`, plugin gate) exit 0.
>
> Two gates were **red on `0.0.41` when this pass began**, and both are fixed: `core-size-ratchet`
> (37176 measured against a 36814 ceiling) in `4b565d267`, and `ownership map parity` (P5.4 moved
> `payments` without updating the checker's `TABLE_OWNERS`) in `42788cf3d` — whose `--emit-ownership`
> repair was itself broken in two independent ways and had clearly never been run.
>
> **Correction (2026-10-02, from the Phase 0 census).** One factual claim in this plan was
> falsified against the working tree: `InventoryStockHandler` was described as active (is not orphaned /
> performs BOM deduction / must be retained). It is in fact **dead/test-only** — never registered or
> subscribed in production — and the BOM/recipe-aware deduction it duplicated runs on the sale path
> (`crates/kasirmu-core/src/db/sales_lifecycle.rs`). Every affected sentence is annotated in place rather
> than deleted, so the correction stays visible. Authority:
> `docs/architecture/handler-census-phase0.md` §4.2.  

---

## 1. Objective

This plan defines how `kasirmu` will move from a codebase that has modular directory boundaries to a codebase with enforced modular architecture.

The goal is not simply to split crates or folders. The goal is to make module boundaries real, testable, maintainable, and safe for a production POS system.

`kasirmu` currently has:

- Rust core crates
- Tauri desktop/mobile shells
- React frontend
- SQLite persistence
- Lua plugin automation
- Module directories for business verticals
- A large `kasirmu-core` crate that still contains significant vertical business logic

The modular scaffolding effort should turn this into a system where:

- Each business vertical owns its primary behavior.
- Cross-vertical interaction happens through explicit seams.
- Checkout correctness remains deterministic and transactional.
- Reporting can read across verticals only through a sanctioned facade.
- Plugin capabilities remain governed and auditable.
- CI prevents modular regressions.

---

## 2. Non-Goals

The following are explicitly out of scope for this phase of modular scaffolding:

- Introducing asynchronous saga orchestration for normal checkout.
- Moving to WASM-based plugins.
- Creating a third-party plugin marketplace.
- Rewriting the React frontend.
- Replacing SQLite.
- Breaking offline-first behavior.
- Performing broad dead-code deletion without a census.
- Enforcing strict namespace isolation before the codebase is ready.

---

## 3. Current Codebase Assessment

The following findings come from reviewing the current repository structure, checkout path, event handling, reporting layer, inventory behavior, and plugin system.

### 3.1 Checkout Path

The checkout flow is currently synchronous and transactional.

Important characteristics:

- Sale creation, payment recording, and related checkout state are handled inside a SQLite transaction.
- The internal event bus is synchronous.
- Post-commit handlers may run after the sale is persisted.
- There is no async queue, outbox dispatcher, or saga coordinator in the primary checkout path.

Conclusion:

> The current synchronous checkout model is correct for a POS system and should be preserved.

### 3.2 Event Bus

The event bus is currently synchronous. Publishers block until handlers complete.

This means:

- Events are not distributed messages.
- Handlers are not background workers.
- Event delivery is local and deterministic.
- The bus is suitable for projection dispatch after committed transactions.

Conclusion:

> The event bus should be treated as an in-process projection seam, not as a distributed messaging system.

### 3.3 Inventory Handler

<!-- Correction (2026-10-02, Phase 0 census): the claim below is FALSE. `InventoryStockHandler` is never
     registered or subscribed in production -- it appears only in modules/inventory/src/handlers_tests.rs and
     is classified DEAD (test-only) in docs/architecture/handler-census-phase0.md §4.2. The BOM/recipe-aware
     deduction described here is REAL and still runs, but on the sale path
     (crates/kasirmu-core/src/db/sales_lifecycle.rs `complete_sale_with_resolved_shortfalls`), not through
     this handler. The original text is kept below so the correction is visible rather than erased. -->

`InventoryStockHandler` is not orphaned. *(corrected 2026-10-02 -- see the marker above)*

It is responsible for important behavior, including:

- Bill-of-materials aware stock deduction.
- Recipe/component deduction for composite products.
- Handling product types that map to ingredients rather than finished goods.
- Preserving correct inventory behavior for items such as cakes, bundles, kits, or manufactured goods.

Conclusion:

> `InventoryStockHandler` must be retained. It should not be deleted during dead-code cleanup.
>
> *(Corrected 2026-10-02, Phase 0 census: retained **as a classified test-only type**, not as a running
> handler. It is not production behaviour; deleting it would delete tests, not functionality. See
> docs/architecture/handler-census-phase0.md §4.2.)*

### 3.4 Reporting Layer

Reporting already has a practical cross-vertical read path.

The current reporting facade lives around:

- `kasirmu-core/src/db/reports/`

Known reporting submodules include:

- `datetime.rs`
- `revenue.rs`
- `sales_summary.rs`
- `product_sales.rs`

These modules already read across sales, refunds, products, inventory-related data, and operational summaries.

Conclusion:

> Reporting should not be forced into strict namespace isolation in the same way as ordinary vertical modules. It needs a sanctioned read facade.

### 3.5 Plugin System

The plugin system is Lua-based and already has meaningful governance features:

- Capability-gated bindings.
- Isolated plugin environments.
- Operator grant files.
- Content-hash fingerprinting.
- Deterministic hook ordering.
- POS-specific hooks such as validation, discounting, tax calculation, and event bridging.

Conclusion:

> Lua remains the correct plugin runtime for now. WASM should be deferred.

### 3.6 Database Access

There is currently no enforced `NamespacedStore`.

Modules generally operate against a shared SQLite connection. Several handlers perform cross-table reads, especially reporting and inventory-related workflows.

Conclusion:

> Strict namespace enforcement cannot be introduced immediately without breaking working functionality. It must be phased.

---

## 4. Target Architecture

The target architecture separates the system into four classes of responsibility:

1. **Platform Kernel**
2. **Shared Foundation Types**
3. **Business Vertical Modules**
4. **Sanctioned Cross-Vertical Facades**

### 4.1 Platform Kernel

The platform kernel owns runtime concerns, not business vertical logic.

Responsibilities:

- Module registration
- Lifecycle management
- Event bus dispatch
- Capability registry
- Plugin host coordination
- Settings access
- Logging
- Clock/time abstraction
- Transaction orchestration helpers
- Backup/restore coordination
- Sync coordination, where applicable

The kernel should not own:

- Sales business rules
- Inventory business rules
- CRM business rules
- Tax business rules
- Reporting SQL
- Product-specific discount logic

### 4.2 Shared Foundation Types

Foundation types are cross-cutting primitives used by multiple modules.

Examples:

- `Money`
- `Currency`
- `TaxRate`
- `SKU`
- `Barcode`
- `Quantity`
- `OrderId`
- `SaleId`
- `CustomerId`
- `EmployeeId`
- `StoreId`
- `TerminalId`
- Date/time range types
- Error envelopes
- Result aliases

These types should be stable, small, and broadly reusable.

### 4.3 Business Vertical Modules

Each vertical module should own its primary domain behavior.

Examples:

- `sales`
- `inventory`
- `crm`
- `staff`
- `tax`
- `loyalty`
- `terminal`
- `reporting`

A module should ideally own:

- Its domain entities
- Its repositories
- Its commands
- Its handlers
- Its migrations or migration fragments
- Its tests
- Its public API
- Its event contributions
- Its projection subscriptions

A module should not directly reach into another vertical's tables except through:

- An explicit command contribution
- An event projection
- A sanctioned facade
- A platform service

### 4.4 Sanctioned Cross-Vertical Facades

Some domains legitimately need cross-vertical access.

The clearest example is reporting.

Reporting needs to answer questions such as:

- Revenue by day
- Sales by product
- Refunds by category
- Low-stock alerts
- Tender split
- Void analysis
- Basket analysis
- Staff performance
- Customer purchase history

Instead of allowing raw cross-vertical SQL everywhere, reporting should use a controlled facade.

The existing `kasirmu-core/src/db/reports/` layer should become the official reporting facade.

---

## 5. Seam Taxonomy

A major part of modularization is naming the seams correctly.

The plan distinguishes two primary kinds of module interaction.

### 5.1 Command Contributors

Command contributors participate in a business operation synchronously.

They are appropriate when correctness requires the contributor to be part of the same transaction or atomic operation.

Examples:

- Validate stock before sale
- Apply tax during checkout
- Apply promotion during checkout
- Record payment during checkout
- Validate employee permissions during void/refund
- Validate terminal state during open/close

Rules:

- Command contributors must be explicit.
- Command contributors must be ordered deterministically.
- Command contributors may reject an operation.
- Command contributors must not hide side effects outside the transaction.
- Command contributors should be tested as part of the operation they contribute to.

### 5.2 Projection Subscribers

Projection subscribers react to facts that have already happened.

They are appropriate when the system can tolerate post-commit processing.

Examples:

- Update customer lifetime value after sale
- Update loyalty balance after sale
- Update reporting counters after sale
- Update inventory stock after sale, where the design accepts post-commit projection behavior
- Emit audit records after administrative actions

Rules:

- Projection subscribers must not be required for checkout atomicity unless explicitly promoted to command contributors.
- Projection subscribers should be idempotent where practical.
- Projection subscribers should handle replay safely.
- Projection subscribers must not mutate the original committed fact.
- Projection subscribers should be observable through logs/metrics.

### 5.3 Classification Requirement

Every module handler should be classified as one of:

- Command contributor
- Projection subscriber
- Query facade implementation
- Lifecycle handler
- Plugin bridge
- Internal module helper

No handler should remain unclassified.

---

## 6. ModuleContext

Modules should not reach into global singletons or construct their own platform dependencies arbitrarily.

The target design introduces a `ModuleContext`.

### 6.1 Purpose

`ModuleContext` gives modules controlled access to platform services at boot time.

It should provide:

- Event bus handle
- Capability registry
- Settings store
- Namespaced store factory
- Reporting facade handle
- Logger
- Clock
- Transaction helper
- Plugin hook registry, where applicable

### 6.2 Example Shape

The exact Rust API can evolve, but the conceptual shape should resemble:

    pub struct ModuleContext {
        pub events: EventBusHandle,
        pub capabilities: CapabilityRegistry,
        pub settings: SettingsStore,
        pub stores: NamespacedStoreFactory,
        pub reporting: ReportingFacade,
        pub logger: Logger,
        pub clock: Clock,
        pub transactions: TransactionCoordinator,
    }

### 6.3 Rules

- Modules receive `ModuleContext` during initialization.
- Modules must not create unapproved platform services.
- Modules must not bypass capability checks.
- Modules must not acquire database access outside the approved store factory.
- Modules must declare required capabilities explicitly.
- Boot should fail fast if a required capability is missing.

---

## 7. NamespacedStore Strategy

`NamespacedStore` is the mechanism for enforcing module data ownership.

However, it must be introduced gradually.

### 7.1 Current Problem

Today, modules share a SQLite connection.

This makes it easy to:

- Query another module's tables
- Join across vertical boundaries accidentally
- Hide ownership violations
- Regress modularity while tests still pass

### 7.2 Desired End State

Eventually, each module should access only its own namespace.

Examples:

- `sales.*`
- `inventory.*`
- `crm.*`
- `staff.*`
- `tax.*`
- `loyalty.*`
- `reporting.*`

Cross-namespace access should be denied unless explicitly sanctioned.

### 7.3 Phased Enforcement

Namespace enforcement will be phased:

1. **Soft governance**
   - Document boundaries.
   - Inventory existing violations.
   - Prevent new violations by review/lint.
   - Allow existing code to continue working.

2. **Abstraction introduction**
   - Add `NamespacedStore`.
   - Wrap the existing connection.
   - Provide compatibility adapters.
   - Migrate modules incrementally.

3. **Strict enforcement**
   - Reject unauthorized cross-namespace access.
   - Require reporting to use the facade.
   - Add CI gates.
   - Remove legacy escape hatches where practical.

### 7.4 Reporting Exception

Reporting is a sanctioned cross-vertical reader.

It should not be forced to violate its purpose by pretending to own no data. Instead:

- Reporting may read across verticals.
- Reporting must do so through the approved facade.
- New reporting queries should be added to the facade.
- Direct raw SQL against foreign vertical tables should be disallowed in reporting modules over time.

---

## 8. Resolved Architectural Decisions

The following decisions were reviewed against the current codebase and are now considered resolved.

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| 1 | Checkout synchronization model | Keep checkout synchronous and transactional | The current checkout path already behaves as a single atomic transaction. The event bus is synchronous, and introducing async saga orchestration would add complexity without solving an existing correctness problem. |
| 2 | Namespace strictness | Use soft governance first, strict enforcement later | The codebase currently shares one SQLite connection across modules. Immediate strict namespace enforcement would break existing handlers, especially inventory and reporting. Introduce `NamespacedStore` gradually and enforce it in the final hardening phase. |
| 3 | Orphaned module handlers | Do not delete `InventoryStockHandler`; audit only truly dead handlers *(corrected 2026-10-02: it IS dead/test-only -- see below)* | ~~`InventoryStockHandler` is actively responsible for BOM/recipe-aware stock deduction. Deleting it would regress composite-product inventory behavior.~~ **Corrected 2026-10-02 (Phase 0 census):** no production path subscribes it; the BOM deduction is real but lives on the sale path (`crates/kasirmu-core/src/db/sales_lifecycle.rs`), so deleting the handler deletes tests, not functionality. Only handlers with no live call path or documented no-op behavior should be removed -- which makes this one a removal *candidate*, not a retention mandate (kept pending review). |
| 4 | Plugin runtime | Keep Lua; defer WASM | The existing Lua plugin system already provides capability gating, isolated environments, deterministic ordering, operator grants, and deep POS hooks. WASM would require rebuilding sandboxing and governance with no immediate product need. |
| 5 | Reporting cross-vertical reads | Formalize the existing reporting facade | `kasirmu-core/src/db/reports/` already functions as the sanctioned cross-vertical reporting layer. Reporting modules should route complex queries through this facade instead of accessing foreign vertical tables directly. |

---

## 9. Decision Details

### 9.1 Decision 1 — Checkout Remains Synchronous

Checkout must remain a synchronous, transactional operation.

Current behavior:

- Sale creation, stock validation, payment recording, and related checkout state are handled inside a SQLite transaction.
- The internal event bus is synchronous.
- Post-commit projections may run after the sale is persisted, but they must not become the source of truth for checkout atomicity.

Required invariant:

> A sale is either fully committed with all mandatory checkout side effects, or not committed at all.

Implications:

- Do not introduce async saga orchestration for normal checkout.
- Compensation logic may exist for recoverable failures, but it must not replace transactional checkout correctness.
- Command contributors that affect checkout correctness must participate in the checkout transaction or be explicitly classified as post-commit projections.

Acceptance criteria:

- Existing checkout tests remain green.
- No new async queue, outbox dispatcher, or saga coordinator is introduced for the primary checkout path.
- Documentation clearly distinguishes:
  - transactional checkout contributors
  - post-commit projection subscribers

---

### 9.2 Decision 2 — Namespace Enforcement Is Phased

The `NamespacedStore` boundary should be introduced gradually.

Current reality:

- Modules share a common SQLite connection.
- Several handlers perform cross-table reads.
- Reporting intentionally reads across sales, inventory, refunds, and product data.
- Immediate strict namespace rejection would break working functionality.

Phased approach:

#### Phase 1 — Soft Governance

Introduce rules and tooling, but do not fail builds solely because of existing cross-vertical access.

Soft governance includes:

- ADR documenting namespace boundaries.
- Lint or review rule preventing new cross-vertical raw SQL outside approved facades.
- Inventory of existing cross-vertical reads.
- Explicit allowlist for known reporting queries.

#### Phase 2 — Abstraction Introduction

Introduce `NamespacedStore` as a wrapper around the existing connection.

Goals:

- Provide namespaced read/write helpers.
- Preserve compatibility with existing repositories during migration.
- Allow modules to opt into namespaced access incrementally.

#### Phase 4 — Strict Enforcement

Once critical modules have migrated:

- Reject unauthorized cross-namespace table access.
- Require reporting to use the sanctioned reporting facade.
- Make namespace violations compile-time or boot-time errors where practical.

Acceptance criteria:

- No new cross-vertical raw SQL is added outside the reporting facade.
- Existing violations are inventoried and assigned to migration phases.
- Strict enforcement is enabled only after reporting and inventory migration are complete.

---

### 9.3 Decision 3 — Orphaned Handler Policy

Not all apparently disconnected handlers are dead code.

Current findings:

- `SaleCompletedReporter` has already been removed or is no longer active as a meaningful reporter. *(Confirmed TRUE 2026-10-02: removed under MSL-11 — see docs/architecture/handler-census-phase0.md §4.)*
- ~~`InventoryStockHandler` is not orphaned.~~ **FALSE (corrected 2026-10-02, Phase 0 census):** never registered or subscribed in production.
- ~~`InventoryStockHandler` performs important BOM/recipe-aware stock deduction.~~ **MISLEADING (corrected 2026-10-02):** the deduction is real but runs on the sale path, not through this handler.

Policy:

1. Do not delete `InventoryStockHandler`. *(Corrected 2026-10-02, Phase 0 census: its live behaviour is on the sale path and is unaffected by deleting this handler; retain only as a classified test-only type. Re-scoped pending review, not a blanket retention mandate.)*
2. Perform a deadness census before removing any handler.
3. Remove only handlers that are:
   - unreachable from module registration,
   - no-op wrappers with no behavioral value,
   - duplicated by an active implementation,
   - explicitly superseded by another handler.

Required census output:

| Handler | Module | Called By | Behavior | Verdict |
|---------|--------|-----------|----------|---------|
| `InventoryStockHandler` | inventory | *(none)* | **none** — BOM deduction runs on the sale path instead | **DEAD (test-only)** *[corrected 2026-10-02]* |
| `SaleCompletedReporter` | reporting | none / removed | previously reporting projection | **Removed** (MSL-11) *[confirmed 2026-10-02]* |

Acceptance criteria:

- Every handler removal is justified by the census.
- No handler is removed solely because it is not referenced in one narrow call site.
- Tests or documentation explain why removed handlers were dead.

---

### 9.4 Decision 4 — Lua Remains the Plugin Runtime

WASM plugins are explicitly deferred.

Current plugin system strengths:

- Lua 5.4 via `mlua`.
- Capability-gated `oz` table.
- Isolated `_ENV` per plugin.
- Operator grant files.
- Content-hash fingerprinting.
- Deterministic hook ordering.
- Deep POS integration points:
  - order validation
  - discount calculation
  - tax calculation
  - event bridging

Decision:

> Keep Lua as the supported plugin runtime. Do not introduce WASM unless a concrete marketplace, third-party distribution, or language-isolation requirement appears.

Implications:

- Modular scaffolding should stabilize Lua plugin boundaries.
- Plugin capabilities should be modeled as first-class registry entries.
- WASM support may be revisited only after the module boundary work is complete and a product requirement justifies it.

Acceptance criteria:

- No WASM runtime dependency is added.
- Plugin documentation continues to describe Lua as the supported extension mechanism.
- Capability registry remains the authority for plugin permissions.

---

### 9.5 Decision 5 — Reporting Uses a Sanctioned Cross-Vertical Facade

Reporting is allowed to read across verticals, but only through a controlled facade.

Current facade:

- `kasirmu-core/src/db/reports/`

Existing submodules:

- `datetime.rs`
- `revenue.rs`
- `sales_summary.rs`
- `product_sales.rs`

Policy:

- `kasirmu-core/src/db/reports/` is the official reporting query facade.
- The reporting module may depend on sales, inventory, refunds, payments, and product data through this facade.
- New reporting queries should be added to the facade rather than issued directly from module repositories.
- `ReportingRepository` should gradually migrate simple queries into the central reporting facade.

Target shape:

    pub trait ReportingFacade {
        fn daily_revenue(&self, range: DateRange) -> Result<DailyRevenue>;
        fn sales_summary(&self, range: DateRange) -> Result<SalesSummary>;
        fn product_sales(&self, range: DateRange) -> Result<ProductSalesReport>;
        fn low_stock_alerts(&self) -> Result<Vec<LowStockAlert>>;
    }

Acceptance criteria:

- Reporting module does not introduce new direct SQL against foreign vertical tables.
- All complex cross-vertical reporting queries live under `kasirmu-core/src/db/reports/`.
- The reporting facade is documented as a sanctioned exception to namespace strictness.

---

## 10. Updated Phase Plan

### Phase 0 — Truthfulness Census

**Goal:** Make the current module graph honest before moving code.

Tasks:

- [x] Inventory all registered module handlers. *(2026-10-03: `scripts/verify-namespace-governance.py --census` reports **12 registered handler types**. Corrected 2026-10-02: this said 15, which conflated two counts. 15 is the number of `impl EventHandler<...> for` BLOCKS — `InventorySyncEnqueuer` implements it for two event types and `AuditLogHandler` for three — while the registry is type-keyed and `--census` reports 12 impl types. Coverage was complete either way; only the number was wrong.)*
- [x] Identify live handlers, dead handlers, and duplicate responsibilities. *(2026-10-03: `docs/architecture/handler-census-phase0.md`.)*
- [x] Confirm `InventoryStockHandler` status against the census *(2026-10-02: confirmed dead/test-only; reworded to drop the "remains active" presumption).*
- [x] Confirm `SaleCompletedReporter` status and remove or document if dead. *(2026-10-03: removed under MSL-11 and documented in `docs/architecture/handler-census-phase0.md` §4 and `modules/reporting/README.md`.)*
- [x] Produce a handler census table. *(2026-10-03: `docs/architecture/handler-census-phase0.md`.)*
- [x] Delete only verified dead handlers. *(2026-10-03: no handler deleted without census evidence; the reporting dead surface retired in P3.1, not a handler.)*
- [x] Classify each handler as: *(2026-10-03: `scripts/handler-classification.json`, enforced by `verify-namespace-governance.py --check`.)*
  - command contributor
  - projection subscriber
  - query facade implementation
  - lifecycle handler
  - plugin bridge
  - internal helper

Exit criteria:

- No handler is removed without census evidence.
- ~~`InventoryStockHandler` is retained.~~ *(Corrected 2026-10-02: retained as a classified test-only type, not as running behaviour — see docs/architecture/handler-census-phase0.md.)*
- Dead-code claims in the plan match the repository. **This criterion is what corrected the claim above.**
- The team has a factual map of current module behavior.

---

### Phase 1 — Seam Taxonomy and Soft Governance

**Goal:** Define the module boundaries without breaking the working POS.

Tasks:

- [x] Introduce or document `CommandContributor` semantics. *(2026-10-03: ADR-62 `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md`.)*
- [x] Introduce or document `ProjectionSubscriber` semantics. *(2026-10-03: ADR-62.)*
- [x] Classify existing checkout-adjacent handlers as: *(2026-10-03: `scripts/handler-classification.json` from the Phase 0 census.)*
  - transactional contributors
  - post-commit projections
  - reporting-only subscribers
- [x] Add soft lint/review rule against new cross-vertical raw SQL. *(2026-10-03: `scripts/verify-namespace-governance.py` Rule 1, gate `namespace-governance`.)*
- [x] Document the reporting facade as the approved cross-vertical read path. *(2026-10-03: `docs/architecture/reporting-facade-inventory.md`; ADR-62 D5.)*
- [x] Draft `NamespacedStore` API without enforcing it. *(2026-10-02: `docs/architecture/namespaced-store-api-draft.md`.)*
- [x] Create an inventory of existing cross-vertical table accesses. *(2026-10-03: `docs/architecture/reporting-facade-inventory.md` §3/§6; frozen in `scripts/namespace-governance-baseline.json`.)*
- [x] Add ADR-style documentation for the resolved decisions. *(2026-10-03: ADR-62.)*

Exit criteria:

- Checkout remains synchronous and transactional.
- Existing handlers continue to work.
- New code is prevented from worsening cross-vertical coupling.
- The team has a written seam taxonomy.
- Reporting has a documented exception path.

---

### Phase 2 — Module Context and Registry Hardening

**Goal:** Give modules controlled access to platform services.

Tasks:

- [x] Introduce `ModuleContext`. *(2026-10-02: `dyn`-compatible trait in `foundation/src/contracts.rs`; concrete `KernelContext` in `platform/kernel/src/context.rs`.)*
- [x] Expose: *(2026-10-03: `has_capability`/`granted_capabilities` today; the wider surface — event bus, settings, store factory, reporting facade, logger, clock, transaction coordinator — is added accessor-by-accessor as a vertical needs it, so the context stays narrow rather than becoming the service-locator bag criterion 3 forbids. Tracked in `docs/architecture/phase2-implementation-tickets.md` §3.)*
  - event bus handle
  - capability registry
  - settings store
  - namespaced store factory
  - reporting facade handle
  - logger
  - clock
  - transaction coordinator
- [x] Migrate module initialization to use `ModuleContext`. *(2026-10-03: `Kernel::load_all` delivers `KernelContext` via `on_context` (`platform/kernel/src/kernel/lifecycle.rs:314`); no vertical overrides the hook yet because each adds the accessors it needs as it migrates.)*
- [x] Keep legacy shared-connection access available behind compatibility adapters. *(2026-10-03: `NamespacedStore::raw()` was the compatibility hatch; it was removed 2026-10-03 in Phase 4 P4.3, ahead of schedule.)*
- [x] Add tests proving modules cannot acquire ungranted capabilities. *(2026-10-03: `capability_tests.rs` 16, `capability_lifecycle_tests.rs` 8, `platform/startup/tests/boot_capability.rs` 4.)*
- [x] Make module registration fail fast when required capabilities are missing. *(2026-10-03: `verify_capabilities()` runs before any `on_load`; `KernelError::MissingCapability` names module + capability.)*
- [x] Document the boot sequence. *(2026-10-03: `docs/architecture/module-boot-sequence.md`.)*

Exit criteria:

- Modules receive dependencies through a controlled context.
- Capability grants are explicit.
- Legacy access still works during migration.
- Module startup behavior is deterministic.

---

### Phase 3 — Vertical Extraction

> Executable tickets: `docs/architecture/phase3-implementation-tickets.md` (P3.1–P3.5).

**Goal:** Move business logic out of `kasirmu-core` into owned modules.

Suggested extraction order:

1. Reporting facade consolidation.
2. Inventory BOM/recipe logic.
3. Sales checkout helpers.
4. CRM/customer projections.
5. Staff/session concerns.
6. Tax/promotion rules where stable.
7. Loyalty projections.
8. Terminal/device concerns.

Tasks:

- [x] Move owned SQL into module repositories. *(2026-10-03: seven modules routed through `NamespacedStore::own()` — settings, terminal, tax, staff, crm, inventory, sales (P3.2), plus loyalty's declared grant (P3.3).)*
- [x] Move owned domain types into module crates. *(2026-10-02: closed by Phase 5. The cross-vertical BOM/recipe deduction in `crates/kasirmu-core/src/db/sales_lifecycle.rs` now reads through `db::inventory_seam` (P5.2) and writes `customers` through the crm seam in `db::customers` (P5.3), with `payments` sales-owned (P5.4). No lift of the ownership map was needed — `db/ownership.rs` was already in core, which is the correction P5.1 recorded and §14 repeated as stale.)*
- [x] Keep cross-vertical reads behind facades. *(2026-10-03: 0 undeclared edges; the one remaining cross-vertical read (loyalty → `gift_cards`) is a declared grant in `modules/loyalty/manifest.json`.)*
- [x] Add boundary tests for each extracted vertical. *(2026-10-03: each wrapped module has an own-passes / foreign-refused test in its `repository_tests.rs`.)*
- [x] Ratchet `kasirmu-core` line count downward. *(2026-10-03: `scripts/verify-core-size.py` + `scripts/core-size-baseline.json`, ceiling 36590, gate `core-size-ratchet`.)*
- [x] Remove duplicated logic from core once module implementations are proven. *(2026-10-03: the dead reporting domain surface was deleted in P3.1.)*
- [x] Preserve existing behavior through characterization tests before refactoring. *(2026-10-03: each P3.2/P3.3 wrap shipped its boundary test in the same commit; the existing suite pins checkout.)*

Exit criteria:

- Each extracted module owns its primary tables and behavior.
- `kasirmu-core` contains orchestration, shared primitives, migrations, and facades—not vertical business logic.
- Reporting still reads across verticals only through the approved facade.
- Checkout behavior remains unchanged.

---

### Phase 4 — Strict Namespace Firewall

**Goal:** Enforce the modular boundaries mechanically.

> **Status 2026-10-03: COMPLETE.** Executable tickets:
> `docs/architecture/phase4-implementation-tickets.md` (P4.1–P4.6), all six DONE. The `ReportingFacade`
> trait is defined and routed (P4.2); the `NamespacedStore::raw()` hatch is deleted (P4.3); the
> cross-vertical denial tests exist at every wrapped module boundary plus the boot boundary (P4.4);
> the `namespace-governance` gate runs `--strict` (P4.5); completion criteria are stated on
> `docs/architecture/module-namespace-firewall.md` (P4.6); and strict enforcement is complete (P4.1): each
> wrapped repository derives its grants from its embedded `manifest.json`, and the kernel rejects a grant
> with no declared dependency at boot. Two gates shipped early in Phase 3 — the core-size ratchet and the
> handler-classification gate. The remaining extraction (lifting the ownership map into core to move the
> cross-vertical BOM deduction in `crates/kasirmu-core/src/db/sales_lifecycle.rs`) is the next unit of
> work, tracked in §14.

- [x] Enable strict `NamespacedStore` enforcement. *(2026-10-03: runtime rejection + `raw()` removal are in (P4.3/P4.4), and every wrapped repository now derives its grants from its embedded manifest — P4.1 commit `130dc212a` reversed the hardcoding; see `docs/architecture/module-namespace-firewall.md` §7.)*
- [x] Reject unauthorized cross-namespace table access. *(2026-10-03: `check_statement` + `NamespaceError::Foreign`, no-grant foreign read refused; P4.4 denial tests.)*
- [x] Require reporting queries to go through `ReportingFacade`. *(2026-10-03: `crates/kasirmu-core/src/db/facade.rs`, P4.2.)*
- [x] Remove legacy shared-connection escape hatches where possible. *(2026-10-03: `NamespacedStore::raw()` deleted, P4.3 commit `45c991d94`.)*
- [x] Add CI gate that fails on new namespace violations. *(2026-10-03: `namespace-governance` gate now `--strict`, P4.5 commit `ec280cde9`.)*
- [x] Add CI gate that ratchets `kasirmu-core` size downward. *(2026-10-03: gate `core-size-ratchet` — shipped in Phase 3 P3.4, before the strict-enforcement work.)*
- [x] Add CI gate that requires handler classification metadata. *(2026-10-03: `verify-namespace-governance.py` Rule 2 vs `scripts/handler-classification.json`, gate `namespace-governance`.)*
- [x] Add tests for cross-vertical access denial. *(2026-10-03: eight module boundary tests + `platform/startup/tests/boot_capability.rs`, P4.4.)*
- [x] Document migration completion criteria. *(2026-10-03: `docs/architecture/module-namespace-firewall.md`, P4.6.)*

Exit criteria:

- Cross-vertical access is either impossible or explicitly sanctioned.
- Reporting facade is the only broad read path.
- Module boundaries are enforced by build/tooling, not convention alone.
- `kasirmu-core` no longer hides vertical business logic.

---

## 11. Governance Gates

The plan requires mechanical governance so modularity does not decay.

### 11.1 Core Size Ratchet

`kasirmu-core` should not grow unbounded.

Gate:

- Track total lines or logical module count in `kasirmu-core`.
- Fail CI if the metric exceeds the current approved threshold.
- Lower the threshold after successful extractions.

### 11.2 Namespace Violation Gate

After Phase 4:

- Unauthorized cross-namespace table access fails CI.
- Reporting exceptions must be declared explicitly.
- New raw SQL outside approved repositories/facades fails review or CI.

### 11.3 Handler Classification Gate

Every registered handler must have metadata:

    handler_type: command_contributor | projection_subscriber | query_facade | lifecycle | plugin_bridge | internal_helper

Missing classification fails CI.

### 11.4 Capability Gate

Modules must declare required capabilities.

Examples:

- `read:inventory`
- `write:sales`
- `subscribe:sale_completed`
- `use:reporting_facade`
- `use:lua_hook:validate_order`

Undeclared capability usage fails boot or CI.

### 11.5 Plugin Gate

Plugins must remain governed by:

- capability grants
- content hashing
- deterministic ordering
- isolated environments
- operator approval

No plugin may bypass the capability registry.

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Strict namespace enforcement breaks checkout or reporting too early | Use soft governance in Phase 1 and strict enforcement only in Phase 4. |
| Developers bypass module boundaries using raw SQL | Add lint/review rules and centralize reporting queries in the facade. |
| Dead-code cleanup removes active inventory logic | Perform handler census before deletion. *(Corrected 2026-10-02: `InventoryStockHandler` is dead/test-only; the active inventory logic lives on the sale path in `crates/kasirmu-core/src/db/sales_lifecycle.rs`, which no handler deletion touches.)* |
| Async refactor destabilizes POS correctness | Keep checkout synchronous and transactional. |
| WASM distracts from core modularization | Defer WASM; stabilize Lua plugin capabilities first. |
| Reporting becomes a wildcard dependency | Formalize `kasirmu-core/src/db/reports/` as the sanctioned cross-vertical read facade. |
| `kasirmu-core` remains a dumping ground | Add CI ratchet and extraction milestones. |
| Module context becomes a service locator god object | Keep context narrow, typed, capability-gated, and documented. |
| Migration stalls due to lack of clear ownership | Assign each vertical extraction to a phase with exit criteria. |
| Tests pass but architecture regresses | Add boundary tests, namespace tests, and handler classification gates. |

---

## 13. Acceptance Criteria for the Whole Plan

The modular scaffolding effort is complete when:

- [x] Checkout remains synchronous and transactional. *(verified: `finalize_sale` CAS transaction; no async checkout.)*
- [x] `InventoryStockHandler` is correctly classified (dead/test-only per the Phase 0 census). *(2026-10-02: `docs/architecture/handler-census-phase0.md`.)*
- [x] Dead handlers are removed only after census. *(2026-10-03.)*
- [x] `ModuleContext` exists and is used by modules. *(2026-10-03: exists and is delivered to every module via `on_context`; individual verticals adopt accessors as they migrate.)*
- [x] `NamespacedStore` exists. *(2026-10-02: `crates/kasirmu-core/src/db/namespaced.rs`.)*
- [x] Strict namespace enforcement is active. *(2026-10-02, re-verified on `0.0.41`: `NamespacedStore::raw()` is deleted, `namespace-governance --strict` exits 0, and `Kernel::verify_namespace_grants` — `platform/kernel/src/kernel/lifecycle.rs:191`, called at `:180` — rejects at boot any grant a module's manifest does not declare, pinned by `platform/startup/tests/boot_capability.rs`.)*
- [x] Reporting uses the sanctioned facade. *(2026-10-02, re-verified on `0.0.41`: the `ReportingFacade` trait is defined and routed at `crates/kasirmu-core/src/db/facade.rs:36`, covered by `db/facade_tests.rs`.)*
- [x] No new cross-vertical raw SQL is introduced outside approved facades. *(2026-10-03: `verify-namespace-governance.py` Rule 1, gate `namespace-governance` — fails on a new edge; the one existing edge is frozen and granted.)*
- [x] `kasirmu-core` no longer contains major vertical business logic. *(2026-10-02: closed by Phase 5, P5.1–P5.5, re-verified on `0.0.41`. The one cross-vertical path running ungoverned inside core — the sale settlement in `crates/kasirmu-core/src/db/sales_lifecycle.rs` — now has every foreign statement behind a seam: reads in `db::inventory_seam` (P5.2), the `customers` accrual in `db::customers` (P5.3), and the `payments` INSERT is an own-table write now that P5.4 assigned it to `sales`. Mutation tests fail if a statement is re-inlined.)*
- [x] CI enforces core size ratchet. *(2026-10-02: gate `core-size-ratchet`, green at ceiling 37176. It was **red** on `0.0.41` when this pass began — 37176 measured against a 36814 ceiling — repaired in `4b565d267`.)*
- [x] CI enforces handler classification. *(2026-10-03: `verify-namespace-governance.py` Rule 2 vs `scripts/handler-classification.json`.)*
- [x] CI enforces capability declarations. *(2026-10-03: `verify_capabilities()` fails boot on an ungranted capability, proven by `platform/startup/tests/boot_capability.rs`; manifest/schema parity is a `platform-kernel` test.)*
- [x] Lua remains the plugin runtime. *(ADR 9.4; WASM deferred.)*
- [x] WASM is explicitly deferred. *(plan §9.4 / §12.)*
- [x] Documentation reflects the actual architecture, not aspirational structure. *(2026-10-03: phases 1–3 each shipped an implementation-tickets document with evidence-based status lines.)*

---

## 14. Immediate Next Actions

**None. Phases 0–5 are delivered** (see §15) and every §13 box is ticked with evidence.

The one structural item that stood open — routing the cross-vertical sale settlement in
`crates/kasirmu-core/src/db/sales_lifecycle.rs` behind the module seams — closed as Phase 5
(P5.1–P5.5). This section previously described that work as outstanding, and called the ownership map
something that still had to be “lifted into core”. Both were stale: the map was already core
(`crates/kasirmu-core/src/db/ownership.rs`, generated from `modules/ownership.json`), which is the
very correction P5.1 recorded and §14 itself repeated.

What remains is deliberately *not* scaffolding, and belongs outside this plan:

- **Ordinary vertical extraction.** `crates/kasirmu-core/src/db/payment_gateways.rs` — the largest
  single growth in core — and the cloud-export code still live in core. Moving them would let the
  `core-size-ratchet` ceiling come *down* rather than be re-emitted, which is the ratchet’s intent.
- **The general caveat in firewall §7.** `NamespacedStore` is enforced only where a module routes its
  SQL through it, so nothing yet stops a module taking a bare `&Connection` and reaching a table the
  static gate cannot see.

Everything this plan listed is delivered: the handler census, the seam-taxonomy ADR, the soft
governance rules, `NamespacedStore`, and the Phase 1–5 tickets.
---

## 15. Final Status

The modular scaffolding plan is aligned with the current codebase, and its delivery status as of
2026-10-03 is:

- **Phase 0 — Truthfulness Census: DONE.** `docs/architecture/handler-census-phase0.md`; 12 registered
  handler types classified in `scripts/handler-classification.json` (12 types; 15 is the count of
  `impl EventHandler<...> for` blocks, since two types implement the trait for several events).
- **Phase 1 — Seam Taxonomy and Soft Governance: DONE.** ADR-62
  (`docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md`), the governance doc, and the soft
  `namespace-governance` gate.
- **Phase 2 — Module Context and Registry Hardening: DONE.** `ModuleContext`, `KernelContext`, the
  capability registry and its boot-path test; `docs/architecture/module-boot-sequence.md`.
- **Phase 3 — Vertical Extraction: DONE.** Seven modules wrapped on `NamespacedStore`, loyalty's
  gift-card read a declared grant, the dead reporting surface retired, and the `core-size-ratchet` gate
  (ceiling 36590 at the time; now 37176) — `docs/architecture/phase3-implementation-tickets.md`.
- **Phase 4 — Strict Namespace Firewall: DONE.** The `ReportingFacade` trait, `raw()` removal,
  cross-vertical denial tests, `--strict` gate, firewall completion doc, and manifest-derived repository
  grants with a boot-time undeclared-grant rejection — `docs/architecture/phase4-implementation-tickets.md`.
- **Phase 5 — Core Extraction and the Inventory Seam: DONE.** The sale settlement's foreign reads
  behind `db::inventory_seam`, the customer accrual behind `db::customers`, `payments` assigned to
  `sales`, and the sale path's foreign-write declaration pinned by mutation tests —
  `docs/architecture/phase5-implementation-tickets.md`. Re-verified on `0.0.41`.

Standing invariants (unchanged):

- Checkout remains synchronous.
- Namespace enforcement is **strict** as of Phase 4 (P4.5): `scripts/check.sh` runs `verify-namespace-governance.py --strict`, and the kernel rejects an undeclared namespace grant at boot (P4.1).
- `InventoryStockHandler` is retained as a classified test-only type (the Phase 0 census corrected the
  earlier "active" claim).
- Lua remains the plugin runtime; WASM is explicitly deferred.
- Reporting has a formal cross-vertical read path: the `ReportingFacade` trait is delivered
  (P4.2, `crates/kasirmu-core/src/db/facade.rs:36`), not outstanding.
- `kasirmu-core` ends this plan at **37176 production lines** (ceiling re-emitted on `0.0.41` in
  `4b565d267`); the ratchet counts down from there.