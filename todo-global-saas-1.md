# Global SaaS POS — Phase 1: P0 Platform Foundations

Created 2026-09-05 from the Tools-category design review. Phase 1 of 3.
Sibling phases:
[`todo-global-saas-2.md`](./todo-global-saas-2.md) (Phase 2 — P1 product
maturity) · [`todo-global-saas-3.md`](./todo-global-saas-3.md) (Phase 3 —
P2 scale & operations).

This file carries the shared contract every phase must preserve (current
baseline, core access contract, canonical hierarchy, adopted target policy,
and the decisions list) plus the Phase 1 work list: the P0 foundations that
make the platform safe to call multi-tenant. Phase 1 gates the full Tools
redesign ([`todo-tools.md`](./todo-tools.md)).

Supersedes the single-file `todo-global-saas.md` (split into phases
2026-09-05). The Tools IA is tracked separately in `todo-tools.md`.

## Current baseline

- Home navigation is grouped into Operations, Insights, and Configuration.
- Subscription tiers are Free, Plus, Pro, Premium, and Enterprise. A `OneTime`
  perpetual-license tier also exists in code and follows the Free grace policy.
- Roles are hierarchical and known-role-gated: auditor → staff → manager →
  admin → owner.
- Topology models locations, terminal workspace runtimes, and hardware with
  typed relationships.
- The product is offline-first and has local signed subscription data plus an
  authoritative license-server status endpoint.
- Page access and action access are intentionally separate: a user may view a
  page while a quota or entitlement blocks a mutation.

## Core access contract

Authorize each request using:

```text
subject + permission + scope + resource + entitlement
```

Every page or action should eventually be evaluated with all of these inputs:

```ts
access: {
  minimumRole: 'manager',
  minimumTier: 'pro',
  permission: 'memo:write',
  scope: 'location',
}
```

A page-level decision must not replace action-level enforcement. Every mutation
must independently check permission, scope, quota, entitlement, and resource
state.

## Canonical business hierarchy (decision, 2026-09-05)

The minimum global SaaS model includes a first-class Legal Entity:

```text
Organization / Tenant
├── Legal Entities
│   └── Locations
│       ├── Terminals / Devices
│       │   └── Workspace instances / runtime contexts
│       │       └── retail-pos · resto-pos · kds · warehouse
│       └── Local configuration
├── Users / Staff identities
│   └── Scoped role assignments
├── Subscription / Entitlements
└── Topology graphs
    └── Operational relationships over owned resources
```

Rules:

- **Legal Entity is required now.** It owns or scopes tax registrations,
  fiscalization, invoices, payment accounts, legal business identity, and
  statutory reporting. A small customer may have one Legal Entity, but the model
  must support multiple entities inside one Organization.
- **One commercial account maps to one Organization.** Billing, subscription,
  quotas, and tenant isolation are Organization-level. Human users are
  memberships with scoped assignments; multi-Organization user switching is a
  later capability, not a second hierarchy layer.
- **Brand and Region are optional future grouping entities.** Do not add them to
  the core ownership chain until multi-brand or regional management requires
  them.
- **Users are not simple children of Locations.** A user identity is assigned a
  role and explicit scope, allowing one user to work across multiple locations.
- **Terminals are owned by the Organization and assigned to a Location.** A
  terminal is a physical device/installation with an active workspace runtime
  context. The four current workspace types are `retail-pos`, `resto-pos`,
  `kds`, and `warehouse`; `warehouse` is a workspace type, not a separate
  hierarchy resource.
- **Topology is a graph over the hierarchy, not the hierarchy itself.** The
  topology editor describes operational relationships between already-owned
  resources. Tenant, Legal Entity, Location, Workspace, and Terminal ownership
  must remain explicit in persisted data and authorization checks.
- **Resources such as tax profiles, payment accounts, hardware, and inventory
  stock points are scoped resources, not additional universal hierarchy levels.**
  The `warehouse` workspace type is a terminal runtime context, not a separate
  warehouse resource.

## Resource cardinality (from former §2)

- One Organization owns one or more Legal Entities.
- Each Location belongs to exactly one Legal Entity.
- Each Workspace Instance belongs to exactly one Location and represents a
  terminal runtime context.
- Each Terminal belongs to one Organization and has one current Location.
- A Terminal has one active Workspace assignment at a time; the current
  workspace type is one of `retail-pos`, `resto-pos`, `kds`, or `warehouse`.
- Workspace assignments may be changed without redefining the Location or
  Terminal ownership relationship; history must be retained where reassignment
  is persisted.
- Users may have multiple role assignments across scopes.
- One active subscription/entitlement set belongs to the Organization.
- One active topology graph exists per Location.

## Adopted target policy (recommendations selected, 2026-09-05)

These recommendations are now the working proposal for implementation. They
remain subject to the user's later manual review, but new design and code work
should use them as the default contract rather than reopening the same
questions. Sections C, D, J and the domain specs they implement live in the
Phase 2 file; §K lives in the Phase 3 file.

### A. Offline Queue placement and access

Keep the canonical configuration path at `Settings > Data & Sync`, but add an
operational shortcut from `Operations > Terminals` or `System Health`:

- terminal operators can see the health and queue state of their current
  terminal;
- managers can see queue summaries for locations within their assignment scope;
- admins and owners can inspect organization-wide details and perform
  administrative actions;
- queue payload inspection and retry/discard actions require the appropriate
  scoped permission and must not be granted by page visibility alone.

This preserves Settings as the configuration home while keeping an operational
failure discoverable to the people who need to resolve it.

### B. Subscription authority and offline grace

Use the license server as the authority and a signed local snapshot for offline
continuity. The server and client must share one normalized contract for
`loading`, `active`, `grace`, `expired`, `canceled`, `paused`, and
`unavailable`. Missing or invalid data fails closed for gated administrative
features.

Target behavior:

- administrative SaaS features lock at `expiresAt`: Analytics, Reports, Audit
  Log, Memo, Promotions, Data Management, Topology editing, and premium
  Settings sections;
- approved POS operational runtime may continue through the tier's signed
  grace window: Free/OneTime 7 days, Plus 14, Pro 14, Premium 30, Enterprise 60;
- server cancellation or revocation takes effect immediately when received;
- unavailable or invalid subscription data fails closed for tier-gated
  administrative features;
- grace never grants new premium access, quota increases, or new resource
  creation;
- Free remains free forever; its seven-day value is offline verification
  continuity, not plan expiration;
- Standard Enterprise uses 60 days, with signed custom Enterprise overrides
  when a contract requires them;
- when the grace window expires while still offline, POS runtime locks to a
  read-only state: no new sales, order mutations, or sync queueing — only data
  export, viewing, and sign-out remain available. It reopens automatically once
  connectivity returns and a valid subscription is verified.

The pricing page, auth/license server, local Rust implementation, and UI must
be reconciled to this same contract before launch.

### E. Quota model

Make quotas server-issued and organization-aware, with these dimensions:

- locations: organization-wide;
- terminals: per location;
- workspace instances and KDS screens: per location;
- staff identities: organization-wide, with scoped assignments;
- inventory stock points: legal-entity or location scope;
- products and catalog records: organization-wide;
- sales history and audit retention: entitlement/data-retention policy;
- topology edges and graph revisions: per location;
- scoped resources — payment accounts, tax profiles, and hardware profiles —
  are quota-visible in §E but follow their owning scope (legal entity or
  location); they never become hierarchy levels themselves.

Every create, register, publish, or expansion mutation performs an atomic quota
check. Existing resources are never silently deleted after downgrade; they are
marked `over_quota`, remain readable, and block only new creation or expansion.
Exact numeric limits should be configuration data from the license server and
must be verified against the public pricing plans.

### F. Permissions, scopes, and custom roles

Keep built-in role bundles for manager, admin, and owner, with higher roles
inheriting lower-role permissions. Add explicit permissions such as
`location:read`, `location:write`, `terminal:register`, `topology:write`,
`memo:write`, `reports:view`, and `settings:write`.

Organization scope inherits to descendants; location scope does not cross into
another location. Do not add deny rules initially; use explicit allow
assignments with the narrowest practical scope (merged from former §1).

Custom roles should use explicit permission sets and explicit scopes rather than
numeric hierarchy levels. Unknown roles deny by default. A role assignment may
optionally have an effective start/end date, and all permission checks must
resolve the user's assignment against the target resource before checking the
subscription entitlement.

### G. Legal Entity migration

When introducing Legal Entity to existing data, automatically create one
`Default Legal Entity` for each existing Organization and move its current
Locations beneath it. Preserve stable IDs, record the migration, and allow an
owner to rename or split the entity later. Do not require a multi-entity setup
for small customers.

### H. Settings scope map

Use the following default scopes:

- General, License & Subscription, Features & Modules, and Security & Account:
  organization;
- Business Defaults: location, with organization defaults inherited;
- Tax Configuration and fiscalization: legal entity/location;
- Payment Accounts and tax profiles: scoped resources owned at legal-entity or
  location level, matching the Tax Configuration scope — never
  organization-global;
- Exchange Rates: organization/legal entity, with location display overrides;
- POS Behavior: workspace, with location defaults;
- Devices & Connectivity: terminal, workspace, or location depending on the
  device;
- Data Management: organization, subject to scoped export/delete permissions;
- Sync Status: organization summary with location/workspace/terminal drill-down;
- Offline Queue: terminal-local details with scoped location/organization
  summaries;
- System Diagnostics: the currently selected organization, location,
  workspace, or terminal context.

### I. Topology permissions and publishing (merges former §5 and §I)

Use a dedicated `topology:write` permission instead of `staff:update`. A
centralized mutation authorizer checks role, permission, location scope,
quota, entitlement, revision/concurrency, and semantic graph validation for
Apply, location creation, rename, templates, and property edits. Unauthorized
users may view topology read-only.

Treat topology edits as a draft revision. Apply should require validation, a
human-readable diff, optimistic concurrency protection, and an explicit publish
boundary. Store revision history and support rollback to the last valid
revision. Topology may connect owned resources, but it must never create an
implicit ownership or authorization relationship.

## Spec details carried from the recommendations (former §1–15)

### Subscription snapshot fields (from former §3)

The license server is authoritative. The POS may cache a signed snapshot for
offline operation, containing plan, status, features, quotas, add-ons,
`issued_at`, `expires_at`, `grace_until`, and an entitlement version.

### Backend quota enforcement (from former §6)

Backend mutations are authoritative. Initial quota scopes are organization-wide
for locations, staff, products, and sales history; terminals, workspace
instances, and KDS screens are limited per location (per §E above, which
supersedes the organization-wide KDS scope first proposed here). Concurrent
creates require transactional or serialized quota checks. Existing resources
are preserved and marked `over_quota` rather than silently deleted; new
creation is blocked until remediation.

### Tenant isolation (from former §8)

Every query and cache lookup is tenant-derived from authenticated context, never
from an untrusted client tenant selector. Isolation tests must cover locations,
topology, sync queues, audit events, Memos, exports, backups, and subscription
caches. Cache keys include tenant and relevant scope IDs.

## Terminology — Store → Location (decision, 2026-09-05)

The pre-plan hierarchy used `account(tenant) → Store → {workspaces, terminals,
local configuration}`. The canonical term for the physical site unit is now
**Location**; "Store" is retired for the site unit everywhere except the
explicitly documented runtime/data-store exceptions below. All phase work is
written against the new name — new code must not introduce `store` for the
site unit.

| Old | New | Notes |
| --- | --- | --- |
| Store (site unit) | **Location** | Hierarchy: Organization → Legal Entity → Location; owns terminals, their workspace runtimes, and local configuration. |
| `max_stores`, `storeCount`, `enforce_store_quota` | `max_locations`, `locationCount`, `enforce_location_quota` | Quota fields in the signed license payload, Rust DTOs, and UI capabilities — rename with a versioned license-server payload migration. |
| Stores admin screen / `stores` route | Locations screen / `locations` route | UI route, nav, home tool card, FTL keys. |
| Pricing page "Stores" row | "Locations" | Website copy plus the `pricing-content-invariants` label assertions. |
| Workspace types `retail-pos`, `resto-pos`, `kds`, `warehouse` | **unchanged** | Runtime workspace types hosted by or opened on a terminal, not site-unit names. Never blanket-replace `warehouse` with `location`. |
| `inventory_locations` (stock points) | **unchanged for now** | A different concept: stock storage points (`store`/`warehouse`/`transit`/`damaged`/`virtual`) inside a Location's inventory model. The name collision with the `warehouse` workspace type and site Locations is acknowledged — UI labels stock points as "Stock location"; schedule a follow-up rename (`inventory_stock_points`) only if confusion appears in practice. |

The rename itself is the first P0 implementation task below: a mechanical,
gate-verified migration. Do not bundle it with the Legal Entity migration —
sequence the rename first so the §G hierarchy migration runs on the final
names.

### Rename execution journal (2026-09-06)

Scope findings from the pre-implementation investigation, in execution order:

- **THIRD homonym discovered — `Store<'a>` is the DB facade.** `oz-core`
  `db/mod.rs:163` defines `pub struct Store<'a>` as the typed CRUD wrapper
  over a SQLite `Connection` (its own doc comment says "Typed CRUD facade").
  It is NOT the site unit. **Out of scope — do not rename.** The
  Terminology table's exceptions are three distinct concepts:
  1. workspace-type keys (runtime and tier gating; legacy code may still use
     `store-pos` / `restaurant-pos` identifiers);
  2. `inventory_locations` stock points (`type = 'store'` is one of five
     stock-point kinds);
  3. `Store<'a>` DB facade (data-store wrapper).
  A blanket find/replace is therefore forbidden; the rename is
  identifier-enumerated, not pattern-based.
- **`store_profiles` is the site-unit table** (migration `20260813_init.sql`
  line ~797; originally `025_store_profiles.sql`): `id` (`"default"` primary
  + UUIDs), `name`, `address`, `tax_id`, `currency`, `timezone`,
  `is_primary`. `user_store_access` (user_id, store_id FK, access_level) is
  its per-user ACL. The admin nav entry lives in `workspace_screens`
  (`('admin', 'stores', 13)` seed row). Cloud **PG init folds all later
  migrations into `20260813_init.pg.sql`** — both the SQLite init and the PG
  init must be edited, not just new migration files.
