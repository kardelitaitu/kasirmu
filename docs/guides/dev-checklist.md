# Development Checklist — kasir.mu Desktop

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (5 findings) · SUPERSEDES the 2026-08-31 stamp, whose verification was sound when made — has_users (commands/auth.rs:615, registered in lib.rs, ui/src/api/staff.ts:76 hasUsers(), mock at ui/src/dev-mock/tauri-api.ts:1920) and the eight gate/quota screens all still resolve. What changed underneath it is three refactors in eight days, one of them today: 10260a035 + c9d0ec95f (2026-09-06) renamed store->location through kasirmu-core, 54470e277 (2026-09-07) renamed the caps wire field max_stores->maxLocations, and 1b3e71798 (2026-09-08) landed the entitlement consolidation that turned the dev override into Entitlements::apply_debug_upgrade(). Repaired: (1) dev-mock path was written dev-mock/tauri-api.ts, it is ui/src/dev-mock/tauri-api.ts; (2) §2a described the Free->Premium upgrade as a #[cfg(debug_assertions)] block in subscription.rs — it is a named method in crates/kasirmu-core/src/entitlements.rs:102 with three runtime predicates, it promotes ONLY an Active Free row so expired/canceled/paused stay testable in dev, and it is desktop-only because the tablet never passes debug_upgrade; (3) §2a quota field list said max_stores, now max_locations; (4) §2b's mock block was hand-rewritten and had drifted from the shipped handler — it lacked state:'active' and used maxStores/storeCount, now quoted verbatim from tauri-api.ts:2089; (5) §2d's TopologyScreen row gated on caps.storeCount >= caps.maxStores, now caps.locationCount >= caps.maxLocations, and the screen lives in features/locations/. The lesson is not that the audit was sloppy: a repo-wide rename with no docs sweep silently invalidates every checklist that names the renamed fields, and nothing in CI catches it. get_license_status and check_license_status mock returns re-verified accurate. -->

A checklist to ensure the app is fully functional during development. Run through this after any DB migration, subscription tier change, or dev-mock update.

---

## 1. First-Run Bootstrap Flow

The app must handle a **fresh database** gracefully.

- [ ] **`has_users` IPC exists** — `apps/desktop-client/src/commands/auth.rs` exposes a `has_users` command that returns `{ has_users: bool }` by checking `Store::list_users()`.
- [ ] **Registered in invoke_handler** — `has_users` is listed in `lib.rs` `generate_handler![]`.
- [ ] **UI wrapper exists** — `ui/src/api/staff.ts` exports `hasUsers()`.
- [ ] **AppShell checks on startup** — `AppShell.tsx` calls `hasUsers()` and shows `CreatePinScreen` when `hasAnyUsers === false`, bypassing the license/setup gate.
- [ ] **dev-mock has handler** — `ui/src/dev-mock/tauri-api.ts` returns `{ has_users: true }` (line 1920; the mock always has seeded staff). The path here used to read `dev-mock/tauri-api.ts`, which resolves to nothing — the mock lives under `ui/src/`, not beside it.
- [ ] **`bootstrap_owner` works end-to-end** — `CreatePinScreen` → `bootstrap_owner` → argon2 hash → user row created → `swapSession` → user lands on workspace picker.

## 2. Subscription Tier & Feature Gates

Features are gated by the `get_subscription_capabilities` IPC. The dev database starts with a **Free** tier bootstrap row.

### 2a. Rust Backend (`crates/kasirmu-core/src/entitlements.rs`, projected by `apps/desktop-client/src/commands/subscription.rs`)

