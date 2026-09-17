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
- [x] Run `cargo test -p oz-core sales` to ensure full passing baseline.
  > Executed pre-edit (13-09-26; the campaign's own fence paths were unmodified over
  > the pre-split HEAD `89b739728d`, parent of `02f38133ea`): **sales = 173
  > lib unit tests passed** (+1 +1 +1 +2 +1 integration-bin hits; 25 `test result:`
  > lines, all `ok`). Re-run after the campaign: all 25 lines IDENTICAL (diff of the
  > ordered result-line lists is empty).
- [x] Invariant check: Verify all queries run within an explicit `rusqlite::Transaction`.
  > ⚠️ **PARTIAL — spot-verified by grep, deliberately not "fixed".** Every
  > multi-statement write path is transaction-scoped (`create_sale`/`create_sale_in_tx`
  > via `insert_sale_with_lines`, the checkout settlement `unchecked_transaction`,
  > lifecycle claim-first conditional UPDATEs). Six single-statement writes run on the
  > bare connection — `sales.rs:329` (`hold_cart` INSERT), `sales.rs:437`
  > (`save_receipt_barcode` INSERT), `sales_crud.rs` `update_sale_status` UPDATE
  > (pre-fold line 663), `cart.rs:43/78/190` (active-cart override stamp, upsert,
  > delete). SQLite already makes each single statement atomic on its own; wrapping one
  > statement in an explicit BEGIN/COMMIT changes nothing behaviorally, so these are
  > recorded, not refactored. (`sales_lifecycle.rs:57` LOOKS like a direct write but its
  > `&Connection` parameter is always called with a `&Transaction` deref —
  > `sales_lifecycle.rs:99/123/461` — so it is in-tx.)

### Phase 2.1: Extract Cart & Sale Lifecycle Repository
- [x] Centralize order status state machine transitions (`Pending` → `Completed` → `Voided` / `Refunded`) into a clean repository pattern.
  > **SHIPPED (and the described machine is a PHANTOM).** The transition matrix lives
  > in ONE place already: `foundation/src/enums.rs:22-68` — `SaleStatus`
  > (`Pending/Active/Completed/Voided`) with `can_transition_to` (exactly three edges:
  > Pending→Active, Active→Completed, Active→Voided), `is_terminal`, and the
  > stored-string pair. Every DB status write gates through it (`update_sale_status`,
  > `sales_crud.rs`), while checkout/lifecycle settlement uses deliberate claim-first
  > conditional UPDATEs inside the settlement transaction (e.g. `void_sale` guarding
  > `status != Active`, `sales_lifecycle.rs:744-750`) — a concurrency guard ON TOP of
  > the matrix, documented as intentional in the `sales.rs` audit header (COR-8 records
  > the one known gap: `void_sale`'s row count is discarded, tracked, not this doc's
  > scope). **`Refunded` does not exist as a `SaleStatus`** — zero hits for `Refunded`
  > across `crates/oz-core/src`; refunds are separate rows in the `refunds` table
  > (`db/refunds.rs`, `create_refund`) which restock via the canonical location adjust
  > (`refunds.rs:670/699/781`). Building a "clean repository pattern" wrapper over an
  > already-centralized, single-writer matrix would be invented indirection → declined.
- [x] Decouple cart line insertion and bulk item updates into dedicated transaction operations.
  > **PHANTOM shape; real equivalent already SHIPPED.** The DB-side cart is a JSON blob
  > in `active_carts` (whole-cart save/load/delete, `cart.rs`, 217 ln) — there are no
  > cart *line rows* and no per-item bulk UPDATE statements to decouple. Line
  > persistence is already exactly what the box asks for: the dedicated tx-scoped
  > helpers `insert_sale_line(tx, …)` (kept in the `sales.rs` parent for cross-part
  > use) and `insert_sale_with_lines(tx, …)` (`sales_crud.rs:85`), consumed per-line by
  > `create_sale_in_tx` and by the checkout settlement loop (`sales_checkout.rs:521-522`)
  > inside its single ADR-19 §5.2 transaction. Nothing remains.
- [x] Verify `cargo test -p oz-core sales` passes.
  > 173→173 identical, integration hits identical.
- [x] **Commit Milestone:**
  > `refactor(db-sales): isolate sale lifecycle transactions and line persistence`
  > — **no commit made: Phase 2.1 shipped nothing** (SHIPPED/PHANTOM verdicts above).
  > Manufacturing a diff to satisfy the milestone line is exactly the invented
  > busywork this campaign forbids; the one REAL sales-domain fix found by this audit
  > (row mappers) is committed under Phase 2.2's convention.

