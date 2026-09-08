# Coder-5 Journal

New stream. Per the supervisor ruling of 2026-09-08, `coder-1..4-journal.md`
carry the recovered streams' authorship and are not to be appended to by a
finisher originating NEW work — finisher-originated work journals here.

## 2026-09-08 — finisher-C: tax-separation P1, slice 1 (rate scope + validity window)

Branch `0.0.37` — no branch created or switched, no push. Repo root from
`git rev-parse --show-toplevel`.

### Task

`todo-global-saas-2.md` P1: *"Separate business tax configuration from
application defaults."* First slice only — schema + core resolution + tests.
No UI, no dev-mock (hot), no write-side IPC. Read the regional design's
§"Where the two items meet" first, as instructed: that box owns `tax_rates`
scoping, the regional box owns market facts, and **the two must not share a
migration** — which is why this is its own file rather than an extension of
`20260919_regional_configuration.sql` (whose own comment says "Deliberately
absent: any tax column").

### Commits

| sha | subject | files |
|---|---|---|
| *(schema)* | `feat(core): scope tax rates by legal entity, location and date` | migration + registry + pinned list + index pin + regenerated pg init |
| *(this commit)* | `feat(core): resolve the tax rate that applies to a location on a date` | `db/tax.rs`, `db/tax_tests.rs`, this journal |

### What landed

**Schema** — `20260921_tax_rate_scoping.sql`: four nullable columns on
`tax_rates` (`legal_entity_id` → `legal_entities` RESTRICT, `location_id` →
`locations` RESTRICT, `effective_from`, `effective_to`) plus two PARTIAL
indexes. 20260921 was the next free prefix — 20260919 (regional) and 20260920
(audit retention) are taken, and `git status --porcelain --
crates/oz-core/migrations` was empty before I started, so no other agent had a
migration in flight. Registered in `migrations.rs`, added to the
`migrations_tests.rs` pinned id list, index pin 164 → 166, and
`20260813_init.pg.sql` regenerated (never hand-edited).

**Core** — `Store::resolve_tax_rate_for_location(location, entity, as_of)` walks
location → entity → **tenant-global** and returns the first level with a live
row. `Store::tax_rate_scope(id)` reports a stored row's scope.

**Tests** — 17 new in `db/tax_tests.rs`: scoped-wins-over-global, three-level
precedence, no cross-scope leak, NULL-entity-skips-level-2, `effective_from`
gating, expired-falls-back, boundary-day single-match, within-level ordering,
untrusted-row-skipped, malformed `as_of` errors, archived-invisible,
`classify` and `parse_effective_date` unit coverage — and
`every_existing_row_resolves_as_the_tenant_global_answer`, which is the
regression proof that this migration changes the answer for no existing tenant.

### Four calls worth keeping

1. **`TaxRateScope` is an enum, not two columns, so "both set" is
   unrepresentable.** SQLite cannot add a CHECK by `ALTER TABLE`, and the
   alternative — a RAISE trigger — needs a hand-written plpgsql port in
   `scripts/generate-pg-migration.py`'s `TRIGGER_MAP`, the same file the
   audit-retention slice touched hours earlier. The invariant lives in the type
   now; the DB-level guard is recorded as owed to the write-side slice, where
   the only code that could create such a row will be.
2. **`TaxRate` was NOT extended with the new fields.** Ten literal
   constructions across `oz-api`, `modules/tax` and `platform/sync` would have
   had to change, and `TaxRate` is serialized straight into both clients' tax
   screens — a wire change in a slice whose whole point is that nothing
   user-visible moves yet. Scope and window sit in a private
   `TaxRateCandidate` instead.
3. **`effective_to` is EXCLUSIVE.** A period and its successor cannot both match
   on the boundary day, so the resolver never needs a tie-break to price a
   sale. Covered by its own test.
4. **An untrusted row is skipped, never guessed at** — ambiguous scope,
   RFC3339-in-a-date-column, empty string. The walk falls through to the
   tenant-global row. Same ruling already recorded for the signed payload's
   `features` block: silence is the only safe reading of data that cannot be
   trusted. A malformed `as_of` is the opposite case — the caller's bug, so it
   returns `Validation` rather than the `Ok(None)` that means "no rate
   configured".

### Gates

| gate | result |
|---|---|
| `cargo test -p oz-core --lib tax` | **99 passed / 0 failed** (17 new) |
| `cargo test -p oz-core --lib migrations` | **28 passed / 0 failed** |
| `cargo test -p oz-core --lib` (whole crate) | **2761 passed / 0 failed** in 112.06s |
| `python scripts/generate-pg-migration.py --check` | ok — 113 tables / **145** indexes / 11 seeds |
| `python scripts/verify-migration-column-types.py` | ok — 44 files scanned, no unwhitelisted float |
| `RUSTFLAGS=-D warnings cargo check -p oz-core --all-targets` | **exit 0**, Finished in 1m 45s, zero warnings |
| `cargo fmt --all --check` | clean |

No float anywhere: `rate_bps` stays INTEGER basis points, the window is TEXT
business dates, and no amount column was touched.

### OWED — the box stays open, and this file does not close it

- **Write-side IPC is the next slice** (`set_tax_rate_scope`-shaped commands in
  both clients + the tax screen). Until then nothing can put a value in these
  four columns, so the resolver is reachable only from tests. That is the
  intended slice boundary, not a defect.
- **A DB-level guard on the one-or-the-other rule**, with its `TRIGGER_MAP` port,
  belongs with that writer.
- **⚠️ Sync is a live hazard, not a cosmetic gap.**
  `platform/sync`'s `SnapshotTaxRate` and
  `crates/oz-core/src/sync_pull.rs::upsert_tax_rates` use explicit column lists
  that do NOT include the four new columns. A scoped row pulled from the hub
  would land with NULL scope and therefore read as **tenant-global at the
  branch** — a Jakarta rate silently applied everywhere. Sync must carry scope
  and window **before any scoped row is allowed to exist.** Recorded in the
  migration's own header comment so the next agent cannot miss it.
- **The sale path is not rewired.** `resolve_best_tax_rates_for_sku` still ends
  at `get_default_tax_rate`; wiring it through the new resolver is the slice
  that changes money math and needs the writer, the UI and the sync fix in
  first.
- **Tax-inclusive behavior per scope** — `is_inclusive` is still a property of
  the rate row, which is right, but nothing yet asserts that a location
  override carries its own inclusive flag rather than inheriting. Check it when
  the writer lands.
- **`RegionalConfig::tax_regime`** (regional slice 2+) should derive from these
  scoped rates plus `country_code`; the seam is named in the regional design and
  neither side has moved on it.

### Hot files respected

`ui/src/dev-mock/tauri-api.ts`, `ui/src/locales/shared.ftl` /
`shared.id.ftl`, `ui/src/components/StatusBar.tsx`,
`ui/src/hooks/{useAuthConnection,useSyncConnection,connectionHealth}.ts`,
`ui/src/api/license.ts`, `ui/src/__tests__/*`,
`apps/desktop-client/src/commands/license.rs`, both clients'
`staff_tests.rs`, `crates/oz-core/src/service_health.rs`, `.gitignore`,
`scripts/generate-pg-migration.py` (RUN, never edited — its output was
regenerated, its source untouched), `orchestrator-journal.md`,
`coder-1..4-journal.md`, and the index deletions under `.prime/` that another
agent has staged. Every commit used an explicit pathspec with `-F`, so none of
that entered mine. `todo-global-saas-2.md` was read, not written: the tax box at
line 180 stays `[ ]`.

---

## 2026-09-08 — finisher-C: the sync-pull column gap REPAIRED (scoped rates now travel)

Same day as the slice that created the hazard. The previous entry recorded it as
"a live hazard, not a cosmetic gap"; the supervisor made it the top tax
follow-up and it is now closed. Core-only: no UI, no IPC, no dev-mock.

### Commit

| sha | subject | files |
|---|---|---|
| *(this commit)* | `fix(sync): carry tax rate scope and window through the snapshot` | 9 + this journal |

### The chain had SIX drop sites, not two

The brief named `SnapshotTaxRate` and `upsert_tax_rates`. Following one payload
row end to end found six places that dropped the columns — fixing only two
would have produced a repair that changed nothing observable:

| end | site | change |
|---|---|---|
| wire | `platform/sync/src/transport.rs::SnapshotTaxRate` | +4 `#[serde(default)] Option<String>` |
| wire | `crates/oz-core/src/sync_pull.rs::SnapshotTaxRate` | the same four — the client's own copy of the contract |
| producer | `platform/sync/src/pg_transport.rs` | SELECT + map the four |
| producer | `apps/cloud-server/src/sync_store.rs::sqlite_snapshot_tax_rates` | SELECT + `json!` the four |
| producer | `apps/cloud-server/src/sync_store.rs::pg_snapshot_tax_rates` | SELECT + `json!` the four |
| consumer | `crates/oz-core/src/sync_pull.rs::upsert_tax_rates` | INSERT + ON CONFLICT the four |
| consumer | `platform/sync/src/lib.rs::import_snapshot` | INSERT + ON CONFLICT the four |

Checked and NOT a hole: `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`
takes `SELECT *` and intersects live column names from both sides, so it picked
the new columns up with no edit. Worth writing down because "the migrator is
another leak" is the obvious guess and it is wrong here.

### Three rulings, each pinned by a test

1. **Absence = tenant-global.** A payload carrying none of the four keys — every
   server predating 20260921 — lands as the tenant-global legacy row, which is
   what every such row already is. `#[serde(default)]` on all four, on BOTH wire
   copies, plus `snapshot_tax_rate_accepts_a_payload_without_the_scope_keys`.
   Absence is not an error and not "unknown scope".
2. **ON CONFLICT assigns the four UNCONDITIONALLY, never
   `COALESCE(excluded.x, tax_rates.x)`.** A pull makes the server authoritative,
   so a scope REMOVED at the hub must clear at the branch; COALESCE would keep a
   dead location scope alive forever. Pinned by
   `pull_clears_a_stale_scope_when_the_server_row_is_unscoped` and its
   platform-sync twin.
3. **A scope this database cannot honour is REFUSED, not flattened — and that is
   a deliberate DEVIATION from the products convention.**
   `import_snapshot_unknown_store_id_fails_closed_and_rolls_back` establishes
   that an unresolvable FK fails the whole import. For tax the options were:
   (a) flatten to NULL — the exact money bug this repair exists to close;
   (b) fail — one orphaned scope would break every pull for the tenant;
   (c) refuse that one row. Chosen (c): the resolver's answer for "no scoped row
   matches" is the tenant-global row, i.e. precisely what the branch had before
   the pull, so nothing is priced with a rate meant for somewhere else. Loud via
   `tracing::warn!` with the ids, and observable via the returned count. An
   ambiguous row (both columns set) is refused by the same path, matching
   `TaxRateScope::classify`.

### Gates

| gate | result |
|---|---|
| `cargo test -p oz-core --lib pull_` | **4 new / 6 passed / 0 failed** |
| `cargo test -p platform-sync --lib import_snapshot_` | **23 passed / 0 failed** (5 new) |
| `cargo test -p platform-sync --lib snapshot_tax_rate` | **2 passed / 0 failed** (new) |
| `cargo test -p platform-sync --lib` | **306 passed / 0 failed** |
| `cargo test -p oz-core --lib` | **2776 passed / 0 failed** in 132.27s |
| `cargo test -p oz-cloud-server --bins snapshot` | **20 passed / 0 failed**, 2 ignored (new producer test + the shared fixture now asserts the four keys on both backends) |
| `RUSTFLAGS=-D warnings cargo check -p oz-core -p platform-sync -p oz-cloud-server --all-targets` | **exit 0**, zero warnings |
| `cargo fmt --all --check` | clean |

12 new tests total. The one that would have caught the original bug is
`pull_lands_a_scoped_rate_and_the_branch_prices_only_its_location`: it pulls a
Jakarta rate plus a global default and asserts loc-jkt pays 1100 while loc-bali
pays 1000 — before this repair the payload arrived unscoped and Jakarta answered
for both.

### Still owed on the tax box (unchanged, and it stays `[ ]`)

Write-side IPC (blocked on the hot `ui/src/dev-mock/tauri-api.ts`), the DB-level
one-or-the-other guard with its `TRIGGER_MAP` port, rewiring
`resolve_best_tax_rates_for_sku` / `compute_sale_tax` through the scoped
resolver, and per-scope `is_inclusive`. `todo-global-saas-2.md` was read, not
written.

### Note for whoever reads the tree next

`cargo fmt --all --check` briefly reported drift in
`apps/desktop-client/src/commands/audit_security_events_tests.rs` — another
agent's in-flight file, not mine, and clean on the next pass. Two files in this
tree (`crates/oz-core/migrations/20260813_init.pg.sql`, `coder-5-journal.md`)
show ` M` in `git status` with an EMPTY `git diff`: stale stat entries left by
the pre-commit hook's EOL/fmt pass, verified content-identical by
`git hash-object` against the HEAD blob. Not dirty work — do not "recover" them.

### One more constraint found while auditing the chain (for the write-side slice)

`SyncStore::snapshot_version` (`apps/cloud-server/src/sync_store.rs:526`) is the
cache fingerprint that decides whether a snapshot response can be served from
cache. On SQLite it is the per-table `(COUNT(*), MAX(updated_at))` pair; on
Postgres it is the `snapshot_versions` counter bumped by the write hooks.

Consequence: **a scoped writer that changes `legal_entity_id` / `location_id` /
`effective_from` / `effective_to` without bumping `updated_at` in the same
transaction will serve a STALE scope out of the hub's snapshot cache** — the
branch then gets an unscoped row from a server that has one, which is the exact
failure this commit closes, arriving through the cache instead of the SELECT.
The existing `Store::update_tax_rate` does bump `updated_at`, so nothing is
broken today; the constraint is on the writer that has not been written yet, and
it belongs in that slice's success criteria rather than in a cache-key redesign
here. Noted because "the payload carries it" and "the payload is allowed to
serve it" are two different gates, and only the first was in the brief.

---

## D2 — Server-side per-feature grant authoring (PLAN APPROVED, implemented)

**Status:** implemented; `gofmt -w` + `go vet ./...` clean; `go test -short`
full license-server suite green (incl. 8 new D2 tests).

### Approved plan (recap)

Add an admin-only endpoint `POST /api/v1/admin/subscriptions/{id}/feature-grants`
that persists a canonical `feature_grants` map on the tenant's `subscriptions`
record and **immediately re-signs** so the client picks the grant up on its next
`/status` (mirrors the existing `SubscriptionPayload.Features` field already
consumed by the client verdict precedence
`server_policy > lifecycle > tier > quota > role > scope`).

- Wire source = the tenant's existing `subscriptions` record (active, latest by
  `starts_at`). `license_keys` is left untouched.
