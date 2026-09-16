# Orchestrator Agent 3: Inventory, Stock & Catalog Repositories

**Document:** `todo-refactor-backend-db-agents-3.md`  
**Role:** Orchestrator Agent 3 (Inventory & Catalog Data Architect)  
**Goal:** Modularize stock count adjustments, transfers, catalog searches, and product variant lookups in `crates/oz-core/src/db/` to prevent SQL duplication and optimize multi-location queries.

**Target Crates:** `crates/oz-core/src/db/`  
**Sibling Documents:**
- [`todo-refactor-backend-db-agents-1.md`](./todo-refactor-backend-db-agents-1.md) (Agent 1 — Financial & Reporting DB Services)
- [`todo-refactor-backend-db-agents-2.md`](./todo-refactor-backend-db-agents-2.md) (Agent 2 — Sales & Checkout DB Repositories)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Coordinate strictly through Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(db-inventory): ...`
     - `refactor(db-products): ...`
3. **Owned Path Fence (Exclusive to Agent 3):**
   - `crates/oz-core/src/db/inventory.rs` & `inventory_tests.rs`
   - `crates/oz-core/src/db/products*.rs` & `products_tests.rs`
   - `crates/oz-core/src/db/stock_counts.rs` & `stock_transfers.rs`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `tax.rs` or `reports.rs` (Owned by Agent 1).
   - DO NOT edit `sales*.rs` (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Run `cargo test -p oz-core inventory products` to establish baseline.
  > ⚠️ Executed as the two real filters (`cargo test -p oz-core inventory`, then
  > `products_stock`; cargo takes ONE TESTNAME — the same shape-of-command fix Agent 1
  > stamped; bare `products` re-verified green at final: 149/149). Baseline (pre-edit,
  > 13-09-26): **inventory = 100 lib passed** (+1 +4 +1 +1 integration hits, **plus 2
  > pre-existing FAILURES in `stock_transfer_integration`:
  > `send_transfer_moves_to_in_transit_and_decrements_inventory` and
  > `receive_transfer_increments_inventory_and_sets_received`**), **products_stock =
  > 17 lib passed.** The 2 reds exist in committed HEAD before any edit in this
  > campaign: the tests seed the legacy single-PK `inventory` table without a location
  > (`tests/stock_transfer_integration.rs:60-73`), while `send_transfer` now deducts at
  > the transfer's SOURCE location through the canonical per-location adjust after
  > bridging legacy qty to `CANONICAL_DEFAULT_LOCATION_UUID`
  > (`stock_transfers.rs:472-507`) — a stale-fixture vs ADR-19 semantics gap whose fix
  > is a behavior change belonging to the multi-location inventory lane, not to a
  > zero-behavior-change refactor. Kept OUT of fence; the identical failure signature
  > (same 2 tests, same `have 0, need N` messages) was RE-VERIFIED at final as proof
  > this campaign did not move it.

### Phase 3.1: Inventory & Stock Transfer De-duplication
- [x] Consolidate inventory deduction and replenishment math across `stock_adjust.rs` and `stock_transfers.rs`.
  > **SHIPPED before this order ran** (`stock_adjust.rs` never existed; the real files
  > are `products_stock_adjust.rs` + the deprecated single-column paths in
  > `products_stock_query.rs:332/400`). The canonical writer
  > `Store::adjust_stock_at_location_with_reason` has exactly one definition
  > (`products_stock_adjust/adjust.rs:154`) and EVERY production stock-moving
  > flow routes through it or through `adjust_stock_batch` (which executes via it):
  > sale settlement `sales_checkout.rs:432` and `sales_lifecycle.rs:409` (batch), void
  > restock `sales_lifecycle.rs:644`, refunds `refunds.rs:670/699/781`, purchase
  > receipts `purchase_orders.rs:374/476`, counts `stock_counts.rs:559/574`,
  > transactions `inventory.rs:520`, and transfers
  > `stock_transfers.rs:480/617/743` (send/receive/cancel, each bridging legacy rows
  > first at `:479/:616/:742`). The transfer code itself documents the consolidation
  > ("Route the deduction through the canonical per-location adjust fn (ADR-19 §3.1)
  > so there is exactly one stock writer"). Deduction math is therefore single-sourced;
  > the residual over-cap debt was in the canonical file itself → **split in this
  > campaign**: `products_stock_adjust.rs` 1,095 → facade 72 +
  > `products_stock_adjust/adjust.rs` 468 (canonical adjust + location predicates +
  > legacy bridge + threshold writer) + `batch.rs` 212 (`adjust_stock_batch` +
  > deprecated `adjust_stock_with_reason`) + `ledger.rs` 272 (ledger read + scoped
  > self-healing rebuild) + `movements.rs` 161 (list + archive rollup). All SQL
  > verbatim (concatenated child bodies compared to the original impl block: 989
  > non-blank lines IDENTICAL); test file `products_stock_adjust_tests.rs` byte-untouched.
- [x] Enforce negative inventory rules uniformly.
  > **SHIPPED.** Enforcement is intrinsic to the single writer, so routing everything
  > through it (box above) unified the rule: Layer-1 Rust pre-check
  > `current_qty + delta >= 0` → typed `CoreError::InsufficientStockAtLocation` with the
  > exact available qty; Layer-2 SQLite `CHECK (qty >= 0)` on the composite-PK
  > `stock_summary` upsert translated to the same variant; both gated by the same
  > per-terminal/workspace `allow_negative_stock` lookup that fails CLOSED (deny) on any
  > read error. `adjust_stock_batch` Phase 1 deliberately re-uses the same
  > `legacy_aware_location_qty` read and the same allow-negative lookup so pre-check and
  > writer cannot disagree. Transfers map the typed shortfall to `Validation { field:
  > "qty" }` (`stock_transfers.rs:490-506`) — which is precisely the message the two
  > stale-fixture integration reds print (see 3.0).
- [x] Verify `cargo test -p oz-core inventory` passes.
  > 100→100 lib; ALL 21 `test result:` lines byte-identical baseline→final (including
  > the unchanged 2-test pre-existing red signature).
- [x] **Commit Milestone:**
  > `refactor(db-inventory): unify stock deduction and transfer transaction logic`
  > — **no separate commit: this consolidation was already shipped** (evidence above).
  > The campaign's real products-domain deliverable — the 1,095-line over-cap split —
  > is `02f38133ea` under the doc-sanctioned `refactor(db-products):` convention.

### Phase 3.2: Product Query Optimization & Variant Extraction
- [x] Separate heavy catalog full-text lookups from lightweight barcode scanner queries in `products_crud.rs`.
  > ⚠️ **PHANTOM premise — no heavy full-text lookup exists anywhere in the products
  > family to separate.** Grep of `products.rs` / `products_crud.rs` /
  > `products_stock_query.rs` for `fts5|MATCH|LIKE|fn *search*|full.text` → zero hits
  > (the only `search_*` repository function in `crates/oz-core/src/db/` is
  > `search_customers` in `db/customers.rs`, another fence). The "lightweight barcode
  > scanner queries" are real and already live in the modularized family:
  > `get_product_by_barcode` (`products_crud.rs:631`) and
  > `lookup_product_with_details_by_barcode` (`:173`), inside `products.rs` (348,
  > facade) + `products_crud` (737) + `products_stock_query` (403) +
  > `products_categories` + `products_images` + `products_stock_adjust` — i.e. the
  > per-concern file separation this campaign measures itself by is already the shape.
  > Correction to the orchestrator briefing: `products_stock_query.rs` is NOT the
  > barcode-vs-catalog split; it is stock reads, SKU↔id lookup helpers and movement
  > writes (its own header says so). Variant lookups named in the Goal line also exist
  > and are separated already (`products.rs:204-330` variant CRUD +
  > `row_to_product_variant`). Nothing to do that would not be invented busywork.
- [x] Verify `cargo test -p oz-core products` passes.
  > Final-state `cargo test -p oz-core products`: **149 lib passed / 0 failed** (+
  > integration hits, all ok). The captured baseline filter `products_stock` re-ran
  > 17→17 with all 25 result lines identical.
- [x] **Commit Milestone:**
  > `refactor(db-products): decouple barcode scan queries from catalog search` —
  > **not committed: the described separation is PHANTOM** (no catalog full-text
  > layer exists). The `refactor(db-products):` convention was spent on the real
  > over-cap debt instead (`02f38133ea`).

---

## ✅ Closure stamp (13-09-26, sales/products orchestrator)

- **Verdict table:** 3.0 SHIPPED-with-caveat (baseline recorded; 2 stale-fixture
  integration reds pre-existing at HEAD, unchanged at final); 3.1a SHIPPED (single
  canonical writer; 14 production routing sites verified: 12 direct + 2 via
  `adjust_stock_batch`) → residual debt (the 1,095-ln
  file) split for real this campaign; 3.1b SHIPPED (two-layer + fail-closed flag, now
  structurally single-sourced); 3.1c identical (21 result lines); 3.1d N/A-phantom;
  3.2a PHANTOM premise, family already modular; 3.2b verified (149/149); 3.2c N/A.
- **Split measurements:** baseline over-cap file 1,095 ln → facade **72**, adjust
  **468**, batch **212**, ledger **272**, movements **161** (all < 600 target; facade
  < 150). `products_stock_adjust_tests.rs` (822 ln) byte-untouched — the tests'
  `use super::*` still resolves `Store` + `REBUILD_SCOPE_CHUNK` from the facade
  namespace, which is why BOTH consts stay in the facade.
- **Deviations (stamped):**
  1. **Facade is a WIRING facade, not a re-export facade.** The module's entire surface
     is `impl Store` methods (type-scoped — callers resolve them on `Store`, never via
     the module path) plus two private consts; there is nothing to `pub use`. This
     follows the `sales.rs` precedent comment verbatim ("parts hold inherent impl
     Store blocks + private fns, so no pub use").
  2. **The briefing's "the `pub mod products_stock_adjust;` line in `db/mod.rs` stays"
     was false** — `db/mod.rs` never declared it; `products.rs:41-42` does, as
     `#[path = "products_stock_adjust.rs"] mod products_stock_adjust;`. `db/mod.rs` and
     `products.rs` were both untouched as required — but the corrected picture forced
     deviation 3.
  3. **Child `mod` declarations carry explicit `#[path = "products_stock_adjust/*.rs"]`.**
     A bare `mod x;` under a `#[path]`-loaded parent resolves against `db/` (measured:
     four E0583 "file not found for module" errors) — unlike `db/tax.rs`, which is a
     regular `pub mod tax;` child of `db` and can therefore hang a plain `tax/`
     directory. Same directory layout as the Agent-1 precedent, wired per this subtree's
     rustc rules.
  4. **Seam drift vs the planning guess:** threshold writer
     `check_stock_threshold_and_alert_in_tx` (private, single call site at the canonical
     adjust's step 4) was co-located inside `adjust/` rather than split out — zero
     visibility widening required (Agent 1's precedent needed three `pub(super)` edits;
     this split needs none). The deprecated `adjust_stock_with_reason` joined `batch/`
     (pre-checked/legacy write paths vs canonical location writer).
  5. **Rename shape:** this file moves to `done-todo-refactor-backend-db-agents-3.md`
     (not `done-refactor-…`) — all 20 existing done-docs in the repo use the `done-todo-`
     prefix, matching today's `087145c370` sibling closure exactly.
- **Zero behavior change:** SQL strings untouched (verified by non-blank-line
  concatenation equality against the original file); `cargo check -p oz-bridge
  -p oz-cloud-server` clean; no `#[allow]`/visibility edits; per-file `rustfmt
  --edition 2024` only, and `cargo fmt -p oz-core -- --check` shows diffs solely in
  foreign in-flight `kds_rules*` files.
- **Collisions:** none observed inside the fence; foreign dirty files (`apps/tablet-client/**`,
  `crates/oz-bridge/src/*`, `migrations/20260813_init.pg.sql`, `ui/src/dev-mock/**`,
  `scripts/scan-unwrap-panic.py`) never staged, committed, or reverted.