- **Rename surfaces mapped**: `crates/oz-core` (`store_profile.rs`,
  `db/mod.rs` region, `db/store_profile` repo if present), `apps/
  desktop-client/src/commands/store_profiles.rs` (308 lines, 7 scoped IPC
  commands + DTOs) + `store_profiles_tests.rs`, `apps/tablet-client`
  (subscription count query, terminals FK comment/tests, workspaces boot
  resolution), `apps/cloud-server` (sync tests), IPC parity allowlist (7
  command names) + dev-mock (`ui/src/dev-mock/tauri-api.ts`) + dev-mock
  scoped-alias tests, `ui/src/api/stores.ts`, `ui/src/features/stores/`
  (register.tsx + screen), `WorkspaceHome` tool card (`id: 'stores'`, route,
  minRole), `ui/src/locales/multi-store.ftl` + siblings (≈131 `store` hits
  across 16 FTL files — enumerate keys, don't blind-replace), IPC command
  names in `local_api.rs`, branding (`set_brand_store_name` — rename to
  `set_brand_location_name`), `list_workspaces_for_store_scoped`.
- **Wire format de-risked**: the client verifies the RSA signature over the
  raw stored `signed_payload` bytes and reads `max_stores` from the local
  `tenant_subscription` DB column — NOT from the payload JSON. So the Rust
  local rename is safe **without** a Go wire-format change in the same step;
  the Go server keeps emitting `max_stores` until its own task renames the
  wire field with a versioned payload migration (license-server + admin
  dashboard + any server-side tests). Split: local rename now, wire rename
  follows. (Wire rename has now landed — see the 1g entry below; the
  dual-emit + dual-read it shipped is the "versioned payload migration"
  resolved into a concrete compat design.)
- **Quota enforcement path**: `store.enforce_store_quota(&tier)` in
  `store_profiles.rs:202`, `enforce_staff_quota` in `staff.rs`,
  `max_stores()` in `subscription.rs:137` (`Free/OneTime/Plus=1, Pro=2,
  Premium=5, Enterprise=None`) — rename `max_stores()` → `max_locations()`
  and the enforce fn, keep numeric values identical (pricing parity
  untouched).
- **UI-side `storeCount`** in `SubscriptionCapabilities` mirrors the Rust
  `SubscriptionCapabilitiesDto` (`store_count`) — rename both sides of the
  IPC DTO together (`locationCount` / `location_count`), plus test mocks
  (`ui/src/__tests__/test-utils/mocks/subscriptionCaps.ts`) and every
  consumer.

### Implementation journal

- [x] **2026-09-06 — Schema rename sub-step completed.** Added and registered
      `20260906_rename_store_to_location.sql`. The forward migration preserves
      location IDs and data while renaming `store_profiles` to `locations`,
      `user_store_access` to `user_location_access`, `max_stores` to
      `max_locations`, `workspace_instances.store_id` to `location_id`, and
      terminal `bound_store_id` to `bound_location_id`. It also renames the
      primary/access indexes and the admin navigation seed from `stores` to
      `locations`.
  - Evidence: `migrations::tests::store_to_location_rename_preserves_rows_and_foreign_keys`
        passes with zero `PRAGMA foreign_key_check` violations; the PG
        generator reports `105 tables, 124 indexes, 10 seed inserts` with no
        drift.
  - Commit: `10260a03` (`feat(core): add location rename migration`).
  - Deliberately not complete: the consolidated SQLite/PG init baselines and
        Rust/IPC/UI callers still use the old names. They must move in the same
        compatibility window before the 1a checkbox is marked complete; the
        license-server wire field remains deferred per the split above.
- [x] **2026-09-06 — Core SQL compatibility slice completed.** Migrated
      schema-level callers and fixtures to `locations`,
      `user_location_access.location_id`, `workspace_instances.location_id`,
      `terminals.bound_location_id`, and `tenant_subscription.max_locations`
      while deliberately preserving public Rust/IPC names (`StoreProfile`,
      `store_id`, `max_stores`, and legacy workspace identifiers). This keeps
      `warehouse` as a terminal workspace type and does not rename
      `inventory_locations` stock points.
  - Evidence: `cargo test -p oz-core subscription -- --nocapture` (100 passed),
        `cargo test -p oz-core terminal -- --nocapture` (137 passed),
        `cargo test -p oz-core location_cache_returns_cached_value_invalidation_forces_db_read -- --nocapture`
        (1 passed), `cargo test -p oz-core db::workspaces -- --nocapture`
        (65 passed), `cargo test -p oz-core db::store_profiles -- --nocapture`
        (31 passed), and
        `cargo test -p oz-core store_to_location_rename_preserves_rows_and_foreign_keys -- --nocapture`
        (1 passed).
  - Review note: the migration fixture intentionally retains legacy names before
        the final migration and asserts the renamed schema afterward; the access
        ACL queries and fixtures now use `location_id` after migration.
- [x] **2026-09-06 — Public core API rename completed.** Added the canonical
      `LocationProfile` type and `location_profile` module, moved the database
      facade implementation to `db::locations`, and renamed the core methods
      to `list_locations`, `get_location_profile`, `get_primary_location`,
      `count_locations`, `enforce_location_quota`, `create_location_profile`,
      `update_location_profile`, `set_primary_location`, and
      `delete_location_profile`. `SubscriptionTier::max_locations()` is now
      canonical. Deprecated `StoreProfile`, `store_*` DB methods, and
      `max_stores()` remain as compatibility aliases for the staged migration.
  - Evidence: `cargo check -p oz-core`; `cargo fmt --all -- --check`;
        `cargo test -p oz-core db::locations -- --nocapture` (31 passed),
        `cargo test -p oz-core location_profile -- --nocapture` (14 passed),
        and `cargo test -p oz-core subscription -- --nocapture` (100 passed).
        The skill drift guard reported no drift.
  - Preserved explicitly: `retail-pos`, `resto-pos`, `kds`, and `warehouse`
        workspace identifiers; `inventory_locations`; the `Store<'a>` DB
        facade; and the `TenantSubscription.max_stores` compatibility field.
- [x] **Next slice — desktop/tablet IPC rename.** Migrate command modules,
      DTOs, registrations, parity allowlists, and scoped aliases from the
      site-unit `store` terminology to `location`, while retaining the four
      terminal workspace types and deferring the license-server wire rename
      until its versioned payload migration.
  - ✅ **COMPLETED 2026-09-06 (three slices):** the UI live-caller migration
    (`a18a6134`, journaled below), then the alias retirement (`07c7b0f0`) —
    the seven legacy `*_store_*_scoped` IPC commands deleted from the desktop
    shell (`generate_handler` + command fns + `commands::store_profiles`
    module alias), the 7 tablet allowlist entries removed, the dev-mock's
    legacy scoped AND unscoped handler families removed, the shim
    `ui/src/api/stores.ts` and its contract test deleted, and
    `dev-mock-stores.test.ts`'s four round-trip tests rewritten onto the
    canonical family. `verify-ipc-parity.py` exits 0 (dev-mock still answers
    100% of UI-invoked commands; no UI invocation of any legacy name remains).
    The 1c "activation mapping" is annotated, not renamed: `store_subscription`
    parses the Go wire field `max_stores` and persists it into the local
    `max_locations` column (`16908995` documents the mapping on both structs;
    the wire rename itself stays item 1g, versioned + dual-read).
    **Still open under 1e:** `features/stores/` directory rename,
    `multi-store.ftl` filename and remaining `store`-worded FTL keys.
    Retained deliberately: the four workspace types, `inventory_locations`
    stock points, the `Store<'a>` DB facade, `store-pos`/`restaurant-pos`
    legacy runtime aliases, and topology's `storeProfileId` metadata key.
  - Checkpoint: desktop registration now resolves the canonical
        `commands::locations` module through a compatibility path to the
        existing command implementation; the old `commands::store_profiles`
        module remains an alias during the staged migration. Desktop and
        tablet manifest checks compile successfully, with only deprecation
        warnings from remaining old command/core names.
  - Checkpoint: desktop pre-auth branding now resolves the canonical primary
        location/list-locations APIs; the `store_name` branding wire field is
        intentionally unchanged for this compatibility step. Desktop manifest
        check passes; remaining deprecation warnings are isolated to the
        in-flight store-profile command module.
  - Checkpoint: added canonical `ui/src/api/locations.ts` types and scoped
        API functions. `ui/src/api/stores.ts` now provides deprecated aliases,
        while the existing store command strings remain unchanged until the
        Rust IPC command rename lands. `npm run typecheck`, the 8-test stores
        API contract suite, and `npm run lint -- --quiet` pass.
  - Checkpoint: renamed the UI admin route and navigation surface from
        `stores` to `locations` in feature registration, Workspace Home, and
        setup preview. Added matching `nav-locations` and
        `workspace-home-locations-*` English/Indonesian Fluent keys; the
        `multi-store` feature flag and all four workspace types remain
        unchanged. `npm run typecheck`, the 11-test LiveSetupPreview suite,
        `npm run lint -- --quiet`, and `scripts/lint-i18n.sh` pass.
  - **Remaining work, measured 2026-09-06 (assist pass).** The parent box is
    correctly unchecked, and the staged migration is *coherent* —
    `ui/src/api/stores.ts` is a genuine `@deprecated` shim whose every export
    aliases `@/api/locations`, and no old command string appears anywhere under
    `ui/src/features` or `ui/src/components`. But **12 live files still import
    deprecated functions from the shim**, so the rename is not finished:

    | deprecated function | live callers |
    |---|---|
    | `getPrimaryStoreScoped` | 5 — `AnalyticsScreen`, `DashboardScreen`, `SalesReportScreen`, `CustomReportScreen`, `MenuEngineeringScreen` |
    | `listStoresScoped` | 6 — `StoreSwitcher`, `LocalApiSection`, `StaffManagementScreen`, `MultiStoreDashboardScreen`, `TerminalManagementScreen`, `TopologyScreen` |
    | `updateStoreProfileScoped` | 2 — `NodeTopologyEditor`, `TopologyScreen` |
    | `deleteStoreProfileScoped` | 2 — `MultiStoreDashboardScreen`, `TopologyScreen` |
    | `setPrimaryStoreScoped` | 2 — `StoreSwitcher`, `MultiStoreDashboardScreen` |
    | `createStoreProfileScoped` | 1 — `TopologyScreen` |
    | `getStoreProfileScoped` | 1 — `NodeTopologyEditor` |

  - [x] **2026-09-06 — UI live-caller migration completed.** All 12 live
        files (13 with `topologyApply.ts`) moved off the `@/api/stores` shim
        to `@/api/locations`: the seven deprecated functions (measured totals:
        `getPrimaryStoreScoped` ×5 files, `listStoresScoped` ×6,
        `updateStoreProfileScoped` ×2, `deleteStoreProfileScoped` ×2,
        `setPrimaryStoreScoped` ×2, `createStoreProfileScoped` ×1,
        `getStoreProfileScoped` ×1) plus every `StoreProfile` type reference
        and `useState` annotation. Ten test files migrated in lockstep — each
        screen test that mocked `@/api/stores` by module path now mocks
        `@/api/locations` with the canonical names, so no timezone-anchor or
        store-list path lost its mock. `StaffManagementScreen.test.tsx`'s
        strict invoke mock flipped its branch to `list_locations_scoped`.
        `storeZoneCase.ts`'s helper comment renamed to match.
  - Evidence: `npm run typecheck` clean; `npm run lint -- --quiet` clean;
        focused Vitest run of 15 suites — 11 migrated + StaffManagement + the
        three deliberately-kept shim/mock suites (`api-stores-contract`,
        `api-locations-contract`, `dev-mock-stores`, `dev-mock-scoped-aliases`)
        — **431/431 passed**. Commit: `a18a6134`.
  - Deliberately kept on the deprecated path: `ui/src/api/stores.ts` (shim)
        and `api-stores-contract.test.ts` — the shim's only remaining importer
        is its contract test, so the alias family keeps coverage until the
        Rust-side alias retirement in 1c/1d. `dev-mock` continues serving both
        command families. Local variable names inside screens/tests
        (`storeProfiles`, `stores`, `mockListStores`) were intentionally left
        alone — they are not API identifiers.
  - [ ] **Remaining UI work (re-measured 2026-09-06 after the migration).**
    Zero live callers of the shim remain; what keeps 1e open is now
    mechanical/structural, not caller work:

    | item | state |
    |---|---|
    | `ui/src/api/stores.ts` shim | ~~kept solely for its contract test; retires together with 1c/1d~~ **retired `07c7b0f0`** |
    | `api-stores-contract.test.ts` | ~~pins the legacy command strings while the Rust aliases exist~~ **deleted with the shim `07c7b0f0`** |
    | `features/stores/` directory name, `multi-store.ftl` filename, remaining `store`-worded FTL keys and copy | route/nav already renamed (`nav-locations` keys) — **all three parts done 2026-09-07**: dir renamed `a965f481`/`b83785b6`, FTL filename renamed `88a14c91`/`f5e191aa`, and the 32 dead `topology-*` orphan keys (shortcuts sheet, sim controls, palette heading — dead since `f89a46b7`/`32d64336`/`4653d966` removed their consumers without removing the messages) deleted from both bundles in the same commit. Remaining `store`-worded copy is covered by the row below.

    **Update 2026-09-07:** the first two rows are done — the alias retirement
    (`07c7b0f0`) deleted the shim and its contract test outright (see the
    "Next slice" box and item 1d above). What keeps 1e checked-no is exactly
    row three: the `features/stores/` directory name, the `multi-store.ftl`
    filename, and the remaining `store`-worded FTL keys and copy.
    **FTL-slice update 2026-09-07:** the `multi-store.ftl` filename part is
    done — both bundles are now `multi-location.ftl` / `multi-location.id.ftl`
    (`88a14c91`/`f5e191aa`), the registry imports in `i18n/index.ts` and
    `locales/index.ts` updated, `verify-ftl-orphans.py`'s prose path fixed, and
    12 `?raw` test imports re-pointed. As part of the same commit the **32
    orphan `topology-*` key pairs were deleted from both bundles** — they died
    when their consumers were removed (`f89a46b7` deleted the shortcuts-help
    popover, `32d64336` the palette heading, `4653d966` the sim controls) but
    pre-date the orphan gate (`a410ea9f`), which is staged-scoped and could
    never see them; the whole-file rename re-counted every key in the renamed
    file as "added", which is what finally surfaced them. 333 keys remain in
    the renamed bundle, all referenced. Validation: `tsc --noEmit` clean,
    orphan gate OK (333/333 referenced), bundle parity 0 missing, 1,300+
    tests green across the 13 touched suites (i18nBundle, NodeTopologyEditor,
    a11y, minimap/node-card/finder/relationship-picker/validation-widget/
    warehouse-card/wire-group, memo, Inspector, DevMock).

    **1e is now closed.** The only remaining `store`-worded strings are
    intentionally preserved per the Terminology table: `store-pos` /
    `restaurant-pos` legacy workspace identifiers, the `multi-store` feature
    flag, `storeProfileId` topology metadata, CSS class names, and
    `inventory_locations` stock points.

    The journal's earlier "cheapest high-value move" advice — migrate the five
    report/analytics screens' `getPrimaryStoreScoped` imports first since the
    shim already forwards to the canonical command — has been executed and
    superseded by the full caller migration above.

    Two notes so this measurement is not misread. First, counting *call sites*
    rather than *command strings* is the only way that sees this work at all:
    an initial grep for `'list_store_profiles_scoped'` under `features/`
    returned zero and looked like the migration was done, because the string is
    hidden one level down inside the shim — the feature files call
    `listStoresScoped`, not the command name. Second, `topologyApply.ts` imports
    only the deprecated *type* (trivial), and three test files
    (`api-stores-contract.test.ts`, `StoreSwitcher.test.tsx`,
    `keyboardNavigationCompliance.test.tsx`) deliberately exercise the shim and
    should keep importing the deprecated path while it exists, or the alias
    silently loses its coverage. **Update 2026-09-06:** the type import and the
    two component-driven mocks have since moved with their components
    (`a18a6134`); only `api-stores-contract.test.ts` still imports the shim, by
    design. **Update 2026-09-07:** superseded — `07c7b0f0` deleted the shim and
    the contract test together, so nothing imports the deprecated path at all.
  - [x] **2026-09-06 — Canonical location IPC slice completed.** Renamed the
        desktop command module path to `commands::locations`, added canonical
        scoped DTOs and handlers (`list_locations_scoped`,
        `get_location_profile_scoped`, `get_primary_location_scoped`,
        `create_location_profile_scoped`, `update_location_profile_scoped`,
        `set_primary_location_scoped`, and `delete_location_profile_scoped`),
        and registered them in the desktop invoke handler. The former
        `store_profiles` module, DTOs, handlers, and scoped command strings
        remain deprecated compatibility aliases. The UI location API now
        invokes canonical command names while `ui/src/api/stores.ts` retains
        independent legacy command wrappers. The browser dev mock implements
        both families against one stateful location list, including CRUD and
        primary-location behavior.
  - Evidence: `cargo check --manifest-path
        apps/desktop-client/Cargo.toml`; from `ui/`, `npm run typecheck`,
        `npm run lint -- --quiet`, and the focused Vitest run covering
        `dev-mock-stores.test.ts`, `api-locations-contract.test.ts`, and
        `api-stores-contract.test.ts` (21 passed). The canonical mock test
        verifies list/create/update/set-primary/delete round-trips.
  - Preserved explicitly: workspace types `retail-pos`, `resto-pos`, `kds`,
        and `warehouse`; stock points remain `inventory_locations`; the
        `Store<'a>` database facade and legacy runtime keys `store-pos` /
        `restaurant-pos` remain unchanged. The license-server `max_stores`
        wire field remains deferred to a versioned payload migration.
  - [x] **2026-09-06 — Website pricing terminology slice completed.**
        Replaced site-unit quota and marketing copy with `Location` /
        `Lokasi` in both website locales and the mirrored
        `docs/guides/subscription-tiers.md` and
        `docs/records/subscription-tiers.md` matrices. Workspace literals
        remain unchanged, including `store-pos`, `restaurant-pos`, `kds`,
        and `warehouse`.
  - Evidence: website pricing invariants pass (15 tests), `npm run astro --
        check` passes with 0 errors (25 existing hints remain), and
        `git diff --check` passes. The full website `npm run check` remains
        broader than this slice and still exposes unrelated existing jsdom
        navigation/account-view failures; it was not used as a green claim.
        **CORRECTION (2026-09-06 assist pass): the "known failures" claim is
        false and is recorded here so no later agent re-adopts it.** The
        website suite is green — `npm run check` exits 0 (precheck i18n +
        password policy + Vitest, then `astro check` at 0 errors / 0 warnings /
        25 hints), and the three named files pass standalone: `account-view`
        (64) + `auth-form` (20) + `signup-form` (16) = **100/100**; full suite
        at `b72fc719` = **42 files / 758 tests, all passing**. What reads like
        failure output is expected **stderr noise from tests that provoke the
        failure path on purpose**: jsdom's `Not implemented: navigation` fires
        when a test drives the real `redirectAfterAuth` (`AuthForm.tsx:148`,
        `SignupForm.tsx:97`), and `checkout open failed` is a deliberate stub
        rejection (`account-view.test.tsx:423`) used to assert the error banner
        renders. Treat a green `npm run check` as green — and never dismiss a
        new red as one of the "known" ones, because there are none. Also stale
        on this line: `883386f4` grew the invariants file to **18 tests**, not 15.
  - [x] **2026-09-06 — Workspace vocabulary checkpoint completed.** Updated
        both subscription-tier records and both website pricing locales to
        describe `warehouse` as a warehouse workspace context. The matrix
        now names exactly the four current terminal workspace types:
        `retail-pos`, `resto-pos`, `kds`, and `warehouse`; `store-pos` and
        `restaurant-pos` are documented only as legacy compatibility aliases.
        No warehouse hierarchy resource or `inventory_locations` rename was
        introduced.
  - Evidence: the same 15 pricing invariants pass, `npm run astro -- check`
        reports 0 errors, and `git diff --check` passes.
  - [x] **2026-09-06 — Subscription usage DTO terminology slice completed.**
        Renamed the current-usage field from `store_count` / `storeCount` to
        canonical `location_count` / `locationCount` in both desktop and tablet
        capability DTOs, the typed API, browser mock, quota gates, and focused
        test fixtures. This is a local usage-contract rename only: the signed
        license compatibility field `max_stores` / `maxStores` remains deferred
        to the versioned payload migration, and workspace identifiers remain
        unchanged.
  - Evidence: desktop subscription tests (6), tablet subscription test target
        (1), and the focused UI suites (`SubscriptionContext`,
        `MultiStoreDashboardScreen`, `TopologyScreen`: 63 tests) pass;
        `npm run typecheck`, `npm run lint -- --quiet`, `cargo fmt --all --
        --check`, and `git diff --check` pass.
  - [x] **2026-09-07 — 1g license-server wire rename completed.**
        `851d9a02` (Go server) + `662e7f3a` (Rust client). The signed
        payload's primary quota field is now `max_locations`
        (`SubscriptionPayload.MaxLocations`), and the plan's "versioned
        payload migration" resolved into a concrete dual-emit / dual-read
        compat design instead of a version bump:
        - **Go (dual-emit):** every payload carries BOTH wire names.
          `signSubscription` forces `MaxStores = MaxLocations` at the single
          choke point all nine build sites pass through (activate, renew,
          resume, admin extend, admin grant, Midtrans provision + grace,
          Paddle provision/update + grace), so a missed site can never emit
          a divergent or silently-zero legacy value. Dual-emit is required,
          not cosmetic: a pre-rename client's `LicenseStatusResponse` had
          `#[serde(default)]` on `max_stores`, so dropping the legacy key
          would read quota 0 — which the server treats as unlimited
          (fail-open). `/api/v1/license/status` dual-emits both keys for
          the same reason; the admin `/api/v1/web/usage` endpoint renamed
          outright (same binary serves it, no stale-client concern).
        - **Storage unchanged on purpose:** PocketBase `license_keys` /
          `subscriptions` keep the `max_stores` field name — a PB field
          rename is a live-data migration the 1g scope never asked for;
          SCHEMA.md now documents the storage↔wire mapping.
        - **Rust (dual-read):** `SignedSubscriptionPayload` and
          `LicenseStatusResponse` carry BOTH names as `Option<i64>` with
          `effective_max_locations()` resolvers (prefer `max_locations`).
          The two-Option shape is load-bearing: a `serde(alias)` was tried
          first and REJECTED the dual-emit payload ("duplicate field
          `max_locations`" — serde treats primary + alias as one field),
          which is exactly the shape the compat window produces. Both
          fields `#[serde(default)]` preserve the pre-1g behavior of a
          missing quota (0) and `skip_serializing_if` keeps
          re-serialization honest. `store_subscription` persists via the
          resolver into the local `max_locations` column; the desktop
          `ServerLicenseStatusDto` IPC field stays `max_stores` (the UI
          consumes it — a UI slice, not this wire contract) and maps from
          the resolver.
        - **Docs:** DEPLOY.md sample payload + activation checklist updated
          (max_locations with the legacy note); SCHEMA.md §3 documents that
          `max_stores` is the storage name and the wire emits both.
        - Verification: `gofmt -l` clean, `go vet ./...` clean,
          `go test -short ./...` ok (full license-server suite, 114s);
          `cargo test -p oz-core --lib license_verification` 21 passed
          (three wire shapes pinned: legacy-only, new-only, dual-emit);
          `cargo check -p oz-pos-tablet -p oz-api -p oz-pos-app` clean;
          `cargo test -p oz-pos-app --lib license` 14 passed. The contract
          test asserting the /web/usage shape now pins `max_locations`.
        - Rotation note: the legacy keys may be dropped only when no
          un-upgraded client can poll `/status` or parse a re-signed
          payload — i.e. never silently; track it as its own slice with a
          fleet-version check, not a cleanup.
  - [x] **2026-09-06 — Legal Entity schema foundation completed.** Added and
        registered `20260908_legal_entities.sql`. It creates the first-class
        `legal_entities` table, creates one deterministic `Default Legal Entity`
        per existing tenant, and links every existing Location through the new
        `locations.legal_entity_id` column without changing Location IDs. The
        migration records itself through the normal migration runner; the
        generated Postgres schema was regenerated from the registry.
  - Evidence: the migration test covers multiple tenants, preserved Location
        IDs, default-entity assignments, and zero foreign-key violations.
        `cargo test -p oz-core migrations::tests -- --nocapture` passes (25
        tests), and the SQLite/Postgres schema-surface parity test passes.
  - Deliberately not complete: backend/API writes still accept the staged
        nullable column. Scoped authorization, entity CRUD, and mandatory
        entity assignment are follow-up slices; `warehouse` remains a terminal
        workspace type and is not a hierarchy resource.
  - [x] **2026-09-06 — Legal Entity core API slice completed.** Added the
        `LegalEntity` and `UpdateLegalEntity` domain types plus tenant-scoped
        `Store` methods for list/get/create/update. Added atomic Location-to-
        Legal-Entity assignment that verifies both resources belong to the
        requested Organization/Tenant before committing.
  - Evidence: core tests cover identity round-tripping, tenant isolation,
        validation, same-tenant reassignment, and cross-tenant rejection.
        `cargo test -p oz-core legal_entity -- --nocapture` (5 passed),
        `cargo test -p oz-core legal_entities -- --nocapture` (2 passed),
        `cargo check -p oz-core`, and clippy with `-D warnings` pass.
  - Deliberately not complete: IPC/API command exposure, frontend screens,
        scoped role authorization, and making `locations.legal_entity_id`
        non-null for all future writes remain separate slices.
  - [x] **2026-09-06 — Legal Entity desktop IPC/API slice completed.** Added
        four `*_scoped` desktop commands for list/get/create/update, registered
        them in the desktop invoke handler, and added the typed
        `ui/src/api/legalEntities.ts` wrapper. Commands authorize through the
        existing settings permissions and use the global identity database;
        the staged `default` tenant sentinel is kept until tenant claims are
        available in the session context.
  - Evidence: desktop command DTO tests pass (2), the frontend IPC contract
        suite passes (4), `npm run typecheck`, and `npm run lint -- --quiet`.
        Existing Store→Location deprecation warnings remain unrelated to this
        slice.
  - Deliberately not complete: Legal Entity UI screens, location assignment
        IPC, scoped role/permission modeling, and replacement of the `default`
        tenant sentinel remain follow-up work. Location assignment is kept out
        of this command slice because current Locations are persisted in
        per-Location databases while Legal Entities are Organization-level.
  - [x] **2026-09-06 — Legal Entity IPC parity slice completed.** Ported the
        four scoped Legal Entity commands to the tablet client and registered
        them in its invoke handler. Added explicit browser dev-mock handlers
        for list/get/create/update and a stateful round-trip test; the mock
        pins the seeded `default` tenant and returns `null` for unknown IDs.
        Removed the four now-stale tablet exceptions from
        `scripts/ipc-parity-allowlist.json`.
  - Evidence: `python scripts/verify-ipc-parity.py` reports `IPC parity: OK`;
        tablet Legal Entity command tests pass (2), dev-mock round-trip tests
        pass (2), `npm run typecheck`, and `npm run lint -- --quiet` pass.
  - Deliberately not complete: Legal Entity UI screens, Location assignment
        IPC, tenant-claim resolution, and scoped role/permission modeling.
        `warehouse` remains a terminal workspace type, not a hierarchy
        resource, and the legacy `store-pos` / `restaurant-pos` aliases remain.
  - **Assist-pass note (2026-09-06, DSH) — the parity slice is honest, and it
    opens a divergence the box does not mention.** Verified after `82c57e32`
    landed: all four commands ported, registered, dev-mocked with a stateful
    round-trip test, and the four tablet exceptions genuinely removed from
    `scripts/ipc-parity-allowlist.json` (zero `legal_entity` entries remain).
    L608 already and correctly declares the UI incomplete —
    `ui/src/api/legalEntities.ts` is imported only by its own contract test, and
    no screen exists on either platform (control-checked: the same search shape
    finds `CustomerManagementScreen` and friends).

    What is recorded nowhere in the three todo files: **`legal_entities` does
    not sync.** Searching `sync_pull.rs`, `sync_client.rs` and
    `crates/oz-api/src/lib.rs` for it returns **0** hits, against a positive
    control of **10** hits for `products` in `sync_pull.rs` alone. The tablet
    opens its own SQLite file (`resolve_db_path`), so now that *both* shells
    expose `create_legal_entity_scoped` and `update_legal_entity_scoped`, each
    device authors into its own copy and the two never converge.

    Severity today: **latent, not live** — nothing consumes the table. No
    receipt, invoice, tax or report code reads legal entities; the only readers
    are the command modules, the store, the API client, dev-mock and tests. So
    this is cheap-now/expensive-later, the same framing as the Memo fan-out.

    Worth naming before the consumer arrives, though, because Legal Entity is
    the tax/invoicing identity: the moment a receipt prints, a two-device
    merchant can print two different legal identities for the same Location, and
    that is a compliance defect rather than a data one. Options for the owner:
    make the Organization-level entity read-only on non-primary devices (one
    authoring surface, many readers); sync it alongside the other config tables;
    or state in the hierarchy design that Legal Entity is per-device by intent.
    The third is almost certainly wrong for a tax identity, but it should be
    ruled out in writing rather than by silence.

## P0 — required before calling the platform globally ready

- [ ] **Add scoped authorization.** Extend role checks with explicit permissions
      and scopes for organization, legal entity, location, workspace, and
      terminal. A manager assigned to Location A must not automatically manage
      Location B.
      - **Progress 2026-09-07 (`3233a99d`):** Wired `require_permission_for_user_scoped`
        into `authorize_topology_write` and `apply_topology_diff`. Scoped managers
        are blocked from applying topology or saving templates across locations.
      - **SUPERVISOR NOTE (2026-09-07): this item now has a design brief —**
        `docs/decisions/2026-09-07-adr47-scoped-authorization-assignments.md`
        (Proposed). Five questions, one recommended answer each: assignment
        rows with nullable scope pairs; one scoped choke point;
        downward-only inheritance; custom roles share the registry; backfill
        existing rows to org-wide. Awaiting sole-maintainer ruling — do not
        implement until ruled.
- [x] **Define the tenant hierarchy.** The canonical design now includes
      Organization/Tenant → Legal Entity → Location, with Workspace Instances
      scoped to Locations and Terminals owned by the Organization and assigned
      to a Location and a Workspace, Users assigned through scoped
      role assignments, and Topology modeled as a graph over owned resources.
      Implementation and migration remain follow-up work.
- [ ] **Rename Store → Location across the stack.** Mechanical rename of the
      site unit per the Terminology table + the execution journal below:
      SQLite migration (+ PG regeneration), Rust structs/commands/quotas
      (`max_stores` → `max_locations`), IPC commands + parity allowlist +
      dev-mock, UI routes, nav, and FTL keys, license-server payload fields
      and admin dashboard, and public pricing copy ("Stores" → "Locations").
      workspace-type keys (`retail-pos`, `resto-pos`, `kds`, `warehouse`, plus
      any legacy `store-pos` / `restaurant-pos` identifiers),
      `inventory_locations` stock points, and the `Store<'a>` DB facade are
      explicitly out of scope. Sequence
      before the §G Legal Entity migration.
      - [x] 1a. Schema migration: `20260906_rename_store_to_location.sql`
            (`store_profiles` → `locations`, `user_store_access` →
            `user_location_access`, `tenant_subscription.max_stores` →
            `max_locations`, `workspace_instances.store_id` → `location_id`,
            `workspace_screens` seed rows, any bound_store_id terminals
            columns) + `migrations.rs` registry entry + edit `20260813_init.sql`
            and regenerate `20260813_init.pg.sql`.
      - [x] 1b. Core: `store_profile.rs` → `location_profile.rs`
            (`StoreProfile` → `LocationProfile`, `enforce_store_quota` →
            `enforce_location_quota`, `max_stores()` → `max_locations()`),
            `db/mod.rs` region, all in-crate callers.
      - [x] 1c. Desktop + tablet Rust: command file rename, IPC command names
            (`list_locations_scoped` etc.), DTOs (`store_count` →
            `location_count`), `lib.rs` registrations, tests, activation
            mapping (wire `max_stores` → local `max_locations`).
            **Completed 2026-09-06** — see the "Next slice" box above:
            canonical commands registered, legacy command fns + module alias
            deleted (`07c7b0f0`), and the wire→local mapping annotated at the
            `store_subscription` boundary (`16908995`).
      - [x] 1d. IPC surface: parity allowlist, dev-mock handlers, dev-mock
            scoped-alias tests. **Completed 2026-09-06** (`07c7b0f0`) — 7
            tablet allowlist entries removed, dev-mock legacy handler families
            removed, scoped-alias regression list trimmed; gate exits 0.
      - [x] 1e. UI: `api/stores.ts` → `api/locations.ts`, `features/stores/` →
            `features/locations/`, `stores` route → `locations`, tool card,
            FTL keys (enumerate; `multi-store.ftl` → `multi-location.ftl`),
            tests. **Completed 2026-09-07** — callers migrated `a18a6134`, shim
            retired `07c7b0f0`, directory renamed `a965f481`-`b83785b6`, FTL
            filename + dead-key cleanup `88a14c91`-`f5e191aa` (journal: the
            "Remaining UI work" block above).
      - [x] 1f. Website: pricing "Stores" row → "Locations", card features
            ("1 store" → "1 location"), invariants test labels,
            `subscription-tiers.md` matrix. Updated both English and
            Indonesian pricing cards/comparison rows plus both mirrored
            subscription-tier records; warehouse copy remains separate
            workspace copy, not a hierarchy resource.
      - [x] 1g. License-server wire rename (2026-09-07, `851d9a02` Go +
            `662e7f3a` Rust): Go payload field `max_stores` → `max_locations`
            with dual-read for old signed payloads; admin dashboard. Not
            required for the local rename (signature verifies raw stored
            payload bytes). Evidence bullet in the implementation journal
            below (1g slice).
- [ ] **Implement Legal Entity and the §G default-entity migration.** Add the
      Legal Entity level to schema, backend authorization, and API; then run the
      §G migration (auto-create one Default Legal Entity per existing
      Organization, move its Locations beneath it, preserve IDs, record the
      migration). This is the follow-up the checked design item above defers.
- [x] **Make subscription state authoritative and fail closed.** The UI must
      distinguish active, loading, expired, canceled, paused, grace-period, and
      unavailable states. A missing subscription response must not silently grant
      tier-gated access.
      - [x] **Lifecycle state contract slice (2026-09-07, `9896dac4`,
            `4acaeea9`, `313f2c31`, `1176730a`).** The §B state machine now
            exists end to end, and the fail-open bug in the capabilities read
            is fixed at its root:
            - **Core** (`oz_core::subscription`): new
              `SubscriptionLifecycleState` (active/grace/expired/canceled/
              paused/unavailable) + `TenantSubscription::lifecycle_state()`.
              Server-written statuses (`grace_period` from the Midtrans
              webhook, `paused`, `canceled`/`revoked`, `expired`) map first;
              an unrecognized status fails closed as `unavailable`. An
              `active` row is date-refined mirroring
              `is_within_grace_period` exactly, so the reported state can
              never disagree with `effective_tier` (Free stays active
              forever; missing expiry = perpetual; unparseable expiry =
              expired). 11 new unit tests.
            - **Commands (desktop + tablet)**: the DTO carries `state`, and
              the fail-open hole is closed — the old code turned a missing
              row or tampered signature into `Err`, which the UI's catch
              path rendered as `caps: null` with **every tier gate open**
              (the old test-setup comment said so outright). Now any
              missing/tampered/unreadable subscription returns Ok with Free
              entitlements + `state: "unavailable"`, so every gate locks.
              Usage counts became best-effort (banner inputs only). The
              dev-only Free→Premium upgrade now applies only to a genuinely
              `active` state, so expired/canceled/paused paths stay
              exercisable in dev. Also fixed while here: desktop used
              `tier.supports_analytics()` (ignoring the `advanced_analytics`
              add-on) while tablet used `supports_analytics_with_addons()` —
              both now compute static support from the entitlement tier and
              flow the add-on grant only while active/in-grace (a canceled
              Plus+add-on no longer shows analytics; previously tablet would
              have shown it). 7 new desktop command tests (missing row,
              tampered signature, grace/expired/canceled/paused states via
              row-column edits — signature covers only `signed_payload`, so
              columns are independent).
            - **UI**: `SubscriptionCapabilities.state` typed
              (`SubscriptionLifecycleState` union);
              `SubscriptionContext` exposes `state` (`'loading'` during the
              fetch, the backend state on success, `'unavailable'` on
              transport failure — no longer silently open) and the
              fail-open doc comment is gone. dev-mock reports `active`; the
              global test stub reports `unavailable` (§B honest default;
              gates do not read `state` yet). 10 consumer-test fixtures
              updated; `tsc --noEmit` clean, eslint clean, 356 vitest tests
              across the 13 affected suites green.
            - **Residual (deliberate):** existing gates still render open
              on `caps: null` (transport failure + the test stub); wiring
              them to `state` is the operational/administrative entitlement
              split below. Pricing page and license-server reconciliation
              remain open under the expiry/grace item.
            - **Note on commit hygiene (R36-13 pattern):** `313f2c31`
              carries six of this slice's files under a commit made by a
              concurrent agent; the subject matches the content, and the
              file list is exactly the six — reviewed by file list, not
              subject, per the standing rule. The state-machine edits to
              both command files were clobbered once by a stale concurrent
              buffer mid-slice (tablet reverted to HEAD byte-identical) and
              were re-applied before commit; the tip of every file now
              matches this journal's description.
- [x] **Implement the expiry and offline-grace policy.** Administrative SaaS
      features lock at `expiresAt`; POS operational runtime may continue under
      the approved Free/OneTime 7, Plus 14, Pro 14, Premium 30, or Enterprise
      60-day offline grace policy. Reconcile the public pricing page and
      server/local implementation with this policy.
      - **Completed 2026-09-07 (`ed3731b2`):** Administrative SaaS features
        (Analytics, Custom Reports, Sales Report, Inventory Report, Menu
        Engineering, Audit Log, Promotions, Topology) lock when subscription
        leaves `active` (at `expiresAt` during grace, expired, canceled, paused,
        or unavailable). Operational POS runtimes (`store-pos`, `restaurant-pos`,
        sales checkout) continue through the signed offline grace window.
      - **Completion pass 2026-09-07 (`bcaa5033`, `499bb1b0`):** the two
        clauses the first entry did not cover are now implemented:
        - **Read-only lock after grace (`bcaa5033`).** §B's "when the grace
          window expires while still offline, POS runtime locks to a
          read-only state" — `TenantSubscription::pos_read_only()` (true
          only for `Expired`) + `enforce_pos_writable()` (new
          `CoreError::SubscriptionReadOnly`), wired into all five sale
          completion commands (desktop ×2, tablet ×3) and both clients'
          `enqueue_offline` (sync queueing is an order mutation). Viewing,
          export, and sign-out are untouched; a verified renewal reopens
          the register automatically. Semantics deliberately narrow:
          canceled/paused keep selling on the reverted Free tier, and
          missing/tampered data degrades to Free operations instead of
          bricking a register (the §B fail-closed rule targets
          administrative features — data-integrity responses live in the
          capabilities command and the admin gate). 5 new core tests.
        - **Reconciliation (`499bb1b0`).** Enterprise `offline_grace_days`
          3650 → **60** (the pricing page publishes 60; a contract needing
          a different window ships as a signed override, not a client-side
          fallback — 1 pinned test updated). `licensing.md` (en + id) now
          states the per-tier windows and the read-only lock instead of
          the pre-§B "degrades to the free tier" wording. The pricing
          invariant test's stale "no enforcement exists yet" comments for
          products/KDS updated; its matrix (7/14/14/30/60, products,
          KDS) was already the contract and now matches the code exactly.
        - Deliberately not covered by this item: server-side (license-
          server) grace numbers in the signed payload — the 1g wire work
          remains deferred and versioned; the client currently resolves
          grace from the tier table, which agrees with the published page.
- [x] **Implement separate operational and administrative entitlement paths.**
      A register may continue selling during approved offline grace, while
      Analytics, Memo, Data Management, and other administrative features lock
      after `expiresAt`.
      - **Completed 2026-09-07 (`ed3731b2`):** Implemented `useAdminGate()`
        in `SubscriptionContext.tsx` and `<AdminLockedFeature />` rendered by
        all administrative SaaS screens. Operational workspace tools remain
        active for cashiers while admin tools display the locked state.
      - **Completion pass 2026-09-07 (`776af581`, `cc5d6c71`):** the two
        surfaces the box text names that the first pass skipped (their
        files were in flight by other agents at the time) are now gated:
        **MemosScreen** and **DataManagementScreen** use the same
        `useAdminGate` + `<AdminLockedFeature />` wrapper, with per-file
        gate tests pinning locked-replaces-content on both (`776af581`).
        The §B gate behavior on the two flagship surfaces (Analytics —
        grace/unavailable/expired/precedence cases — and Audit Log) is
        pinned by `cc5d6c71`. Every screen the box names is now covered.
- [x] **Enforce Topology Editor permissions on the backend.** Apply, rename,
      location creation, template writes, and other topology mutations must
      enforce the agreed admin/owner policy server-side. The current topology
      save capability is broader through `staff:update`.
      - **Completed 2026-09-07 (`b0667ab4`, `3233a99d`):**
        - Migrated permission checks in `can_save_topology`, `authorize_topology_write`,
          and `apply_topology_diff` from `permissions::STAFF_UPDATE` to the
          dedicated `permissions::TOPOLOGY_WRITE` (`b0667ab4`).
        - Enforced location scope on `authorize_topology_write` and
          `apply_topology_diff` via `require_permission_for_user_scoped` (`3233a99d`).
          A manager scoped to Location A is rejected when attempting to mutate
          or apply topology to Location B.
- [x] **Centralize quota enforcement.** Location, terminal, workspace/KDS,
      staff, inventory stock point, product, and history limits must be enforced
      consistently by backend mutations, not only by disabled UI controls.
      - **Completed 2026-09-07 (`73e77c5f`):**
        - Added `Store::enforce_terminal_quota` in `crates/oz-core/src/db/terminals.rs`
          and wired it into both desktop and tablet `register_terminal_scoped`
          commands.
        - Extended `Store::enforce_instance_quota` in `crates/oz-core/src/db/workspaces_lifecycle.rs`
          to enforce `max_warehouses()` on `warehouse` workspace instance
          creation.
      - **Completion pass 2026-09-07 (`de6d2df2`):** the two published-but-
        unenforced rows of the tiers contract (subscription-tiers.md
        §Numeric Limits, the numbers the pricing invariant test pins) now
        have backend enforcement:
        - **Products** — `SubscriptionTier::max_products()` (Free 200 /
          Plus 500 / Pro 1,000 / Premium 10,000 / Enterprise unlimited) and
          `Store::enforce_product_quota` (per-location catalog count),
          wired into desktop `create_product_scoped`, tablet
          `create_product` + `create_product_scoped` (tier from the global
          DB with clock-rollback + signature validation, mirroring the
          terminal-quota pattern), and the REST `create_product` SQLite
          fallback (unknown/tampered subscription fails closed at the Free
          cap; over-quota returns 402 with the actionable message). 3 new
          core tests.
        - **KDS screens** — `max_kds_screens()` (Free/Plus 0, Pro 2,
          Premium+ unlimited) enforced in `enforce_instance_quota` via a
          new `count_active_kds_instances`. C3.2 reconciliation: a signed
          bundle that unlocks the kds *type* on Plus gets Pro's 2-screen
          budget — a static 0 would make the paid entitlement meaningless
          (the pre-existing bundle test now passes against the count gate,
          plus 4 new tests).
        - **Deliberately not enforceable, recorded rather than silently
          dropped from the box text:** (1) *Inventory stock points* — the
          tiers contract publishes NO stock-point numbers, so there is
          nothing to enforce without inventing pricing terms; adding a row
          to the contract is an owner decision. (2) *Tablet location
          quota* — the tablet shell registers no location-CRUD IPC at all
          (all location commands are tablet-allowlisted, desktop-first per
          the recorded product precedent), so there is no tablet mutation
          to guard; the quota call must join the command when the CRUD is
          ported. (3) *REST PG product path* — the PG-side create_product
          has no tenant→tier resolution yet; server-issued quota numbers
          are the license-server wire work (1g, deferred + versioned).
- [x] **Implement the Settings scope map.** Mark every Settings section as
      organization-, legal-entity/location-, terminal-, or workspace-scoped
      before expanding the UI.
      - **Completed 2026-09-07 (`77b0ce21`):** Created `SettingsScopeTag`
        supporting the 5 canonical scopes (`organization`, `legal-entity`,
        `location`, `workspace`, `terminal`). Annotated all 12 sections in
        `SettingsNavTree` and rendered scope tags in sidebar and section headers.
- [x] **Protect tenant isolation.** Add tests and review gates proving that tenant
      IDs, location scopes, topology graphs, sync payloads, audit records, and
      cached subscription data cannot cross tenant boundaries.
      - **Current-state inventory (2026-09-06 assist pass, corrected at
        `5f263d11`; updated 2026-09-06 by the terminals-tenant slice,
        `56653839`; updated 2026-09-07 by the sale_lines RLS slice,
        `47d43c55`; updated 2026-09-07 by the memo-tables RLS slice,
        `afbfe260`)** — this item had no measurable state, so it read as either
        "nothing done" or "everything done" depending on who was asked.
        Counted from the generator's own emitted artifacts, not a grep:
        **34 tables carry `tenant_id`; 27 are under RLS; 7 are not** —
        `image_refs`, `legal_entities`, `memo_revisions`,
        `snapshot_versions`, `terminals`, `topology_revisions`,
        `webhook_endpoints`.
        (The 32/24/8 → 34/27/7 jump is not one slice's work: since the last
        count `memo_locations` and `topology_revisions` gained `tenant_id`
        (the latter via the topology agent's ADR #46), moving them from
        "column-less — invisible to the to-do list" into the counted
        population, and this slice then covered the two memo serving
        tables. The numbers come from `RLS_TABLES` and the generator's
        emitted to-do block, which agree with each other — never from a
        hand-rolled scan (an earlier revision of this note undercounted the
        covered set because a parser missed `products`, whose `tenant_id`
        arrives via a `CREATE TABLE products_new … RENAME TO products`
        rebuild in `20260831_per_tenant_unique_rebuild.sql`).)
      - **Existing exposure: now zero.** RESOLVED 2026-09-07 by `47d43c55`.
        Until then only **2** queries in PG-facing code touched an uncovered
        table with no tenant predicate: both on `sale_lines`, at
        `crates/oz-api/src/pg.rs:1207` (INSERT — omitted `tenant_id`, so the
        column default stamped `'default'` on every line row even though the
        header and transaction GUC were correct) and `:1404` (SELECT —
        `WHERE sale_id = $1` only). That had been a known finding since
        `generate-pg-migration.py` named sale_lines the cautionary case in its
        docstring ("it has the column but pg.rs inserts without it"). The fix
        stamps `tenant_id` explicitly on the INSERT, adds
        `AND tenant_id = $2` to the SELECT, and adds `sale_lines` to
        `RLS_TABLES` — the policy precondition (write path populates the
        column) is finally met, so the cautionary note is now past tense.
        Note the ordering was load-bearing: under the restricted-role RLS
        posture, the old default-`'default'` INSERT would be rejected by
        `WITH CHECK` — write-path fix and RLS coverage had to land in the
        same commit, and did. So the honest read is: the posture is **good**,
        and this tracked gap is closed.
      - **[x] sale_lines tenant slice (2026-09-07, `47d43c55`).** The two real
        exposure queries fixed at the root, RLS coverage granted, PG init
        regenerated (110 tables, 136 indexes; uncovered to-do block 9→8), and
        the stale "non-RLS `sale_lines`" comment in `pg_tests.rs` corrected.
        Verification: `cargo check -p oz-api` clean; `cargo test -p oz-api`
        **276 passed, 0 failed**. **Live PG round-trip NOT verified:** Docker
        Desktop was unable to start on this machine, so the restricted-role
        probe (`pg_integration_rest_rls_non_owner`) self-skipped — and its
        `create_sale` path is exactly the one that would catch a regression
        here (probe INSERT now flows through the explicit `tenant_id` +
        `WITH CHECK`). Re-run that test against `oz-pg-test-15432` when the
        daemon is up; until then the RLS behavior of this slice is verified
        statically (generator validation + compilation) only.
      - **[x] memo serving tables RLS slice (2026-09-07, `afbfe260`).**
        Supervisor Rounds 12/14 found the committed "RLS cross-tenant
        invisibility" wording for the memo sync path ran ahead of the schema
        (no RLS on `memos` / `memo_locations` / `memo_recipients`); this
        slice closes the gap instead of rewording, per Round 23. Precondition
        audit found the policy requirements already met: the single PG write
        path `pg::sync_memos` sets the `oz.tenant_id` GUC before every
        statement and stamps `tenant_id` explicitly on each INSERT, the
        reconciliation DELETE is `WHERE tenant_id = $1`, and
        `list_active_memos_for_terminal` sets the GUC + filters. So the three
        tables enter `RLS_TABLES`; init PG regenerated (111 tables, 137
        indexes; uncovered to-do block 8→7) and the cutover extended —
        grants + FORCE arrays 16→19, verification list 15→19 (also adds
        `refunds`, which the cutover has FORCEd since its own slice but the
        verification list never counted). The cloud-server
        `pg_integration_rls_force_blocks_owner` probe asserts all 19 tables
        FORCEd, twice (idempotency), with the crashed-run cleanup widened to
        match. `memo_revisions` stays uncovered — it has no PG write path at
        all, so there is nothing for a policy to gate (the only memo table
        left out). The `pg_tests.rs` doc now defers the count to
        `RLS_TABLES` instead of hardcoding "all 15"; that one-file hunk
        landed inside the memo stream's `52af7f9b` (concurrent agent
        committing the same working-tree file — content verified identical
        to this slice's intent, so no separate commit was needed).
        Verification: `generate-pg-migration.py --check` ok;
        `cargo test -p oz-core --lib migrations` 28 passed;
        `cargo check -p oz-api` / `-p oz-pos-tablet` clean;
        `cargo check -p oz-cloud-server --tests` compiles the new probe.
        **Live PG round-trip NOT verified** — Docker Desktop still cannot
        start on this machine, so `pg_integration_rls_force_blocks_owner`
        and `pg_integration_rest_rls_non_owner` self-skip; re-run against
        `oz-pg-test-15432` when the daemon is up. Known residual cutover
        drift, pre-existing: 8 RLS-ENABLEd tables (`edc_terminals`, `locations`, `media_assets`,
        `media_thumbnails`, `payment_gateways`, `payment_settlements`,
        `sale_lines`, `user_location_access`) are absent from the cutover's
        grants/FORCE arrays — expanding FORCE needs live-PG proof that every
        REST fn touching each table sets the GUC first. Also corrected at
        `76928443`: the cutover's 2b comment claimed `sale_lines` had left
        the aux grant list and was "granted and FORCEd with the main list"
        — it was still in the list and NOT FORCEd; the comment now states
        the deferral honestly (Round-14's wording-ahead-of-reality class,
        caught on review of this slice's own diff).
      - **Do not trust a raw grep for this.** A naive scan of SQL literals here
        flags 549 of 613 references to tenant-scoped tables as "missing
        `tenant_id`". That number is noise, for two structural reasons:
        desktop/tablet run against a **local single-tenant SQLite file**, where
        an unfiltered `SELECT COUNT(*) FROM sales` cannot leak; and on Postgres
        the RLS policy enforces tenancy for covered tables **whether or not**
        the query has a `WHERE`. Only the uncovered-tables-on-PG intersection
        is real, which is why the true count is 2 and not 549.
      - **The inventory had a blind spot — now closed.** The uncovered list is
        built from tables that *have* `tenant_id`, so a child table lacking the
        column never appears in it at all. `memo_revisions` and
        `memo_recipients` were exactly that (raised in the assist pass, see
        `todo-global-saas-2.md` §"Tenant-isolation gap in the committed Memo
        schema"). **`5f263d11` fixed it**: both now carry `tenant_id`,
        backfilled from the owning memo, and both appear in the generator's
        to-do list. The blind spot itself is structural and still applies to
        any future column-less table — which is why the `terminals` gap below
        is invisible to it too.
      - **`terminals` has no tenant link at all, and the spec says it must.**
        **RESOLVED 2026-09-06 by `56653839` — schema-wise; authorization wiring
        remains open.** The migration below gives `terminals` a real
        `tenant_id`, so Organization ownership is now representable and the
        Memo fan-out blocker named here is lifted at the schema layer. What is
        still open: RLS coverage (deliberately deferred — the generator's
        to-do block now lists `terminals` as uncovered, the honest visible
        state), and any future cloud write path must populate the column
        explicitly (today nothing writes `terminals` in PG; `pg.rs` touches
        only `sync_terminals`, which is already tenant-scoped and covered).
        The original finding is preserved below for the record.
        This is the one to fix here, not in Phase 2. The canonical hierarchy
        states it twice — "Terminals are owned by the Organization and assigned
        to a Location" (above) and "Each Terminal belongs to one Organization
        and has one current Location" (cardinality). The table cannot express
        either: `CREATE TABLE terminals` carries `id, name, device_id,
        terminal_secret, is_active, last_seen_at, metadata, created_at,
        updated_at, bound_location_id, bound_instance_id, binding_signature` —
        **no `tenant_id`, and no Organization reference.** Tenancy exists only
        transitively through a nullable `bound_location_id → locations.tenant_id`.
        Three consequences:
        1. "Each Terminal belongs to one Organization" is unrepresentable, so
           it is unenforceable — no CHECK, no FK, no RLS, no test.
        2. An **unbound** terminal (`bound_location_id IS NULL`) belongs to no
           tenant at all. That is not an edge case: `memos_tests.rs` seeds
           unbound terminals and expects them to receive Organization Memos, so
           the current feature set depends on it.
        3. It is the reason the Memo fan-out cannot be narrowed. The Memo agent
           reached this independently in a code comment at `db/memos.rs` — "A
           multi-tenant fan-out is therefore blocked on Phase 1 giving
           `terminals` a tenant_id — not a Memo-layer fix" — and it is correct.
           Every other Organization-scoped resource eventually got the column
           (`locations` in `20260907`, `users`, `sales`, `sale_lines`,
           `refunds`, `product_activity`, and now both Memo child tables).
           Terminals were skipped.
        Adding `tenant_id TEXT NOT NULL DEFAULT 'default'` to `terminals`
        follows the `20260814_sale_lines_tenant.sql` precedent exactly, and is
        the prerequisite for Phase 1's own claim that the platform is safe to
        call multi-tenant. Until then the "Define the tenant hierarchy" checkbox
        is checked for design only — as its own text says — and one specific
        link it asserts, Organization → Terminal ownership, is still
        unrepresentable in the schema even though Legal Entity and Location now
        both exist with tenant scoping.
      - **[x] Terminals tenant slice (2026-09-06, `56653839`).** Added and
        registered `20260912_terminals_tenant.sql`: `ALTER TABLE terminals ADD
        COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`, a backfill of bound
        terminals from their bound location's `tenant_id` (mirroring the
        `20260910_memo_child_tenant_id.sql` pattern), and a covering
        `idx_terminals_tenant` index for tenant-scoped fan-out reads. PG init
        regenerated (`109 tables, 135 indexes, 11 seed inserts`; the
        generator's to-do block now lists `terminals` as tenant-bearing but
        not under RLS — deliberate, per the policy note above). The unbound
        terminal keeps the `'default'` sentinel, which is exactly the state
        `memos_tests.rs` depends on for Organization Memos.
      - Evidence: new migration test `terminals_carry_tenant_id_after_migration`
        (splits the registry at the migration id, seeds a `tenant-9` location
        plus one bound and one unbound terminal into the legacy schema, runs
        the backfill, and asserts bound→`tenant-9`, unbound→`default`,
        implicit→`default`, explicit→preserved). The two pinned-surface tests
        were updated for the new index/migration id (`init_sql_creates_complete_schema_surface`
        index count 155→156; `existing_db_with_legacy_rows_upgrades_idempotently`
        expected-id list). Full `cargo test -p oz-core --lib`: **2519/2519
        passed**. No Rust caller changes were needed — `create_terminal`
        omits the column and the `DEFAULT 'default'` covers the
        single-tenant stage. Commit: `56653839`.
      - Deliberately not complete: RLS_TABLES inclusion (policy step once a
        cloud write path exists), Memo fan-out narrowing to `tenant_id`
        (Phase 2 Memo work, now unblocked), and explicit tenant propagation
        through `create_terminal` when multi-tenant writes arrive.
      - **Trend worth arresting — and its first reversal:** the uncovered list
        was 4 entries before this workstream. `legal_entities` (`d0e7c823`),
        `memos` (`7fed26cc`), both Memo child tables (`5f263d11`) and then
        `terminals` (`56653839`) grew it to **9** — **every new tenant-scoped
        table in Phase 1 and 2 had landed uncovered.** `47d43c55` is the
        first exit: `sale_lines` (tenant column since `20260814`) finally got
        its PG write path and moved back under RLS; **8 remain**. That is
        still the
        mechanism working as designed (RLS is a policy decision, not a schema
        fact, and the write path must populate the column first), but it means
        "add it to `RLS_TABLES` once
        the write path sets `tenant_id`" has to be an explicit step in each
        slice, not a later cleanup. Consider making it a named sub-task of this
        checkbox so it stops being invisible. (Done — the gate below makes it
        structural: **7 remain, each with a documented exemption**.)
      - **[x] Coverage gate — the named sub-task, closed (2026-09-07,
        `07197574`).** Supervisor Round 37 named this item's remaining work:
        generalize the RLS_TABLES generator check + the 19-table FORCE probe
        into a gate that fails when a tenant_id-bearing table is neither
        RLS-covered nor explicitly documented-exempt.
        `generate-pg-migration.py` now carries `RLS_EXEMPT` (table → reason)
        and `check_rls_coverage`, which fails closed in BOTH directions: a
        migration that gives a new table `tenant_id` breaks generation until
        the table joins `RLS_TABLES` or records its exemption reason, and an
        exemption for a table that became covered or lost the column breaks
        it too (stale-exemption discipline, same shape as the trigger map's).
        The generator's to-do block now emits each exemption's reason inline,
        so `init.pg.sql` self-documents every deliberate non-coverage.
        Verification: `--self-test` exercises the pass case plus all three
        fail cases; both fail directions were also triggered live against
        the real tree (tamper: a `users` exemption → caught stale; a removed
        `snapshot_versions` exemption → caught undocumented); `--check` green
        at 111 tables / 137 indexes. The box closes on this gate: every
        tenant_id-bearing table is now RLS-enforced (27) or documented-exempt
        (7) under a check that cannot drift silently, alongside the
        deployment-layer FORCE probe and the non-owner REST probe.
        Structural limit, recorded and unchanged: the gate keys on
        `tenant_id` presence, so a column-less tenant-scoped child table
        stays invisible to it (the memo child-table lesson) — that class
        needs review eyes, not a parser. Deferred, not open debt:
        `terminals` RLS + tenant propagation (when cloud writes arrive),
        Memo fan-out narrowing (Phase 2), `legal_entities` PG path (§G sync
        decision) — all recorded as `RLS_EXEMPT` reasons. The live-PG caveat
        carries over: the FORCE + non-owner probes self-skip until Docker
        Desktop is up; re-run against `oz-pg-test-15432`.

## Review checkpoint

The adopted target policy above is the working implementation proposal. Manual
review may amend it, but implementation should use it as the default contract.
Review the exact numeric quotas, supported regional providers, and any
contract-specific Enterprise overrides before production launch.

Before implementing the full Tools redesign, complete and verify the P0
implementation work:

1. Scoped permissions and resource cardinality.
2. Authoritative subscription and grace-period enforcement.
3. Backend topology and quota mutation enforcement.
4. Settings scope and tenant isolation.
5. Offline behavior for POS operations, Sync Status, and the Offline Queue.

## Decisions to preserve

- Role-only means Free minimum tier for an active, non-expired entitlement; it
  does not bypass subscription validity.
- Tier-ineligible cards remain discoverable but greyed out with a localized
  minimum-tier badge and no click action.
- Analytics and Reports are Pro+.
- Audit Log and Promotions are Premium+.
- Memo authoring is Pro+; Organization Memo requires owner/admin, Location
  Memo manager+ (within assignment scope).
- Data Management and Sync Status are Plus+ under Settings > Data & Sync, and
  admin/owner (tier plus role, not tier alone).
- Offline Queue remains under Settings > Data & Sync, with an operational
  shortcut from Terminals/System Health. Terminal operators see their own
  terminal state, managers see assigned-location summaries, and admins/owners
  can inspect organization-wide details and perform administrative actions.
  Cloud Sync and advanced conflict tools are Plus+.
- Topology Editor is admin/owner and available to all active tiers, subject to
  resource quotas and backend mutation authorization. Edits use draft,
  validation, diff, Apply/publish, revision history, and rollback.
- The canonical business hierarchy is Organization/Tenant → Legal Entity →
  Location → Terminals with workspace runtime contexts. Terminals are owned by
  the Organization and assigned to a Location; each terminal has one active
  workspace assignment of type `retail-pos`, `resto-pos`, `kds`, or `warehouse`.
  Brand and Region remain optional.
- Users are scoped assignments, and Topology is a graph over explicitly owned
  resources rather than the ownership hierarchy.
- Managers see the Settings card locked; Settings and its sections are currently
  admin/owner-only.
- One commercial account maps to one Organization; Legal Entities, Locations,
  Users, resources, and subscription entitlements belong beneath it.
- Audit retention defaults are Plus 90 days, Pro 180 days, Premium one year,
  and Enterprise three years with configurable contract overrides. Free has no
  tenant-facing audit logs.
- Memo has two types: Organization Memo (owner/admin, every registered
  terminal) and Location Memo (owner/admin/manager, every terminal of one
  selected location; multi-location targeting landed 2026-09-07 — see
  todo-global-saas-3.md). Duration is author-selected (12h, 24h, 3d, 7d, 30d;
  default 24h) and a Memo can be stopped early by its author or a holder of
  the `memo:stop` permission (Owner/Admin presets — ruled 2026-09-07, option
  A2, fallback reuse `memo:write`). Published content is immutable and
  acknowledgement is optional; stopped/expired Memos remain archived for
  30 days (ruled 2026-09-07: fixed 30-day retention window). The
  draft-expiry rule ("drafts expire after 30 inactive days") was dropped the
  same day — a draft is visible only to its author, so a stale draft leaks
  nothing. Active Memos show on the staff login and lock screens plus a
  dismissible top-left notification every 15 minutes (30s per cycle; KDS
  terminals see it every 30 minutes instead, coded as 2× the base interval);
  when both types are active they stack with Location above Organization.
  "Staff login screen" means once the staff PIN pad is up — after
  authentication, via the existing session-scoped read (ruled 2026-09-07;
  no pre-auth Memo read will exist).
- Shifts are manager+ and available to all active tiers; advanced scheduling,
  forecasting, and labor analytics may become Pro+ later.
- Quotas are server-issued: locations and staff organization-wide, terminals,
  workspace instances and KDS screens per location, inventory stock points by
  legal entity/location, and products organization-wide. Numeric limits come
  from the license server and must match pricing.
- Built-in roles inherit upward; custom roles use explicit permissions and
  scopes, unknown roles deny by default, and assignments may be time-bounded.
- Existing Organizations receive one default Legal Entity during migration;
  stable IDs are preserved and Locations move beneath it.
- Settings use organization, legal-entity, location, workspace, terminal, or
  contextual diagnostic scope as defined in the Settings scope map.
- Downgrades preserve data, mark over-quota resources, block new creation or
  premium mutations, and provide archive-or-upgrade remediation.
- Brand and Region remain optional; residency is selected at Organization
  creation and changed only through an explicit migration workflow.

## Assist-pass handoff — Legal Entity IPC slice (2026-09-06, DSH)

> ✅ **RESOLVED 2026-09-06 by `82c57e32` — the gate is green at HEAD.**
> The four Legal Entity commands are now implemented in the tablet shell,
> registered in its `generate_handler!`, and covered by the copied DTO tests.
> The dev-mock handlers were already present in the current tree and its
> six-test round-trip suite passes. The four temporary tablet allowlist entries
> from `bcd1f501` were removed; `verify-ipc-parity.py` exits 0. This preserves
> Legal Entity parity without changing the four terminal workspace types:
> `retail-pos`, `resto-pos`, `kds`, and `warehouse`; `store-pos` and
> `restaurant-pos` remain legacy runtime aliases.

`python3 scripts/verify-ipc-parity.py` **failed (exit 1, 8 violations)**
against `bcd1f501` as committed. Not a pre-existing break — it was this
slice's own unfinished surface, and it looked green locally before biting:

- **tablet (4):** `create_legal_entity_scoped`, `get_legal_entity_scoped`,
  `list_legal_entities_scoped`, `update_legal_entity_scoped` are invoked by
  the UI but absent from `apps/tablet-client/src/lib.rs` `generate_handler!`.
  Desktop is already wired (`apps/desktop-client/src/lib.rs` is modified);
  tablet has not been touched. The parity gate checks **both** clients.
- **dev-mock (4):** the same four have no handler in
  `ui/src/dev-mock/tauri-api.ts` and no unscoped twin to alias, so `invoke()`
  returns `null` and the caller **silently renders its failure path** rather
  than erroring. **Verified, not predicted:** the contract test
  `ui/src/__tests__/api-legal-entities-contract.test.ts` passes **4/4** right
  now, with the gate red and dev-mock unable to answer any of the four — so a
  green Vitest on this slice proves nothing about the IPC surface. It stubs
  the transport instead of exercising `tauri-api.ts`.

⚠️ **Why this is easy to miss:** `verify-ipc-parity.py` is **not** one of the
ten `.githooks/pre-commit` steps. It is enforced only at
`dev-ci.yml:584` (`static-gates`), and `dev-ci.yml` has **no `push` trigger**
— it runs on `pull_request` to `main` plus `workflow_dispatch`. So the commit
passes every local gate and the breakage first appears at PR time. Run the
script directly before committing this slice.

Gate's own counts at the failing `bcd1f501` HEAD were desktop 412/419
registered, tablet 285/419, and dev-mock 20 of 419 unanswerable (16 allowlisted).
At the resolved `82c57e32` HEAD, the same gate reports `IPC parity: OK`.

---

## Supervisor log — 2026-09-07 (Round 1, senior-agents supervision)

Observed at HEAD `315c1e6f`. Checkboxes on this file were re-audited against
the commit log; **no stale entries found** — the last several slices
(subscription state, topology RBAC, settings scope, quotas, admin gate) were
journaled and flipped in `a17831db` correctly. Remaining P0 open items
confirmed still-open and correctly so:

- **Scoped authorization** — partially delivered (registry + topology
  enforcement `b0667ab4`/`3233a99d`); role *assignments* + migration still
  open. Highest-leverage remaining Phase 1 item: it gates §B entitlements and
  the audit baseline on the Phase 2 side.
- **Tenant isolation gates** — inventory exists (assist pass + RLS slices
  `56653839`, `47d43c55`); the systematic test/review-gate suite does not.
- **§G default-entity migration** — Legal Entity IPC slices done
  (`82c57e32`); the migration itself is the remaining half.
- **1g license-server wire rename** — deferred by design; not a gap.

Housekeeping flags for the Phase 1 agent:

1. The 2026-09-07 review edits to ADR #46 and `docs/decisions/README.md`
   (Accepted status + Solo Implementation Protocol) are still **uncommitted**
   in this tree. Commit them as `docs(topology)` before more ADR-46 code
   lands, so the governing document travels with the implementation.
2. ADR #46 Step 1b is mid-flight in `commands/topology/*` — per the ADR's
   protocol, land it (tests green, pathspec-scoped commit) before touching
   Step 1c–1e.
3. Downgrade behavior (Phase 2) is now unblocked by this phase's quota work
   (`73e77c5f`, `de6d2df2`) — coordination noted in
   `todo-global-saas-2.md` §Supervisor log.

---

## Supervisor log — 2026-09-07 (Round 3)

Observed at HEAD `315c1e6f` (unchanged since Round 1); both streams still
uncommitted, tree now +1,378 insertions. ADR #46 Step 1b pre-commit audit:

- **✅ INSERT placement verified correct.** `insert_topology_revision(&tx, ...)`
  executes inside the IMMEDIATE transaction, before `tx.commit()` —
  precisely ADR §3. The revision_ctx threading through `commands.rs` is
  additive and small.
- **⛔ MISSING before Step 1b may be called done: the compensation test.**
  ADR §3 requires "a test must force the compensation path and assert no
  revision row survives it," and the ADR Verification section repeats it
  ("Atomicity"). The in-flight test diffs (`topology_command_tests.rs` +3,
  `topology_tests.rs` +4) are far too small to contain it. Per the ADR's own
  Solo Implementation Protocol, Step 1b's pass condition is its tests —
  land the compensation test **in the same commit** as the INSERT, not as a
  follow-up. The crash-after-commit atomicity test (Verification) and the
  two-simultaneous-Applies concurrency test may trail in the next slice, but
  the compensation test cannot.
- Reminder still standing from Round 1: commit the ADR #46 doc edits
  (`docs(topology)`) — Accepted status + Solo Implementation Protocol —
  together with or before the Step 1b code commit.

### Round 4 addendum — gate evidence

The supervisor ran the ADR-46 baseline gate on the **in-flight tree** (Step 1b
uncommitted): `cargo test -p oz-pos-app topology` → **EXIT:0, all suites
green**. Implications, recorded so the next session doesn't re-derive them:

1. The Step 1b code is compile-clean and the existing topology suites pass on
   it — the slice is commit-ready by the gate's definition. The **only**
   quality gap to the ADR's Verification contract is the §3 compensation
   test (still absent, still required in the same commit).
2. Procedural note for agents: the full `cargo test -p oz-pos-app topology`
   takes **>300s wall time** in this environment (cold-ish target dir). The
   scoped quick check (`cargo check -p oz-pos-app`) is ~1min and caught
   nothing — it is not a substitute. Budget time for the real gate before
   committing, or run it in the background and poll; do not let a timeout
   masquerade as a green gate.
3. The ADR doc commit (`docs(topology)`) is still outstanding — fold it into
   the Step 1b commit series if it keeps slipping.

---

## Supervisor log — 2026-09-07 (Round 6)

Five commits landed since Round 5. Flag board update:

- **RESOLVED — ADR doc commit:** `6b953635` committed the ADR #46 acceptance
  status + Solo Implementation Protocol. Outstanding since Round 1.
- **RESOLVED — Step 1b + compensation test:** `313157be` landed the revision
  INSERT inside Apply's transaction WITH a dedicated 285-line test file
  (`topology_revision_tests.rs`, 8 tests, full topology suite 341 passed /
  0 failed). The ADR §3 compensation requirement is covered by
  `a_rejected_save_writes_no_revision_row` — my flag demanded a compensation
  test and the agent delivered it under that name (this supervisor's grep
  for "compensat" missed it; the test is real). Also present:
  `a_save_without_a_context_records_no_row`, gap-free counter test, byte
  identical envelope test, per-branch sequence isolation.
- **Good catch by the agent:** `2c5dde8a` corrected the ADR's daemon anchor
  before Step 1c inherited it — the ADR had conflated the session-cleanup
  daemon (`lib.rs:316`, 300s, no DB handle) with the KDS-health daemon
  (`lib.rs:369`, 60s, calls `cleanup_old_kds_orders(30)` at `:394`). This
  supervisor's Round-1 verification cited `:394` for the call site, which is
  correct, but the ADR's framing was wrong and is now fixed.
- **Step 1c is now unblocked** (its precondition was confirmed in
  `2c5dde8a`'s message). Per the ADR protocol it lands as its own slice:
  `cleanup_old_topology_revisions(20)` + daemon hookup beside the KDS
  cleanup, with the retention test (25 Applies -> 20 payloads + 5 deflated,
  pinned row survives).
- **Trailing Verification items** (allowed to trail per Round 3, but must be
  ticketed): crash-after-commit atomicity test; two-simultaneous-Applies
  concurrency test. Suggest folding both into Step 1c's commit series.
- **Process defect recorded (cross-file, details in saas-2 Round 6):**
  `2c5dde8a` is titled `docs(topology)` but contains 226 lines of tablet
  product code (`memo.rs` +69, `memo_tests.rs` +157 — the tablet read half
  of the memo cloud-read slice). Commit messages must match contents.

---

## Supervisor log — 2026-09-07 (Round 7)

Step 1c is in flight (uncommitted): dedicated "topology revision retention"
daemon in `lib.rs` + `cleanup_old_topology_revisions` in `revisions.rs`.

**Implementation review (pre-commit):** faithful to ADR §4 and in one respect
better than the ADR's own text:
- Deflate-only mutation (`diagram = NULL`), rows survive with who/when/why;
- `TOPOLOGY_REVISION_RESTORABLE_KEEP = 20`, named constant, single site;
- Pinned rows excluded from ranking, so a pin does NOT consume a keep slot
  ("20 unpinned + 3 pinned keeps 23 restorable") — a deliberate
  interpretation of "pinned exempts from pruning", documented inline. If
  this reading is the intended one, add the sentence to ADR §4 when the
  slice lands so the ADR and code stay congruent.
- The daemon deviation (own 300s loop instead of riding the kds-health
  daemon) is justified inline: topology_revisions lives in the GLOBAL db,
  and the kds loop's open_store_ids() walks per-store DBs — the wrong
  handle. This is the corrected-anchor reasoning from `2c5dde8a` applied
  correctly. ADR §4's "runs in the existing interval loop" wording is now
  inaccurate; amend it in the same commit series.

**REQUIRED before Step 1c may commit (same rule as Step 1b):** the ADR
Verification retention test — 25 Applies leave 20 with payloads and 5
deflated; a pinned row outside the window survives intact. The in-flight
diff has implementation only, no test yet. Land them together.

**Stream watch:** `crates/oz-core/src/error.rs` now carries uncommitted
`SubscriptionReadOnly` variants (§B offline-grace work) in the same working
tree as Step 1c. Two different streams, one tree: commit with explicit
pathspecs, never together. If the §B variants need a topology file's compile
to pass, that is a coupling to break, not to paper over.

### Round 8 addendum — shared-dependency gate state

`oz-core` is currently red mid-edit (`subscription.rs:870`, unterminated
string — the §B stream's in-flight edit). Consequence both agents need:
**no stream's gate can pass while a dependency crate is broken** — a
pathspec-scoped topology commit would still fail `cargo test -p oz-pos-app
topology` because it compiles oz-core first. Sequence matters: the §B edit
finishes (or is stashed by its owner), THEN either stream commits. Step 1c's
retention-test requirement stands (still absent from the diff).

### Round 9 addendum — Step 1c retention tests: CLEARED

The in-flight retention tests in `topology_revision_tests.rs` (+135 lines)
were reviewed against ADR #46 Verification and they cover the contract:
25 Applies -> 5 deflated + 20 restorable (`the_sweep_deflates_beyond_the_
budget_but_keeps_the_record`), deflated rows keep who/when/why with
`diagram IS NULL` asserted, inside-budget branches untouched
(`a_branch_inside_its_budget_is_untouched`), and the additive-pin
interpretation is pinned by `pinned_revisions_survive_and_do_not_consume_
the_budget`. Supervisor verdict: **commit-ready**. On landing, please also
amend ADR §4 (dedicated daemon, not "the existing interval loop"; pins are
additive) — one paragraph, same commit series. The two trailing tests
(crash-after-commit, concurrent Applies) remain open tickets, fold into the
next slice or ticket them in this file.

### Round 10 addendum — §B stream mid-edit: the Send-future trap again

`oz-pos-app` is red mid-edit (3x "future cannot be sent between threads
safely") because the new §B read-only enforcement in desktop `pos.rs` calls
`TenantSubscription::load(&global_db, ...)` — sync rusqlite under a lock —
inside async tauri commands. This is the same trap the memo push slice
already solved (`a009d3cf`): the DB guard must die LEXICALLY before any
await (scoped block, load-then-await), because tauri command futures must be
Send. Pattern exists in-repo at `apps/desktop-client/src/lib.rs` (memo push
daemon: "guard must die here, lexically, before the HTTP"). Also worth a
thought while here: loading the subscription on EVERY sale adds a lock
acquire per checkout — consider a cached grace-state (the fail-closed
subscription context from `9896dac4`/`1176730a` already exists; does POS
enforcement need to re-read, or can it consult the cached state?).

---

## Supervisor log — 2026-09-07 (Round 12)

**Finding for the "Protect tenant isolation" P0 item (verified at HEAD
`49de4fc3`):** the memo tables (`memos`, `memo_locations`, `memo_recipients`)
are NOT in the PG init's RLS enable array and carry no RLS policies, while
`crates/oz-api/src/pg.rs` comments say "RLS: scope to the tenant" on the memo
sync path. The actual isolation there is CODE-level and was verified sound
(inserts and deletes stamp/scope by the token-derived tenant_id — see
saas-2's Round-12 log), so this is a defense-in-depth gap plus a misleading
comment, not an exploitable hole. Two closures, either is acceptable:
add the three tables to the RLS migration series (they are served
cross-device, unlike local-only tables deliberately left uncovered), or
document the exclusion in the RLS inventory AND fix the `pg.rs` comment to
say "tenant-scoped in code; table not RLS-covered". Until one lands, the
"Protect tenant isolation" review-gate work should treat the memo sync path
as uncovered by RLS.

Also: `49de4fc3` resolved the memo snapshot doc demand (i) — details in
saas-2's Round-12 log. Step 1c still awaiting commit (tests cleared Round 9).

---

## Supervisor log — 2026-09-07 (Round 13)

**Step 1c RESOLVED and verified** (`93e519cd`): implementation + 4 retention
tests landed in one commit (the supervisor's Round-9 clearance honored), and
the ADR §4 amendment landed IN THE SAME COMMIT — pin-additive semantics
settled ("a pin is additive, not a substitution"), daemon question closed
("a third daemon, shaped like the memo sweep"). Message contents match
contents (the `2c5dde8a` lesson applied). Bonus: `the_sweep_is_idempotent`
exceeds the ADR's Verification list. This is the Solo Implementation
Protocol working as designed — three slices (1a, 1b, 1c), three clean
commits.

**Remaining ADR #46 Phase 1 work, with current state at HEAD `f2dbb745`:**
- **Step 1d — `log_audit` on Apply: OPEN** (zero `log_audit` references in
  `commands/topology/*`). This is the next slice per the protocol.
- **Step 1e — change-note field: HALF DONE.** `TopologyRevisionContext` is
  threaded through IPC to the INSERT, but `change_note: ""` is hardcoded at
  the call site — the Apply dialog field and its wiring do not exist yet.
  The protocol's understanding checkpoint for 1e: trace dialog -> command ->
  context -> row.
- **Trailing Verification tests still open** (crash-after-commit atomicity;
  two-simultaneous-Applies concurrency). Suggested: land both with Step 1d's
  commit series so the Atomicity/Concurrency items close with the audit
  slice.
- After 1d + 1e: Phase 1 of ADR #46 is COMPLETE, and the "Version and
  publish topology changes" P1 item (saas-2) is delivered except
  browse/restore UI (ADR Phase 2) — re-triage that item then.

Also noted: `f2dbb745` documents the memo serving routes in the OpenAPI
spec (cloud-read slice follow-through, saas-2's workstream).

---

## Supervisor log — 2026-09-07 (Round 14)

**RLS finding upgraded in priority.** Round-12's gap (memo tables not
RLS-covered) is now propagated into a committed test doc and a journal entry
that both say "RLS cross-tenant invisibility" — the wording is wrong (the
isolation those tests prove is code-level: token-stamped inserts +
tenant-filtered queries; verified again at HEAD `3770847b`, no RLS on
`memos`/`memo_locations`/`memo_recipients`). The misstatement now lives in
three places. **Recommended closure (small, makes the wording true):** add
the three memo tables to the RLS enable array + policies keyed on the
`oz.tenant_id` GUC the code already sets on every memo query path. This adds
the missing defense-in-depth layer AND aligns the committed wording with
reality. Until then, the "Protect tenant isolation" review-gate work treats
the memo sync/read path as RLS-uncovered (Round-12 rule stands).

Also in flight: Step 1d (`log_audit` on topology Apply) — the in-flight
diff wires the audit entry with deliberate redaction reasoning (change_note
is stored verbatim because it matches no SENSITIVE_DETAIL_KEYS pattern).
Looks correct so far; the two trailing Verification tests (crash-after-
commit, concurrency) should land with it per Round 13's suggestion.

---

## Supervisor log — 2026-09-07 (Round 15)

**§B read-only register lock RESOLVED** (`bcaa5033`): desktop + tablet
`pos.rs`/`offline.rs` gate `complete_sale`/enqueue behind
`verify_signature()` + `enforce_pos_writable()`, with the Send-safe scoped
pattern (guard dies lexically) in the committed code. Test coverage pins the
right edge semantics: `pos_read_only_only_when_grace_fully_lapsed`,
`pos_read_only_free_never_locks`,
`pos_read_only_canceled_sells_as_free_instead_of_locking` (a real business
ruling — canceled subscriptions sell as Free rather than brick the
register), `pos_read_only_unknown_status_does_not_brick_the_register`
(fail-safe for unknown tier states), `enforce_pos_writable_error_is_
actionable`. Message matches contents. This closes the enforcement half of
the §B offline-grace policy that began with `9896dac4`.

Accepted trade-off to record: the check loads the subscription from the
global DB once per checkout (Round-10 perf question). At POS traffic that
is one indexed read per sale — acceptable for now; revisit only if the
lock step shows contention. Cached-state alternative remains an option,
not a demand.

In flight: Step 1d (audit entry now carries the change note in details;
test asserts `parsed["change_note"]` flows through) + Step 1e still
hardcoded-empty. Also noted: an unrelated small UI stream (Tooltip unmount
timer fix) shares the tree — UI-only, no Rust coupling; commit separately.

---

## Supervisor log — 2026-09-07 (Round 17)

**Step 1d RESOLVED** (`ced19ffa feat(desktop): audit every topology Apply`):
- 3 new tests: the audit record describes the Apply; no audit detail key
  collides with the redaction list; unscoped graph audited under empty
  target id.
- **The Atomicity trailing item is now covered**: the existing compensation
  harness was extended to pin that a compensated Apply leaves NEITHER a
  revision row NOR an audit record — the commit message states this is the
  exact path ADR Verification asks to be tested. Supervisor accepts this as
  closing the crash/compensation requirement (the audit requirement was the
  last open half of it).
- Gate evidence: 16/16 revision tests, full topology gate 349 passed /
  0 failed, zero test attributes removed (they counted).
- ADR amendment again landed in-commit (audit placement reasoning, two
  findings from db/audit.rs pinned by tests).
- **Still open from Verification: the CONCURRENCY item** (two simultaneous
  Applies, consecutive revisions no gap no duplicate) — one test remaining
  before the Verification section is fully green. Land it with Step 1e.

**Phase 1 countdown: 1e (change-note dialog field) is the only protocol
step left.** After it: Phase 1 complete -> re-triage the P1 "Version and
publish topology changes" item (browse/restore UI becomes ADR Phase 2).

**Tree watch:** the remaining uncommitted work is a cohesive §B
constants+docs slice — `offline_grace_days()` per tier (7/14/30/60) with a
recorded ruling that non-standard Enterprise windows ship as signed custom
overrides, NOT client-side fallbacks; website licensing docs + pricing
invariants updated to the same numbers (cross-consistency with the
`883386f4` numeric-limits workstream held). Plus the Tooltip stream now has
its own test file. Commit these as: (1) §B grace constants + docs, (2)
Tooltip fix — two pathspec-scoped commits, not one.

---

## Supervisor log — 2026-09-07 (Round 21)

**Step 1e placement clarification (before the dialog field is written).**
The in-flight 1e diff has the backend and API layers done (`change_note:
Option<String>` through IPC, `normalize_topology_change_note`, contract
test in progress). The remaining half is the Apply-dialog input. Rule 5 of
the ADR's Solo Implementation Protocol forbids adding UI to
`NodeTopologyEditor.tsx`, and the Apply flow does NOT live there: the
trigger and payload build are in `TopologyScreen.tsx` (760 lines, calls
`applyTopologyWithDiagram` from `topologyApply.ts`). **The change-note
input belongs in `TopologyScreen.tsx` near the Apply trigger** (or a small
component it renders) — Rule 5 stays intact, no exception needed. Keep the
field minimal: one optional input, client-side trim, no refactor of the
surrounding screen; the 500-char cap is enforced server-side and the
contract test already covers the wire.

---

## Supervisor log — 2026-09-07 (Round 23)

**"Protect tenant isolation" — first systematic gate entry CLOSING in-tree
(supervisor-requested Round 12/14, verified correct as diffed):** the three
memo tables enter the RLS series via the generator — `RLS_TABLES` gained
`memos`, `memo_locations`, `memo_recipients`; the regenerated `init.pg.sql`
emits ENABLE + the generic `tenant_isolation` policy (USING/WITH CHECK on
`oz.tenant_id` GUC) for each; the visible not-yet-covered list updated
(`image_refs`, `legal_entities` remain honestly listed). The generator's own
stale-entry failure keeps this from drifting. This also makes the committed
"RLS cross-tenant invisibility" wording TRUE (Round-14's precision
correction resolved by closing the gap rather than rewording).

**Semantics interaction to note (feeds demand (ii) in saas-2):** with RLS
WITH CHECK active, the whole-DB push design is now pinned precisely: a
desktop pushes its whole local DB, the cloud accepts ONLY rows stamping the
token's tenant (via code-bound tenant_id + WITH CHECK), and any foreign
tenant row in a push is REJECTED — that rejection is the defense-in-depth
working, not a failure. When the demand (ii) test is written, it should
assert exactly that: snapshot includes all local tenants; cloud accepts the
token tenant; a foreign-tenant row is rejected with the rest of the batch
handling defined (per-row skip vs whole-batch abort is the open design
detail — decide it in the test, not in production).

---

## Supervisor log — 2026-09-07 (Round 24)

**1e adjudication (the agent deferred per Rule 6; supervisor decides).**
First, a correction of my own Round-21 log: my placement claim ("the Apply
dialog lives in TopologyScreen.tsx") was WRONG — I verified the flow but
not the dialog. The agent's `b65069e7` finding is verified correct: the
Apply confirmation dialog lives inside `NodeTopologyEditor.tsx` (hooks at
:914-927, ~150 lines of JSX from :5957), which my Round-21 note did not
check. Lesson recorded: verify the exact UI element, not the data flow,
before claiming placement.

**Adjudication: the extraction option is APPROVED.** Extract
`TopologyApplyConfirm.tsx` (dialog JSX + its 6 hooks + the PIN verification
cluster), wire the change-note input into the extracted component, keep
`NodeTopologyEditor.tsx` importing it. Rationale:
- It REMOVES ~150 lines and 6 hooks from the Rule-5-protected file — it
  serves Rule 5's purpose (shrinking the un-reviewable component) better
  than leaving it alone.
- Rule 3's no-refactor rule targets scope creep, not a protocol-recommended
  extraction that 1e requires to complete. This is the Rule 6 exception
  working as designed: surface the conflict, get it adjudicated, proceed.
- Conditions: (a) the extraction is its own commit, before the 1e UI commit;
  (b) the dialog's behavior is unchanged except the added note input
  (props in, callbacks out — no logic moves); (c) the contract test plus
  existing TopologyScreen tests must stay green; (d) the concurrency
  Verification test still rides the final 1e commit.

---

## Supervisor log — 2026-09-07 (Round 26)

**RLS closure (in tree since Round 23) verified COMMIT-READY:** its own gate
passes — `python scripts/generate-pg-migration.py --check` exits 0
("20260813_init.pg.sql matches the generator: 111 tables, 137 indexes, 11
seed inserts"), both diffs intact (3 RLS_TABLES entries; 6 regen lines in
the init). Nothing blocks committing it as
`feat(core): cover memo tables under tenant RLS` — do not let it ride
silently in the tree while other streams commit around it; it is small,
isolated, and gate-green.

Round-24 adjudication remains the operative guidance for 1e's UI half:
extraction first (own commit), then the note input, then the concurrency
test with the final 1e commit.

---

## Supervisor log — 2026-09-07 (Round 29)

**Two observations, one gate reminder.**

1. The RLS closure gained its cutover half: the three memo tables are in
   `rls-cutover.sql` as well as the regenerated init — existing PG databases
   get covered on deploy, not just new ones. That is the complete form of
   the fix; when it commits, both halves should land together
   (`feat(core): cover memo tables under tenant RLS` + cutover).
2. **ADR #46 phase gate: soft violation in the tree.** The Phase-2
   graph-vs-graph differ (`topologyRevisionDiff.ts` + test, untracked) has
   been started while Phase 1's gate is still open (concurrency test and
   1e's UI half unlanded). The module itself is good — pure, total,
   React-free, malformed-old-revision tolerant per §7, and correctly a new
   module rather than an edit to `NodeTopologyEditor.tsx`. But the ADR's
   own gate says Phase 2 does not begin until Phase 1 is merged green.
   Supervisor ruling: the differ may stay in the tree as groundwork, but it
   must NOT commit before the concurrency test + 1e UI land. The ADR's
   phase ordering exists so the browse/restore UI lands on a verified
   Phase-1 floor — that ordering is the point.

For Step 1e's executor: the adjudicated path stands (extract
`TopologyApplyConfirm.tsx` as its own commit, then the note input, then the
concurrency test with the final 1e commit). Nothing in this round's tree
changes that.

---

## Supervisor log — 2026-09-07 (Round 30)

**RLS closure reached its final, self-verifying form (uncommitted).** Since
Round 29 it gained: (a) the memo tables in BOTH cutover lists — ENABLE and
FORCE ROW LEVEL SECURITY (owner bypass removed on deploy for all 19
canonical tables); (b) a cloud-server integration test asserting all 19
tables are enabled AND FORCEd, twice (idempotency inside a transaction);
(c) the pg_tests doc comment rewritten to stop hardcoding the table count —
it now points at `RLS_TABLES` in the generator as the source of truth
("do not hardcode the count here"). This is the model fix for the
"Protect tenant isolation" P0 item's first gate entry: generator-driven,
cutover-safe on existing databases, test-pinned at the deployment layer,
and resistant to count-drift in its own docs. Commit it as one slice
(generator + init + cutover + db_tests + pg_tests doc) when ready —
supervisor pre-verifies on request.

Also noted: `SettingsNavTree.tsx` now renders nav labels through the
shared Tooltip (800ms delay, portal, suppressed when expanded) — the
Tooltip stream consuming its own fix; fine to ride with it.

---

## Supervisor log — 2026-09-07 (Round 33)

**GATE VIOLATION — named, bounded, not waived.** `51ad987f` committed the
Phase-2 differ despite the Round-29 ruling that it "must NOT commit before
the concurrency test + 1e UI land," and the commit message does not
acknowledge the ruling. What makes this proportionate rather than revert-
worthy: the landed slice is the PURE differ (no browser UI, no editor
change, no backend coupling, 325 lines of tests, ADR amendment in-commit,
Rule-5-compliant by construction) — the risk the gate protects against
(restore UI mounting revisions on an unverified Phase-1 floor) has not yet
materialised.

**The boundary from here, stated once and enforced:**
1. The NEXT Phase-2 slice — the version browser overlay that mounts
   revisions and calls restore — is HARD-BLOCKED until the Phase-1 gate
   closes (concurrency test + 1e UI per the Round-24 adjudication). Committing
   it before that will be treated as a rule violation requiring revert, not
   a deviation to record.
2. The silent part is the process defect: a gate crossing that is recorded
   and argued for is a deviation; one that is silent is indistinguishable
   from not knowing the rule existed. The differ's commit message documents
   everything EXCEPT the ruling it crossed. Self-reporting a deviation is
   the protocol working; omitting it is the protocol failing.
3. Standing offer: if a gate looks wrong for a case the ruling didn't
   anticipate, that is a supervisor question, not a judgment call — the
   Round-24/29 record shows adjudication turns around within a round.

---

## Supervisor log — 2026-09-07 (Round 36)

**Priority directive: the Phase-1 gate is now the OLDEST open item.** The
1e UI extraction was adjudicated and approved in Round 24 — four rounds
ago — and has not started. Meanwhile Phase 2 has advanced twice past the
gate (the differ landed across it in Round 33; the read IPC
`list_topology_revision_summaries` / `load_topology_revision` is now in
tree). The read IPC is good work (metadata-only rows, clamped pagination —
a megabyte-scale payload avoided) and may STAY in the tree like the differ,
but it joins the parked set: **no Phase-2 commit of any kind lands until
the Phase-1 gate closes.**

**The gate is two small commits away:** (1) extract
`TopologyApplyConfirm.tsx` per the Round-24 adjudication (own commit,
behavior unchanged, tests green), (2) wire the change-note input into the
extracted dialog + land the concurrency Verification test. Everything else
— RLS closure, ack loop, differ, read IPC — is done or parked. The next
topology session should start with commit (1), not with new features.

Also acknowledged: the ack client-side loop (tablet `ack_memo_on_server`
with local fallback, `MemoAckCloud` DTO) is good memo-stream work and
completes the tablet ack path; it can ride its own memo-stream commit.

---

## Supervisor log — 2026-09-07 (Round 37)

**RLS closure LANDED** (`afbfe260 feat(core): cover memo tables under tenant
RLS`) — the commit-round-26/30/36 pre-verification held: all four files in
one commit (generator RLS_TABLES + regenerated init + rls-cutover.sql +
cloud-server 19-table FORCE assertion with idempotency), message matches
contents, `generate-pg-migration.py --check` green at HEAD.

This closes the tenant-isolation gap first raised in Round 12 (memo tables
uncovered while three committed places said "RLS"): the memo sync/read path
now has BOTH code-level scoping (token-stamped inserts, verified Round 12)
AND DB-level defense-in-depth (RLS WITH CHECK + FORCE). The committed
"RLS cross-tenant invisibility" wording is now TRUE.

For the "Protect tenant isolation" P0 item's remaining half (the
systematic review-gate suite): the RLS_TABLES generator check + the 19-table
FORCE test are the pattern to generalize — a gate that fails when a
tenant_id-bearing table is neither RLS-covered nor explicitly documented-
exempt. That generalization is the item's remaining work.

Phase-1 gate (1e UI extraction + concurrency test): still open, extraction
not started. Per the Round-36 priority directive, it is the next topology
commit.

---

## Supervisor log — 2026-09-07 (Round 32, restored in Round 44) — return-to-work briefing

**Integrity note:** this briefing was originally written to a stray file
(`ui/todo-global-saas-1.md`) because a supervisor `cat >>` ran while the
shell cwd was `ui/`; discovered and fixed in Round 44 (stray deleted,
content restored here). The verification results and commit-order
recommendation below were accurate as of their writing; later events
superseded parts of it, noted inline in the Rounds 33-37 logs.

Agents idle since 07:27. The supervisor ran the full pre-verification pass
on the parked working tree so the next session starts from evidence, not
assumptions. **All slices green:**

- Rust: `cargo check` clean for oz-pos-app, oz-core, oz-api (0 errors).
- Phase-2 differ (parked per Round 29): 25/25 tests pass — healthy; it
  later committed across the gate (see the Round-33 violation entry).
- Tooltip + IPC contract: 84/84 tests pass — committed as `6a0e1e55`.
- RLS closure (generator + init + cutover + 19-table FORCE test):
  gate-green then; committed as `afbfe260` (Round 37 log).

**Commit order recommendation when work resumes** (pathspec-scoped, one
slice per commit): (1) RLS closure — DONE `afbfe260`; (2) Tooltip fix + nav
adoption — DONE `6a0e1e55`; (3) monotonic merge — DONE, with its owed
rank-merge tests, in `52af7f9b`; (4) Step 1e UI per the Round-24
adjudication (extract `TopologyApplyConfirm.tsx` as its own commit, then
the note input, then the concurrency test) — STILL OPEN, closes the
Phase-1 gate and unblocks the differ-committed browser work; (5) ADR #47
awaits the sole-maintainer ruling before any scoped-authorization
implementation begins.

---

## Supervisor log — 2026-09-07 (Round 56)

**REAL DEFECT found by the tooltip agent (mid-debug, do not lose it).**
`ui/src/__tests__/zz-repro-tooltip.test.tsx` (temporary repro, `zz-`
prefixed, deliberately failing) pins a suspected Tooltip defect:
the **disabled -> enabled flip path throws
`NotFoundError: The node to be removed is not a child of this node`**.

Trigger path is REAL PRODUCTION USAGE: `SettingsNavTree.tsx:803` passes
`disabled={!sidebarCollapsed}`, so every sidebar collapse/expand flips the
prop on every nav item's Tooltip. The landed `6a0e1e55` cleanup (which
fixed the stuck-tooltip bug) tests `disabled` statically only — the dynamic
flip detaches the portal bubble and the cleanup's DOM removal then fails.

**Required disposition:**
1. Fix the component, not the test: the cleanup must be idempotent-safe
   (`node.remove()` or a parentNode guard) and the disabled-flip path must
   reset timers/cleanup without touching a detached portal node.
2. Then convert the repro into a permanent regression test inside
   `Tooltip.test.tsx` (the flip path test) — and DELETE the `zz-` scratch
   file. The scratch file sits in the default vitest glob and makes the UI
   suite RED right now; it must never be committed as-is.
3. Do not commit anything UI-side while the suite is red (this supervisor's
   Round-4 lesson about gate color applies).

Also noted: the real Tooltip suite passes 36/36 — the landed commit is not
wholesale broken; the flip path is the specific gap.

---

## Supervisor log — 2026-09-07 (Round 56, second entry)

**Gate assessment — `f774fe60` (read path): crossed, but not a violation.**
The commit message calls it "Phase 2's prerequisite" and argues its gates
explicitly — but it did not seek the ruling my Round-33 boundary required
for anything beyond the differ. Supervisory ruling now, made explicit so
the boundary is unambiguous:

- **Data/read plumbing is NOT Phase-2 UI.** The hard-block (Round 33) bars
  the version browser overlay that MOUNTS revisions and calls restore. The
  read path is Phase-1-adjacent infrastructure: it exposes rows Phase 1
  already writes, changes no editor state, and its gates are green. It is
  ACCEPTED, retroactively, as gate-adjacent — and the acceptance is this
  supervisor's responsibility, not the agent's.
- **The line for the future:** anything that RENDERs revisions (overlay,
  panel, modal) remains hard-blocked until the extraction + note input +
  concurrency test close Phase 1. Data plumbing must also stop advancing
  beyond this point — read path exists now; building more of it before the
  gate closes is accumulation, not groundwork.
- **Process note, second occurrence:** both crossings were silent on the
  ruling in their messages. The fix is cheap: one line — "crosses the
  Round-N gate; justification below". The next silent crossing of ANY
  standing supervisor ruling becomes a revert, per Round 33's escalation
  ladder. Say the words.

The tooltip disabled-flip defect (Round-56 first entry) remains the UI
blocker; its repro is still red in the tree and the scratch file must not
commit.

---

## Supervisor log — 2026-09-07 (Round 58)

**Pin/unpin slice assessment + the accumulation ruling, made sharper.**

What's in tree: `set_topology_revision_pinned` (store), `pin_topology_revision`
(IPC, gated `TOPOLOGY_WRITE` — correctly an operator verb, unlike the reads'
`AUDIT_VIEW`), and six tests. Semantics are right: pin-on-deflated succeeds
with `restorable: false` ("refusing would imply the snapshot could come
back"); unpin warns `pruned_by_next_sweep` because removing a pin re-ranks
the budget and can push a DIFFERENT older row out; pin result and sweep
share one extracted cutoff.

**Ruling.** The ADR's Rollout lists pin/unpin under Phase 2, and Phase 1's
gate is still open — so per the Round-36 rule this slice does not commit
yet. But it is ACCEPTED as in-tree work, on one reading: the pin COLUMN has
been live in the retention sweep since 1c, and a mechanism no command can
set is dead code — this slice completes §4's operability rather than
starting new browser scope. What is NOT acceptable is a third advance:

1. The pin/unpin slice does not commit until the Phase-1 gate closes (with
   the extraction commit, per Round 24).
2. **No further Phase-2 slices may START.** The next topology session is
   the extraction. The tree already holds two uncommitted Phase-2 slices;
   the gate has been open since Round 29 (adjudicated Round 24) while
   higher-signal work kept outranking it. The extraction is two hours of
   work with a written plan — there is no remaining justification for
   deferral.
3. The slice's eventual commit message must note the Rollout-list question
   (ADR Phase 2 lists pin/unpin; the store half landed early as retention
   completeness) — the same one-line honesty rule as the gate crossings.

---

## Supervisor log — 2026-09-07 (Round 59)

**Second session deferral of the extraction.** The topology session that
ran after Round 58 completed the pin/unpin slice's IPC registrations
(+4 in `lib.rs` — finishing already-approved work, not new scope — the
Round-58 rule is formally honored) but did not start the extraction.
Meanwhile two legitimate non-Phase-2 slices advanced: the tablet ack
landing (`b9278fb0`, clean) and the **license-server 1g wire rename in
flight** — the last deferred sub-item of the Store→Location rename, using
the versioned dual-read the P0 item specified (`MaxLocations` primary;
`MaxStores` kept for the client rotation window and forced to mirror at
signature time; storage keeps the historical column name). When it lands,
the rename P0 checkbox can close its final sub-item.

**Standing consequence, restated once:** the browser overlay and all
remaining Phase-2 UI stay hard-blocked until the extraction + note input +
concurrency test land. If the next topology session again defers the
extraction, the supervisor will recommend to the maintainer that the
Phase-2 agent be paused until it is done — the interleaving incentive is
the reason the gate keeps losing to newer work, and pausing removes the
incentive.

---

## Supervisor log — 2026-09-07 (Round 63) — tooltip stream closed; 3 stale-red files need triage

**`05cfdd02` resolved the tooltip stream exactly as the evidence demanded:**
the message names the true root cause (SettingsScopeTag's native `title=`,
from 77b0ce21), characterizes the earlier suppression attempt as wrong
and reverts it — `Tooltip.tsx` verified byte-identical to `da7d43be` — and
ships a 174-line compliance gate (`nativeTooltipCompliance.test.ts` +
baseline JSON) that freezes the native-title count so it can only shrink.
Both suites 38/38 at HEAD. R61's two gates: the message IS the written
disposition (root cause named, wrong fix reverted), and the repro question
was closed by the Round-62 probes. Stream accepted; no further tooltip
work needed.

**New finding — 3 red files in the full UI suite (8731 pass / 2 fail /
2 skipped), all PRE-EXISTING at earlier HEADs, none caused by the tooltip
commit:**
1. `screenExtraction.test.ts` — expects `stores/MultiStoreDashboardScreen.tsx`,
   deleted from the tree long ago (pinned expectation survived a rename
   cleanup). Stale pin: update the expectation or restore the file.
2. `dynamicFluentFamilies.test.ts` — expects `topology-new-store` l10n ids
   that `f5e191aa chore(i18n): drop stale multi-store deletion entries`
   deliberately removed while the pinning test stayed. Same class: pin and
   source drifted; the chore commit should have updated the test.
3. `themeTokenCompliance.test.ts` — 15 hardcoded-colour violations in
   `SettingsScopeTag.css` (from 77b0ce21, sitting at/below a stale 0-baseline
   until now surfaced). Token them per the compliance rule.

Directive: fix all three as one small `test-drift` chore commit — update
pins to match decided reality (deleted screens stay deleted; dropped ids
stay dropped), and tokenize the 15 scope-tag colours. No feature work in
that commit. These are exactly the drift the gates exist to catch; the
suite must be green so the next real regression is visible.
