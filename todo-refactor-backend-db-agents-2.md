# Orchestrator Agent 2: Sales & Checkout DB Repositories

**Document:** `todo-refactor-backend-db-agents-2.md`  
**Role:** Orchestrator Agent 2 (Transaction & Order Data Architect)  
**Goal:** Modularize `sales.rs`, `sales_checkout.rs`, `sales_lifecycle.rs`, and `sales_crud.rs` in `crates/oz-core/src/db/` to cleanly isolate database transactions, state progression, and order persistence.

**Target Crates:** `crates/oz-core/src/db/`  
**Sibling Documents:**
- [`todo-refactor-backend-db-agents-1.md`](./todo-refactor-backend-db-agents-1.md) (Agent 1 — Financial & Reporting DB Services)
- [`todo-refactor-backend-db-agents-3.md`](./todo-refactor-backend-db-agents-3.md) (Agent 3 — Inventory, Stock & Catalog Repositories)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Coordinate strictly through Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 2 MUST use:
     - `refactor(db-sales): ...`
3. **Owned Path Fence (Exclusive to Agent 2):**
   - `crates/oz-core/src/db/sales.rs` & `sales_tests.rs`
   - `crates/oz-core/src/db/sales_checkout.rs`
   - `crates/oz-core/src/db/sales_crud.rs`
   - `crates/oz-core/src/db/sales_lifecycle.rs`
   - `crates/oz-core/src/db/cart.rs` & `cart_tests.rs`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `tax.rs` or `reports.rs` (Owned by Agent 1).
   - DO NOT edit `inventory*.rs` or `products*.rs` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Run `cargo test -p oz-core sales` to ensure full passing baseline.
- [ ] Invariant check: Verify all queries run within an explicit `rusqlite::Transaction`.

### Phase 2.1: Extract Cart & Sale Lifecycle Repository
- [ ] Centralize order status state machine transitions (`Pending` → `Completed` → `Voided` / `Refunded`) into a clean repository pattern.
- [ ] Decouple cart line insertion and bulk item updates into dedicated transaction operations.
- [ ] Verify `cargo test -p oz-core sales` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-sales): isolate sale lifecycle transactions and line persistence"
  ```

### Phase 2.2: Unify Sale Row Mappers & DTO Builders
- [ ] Consolidate duplicate row mapping across `sales_crud.rs` and `sales_checkout.rs` into shared row mappers.
- [ ] Ensure `Money` (`i64` minor units) is consistently parsed across all columns.
- [ ] Verify `cargo test -p oz-core sales` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-sales): unify sale row mapping and minor-unit parsing"
  ```