- [ ] **Debug override** — `Entitlements::apply_debug_upgrade()` at
  `crates/kasirmu-core/src/entitlements.rs:102`. Three things this checklist got wrong until
  08-09-26, all of which matter when you are testing gates:
  1. It is **not** a `#[cfg(debug_assertions)]` block around the capability projection.
     `cfg!(debug_assertions)` is one of three runtime predicates *inside a named method*,
     alongside `state == Active` and `tier == Free`.
  2. It promotes **only a genuinely `Active` Free row**. Expired, canceled, paused and
     unavailable subscriptions keep their downgraded answer **even in dev** — deliberate,
     so the failure paths stay exercisable. If you are checking "does the gate hold", a
     dev build will not automatically hide the answer.
  3. It is **desktop-only**. The caller passes `debug_upgrade: true`
     (`commands/subscription.rs:143`); the tablet never calls it. That divergence is
     preserved on purpose by the consolidation design, and the tablet caps gap is
     recorded as its owner's separate task — so a feature that works under `cargo tauri
     dev` on desktop can still be correctly gated off on tablet.
- [ ] **All capability fields use the overridden `tier`** — Every field (`supportsAnalytics`, `supportsLoyalty`, `supportsQris`, `supportsDailyDashboard`, etc.) must read from the overridden `tier` variable, NOT from the original `sub` object. (Previously `supports_analytics` used `sub.supports_analytics_with_addons()` which bypassed the override.)
- [ ] **Quota fields use the overridden tier** — `max_locations` (was `max_stores` before the store→location rename; the JSON wire name on the TS side is still `maxLocations`, see §2b), `max_pos_instances`, `max_warehouses`, `max_staff_users`, `sales_history_days`, `offline_grace_days` all come from `tier.method()`.

### 2b. Dev-Mock (`ui/src/dev-mock/tauri-api.ts`)

- [ ] **`get_subscription_capabilities` exists** — Returns Premium-tier caps:
  ```ts
  // verbatim from ui/src/dev-mock/tauri-api.ts:2089, one field per line as shipped
  'get_subscription_capabilities': () => ({
    tier: 'premium',
    state: 'active',          // this field was missing from the block until 08-09-26
    maxLocations: null,       // was maxStores. The store->location rename took the
                              // quota with it; ui/src/api/subscription.ts:33 records
                              // that the wire name stays maxLocations on purpose.
    maxPosInstances: null,
    maxWarehouses: null,
    maxStaffUsers: null,
    salesHistoryDays: null,
    supportsQris: true,
    supportsAnalytics: true,
    supportsLoyalty: true,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 30,
    locationCount: 1,         // was storeCount
    staffCount: 1,
    terminalCount: 1,
    addons: [],
  }),
  ```
- [ ] **`get_license_status` returns active** — Returns `{ isActive: true, status: 'valid', tier: 'pro', ... }`.
- [ ] **`check_license_status` returns active** — Returns `{ status: 'active', tier: 'Pro', active: true, ... }`.

### 2c. UI Feature Gates (5 screens)

| Screen | Gate check | Unlocked when |
|--------|-----------|---------------|
| `AnalyticsScreen.tsx` | `caps && !caps.supportsAnalytics` | `supportsAnalytics: true` |
| `LoyaltyManagementScreen.tsx` | `caps && !caps.supportsLoyalty` | `supportsLoyalty: true` |
| `DailyTotalWidget.tsx` | `caps && !caps.supportsDailyDashboard` | `supportsDailyDashboard: true` |
| `SetupWizard.tsx` | `!!caps && !caps.supportsQris` | `supportsQris: true` |
| `PaymentModal.tsx` | `caps && !caps.supportsQris` | `supportsQris: true` |

**Key behavior**: When `caps` is `null` (loading/error), `caps && !caps.supportsX` evaluates to `false` — features render **open**, not locked. This is the correct fallback.

### 2d. Quota Limit Checks (3 screens)

| Screen | Gate check | Unlocked when |
|--------|-----------|---------------|
| `TerminalManagementScreen.tsx` | `caps.terminalCount >= caps.maxPosInstances` | `maxPosInstances: null` (unlimited) |
| `TopologyScreen.tsx` (lives in `ui/src/features/locations/`, not `stores/`) | `caps.locationCount >= caps.maxLocations` | `maxLocations: null` (unlimited) |
| `StaffManagementScreen.tsx` | `caps.staffCount >= caps.maxStaffUsers` | `caps.tier === 'premium'` check for approaching limit |

## 3. AppShell Startup Flow

```
DEV mode:
  hasCompletedSetup = true, hasActiveLicense = true
  hasUsers() → false → Show CreatePinScreen
  hasUsers() → true  → Show StaffLoginScreen