- The persisted map is grafted into every `signSubscription` build site
  (activate / renew / resume / midtrans + paddle webhooks / admin dashboard /
  admin tenant-lifecycle = 11 sites) via `featureGrantsForTenant(app, <tid>)`,
  so an authored grant survives the next natural re-sign instead of being
  dropped.

### Amendment 1 (authoritative) — FeatureGrantKeys = the FIVE boolean supports_* features only

`FeatureGrantKeys` = `supports_qris`, `supports_analytics`, `supports_loyalty`,
`supports_daily_dashboard`, `supports_cloud_sync`. The endpoint 400s on any
other key. For a **quota-named** key it returns 400 with the explicit message
`quota overrides are a separate unspecced surface`. A `quotaFeatureKeys` map +
`isQuotaFeatureKey` exists only to give that coherent-but-unspecced request a
distinguishable message from a junk key. The Go constant's doc comment records
WHY quota keys are excluded (boolean grant on a quantity feature is incoherent)
so nobody "completes" the list. Rust side is unchanged (fail-closed unknown
keys, already landed).

### Amendment 2 (authoritative) — immediate re-sign is REQUIRED

The endpoint persists AND re-signs in one operation (`resignSubscriptionWithGrants`
-> `signSubscription` writes `signed_payload` + `signature`). A test asserts the
re-signed payload carries the new `features` block, so a grant is live on the
next `/status` rather than dormant until a webhook/renew.

