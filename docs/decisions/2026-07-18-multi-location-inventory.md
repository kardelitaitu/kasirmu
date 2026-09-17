---
num: 18
area: inventory
title: ADR #18: Multi-Location Inventory — Workspace-Bound Stock Locations for Wholesale & Retail
status: Implemented (2026-07-19)
---
# ADR #18: Multi-Location Inventory — Workspace-Bound Stock Locations for Wholesale & Retail

<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (1 finding) · F1: §13 cites "079_workspace_types_rename.sql" / "Migration 079 adds a per-location index" but 079 is actually 079_inventory_location_id.sql; the workspace rename cascade shipped as 091_workspace_types_rename.sql and the per-location index as 080_stock_movements_location_id.sql (migration numbers off-by-actual in the doc) · verified accurate: migrations 078-091 present (078 inventory_locations, 080 stock_movements.location_id, 082 bound_location_id, 083 workspace_inventory_locations, 084 inventory_transactions, 085 inventory_transaction_id FK, 087 stock_thresholds, 089 stock_summary composite PK, 090 purchase_orders.location_id, 091 workspace rename); 035_workspaces + 060_workspace_instances + 072 archive present; adjust_stock_at_location_with_reason at crates/oz-core/src/db/products.rs:791; InventoryStockHandler at modules/inventory/src/handlers.rs; rebuild_stock_summary in products.rs; Status "Implemented" matches on-disk schema -->

**Status:** Implemented (2026-07-19)
**Date:** 2026-07-18
**Decision Record:** Reviewed and audited against current codebase (see §13)
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** inventory, multi-location, stock, wholesale, workspace, retail-pos, warehouse

---

## Context

### Business Scenario

A snack wholesale business operates with **multiple inventory locations** and needs the following workspace setup:

| Workspace | Type | Role |
|---|---|---|
| **Retail POS** | `store-pos` | Front-facing cashier terminal — sells to walk-in customers |
| **Store Inventory** | `warehouse` | On-hand stock at the retail location (minimum stock, fast-moving items) |
| **Warehouse A** | `warehouse` | Bulk storage — receives supplier deliveries, ships to Store Inventory |
| **Warehouse B** | `warehouse` | Secondary bulk storage — overflow, seasonal items, slow-movers |

> **Why `warehouse` not `inventory`?** The workspace type describes the *role*
> the staff perform — warehouse work (receiving, transferring, counting stock).
> The module that powers it is still `modules/inventory/` internally, but
> the user-facing workspace type key `warehouse` is more intuitive. Even a
> small retail store's back room is functionally a mini-warehouse — same
> activities, just smaller scale. This rename requires a migration to update
> the `workspace_types` row: `UPDATE workspace_types SET key = 'warehouse',
> name = 'Warehouse' WHERE key = 'inventory'.`

> **Rename cascade — 6+ call sites (added by post-decision review — see §13 finding 37):**
> The single-row UPDATE above is necessary but NOT sufficient. The codebase
> hard-codes the literal string `'inventory'` in at least six sites that must
> be migrated in lockstep:
>
> 1. `crates/oz-core/migrations/035_workspaces.sql:32` — workspace seed row.
> 2. `crates/oz-core/migrations/035_workspaces.sql:46-51` — `workspace_screens`
>    rows that key by `'inventory'`.
> 3. `crates/oz-core/migrations/060_workspace_instances.sql:110` — sort_order
>    CASE expression `WHEN 'inventory' THEN 4`.
> 4. `ui/src/features/inventory/` — feature directory name; the front-end
>    router (`ui/src/App.tsx` and friends) resolves workspace keys by string.
> 5. `ui/src/locales/*.ftl` — fluent bundle IDs prefixed `inventory-…`.
> 6. `platform/startup/src/lib.rs` — module registration by name.
> 7. `modules/inventory/manifest.json` — `id` field literally equals `"inventory"`; the manifest is read at module-discovery time, so a rename requires this file to be patched in lockstep.
> 8. The `modules/inventory/` Rust crate name (a public name surface that downstream code may import) — cannot be renamed without a multi-crate refactor; the ADR will keep the internal crate name and only rename the user-facing workspace key.
>
> Migration 079 (`079_workspace_types_rename.sql`) MUST update all six sites
> atomically inside a single transaction. Failure to coordinate causes
> front-end routes to 404, fluent bundles to miss the rename, and POS module
> registration to fail at startup. A clippy lint
> (`workspace_types_key_match_runtime`) added in the same PR forbids new
> occurrences of the literal string `'inventory'` outside the migration file.

### Topology Diagram

```mermaid
graph TB
    subgraph Workspaces["Workspace Instances"]
        POS[Retail POS<br/><i>store-pos</i>]
    INV_S[Store Inventory<br/><i>warehouse</i>]
    INV_A[Warehouse A<br/><i>warehouse</i>]
    INV_B[Warehouse B<br/><i>warehouse</i>]
    end

    subgraph Locations["Inventory Locations (per-store DB)"]
        LOC_S[("Store Inventory<br/>type: store<br/>front-facing shelf")]
        LOC_A[("Warehouse A<br/>type: warehouse<br/>bulk storage")]
        LOC_B[("Warehouse B<br/>type: warehouse<br/>bulk storage")]
    end

    subgraph Flows["Stock Flow"]
        PO[Purchase Order] -->|receive into| LOC_A
        PO -->|receive into| LOC_B
        LOC_A -->|transfer| LOC_S
        LOC_B -->|transfer| LOC_S
        LOC_A <-.->|transfer| LOC_B
    end

    POS -- "primary (sale deduction)" --> LOC_S
    POS -.- "secondary (lookup only)" --> LOC_A
    POS -.->|not bound| LOC_B

    INV_S -- "bound_location_id" --> LOC_S
    INV_A -- "bound_location_id" --> LOC_A
    INV_B -- "bound_location_id" --> LOC_B

    style POS fill:#e1f5fe,stroke:#0288d1
    style INV_S fill:#fff3e0,stroke:#f57c00
    style INV_A fill:#fff3e0,stroke:#f57c00
    style INV_B fill:#fff3e0,stroke:#f57c00
    style LOC_S fill:#e8f5e9,stroke:#388e3c
    style LOC_A fill:#e8f5e9,stroke:#388e3c
    style LOC_B fill:#e8f5e9,stroke:#388e3c
```

### Key Requirements

1. **POS must be bound to one or more inventory locations.** The Retail POS deducts stock from its primary inventory location ("Store Inventory") when a sale is completed. Managers can also set the POS to query **multiple locations** so the cashier can see exactly where each item is located.

2. **Stock is tracked per location, not globally.** An item can have 10 units in Store Inventory, 500 in Warehouse A, and 0 in Warehouse B. Each location independently records its own stock movements.

3. **Cross-location transfers.** Each inventory workspace can send items to another workspace (Warehouse A → Store Inventory, Warehouse A → Warehouse B, etc.). The transfer flow: source location deducts qty, creates a transfer record, target location receives and credits qty.

4. **Purchase orders deliver to a specific location.** When the business buys goods, the PO screen lets staff select the receiving location (Warehouse A, Warehouse B).

5. **POS can optionally display stock from multiple locations.** A retail POS bound to "Store Inventory" + "Warehouse A" can show the combined or location-specific stock for each product, so the cashier knows whether to sell from shelf or offer next-day delivery from the warehouse.

### Current Limitations

The existing inventory model has no location concept:

- `inventory` table: `(product_id, qty)` — global, no location dimension.
- `stock_movements` table: `(item_id, delta, reason, ...)` — no `location_id` column. Deltas are recorded against the product globally.
- `stock_summary` table: `(item_id, qty)` — materialised aggregate of the ledger, also location-less.
- `stock_transfers` table: has `source_location` / `destination_location` as free-text fields, but these are not linked to workspace instances or any `locations` table.
- `adjust_stock` and `adjust_stock_with_reason` operate on the global stock — no concept of scoping to a location.
- POS sale deduction (via `InventoryStockHandler`) deducts from the single global stock pool.

This works for a single-location cafe or food stall, but fails for the wholesale scenario where stock is deliberately distributed across multiple physical locations.

---

## Decision

### 1. Inventory Locations as First-Class Entities

Create an `inventory_locations` table. Every location is a logical or physical place where stock lives. Each location is **not** a workspace instance — it is a *domain entity* that an inventory workspace instance can manage.

```sql
CREATE TABLE inventory_locations (
    id          TEXT PRIMARY KEY,                         -- UUID v7
    name        TEXT NOT NULL,                            -- 'Store Inventory', 'Warehouse A'
    type        TEXT NOT NULL DEFAULT 'store',   -- documented values: 'store', 'warehouse',
                                                  -- 'transit', 'damaged', 'virtual'
    description TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

- Locations are **per-store database** entities (each store's DB has its own locations).
- `type = 'store'` represents a retail-facing stock location (Store Inventory).
- `type = 'warehouse'` represents a bulk storage location.
- `type = 'transit'` is a system-managed logical location for in-transit stock during transfers.
- `type = 'damaged'` for damaged goods quarantine (future use).
- `type = 'virtual'` for Dropship / Direct-to-consumer scenarios where stock is held by a third party (future use).

### 2. Scoping Stock Tables by Location

Add a `location_id` column to the three stock tables. This is a migration, not a new table — existing data is migrated to a default location.

#### 2a. `inventory` table — add `location_id`

> **⚠ SQLite Rebuild Safety:** Table rebuilds via `RENAME` / `DROP` require
> `PRAGMA foreign_keys = OFF` before the rebuild and `PRAGMA foreign_keys = ON`
> afterward. Without this, SQLite may either block the `DROP` or trigger
> unintended cascades through FK relationships from other tables.

```sql
-- Step 0: Disable FK enforcement for the rebuild.
PRAGMA foreign_keys = OFF;

-- Step 1: Seed default location with a stable UUID (not 'default' literal).
-- The literal 'default' would collide with rows written by 3rd-party imports.
INSERT OR IGNORE INTO inventory_locations (id, name, type)
VALUES ('01926b3a-0000-7000-8000-000000000001', 'Default Inventory', 'store');

INSERT OR IGNORE INTO inventory_locations (id, name, type)
VALUES ('01926b3a-0000-7000-8000-000000000002', 'In Transit', 'transit');

-- Legacy 'default' string is reserved as a runtime name-lookup alias; the
-- canonical ID is the UUID above. Application-layer resolver at startup:
--
--     SELECT id FROM inventory_locations WHERE name = 'Default Inventory';
--
-- and caches both default + transit UUIDs in memory for the lifetime of the
-- process. See §13 finding 36 for rationale.

-- Step 2: Add location_id, defaulting existing rows to the default location.
ALTER TABLE inventory ADD COLUMN location_id TEXT
    REFERENCES inventory_locations(id) ON DELETE RESTRICT
    DEFAULT 'default';

-- Step 3: Drop the old PK, create composite PK.
-- SQLite requires a table rebuild for this.
ALTER TABLE inventory RENAME TO inventory_old;

CREATE TABLE inventory (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    qty        INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (product_id, location_id)
);

INSERT INTO inventory (product_id, location_id, qty, updated_at)
SELECT product_id, COALESCE(location_id, 'default'), qty, updated_at
FROM inventory_old;

DROP TABLE inventory_old;

