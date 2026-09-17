<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: AUDITED (draft, superseded by ADR #4) · pre-decision analysis doc; all referenced files verified present: crates/oz-core/src/db/workspaces.rs, apps/desktop-client/src/commands/workspaces.rs, ui/src/contexts/WorkspaceContext.tsx, ui/src/features/workspaces/WorkspaceHome.tsx, ui/src/frontend/shell/AppShell.tsx; StoreProfile (crates/oz-core/src/store_profile.rs:14) + MultiStoreDashboardScreen (ui/src/App.tsx:37) confirmed · note: its Phase 3 recommended query-level WHERE store_id=? scoping was NOT the mechanism adopted — ADR #4 (2026-07-10-workspace-type-instance-design.md) chose store-scoped SQLite DBs (filesystem isolation) instead; treat as historical draft, not as-built claim · CURRENCY 08-09-26: two paths this stamp says it verified are now dead, which is what a dated verification looks like when nobody re-runs it. `crates/oz-core/src/store_profile.rs` is `crates/oz-core/src/location_profile.rs` and `StoreProfile` is `LocationProfile` (line 15); `ui/src/features/stores/` is `ui/src/features/locations/`. The stamp is left as written because it records what was true on 2026-07-22, not what is true now -->

# Workspace Instance Architecture — Analysis & Recommendation

**Date:** 2026-07-10  
**Status:** Draft for discussion  
**Authors:** Architecture Team

---

## 1. The Problem

kasir.mu currently defines workspaces as a flat set of unique keys:

```
restaurant-pos  → renders PosScreen (fullscreen)
store-pos       → renders RetailPosScreen (fullscreen)
kds             → renders KdsScreen (fullscreen)
inventory       → renders AppLayout sidebar with inventory screens
admin           → renders AppLayout sidebar with admin screens
```

Each key conflates **what to render** with **which specific deployment it is**. This prevents:

- Multiple restaurant POS workspaces (e.g., Downtown vs Mall location)
- Multiple inventory workspaces (e.g., Warehouse A vs Warehouse B)
- Per-user workspace assignment at the instance level (a cashier can access "Downtown POS" but not "Mall POS")

---

## 2. Current Architecture (How Workspaces Work Today)

### Database Layer (3 tables, extensible)

The workspace system already has a solid backend foundation:

```sql
workspaces         → defines key, name, description, icon (5 rows seeded)
workspace_screens  → which nav items appear in each workspace
role_workspaces    → which roles can access which workspaces
user_workspaces    → per-user override (replaces role defaults)
```

**Backend resolution order:**
1. `role-owner` → all workspaces (admin bypass)
2. `user_workspaces` has rows for user → return ONLY those keys
3. Otherwise → fall back to `role_workspaces`

### Frontend Layer (4 hardcoded mappings)

**1. AppShell.tsx — Route mapping**
```typescript
const workspaceRoute: Record<string, string> = {
  'restaurant-pos': 'sales',
  'store-pos': 'products',
  kds: 'kds',
  inventory: 'inventory',
  admin: 'settings',
};
// Unknown keys fall through to ?? 'products'
```

**2. AppShell.tsx — Rendering branches**
```typescript
if (activeWorkspace === 'restaurant-pos') { <PosScreen /> }
if (activeWorkspace === 'store-pos')     { <RetailPosScreen /> }
if (activeWorkspace === 'kds')           { <KdsScreen /> }
// inventory and admin fall through to generic AppLayout
```

**3. WorkspaceHome.tsx — Colors + order + access**
```typescript
const WS_COLORS: Record<string, string> = {
  'restaurant-pos': 'ws-color-restaurant-pos',
  'store-pos': 'ws-color-store-pos',
  kds: 'ws-color-kds',
  inventory: 'ws-color-inventory',
  admin: 'ws-color-admin',
};

const WS_ORDER: Record<string, number> = {
  'restaurant-pos': 1, 'store-pos': 2, kds: 3, inventory: 4, admin: 5,
};

const cashierOnly = new Set(['restaurant-pos', 'store-pos']);
const kitchenOnly = new Set(['kds']);
```

**4. WorkspaceIcon.tsx — Icon rendering by key**
```typescript
switch (key) {
  case 'restaurant-pos': return <ForkKnifeIcon />;
  case 'store-pos':      return <ShoppingBagIcon />;
  case 'kds':            return <MonitorIcon />;
  case 'inventory':      return <BoxIcon />;
  case 'admin':          return <GearIcon />;
  default:               return <CircleIcon />;  // fallback
}
```

---

## 3. What Already Exists: The Store Entity

The codebase already has a fully functional **store** entity that represents a physical location:

| Component | Purpose |
|---|---|
| `StoreProfile` type | `{ id, name, address, tax_id, currency, timezone, is_primary }` |
| `stores` SQL table | Persists store profiles |
| `StoreSwitcher` | Topbar dropdown to switch active store |
| `MultiStoreDashboardScreen` | Admin UI for store management |
| `set_primary_store` API | Marks a store as default |

This is important because a workspace instance's data scope naturally maps to a store — but the relationship between stores and workspaces needs careful design.

---

## 4. Data Scoping Analysis

### 4a. Tables that would need a scope column

| Table | Scope column | Impact |
|---|---|---|
| `products` | `store_id` | Products currently global. Adding store scoping means a product must be assigned to stores. POS lookup queries become `WHERE store_id = ?`. |
| `orders` | `store_id` | Each order belongs to one store. Already partially implicit (sale happens at a location). |
| `order_lines` | `store_id` | Denormalized for query performance. |
| `customers` | `store_id` or shared | Some businesses share customers across stores, some don't. Needs config. |
| `gift_cards` | `store_id` or global | Same as customers. |
| `stock` | `warehouse_id` | Inventory needs its own scoping — a store can have multiple warehouses. |
| `stock_counts` | `warehouse_id` | Counts are per-warehouse. |
| `suppliers` | `store_id` or shared | Depends on business model. |
| `purchase_orders` | `store_id` | POs are usually per-store. |

### 4b. Scope model options

**Store-only scoping** (simpler):
- Each workspace instance has an optional `store_id`
- When set, all queries filter by `WHERE store_id = ?`
- Products assigned to stores via `product_stores` join table
- Orders, customers, etc. always scoped to a store

**Store + warehouse scoping** (more complex):
- Workspace instances can have `store_id`, `warehouse_id`, or both
- Inventory workspaces use `warehouse_id` for stock scoping
- POS workspaces use `store_id` for order/customer scoping
- Products shared across all warehouses of a store

**Global scoping** (current):
- No scope columns. All workspaces see all data.
- Simplest model, works for single-location businesses.

### 4c. The product-store assignment problem

Currently, adding a product is: create product → it's available everywhere. With store scoping:

```
products table (global catalog)
  ↓
product_stores table (which stores carry which products)
  | product_id, store_id, price_override?, is_available?
```

This means:
- The product lookup screen in POS shows only products assigned to the current store
- Adding a product requires a "assign to stores" step (or auto-assign to all stores)
- A chain can have a central catalog where each store selects what to carry

This is a significant UX change for product management.

---

## 5. Design Options

### Option A: Workspace Instances Only (No Data Scoping)

**What changes:**
- Add `workspace_instances` table with `type_key`, `display_name`, `colour`, `is_active`
- Each existing workspace key becomes a type (seeded from current `workspaces` table)
- Create one default instance per type for existing deployments
- Migrate `user_workspaces` → `user_workspace_instances`
- Workspace picker shows instances grouped by type
- AppShell routes by `type_key` instead of workspace key

**What stays the same:**
- All data is global — no `store_id` on any table
- Products, orders, customers shared across all instances
- Two "Restaurant POS" instances see the same orders

**Effort:** ~2-3 days  
**Risk:** Low — no data migration, no new queries  
**Value:** High — user assignment, named workspaces, visual distinction  

### Option B: Workspace Instances + Store Scoping

**Everything in Option A, plus:**
- Add `store_id` column to products (via `product_stores`), orders, order_lines, customers
- Add `warehouse_id` to stock, stock_counts
- Pass active store/warehouse scope through `WorkspaceScope` React context
- All API calls filter by scope

**Effort:** ~3-4 weeks  
**Risk:** Medium — backfilling data, store-assignment UX, query correctness  
**Value:** High — true multi-location data isolation  

### Option C: Warehouse-First Scoping

**Everything in Option A, plus:**
- Add `warehouse_id` column to stock, stock_counts only
- POS data remains global
- Inventory workspaces filter by warehouse
- POS workspaces see all products/orders

**Effort:** ~1 week  
**Risk:** Low-medium — inventory queries only, POS unchanged  
**Value:** Medium — solves the "multiple inventory" need without touching POS  

---

## 6. Recommendation: Option A First, Option C Next

### Phase 1: Workspace Instances (2-3 days)

| Step | What | Files |
|---|---|---|
| 1 | Create `workspace_instances` table + migration | `crates/oz-core/migrations/` |
| 2 | Seed default instances from existing workspace keys | Migration SQL |
| 3 | Add `list_workspace_instances`, `create_instance`, `delete_instance` APIs | `crates/oz-core/src/db/workspaces.rs` + `apps/desktop-client/src/commands/workspaces.rs` |
| 4 | Migrate `user_workspaces` → `user_workspace_instances` | DB migration + Rust logic |
| 5 | Add `list_all_workspace_types` API (for admin dropdowns) | Same files |
| 6 | Update `WorkspaceContext` to fetch instances | `ui/src/contexts/WorkspaceContext.tsx` |
| 7 | Update `WorkspaceHome` to show instance names/colors | `ui/src/features/workspaces/WorkspaceHome.tsx` |
| 8 | Update `AppShell` to route by `type_key` | `ui/src/frontend/shell/AppShell.tsx` |
| 9 | Add instance management UI in settings | New screen in settings sidebar |
| 10 | Add workspace assignment UI in staff settings | New component on staff edit page |

**Testing strategy:**
- Rust unit tests for all new workspace queries (following existing patterns in `workspaces.rs`)
- Frontend tests for workspace picker showing instances
- Integration test for user assignment → workspace list filtering

### Phase 2: Warehouse Inventory Scoping (1 week, if needed)

- Add `warehouse_id` to stock + stock_counts
- Add `warehouses` table (belongs to a store)
- Inventory screens filter by `warehouse_id` from active workspace instance
- POS and admin screens unchanged

### Phase 3: Full Store Scoping (3-4 weeks, if needed)

- Add `product_stores` join table
- Add `store_id` to orders, order_lines, customers, gift_cards
- Thread `WorkspaceScope` context through all data hooks
- Update all API endpoints to accept optional scope parameters

---

## 7. Design Decision Record

### Decision: Separate type from instance

Workspace keys become **types** (templates that define rendering mode and screens). Workspace **instances** are deployments of a type with a name, colour, and optional data scope.

```
Type: 'restaurant-pos'
  → render_mode: 'fullscreen'
  → screens: [sales, kds, orders, tables]

Instance: 'ws-downtown-resto'
  → type: 'restaurant-pos'
  → name: 'Downtown Restaurant POS'
  → colour: '#4f46e5'
  → store_id: null (Phase 1 — no scoping)
```

### Decision: Default instances for backward compatibility

A migration creates a default instance per existing workspace key:

```sql
INSERT INTO workspace_instances (id, type_key, name, description, colour)
SELECT 'default-' || key, key, name, description, '#10b981' FROM workspaces;
```

Existing `user_workspaces` rows are migrated to point at the corresponding default instance. Single-location businesses see no change.

### Decision: User assignment is per-instance

The `user_workspace_instances` table replaces `user_workspaces`:

```sql
CREATE TABLE user_workspace_instances (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL REFERENCES workspace_instances(id) ON DELETE CASCADE,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, instance_id)
);
```

Resolution order:
1. `role-owner` → all active instances
2. `user_workspace_instances` has rows → return ONLY those instances
3. Otherwise → return instances whose type is in `role_workspace_types`

### Decision: Data scoping deferred

Data scoping (`store_id` on tables) is **not** part of Phase 1. All instances share the same data until Phase 2 or 3. This avoids massive migrations while delivering the immediate value of named, assignable workspace instances.

---

## 8. Open Questions

1. **Should warehouses be global or per-store?**
   - Per-store: a warehouse belongs to one store
   - Global: warehouses are independent of stores, can be shared
   - Recommendation: per-store for Phase 2, since warehouse stock is usually location-specific.

2. **Should customers be shared across stores?**
   - Shared: customer visits Downtown, then Mall — same profile, unified loyalty
   - Per-store: separate customer databases per location
   - Recommendation: configurable, default shared.

3. **Should the `render_mode` field be database-driven or hardcoded?**
   - Database: each type has `render_mode` ('fullscreen' | 'sidebar'), AppShell reads it dynamically
   - Hardcoded: AppShell has a TypeScript switch on type_key
   - Recommendation: database-driven for forward compatibility, hardcoded switch for rendering logic (since different types need different React components regardless).

4. **What happens when an instance is deleted?**
   - Cascade: remove user assignments
   - No-cascade: data stays, just the workspace entry disappears
   - Recommendation: soft-delete (is_active flag) so historical assignments and data still resolve.

---

## 9. Related Documents

- `docs/decisions/2026-07-10-workspace-type-instance-design.md` — ADR with full schema design
- `crates/oz-core/src/db/workspaces.rs` — Current workspace queries
- `apps/desktop-client/src/commands/workspaces.rs` — Current workspace IPC commands
- `ui/src/contexts/WorkspaceContext.tsx` — Current workspace state management
- `ui/src/features/workspaces/WorkspaceHome.tsx` — Workspace picker UI
- `ui/src/frontend/shell/AppShell.tsx` — Workspace routing and rendering
- `ARCHITECTURE.md` — Overall architecture reference

> last audited 08-09-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

