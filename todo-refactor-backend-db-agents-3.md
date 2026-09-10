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
- [ ] Run `cargo test -p oz-core inventory products` to establish baseline.

### Phase 3.1: Inventory & Stock Transfer De-duplication
- [ ] Consolidate inventory deduction and replenishment math across `stock_adjust.rs` and `stock_transfers.rs`.
- [ ] Enforce negative inventory rules uniformly.
- [ ] Verify `cargo test -p oz-core inventory` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-inventory): unify stock deduction and transfer transaction logic"
  ```

### Phase 3.2: Product Query Optimization & Variant Extraction
- [ ] Separate heavy catalog full-text lookups from lightweight barcode scanner queries in `products_crud.rs`.
- [ ] Verify `cargo test -p oz-core products` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-products): decouple barcode scan queries from catalog search"
  ```
