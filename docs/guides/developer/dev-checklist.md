<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (3 findings) · Supersedes the 2026-09-29 marker below, kept verbatim. Repaired in §2c/§2d, which claim specific gate expressions per screen: (1) §2c listed a fifth screen `SetupWizard.tsx`, which does not exist in `ui/src` (only `docs/plans/_done/done-mobile-setupwizard.md`), and it is removed — the qris gate the row described belongs to the `PaymentModal.tsx` row already present; (2) `PaymentModal.tsx`'s gate was quoted `caps && !caps.supportsQris` but the code's expression is the inverse `!caps || caps.supportsQris` (`:1909`, a `qrisAllowed` prop); (3) §2d's third row named `StaffManagementScreen.tsx` reading `maxStaffUsers`, which no production screen reads — the two real quota checks (`TerminalManagementScreen.tsx:164`, `TopologyScreen.tsx:547`) are now the whole list, and the staff question is flagged rather than invented. Every surviving row now names file:line. · Repaired against branch `0.0.41` at `134aaed1b`. -->
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 164 lines, with a prior marker re-verified rather than replaced. A developer checklist is a live procedure, so the audit question is whether its steps would work if followed today. · THE STRUCTURAL POINT WORTH RECORDING, because it is the kind of thing that compounds silently: this file is a checklist of commands, and the commands age at a different rate from the prose around them. Re-running every step would mean a full build and test cycle, which is not a documentation task — so this pass checked the class of reference the checklist depends on and recorded the result honestly. Where a step names a pre-restructure path, that is the normal consequence of the crate and shell renames recorded throughout this campaign, and a checklist sits in the middle ground the changelogs do not: a changelog is history and must not be updated, while a checklist is instructions, and a dead path in it costs a reader a failed command. That distinction is why checklists have been repaired this campaign and changelogs preserved intact. · WHAT IS NOT RE-MEASURED, and the limit is inherent: whether each listed step still passes, whether the ordering is still right, and whether anything new should be listed. A checklist is only as current as its last full run by someone with the tree built, and this pass does not have that. What is recorded is the state of the file, not a claim that the checklist is current — a distinction worth making explicit, because a reader is entitled to know which of the two they are getting. · Prior marker retained as original evidence; footer re-dated to match the new stamp. -->
# Development Checklist — kasir.mu Desktop

<!-- Superseded audit marker (2026-09-08 · DSH, body kept verbatim) · retained · status: ACCURATE after repair (5 findings) · SUPERSEDES the 2026-08-31 stamp, whose verification was sound when made — has_users (commands/auth.rs:615, registered in lib.rs, ui/src/api/staff.ts:76 hasUsers(), mock at ui/src/dev-mock/tauri-api.ts:1920) and the eight gate/quota screens all still resolve. What changed underneath it is three refactors in eight days, one of them today: 10260a035 + c9d0ec95f (2026-09-06) renamed store->location through kasirmu-core, 54470e277 (2026-09-07) renamed the caps wire field max_stores->maxLocations, and 1b3e71798 (2026-09-08) landed the entitlement consolidation that turned the dev override into Entitlements::apply_debug_upgrade(). Repaired: (1) dev-mock path was written dev-mock/tauri-api.ts, it is ui/src/dev-mock/tauri-api.ts; (2) §2a described the Free->Premium upgrade as a #[cfg(debug_assertions)] block in subscription.rs — it is a named method in crates/kasirmu-core/src/entitlements.rs:102 with three runtime predicates, it promotes ONLY an Active Free row so expired/canceled/paused stay testable in dev, and it is desktop-only because the tablet never passes debug_upgrade; (3) §2a quota field list said max_stores, now max_locations; (4) §2b's mock block was hand-rewritten and had drifted from the shipped handler — it lacked state:'active' and used maxStores/storeCount, now quoted verbatim from tauri-api.ts:2089; (5) §2d's TopologyScreen row gated on caps.storeCount >= caps.maxStores, now caps.locationCount >= caps.maxLocations, and the screen lives in features/locations/. The lesson is not that the audit was sloppy: a repo-wide rename with no docs sweep silently invalidates every checklist that names the renamed fields, and nothing in CI catches it. get_license_status and check_license_status mock returns re-verified accurate. -->

A checklist to ensure the app is fully functional during development. Run through this after any DB migration, subscription tier change, or dev-mock update.

---

## 1. First-Run Bootstrap Flow

The app must handle a **fresh database** gracefully.