### Phase 2.2: Unify Sale Row Mappers & DTO Builders
- [x] Consolidate duplicate row mapping across `sales_crud.rs` and `sales_checkout.rs` into shared row mappers.
  > ⚠️ **Wrong file pair — but a REAL duplication existed and was folded.**
  > `sales_checkout.rs` contains ZERO Sale/SaleLine row mappers (only scalar/tuple
  > reads at :28/:35, :118-122, :316) — cross-file mapper duplication is PHANTOM. The
  > real duplication was inside `sales_crud.rs`: FIVE inline `Sale`-header closures over
  > the identical 21-column projection; programmatic comparison (trimmed, blank-
  > stripped) proved `list_sales_sql` == `list_sales_for_store` == `list_sales_for_customer`
  > == `get_sale` byte-identical (44 lines each), while `list_sales_by_user` is a
  > DIVERGENT 5th (strict `row.get("discount_percent")?` / `row.get("version")?`
  > instead of the `.unwrap_or(Some(0))` / `.unwrap_or(1)` defaults → a NULL column
  > errors there where the others substitute). The four identical ones were folded into
  > one private `Store::row_to_sale_header` in `d7bb265fa4`; the divergent one was left
  > untouched — folding it would substitute defaults for errors, i.e. a behavior
  > change. `sales_crud.rs` 679→555 lines.
- [x] Ensure `Money` (`i64` minor units) is consistently parsed across all columns.
  > **SHIPPED.** Zero `f32`/`f64` occurrences in any sales-fence production file; every
  > money column parses as `Money { minor_units: row.get("<col>_minor")?, currency }`
  > (i64). After the fold this is structurally single-sourced for the header
  > (`row_to_sale_header`) and line (`row_to_sale_line`) shapes.
- [x] Verify `cargo test -p oz-core sales` passes.
  > 173→173 + identical integration tails; also `cargo check -p oz-bridge
  > -p oz-cloud-server` clean post-campaign.
- [x] **Commit Milestone:**
  > `d7bb265fa4` — `refactor(db-sales): fold four identical inline sale-row mappers
  > into one shared row_to_sale_header` (1 file, +62/−186; subject adapts the mandated
  > "unify sale row mapping…" to what actually shipped, convention respected).

---

## ✅ Closure stamp (13-09-26, sales/products orchestrator)

- **Verdict table:** 2.0a SHIPPED (baseline recorded + verified identical); 2.0b
  PARTIAL (6 single-statement bare-conn writes recorded, not wrapped — no behavioral
  delta to gain); 2.1a SHIPPED + PHANTOM (`Refunded` status does not exist;
  centralization lives in `foundation/src/enums.rs:61`); 2.1b PHANTOM/SHIPPED (no
  cart-line rows exist; tx-scoped line helpers already shipped); 2.1c/2.2c verified;
  2.1d NOT COMMITTED (nothing to commit); 2.2a PHANTOM cross-file claim → REAL
  intra-file 4× fold landed; 2.2b SHIPPED; 2.2d committed.
- **Tests:** `sales` filter 25/25 result lines byte-identical baseline→final (173 lib
  + 6 integration hits); zero behavior drift by construction — the fold only replaced
  four identical closure bodies with references to one function holding their exact
  text.
- **Files touched:** `crates/oz-core/src/db/sales_crud.rs` ONLY (679→555 ln,
  + `row_to_sale_header`). `sales.rs`, `sales_checkout.rs`, `sales_lifecycle.rs`,
  `sales_tax.rs`, `cart.rs` and all `*_tests.rs` untouched. `db/mod.rs`, `tax*`,
  `reports*`, `kds*` never opened for edit.
- **Formatting:** per-file `rustfmt --edition 2024 crates/oz-core/src/db/sales_crud.rs`;
  `cargo fmt -p oz-core -- --check` lists diffs only in `kds_rules.rs` and
  `kds_rules_tests.rs` (foreign, in-flight), none in campaign files.
- **Collisions:** none observed inside the fence; foreign dirty files (auth/QRIS
  session under `apps/mobile-tauri/`, `crates/oz-bridge/src/lib.rs`, generated PG
  schema, dev-mock UI) were never staged, committed, or reverted.