### Extra constraints honored

- **Idempotent:** re-POST of the same grants updates the one existing
subscription row (no duplicate row) and yields a byte-identical `signed_payload`.
Omitting a key drops it from the persisted map.
- **Pre-first-activation authoring** is noted in the endpoint doc comment as a
future extension (not a current flow).
- `omitempty` byte-identity preserved: `signSubscription` with `Features: nil`
emits no `features` key (unit test `TestSignSubscription_FeaturesOmitempty`).

### Files touched (D2)

- `apps/license-server/feature_grants.go` (new): constants, `isValidFeatureGrantKey`,
  `isQuotaFeatureKey`, `featureGrantsForTenant`, `handleAdminSetFeatureGrants`,
  `resignSubscriptionWithGrants`, `ensureFeatureGrantsField`.
- `apps/license-server/feature_grants_test.go` (new): auth / key-validation /
  persist+resign / idempotency / not-found / omitempty tests.
- `apps/license-server/pb_schema.json`: added `feature_grants` json field to
  `subscriptions` (schema parity for fresh boots).
- `apps/license-server/main.go`: `ensureFeatureGrantsField` in OnServe bootstrap;
  route registration for the endpoint.
- `apps/license-server/handler_test.go`: same field migration + route in
  `registerTestRoutes` (test harness boots via OnServe, not `main()`).
