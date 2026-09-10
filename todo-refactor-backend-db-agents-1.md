# Orchestrator Agent 1: Financial & Reporting DB Services (`tax.rs` & `reports.rs`)

**Document:** `todo-refactor-backend-db-agents-1.md`  
**Role:** Orchestrator Agent 1 (Financial & Analytics Data Architect)  
**Goal:** Decompose `crates/oz-core/src/db/tax.rs` (1,393 lines) and `reports.rs` (1,263 lines) from massive procedural SQL query files into modular query builders, dedicated aggregate calculators, and unified row mappers.

**Target Crates:** `crates/oz-core/src/db/`  
**Sibling Documents:**
- [`todo-refactor-backend-db-agents-2.md`](./todo-refactor-backend-db-agents-2.md) (Agent 2 — Sales & Checkout DB Repositories)
- [`todo-refactor-backend-db-agents-3.md`](./todo-refactor-backend-db-agents-3.md) (Agent 3 — Inventory, Stock & Catalog Repositories)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Coordinate strictly through Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 1 MUST use:
     - `refactor(db-tax): ...`
     - `refactor(db-reports): ...`
3. **Owned Path Fence (Exclusive to Agent 1):**
   - `crates/oz-core/src/db/tax.rs` & `tax_tests.rs`
   - `crates/oz-core/src/db/reports.rs` & `reports_tests.rs`
   - `crates/oz-core/src/db/tax/` (NEW module directory)
   - `crates/oz-core/src/db/reports/` (NEW module directory)
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `sales*.rs`, `cart.rs`, or `checkout.rs` (Owned by Agent 2).
   - DO NOT edit `inventory*.rs` or `products*.rs` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-core tax reports` to establish passing baseline.
- [ ] Record line counts of `tax.rs` (1,393) and `reports.rs` (1,263).

### Phase 1.1: Decompose `tax.rs`
- [ ] Split `crates/oz-core/src/db/tax.rs` into:
  - `db/tax/rules.rs` (Tax rules, categories, jurisdictions, and bracket queries).
  - `db/tax/rates.rs` (Effective rate calculations and overrides).
  - `db/tax/exemptions.rs` (Customer/product exemption lookups).
- [ ] Keep `db/tax.rs` as a clean facade re-exporting public functions to maintain backwards compatibility.
- [ ] Verify `cargo test -p oz-core tax` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-tax): split tax.rs into modular rules, rates, and exemptions"
  ```

### Phase 1.2: Decompose `reports.rs`
- [ ] Split `crates/oz-core/src/db/reports.rs` into:
  - `db/reports/sales_summary.rs` (Z-reports, X-reports, hourly sales aggregation).
  - `db/reports/product_sales.rs` (Category breakdown, top sellers, dead stock queries).
  - `db/reports/tax_audit.rs` (Statutory tax reporting and audit rollups).
- [ ] Keep `db/reports.rs` as a clean facade.
- [ ] Verify `cargo test -p oz-core reports` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(db-reports): modularize reports.rs into sales_summary, product_sales, and tax_audit"
  ```
