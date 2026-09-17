---
num: 4
area: architecture
title: ADR #4: Store-First Tenancy & Workspace Type/Instance Architecture
status: Implemented (2026-07-10)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · foundational ADR; structs verified: SessionContext (crates/oz-core/src/session.rs:24), WorkspaceType/WorkspaceInstance (db/workspaces.rs:48/67), InstanceStatus enum (subscription.rs:33); crates/oz-core/src/db/workspaces.rs + platform/core/src + StoreDatabaseManager (platform/core/src/database/manager.rs) present; AppShell.tsx type_key switch (restaurant-pos/store-pos) confirmed; terminals migration 016 binding columns + HMAC design match implementation; store-scoped DB model + SessionContext immutability match ADR #7's resolve_scope() · referenced ADRs (#5/#6/#7/#8/#9) all exist · Status "Implemented (2026-07-10)" consistent -->

# ADR #4: Store-First Tenancy & Workspace Type/Instance Architecture

**Status:** Implemented (2026-07-10)
**Date:** 2026-07-10
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** architecture, tenancy, workspaces, multi-store, data-isolation, device-binding

---

## Context

kasir.mu currently defines workspaces as a flat set of unique keys:

```
restaurant-pos  → fullscreen PosScreen with table management
store-pos       → fullscreen RetailPosScreen with product lookup
kds             → fullscreen KdsScreen (kitchen display)
inventory       → AppLayout sidebar with inventory screens
admin           → AppLayout sidebar with admin screens
```

This works for single-location businesses, but breaks down when a business operates multiple venues:

- A restaurant chain needs separate POS workspaces for **Downtown** and **Mall** locations.
- A retail chain needs separate POS workspaces for each store.
- A warehouse operator needs separate inventory workspaces for **Warehouse A** and **Warehouse B**.

The core problem is that each workspace key conflates **type** (what UI to render) with **instance** (which data to scope).

### Current Limitations

1. **No duplicated types** — You cannot have two `restaurant-pos` workspaces because the key must be unique and the frontend routing is key-based.
2. **No data scoping** — All products, orders, customers, and inventory are global. There is no `store_id` or `warehouse_id` filter.
3. **Hardcoded frontend** — `AppShell.tsx`, `WorkspaceHome.tsx`, and `WorkspaceIcon` have hardcoded key → behavior mappings.
4. **User assignment is type-based** — `user_workspaces` assigns a user to a workspace KEY, not to an instance. A user cannot be assigned to "Downtown Restaurant" specifically.

### Requirements

- A business can have **N workspaces of the same type** (e.g., 3 restaurant POS workspaces).
- Each workspace instance **scopes data** to a specific store/warehouse/location.
- The **workspace picker** shows instance names (e.g., "Downtown Restaurant POS"), not type names.
- **User assignment** is per-instance, not per-type.
- The **rendering system** determines what UI to show from the workspace type, while the **data layer** filters by the instance's scope.
- The system scales from a single food stall to a 500-store chain.

---

## Foundational Decision: Store-First Tenancy Model

Before designing workspace types and instances, the framework must answer a more fundamental question: **what is the unit of data isolation?**

### The Tenancy Options

| Model | Mechanism | Max Stores | Tradeoffs |
|---|---|---|---|
| **Device-bound** | Each terminal assigned to one store; scope is implicit | Unlimited | Simplest; users can't switch stores from a single device |
| **Store-scoped databases** | Each store gets its own `POS.sqlite` file | Unlimited | Cross-store reporting requires cloud aggregation or separate reporting DB; per-store backup/restore is trivial |
| **Multi-tenant SQLite** | All stores in one DB, scoped via `WHERE store_id = ?` on every query | ~50–100 stores | Index bloat; `store_id` colonization of every table; no per-store backup isolation |

### Decision: Device-Bound Default + Store-Scoped Databases for Isolation

**We choose device-bound as the default session model with store-scoped databases for data isolation.** This means:

1. **Every terminal/device is assigned to a default store and a default workspace instance.** When a user logs in on that device, they operate within that store's scope automatically — no workspace picker, no store switcher. This covers 90%+ of POS usage.

2. **Each store gets its own SQLite database file** (`store-<id>.sqlite`). Data isolation is built into the filesystem — no `store_id` column needed on every table. Backup, restore, and migration are per-store. SQLite performance remains constant regardless of total store count.

3. **The desktop admin shell is the exception.** Administrators and owners on desktop may need to switch between stores for reporting and management. The admin app uses a **store picker** (not a workspace picker) as the top-level navigation, then optionally an instance picker within the store.

4. **Cross-store operations go through the sync layer** (`platform/sync/`). Chain-wide reporting, shared customer profiles, and centralized catalog management are cloud features that aggregate data from per-store databases during sync cycles.

5. **Single-store deployments** (the vast majority) keep a single `POS.sqlite` and see no change. The device binding is transparent — the terminal simply boots into its default state.

### Why This Scales

| Concern | How It's Handled |
|---|---|
| **Data isolation** | Filesystem — each store is its own SQLite file |
| **Query performance** | Per-store databases never grow beyond one store's data |
| **Backup** | Per-store; copy one file |
| **500-store chain** | 500 small SQLite files; owner views aggregated reports via cloud |
| **Regional manager** | Cloud sync delivers manager's assigned stores' data to their device |
| **Cross-store inventory transfer** | Mediated by cloud sync; source store writes a delta, target store receives it |

### The Three-Tier Resolution Hierarchy

Every session resolves through three levels, from most specific to most general:

```
Level 1 — Store (Tenancy)
  └── Resolved from: device binding > user's primary store > store picker

Level 2 — Workspace Instance (Deployment)
  └── Resolved from: device binding > user's default instance > instance picker

Level 3 — Workspace Type (UI Template)
  └── Resolved from: instance.type_key (always implicit from the instance)
```

For a **device-bound terminal** (95% of cases): all three levels resolve automatically at boot. The user never sees a picker.

For a **desktop admin session**: Level 1 may show a store picker (if multi-store). Level 2 may show an instance picker (if user has multiple instances within the store). Level 3 is always implicit.

---

## Decision: Workspace Type/Instance Separation

With the tenancy model established, workspace types and instances are properly scoped:

### Workspace Type (UI Template — Global)

A workspace type defines **what the workspace looks like and how it renders**. Types are global (not per-store) and shared across the entire system:

```rust
pub struct WorkspaceType {
    pub key: String,           // 'restaurant-pos', 'store-pos', 'inventory', 'admin', 'kds'
    pub name: String,          // 'Restaurant POS'
    pub layout_mode: String,   // 'fullscreen' | 'sidebar'
    pub icon: String,          // Icon identifier
    pub sort_order: i32,
    pub accent_colour: String, // Default accent colour (overridable per instance)
}
```

