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
  follows.
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
- [ ] **Next slice — desktop/tablet IPC rename.** Migrate command modules,
      DTOs, registrations, parity allowlists, and scoped aliases from the
      site-unit `store` terminology to `location`, while retaining the four
      terminal workspace types and deferring the license-server wire rename
      until its versioned payload migration.
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
    | `ui/src/api/stores.ts` shim | kept solely for its contract test; retires together with 1c/1d |
    | `api-stores-contract.test.ts` | pins the legacy command strings while the Rust aliases exist |
    | `features/stores/` directory name, `multi-store.ftl` filename, remaining `store`-worded FTL keys and copy | route/nav already renamed (`nav-locations` keys); file/dir and FTL renames remain |

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
    design.
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
      - [ ] 1c. Desktop + tablet Rust: command file rename, IPC command names
            (`list_locations_scoped` etc.), DTOs (`store_count` →
            `location_count`), `lib.rs` registrations, tests, activation
            mapping (wire `max_stores` → local `max_locations`).
      - [ ] 1d. IPC surface: parity allowlist, dev-mock handlers, dev-mock
            scoped-alias tests.
      - [ ] 1e. UI: `api/stores.ts` → `api/locations.ts`, `features/stores/` →
            `features/locations/`, `stores` route → `locations`, tool card,
            FTL keys (enumerate; `multi-store.ftl` → `multi-location.ftl`),
            tests.
      - [x] 1f. Website: pricing "Stores" row → "Locations", card features
            ("1 store" → "1 location"), invariants test labels,
            `subscription-tiers.md` matrix. Updated both English and
            Indonesian pricing cards/comparison rows plus both mirrored
            subscription-tier records; warehouse copy remains separate
            workspace copy, not a hierarchy resource.
      - [ ] 1g. License-server wire rename (deferred, versioned): Go payload
            field `max_stores` → `max_locations` with dual-read for old
            signed payloads; admin dashboard. Not required for the local
            rename (signature verifies raw stored payload bytes).
- [ ] **Implement Legal Entity and the §G default-entity migration.** Add the
      Legal Entity level to schema, backend authorization, and API; then run the
      §G migration (auto-create one Default Legal Entity per existing
      Organization, move its Locations beneath it, preserve IDs, record the
      migration). This is the follow-up the checked design item above defers.
- [ ] **Make subscription state authoritative and fail closed.** The UI must
      distinguish active, loading, expired, canceled, paused, grace-period, and
      unavailable states. A missing subscription response must not silently grant
      tier-gated access.
- [ ] **Implement the expiry and offline-grace policy.** Administrative SaaS
      features lock at `expiresAt`; POS operational runtime may continue under
      the approved Free/OneTime 7, Plus 14, Pro 14, Premium 30, or Enterprise
      60-day offline grace policy. Reconcile the public pricing page and
      server/local implementation with this policy.
- [ ] **Implement separate operational and administrative entitlement paths.**
      A register may continue selling during approved offline grace, while
      Analytics, Memo, Data Management, and other administrative features lock
      after `expiresAt`.
- [ ] **Enforce Topology Editor permissions on the backend.** Apply, rename,
      location creation, template writes, and other topology mutations must
      enforce the agreed admin/owner policy server-side. The current topology
      save capability is broader through `staff:update`.
- [ ] **Centralize quota enforcement.** Location, terminal, workspace/KDS,
      staff, inventory stock point, product, and history limits must be enforced
      consistently by backend mutations, not only by disabled UI controls.
- [ ] **Implement the Settings scope map.** Mark every Settings section as
      organization-, legal-entity/location-, terminal-, or workspace-scoped
      before expanding the UI.
- [ ] **Protect tenant isolation.** Add tests and review gates proving that tenant
      IDs, location scopes, topology graphs, sync payloads, audit records, and
      cached subscription data cannot cross tenant boundaries.
      - **Current-state inventory (2026-09-06 assist pass, corrected at
        `5f263d11`; updated 2026-09-06 by the terminals-tenant slice,
        `56653839`)** — this item had no measurable state, so it read as either
        "nothing done" or "everything done" depending on who was asked.
        Counted from the generator's own emitted artifacts, not a grep:
        **32 tables carry `tenant_id`; 23 are under RLS; 9 are not** —
        `image_refs`, `legal_entities`, `memo_recipients`, `memo_revisions`,
        `memos`, `sale_lines`, `snapshot_versions`, `terminals`,
        `webhook_endpoints`.
        (An earlier revision of this note said 28/22/6 and then 30/22/8. Both
        were wrong in the covered count: a hand-rolled SQL parser missed
        `products`, whose `tenant_id` arrives via a
        `CREATE TABLE products_new … RENAME TO products` rebuild in
        `20260831_per_tenant_unique_rebuild.sql`. The numbers above come from
        `RLS_TABLES` and the generator's emitted to-do block, which agree with
        each other.)
      - **Existing exposure is small and already known.** Only **2** queries in
        PG-facing code touch an uncovered table with no tenant predicate: both
        on `sale_lines`, at `crates/oz-api/src/pg.rs:1207` (INSERT) and `:1404`
        (SELECT). That is not a new finding — `generate-pg-migration.py:265`
        already names it as the cautionary case ("it has the column but pg.rs
        inserts without it"). So the honest read is: the posture is **good**,
        and the gap is tracked.
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
      - **Trend worth arresting:** the uncovered list was 4 entries before this
        workstream. `legal_entities` (`d0e7c823`), `memos` (`7fed26cc`) and then
        both Memo child tables (`5f263d11`) grew it to **8** — **every new
        tenant-scoped table in Phase 1 and 2 has landed uncovered.** That is the
        mechanism working as designed (RLS is a policy decision, not a schema
        fact, and the write path must populate the column first), but it means
        "add it to `RLS_TABLES` once
        the write path sets `tenant_id`" has to be an explicit step in each
        slice, not a later cleanup. Consider making it a named sub-task of this
        checkbox so it stops being invisible.

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
  selected location). Duration is author-selected (12h, 24h, 3d, 7d, 30d;
  default 24h) and a Memo can be stopped early by its author or any higher
  role. Published content is immutable, acknowledgement is optional, drafts
  expire after 30 inactive days, and stopped/expired Memos remain archived for
  30 days. Active Memos show on the staff login and lock screens plus a
  dismissible top-left notification every 15 minutes (30s per cycle; KDS
  terminals see it every 30 minutes instead, coded as 2× the base interval);
  when both types are active they stack with Location above Organization.
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
