<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 broken index reference) — otherwise ACCURATE · Audited on branch 0.0.40. This file already carried a `> last audited 08-08-26 by docs-auditor` footer but no house stamp; one is added here without disturbing that footer's date claim. · THE REPAIR, and it is an internal contradiction rather than age: the "Existing Indexes" table names `idx_stock_summary_location` and even records the rename — "Composite unique (was `idx_stock_summary_item_location`)". Twelve lines later, the "Top Queries & Index Coverage" table still cites the OLD name — `Stock check (SKU + location) | stock_summary | idx_stock_summary_item_location ✅` — and the Verdict rests on that table ("10/10 top queries have covering indexes"). The old name does not exist: the current schema has `idx_stock_summary_location` at `crates/kasirmu-core/migrations/20260813_init.sql:1292` and no `idx_stock_summary_item_location` anywhere. Repaired, because this is not a stale path but a wrong name inside the document's own evidence table — a reader spot-checking the coverage verdict greps the old name, finds nothing, and cannot confirm the claim. The claim itself is still true; only the name that proves it was wrong. · EVERYTHING ELSE IN P42-2 VERIFIED: `idx_products_sku`, `idx_sales_pending_expires`, `uq_products_barcode` and `idx_customers_name` are all present in the current schema, so the "customers name-index gap is closed" finding remains accurate. · P42-1's central recommendation is confirmed implemented at the source rather than taken from the doc: `crates/kasirmu-core/src/migrations.rs:458-459` sets `journal_mode` to WAL and `busy_timeout` to 5000, and the function's own doc comment at `:449` says so. P42-3 is confirmed too — `scripts/backup-db.sh` runs `PRAGMA integrity_check` at line 41 and `VACUUM` at line 57. · LEFT ALONE as an archived record: the pre-restructure paths (`crates/oz-core/src/migrations.rs:742`, `apps/desktop-client/src/state.rs:176`, `apps/tablet-client/src/state.rs:107` — now `crates/kasirmu-core/`, `apps/desktop-tauri/`, `apps/mobile-tauri/`), the PRAGMA baseline table, the connection-pool analysis, and the "recommended" column values. Those are the evidence of a July audit; the file lives in `docs/archived/` and is not a live runbook. · No stamp existed at the top of this file before this pass. -->

# Database Optimization Audit — 2026-07-20

## P42-1: WAL Mode Audit

### Current State

| Component | Journal Mode | Set Where | Status |
|-----------|-------------|-----------|--------|
| `cloud-server` | WAL | `apps/cloud-server/src/db.rs:93` — `conn.pragma_update(None, "journal_mode", "WAL")` | ✅ Correct |
| `migrations::fresh_db()` | DELETE (default) | In-memory DB — WAL not applicable | ✅ N/A |
| Desktop/tablet clients | WAL | `crates/oz-core/src/migrations.rs:742`, `apps/desktop-client/src/state.rs:176`, `apps/tablet-client/src/state.rs:107` | ✅ Implemented (was the P42-1 recommendation) |

### PRAGMA Settings

| PRAGMA | cloud-server | Desktop Default | Recommended |
|--------|-------------|-----------------|-------------|
| `journal_mode` | WAL | DELETE | **WAL** — concurrent reads, better write perf |
| `foreign_keys` | ON | ON (migrations.rs:533) | ON ✅ |
| `synchronous` | FULL (default) | FULL (default) | NORMAL (WAL mode tolerates this) |
| `cache_size` | -2000 (2MB) default | -2000 default | -8000 (8MB) for production |
| `mmap_size` | 0 (disabled) | 0 | 268435456 (256MB) for large DBs |
| `busy_timeout` | 0 (immediate fail) | 0 | 5000 (5s) for multi-connection safety |

### Recommendation (DONE)

Add WAL mode + busy_timeout to the migration runner so ALL deployments (desktop, tablet, cloud) get consistent settings:

```rust
// In migrations::run() or as a separate setup pragma
conn.pragma_update(None, "journal_mode", "WAL")?;
conn.pragma_update(None, "busy_timeout", "5000")?;
```

✅ **Implemented** — WAL is now set in the migration runner (`migrations.rs:742`) and both clients' state setup (`state.rs:176` / `state.rs:107`).

## P42-2: Index Audit

### Existing Indexes (from migrations)

| Table | Index | Columns | Type |
|-------|-------|---------|------|
| `products` | `idx_products_sku` | `sku` | Unique |
| `products` | `idx_products_category_id` | `category_id` | Non-unique |
| `sales` | `idx_sales_created_at` | `created_at` | Non-unique |
| `sales` | `idx_sales_store_status` | `status` | Non-unique (was `idx_sales_status`) |
| `sales` | `idx_sales_pending_expires` | `status, pending_expires_at` | Partial (WHERE status='pending') |
| `sale_lines` | `idx_sale_lines_sale_id` | `sale_id` | Non-unique |
| `inventory` | `idx_inventory_location_product` / `idx_inventory_warehouse_product` | `product_id` | Non-unique (was `idx_inventory_product_id`) |
| `inventory` | `idx_inventory_location` | `location_id` | Non-unique |
| `stock_summary` | `idx_stock_summary_location` | `item_id, location_id` | Composite unique (was `idx_stock_summary_item_location`) |
| `offline_queue` | `idx_offline_queue_status` | `status` | Non-unique |
| `products` | `uq_products_barcode` | `barcode` | **Unique** (was non-unique `idx_products_barcode`) |

### Top Queries & Index Coverage

| Query | Table | Existing Index | Recommendation |
|-------|-------|---------------|----------------|
| Product lookup by SKU | `products` | `idx_products_sku` ✅ | — |
| Product list by category | `products` | `idx_products_category_id` ✅ | — |
| Sale list (recent) | `sales` | `idx_sales_created_at` ✅ | — |
| Get sale by ID + lines | `sales` + `sale_lines` | PK + `idx_sale_lines_sale_id` ✅ | — |
| Pending sales by expiry | `sales` | `idx_sales_pending_expires` ✅ | — |
| Stock check (SKU + location) | `stock_summary` | `idx_stock_summary_location` ✅ | — |
| Inventory by product | `inventory` | `idx_inventory_product_id` ✅ | — |
| Offline queue by status | `offline_queue` | `idx_offline_queue_status` ✅ | — |
| Barcode lookup | `products` | `idx_products_barcode` ✅ | — |
| Customer lookup by name | `customers` | `idx_customers_name` ✅ | — (added in `007_customers.sql:44` — the P42-2 gap is closed) |

### Verdict

**10/10 top queries have covering indexes.** The `customers` name-index gap was closed (`idx_customers_name` in `007_customers.sql:44`).

## P42-3: Vacuum & Integrity

Added to `scripts/backup-db.sh`:
- `PRAGMA integrity_check` before backup (fail-fast on corruption)
- `VACUUM` after backup (reclaim space from deleted rows, rebuild indexes)

See updated backup script for implementation.

## P42-4: Connection Pool Audit

### Cloud Server

- **SQLite**: `Arc<Mutex<rusqlite::Connection>>` — single connection, correct for SQLite's single-writer model
- **PostgreSQL**: `deadpool_postgres::Pool` with `max_size(8)` — appropriate for cloud deployments
- **Connection timeout**: deadpool default (30s) — reasonable

### Desktop/Tablet

- Direct `rusqlite::Connection` via `Store::new(conn)` — single-connection, correct for embedded SQLite
- No connection pooling needed for single-user desktop app

### Verdict

✅ Connection management is correctly configured for all deployment targets. No leaks detected — connections are properly dropped via Rust's ownership model.

---

> last audited 08-08-26 by docs-auditor