-- Step 4: Re-enable FK enforcement.
PRAGMA foreign_keys = ON;
```

> **`list_products` query impact:** The `list_products` query currently does
> `LEFT JOIN inventory i ON p.id = i.product_id`. After the composite PK
> migration `(product_id, location_id)`, a product with stock in 3 locations
> will return 3 duplicate rows. The query must be updated to aggregate via a
> subquery:
>
> ```sql
> LEFT JOIN (SELECT product_id, SUM(qty) AS stock_qty FROM inventory GROUP BY product_id) i ON p.id = i.product_id
> ```
>
> This preserves the existing API contract (one row per product with total
> stock) while the location-aware `get_stock_at_location` and
> `get_stock_all_locations` functions handle per-location queries.
> `list_warehouse_products` must be updated identically.

> **Why `ON DELETE RESTRICT` not `ON DELETE CASCADE`?** If a manager deletes a
> location that still has stock, CASCADE would silently destroy all inventory
> records. RESTRICT forces the caller to either move the stock first or
> soft-delete the location (`is_active = 0`). The `stock_movements` table has
> no CASCADE either, so deleting a location with movements would FK-violate.

#### 2b. `stock_movements` table — add `location_id`

```sql
ALTER TABLE stock_movements ADD COLUMN location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT;
```

This is a simple `ALTER TABLE ADD COLUMN` because `stock_movements` has no unique constraint involving `item_id` alone. Existing rows default to `'default'`. `ON DELETE RESTRICT` matches the pattern on `inventory` and `stock_summary` — a location with stock movements cannot be hard-deleted.

**Also migrate `stock_movements_archive`:** The archive table (migration 072) mirrors
`stock_movements`'s schema. It must also receive the `location_id` column so
archived deltas retain location provenance for audit queries:

```sql
ALTER TABLE stock_movements_archive ADD COLUMN location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT;
```

Without this, archive consolidation silently drops the location dimension from
older stock movements, making audit queries location-blind for pruned data.

> **`location_id` index (added by post-decision review — see §13 finding 35):**
> Migration 079 adds a per-location index on the ledger, deliberately kept
> **non-overlapping** with migration 063's per-item index:
>
> ```sql
> -- Migration 063 already has idx_stock_movements_item (item_id, created_at)
> -- for per-product queries; this adds the complementary per-location index.
> -- No composite (item_id, location_id, created_at) is added because
> -- cross-direction queries ("all movements of product X at location Y")
> -- are rare in audit dashboards and can be served by either single index.
> CREATE INDEX IF NOT EXISTS idx_stock_movements_location_created
>   ON stock_movements(location_id, created_at);
>
> CREATE INDEX IF NOT EXISTS idx_stock_movements_archive_location_created
>   ON stock_movements_archive(location_id, created_at);
> ```
>
> Without these, the location-aware audit queries in §9 (e.g.
> "everything Budi did at Warehouse A today") will full-scan the ledger.

#### 2c. `stock_summary` table — add `location_id`

```sql
-- Rebuild to add location_id to the PK.
-- Same PRAGMA safety as 2a: disable/enable foreign_keys around the rebuild.
PRAGMA foreign_keys = OFF;

ALTER TABLE stock_summary RENAME TO stock_summary_old;

CREATE TABLE stock_summary (
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    qty         INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (product_id, location_id)
);

-- stock_summary_old has NO location_id column — use the hardcoded default.
INSERT INTO stock_summary (product_id, location_id, qty, updated_at)
SELECT item_id, 'default', qty, updated_at
FROM stock_summary_old;

DROP TABLE stock_summary_old;

PRAGMA foreign_keys = ON;
```

> **Note:** `rebuild_stock_summary()` in `products.rs` must be updated to
> `GROUP BY product_id, location_id` — the old `GROUP BY item_id` will fail
> because `location_id` is now part of the composite PK and has no default.

#### 2d. Update `stock_transfers` — link to `inventory_locations`

The existing `stock_transfers` table has free-text `source_location` / `destination_location`. These are changed to FK references:

```sql
-- Rename old columns (keep data for audit).
ALTER TABLE stock_transfers RENAME COLUMN source_location TO source_location_old;
ALTER TABLE stock_transfers RENAME COLUMN destination_location TO destination_location_old;

-- Add FK columns. NOT NULL prevents drafts without a destination;
-- legacy rows are migrated to the 'default' location.
UPDATE stock_transfers SET source_location = '01926b3a-0000-7000-8000-000000000001' WHERE source_location IS NULL OR source_location = '';
UPDATE stock_transfers SET destination_location = '01926b3a-0000-7000-8000-000000000001' WHERE destination_location IS NULL OR destination_location = '';
/*
 * NOTE — audit-only intent for the two UPDATE statements above:
 *   - The legacy free-text `source_location` / `destination_location` columns
 *     are renamed to `_old` immediately after the FK columns are added.
 *   - The `01926b3a-0000-7000-8000-000000000001` literal in those two
 *     UPDATEs is purely an audit-trail backfill for pre-migration rows with
 *     NULL/blank text values. Downstream readers MUST use the `_location_id`
 *     FK columns and NEVER consult the `_old` text columns at runtime.
 *   - A pre-migration row whose text source AND destination were both
 *     'default' (i.e. unassigned) reads back as source=destination=default-UUID,
 *     but the row is otherwise inert — this is an audit artefact, not
 *     operational state.
 */

ALTER TABLE stock_transfers ADD COLUMN source_location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD COLUMN destination_location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT;
```

Existing rows keep their free-text values in `_old` columns; new rows use the FK columns.

### 3. Updating the Stock Adjustment API

**Backward compatibility strategy:** Adding `location_id` to existing function
signatures would break every caller — the `InventoryStockHandler`, all Tauri
commands in both desktop and tablet clients, test suites, and `rebuild_stock_summary`.

Instead, we introduce **new location-aware variants** and keep the old signatures
working via default-location resolution:

```rust
// ── Location-aware (new) ────────────────────────────────────────────

/// Adjust stock at a specific inventory location. Writes to the delta
/// ledger, updates the materialised `inventory` and `stock_summary` tables.
pub fn adjust_stock_at_location(
    &self,
    sku: &str,
    delta: i64,
    location_id: &str,
) -> Result<i64, CoreError>;

pub fn adjust_stock_at_location_with_reason(
    &self,
    sku: &str,
    delta: i64,
    location_id: &str,
    reason: Option<&str>,
    source_terminal_id: Option<&str>,
    source_user_id: Option<&str>,
) -> Result<i64, CoreError>;

/// Same as above but also records an `inventory_transaction_id` on
/// each `stock_movements` row created, linking the delta to the
/// staff audit session that triggered it.
pub fn adjust_stock_at_location_with_reason_and_tx_id(
    &self,
    sku: &str,
    delta: i64,
    location_id: &str,
    reason: Option<&str>,
    source_terminal_id: Option<&str>,
    source_user_id: Option<&str>,
    inventory_transaction_id: &str,
) -> Result<i64, CoreError>;

/// Read stock at a specific location.
pub fn get_stock_at_location(&self, product_id: &str, location_id: &str) -> Result<i64, CoreError>;

/// Read stock across multiple locations for POS lookup.
pub fn get_stock_all_locations(
    &self,
    sku: &str,
    location_ids: &[&str],
) -> Result<Vec<StockAtLocation>, CoreError>;

// ── Transaction-aware (for use inside BEGIN IMMEDIATE) ──────────────

/// Same as `adjust_stock_at_location_with_reason` but operates inside
/// the caller's existing transaction. Does NOT open its own BEGIN/COMMIT.
/// Must only be called when a transaction is already active.
pub fn adjust_stock_in_tx(
    &self,
    tx: &Transaction,
    sku: &str,
    delta: i64,
    location_id: &str,
    reason: Option<&str>,
    source_terminal_id: Option<&str>,
    source_user_id: Option<&str>,
) -> Result<i64, CoreError>;

/// Atomically deduct stock from multiple locations for one or more SKUs.
/// Operates inside the caller's `Transaction` — all-or-nothing within
/// the caller's `BEGIN IMMEDIATE`. Used by the split-fulfillment flow
/// (Section 6b) where one line item is deducted from 2+ locations.
pub fn adjust_stock_batch(
    &self,
    tx: &Transaction,
    deductions: &[StockDeduction],
) -> Result<(), CoreError>;

pub struct StockDeduction {
    pub sku: String,
    pub location_id: String,
    pub delta: i64,  // negative for deduction
}

// ── Legacy (preserved, routes to default location) ──────────────────

/// Existing callers continue to work — internally resolves to the
/// 'default' inventory location.
pub fn adjust_stock(&self, sku: &str, delta: i64) -> Result<i64, CoreError>;
pub fn adjust_stock_with_reason(
    &self, sku: &str, delta: i64, reason: Option<&str>,
    source_terminal_id: Option<&str>, source_user_id: Option<&str>,
) -> Result<i64, CoreError>;
pub fn get_stock(&self, product_id: &str) -> Result<i64, CoreError>;
```

Old callers (single-location deployments, test suites, non-inventory modules)
continue to work unchanged. The legacy functions resolve `location_id = "default"`
internally and delegate to the location-aware variants. This is transparent for
single-location users and prevents a flag-day migration of every call site.

`adjust_stock_in_tx` is critical for the `complete_sale` flow (Section 6):
`adjust_stock_at_location_with_reason` opens its own transaction via
`self.conn.unchecked_transaction()`, which inside an existing `BEGIN IMMEDIATE`
would degrade to a savepoint — defeating the atomicity guarantee. The `_in_tx`
variant operates directly on the caller's `Transaction` reference with no
inner BEGIN/COMMIT.

### 4. POS-to-Location Binding

A new `workspace_inventory_locations` table links a POS workspace instance to its inventory locations:

```sql
CREATE TABLE workspace_inventory_locations (
    id                  TEXT PRIMARY KEY,
    instance_id         TEXT NOT NULL REFERENCES workspace_instances(id) ON DELETE CASCADE,
    location_id         TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    is_primary          INTEGER NOT NULL DEFAULT 0,  -- exactly one primary per instance
    allow_negative_stock INTEGER NOT NULL DEFAULT 0, -- per-location override
    sort_order          INTEGER NOT NULL DEFAULT 0,
    UNIQUE(instance_id, location_id)
);

CREATE INDEX idx_ws_inv_locations_instance ON workspace_inventory_locations(instance_id);
```

- `is_primary = 1` designates the location from which the linked workspace **deducts** stock on sale.
- `allow_negative_stock = 1` lets this location go below zero when stock is insufficient — useful for a retail POS that must complete the sale even if the shelf count is off.
  - **Alert requirement:** When a deduction creates negative stock (`allow_negative_stock = 1`), the backend MUST emit a warning event (`stock.negative`). The inventory dashboard MUST show a "stock below zero" badge with affected SKUs and locations. This prevents the flag from silently turning inventory into a suggestion system.
- Additional rows with `is_primary = 0` are lookup-only — the cashier can see stock there but sales deduct only from the primary location.
- For a `store-pos` workspace:
  - Scan/item lookup → query all bound locations → display stock for each.
  - Complete sale → deduct from `is_primary = 1` location only.
  - If primary location has insufficient stock AND `allow_negative_stock = 0`: the POS shows a dialog letting the cashier pick an alternative bound location to draw from (or override and draw from primary with a manager PIN).

### 5. Inventory Workspace Scope

Each inventory workspace instance is **bound to its own location** as the default scope, but provides a **location picker** in the header to view/act on other locations. The `workspace_instances` table gets an optional `bound_location_id` FK:

```sql
ALTER TABLE workspace_instances ADD COLUMN bound_location_id TEXT
    REFERENCES inventory_locations(id);
