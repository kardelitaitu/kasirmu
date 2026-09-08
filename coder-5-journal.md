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