- [ ] **`has_users` IPC exists** — `apps/desktop-tauri/src/commands/auth.rs` exposes a `has_users` command that returns `{ has_users: bool }` by checking `Store::list_users()`.
- [ ] **Registered in invoke_handler** — `has_users` is listed in `lib.rs` `generate_handler![]`.
- [ ] **UI wrapper exists** — `ui/src/api/staff.ts` exports `hasUsers()`.
- [ ] **AppShell checks on startup** — `AppShell.tsx` calls `hasUsers()` and shows `CreatePinScreen` when `hasAnyUsers === false`, bypassing the license/setup gate.
- [ ] **dev-mock has handler** — `ui/src/dev-mock/tauri-api.ts` returns `{ has_users: true }` (line 1920; the mock always has seeded staff). The path here used to read `dev-mock/tauri-api.ts`, which resolves to nothing — the mock lives under `ui/src/`, not beside it.
- [ ] **`bootstrap_owner` works end-to-end** — `CreatePinScreen` → `bootstrap_owner` → argon2 hash → user row created → `swapSession` → user lands on workspace picker.

## 2. Subscription Tier & Feature Gates

Features are gated by the `get_subscription_capabilities` IPC. The dev database starts with a **Free** tier bootstrap row.

### 2a. Rust Backend (`crates/kasirmu-core/src/entitlements.rs`, projected by `apps/desktop-tauri/src/commands/subscription.rs`)

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

### 2c. UI Feature Gates (4 screens)

Re-verified 2026-10-08. The prior version listed a fifth row for `SetupWizard.tsx`, which **does not exist** in `ui/src` (the only path by that name is the plan doc `docs/plans/_done/done-mobile-setupwizard.md`), and quoted `PaymentModal.tsx`'s gate as `caps && !caps.supportsQris` when the code's own expression is the inverse, `!caps || caps.supportsQris` (`PaymentModal.tsx:1909`, a `qrisAllowed` prop). Both are corrected below; each row now names the file and line the expression is read at.

| Screen | Gate check | Unlocked when |
|--------|-----------|---------------|
| `analytics/AnalyticsScreen.tsx:532` | `caps && !caps.supportsAnalytics` | `supportsAnalytics: true` |
| `loyalty/LoyaltyManagementScreen.tsx:161` | `caps && !caps.supportsLoyalty` | `supportsLoyalty: true` |
| `sales/widgets/DailyTotalWidget.tsx:52` | `caps && !caps.supportsDailyDashboard` | `supportsDailyDashboard: true` |
| `sales/PaymentModal.tsx:1909` | `qrisAllowed={!caps || caps.supportsQris}` | `supportsQris: true` |

**Key behavior**: When `caps` is `null` (loading/error), `caps && !caps.supportsX` evaluates to `false` — features render **open**, not locked. This is the correct fallback. (`PaymentModal` writes the same rule from the other side: `!caps || …` is true when caps are absent, so the tender stays available.)

### 2d. Quota Limit Checks (2 screens)

Re-verified 2026-10-08. The prior version's third row named `StaffManagementScreen.tsx` with `caps.staffCount >= caps.maxStaffUsers`, but that screen does not read `maxStaffUsers` at all (the only hits are its test file and the dev-mock). The two quota checks that ARE in the tree are below, both written as `caps !== null && caps.<count> !== null && caps.<count> >= caps.max<Quota>`.

| Screen | Gate check | Unlocked when |
|--------|-----------|---------------|
| `terminals/TerminalManagementScreen.tsx:164` | `caps !== null && caps.maxPosInstances !== null && caps.terminalCount >= caps.maxPosInstances` | `maxPosInstances: null` (unlimited) |
| `locations/TopologyScreen.tsx:547` | `caps !== null && caps.maxLocations !== null && caps.locationCount >= caps.maxLocations` | `maxLocations: null` (unlimited) |

> Whether the **staff** quota is surfaced in a screen at all is left open rather than invented here: `maxStaffUsers` exists on the caps type (`ui/src/api/subscription.ts:65`) and is exercised by `StaffManagementScreen.test.tsx`, but no production screen reads it in this tree. Flagged for the owner — do not re-add a row without a file:line.

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
cargo check -p kasirmu-app

# 2. UI tests pass
cd ui && npx vitest run

# 3. App starts fresh
#    - Delete or rename the store to test fresh DB flow. The desktop app
#      resolves it to app_data_dir()/kasir.db (mu.kasir.app, so on Windows
#      %APPDATA%\mu.kasir.app\kasir.db) — NOT the repo root. The repo root
#      holds nothing: the CLI and the matrix default to var/kasir.db.
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

> last audited 08-10-26 by docs-auditor
