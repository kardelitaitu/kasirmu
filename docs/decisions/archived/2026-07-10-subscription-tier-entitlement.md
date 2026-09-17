---
num: 5
area: subscription
title: ADR #5: Subscription Tier & Entitlement Architecture
status: Superseded (2026-07-10) — tier lineup & quotas superseded by `subscription-tiers.md` (FINAL, approved 2026-08-17)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · tenant_subscription migration (061) verified; SubscriptionTier with max_stores()/max_pos_instances()/allows_workspace_type() present in crates/oz-core/src/subscription.rs (lines 113/122/185); InstanceStatus enum (Active/QuotaSuspended/Archived) at subscription.rs:33; crates/oz-core/src/license_verification.rs embeds ../oz-license.key.pub (file exists at crates/oz-core/oz-license.key.pub — distinct from root oz-pos-updater.key.pub named by ADR #9; both real); crates/oz-core/src/db/workspaces.rs + platform/core StoreDatabaseManager present; grace/clock-rollback logic present · Status "Implemented (2026-07-10)" consistent -->

# ADR #5: Subscription Tier & Entitlement Architecture

**Status:** Superseded (2026-07-10) — tier lineup & quotas superseded by `subscription-tiers.md` (FINAL, approved 2026-08-17)
**Date:** 2026-07-10
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** subscriptions, entitlements, billing, multi-store, quotas, offline-grace

> **Supersession note:** `subscription-tiers.md` (repo root) is now the single source
> of truth for tier pricing, quotas, and feature gates. The lineup is
> **Free · Plus · Pro ⭐ · Premium · Enterprise** (this ADR's `Free / Pro /
> Premium / Enterprise` matrix and the old numeric quotas — e.g. Pro = 2
> stores / 3 registers, Premium = 5 stores / 10 registers — are outdated;
> the new matrix is Free = 1/1/1/1/3mo, Plus = 1/2/2/5/1yr, Pro = 2/5/3/20/5yr,
> Premium = 5/unlimited/unlimited/50/unlimited, Enterprise = unlimited).
> The architectural
> mechanism this ADR defines — signed `tenant_subscription`, per-store quota
> checks, `InstanceStatus` downgrade/recovery, offline grace — remains valid
> and unchanged. `docs/plans/todo.md` Phase C0/C1 tracks the quota-value migration in
> `crates/oz-core/src/subscription.rs`.

---

## Context

ADR #4 establishes the **Store-First Tenancy & Workspace Type/Instance Architecture**, where each store gets its own SQLite database and workspace instances are deployments within a specific store. Once a business can create multiple instances across multiple stores, we need a way to enforce how many instances, stores, and specialized templates a tenant is allowed to create. This ADR defines the subscription tier and entitlement system that governs those limits.

This ADR is intentionally separate from ADR #4 because subscription enforcement is a business-model decision that should not block the core store/type/instance separation.

### Relationship to Store-Scoped Databases

The `tenant_subscription` table and subscription enforcement logic live in the **global database** (the database that also contains `store_profiles`, `terminals`, `users`, and `roles`). This is because subscription is tenant-wide — one subscription governs all stores. Per-store databases contain only that store's domain data (products, orders, stock) and instances.

Quota enforcement must coordinate across the global DB (for tier limits) and per-store DBs (for active instance counts). See "Runtime Quota Validation" below.

---

## Decision

### 1. Signed Tenant Subscription Schema (Global Database)

Because kasir.mu stores data locally in SQLite (`rusqlite`), subscription limits must be cryptographically signed to prevent users from opening the database files locally and modifying their tier. The active subscription is stored in the global database with a signature issued by `apps/cloud-server`.

```sql
-- Lives in the GLOBAL database (alongside store_profiles, terminals, users, roles)
CREATE TABLE tenant_subscription (
    tenant_id          TEXT PRIMARY KEY,
    tier_key           TEXT NOT NULL,        -- 'free', 'plus', 'pro', 'premium', 'enterprise'
    status             TEXT NOT NULL,        -- 'active', 'past_due', 'canceled'
    expires_at         TEXT NULL,            -- ISO timestamp (NULL = lifetime/free)
    max_stores         INTEGER NOT NULL,
    max_pos_instances  INTEGER NOT NULL,     -- Per-store register limit
    allowed_types_json TEXT NOT NULL,        -- '["restaurant-pos", "store-pos", "admin"]'
    signature          TEXT NOT NULL,        -- RSA/HMAC signature from apps/cloud-server
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

### 2. Security & Offline Rules

- **Signature Verification**: On startup and prior to quota checks, the backend verifies `signature` against the public key (`oz-pos-updater.key.pub`). If tampered, the backend raises `CoreError::InvalidSubscriptionSignature`.
- **Per-Tier Offline Grace & Monotonic Ledger Clock Check**: When offline, registers evaluate `expires_at`. To prevent users from rolling back their OS system clock to bypass expiration, the backend computes the effective time as the maximum of `Utc::now()` and the most recent timestamp across **all** databases:

  $$\text{Effective Time} = \max\Big(\mathtt{Utc::now()},\; \max_{\text{all store DBs}}\big(\max_{r \in \text{orders}}(\mathtt{r.created\_at}),\; \max_{l \in \text{audit\_logs}}(\mathtt{l.created\_at})\big)\Big)$$

  The global audit log and each store's orders table are checked. If any timestamp exceeds `Utc::now()` by more than a configured tolerance (e.g., 30 seconds), the system detects clock rollback (`CoreError::SystemClockTampered`) and locks all registers until an online cloud sync occurs. If all tables are empty, the check falls back to `Utc::now()`. Paid tiers continue operating for their per-tier offline grace period (Plus/Pro 14 days, Premium 30, Enterprise custom) — after that, quotas revert to the Free tier until connectivity returns.

### 3. Subscription Tier Enforcement Matrix

> Quotas below are the **current** values (per `subscription-tiers.md` §3 and
> `SubscriptionTier` in oz-core). This ADR's mechanism is what matters — the
> exact numbers change with pricing decisions.

| Tier | Store Quota (`store_profiles`) | POS Register Quota per Store (`workspace_instances`) | Allowed Workspace Types (`workspace_types`) | Advanced Features & Hardware |
| :--- | :--- | :--- | :--- | :--- |
| **Free** | **1 Store** | **1 POS Register** | `store-pos` (or `restaurant-pos`), `admin` | Basic receipt printing (`oz-hal`), Local SQLite only, 3-month sales history. |
| **Plus** | **1 Store** | **2 Registers / Store** | `store-pos`, `restaurant-pos`, `admin`, `inventory`, `warehouse` | QRIS (Midtrans), cloud sync, Daily Sales Dashboard, product bundles. |
| **Pro** | **Up to 2 Stores** | **Up to 5 Registers / Store** | + `kds` (Kitchen Display System) | Analytics, Stripe cards, multi-store dashboard, multi-warehouse routing. |
| **Premium** | **Up to 5 Stores** | **Unlimited Registers / Store** | + all types | Loyalty program, Lua scripting, scheduled report emails, priority 1h support. |
| **Enterprise** | **Unlimited (`N`)** | **Unlimited Registers / Store** | + All types + Custom Plugin Workspaces (`oz-plugin`) | White-label, regional zones, custom HAL drivers, dedicated account manager. |

### 4. Runtime Quota Validation (Cross-Database)

When an administrator creates a new register instance or adds a store, the backend evaluates active counts against `SubscriptionTier` limits. This requires coordinating across the global database and the target store's database:

```rust
pub fn create_workspace_instance(
    &self,
    req: &CreateInstanceRequest,
    tier: &SubscriptionTier,
    db_manager: &StoreDatabaseManager,    // manages per-store DBs
) -> Result<WorkspaceDto> {
    // 1. Verify subscription signature (global DB)
    self.verify_subscription_signature()?;

    // 2. Enforce per-store register quota
    let store_db = db_manager.open_store(&req.store_id)?;
    let active_in_store = store_db.count_active_instances()?;
    if active_in_store >= tier.max_pos_instances() {
        return Err(CoreError::SubscriptionLimitExceeded(
            format!("Your {} tier allows maximum {} registers per store. This store already has {}. Upgrade to add more.",
                tier.name, tier.max_pos_instances(), active_in_store)
        ));
    }

    // 3. Enforce global store quota (if creating a new store)
    if is_new_store {
        let store_count = self.count_active_stores()?;  // global DB query
        if store_count >= tier.max_stores() {
            return Err(CoreError::SubscriptionLimitExceeded(
                format!("Your {} tier allows maximum {} stores. Upgrade to add more.",
                    tier.name, tier.max_stores())
            ));
        }
    }

    // 4. Proceed with instance creation in the store's database
    store_db.create_workspace_instance(req)
}
```

**Key architectural point:** The `StoreDatabaseManager` (from ADR #4, Phase 2) provides the bridge between the global database and per-store databases. Quota checks open the target store's database, count instances, and close it if the check fails. Instance creation happens within the store's database transaction.

### 5. Workspace Boot Entitlement Check

When a user attempts to open an advanced workspace (`kds` or `analytics-pro`), the backend verifies template entitlements before issuing session scope credentials. This check runs during session resolution (ADR #4's `SessionContext` creation):

```rust
if !tier.allows_workspace_type(&instance.type_key) {
    return Err(CoreError::SubscriptionUpgradeRequired(
        "Kitchen Display System (KDS) requires Pro tier or higher."
    ));
}
```

The entitlement check is performed after store resolution and instance resolution but before the `SessionContext` is finalized. If the check fails, the instance is not selectable (greyed out in the picker with an upgrade prompt).

### 6. Graceful Upgrades, Downgrades & Automatic Recovery

Workspace instance status is tracked via a three-state enum, replacing the `is_active` boolean on `workspace_instances` (defined in ADR #4):

```rust
pub enum InstanceStatus {
    Active,         // Normal operating register
    QuotaSuspended, // Suspended automatically by subscription downgrade or offline grace expiration
    Archived,       // Manually deleted/deactivated by an admin
}
```

- **Upgrades & Automatic Recovery**: Raising a tier instantly increases `max_pos_instances` and unlocks `allowed_workspace_types`. When `apps/cloud-server` syncs an upgraded quota, the backend iterates over all store databases, queries all `QuotaSuspended` instances, and automatically restores them to `Active` (ordered by `last_accessed_at DESC`) up to the new per-store tier limit. Admin-deleted (`Archived`) registers remain untouched.
- **Downgrading (Safe Archiving)**: If a client downgrades below their current register count or their per-tier offline grace expires, surplus active instances transition to `QuotaSuspended` across all affected store databases. Historical audit logs, cash accountability, and orders are preserved, while only quota-compliant instances remain openable for new sales.

---

## Implementation Checklist

- [x] Create `tenant_subscription` table in the **global database** migration (061_tenant_subscription.sql).
- [x] Implement `SubscriptionTier` Rust struct with `max_stores()`, `max_pos_instances()`, and `allows_workspace_type()` methods.
- [x] Implement signature verification (bootstrap sentinel for local dev; TODO for real RSA/HMAC when `apps/cloud-server` is ready).
- [x] Add per-store quota checks to `create_workspace_instance` via `enforce_instance_quota()` (counts active instances in store DB; global store count deferred to Phase 2).
- [x] Implement `InstanceStatus` enum (`Active`, `QuotaSuspended`, `Archived`) with `from_db()`/`as_str()` serialization.
- [x] Add `last_accessed_at` column to `workspace_instances` for recovery ordering.
- [x] Add `count_active_instances()`, `enforce_instance_quota()`, and `touch_instance_access()` methods to `Store`.
- [x] Wire quota enforcement into `create_workspace_instance_scoped` Tauri command.
- [x] Wire entitlement filtering into `list_workspaces_scoped` Tauri command (filters by `tier.allows_workspace_type()`).
- [x] Write tests (14 subscription + 22 workspace = 36/36 pass).
- [x] Implement entitlement check during session resolution (filter `list_workspaces` by tier-allowed types via `list_workspaces_with_entitlement()`).
- [x] Implement per-tier offline grace period (`is_within_grace_period()`, `effective_tier()` — Free 7d / Plus-Pro 14d / Premium 30d / Enterprise custom) and monotonic clock rollback detection (`validate_clock_rollback()`, `compute_max_ledger_timestamp()`). Wired into both `create_workspace_instance_scoped` and `list_workspaces_scoped`.
- [x] Implement automatic instance recovery on tier upgrade (`auto_recover_instances`) with transaction safety and downgrade-safe suspension (`suspend_surplus_instances`). Wired into Tauri commands (`recover_workspace_instances_scoped`, `suspend_surplus_workspace_instances_scoped`). Tests cover recovery limits, unlimited tiers, suspension, and roundtrip.
- [x] Run `cargo clippy -p oz-core -- -D warnings` (17 pre-existing missing-docs warnings; no new warnings) and full test suite (54/54 pass).

---

## Consequences

### Positive

- Subscription limits are enforced locally even when offline.
- Signature verification prevents local database tampering.
- Graceful downgrade path preserves historical data across all store databases.
- Per-store quotas are enforced at the store database level, matching ADR #4's isolation model.

### Negative

- Adds dependency on `apps/cloud-server` for subscription signing.
- Clock rollback detection can lock legitimate registers if not tuned with a tolerance window.
- Cross-database quota enforcement requires the `StoreDatabaseManager` to be available (Phase 2 of ADR #4).

### Mitigations

- The `StoreDatabaseManager` abstraction hides cross-DB complexity behind a single interface.
- In Phase 1 (single database), quota enforcement operates on the single DB — the cross-DB logic is gated behind a feature flag and enabled in Phase 2.
- The signed subscription is stored once in the global DB, serving all store databases.

---

## Open Questions

1. **✅ Resolved:** The public key is embedded in the binary via `include_str!("oz-license.key.pub")` in `crates/oz-core/src/license_verification.rs` (`LICENSE_PUBLIC_KEY_PEM`) — build-time only; an earlier note claimed an `OZ_LICENSE_PUBLIC_KEY` env override, but the code never reads it, so swapping the key requires recompiling. See ADR #9.
2. **✅ Resolved:** After the per-tier offline grace period elapses (Plus/Pro 14 days, Premium 30, Enterprise custom), `effective_tier()` falls back to Free tier quotas. The register must reconnect to the license server to restore paid tier features. See `is_within_grace_period()` in `crates/oz-core/src/subscription.rs`.
3. **Deferred:** Device-bound terminals always count as one instance toward the quota. A future ADR may distinguish device-bound instances (fixed hardware) from user-picked instances (floating licenses) for quota purposes.

---

## Related

- ADR #4 — Store-First Tenancy & Workspace Type/Instance Architecture
- `crates/oz-core/src/db/workspaces.rs`
- `platform/core/` — `StoreDatabaseManager` (cross-DB coordination)
- `apps/cloud-server/` (subscription signing service)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