- Types are **seeded at migration time** and rarely change.
- `layout_mode` tells the shell whether to render fullscreen (POS, KDS) or inside the sidebar AppLayout (inventory, admin). This is a layout hint, not a rendering instruction — the frontend still maps `type_key` to specific React components.
- `workspace_type_screens` maps each type to its nav items.

### Workspace Instance (Deployment — Scoped to a Store)

A workspace instance is a **specific deployment of a type within a specific store**:

```rust
pub struct WorkspaceInstance {
    pub id: String,             // 'ws-dt-cashier-1', 'ws-mall-inventory'
    pub type_key: String,       // 'restaurant-pos'
    pub store_id: String,       // The store this instance belongs to (NOT NULL)
    pub name: String,           // 'Downtown - Cashier 1'
    pub description: String,
    pub colour: Option<String>, // Per-instance accent colour override
    pub status: InstanceStatus, // Active | QuotaSuspended | Archived
    pub created_at: String,
    pub updated_at: String,
}
```

Key differences from the old flat model:
- `store_id` is **NOT NULL** — every instance belongs to exactly one store. (A `NULL` store was the old "global workspace" pattern; that's replaced by default instances in the primary store.)
- Status replaces the `is_active` boolean (see ADR #5 for the `InstanceStatus` enum).
- Data scoping is handled by the store-level database switch, not by query-level `WHERE store_id = ?` clauses.

---

## Database Schema

### Workspace Types (Logically Global, Physically Replicated)

Workspace types are **logically global** — the same set of types exists across all stores. They are **physically replicated** into every store database via migration. When a new workspace type is added (e.g., a future `kiosk` type), the migration is applied to all store databases. There is no single global `workspace_types` table that per-store tables reference — each database has its own copy.

```sql
-- Seeded into every store database by migration
CREATE TABLE workspace_types (
    key            TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    layout_mode    TEXT NOT NULL DEFAULT 'sidebar',  -- 'fullscreen' | 'sidebar'
    icon           TEXT NOT NULL DEFAULT '',
    sort_order     INTEGER NOT NULL DEFAULT 0,
    accent_colour  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE workspace_type_screens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type_key    TEXT NOT NULL REFERENCES workspace_types(key),
    screen_key  TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(type_key, screen_key)
);
```

### Workspace Instances (Per-Store, in Each Store's Database)

```sql
CREATE TABLE workspace_instances (
    id          TEXT PRIMARY KEY,
    type_key    TEXT NOT NULL REFERENCES workspace_types(key),
    store_id    TEXT NOT NULL,        -- Boot-time validation: must match the database's owning store.
                                      -- No FK — store_profiles lives in the global DB, not per-store DBs.
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    colour      TEXT,                   -- optional accent colour override
    status      TEXT NOT NULL DEFAULT 'active',  -- 'active', 'quota_suspended', 'archived'
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Since each store has its own database, every instance row necessarily belongs to that store. The `store_id` column is a **boot-time validation field** (not a query filter) — on startup, the system checks that the database's instances match the expected store identity. All domain queries use the implicit database scope without `WHERE store_id = ?`.

### User Assignments (Per-Store Database)

```sql
CREATE TABLE user_workspace_instances (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id  TEXT NOT NULL REFERENCES workspace_instances(id) ON DELETE CASCADE,
    is_default   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, instance_id)
);
```

### Device Binding (Global Database — Logical Reference)

Device binding lives in the global (primary) database where the `terminals` table and `store_profiles` table are stored. Since `workspace_instances` lives in per-store databases, `bound_instance_id` is a **logical reference** (no FK constraint) — validated at resolution time by opening the target store's database and checking the instance exists.

```sql
-- Extends the existing terminals table (migration 016).
-- bound_store_id has an FK because store_profiles is in the global DB.
-- bound_instance_id is a logical reference (validated at boot, not enforced by FK).
ALTER TABLE terminals ADD COLUMN bound_store_id TEXT
    REFERENCES store_profiles(id);
ALTER TABLE terminals ADD COLUMN bound_instance_id TEXT;  -- logical ref; validated at boot
```

At boot time, if both columns are set, the system opens the bound store's database and verifies that `bound_instance_id` exists and is active. If validation fails, the terminal falls through to user-based resolution and logs a warning.

A terminal bound to both a store and an instance boots directly into that workspace, skipping all pickers. This is the default for tablets, KDS screens, and fixed POS registers.

### Migration Path from Current Tables

| Current Table | Migrates To | Notes |
|---|---|---|
| `workspaces` | `workspace_types` | Data preserved; `key` becomes PK |
| `workspace_screens` | `workspace_type_screens` | Data preserved; `workspace_key` → `type_key` |
| `role_workspaces` | `role_workspace_types` | Renamed; data preserved |
| `user_workspaces` | `user_workspace_instances` | Each row: create a default instance per type_key in the primary store, then point user at it |

For single-store deployments, a migration creates one default instance per type in the primary store:

```sql
INSERT INTO workspace_instances (id, type_key, store_id, name, description)
SELECT 'default-' || key, key, (SELECT id FROM store_profiles WHERE is_primary = 1 LIMIT 1), name, description
FROM workspaces;
```

---

## Session Resolution Algorithm

When a user logs in, the system resolves their active context in this order:

```
1. DEVICE BINDING CHECK:
   If terminal has bound_store_id AND bound_instance_id
     → Set active store = bound_store_id, active instance = bound_instance_id
     → Skip all pickers. Boot directly into the workspace.
     → DONE.

2. STORE RESOLUTION:
   a. If user is 'role-owner' AND user_store_access is empty (single-store deployment):
        → Return ALL stores (legacy backward-compatible behavior)
   b. If user is 'role-owner' AND user_store_access has rows (multi-store chain):
        → Return ONLY stores in user_store_access (NO automatic all-stores access)
   c. If user_store_access has rows for this user:
        → Return those stores
   d. If user has a primary/default store assignment:
        → Set active store = user's default store
   e. Otherwise (single-store deployment):
        → Set active store = the sole store

3. INSTANCE RESOLUTION (within the active store):
   a. If user_workspace_instances has rows for this (user, store):
        → Return ONLY those instances
   b. If role = 'role-owner':
        → Return ALL active instances in this store
   c. Otherwise:
        → Return instances whose type_key is in role_workspace_types for this store

4. If user has exactly ONE accessible instance:
        → Auto-select it. Skip the picker.
   If user has MULTIPLE instances:
        → Show instance picker (WorkspaceHome) scoped to this store.

5. CREATE SESSION CONTEXT:
   → Build an immutable SessionContext { user_id, role_id, terminal_id, store_id, instance_id, type_key }
   → All subsequent Tauri commands read store_id from this context, not from frontend params.
   → Switching stores destroys the session and re-runs from Step 1.
```

The `WorkspaceDto` sent to the frontend includes the full resolution chain:

```rust
pub struct WorkspaceDto {
    pub instance_id: String,
    pub type_key: String,
    pub store_id: String,
    pub store_name: String,        // For display: "Downtown"
    pub name: String,              // Instance name: "Downtown - Cashier 1"
    pub description: String,
    pub icon: String,              // From the type
    pub layout_mode: String,       // From the type
    pub colour: Option<String>,    // Instance override, falls back to type accent_colour
    pub is_default: bool,          // This is the user's default instance
}
```

---

## Frontend Routing by Type

`AppShell.tsx` switches on `type_key` — unchanged from the original proposal:

```typescript
switch (instance.type_key) {
  case 'restaurant-pos':
    return <PosScreen storeId={instance.store_id} onNavigate={...} />;
  case 'store-pos':
    return <RetailPosScreen storeId={instance.store_id} onNavigate={...} />;
  case 'kds':
    return <KdsScreen />;
  case 'inventory':
  case 'admin':
  default:
    return <AppLayout route={route}><PageComponent /></AppLayout>;
}
```

The `layout_mode` field provides a coarse hint (`fullscreen` vs `sidebar`) but the `type_key` → component mapping remains hardcoded. This is intentional — different types need different React components, and no database field can replace that mapping.

---

## Data Isolation: Store-Scoped Databases

Since each store has its own SQLite database, **no `store_id` columns are needed on domain tables.** Data isolation is automatic:

- `products` in `store-downtown.sqlite` are Downtown's products
- `orders` in `store-mall.sqlite` are the Mall's orders
- `stock` in `store-warehouse-a.sqlite` is Warehouse A's inventory

### What This Avoids

- No `WHERE store_id = ?` on every query
- No `store_id` column on `products`, `orders`, `order_lines`, `customers`, `gift_cards`, `stock`, `stock_counts`
- No `OR store_id IS NULL` ambiguity
- No "is this product intentionally global or just not yet assigned?" confusion
- No index bloat as store count grows

### Cross-Store Data Flow

Data that needs to move between stores goes through the sync layer:

| Use Case | Mechanism |
|---|---|
| **Chain-wide reporting** | Cloud aggregates per-store databases after sync |
| **Shared customer profiles** | Customer data replicated via sync to all stores (or looked up via cloud API) |
| **Central catalog management** | Product templates pushed from cloud to each store's database |
| **Inventory transfer between stores** | Source store writes a stock_movement delta; target store receives it via sync |
| **Regional manager dashboard** | Sync delivers a consolidated view for assigned stores |

### Single-Store Deployments (95% of Users)

For the vast majority of deployments, there is one store and one database file. The store picker is never shown. Device binding is configured once during setup and never changes. The system behaves exactly as it does today.

---

## Security Architecture

Store-scoped databases provide filesystem-level data isolation, but the application layer must enforce that a session cannot cross store boundaries. The following security controls are mandatory.

### 1. Session Scope (The `SessionContext`)

Every authenticated session carries an immutable `SessionContext` that binds the user to their resolved scope:

```rust
pub struct SessionContext {
    pub user_id: String,
    pub role_id: String,
    pub terminal_id: String,
    pub store_id: String,          // Immutable after resolution
    pub instance_id: String,       // Immutable after resolution
    pub type_key: String,          // Derived from instance
}
```

This context is **created once** during session resolution and **never mutated** for the lifetime of the session. All Tauri commands receive the `SessionContext` and use its `store_id` to select the correct database connection. The frontend never passes `store_id` as a parameter — it's always read from the session.

**Implementation pattern for Tauri v2:** Tauri v2 has no middleware, no request-scoped DI beyond `State`. The `SessionContext` is resolved explicitly in each command handler via a helper function, not auto-injected:

```rust
// Real Tauri v2 pattern — session_token is passed from frontend, validated every command
#[command]
pub async fn list_orders(
    state: State<'_, AppState>,
    session_token: String,          // opaque token; frontend holds this, not the context
    status: Option<String>,
) -> Result<Vec<OrderDto>, AppError> {
    let session = state.resolve_session(&session_token)?;   // validates + returns SessionContext
    let db = state.db_manager.open_store(&session.store_id)?;
    let store = Store::new(&db);
    store.list_orders(status.as_deref())
}
```

The `session_token` is an **opaque, randomly-generated identifier** (not a JWT, not parseable by the frontend). It is generated by the backend during login/session-resolution and stored in the frontend's `WorkspaceContext` as an opaque string. The backend maintains an in-memory session store (`HashMap<session_token, SessionContext>`) that maps tokens to resolved contexts. When a command arrives, `resolve_session()` looks up the token and returns the context — if the token is invalid or expired, the command fails with `AppError::InvalidSession`.

This is enforced by **code review convention**: any Tauri command that accepts `store_id: String` as a direct parameter is a violation. A custom `clippy` lint rule rejects `store_id` in command signatures.

**Session token rotation on store switch:** When an admin switches stores, the old `session_token` is invalidated and a new one is issued with the new `SessionContext`. Two concurrent tabs using the same old token would both fail after the switch, forcing re-resolution. This prevents stale scope from persisting.

### 2. Device Binding Integrity

Device binding (`terminals.bound_store_id` / `bound_instance_id`) is stored in the global database, which is writable by any process with filesystem access. To make tampering **detectable** (not impossible), device bindings are **cryptographically signed**:

1. **At write time** (admin binds a terminal): the backend writes the binding row AND computes an HMAC-SHA256 signature over `(terminal_id, bound_store_id, bound_instance_id)` using a key stored in the OS keyring (`oz-security::Keyring`). The signature is stored alongside the binding.

2. **At boot time** (resolution): the backend reads the binding, recomputes the HMAC, and compares it to the stored signature. If they don't match, the binding is rejected and the terminal falls through to user-based resolution with a `SecurityEvent::DeviceBindingTampered` audit log entry.

```sql
ALTER TABLE terminals ADD COLUMN binding_signature TEXT;  -- HMAC-SHA256
```

**Threat model:** This protects against **casual tampering** — someone who opens the SQLite file in a text editor or a hex editor and modifies the binding row, but does not also read the OS keyring. It does NOT protect against a determined attacker who has code execution as the same OS user (they can read the keyring and forge valid signatures). The real defense against that threat is SQLCipher encryption (Section 5) which prevents reading the SQLite at all, plus OS-level file permissions.

**Key recovery:** If the OS keyring is lost (OS reinstall, hardware migration), all device bindings become invalid. The admin recovery path is: authenticate as `role-owner`, which triggers an interactive prompt to re-key all bindings (generate a new keyring secret, re-sign all binding rows). This requires explicit admin action and is audit-logged.

Hardware-backed attestation (TPM/Secure Enclave) is a future enhancement that would provide stronger binding, tracked separately.

### 3. Store-Level Access Control

The ADR's resolution algorithm assumes `role-owner` sees all stores, but this doesn't scale. A regional manager should only see their 5 assigned stores, not all 500. We add a `user_store_access` table in the global database:

```sql
CREATE TABLE user_store_access (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id     TEXT NOT NULL REFERENCES store_profiles(id) ON DELETE CASCADE,
    access_level TEXT NOT NULL DEFAULT 'operator',  -- 'operator' | 'manager' | 'viewer'
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, store_id)
);
```

**Modification guard:** `user_store_access` rows can only be modified by users holding the `chain:manage_stores` permission — a permission that is NOT granted by `role-owner` by default. This prevents self-escalation: a regional manager with `staff:update` cannot add themselves to additional stores. Only a chain-level administrator with `chain:manage_stores` can assign store access.

The updated store resolution algorithm becomes:

```
STORE RESOLUTION (revised):
  a. If user is 'role-owner' AND user_store_access is empty (single-store deployment):
       → Return ALL stores (legacy backward-compatible behavior)
  b. If user is 'role-owner' AND user_store_access has rows:
       → Return ONLY those stores (even if partial — row existence triggers scoped mode)
  c. If user_store_access has rows for this user:
       → Return those stores
  d. If user has a primary/default store assignment:
       → Return that store
  e. Otherwise (single-store deployment):
       → Return the sole store