Production:
  getSetupStatus + getLicenseStatus
  hasUsers() → false → Show CreatePinScreen (first-run)
  hasUsers() → true  → Check license → SetupWizard or StaffLoginScreen
```

- [ ] **DEV bypass does not skip user check** — `hasUsers()` is called even when `hasCompletedSetup = true`.
- [ ] **Production path checks users** — `hasUsers()` is called in the `Promise.all` startup block.

## 4. Dev-Mock Completeness

The dev-mock (`ui/src/dev-mock/tauri-api.ts`) must cover every IPC command the UI calls. Commands missing from the mock cause silent failures in browser preview.

### Commands in Rust but **missing from dev-mock** (3 — all internal-only):

**Internal-only (never called by UI — safe to skip):**
- [ ] `recover_pending_topology_apply_at_startup` — startup topology recovery
- [ ] `settings_changed_sink` — internal event bridge
- [ ] `recover_workspace_instances_scoped` — workspace recovery

## 5. Quick Verification Script

After making changes, run this mental checklist:

```bash
# 1. Rust compiles
cargo check -p oz-pos-app

# 2. UI tests pass
cd ui && npx vitest run

# 3. App starts fresh
#    - Delete or rename kasir.db to test fresh DB flow
#    - App should show CreatePinScreen (not StaffLoginScreen)
#    - Bootstrap owner with username "owner" / PIN "1234"
#    - After bootstrap, workspace picker appears with demo workspaces

# 4. Features accessible
#    - Analytics screen shows charts (not "Pro feature" lockout)
#    - Loyalty screen shows tier management (not locked)
#    - Daily Sales Dashboard renders (not blurred teaser)
#    - QRIS toggle available in Setup Wizard

# 5. Login works
#    - Username "owner" / PIN "1234" logs in
#    - Rate limiter locks after 3 failed attempts
#    - Session creates and workspace selection works
```

## 6. Common Pitfalls

| Pitfall | Root cause | Fix |
|---------|-----------|-----|
| "Analytics is a Pro feature" on fresh install | `get_subscription_capabilities` returns Free tier; `supports_analytics` reads from original `sub` object instead of overridden `tier` | Use `tier.supports_analytics()` not `sub.supports_analytics_with_addons()` |
| Login fails with "invalid username or PIN" | Owner account doesn't exist; `CreatePinScreen` was never shown because DEV mode skips activation flow | Add `has_users` check in AppShell; show `CreatePinScreen` when no users exist |
| Browser preview shows locked features | `get_subscription_capabilities` missing from dev-mock; `caps` stays `null` but some gates don't handle null correctly | Add `get_subscription_capabilities` to dev-mock returning Premium caps |
| Workspace picker shows "No workspaces" | `list_workspaces` fails because picker ticket is invalid or DB has no workspace instances | Fallback to `FALLBACK_WORKSPACES` (already implemented in WorkspaceContext) |
| `platform-sync` won't compile | `PgTransport::new` signature changed (added `tenant_id`) but call site not updated | Pass `tenant_id` to `PgTransport::new` in `pg_daemon.rs` |
| Warehouse workspace shows old product list | Workspace-to-route mapping still points to `inventory` instead of `warehouse` | Change `warehouse: 'inventory'` → `warehouse: 'warehouse'` in AppShell |
| Home screen opens wrong page (e.g. analytics instead of settings) | Stale `#/analytics` hash from shortcut persists across workspace switches | Clear hash after consuming it in AppShell workspace routing effect |
| Home screen looks like old settings page | WorkspaceHome renders stale analytics/reports shortcuts inline instead of using tools section | Ensure WorkspaceHome uses `.workspace-home-content` with two `.workspace-section` divs (Workspaces + Tools) |

> last audited 08-09-26 by docs-auditor