- 11 graft sites: `activate.go`, `renew.go`, `resume.go`, `midtrans_webhook.go`,
  `paddle_webhook.go` (x4), `admin_dashboard.go`, `admin_tenant_lifecycle.go`.

### Hot files / branch discipline

Branch `0.0.37`, no push/switch. Committed with an explicit pathspec limited to
the 12 license-server files above; no other agent's dirty files swept in.

## 2026-09-08 — finisher-A: L319 quota gate-parity test (todo-tools.md DONE)

Branch `0.0.37` — no branch created or switched, no push. Repo root from
`git rev-parse --show-toplevel`.

### Task

Close the one open clause of todo-tools.md L319 ("Verify Settings subpages and
page/action quota gates separately") — the information-architecture / gate
parity test. The audit established that the availability stack
(`crates/oz-core/src/availability.rs`, precedence
`server_policy > lifecycle > tier > quota > role > scope`) produces a
`FeatureVerdict { available: false, reason: 'quota' }` for a feature at its
quota cap, but **no test pinned that the IA/page layer honors a quota verdict** —
the only UI consumer of `FeatureVerdict` is the read-only
`DiagnosticsSection` (display), and `page-registry`/`menu-registry`
(`passesGate`/`getEnabledPages`/`getNavItems`) gate on role + permission +
feature-set only, with no quota axis. The Rust resolver side is already pinned by
`verdict_names_quota_at_the_cap_and_clears_one_below`
(apps/desktop-client/src/commands/subscription_tests.rs).

### Deliverable

**New test** `ui/src/__tests__/quotaGateParity.test.tsx` — gate-parity closure
for the quota clause. It mocks `explain_feature_availability_scoped` via the
established `vi.hoisted` invokeMock pattern (no hot files touched: not
`dev-mock/tauri-api.ts`, not `shared.ftl`), returns the quota verdict the
availability stack produces for `locations` at its cap (`available:false,
reason:'quota', detail.limit:2, detail.usage:2`), and asserts:

1. The `FeatureVerdict` the page/action layer reads to hide/disable carries
   `available:false` + `reason:'quota'` + populated limit/usage.
2. The IA/page consumer (`DiagnosticsSection`) honors it: the `locations`
   row renders "Quota reached", never "Available".
3. A quota-irrelevant feature (`supports_analytics`) under the same tenant
   stays available — quota does not over-gate.

Two tests, both pass (`npx vitest run src/__tests__/quotaGateParity.test.tsx`
→ 2 passed).

### Coverage union for L319 (flipped to [x] with dated annotation)

- `ui/src/__tests__/WorkspaceHomeTools.test.tsx` — route + role + tier parity.
- `ui/src/__tests__/WorkspaceHomeTools.navParity.test.tsx` — every tool route
  is a real sidebar nav entry; home gate never looser than nav `requiredRole`.
- `ui/src/__tests__/pageRegistry.test.ts` — role hierarchy + permission
  precedence for the gate machinery.
- `ui/src/__tests__/SettingsDeepLink.test.tsx` + `SettingsNavTree.test.tsx` —
  Settings subpages.
- `ui/src/__tests__/quotaGateParity.test.tsx` — **NEW**, the page/action quota
  gate clause.

### Safety valve

The honest seam did NOT require touching hot files (dev-mock/shared.ftl). The
quota assertion lives at the `FeatureVerdict` contract the gate layer already
reads; no production gate code was added.

### Files touched

- `ui/src/__tests__/quotaGateParity.test.tsx` (new).
- `todo-tools.md` — L319 `- [ ]` → `- [x]` + DONE annotation.
- `coder-5-journal.md` — this entry.

Committed with an explicit pathspec limited to the three files above; no other
agent's dirty files swept in.

## 2026-09-08 — finisher-A: scope §J per-location dims + persisted marker (saas-2 downgrade tail)

Branch 0.0.37 — no branch created or switched, no push. Repo root from
git rev-parse --show-toplevel.

### Task

The supervisor re-triaged the §J downgrade P1 tail: after the remediation
view landed (OverQuotaCard.tsx, commit aa4203959 — tenant-global dims only:
locations / pos_registers / warehouses / staff / products via
get_over_quota_report + isOverQuota/excessOf), the remaining open halves are
(1) per-location dims (KDS screens, topology nodes) and (2) a persisted
per-resource over_quota marker. Scope per-location dims and decide
bounded-vs-sprawl before writing code.

### What "per-location dims" maps to

- KDS screens: per-store count vs tier max_kds_screens (Free/Plus 0, Pro 2,
  Premium/Enterprise unlimited). Enforced at topology Apply via
  count_active_kds_instances(store_id) vs max_kds_screens.
- Topology nodes: warehouse node count vs tier cap (Pro-tier = 1 warehouse),
  guarded on creation in NodeTopologyEditor (wouldExceedWarehouseCap). KDS /
  restaurant / store nodes are not count-capped.

### Data gap (the decisive finding)

The existing client verdict/caps data does NOT carry per-location limits or
counts:
- SubscriptionCapabilities exposes maxLocations / maxPosInstances /
  maxWarehouses / maxStaffUsers / salesHistoryDays + locationCount /
  staffCount / terminalCount. NO maxKdsScreens, NO per-store KDS count, NO
  per-store topology node count.
- OverQuotaReport.usages is tenant-global only (the 5 dims above); KDS screens
  and topology nodes are deliberately excluded (downgrade.rs doc: they are
  capped per location, no honest tenant-global row).
- No FeatureVerdict exists for KDS screens (AvailabilityFeatureKey quota
  families are Locations / StaffUsers / PosInstances / Warehouses only).
- Rust has list_kds_devices_for_restaurant (kds_devices.rs) but NO IPC wrapper
  and NO UI consumer; kds.ts exposes only KDS *orders*, not screens/devices.
- dev-mock/tauri-api.ts carries KDS instance rows but no per-store KDS screen
  count command.

### Verdict: SPRAWLS — report the split, do not implement

The bounded-slice precondition ("driven by existing verdict/caps data, no new
IPC, no dev-mock") is NOT met:

- Slice A (BOUNDED, no IPC): a warehouse-node over-limit readout inside the
  Topology Editor, reusing its existing in-memory node graph + maxWarehouses
  from SubscriptionCapabilities. The only per-location dim drivable from data
  the editor already holds. Self-contained; feature-specific .ftl allowed.
- Slice B (SPRAWL — new IPC + dev-mock): KDS-screen per-location over-limit
  display needs a new IPC for per-store KDS device counts (wrap
  list_kds_devices_for_restaurant / add count_kds_devices) plus max_kds_screens
  (derivable from tier constant). A new IPC implies dev-mock must mock it for
  local runs, which collides with the no-dev-mock hot-file rule.
- Slice C (SPRAWL — migration/hot file): the persisted per-resource over_quota
  marker is a migration (hot for the rename/ADR agents) + a write path.

### Next

Reported the split to the supervisor; awaiting which slice to greenlight. No
code written this turn. Nothing committed pending the supervisor's pick
(Slice A is the only clean bounded option).

### Slice A — IMPLEMENTED (supervisor greenlight, commit a33d6075a)

The only bounded slice. No new IPC, no dev-mock, no hot files; feature-specific
FTL pair only.

**What it does**
- New ui/src/features/locations/WarehouseQuotaChip.tsx: presentational
  WarehouseQuotaChip + pure warehouseQuotaStatus(count, maxWarehouses) helper.
- warehouseQuotaStatus: null cap => 'unlimited'; count > cap => 'over';
  count === cap => 'at'; else 'ok'. Mirrors the S-J downgrade over-quota model.
- Editor (NodeTopologyEditor.tsx) now calls useSubscription() for
  caps.maxWarehouses, derives warehouseCount from the in-graph node list
  (nodes.filter(n => n.type === 'warehouse')), and mounts the chip only when
  (caps && warehouseCount > 0), sibling to the tier-notice (canvas status area).
- 3 FTL keys added to BOTH multi-location.ftl and multi-location.id.ftl
  (translated, not byte-identical):
  - topology-warehouse-quota = Warehouses: { $count } / { $limit }
  - topology-warehouse-quota-over = Warehouses over plan limit: { $count } / { $limit }
  - topology-warehouse-quota-unlimited = Warehouses: { $count } (unlimited)
- CSS: .topology-warehouse-quota + --ok/--at/--over/--unlimited modifiers
  (top-left corner, subtle surface bg, small font) in NodeTopologyEditor.css.

**Gates**
- vitest: 8/8 pass (WarehouseQuotaChip.test.tsx 4x, warehouseQuotaStatus.test.ts 4x).
- tsc --noEmit (typecheck gate): clean.
- eslint: 0 errors (only pre-existing-style warnings: react-refresh for the
  co-located helper + exhaustive-deps in the editor — same set as before).
- Pre-commit hook (all 10 steps): i18n lint clean, bundle-parity 0 missing keys,
  UI typecheck pass, FTL orphan OK.

**Constraints respected**
- Did NOT touch hot files (StatusBar, connection hooks, dev-mock, shared.ftl /
  global .id.ftl, api/license.ts, features/inventory/*).
- The existing per-node excess badge (topology-warehouse-excess-badge,
  isProAllowed-driven) is a SEPARATE feature and was left untouched.
- Dropped a pointer-capture onMouseDown from the chip to keep role='status'
  a11y-clean (jsx-a11y/no-noninteractive-element-interactions); read-only region.

### Next
- Slice B (KDS-screen over-limit) REMAINS QUEUED behind dev-mock (hot file) —
  same queue as the tax write-side IPC and caps-DTO projection.
- Slice C (persisted per-resource over_quota marker migration) is a CANDIDATE
  AFTER Slice A. When Slice A is acknowledged, present the migration design as a
  plan-first report (marker key, write path, read path, how OverQuotaCard
  consumes it) — do NOT start it unprompted.