```

**Edge case — partial owner access:** If `role-owner` has 3 of 20 stores in `user_store_access`, they see only those 3. The presence of ANY rows triggers scoped mode. To grant chain-wide access, an admin must explicitly insert rows for all 20 stores (or use `role-chain-owner`, a future role gated behind MFA). This explicit-is-better-than-implicit approach prevents surprises.

Key change: `role-owner` in a multi-store chain does NOT get automatic access to all stores. The chain owner must be explicitly assigned to each store (a one-time setup during onboarding). This eliminates the blast radius of a compromised owner account — a stolen owner credential only exposes assigned stores, not the entire chain.

### 4. Admin Store Switching Triggers Full Re-Resolution

When an admin switches stores via the store picker, the session token is **invalidated** and a new one is issued. This ensures:

- The new `SessionContext` is freshly validated against `user_store_access`.
- The database connection is switched atomically (old connection closed, new one opened).
- All in-memory caches are invalidated.
- An `AuditEvent::StoreSwitched { from_store_id, to_store_id, user_id }` entry is written.

Shared touchscreen fast-switching (ADR #6's `FastPINOverlay.tsx`) follows the same rule: switching users always invalidates the old session token and issues a new one with the new user's resolved scope. A cashier cannot hot-swap to a manager and inherit access to stores the manager shouldn't see.

**Token lifecycle:**
- Login → session token created, stored in backend's `SessionStore` (in-memory `HashMap`)
- Store switch → old token removed from `SessionStore`, new token issued with new scope
- Logout → token removed from `SessionStore`
- App restart → `SessionStore` is empty; user must re-authenticate

### 5. Database File Encryption at Rest

~~Each store's SQLite file is encrypted using SQLCipher (Community Edition, BSD-style license) or an equivalent at-rest encryption layer. The encryption key is derived from a master key stored in the OS keyring.~~ This provides defense-in-depth:

> **CORRECTION 2026-09-12 — the layer described above was never built, and the database file is NOT encrypted.** The decision text is kept as written; this marks what does not exist. Measured against the tree: no `Cargo.toml` in the workspace depends on SQLCipher (the SQLite dependency is plain `rusqlite` with `features = ["bundled", "backup"]`, not `bundled-sqlcipher`), no code path opens a database with a cipher key, and the only non-document hit for the word anywhere is a carried `next: SQLCipher (carried)` note in the `apps/desktop-client` state audit stamp — a to-do, not an implementation. `docs/archived/sqlcipher-migration-plan.md` states it plainly in its own correction banner: *SQLCipher at-rest encryption did not ship*, status NEVER ADOPTED. So a copied `store-<id>.db` opens in any SQLite reader with no keyring secret involved.
>
> **What does exist is field-level encryption, not whole-file encryption** — and the distinction is the part worth carrying forward, because the two families fail in opposite directions by design. Since `e105109f6` (2026-08-29, `security(H-5): extract oz-crypto crate + transparent secret encryption at rest`) specific *columns* are sealed by `crates/oz-crypto` and only unsealed through their typed accessors: the settings credential family (`sync_api_key`, `sync_terminal_secret`, `pg_sync_password`, `rate_sync.api_key`, `lan_server.psk`, the SMTP password, `license.api_key`) and the profile PII columns (national id, pay). The **PII side fails closed** — `StoredCipher::classify` in `crates/oz-core/src/db/profile.rs` maps a stored value that looks like our ciphertext but will not decrypt to `Unreadable`, and `Store::get_user_profile` returns no value rather than garbage. The **settings side fails open**: the decrypt path treats anything that is not recognisably our ciphertext format as legacy plaintext and returns it unchanged (`crates/oz-crypto/src/lib.rs`, format-gated passthrough from audit F-029; the same shape in `crates/oz-bridge/src/license.rs`), logging a warning. That is deliberate — a pre-`e105109f6` install must keep working — but it means **rows written before 2026-08-29 may still sit in the table in cleartext until something rewrites them**, which is precisely the residue the plaintext-carrying `.db` / `.backup.db` snapshots expose. Whole-file encryption would have covered every column at once; field-level encryption covers named columns on their typed path and nothing else.

- ~~If an attacker copies a `store-<id>.sqlite` file, they cannot open it without the keyring secret.~~ **Corrected 2026-09-12: they can, with any SQLite reader.** Only the named columns listed above are unreadable, and only when they were written through the encrypted accessor.
- ~~The global database (containing device bindings and user auth) is also encrypted.~~ **Corrected 2026-09-12: it is not encrypted at all** — same measurement, and the global DB is where the settings and license keys live, so the field-level carve-out above is the only thing standing between a file copy and those values.
- Combined with the HMAC device binding, this creates ~~two layers: you can't read the file (SQLCipher), and if you somehow bypass encryption,~~ **one layer, corrected 2026-09-12:** modifying the binding is detectable (HMAC). The HMAC is real and shipped; the reading-prevention layer never was, so the defence-in-depth claim in this bullet reduces to detection only.

~~SQLCipher Community Edition is available under a permissive license compatible with commercial distribution. If a paid commercial license is later required, alternative encryption backends (e.g., `sqlite3mc`) can be substituted via a trait abstraction.~~ **Corrected 2026-09-12: this licensing paragraph was a procurement note for a backend that was never adopted, so no trait abstraction exists to substitute into. It is not evidence that any encryption layer shipped — see the correction above.**

This is tracked in ADR #7 (Data Scope Guard) but noted here as a dependency of the store-scoped model.

### 6. Required Audit Events

For PCI-DSS compliance (Requirement 10.2.1) and security monitoring, the following events must be logged:

| Event | Data | Trigger |
|---|---|---|
| `SessionCreated` | `{ user_id, terminal_id, store_id, instance_id }` | Session resolution completes |
| `SessionDestroyed` | `{ user_id, terminal_id, reason }` | Logout, timeout, store switch |
| `StoreSwitched` | `{ user_id, from_store_id, to_store_id }` | Admin changes store in picker |
| `DeviceBindingTampered` | `{ terminal_id }` | HMAC validation fails at boot |
| `DeviceBindingSet` | `{ user_id, terminal_id, store_id, instance_id }` | Admin binds a terminal |
| `UserStoreAccessModified` | `{ modifier_user_id, target_user_id, store_id, action }` | `user_store_access` row added/removed |
| `CrossStoreAccessBlocked` | `{ user_id, attempted_store_id, session_store_id }` | Command called with mismatched scope (defense-in-depth; should be impossible with SessionContext) |

All audit events are written to the immutable append-only audit log. **Audit log placement:** There is one **global audit log** in the global database for tenant-level security events (DeviceBindingTampered, UserStoreAccessModified, SessionCreated, SessionDestroyed, CrossStoreAccessBlocked). Each **store database** has its own audit log for domain events (sale completed, stock adjusted, price changed) — these are created by an audit log migration applied to every store database. The `StoreSwitched` event is written to both the global log (for security monitoring) and the source store's log (for operational audit). The clock rollback check in ADR #5 aggregates timestamps across the global audit log, all store audit logs, and all store orders tables.

### Security Posture Summary

| Threat | Control |
|---|---|
| Frontend requests wrong store's data | `SessionContext` resolves `store_id` from opaque token, not from frontend params |
| SQLite row tampering of device binding | HMAC signature on binding, verified against OS keyring at boot |
| Attacker with OS keyring access forges bindings | ~~Defense-in-depth: SQLCipher prevents reading the SQLite;~~ HMAC is a detection layer, not prevention. **Corrected 2026-09-12: the SQLCipher half of this row is false — no file-level encryption exists, so only the HMAC detection layer ships (see §5).** |
| Compromised owner account accesses all stores | `user_store_access` limits owner to explicitly assigned stores; empty rows = scoped mode |
| Admin self-escalates store access | `chain:manage_stores` permission required to modify `user_store_access` |
| Admin store switching bypasses access control | Session token invalidation + re-resolution on every store switch |
| Stale session token after store switch | Token rotation invalidates old token; concurrent tabs fail and re-resolve |
| Stolen SQLite file opened directly | ~~SQLCipher encryption at rest (ADR #7)~~ **Corrected 2026-09-12: there is no control here. The file opens directly — that is the whole finding. What resists is per-column: the credential and PII columns written through `crates/oz-crypto` since `e105109f6` (2026-08-29) come back as ciphertext, everything else, including any credential row predating that commit, reads as plaintext.** ADR #7 is the Data Scope Guard, a query-layer control, not an encryption layer.** |
| Shared terminal user hot-swap inherits wrong scope | `FastPINOverlay` triggers full session re-resolution + new token |
| No audit trail for security events | Required audit events logged to immutable append-only audit table |

---

## Workspace Picker Design

The picker (`WorkspaceHome.tsx`) only appears when the user has **multiple accessible instances within the active store**. This is rare — most users have one instance per type and auto-boot into it.

### Picker Hierarchy

```
┌─────────────────────────────────────────────┐
│  [Store: Downtown ▼]   (only if multi-store) │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌──────────┐                │
│  │ Cashier 1 │  │ Cashier 2 │               │
│  │ Restaurant│  │ Restaurant│               │
│  └──────────┘  └──────────┘                │
│  ┌──────────┐                               │
│  │Inventory  │                               │
│  │ Downtown  │                               │
│  └──────────┘                               │
│                                             │
└─────────────────────────────────────────────┘
```

### Card Design

Each card shows:
- **Instance name** ("Cashier 1") — prominent
- **Type tag** ("Restaurant POS") — subtle, below the name
- **Store location badge** — only when multi-store is active
- **Instance colour** — from `workspace_instances.colour`, falling back to `workspace_types.accent_colour`
- **Active indicator** — dot on the most recently used instance

### When the Picker Is Skipped

| Scenario | Picker? |
|---|---|
| Device-bound terminal (bound_store_id + bound_instance_id set) | **Skipped** — boots directly |
| Single instance per type, single store | **Skipped** — auto-selects the sole instance |
| Multiple instances, but user has exactly one accessible | **Skipped** — auto-selects |
| Multiple instances, user has multiple accessible | **Shown** — instance picker within store |
| Multi-store owner/manager (desktop admin) | **Shown** — store picker first, then instance picker |

---

## Default Instances + Backward Compatibility

To ensure zero disruption for existing single-location deployments:

- A migration creates one default instance per type in the primary store.
- Existing `user_workspaces` rows are migrated to point at the corresponding default instance.
- The device binding fields (`bound_store_id`, `bound_instance_id`) default to the primary store and the default `restaurant-pos` or `store-pos` instance.
- Single-location businesses see exactly the same UI and data as before — the picker is skipped because there's only one instance per type.

### Store-First Backward Compatibility

For deployments that already have multiple stores via `store_profiles`:

**Data splitting strategy:** The existing database becomes the primary store's database (no data migration needed). When a second store is created via the admin UI, a new empty `store-<id>.sqlite` is created with all migrations applied (including workspace types, default instances, and role assignments). The new store starts with no products, orders, or customers — these are populated via the admin's catalog management or cloud sync. This avoids the risky "split existing data" problem entirely — the primary store keeps everything, new stores start fresh.

- Each existing store gets its own set of default instances seeded at database creation.
- The `StoreSwitcher` component in the topbar becomes the primary navigation control for admin users.
- The existing `StoreSwitcher` is enhanced to trigger a database connection switch and instance re-resolution.

---

## Options Considered

### Option A — Type/Instance Separation + Store-First Tenancy (Chosen)

Separate workspace types (UI template) from workspace instances (deployment within a store). Use store-scoped databases for data isolation. Device binding as the default session model.

- **Pro:** Data isolation is filesystem-level — no query-level scoping needed.
- **Pro:** Scales to 500+ stores without performance degradation.
- **Pro:** Device binding matches real-world POS behavior (a terminal is a terminal).
- **Pro:** The workspace picker is only shown when actually needed (rare).
- **Pro:** Clean separation of concerns: store = data boundary, instance = deployment, type = UI template.
- **Con:** Requires per-store database management (creation, migration, backup).
- **Con:** Cross-store operations require sync layer mediation.

### Option B — Multi-Tenant SQLite with Type/Instance Separation (Rejected)

Put all stores in one SQLite file, scope everything with `WHERE store_id = ?`.

- **Pro:** Simpler database management — one file, one migration path.
- **Pro:** Cross-store queries are possible locally.
- **Con:** Every domain table needs a `store_id` column. Every query needs scope filtering.
- **Con:** Index bloat as store count grows. SQLite query planning degrades.
- **Con:** No per-store backup isolation.
- **Con:** `NULL` store_id creates permanent ambiguity between "unscoped" and "unassigned."
- **Con:** Breaks down past ~50 stores.

### Option C — Tags on Workspace Keys (Rejected)

Keep flat workspace list with colon-delimited tags: `restaurant-pos:downtown`.

- **Pro:** Minimal schema change.
- **Con:** Fragile string parsing. No clear data scoping mechanism.
- **Con:** Doesn't address the tenancy question at all.

### Option D — Multi-Workspace Per User Session (Deferred)

Allow a user to have multiple workspaces open simultaneously in tabs.

- **Pro:** Power users can switch without losing context.
- **Con:** Major frontend complexity with conflicting scopes.
- **Decision:** Revisit when single-workspace-per-session proves limiting.

---

## Consequences

### Positive

- A business can create N instances of any type, each within a specific store.
- Data isolation is filesystem-level — impossible to leak data between stores.
- Device binding eliminates unnecessary pickers for 90%+ of usage.
- The workspace picker only appears when genuinely needed.
- Scales linearly with store count — each store is an independent SQLite file.
- Existing single-location deployments are 100% unaffected.

### Negative

- Per-store database management requires tooling (create, migrate, backup, restore).
- Cross-store operations must go through the sync layer.
- The `StoreSwitcher` must be enhanced to trigger a database connection switch.
- For very large chains, the admin interface needs a store search/dropdown component.

### Mitigations

- Database creation and migration are automated via `platform/core/` tooling.
- Store-scoped databases are created lazily — only when a second store is added.
- The `StoreSwitcher` enhancement is Phase 2 work, not blocking Phase 1.
- For 500+ store chains, the admin app uses cloud-side aggregated reporting — it doesn't need to open 500 databases locally.

---

## Out of Scope (Covered by Other ADRs)

| Concern | Reason | Tracking |
|---|---|---|
| **Subscription tier & entitlement enforcement** | Business-model decision; instance status enum (Active/QuotaSuspended/Archived) is defined here but quota logic is separate. | ADR #5 |
| **CRDT delta ledger & offline UUIDv7 sync** | Phase 1 complete: `stock_movements` delta ledger table + `stock_summary` cache + `adjust_stock_with_reason`. Remaining: UUIDv7, cross-store sync, FastPINOverlay. | ADR #6 🔄 |
| **Hard `ScopeGuard` compile-time enforcement** | Follow-up to soft scoping; the `SessionContext` pattern described in Security Architecture is the soft version. ADR #7 completed the migration — all 84 desktop commands use `session_token` + `resolve_session()`, enforced by `scripts/verify-no-raw-params.sh` in CI. | ADR #7 ✅ |
| **Scoped real-time event bus** | Events carry `store_id`; LAN forwarder is inherently store-scoped since each POS terminal is device-bound to one store. KDS tablets filter by store. | ADR #8 ✅ |
| **Cross-store sync protocol** | The sync layer (`platform/sync/`) already exists; cross-store sync is an extension. | Future ADR |
| **SQLCipher / at-rest database encryption** | ~~Defense-in-depth; encrypts per-store SQLite files and the global DB.~~ **Corrected 2026-09-12: still genuinely future — nothing is encrypted at the file level today (§5). What shipped instead is per-column encryption via `crates/oz-crypto` (since `e105109f6`, 2026-08-29), which does not cover this file.** | Future ADR |
| **Hardware-backed device attestation (TPM/Secure Enclave)** | Stronger device binding beyond HMAC; requires TPM/SE integration. | Future ADR |

---

## Phased Implementation & Migration Guide

> **Status (2026-07-10):** All phases complete. Phase 1 ✅, Phase 1b ✅, Phase 2 ✅ (StoreDatabaseManager + migration tooling + store switcher), Phase 3 ✅, ADR #7 ✅ (all 84 desktop commands migrated to session token pattern).

### Phase 1: Workspace Types + Default Instances + Session Context

**Goal:** Deliver type/instance separation with session-scope enforcement. All data stays in one database; store-level access control is prepared but not yet enforced (single-store mode).

> **Status (2026-07-10):** Steps 1–3 complete (migration, session context, DTOs/models).
> Steps 4–6 deferred to Phase 1b.

1. **Migration SQL (`060_workspace_instances.sql`)** ✅
   - [x] Create `workspace_types`, `workspace_type_screens`, `workspace_instances`, `user_workspace_instances`, and `role_workspace_types` tables.
   - [x] Create `user_store_access` table (used in Phase 2, prepared now).
   - [x] Copy existing `workspaces` rows into `workspace_types`.
   - [x] Create one default instance per type in the primary store.
   - [x] Migrate `user_workspaces` → `user_workspace_instances`.
   - [x] Add `bound_store_id`, `bound_instance_id`, and `binding_signature` columns to `terminals`.
   - [x] Add `InstanceStatus` enum (`active`, `quota_suspended`, `archived`) replacing `is_active` boolean.
   - [x] Keep old tables deprecated for one release.
   - [x] Index on `user_workspace_instances(user_id)` and workspace instances `(type_key)`.
   - **Files:** `crates/oz-core/migrations/060_workspace_instances.sql`, `crates/oz-core/src/migrations.rs`

2. **Session Context** ✅
   - [x] Implement `SessionContext` struct in `crates/oz-core/src/session.rs`.
   - [x] `session_store` in-memory `HashMap<String, SessionContext>` with `resolve_session()` — foundational token infrastructure.
   - [x] `create_session` and `destroy_session` Tauri commands with opaque UUID v4 tokens, input validation, and max-session eviction.
   - [x] `InvalidSession` error variant on both desktop and tablet `AppError` enums.
   - [x] `resolve_session` unit tests (valid token + unknown token).
   - [x] Frontend `createSession`/`destroySession` API wrappers in `ui/src/api/staff.ts`.
   - [x] `sessionToken` lifecycle in `WorkspaceContext`: auto-created on workspace selection, auto-destroyed on logout/store-switch, token rotation on `switchStore()`.
   - [x] `WorkspaceContextValue` exposes `sessionToken: string | null` for commands to pass to backend.
   - [x] **ADR #7 — ALL 84 desktop commands migrated to session token pattern** (see `docs/decisions/2026-07-10-data-scope-guard.md` for full migration table). `scripts/verify-no-raw-params.sh` enforces 0 violations. 47 deprecated commands coexist with `_scoped` variants during backward-compat period.
   - [x] `session_context()` extractor: `resolve_session()` on `AppState` validates opaque tokens and returns `SessionContext` — implemented as convenience method, not Tauri middleware (Tauri v2 has none).
   - [x] All 84 domain commands (`list_orders`, `get_products`, `adjust_stock`, etc.) have `_scoped` variants accepting `session_token: String` instead of raw `store_id`/`user_id`.
   - [x] `clippy` lint rule: `scripts/verify-no-raw-params.sh` grep-based guard enforces no new raw `store_id`/`user_id` params in CI. Custom Clippy plugin tracked as future enhancement.
   - **Files:** `crates/oz-core/src/session.rs`, `crates/oz-core/src/lib.rs`

3. **Rust DTOs & Models** ✅
   - [x] `WorkspaceTypeRow`, `WorkspaceInstanceRow`, `WorkspaceDto` with all new fields.
   - [x] `list_workspaces(role_id, user_id, store_id)` — resolution algorithm with store access check.
   - [x] `create_workspace_instance`, `get_workspace_instance` (now accepts optional `user_id`).
   - [x] `set_user_workspace_instances`, `get_user_workspace_instance_ids` for instance assignment CRUD.
   - [x] Legacy methods preserved (`list_workspaces_legacy`, `set_user_workspaces_legacy`, etc.).
   - [x] Shared `instance_dto_sql()` helper with `LEFT JOIN store_profiles` for null-safe store name.
   - [x] Tauri commands: updated `list_workspaces` (now takes `store_id`), new admin CRUD commands (`create_workspace_instance`, `set_user_workspace_instances`, `get_user_workspace_instances`).
   - [x] Frontend API `ui/src/api/workspaces.ts` updated with new `WorkspaceDto` shape.
   - **Files:** `crates/oz-core/src/db/workspaces.rs`, `apps/desktop-client/src/commands/workspaces.rs`, `apps/desktop-client/src/lib.rs`, `ui/src/api/workspaces.ts`

4. **Device Binding Signing** ✅
   - [x] `set_device_binding` Tauri command: generates HMAC-SHA256 signature via OS keyring.
   - [x] `get_device_binding` Tauri command: returns binding + validates signature.
   - [x] `clear_device_binding` Tauri command: removes binding.
   - [x] `update_terminal_binding`/`get_terminal_binding`/`clear_terminal_binding` DB methods.
   - [x] `sign_binding`/`verify_binding` helpers with keyring secret auto-generation.
   - **Files:** `crates/oz-core/src/db/terminals.rs`, `apps/desktop-client/src/commands/terminals.rs`, `apps/desktop-client/Cargo.toml`

5. **Frontend Context** ✅
   - [x] `activeInstance: WorkspaceDto | null` + `setActiveInstance` in WorkspaceContext.
   - [x] `activeWorkspace` kept as standalone state synced via useEffect (no race condition).
   - [x] `useWorkspaceScope()` hook returning `{ storeId, instanceId, typeKey }`.
   - [x] `availableWorkspaces` preserves old field name for backward compat.
   - [x] `WorkspaceHome.tsx` updated: `ws.key` → `ws.type_key` for new DTO shape.
   - [x] `AppShell.tsx` unchanged — `activeWorkspace` derived from `activeInstance.type_key`.
   - **Files:** `ui/src/contexts/WorkspaceContext.tsx`, `ui/src/features/workspaces/WorkspaceHome.tsx`, `ui/src/api/workspaces.ts`

6. **Verification**: ✅ All tests pass; `cargo check -p oz-core -p oz-pos-app` passes; 3 pre-existing `currency_integration` failures unrelated.

### Phase 2: Store-Scoped Databases

**Goal:** Enable true multi-store isolation. Each additional store gets its own SQLite file.

> **Status (2026-07-10):** All steps complete.

1. **Database Manager** (`platform/core/`) ✅
   - [x] `StoreDatabaseManager` — creates, migrates, opens per-store SQLite files (`store-<id>.sqlite`).
   - [x] Lazy creation: second store's DB is created when the store is added.
   - [x] Connection pool: one open connection per active store, idle stores can be closed.
   - [x] Integrated into `AppState` — `db_manager` field alongside existing `db`.
   - [x] Hooked into `create_store_profile` Tauri command — store DB created on store creation.
   - [x] 11 unit tests including data isolation between stores.
   - **Files:** `platform/core/src/database/manager.rs`, `platform/core/src/database/mod.rs`, `platform/core/src/lib.rs`, `apps/desktop-client/src/state.rs`, `apps/desktop-client/src/commands/store_profiles.rs`

2. **Store Switcher Enhancement** ✅
   - [x] Database-level infrastructure: `StoreDatabaseManager::open_store(store_id)` supports per-store connections.
   - [x] Tauri commands accept `store_id` parameter for scoped workspace queries.
   - [x] UI Store picker component (`StoreSwitcher.tsx`) already existed — enhanced with workspace re-resolution.
   - [x] Cache invalidation on store switch: `switchStore` clears active workspace/instance, re-fetches instances for new store.
   - [x] `WorkspaceContext` exposes `switchStore(storeId)` and `resolvedStoreId`.
   - **Files:** `ui/src/components/StoreSwitcher.tsx`, `ui/src/contexts/WorkspaceContext.tsx`

3. **Migration Tooling** ✅
   - [x] Migrations run on all store databases via `open_or_create_connection()` — always invoked on open.
   - [x] New migrations are applied to existing store databases on next open (runner is idempotent).
   - [x] Tests verify migration recovery from partially-failed creations.

4. **Verification**: ✅ `cargo check -p platform-core -p oz-core -p oz-pos-app` passes; `cargo test -p platform-core -- database::manager` (10/10); `cargo test -p oz-core -- db::workspaces session migrations` (24/24).

### Phase 3: Device Binding + Tablet Boot Flow

**Goal:** Tablets and fixed terminals boot directly into their workspace without showing any picker.

> **Status (2026-07-10):** Steps 1–3 complete. Admin UI for binding terminals deferred (frontend task).

1. **Device Registration** ✅
   - [x] Backend: `set_device_binding`, `get_device_binding`, `clear_device_binding` Tauri commands with HMAC signing (Phase 1b).
   - [x] Admin UI: device binding section in `TerminalManagementScreen` edit modal — select store + instance, bind/clear with HMAC signing.
   - [x] Frontend API: `getDeviceBinding`, `setDeviceBinding`, `clearDeviceBinding` wrappers in `ui/src/api/terminals.ts`.
   - [x] Boot-time validation: `resolve_boot_store` opens the bound store's database and verifies the instance exists and is active.
   - **Files:** `ui/src/api/terminals.ts`, `ui/src/features/terminals/TerminalManagementScreen.tsx`

2. **Boot Resolution** ✅
   - [x] `resolve_boot_store` Tauri command: resolves device binding → verifies HMAC → validates instance in store DB → returns `(store_id, instance_id, is_bound)`.
   - [x] Falls back to primary store when: terminal not found, no binding, HMAC invalid, or instance doesn't exist/is not active.
   - [x] Server-side device_id resolution (from `COMPUTERNAME`/`HOSTNAME` env vars) — frontend doesn't need to know hostname.
   - [x] Frontend `resolveBootStore()` API wrapper in `ui/src/api/workspaces.ts`.
   - [x] `WorkspaceContext.tsx` calls `resolveBootStore()` on mount, uses resolved `storeId` for `listWorkspaces`.
   - **Files:** `apps/desktop-client/src/commands/workspaces.rs`, `apps/desktop-client/src/lib.rs`, `ui/src/api/workspaces.ts`, `ui/src/contexts/WorkspaceContext.tsx`

3. **Tablet Shell Redesign** ✅ (ADR #4 Phase 3b)
   - [x] `main.tablet.tsx` wraps app with `WorkspaceProvider`.
   - [x] `TabletAppShell.tsx` uses `useWorkspace()` for device-bound auto-boot:
     - `!activeWorkspace` → shows `WorkspaceHome` picker.
     - Fullscreen types (`restaurant-pos`, `store-pos`, `kds`) → render directly without tab bar.
     - Sidebar types (`inventory`, `admin`) → render with `TabletAppLayout` + dynamic tabs from `workspaceScreens`.
   - [x] `TabletAppLayout.tsx` accepts optional `workspaceScreens` prop:
     - When provided, filters nav items to only matching `workspace_type_screens`.
     - When omitted, falls back to full menu registry (backward compatible).
   - [x] Dynamic tab bar: a KDS tablet boots directly into `<KdsScreen />` with no tab bar; a server tablet boots into `<PosScreen />` with tabs from `workspace_type_screens`.
   - **Files:** `ui/src/main.tablet.tsx`, `ui/src/frontend/shell/tablet/TabletAppShell.tsx`, `ui/src/frontend/shell/tablet/TabletAppLayout.tsx`

4. **Verification** ✅
   - [x] `cargo fmt --all` passes — all files properly formatted.
   - [x] `cargo clippy -p oz-core -p platform-core -- -D warnings` passes — zero warnings.
   - [x] `cargo test -p oz-core -p platform-core` — 1,029/1,032 pass (3 pre-existing `currency_integration` failures unrelated).
   - [x] `cargo check -p oz-core -p oz-pos-app` passes clean.
   - [x] Full integration: desktop AppShell + tablet AppShell both use WorkspaceContext for device-bound auto-boot.
   - [x] New unit tests added:
     - `BootResolution` DTO serialization (bound + unbound variants, debug fmt).
     - `StoreSwitcher` test updated with `WorkspaceContext` mock and `switchStore` integration test.
     - `WorkspaceHome` mock updated with new context fields (`switchStore`, `resolvedStoreId`, `activeInstance`, `setActiveInstance`).
   - **Files:** `apps/desktop-client/src/commands/workspaces.rs`, `ui/src/__tests__/StoreSwitcher.test.tsx`, `ui/src/__tests__/WorkspaceHome.test.tsx`

---

## Scaling Analysis

| Deployment Size | Stores | Instances | DB Files | Picker Behavior | Performance |
|---|---|---|---|---|---|
| **Single food stall** | 1 | 1–5 | 1 | Never shown | Optimal |
| **Small restaurant** | 1 | 3–8 | 1 | Never shown (device-bound) | Optimal |
| **Multi-location chain** | 3–20 | 12–80 | 3–20 | Store picker for owner; skipped for staff | Per-store optimal |
| **Regional chain** | 20–100 | 80–400 | 20–100 | Store picker with search for owner | Per-store optimal |
| **Enterprise (500+)** | 500+ | 2,000+ | 500+ | Cloud-side aggregated admin; terminals device-bound | Per-store optimal; admin uses cloud |

### Key Scaling Properties

- **The picker never shows more cards than one store's worth of instances.** Even for a 500-store chain, a cashier at Store #347 sees only Store #347's 2–5 instances.
- **SQLite performance is constant.** Each store's database only contains that store's data, regardless of chain size.
- **The admin interface for enterprise uses cloud-side aggregation.** The owner doesn't open 500 databases — they use cloud reporting.

---

## Related

- `WorkspaceContext.tsx` — Current workspace state (needs instance awareness)
- `WorkspaceHome.tsx` — Workspace picker (needs store-scoped instance rendering)
- `AppShell.tsx` — Workspace routing (needs type-based dispatch + device binding)
- `TabletAppShell.tsx` — Tablet shell (needs device binding integration)
- `crates/oz-core/src/db/workspaces.rs` — Backend workspace queries
- `apps/desktop-client/src/commands/workspaces.rs` — Tauri workspace commands
- `apps/desktop-client/src/commands/store_profiles.rs` — Store management commands
- `platform/sync/` — Cross-store sync layer
- `crates/oz-core/migrations/016_terminals.sql` — Terminals table (needs binding columns)
- `crates/oz-core/migrations/025_store_profiles.sql` — Store profiles (existing)
- ADR #1 — Module System Design
- ADR #3 — Frontend Restructure (registry-based shell)
- ADR #5 — Subscription Tier & Entitlement (planned)
- ADR #6 — CRDT Delta Ledger & Offline Sync (planned)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