```

> **Split-brain prevention:** A workspace instance MUST NOT have both
> `bound_location_id` set AND rows in `workspace_inventory_locations`.
> The unified `get_workspace_locations()` resolver (Section 10) enforces
> this at the application level — it returns a `CoreError::Validation`
> if it finds both binding mechanisms active on the same instance.
> (SQLite CHECK constraints cannot reference other tables, so there is
> no database-level enforcement possible without triggers.)
>
> **Location deletion policy:** Locations with stock > 0 must not be
> hard-deleted. The `ON DELETE RESTRICT` FKs (Section 2) enforce this
> at the database level. The `'default'` and `'transit'` locations must
> **never** be deactivated (`is_active` must always be 1) — legacy APIs
> and the transfer engine resolve these locations by hardcoded ID.
> The UI should offer a "Deactivate" action that sets `is_active = 0` —
> inactive locations are hidden from pickers. However, a location MUST
> NOT be deactivated if it still contains stock (>0 for any product).
> Staff must transfer all stock out before deactivating or deleting.
> (A "Delete" action should only be offered when the location has zero
> stock across all products AND no historical movements).

For the wholesale scenario this creates:

| Workspace Instance | Type | `bound_location_id` | Default View |
|---|---|---|---|
| **Store Inventory** | `warehouse` | `store-inv` | Store Inventory stock only |
| **Warehouse A** | `warehouse` | `wh-a` | Warehouse A stock only |
| **Warehouse B** | `warehouse` | `wh-b` | Warehouse B stock only |
| *(unbound)* | `warehouse` | `NULL` | Aggregate across all locations (admin view) |

The workspace's default landing page is scoped to its bound location. A **location switcher dropdown** in the inventory workspace header lets the user switch to any other location within the store. This covers two use cases:

1. **Day-to-day**: a Warehouse A worker opens the workspace, sees Warehouse A stock by default — no noisy cross-location data.
2. **Cross-location task**: same worker uses the location picker to view Store Inventory stock, then initiates a transfer — no need to switch workspaces.

Location-filtered views:

- **Dashboard**: stock overview, low-stock alerts, recent movements (scoped by selected location; "All" shows aggregate).
- **Stock ledger**: per-location query via the location picker.
- **Transfer screen**: source pre-filled to the workspace's bound location; destination selectable via dropdown.
- **Stock counts / adjustments**: user picks which location to count/adjust; the workspace's bound location is the default selection.

When `bound_location_id` is `NULL`, the workspace is an unbound admin console showing aggregate data across all locations. This is the fallback when migrating existing single-location databases (legacy `inventory` workspace — now `warehouse`).

### 6. Sale Deduction Flow (Retail POS)

#### 6a. Two-Command Pattern

Stock deduction is synchronous within `complete_sale`. The key design constraint:
**SQLite transactions must never be held open across human interaction.**
`BEGIN IMMEDIATE` takes a write lock on the entire database — if held while
a cashier stares at a dialog, every other terminal fails with `SQLITE_BUSY`.

Therefore the flow uses **two commands**:

```
┌─ complete_sale ─────────────────────────────────────────────────┐
│                                                                 │
│  1. BEGIN IMMEDIATE TRANSACTION                                 │
│  2. Create the Sale row (payment capture HAS ALREADY COMPLETED) │
│  3. Resolve primary location from workspace_inventory_locations │
│  4. For each line item:                                         │
│     a. Skip if product.tracks_inventory() == false AND         │
│        product.has_recipe() == false (service products like    │
│        "car wash" have no stock; but composite items must      │
│        still check/deduct their tracked BOM ingredients).      │
│     b. Check stock at primary location                          │
│     c. If sufficient: deduct via adjust_stock_in_tx (uses       │
│        caller's Transaction, no inner BEGIN/COMMIT).            │
│     d. If insufficient: record this line as a shortfall.        │
│        (allow_negative_stock=1 does NOT bypass the dialog;      │
│        it simply adds a "Go Negative" option to the dialog,     │
│        preserving the cashier's ability to split fulfill).      │
│  5. If ZERO shortfalls: COMMIT, return CompleteSaleResult.      │
│     If ANY shortfall: ROLLBACK, return PartialStockResult with  │
│     ALL shortfalls collected.                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (shortfall case)
┌─ Frontend: Stock Shortfall Dialog ──────────────────────────────┐
│                                                                 │
│  Cashier resolves each shortfall (pick alt location, split, or  │
│  manager-override). May take seconds to minutes.                │
│  No database lock is held during this time.                     │
│                                                                 │
│  If cashier clicks [Cancel Sale]: sale is already rolled back.  │
│  No cleanup needed.                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (cashier confirms)
┌─ complete_sale_with_resolved_shortfalls ────────────────────────┐
│                                                                 │
│  1. BEGIN IMMEDIATE TRANSACTION (fresh)                         │
│  2. Re-create the Sale row and payment records                  │
│  3. Re-check stock at ALL locations in the resolution plan      │
│     (stock may have changed since the dialog was shown;         │
│     service products never appear here — they were skipped in   │
│     the first command and never shortfalled).                   │
│  4. If any location NOW has insufficient stock: ROLLBACK,       │
│     return PartialStockResult with updated shortfalls so the    │
│     cashier can re-resolve.                                     │
│  5. If all sufficient: deduct via adjust_stock_in_tx for each   │
│     location in the plan, COMMIT.                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```**Why re-create the sale row?** `complete_sale` rolls back on shortfall, so
the sale doesn't exist when `complete_sale_with_resolved_shortfalls` starts. This
is intentional — the sale only persists in the database once stock is confirmed.
An abandoned shortfall dialog leaves no orphaned sale rows.

> **⚠ Critical post-capture rollback risk (added by post-decision review — see §13 finding 31):**
> Stock-availability MUST be reserved **before** any external payment terminal is
> asked to capture funds to avoid stranded payments during a concurrent checkout race.
>
> The corrected flow uses a **Stock Reservation (Pending Sale)** pattern:
>
> ```text
> 1. Front-end selects product availability. If insufficient, resolve via Shortfall Dialog.
> 2. Front-end calls `create_pending_sale` (or `create_pending_sale_with_resolution`).
>    This opens BEGIN IMMEDIATE, verifies/deducts stock, and creates a `sales` row
>    with `status = 'pending'`. COMMIT.
> 3. Front-end calls payment terminal → attempts to capture funds.
> 4. If capture SUCCESS: Front-end calls `finalize_sale` → updates status to `completed`.
> 5. If capture FAILS/CANCELS: Front-end calls `void_pending_sale` → voids sale
>    and credits stock back to their original locations.
> ```
>
> This guarantees we never capture money for stock we don't have, eliminating the
> need for automated payment refunds (which are prone to network timeouts) when a
> concurrent terminal steals the stock. **No silent money loss, no stranded funds.**

**Why re-check stock?** Between the dialog appearing and the cashier clicking
"Confirm", another terminal may have sold the same item from the alternative
location. The fresh `BEGIN IMMEDIATE` re-reads current stock levels. If stock
is now insufficient again, the cashier gets an updated dialog — no silent
oversell.

#### 6b. Insufficient Stock — Fallback Flow

When the primary location (e.g. Store Inventory) has less stock than the sale
requires, the backend **collects ALL shortfalls across ALL line items** before
responding — it does not short-circuit on the first one. This way the cashier
sees every item that needs an alternative source in a single dialog. (Note:
The shortfall dialog always triggers even if `allow_negative_stock = 1`, which
simply adds a "Draw from Primary (Go Negative)" resolution option.)

```
1. complete_sale opens BEGIN IMMEDIATE, checks all line items,
   collects ALL shortfalls, ROLLBACK, returns:

   PartialStockResult {
     shortfalls: [
       {
         sku: "CHO-001",
         product_name: "Choco Bar",
         primary_qty: 5,
         requested_qty: 20,
         deficit: 15,
         alternatives: [
           { location_id: "wh-a", location_name: "Warehouse A", qty: 500 },
           { location_id: "wh-b", location_name: "Warehouse B", qty: 200 },
         ]
       },
       {
         sku: "NUT-002",
         product_name: "Mixed Nuts",
         primary_qty: 0,
         requested_qty: 10,
         deficit: 10,
         alternatives: [
           { location_id: "wh-a", location_name: "Warehouse A", qty: 300 },
         ]
       }
     ]
   }

2. Frontend shows a "Stock Shortfall" dialog listing ALL items:
   ┌─────────────────────────────────────────────┐
   │  ⚠ Not enough stock at Store Inventory      │
   │                                             │
   │  Choco Bar:  wanted 20, have 5              │
   │  ├─ ● Warehouse A       (500 available)     │
   │  ├─ ○ Warehouse B       (200 available)     │
   │  └─ ○ Split (5 Store + 15 Warehouse A)     │
   │     ⚠ Warehouse fulfillment may incur       │
   │       delivery charges.                     │
   │                                             │
   │  Mixed Nuts:  wanted 10, have 0             │
   │  └─ ● Warehouse A       (300 available)     │
   │     ⚠ Warehouse fulfillment may incur       │
   │       delivery charges.                     │
   │                                             │
   │  [Cancel Sale]      [Confirm & Continue]    │
   └─────────────────────────────────────────────┘

3. Cashier picks per-item: alternative location, split, or override.
   The dialog MUST include the pricing warning for any non-store
   location selection (see Section 6c).

4. For "Split" (one item deducted from multiple locations):
   Cashier specifies quantities per location. On confirmation,
   `complete_sale_with_resolved_shortfalls` calls `adjust_stock_batch`:

   adjust_stock_batch(&tx, &[
     StockDeduction { sku: "CHO-001", location_id: "store-inv", delta: -5 },
     StockDeduction { sku: "CHO-001", location_id: "wh-a",     delta: -15 },
   ])?;

   `adjust_stock_batch` accepts a `&Transaction` reference. All deductions
   happen inside the caller's `BEGIN IMMEDIATE` — all-or-nothing atomicity.

5. For manager override (draw from primary despite shortfall):
   Require a manager PIN via FastPINOverlay (reuses pattern from ADR #6).
   This sets a temporary `allow_negative_stock = 1` for this transaction only.
```

**Why not auto-fallback?** The cashier needs to inform the customer and
potentially adjust pricing or delivery terms if pulling from a warehouse.
Silent auto-fallback would cause accounting surprises.

#### 6c. Split Fulfillment Pricing Warning

When the cashier selects a warehouse location for fulfillment, the shortfall
dialog MUST display:

> ⚠ Warehouse fulfillment may incur delivery charges.

This is a UI-only warning in Phase 1. A future phase may add split-line
pricing (different unit prices per location), but that requires changes to
the cart/line item model and is deferred.

**Refund handling for split lines:** When a sale with split-location deductions
is refunded, stock is credited back to the location it was deducted from.
The `complete_sale_with_resolved_shortfalls` command records the per-location
breakdown in a `deduction_locations` JSON column on the `sales` table (added
in migration 081). The refund flow reads this column to reverse deductions
exactly. This column is `NULL` for single-location sales.

> **Partial refund of split-location line (added by post-decision review — see §13 finding 33):**
> When a sale deducts e.g. 3 units split 2+1 across locations and the customer
> refunds exactly 1 unit, the policy is **FIFO oldest deduction**: the refund
> reverses the most recent deduction location. The `deduction_locations` JSON
> column is **nested by sale_line** (so each inner array is single-SKU and
> no per-entry `sku` is needed):
>
> ```json
> {
>   "lines": [
>     {"sale_line_id":"line-uuid-1","deductions":[
>       {"location_id":"store-inv","qty":2,"sold_at":"2026-07-18T10:00:00Z"},
>       {"location_id":"wh-a","qty":1,"sold_at":"2026-07-18T10:00:01Z"}
>     ]},
>     {"sale_line_id":"line-uuid-2","deductions":[
>       {"location_id":"store-inv","qty":3,"sold_at":"2026-07-18T10:01:00Z"}
>     ]}
>   ]
> }
> ```
>
> Refund of qty `n` for sale_line `L`: walk `lines[L].deductions` in reverse,
> credit `min(entry.qty, remaining_n)` to `entry.location_id`, decrement
> `remaining_n`, stop when 0. Refunds larger than the original sale qty are
> rejected at the back-end (`CoreError::Validation`).
>
> *Schema revised by post-decision review addressing finding 33: prior v1
> kept a flat array with a per-entry `sku` field. Once nested by sale_line,
> each inner array is single-SKU by construction, so `sku` is redundant.*

#### 6d. Transaction Boundary & Nested Transaction Rules

- `complete_sale` and `complete_sale_with_resolved_shortfalls` each open their
  own `BEGIN IMMEDIATE`. No transaction spans across the two commands.
- Cross-reference: oversell-rejection on a split-location line returns
  `CoreError::Validation` from `adjust_stock_batch`; see §6c JSON schema and
  the §13 acceptance criterion for finding 33.
- Stock deduction uses `adjust_stock_in_tx(tx, ...)` which operates on the
  caller's `Transaction` reference. It does NOT call `unchecked_transaction()`.
- `adjust_stock_at_location_with_reason` (with its own `unchecked_transaction()`)
  is used by standalone callers (transfers, manual adjustments, PO receiving).
  It MUST NOT be called inside an existing `BEGIN IMMEDIATE` — use `_in_tx` instead.

This replaces the old `InventoryStockHandler` event-bus pattern (which is
removed from `platform/startup` per Phase 2). Sale deduction is synchronous
within the `complete_sale` command, not an eventually-consistent event handler.

**BOM/Recipe handling:** When a composite product (one with a `product_recipes`
entry) is sold, its BOM ingredients are checked and deducted at the **same
location** as the composite product.

> **BOM split-fraction rounding rule (added by post-decision review — see §13 finding 32):**
> Split fulfillment across locations requires **integer quantities per location** —
> the cashier specifies whole numbers of each ingredient to deduct from each
> location. Fractional splits (e.g. 1 burger split 0.6/0.4 across warehouses)
> are rejected by `complete_sale_with_resolved_shortfalls` and re-prompted with
> the constraint surfaced. The UI enforces `qty_per_location ∈ ℤ≥0` and
> `Σqty_per_location == requested_qty` per ingredient. Rationale: prevents
> rounding-direction disputes (cashier vs. customer) and aligns with the integer
> stock ledger (ADR #6 — `qty INTEGER`).

If the composite is split across locations, ingredients are **proportionally
scaled** to integer multiples using **banker's rounding to the cashier's favor**
(fractional ≥0.5 rounds up, <0.5 rounds down — the customer never gets
under-credited). The `adjust_stock_batch` call includes ingredient deductions
alongside the composite deduction.

Example: Selling 2 "Burger" from Store Inventory (1 bun, 1 patty, 2 cheese per burger):
```rust
adjust_stock_batch(&tx, &[
    StockDeduction { sku: "BURGER",   location_id: store_inv, delta: -2 },  // composite
    StockDeduction { sku: "BUN",      location_id: store_inv, delta: -2 },  // BOM
    StockDeduction { sku: "PATTY",    location_id: store_inv, delta: -2 },  // BOM
    StockDeduction { sku: "CHEESE",   location_id: store_inv, delta: -4 },  // BOM
])?;
```

### 7. Cross-Location Transfer Flow

When transfer is sent, stock moves from the source location into a system-managed **`'transit'` inventory location**. This ensures in-transit goods are always counted in total stock (for accounting accuracy) but excluded from per-location shelf queries (for shelf accuracy).

```
1. User creates a stock transfer via stock_transfers screen
   INSERT INTO stock_transfers (...) -> status = 'draft'

2. User sends the transfer:
   a. Deduct qty from source location:
      adjust_stock_at_location_with_reason(sku, -qty, source_location_id, "transfer-out", ...)
   b. Credit qty to the system 'transit' location:
      adjust_stock_at_location_with_reason(sku, +qty, "<transit-location-id>", "transfer-in-transit", ...)
   c. status = 'in_transit'
   d. stock_movements entries for source deduction + transit credit are
      cross-referenced by transfer_id

3. Destination user receives:
   a. Deduct qty from the 'transit' location:
      adjust_stock_at_location_with_reason(sku, -qty, "<transit-location-id>", "transfer-out", ...)
   b. Credit qty to destination location:
      adjust_stock_at_location_with_reason(sku, +qty, destination_location_id, "transfer-received", ...)
   c. status = 'received'

4. If transfer is cancelled while in_transit:
   a. Reverse: deduct from transit, credit back to source.
   b. status = 'cancelled'

5. Audit trail: Four stock_movements rows (source→transit→dest) all
   cross-referenced by transfer_id for full traceability.

6. **Partial receipt:** If the destination receives fewer items than sent
   (damaged goods, miscounts), the receiver confirms the actual received
   qty. The difference stays in the `transit` location and the transfer
   is flagged as `received_partial`. An admin must manually resolve the
   discrepancy — either create a new transfer for the remainder, or
   adjust the transit stock with a "transfer-loss" reason. Full automation
   of discrepancy resolution is deferred to a future phase.

> **`received_partial` CHECK constraint extension (added by post-decision review — see §13 finding 34):**
> The existing `047_stock_transfers.sql` CHECK constraint was
> `CHECK (status IN ('draft','pending','in_transit','received','cancelled'))`.
> Migration `077a_stock_transfers_received_partial.sql` extends it as part
> of the implementation sequence:
>
> ```sql
> -- Drop and recreate to amend the CHECK constraint (SQLite rebuild pattern).
> PRAGMA foreign_keys = OFF;
>
> ALTER TABLE stock_transfers RENAME TO stock_transfers_old;
>
> CREATE TABLE stock_transfers (
>     id                     TEXT PRIMARY KEY,
>     transfer_number        TEXT NOT NULL UNIQUE,
>     status                 TEXT NOT NULL DEFAULT 'draft'
>                            CHECK (status IN ('draft','pending','in_transit',
>                                              'received','received_partial','cancelled')),
>     source_location        TEXT,
>     destination_location   TEXT,
>     source_location_id        TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
>                                REFERENCES inventory_locations(id) ON DELETE RESTRICT,
>     destination_location_id   TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
>                                REFERENCES inventory_locations(id) ON DELETE RESTRICT,
>     source_terminal_id      TEXT REFERENCES terminals(id),
>     destination_terminal_id TEXT REFERENCES terminals(id),
>     notes         TEXT NOT NULL DEFAULT '',
>     created_by    TEXT NOT NULL REFERENCES users(id),
>     received_by   TEXT REFERENCES users(id),
>     created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
>     sent_at       TEXT,
>     received_at   TEXT,
>     updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
> );
>
> INSERT INTO stock_transfers
>     SELECT id, transfer_number, status,
>            source_location, destination_location,
>            COALESCE(source_location_id, '01926b3a-0000-7000-8000-000000000001'),
>            COALESCE(destination_location_id, '01926b3a-0000-7000-8000-000000000001'),
>            source_terminal_id, destination_terminal_id,
>            notes, created_by, received_by,
>            created_at, sent_at, received_at, updated_at
>     FROM stock_transfers_old;
>
> DROP TABLE stock_transfers_old;
>
> PRAGMA foreign_keys = ON;
> ```
>
> The legacy free-text `source_location` and `destination_location` columns
> become `_old` (per §2d) for backward-compatibility audit. New rows MUST supply
> the FK columns.
```

The `'transit'` location (canonical UUID `01926b3a-0000-7000-8000-000000000002`,
seeded in §2a) is created automatically during migration 078 (Phase 0A). It is
`is_active = 1` but hidden from location pickers in the UI — only the transfer
engine references its UUID literal. The legacy prose reference `'transit'` is
the human-readable name; the canonical identifier is always the UUID above.

#### 7a. Transit Stock Audit & Recovery

Stock in the `transit` location is invisible to all standard inventory screens.
If a transfer crashes, a network fails, or a receiving warehouse forgets to
confirm receipt, stock can become stranded in `transit` indefinitely with zero
visibility.

To prevent this:

- **Transit Audit screen** (`ui/src/features/inventory/TransitAuditScreen.tsx`):
  Shows all stock currently in the `transit` location, grouped by transfer ID.
  Displays: SKU, quantity, source location, destination location, time in transit.
  Provides a "Reverse Transfer" action for abandoned transfers (deduct from
  transit, credit back to source — reuses the cancel logic from step 4 above).

- **Auto-expiry:** Transfers in `in_transit` status for longer than
  `TRANSIT_EXPIRY_HOURS` (configurable, default 72 hours) are flagged in the
  Transit Audit screen with a ⚠ overdue badge. An admin can configure
  auto-reversal for expired transfers.

This is functionally similar to the current `stock_transfers` workflow but
uses `inventory_locations` FKs instead of free-text fields.

### 8. Purchase Order Receiving Flow

```
1. Purchase Order created (existing PO screen)
2. PO has a location_id FK to inventory_locations
3. When goods are received:
   adjust_stock_at_location_with_reason(sku, +qty, location_id, "purchase-order", ...)
```

The `purchase_orders` table needs a new `location_id` column:

```sql
ALTER TABLE purchase_orders ADD COLUMN location_id TEXT
    REFERENCES inventory_locations(id);
```### 9. Inventory Transaction Log — Staff Audit Trail

Every inventory operation (receive, transfer-out, transfer-in, adjust, count)
is recorded as an **inventory transaction** — a session that groups related
stock movements. This answers: "which staff input incoming items to Warehouse A
on July 18?" and "show me everything Budi received in that shipment."

#### 9a. `inventory_transactions` table

```sql
CREATE TABLE inventory_transactions (
    id                TEXT PRIMARY KEY,                              -- UUID v7
    type              TEXT NOT NULL CHECK (type IN (
                          'receive',        -- goods received (from supplier or PO)
                          'transfer-out',   -- goods sent to another location
                          'transfer-in',    -- goods received from another location
                          'adjust',         -- manual stock correction
                          'count'           -- stock take / physical count
                      )),
    location_id       TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    staff_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    transfer_id       TEXT REFERENCES stock_transfers(id),            -- nullable; set for transfer types
    purchase_order_id TEXT REFERENCES purchase_orders(id),            -- nullable; set for PO receiving
    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_inv_tx_location ON inventory_transactions(location_id, created_at);
CREATE INDEX idx_inv_tx_staff    ON inventory_transactions(staff_id, created_at);
```

#### 9b. `inventory_transaction_lines` table

```sql
CREATE TABLE inventory_transaction_lines (
    id               TEXT PRIMARY KEY,                               -- UUID v7
    transaction_id   TEXT NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
    sku              TEXT NOT NULL,
    product_name     TEXT NOT NULL DEFAULT '',
    qty              INTEGER NOT NULL CHECK (qty > 0),
    barcode_scanned  TEXT,                                           -- the barcode that was scanned (nullable)
    sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_inv_tx_lines_tx ON inventory_transaction_lines(transaction_id);
```

#### 9c. Link to `stock_movements`

Add a nullable `inventory_transaction_id` to `stock_movements` so every delta
row can be traced back to the session that created it:

```sql
ALTER TABLE stock_movements ADD COLUMN inventory_transaction_id TEXT
    REFERENCES inventory_transactions(id) ON DELETE RESTRICT;

-- On-delete chain note (added by post-decision review — see §13 consequences):
-- ON DELETE RESTRICT on `inventory_transaction_id` chains through to
-- `inventory_transactions.staff_id REFERENCES users(id) ON DELETE RESTRICT`,
-- making `users.id` hard-deletion effectively impossible for any user that
-- has ever opened an inventory shift or transaction.
-- Operational impact: de-provisioning a former staff member must soft-delete
-- (mark `users.is_active = 0`) rather than `DELETE FROM users`. The shift
-- open command must also enforce `is_active = 1` when looking up staff.
```

When Budi receives 50 CHO-001 + 30 NUT-002 into Warehouse A, the flow is:

```
1. Create inventory_transaction (id=t1, type=receive, location=wh-a, staff=budi)
2. Create inventory_transaction_lines:
     (t1, CHO-001, 50, barcode=8991234567890)
     (t1, NUT-002, 30, barcode=8999876543210)
3. For each line, call adjust_stock_at_location_with_reason_and_tx_id(..., inventory_transaction_id: &t1)
   → stock_movements rows get inventory_transaction_id = 't1'
```

Query examples:

```sql
-- Who received what at Warehouse A today?
SELECT it.staff_id, itl.sku, itl.product_name, itl.qty, itl.barcode_scanned, it.created_at
FROM inventory_transactions it
JOIN inventory_transaction_lines itl ON itl.transaction_id = it.id
WHERE it.location_id = 'wh-a' AND it.type = 'receive' AND date(it.created_at) = date('now')
ORDER BY it.created_at DESC;

-- Show everything Budi did today, grouped by session.
SELECT it.id, it.type, it.location_id, it.notes, it.created_at,
       GROUP_CONCAT(itl.sku || ' x' || itl.qty, ', ') AS items
FROM inventory_transactions it
JOIN inventory_transaction_lines itl ON itl.transaction_id = it.id
WHERE it.staff_id = 'user-budi' AND date(it.created_at) = date('now')
GROUP BY it.id
ORDER BY it.created_at DESC;

-- Full audit: staff + barcode + location for a specific product.
SELECT sm.created_at, sm.delta, sm.reason, sm.location_id,
       sm.source_user_id, sm.inventory_transaction_id,
       itl.barcode_scanned
FROM stock_movements sm
LEFT JOIN inventory_transaction_lines itl ON itl.transaction_id = sm.inventory_transaction_id
    AND itl.sku = (SELECT sku FROM products WHERE id = sm.item_id)
WHERE sm.item_id = 'prod-cho-001'
ORDER BY sm.created_at DESC;
```

#### 9d. Inventory Shifts — Accountability Window

The existing `shifts` table (migration 021) is designed for cashier shifts:
cash reconciliation, sales totals, payment-method breakdowns. Inventory staff
don't handle cash — they need a simpler shift that just answers: "who was on
duty at which location, and when?"

```sql
CREATE TABLE inventory_shifts (
    id          TEXT PRIMARY KEY,                              -- UUID v7
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    terminal_id TEXT REFERENCES terminals(id),
    started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at    TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_inv_shifts_user     ON inventory_shifts(user_id, started_at);
CREATE INDEX idx_inv_shifts_location ON inventory_shifts(location_id, started_at);
CREATE INDEX idx_inv_shifts_status   ON inventory_shifts(status);

-- A single inventory user may have at most ONE ACTIVE SHIFT PER LOCATION.
-- Cross-location active shifts ARE allowed (worker hops Warehouse A ↔ B
-- without ending either shift, per Section 9d "one shift = one location").
-- Without this partial index, two concurrent INSERTs could both succeed
-- and the `get_active_inventory_shift(user_id, location_id)` lookup
-- would race. The composite (user_id, location_id) preserves §9d's
-- location-switching narrative — replacing my v1 (user_id)-only index
-- which was a show-stopper contradiction.
CREATE UNIQUE INDEX idx_inv_shifts_active_per_user_location
  ON inventory_shifts(user_id, location_id) WHERE status = 'active';
```

Add `inventory_shift_id` to `inventory_transactions` so every transaction
is linked to the shift it occurred during:

```sql
ALTER TABLE inventory_transactions ADD COLUMN inventory_shift_id TEXT
    REFERENCES inventory_shifts(id);
```

The workflow:

```
1. Staff opens inventory workspace → system checks for active inventory_shift
   → if none: prompt "Start shift at Warehouse A?" → creates inventory_shift
   → if active: resume existing shift

2. All inventory_transactions during the shift get inventory_shift_id set:
   - receive goods → inventory_transaction.shift_id = current shift
   - transfer out → inventory_transaction.shift_id = current shift
   - stock adjustment → inventory_transaction.shift_id = current shift
   - stock count → inventory_transaction.shift_id = current shift

3. Staff ends shift: inventory_shift.status = 'ended', ended_at = now
   → system shows summary: "During this shift at Warehouse A:
       5 receive sessions (total 1,200 units)
       2 transfer-out sessions (total 350 units)
       1 stock count"

**One shift = one location.** An inventory shift is bound to a specific
location via `location_id NOT NULL`. If a worker needs to work at a
different location (e.g., switching from Warehouse A to Warehouse B via
the location picker), they end their current shift and start a new one.
This keeps the audit trail clean — every transaction during a shift
happened at a known location.

**`get_active_inventory_shift` lookup:** Requires both `user_id` and
`location_id`:

```rust
pub fn get_active_inventory_shift(
    &self,
    user_id: &str,
    location_id: &str,
) -> Result<Option<InventoryShift>, CoreError>;
```

This finds "Budi's active shift at Warehouse A" — distinct from any
active shift he might have at another location (which shouldn't happen
in normal workflow but the schema allows it).

**Transaction without active shift:** The `inventory_shift_id` FK is
nullable — if no active shift exists when a transaction is created,
the field remains `NULL`. The transaction is still recorded in
`stock_movements` and `inventory_transactions`, but it won't be
attributable to a shift. The inventory workspace should prevent this
by prompting the user to start a shift before allowing any transaction.
If the user dismisses the prompt, the workspace should show a persistent
⚠ "No active shift" banner.
```

**Why separate from the cashier `shifts` table?** Cashier shifts carry
cash-specific columns (`opening_balance_minor`, `closing_balance_minor`,
`cash_difference_minor`, `total_cash_minor`, etc.) that are meaningless to
a warehouse worker. A separate table keeps the domain clean and avoids
NULL-filled rows. An inventory worker can also do inventory work without
being logged into a POS terminal.

**Why `inventory_shift_id` on `inventory_transactions` instead of moving
the `location_id`?** The location is a property of the transaction (which
shelf/warehouse was affected). The shift is the accountability window
(who was on duty). Both are needed independently — and since a shift is
bound to one location, the shift's `location_id` should match every
transaction's `location_id` during that shift. This redundancy serves
as a consistency check.

Query examples:

```sql
-- Who was on duty at Warehouse A when these items were received?
SELECT it.created_at, itl.sku, itl.qty, u.display_name AS staff,
       isft.started_at AS shift_start, isft.ended_at AS shift_end
FROM inventory_transactions it
JOIN inventory_transaction_lines itl ON itl.transaction_id = it.id
JOIN inventory_shifts isft ON isft.id = it.inventory_shift_id
JOIN users u ON u.id = isft.user_id
WHERE it.location_id = 'wh-a' AND it.type = 'receive'
ORDER BY it.created_at DESC;

-- Summary of Budi's last shift at Warehouse A.
SELECT isft.started_at, isft.ended_at,
       COUNT(DISTINCT it.id) AS transaction_count,
       SUM(itl.qty) AS total_units_handled
FROM inventory_shifts isft
JOIN inventory_transactions it ON it.inventory_shift_id = isft.id
JOIN inventory_transaction_lines itl ON itl.transaction_id = it.id
WHERE isft.user_id = 'user-budi' AND isft.location_id = 'wh-a'
GROUP BY isft.id
ORDER BY isft.started_at DESC LIMIT 1;
```

#### 9e. Configurable Stock Threshold Alerts

Warehouse staff can set per-product, per-location thresholds like
"alert me when CHO-001 at Warehouse A drops below 10 units."
The existing `low_stock_alerts(threshold)` query in `reports.rs` uses
a single global threshold — this section upgrades it to a configurable,
location-aware system.

#### 9e-i. `stock_thresholds` table — configuration

```sql
CREATE TABLE stock_thresholds (
    id          TEXT PRIMARY KEY,                              -- UUID v7
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES inventory_locations(id) ON DELETE CASCADE,
                -- NULL = applies to all locations
    threshold   INTEGER NOT NULL CHECK (threshold >= 0),
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(product_id, location_id)
);

CREATE INDEX idx_stock_thresholds_product  ON stock_thresholds(product_id);
CREATE INDEX idx_stock_thresholds_location ON stock_thresholds(location_id);
-- Partial unique index: only one global (NULL location_id) threshold per product.
-- SQLite's UNIQUE constraint treats NULLs as distinct, so we need this.
CREATE UNIQUE INDEX idx_stock_thresholds_global ON stock_thresholds(product_id) WHERE location_id IS NULL;
```

**Scoping rules:**
- `(product_id, location_id) = ('cha-123', 'wh-a')` → "CHA-123 at Warehouse A below 10"
- `(product_id, location_id) = ('cha-123', NULL)` → "CHA-123 at any location below 10"
- `(product_id, location_id) = (NULL, 'wh-a')` → NOT allowed (thresholds are always product-scoped)
- If no threshold row exists for a product, the system-wide default (configurable, default 0) applies

#### 9e-ii. `stock_alert_events` table — triggered alerts with acknowledgment

```sql
CREATE TABLE stock_alert_events (
    id              TEXT PRIMARY KEY,                          -- UUID v7
    threshold_id    TEXT NOT NULL REFERENCES stock_thresholds(id) ON DELETE CASCADE,
    product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id     TEXT REFERENCES inventory_locations(id) ON DELETE CASCADE,
    current_qty     INTEGER NOT NULL,                         -- qty at time of trigger
    threshold       INTEGER NOT NULL,                         -- threshold value that was breached
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'acknowledged', 'resolved')),
    triggered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    acknowledged_at TEXT,
    acknowledged_by TEXT REFERENCES users(id),
    resolved_at     TEXT
);

CREATE INDEX idx_stock_alert_events_status ON stock_alert_events(status, triggered_at);
CREATE INDEX idx_stock_alert_events_product ON stock_alert_events(product_id, location_id);
```

**Lifecycle:**

```
1. Stock drops: CHO-001 at Warehouse A goes from 15 → 8
2. Check thresholds: stock_thresholds says "CHO-001 + wh-a: alert at 10"
   → 8 < 10 → threshold breached
3. Check for existing active alert: SELECT FROM stock_alert_events
   WHERE threshold_id = ? AND status = 'active'
   → if none: INSERT new alert event (status = 'active')
   → if exists: skip (don't spam duplicate alerts)
4. Staff sees alert badge on warehouse dashboard, opens alert panel,
   acknowledges: UPDATE stock_alert_events SET status = 'acknowledged',
   acknowledged_by = ?, acknowledged_at = now
5. Stock recovers: CHO-001 at Warehouse A goes from 8 → 20 (restock)
   → Check: 20 >= 10 → threshold no longer breached
   → UPDATE stock_alert_events SET status = 'resolved', resolved_at = now
```

**Alert check is synchronous** — runs inside the same transaction as
`adjust_stock_at_location_with_reason`. If stock drops below threshold,
the alert event is created in the same COMMIT. No polling, no eventual
consistency, no missed alerts.

#### 9e-iii. Updated `low_stock_alerts` query (location-aware)

The existing `low_stock_alerts(threshold)` is replaced with:

```rust
/// Products at or below their configured threshold at a given location.
/// Falls back to `default_threshold` for products with no configured threshold.
pub fn low_stock_alerts_at_location(
    &self,
    location_id: &str,
    default_threshold: i64,
) -> Result<Vec<LowStockAlert>, CoreError>;

/// All active (unacknowledged) alert events for a location.
pub fn active_stock_alerts(
    &self,
    location_id: &str,
) -> Result<Vec<StockAlertEvent>, CoreError>;
```

Dashboard query example:

```sql
-- Active alerts at Warehouse A with product details.
SELECT sae.id, p.sku, p.name, il.name AS location_name,
       sae.current_qty, sae.threshold, sae.triggered_at,
       u.display_name AS acknowledged_by
FROM stock_alert_events sae
JOIN products p ON p.id = sae.product_id
JOIN inventory_locations il ON il.id = sae.location_id
LEFT JOIN users u ON u.id = sae.acknowledged_by
WHERE sae.location_id = 'wh-a' AND sae.status = 'active'
ORDER BY sae.triggered_at DESC;
```

### 10. Unified Workspace-to-Location Query Pattern

To avoid the `bound_location_id` vs `workspace_inventory_locations` split, all code must use a single helper function to resolve "which locations does this workspace use?":

```rust
/// Resolve all locations associated with a workspace instance.
///
/// For `warehouse` type workspaces: returns [{ location_id: bound_location_id, is_primary: true }]
///   (or all locations if bound_location_id is NULL).
///
/// For `store-pos` type workspaces: returns rows from workspace_inventory_locations.
///
/// For other types (kds, admin, restaurant-pos): returns empty vec.
///
/// # Errors
///
/// Returns `CoreError::Validation` if the workspace has BOTH `bound_location_id`
/// set AND rows in `workspace_inventory_locations` — this is a split-brain
/// configuration that must be resolved by an admin.
pub fn get_workspace_locations(
    store: &Store,
    instance_id: &str,
    type_key: &str,
) -> Result<Vec<WorkspaceLocationBinding>, CoreError>;
```

This function is the ONLY way to resolve workspace-to-location mappings.
Direct queries against `workspace_instances.bound_location_id` or
`workspace_inventory_locations` are forbidden outside this function (enforced
by code review AND a Clippy lint in `oz-core`). It returns an error if both
binding mechanisms are active, preventing the split-brain problem.
The function also handles the unbound-warehouse-workspace case: when
`bound_location_id IS NULL` on a `warehouse` type, it returns ALL active
locations (equivalent to aggregate admin view).

```rust
pub struct WorkspaceLocationBinding {
    pub location_id: String,
    pub location_name: String,
    pub is_primary: bool,
    pub allow_negative_stock: bool,  // false for bound_location_id-based bindings
}
```

### 11. Multi-Location Stock Display in POS

The `get_stock_all_locations` function returns:

```rust
pub fn get_stock_all_locations(
    &self,
    sku: &str,
    location_ids: &[&str],
) -> Result<Vec<StockAtLocation>, CoreError>;

pub struct StockAtLocation {
    pub location_id: String,
    pub location_name: String,
    pub qty: i64,
}
```

The Retail POS front-end displays this as:

```
Item:      Choco Bar (SKU: CHO-001)
Location                 Qty
─────────────────────────────
Store Inventory           12  ✓ in stock
Warehouse A              500  (call for delivery)
─────────────────────────────
Total                    512
```

The cashier can see where items are located and inform the customer accordingly.

---

### 12. Design Review Mitigations

This section documents critical issues identified during the ADR review
(2026-07-18) and how each is resolved in the final design.

| # | Issue | Severity | Resolution |
|---|-------|----------|------------|
| 1 | Impossible rollback+resume of `BEGIN IMMEDIATE` across human interaction | 🔴 Critical | Two-command pattern: `complete_sale` returns `PartialStockResult` then rolls back; `complete_sale_with_resolved_shortfalls` opens a fresh transaction (Section 6a). |
| 2 | `BEGIN IMMEDIATE` held open during cashier dialog → database-wide write lock | 🔴 Critical | Same fix — no transaction spans human interaction. |
| 3 | `adjust_stock_with_reason` opens `unchecked_transaction()` inside `complete_sale`'s `BEGIN IMMEDIATE` → degraded savepoints | 🔴 Critical | Introduced `adjust_stock_in_tx(tx, ...)` that operates on the caller's `Transaction` reference. `_in_tx` suffix makes the contract explicit (Section 3). |
| 4 | `ON DELETE CASCADE` on `location_id` FKs → silent stock data loss when deleting a location | 🔴 Critical | Changed to `ON DELETE RESTRICT` on `inventory`, `stock_summary`, `workspace_inventory_locations`. UI enforces soft-delete (`is_active = 0`) (Section 2). |
| 5 | Table rebuilds missing `PRAGMA foreign_keys = OFF` → migration failures | 🔴 Critical | Added `PRAGMA` guards to Sections 2a and 2c. |
| 6 | API breakage: adding `location_id` parameter to existing functions breaks all callers | 🟠 High | Introduced `adjust_stock_at_location` / `get_stock_at_location` as new functions. Legacy signatures preserved with default-location resolution (Section 3). |
| 7 | Transit location invisible to users → stranded stock black hole | 🟠 High | Added Transit Audit screen with overdue detection and manual reversal (Section 7a). |
| 8 | `rebuild_stock_summary` broken by new composite PK `(item_id, location_id)` | 🟠 High | Updated Phase 2 item 7 to `GROUP BY item_id, location_id`. |
| 9 | `stock_movements_archive` missing `location_id` → audit queries lose location dimension for pruned data | 🟠 High | Added to Section 2b migration. |
| 10 | `allow_negative_stock` silently accumulates negative stock | 🟡 Medium | Added `stock.negative` event emission and dashboard badge (Section 4, Phase 2 item 12). |
| 11 | Split-brain: two binding tables plus code-review-only enforcement | 🟡 Medium | `get_workspace_locations` now returns an error on dual-binding. Added Clippy lint enforcement (Section 10). |
| 12 | Split fulfillment pricing gap — no warehouse delivery charge warning | 🟡 Medium | Added UI warning to shortfall dialog (Section 6c). Deferred split-line pricing to future phase. |
| 13 | `adjust_stock_batch` signature underspecified | 🟡 Medium | Now defined: accepts `&Transaction`, works on multiple SKUs + locations, documented in Section 6b and Phase 2 item 2. |
| 14 | BOM/recipe deduction unaddressed after `InventoryStockHandler` removal | 🟡 Medium | BOM handling now inside `complete_sale` — ingredients deducted from same location as composite product, with batch example in Section 6d. |
| 15 | No composite index for `IN (...)` query pattern (POS multi-location lookup) | 🟢 Low | Added `(location_id, product_id)` index on `inventory` to mitigations (Consequences section). |
| 16 | No "merge locations" function for business consolidation | 🟢 Low | Documented as known limitation. Rare operation — manual transfer workaround exists. |
| 17 | `complete_sale_to_kds` return type changed from `Option<KdsOrder>` to `Vec<KdsOrder>` (per-zone orders) | 🟠 High | Change already applied in working tree (pre-ADR). Integrated with kitchen zone grouping — one KDS order per kitchen zone. The KDS queue now accepts optional `kds_zone` filter. Not part of inventory-location ADR scope but documented here for traceability. |
| 18 | `stock_summary` migration uses `COALESCE(location_id, 'default')` on a table without that column | 🔴 Critical | Changed to hardcoded `'default'` literal. `stock_summary_old` has no `location_id` column — the COALESCE would crash (Section 2c). |
| 19 | `list_products` LEFT JOIN on inventory with composite PK produces duplicate rows per location | 🔴 Critical | Query updated to aggregate via `SUM(qty) GROUP BY product_id` subquery. Per-location queries use `get_stock_at_location` / `get_stock_all_locations` (Section 2b). |
| 20 | `complete_sale` does not skip service products — triggers false shortfalls | 🔴 Critical | Added `tracks_inventory() == false AND product.has_recipe() == false` check as step 4a in the `complete_sale` flow diagram. Pure service products are silently excluded from stock checks, but composite items (recipes) are checked. (Section 6a). |
| 21 | `stock_thresholds` UNIQUE constraint allows duplicate global thresholds due to SQLite NULL handling | 🟡 Medium | Added partial unique index `WHERE location_id IS NULL` to enforce one-global-threshold-per-product (Section 9e-i). |
| 22 | Section 8 uses wrong API name `adjust_stock_with_reason` instead of `adjust_stock_at_location_with_reason` | 🟢 Low | Fixed in Section 8 (Purchase Order Receiving Flow). |
| 23 | `get_workspace_locations` cross-references say Section 9 — it's actually in Section 10 | 🟢 Low | Fixed three cross-references to point to Section 10. |
| 24 | `stock_transfers` FK columns (`source_location_id`, `destination_location_id`) lack `NOT NULL` | 🟢 Low | Added `NOT NULL DEFAULT 'default'`. Legacy free-text columns become `_old`; new rows always have a location FK (Section 2d). |
| 25 | `stock_movements` and `stock_movements_archive` `location_id` FK missing `ON DELETE RESTRICT` | 🟢 Low | Added `ON DELETE RESTRICT` to both ALTER TABLE statements — consistent with `inventory` / `stock_summary` (Section 2b). |
| 26 | Section 9c references `inventory_transaction_id` parameter that doesn't exist in the API | 🟡 Medium | Added `adjust_stock_at_location_with_reason_and_tx_id` to Section 3 API. Section 9c flow updated to use the new function. |
| 27 | InventoryStockHandler removal says "per Phase 1" but Phase 1 is schema-only | 🟡 Medium | Changed to "per Phase 2" — handler removal is a code change, not a migration (Section 6d). |
| 28 | Partial transfer receipt (receive 80 of 100 sent) not addressed | 🟡 Medium | Added step 6 to Section 7: remainder stays in `transit`, transfer flagged `received_partial`, manual admin resolution required. |
| 29 | `inventory_shifts.user_id` and `inventory_transactions.staff_id` FKs missing `ON DELETE` | 🟢 Low | Added `ON DELETE RESTRICT` — prevents deleting users with shift or transaction history (Sections 9a, 9d). |
| 30 | Default/transit location deactivation risk undocumented | 🟢 Low | Added note that `default` and `transit` locations must never be deactivated (Section 5 deletion policy). |

---

## 13. Post-Decision Review (2026-07-18, on acceptance)

This section documents seven findings surfaced by a fresh review of this ADR
against the current codebase (migration history through `077_kitchen_zone.sql`,
`crates/oz-core/src/{product,inventory,payment,sale}.rs`,
`crates/oz-core/src/db/{products,stock_transfers,reports}.rs`,
`modules/inventory/src/handlers.rs`, and `platform/startup/src/lib.rs`).
Each finding has had an inline patch inserted into the relevant section above;
this is the consolidated audit table for traceability.

| # | Issue | Severity | Resolution |
|---|-------|----------|------------|
| 31 | Section 6's two-command flow opens `BEGIN IMMEDIATE` *after* `create_payments` — but `crates/oz-core/src/payment.rs` `Payment` carries `gateway_reference`, `gateway_status`, `gateway_response` populated by caller before `complete_sale`. Card capture has succeeded in the outside world before the server checks stock. A rollback leaves the customer's money captured with no sale row. | 🔴 Critical | New "Stock Reservation (Pending Sale)" pattern callout in §6a above. Stock must be reserved and a pending sale row created *before* payment capture to avoid stranded funds during concurrent checkout races. Belongs in a separate ADR-19 (Payment-Capture Ordering) once promotional discussion is complete. |
| 32 | Section 6d's BOM example splits burgers with integer deltas only. No rule for fractional splits (e.g. 1 burger split 0.6/0.4). Specified rounding drops 0.4 to 0, silently under-deducting. | 🟡 Medium | "BOM split-fraction rounding rule" callout in §6b: cashier specifies integer quantities per location; fractional splits rejected by the back-end with the constraint surfaced in the UI. Banker's rounding to cashier's favor when proportional ingredients must scale to integers. |
| 33 | Section 6c `deduction_locations JSON` refund flow does not address partial refund of a split-location line (e.g. 3 units split 2+1 across locations, customer refunds exactly 1). | 🟡 Medium | "Partial refund of split-location line" callout added to §6c: **FIFO oldest deduction** policy — refund iterates `deduction_locations` array in reverse, crediting one unit at a time per location until refund-qty satisfied. JSON schema documented. |
| 34 | Section 7 step 6 introduces `received_partial` status that conflicts with `stock_transfers` CHECK constraint `('draft','pending','in_transit','received','cancelled')` in `migrations/047_stock_transfers.sql:10`. Real DB crash on first partial-receive insert. | 🔴 Critical | Migration amendment shown in §7 above: rename-and-recreate the table with extended CHECK. FK columns get full `DEFAULT '01926b3a-0000-7000-8000-000000000001'` (canonical default-location UUID seeded by migration 078). |
| 35 | The post-migration advisory (Section 12 item 15) adds `(location_id, product_id)` index on `inventory` but no equivalent on `stock_movements`. Per-location audit queries (Section 9) and reconciliation will full-scan the ledger. | 🟢 Low | Added `idx_stock_movements_location_created` (complementary to migration 063's per-item index — non-overlapping) and `idx_stock_movements_archive_location_created` amendments to §2b. No composite `(item_id, location_id, created_at)` because cross-direction queries are rare in audit dashboards. |
| 36 | Sections 2a and 7 used literal strings `'default'` and `'<transit-location-id>'` as seed location IDs. Collides with any third-party data import (CSV, custom seed script, mirror) writing a row with `id = 'default'` — silently breaks FK constraints. | 🟢 Low | §2a amended to seed stable UUIDs (`01926b3a-…-001` for default, `-002` for transit). Application-layer resolver at startup: app resolves by `name` once and caches the UUIDs in memory. |
| 37 | Section 2d framed the `inventory→warehouse` rename as a single SQL update. The codebase hard-codes `'inventory'` in 6+ sites: `035_workspaces.sql:32,46-51` (seed + workspace_screens), `060_workspace_instances.sql:110` (sort-order CASE), plus the front-end router, role permissions, and settings keys. | 🟡 Medium | "Renames cascade" callout added to §5 enumerating all sites requiring migration coordination. Migration 079 must update every site atomically. |

### Acceptance criteria for §13 amendments

For these findings to be considered resolved before implementation begins:

- **31**: ADR-19 (Payment-Capture Ordering) drafted and accepted.
- **32**: Front-end validation code path documented and tested for integer inputs only.
- **33**: `deduction_locations` JSON schema added to a JSON Schema document validated against sample sales.
- **34**: Migration amendment compiles against current SQLite; CHECK constraint verified with a `received_partial` INSERT. **Plus Rust code change:** `crates/oz-core/src/db/stock_transfers.rs::receive_transfer` currently keeps status `'in_transit'` on partial receive instead of writing `'received_partial'`; the file's status-update branch must be updated alongside the migration amendment, otherwise the new CHECK-allowed value is never written.
- **35**: New index DDL added to migration 079.
- **36**: UUIDs chosen and frozen (`01926b3a-0000-7000-8000-000000000001` for default; `…-002` for transit) AND propagated uniformly through §2a, §7, §2d, and §5 placeholders — readers must NOT hand-substitute differing values per section.
- **37**: Rename migration coordination plan signed off by every consumer (`ui/`, `platform/`, `crates/oz-core`, `modules/<name>/manifest.json`, the `modules/inventory/` Rust crate).

### Cross-link with migration plan

The findings 32–34 directly modify the migration plan (§14 / `## Migration Plan`).
Findings 35 and 36 add new DDL within migrations 078/079. Finding 31 surfaces a
new ADR requirement before the migration plan can be promoted to AC.

## Options Considered

### Option A — One Inventory Workspace = One Location, Strictly Scoped (Rejected)

Bind each inventory workspace instance directly to one `inventory_locations` row. No cross-location visibility within the workspace.

- **Pro**: Simple mental model — "Warehouse A" workspace only sees Warehouse A data.
- **Con**: Admin at Warehouse A cannot view Store Inventory or initiate transfers without switching workspaces. This breaks the cross-location transfer workflow.
- **Con**: An inventory workspace with no location binding (for chain-wide view) would need a special `null` location, which creates ambiguity.
- **Decision**: Rejected in favour of Option C.

### Option B — Inventory Workspace Shows All Locations, No Binding (Rejected)

Inventory workspaces are management consoles with location as a filter, no binding at all.

- **Pro**: One workspace manages all locations — transfers, counts, reports across the whole store.
- **Pro**: No schema change to `workspace_instances`.
- **Con**: A user who only manages Warehouse A sees Store Inventory and Warehouse B stock on every page. The default view has no sensible scope — all locations or none. Significant cognitive noise for a warehouse operator.
- **Decision**: Rejected in favour of Option C.

### Option C — Inventory Workspace Bound to Its Own Location + Location Picker (Chosen)

Each inventory workspace has an optional `bound_location_id` FK on `workspace_instances`. The workspace defaults to its own location but provides a location picker in the header.

- **Pro**: Default view is scoped to the workspace's location — no noise for the warehouse operator.
- **Pro**: Location picker enables cross-location tasks (transfers, reporting) without switching workspaces.
- **Pro**: `NULL` binding works for admin/aggregate workspaces — explicit by omission.
- **Pro**: POS-to-location binding is stored separately in `workspace_inventory_locations` — a dedicated table, not an overloaded column.
- **Pro**: A single location can be the primary for multiple POS instances (e.g., multiple cash registers drawing from Store Inventory).  - **Con**: Two places to configure location binding (workspace_instances.bound_location_id + workspace_inventory_locations). Mitigated by the unified `get_workspace_locations` helper (Section 10).
- **Con**: Migration complexity — `bound_location_id` on `workspace_instances` needs an ALTER TABLE.

### Option D — Extend `workspace_instances.colour` to Include `location_id` (Rejected)

Overload the existing `workspace_instances` table with an optional `location_id` field on inventory instances.

- **Pro**: No new table.
- **Con**: Mixes concerns — `workspace_instances` is a deployment concept, not a domain entity.
- **Con**: No way to express "this POS uses inventory from these N locations."
- **Decision**: Rejected in favour of Option C.

### Option E — Tag-Based Location on Products (Rejected)

Instead of scoping stock by location, tag each product with a default location and filter by tag.

- **Pro**: Minimal schema change.
- **Con**: A product cannot be split across multiple locations (same SKU in both Store and Warehouse A).
- **Con**: No way to handle partial transfers or in-transit states.
- **Decision**: Rejected in favour of Option C.

### Option F — Per-Location SQLite Databases (Deferred)

Instead of a `location_id` column, give each location its own SQLite file.

- **Pro**: Filesystem-level isolation — impossible to accidentally query the wrong location's stock.
- **Con**: Cross-location queries (total stock, transfer coordination) require multi-DB queries or a sync layer.
- **Con**: Radical schema change — every stock-related function needs a database connection parameter.
- **Decision**: Deferred as a future optimisation for very large warehouses. The `location_id` column approach is simpler and sufficient for <50 locations.

---

## Consequences

### Positive

- **Multi-location stock tracking**: Each inventory location independently tracks stock levels via the delta ledger.
- **Workspace-to-location binding**: `workspace_instances.bound_location_id` scopes inventory workspaces to their own location by default.
- **POS-to-location binding**: `workspace_inventory_locations` links any workspace (POS or other) to its primary and secondary inventory locations, with per-location `allow_negative_stock`.
- **Cross-location transfers**: First-class workflow with FK integrity, audit trail, in-transit state, and stranded-stock recovery via the Transit Audit screen.
- **Purchase order location scoping**: Goods received directly into the correct warehouse.
- **Backward compatible**: Migration creates a default location; existing data is preserved. Old API signatures (`adjust_stock`, `get_stock`) continue to work via default-location resolution. Single-location deployments see no change.
- **Per-location reporting**: Reports can be filtered by location or aggregated across all locations.
- **Auditability**: Every stock movement records which location it affected and which staff member performed it. The `inventory_transactions` table groups related movements into sessions. `inventory_shifts` provides accountability windows — "Budi was on duty at Warehouse A from 08:00 to 16:00, during which 1,200 units were received and 350 transferred out." The `stock_movements` delta ledger provides an immutable history — `location_id`, `inventory_transaction_id`, and `inventory_shift_id` make it fully traceable.
- **Configurable low-stock alerts**: Per-product, per-location thresholds with acknowledgment lifecycle. "Alert when CHO-001 drops below 10 at Warehouse A." Alerts fire synchronously on stock change — no polling, no missed events. Staff acknowledge alerts; auto-resolved when stock recovers.
- **Transaction safety**: Synchronous deduction inside `complete_sale` eliminates the race condition of the old event-bus pattern. Two-command shortfall resolution prevents long-running database locks.

### Negative

- **Migration complexity**: Three tables (`inventory`, `stock_summary`, `stock_transfers`) need schema changes with data migration. SQLite's ALTER TABLE limitations require table rebuilds for PK changes.
- **Query surface growth**: Every stock query from this point forward needs `WHERE location_id = ?`. Indexes must cover `(product_id, location_id)` pairs.
- **POS performance**: Multi-location stock lookups require N queries (one per bound location) or a single query with `IN (...)` on `location_ids`. For typical deployments (1–3 locations), this is negligible.
- **UI complexity**: The inventory screens (adjustment, stock counts, dashboard) need location filters. The POS product lookup needs location-aware stock display.

### Mitigations

- **Migration script**: A dedicated migration (`081_multi_location_inventory.sql`) with `PRAGMA foreign_keys` guards, rollback support, and archive table migration. Includes `stock_movements_archive`.
- **`ON DELETE RESTRICT`**: Prevents accidental data loss when deleting locations. UI enforces soft-delete (`is_active = 0`) for locations with stock.
- **Unified location resolver**: `get_workspace_locations` function (Section 10) eliminates the split-brain between `bound_location_id` and `workspace_inventory_locations`. Returns an error if both binding mechanisms are active on one workspace.
- **Two-command shortfall resolution**: `complete_sale` + `complete_sale_with_resolved_shortfalls` prevents long-running database locks. No transaction spans human interaction.
- **`adjust_stock_in_tx`**: Transaction-aware variant prevents nested `BEGIN` inside an existing `BEGIN IMMEDIATE`. The `_in_tx` suffix makes the caller's responsibility explicit at the call site.
- **Transit Audit screen**: Prevents stranded stock from accumulating invisibly in the `transit` location. Auto-expiry flags transfers overdue beyond `TRANSIT_EXPIRY_HOURS`.
- **Indexes**: Composite indexes on `(location_id, item_id)` for `stock_movements` / `stock_movements_archive` and `(product_id, location_id)` for `inventory` / `stock_summary`. Additional `(location_id, product_id)` index on `inventory` for the `IN (...)` query pattern used by POS multi-location lookup.
- **Default location**: The `default` location ensures single-location deployments need no configuration. The default location auto-creates on migration.
- **Transit location**: Auto-created during migration, hidden from UI pickers, but auditable via the Transit Audit screen.
- **Negative stock alerts**: When `allow_negative_stock = 1` causes a deduction below zero, a `stock.negative` event is emitted. The inventory dashboard shows affected SKUs.
- **Location picker in header**: The inventory workspace's default view is scoped to its own location, but a dropdown in the header allows switching to any other location for cross-location tasks.
- **Unbound workspace fallback**: When `bound_location_id` is `NULL`, the workspace shows aggregate data across all locations — the old single-location behaviour.

---

## Migration Plan

### Phase 1 — Schema Migration (this ADR)

1. Create `inventory_locations` table, seed `default` and `transit` locations.
2. Migrate `inventory` table: add `location_id`, rebuild PK (with `PRAGMA foreign_keys` guards).
3. Migrate `stock_movements` table: add `location_id` column (`NOT NULL DEFAULT 'default'`, `ON DELETE RESTRICT`).
4. Migrate `stock_movements_archive` table: add `location_id` column (`NOT NULL DEFAULT 'default'`, `ON DELETE RESTRICT`).
5. Migrate `stock_summary` table: add `location_id`, rebuild PK (with `PRAGMA foreign_keys` guards).
6. Migrate `stock_transfers` table: rename old location columns, add FK columns with `ON DELETE RESTRICT`.
7. Create `workspace_inventory_locations` table (`allow_negative_stock` included, `ON DELETE RESTRICT`).
8. Add `bound_location_id` FK on `workspace_instances`.
9. Add `location_id` to `purchase_orders`.
10. Add `deduction_locations` JSON column to `sales` table (nullable; records per-location breakdown for split-fulfillment refunds).
11. Create `inventory_transactions` and `inventory_transaction_lines` tables for staff audit trail.
12. Add `inventory_transaction_id` FK to `stock_movements`.
13. Create `inventory_shifts` table for warehouse staff accountability windows.
14. Add `inventory_shift_id` FK to `inventory_transactions`.
15. Create `stock_thresholds` table for configurable per-product, per-location low-stock thresholds.
    - Includes partial unique index: `CREATE UNIQUE INDEX … ON stock_thresholds(product_id) WHERE location_id IS NULL` (prevents duplicate global thresholds — SQLite treats NULLs as distinct in UNIQUE constraints).
16. Create `stock_alert_events` table for triggered alert tracking with acknowledgment lifecycle.
17. Add composite indexes on all location-scoped tables.
    - `(location_id, product_id)` on `inventory` (for POS `IN (...)` lookup)
    - `(location_id, item_id)` on `stock_movements` and `stock_movements_archive`

### Phase 2 — Backend Updates

1. Add `adjust_stock_at_location`, `adjust_stock_at_location_with_reason`, `adjust_stock_in_tx`, `adjust_stock_batch`, `get_stock_at_location`, `get_stock_all_locations` to `Store`. Legacy `adjust_stock` / `adjust_stock_with_reason` / `get_stock` delegate to the location-aware variants with `location_id = "default"`.
2. Add `get_workspace_locations` — unified resolver covering both `bound_location_id` and `workspace_inventory_locations`. Returns `CoreError::Validation` if both bindings exist.
3. Add `create_inventory_location`, `list_inventory_locations`, `update_inventory_location`, `deactivate_inventory_location` Tauri commands. No hard-delete command — UI enforces soft-delete.
4. Add `set_workspace_inventory_locations`, `get_workspace_inventory_locations` Tauri commands.
5. Update `rebuild_stock_summary` to `GROUP BY item_id, location_id` and handle the new composite PK.
6. Update `complete_sale` to: open `BEGIN IMMEDIATE`, create sale + payments, resolve primary location, check stock + BOM ingredients via `adjust_stock_in_tx`, collect ALL shortfalls, ROLLBACK on any shortfall, return `CompleteSaleResult` or `PartialStockResult`.
7. Add `complete_sale_with_resolved_shortfalls` command: accepts the full sale data + resolution plan, opens fresh `BEGIN IMMEDIATE`, re-checks stock (including BOM ingredients), deducts via `adjust_stock_batch`, writes `deduction_locations` JSON on the sale row, ROLLBACK on re-shortfall with updated `PartialStockResult`.
8. Update BOM/recipe deduction: when a composite product is sold, ingredients are deducted from the same location as the composite. For split fulfillment, ingredients are split proportionally. All deductions (composite + ingredients) go through `adjust_stock_batch` in a single transaction.
9. Update `stock_transfers` commands to use `inventory_locations` FK and `transit` location. Add `reverse_expired_transfer` for auto-expiry.
10. Update `purchase_orders` receive command to accept `location_id`.
11. Add `create_inventory_transaction`, `list_inventory_transactions`, `get_inventory_transaction` Tauri commands for the staff audit trail.
12. Update `adjust_stock_at_location_with_reason` and `adjust_stock_in_tx` to accept optional `inventory_transaction_id` parameter.
13. Add `start_inventory_shift`, `end_inventory_shift`, `get_active_inventory_shift`, `list_inventory_shifts` Tauri commands. No cash fields — just user, location, time window.
14. Update `create_inventory_transaction` to auto-link to the user's active inventory shift (via `get_active_inventory_shift`).
15. Add `set_stock_threshold`, `get_stock_thresholds`, `delete_stock_threshold` Tauri commands.
16. Replace `low_stock_alerts(threshold)` with location-aware `low_stock_alerts_at_location(location_id, default_threshold)` and `active_stock_alerts(location_id)`.
17. Integrate alert check into `adjust_stock_at_location_with_reason`: after stock change, check thresholds synchronously and create `stock_alert_events` if breached (deduped — no duplicate active alerts).
18. Auto-resolve alerts: after stock change, check if any active alerts now have stock >= threshold and mark them `resolved`.
19. Emit `stock.negative` event when `allow_negative_stock` deduction goes below zero.

### Phase 3 — Frontend / Workspace Setup

1. **Inventory workspace**: Add location picker in header; scope default view to `bound_location_id`.
2. **Inventory screens**: Add location filter to stock adjustment, stock counts, transfers, dashboard.
3. **POS location binding**: Admin screen to configure which inventory locations a POS instance uses (primary + secondary, `allow_negative_stock` flag).
4. **Retail POS product lookup**: Show per-location stock when bound to multiple locations.
5. **Stock shortfall dialog**: Multi-item dialog listing ALL shortfalls. Per-item controls to pick alternative location, split across locations, or manager-override. Shows warehouse pricing warning. Calls `complete_sale_with_resolved_shortfalls` on confirmation.
6. **Transit Audit screen** (`ui/src/features/inventory/TransitAuditScreen.tsx`): Shows all stock in the `transit` location grouped by transfer. Provides "Reverse Transfer" action. Highlights overdue transfers (> `TRANSIT_EXPIRY_HOURS`).
7. **Negative stock badge**: Inventory dashboard shows alert when any location has stock < 0.
8. **Inventory transaction log screen** (`ui/src/features/inventory/TransactionLogScreen.tsx`): Staff-facing view grouped by session. Filter by location, staff, type (receive/transfer/adjust/count), date range. Each session expands to show scanned barcodes and quantities.
9. **Inventory shift bar** (`ui/src/features/inventory/ShiftBar.tsx`): Persistent bar at the top of the inventory workspace showing current shift status. "Budi — Warehouse A — Started 08:00 (3h 22m)" with an [End Shift] button. On shift end, shows a summary of transactions performed.
10. **Stock alert panel** (`ui/src/features/inventory/StockAlertPanel.tsx`): Sidebar or dashboard widget showing active alerts (badge count). Each alert shows SKU, product name, current qty vs threshold, time triggered. [Acknowledge] button records who saw it. Filterable by location.
11. **Threshold configuration screen** (`ui/src/features/inventory/ThresholdConfigScreen.tsx`): Per-product, per-location threshold editor. Table view: SKU | Product Name | Location | Threshold | [Edit] [Delete]. "+ Add Threshold" button with SKU picker, location dropdown, threshold input.
12. **Workspace setup wizard**: When creating inventory workspace instances, prompt to create linked inventory locations and set `bound_location_id`.
13. **Transfer screen**: Replace free-text location fields with dropdowns populated from `inventory_locations`; source pre-filled to workspace's bound location.

---

## Related

- `crates/oz-core/migrations/081_multi_location_inventory.sql` — Schema migration (new; targets `inventory`, `stock_movements`, `stock_movements_archive`, `stock_summary`, `stock_transfers`, `purchase_orders`, `workspace_instances`, `inventory_transactions`)
- `crates/oz-core/src/db/inventory_locations.rs` — Inventory location CRUD (new)
- `crates/oz-core/src/db/inventory_transactions.rs` — Inventory transaction log CRUD + staff audit queries (new)
- `crates/oz-core/src/db/inventory_shifts.rs` — Inventory shift open/close, active-shift lookup (new)
- `crates/oz-core/src/db/stock_alerts.rs` — Threshold CRUD, alert event lifecycle, synchronous threshold check (new)
- `crates/oz-core/src/db/products.rs` — `adjust_stock`, `adjust_stock_with_reason`, `adjust_stock_batch`, `get_stock`, `get_stock_all_locations` (updated)
- `crates/oz-core/src/db/workspace_locations.rs` — `get_workspace_locations` unified resolver (new)
- `crates/oz-core/src/db/stock_transfers.rs` — FK references to `inventory_locations`, transit location logic (updated)
- `crates/oz-core/src/db/purchase_orders.rs` — `location_id` FK (updated)
- `modules/inventory/src/handlers.rs` — Sale deduction handler (removed in Phase 1; POS deduction moved to `complete_sale`)
- `apps/desktop-client/src/commands/pos.rs` — `complete_sale` with transaction, shortfall collection, batch deduction (updated)
- `ui/src/features/inventory/` — Inventory screens with location filter, location picker in header (updated)
- `ui/src/features/retail/RetailPosScreen.tsx` — Multi-location stock display, stock shortfall dialog (updated)
- `ui/src/api/inventoryLocations.ts` — New API file (new)
- `crates/oz-core/src/db/inventory_locations.rs` — `deactivate_inventory_location` (soft-delete), transit audit queries (new)
- `ui/src/features/inventory/TransitAuditScreen.tsx` — Transit stock visibility and manual reversal (new)
- `ui/src/features/inventory/TransactionLogScreen.tsx` — Per-staff, per-location audit trail grouped by session (new)
- `ui/src/features/inventory/ShiftBar.tsx` — Inventory shift start/stop bar with transaction summary (new)
- `docs/decisions/2026-07-10-workspace-type-instance-design.md` — ADR #4: Workspace instances (foundation)
- `docs/decisions/2026-07-10-crdt-delta-ledger-offline-sync.md` — ADR #6: Stock movements delta ledger (foundation)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

