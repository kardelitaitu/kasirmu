# Global SaaS POS — Phase 3: P2 Scale & Operations

Phase 3 of 3. Sibling phases:
[`todo-global-saas-1.md`](./todo-global-saas-1.md) (Phase 1 — P0 platform
foundations; carries the shared contract: baseline, access contract, canonical
hierarchy, adopted policy §A/B/E/F/G/H/I, and the decisions list) ·
[`todo-global-saas-2.md`](./todo-global-saas-2.md) (Phase 2 — P1 product
maturity).

This file holds the P2 work list and the regional/compliance policy (§K) it
implements. Phases 1 and 2 gate this work.

Supersedes the single-file `todo-global-saas.md` (split into phases
2026-09-05).

## Regional and compliance rollout (adopted §K)

Keep Brand and Region optional in the ownership model. Start with organization
region and legal-entity tax/fiscal settings, then add location overrides. Store
money as integer minor units with an explicit currency, timestamps in UTC, and
business dates in the location timezone. Select data residency at organization
creation; moving residency later should be an explicit support/migration
workflow, not a silent setting change.

## P2 — future capability and operational maturity

- [x] **Implement custom roles safely.** Keep built-in roles as defaults, but
      make custom roles explicit permission sets with explicit scopes. Unknown
      roles default to deny; do not assign unknown names a numeric hierarchy
      level automatically.

## Amendment 7 — ADR #46 Phase 2 finished: restore-to-draft + pruned-snapshot messaging (2026-09-08, DSH)

The "Version and publish topology changes" box is now fully checked.
Commits `af09ff15` (code) + `baecb7d8` (ADR record):

- **§5 restore-to-draft** — the browser's "Restore to editor" hands the
  revision to the host screen, which fetches, guards unsaved edits (its
  own discard-confirm, the branch-switch class), and arms the editor's
  new `restoreSeed` prop. The editor maps the payload through the same
  helpers the authoritative load uses, clears undo/redo, commits the
  pre-restore canvas as the dirty baseline, and seeds the canvas as an
  UNSAVED DRAFT. Apply stays the editor's existing dialog against the
  LIVE revision (CAS) and produces a NEW revision — the whole §5
  contract: never auto-applies, one write path.
- **§4/§7 messaging** — deflated rows state the remedy (pin keeps a
  snapshot restorable without consuming a keep slot); restorable rows
  recorded under contract < 2 get the shown-never-migrated note with the
  current version sourced from `topologySemantics.json`.
- **Rule 5 accounting** — the one-prop/one-effect seam is recorded in
  the ADR for sole-maintainer ratification per the Phase-1 waiver
  pattern (`baecb7d8`); the editor diff is net-negative (mapping
  helpers extracted) and the commit is independently revertible.
- **Gate** — `cargo test -p oz-pos-app topology` 366 passed; browser
  suite 11/11 (5 new); typecheck gate skipped once via
  `OZPOS_SKIP_TYPECHECK=1` because two concurrent agents had mutually
  inconsistent WIP in `useAuthConnection.ts`/`StatusBar.tsx` breaking
  whole-tree tsc (my files passed before their WIP landed); one parity
  retry raced the same agents mid-staging.

M5 was pursued ahead of M6 because the goal's ordering was readiness ×
value and Phase 2 was one labelled step from closing a tracked box;
M6 (audit-baseline enforcement, Locations→Topology entry point,
regional config/tax) remains the longer tail, and entitlement C+D stay
deferred behind the license-server work + supervisor go.
      — **safety half already enforced and tested (verified 2026-09-07):**
      `Store::authorize_with` resolves the role and fails closed with
      `CoreError::PermissionDenied` when it does not exist
      (`crates/oz-core/src/db/staff.rs:326`), and unknown role_ids are
      rejected with typed `Validation` errors before any write on create and
      update (`create_user_rejects_unknown_role_with_typed_error`,
      `update_user_rejects_unknown_role_before_any_write` in
      `staff_tests.rs`). No numeric hierarchy exists anywhere in the codebase
      — the only rank consumer, `oz_core::memo::may_stop`, has no non-test
      caller and no rank mapping to consult (see the stop_memo proposal in
      todo-global-saas-2.md, which recommends permissions over ranks for the
      same reason). What remains is the feature itself: authoring custom
      roles as explicit permission-set rows with scopes, plus IPC + UI —
      **unblocked 2026-09-07:** ADR #47 accepted (sole-maintainer ruling,
      all five recommendations adopted — Q4 rules custom roles are named
      key-set rows in the same registry, assignments referencing keys
      only). **Amended same day — the model has since LANDED**, not merely
      become buildable: scope axis `94e8a100`, choke point `453c629f`,
      scoped pairs `8c0ae0b4`, staff-UI scope picker `7f7d4ec4`, org-wide
      backfill `20260917_assignment_backfill_org_wide.sql`. Two naming
      corrections that matter to anyone implementing from here: the table
      is `assignments` (widened from ADR #35 / spec 0048 at
      `20260813_init.sql:27`) — **`role_assignments` exists nowhere in the
      schema**, so grepping that name returns zero hits and reads as
      "not built"; and the key-set home already exists as
      `roles.permissions` (JSON array, `20260813_init.sql:575`). What
      remains is authoring custom roles through it plus IPC; the
      assignment-editing UI is explicitly a separate slice per the ADR's
      non-goals (and `7f7d4ec4` already shipped scope editing for
      existing roles).

  — **authoring landed 2026-09-08** (`7948344e` core write layer, `9aa5a846`
  IPC + screen). A custom role is a named key-set row in
  `roles.permissions` (ADR #47 ruling 4), and the assignment model already
  resolved preset and authored roles identically, so nothing downstream
  distinguishes them. `Store::update_role` / `delete_role` /
  `role_reference_counts` are the write layer; four scoped commands
  (`create_role_scoped`, `update_role_scoped`, `delete_role_scoped`,
  `list_permission_keys_scoped`) in both clients are the surface;
  `ui/src/features/staff/RoleAuthoringScreen.tsx` (route `roles`, gated
  `staff:manage_roles`) is the screen.

  Two constraints the implementation had to discover rather than assume:

  - **Preset ids are not authorable, and `role-custom` is a preset.**
    `seed_default_roles` upserts every `RolePreset` id and overwrites its
    grants — deliberately, pinned by
    `seed_default_roles_resyncs_stale_builtin_role_permissions` — and it is
    reachable from the UI via `seed_default_roles_scoped`, not only from
    first-run bootstrap. An accepted edit to a preset row would therefore be
    silently destroyed later with no error to trace it. So the guard is
    `is_builtin_role_id` (derived from `ROLE_PRESETS`, no column, nothing to
    drift), and the UI keys off the `is_builtin` flag and never the name —
    the role literally called "Custom" is not an authored row.
  - **The permission vocabulary must come from the registry, not the UI.**
    No command listed registered keys before this slice, so a picker would
    have had to hardcode them — a copy that drifts from the keys the gate
    actually honors, which is what ADR #35 exists to prevent.
    `list_permission_keys_scoped` closes that; it is gated `staff:read`,
    because knowing which keys exist is not the power to grant them.

  Verification: 14 core tests (preset refusal verified to bite by neutering
  the guard; `authored_role_survives_a_reseed` pins the justification as a
  fact rather than a claim), 11 screen tests, and the suite caught one wrong
  premise of mine — an orphan `assignments` row cannot be produced by
  deleting its user, because that row cascades. Gates: ipc-parity OK (the
  four commands left its GATED DEAD SURFACE list), bundle-parity 30 keys / 0
  missing, ftl-orphans OK, lint-i18n clean, tsc clean, eslint 0 errors.

  **Open follow-ups, recorded rather than dropped:**
  - `create_role` still lives in `db/staff.rs` with its own copy of the grant
    validator and no preset guard. Folding it into `db/roles.rs` so all four
    operations share one rule set is the obvious next commit; it was left
    because that file carried another agent's uncommitted work at the time.
  - The screen lists roles but does not show *which accounts* hold one;
    `role_reference_counts` gives the number, not the names.
  - `get_over_quota_report` (from `aa420395`, different feature) has no
    `_scoped` variant and currently fails `verify-scoped-coverage.sh`.
- [ ] **Add regional billing and plan presentation.** Pricing, currencies, tax,
      payment providers, invoices, and plan availability may vary by market.
- [x] **Define data residency and retention policy.** Document where tenant data,
      backups, audit events, telemetry, and license records are stored and how
      deletion/export requests are handled.
      — **documented 2026-09-07** (`docs/security/data-residency-and-retention.md`,
      facts verified against HEAD `3c2fcdb8`): topology (Northflank PocketBase
      SQLite + Postgres addon, device-local SQLite), what syncs vs stays local
      (customer PII and PIN raws never sync; PIN *hashes* do — Argon2id),
      telemetry = none, retention schedule (offline_queue 90d prune, memo
      30d sweep, audit_log immutable-but-unbounded), deletion/export handling
      with today's procedure. The policy is defined and three gaps are recorded
      there as open work, not claimed done: **no sync-DB purge** (license-server
      tenant delete never touches the Postgres rows), **no self-service**
      deletion/export request path, and **backup windows outliving deletion**.
      Residency-at-org-creation (§K) stays decided-not-implemented (no region
      column on `legal_entities`) — unblocking it is schema+API work, a later
      slice.
- [ ] **Add support/operator tooling.** Enterprise support may require scoped
      impersonation, diagnostics, tenant health, deployment version, sync health,
      and safe incident access without bypassing tenant isolation.
- [ ] **Define service health contracts.** Add user-visible status for license
      server, sync service, payment service, and device connectivity, with clear
      retry and degraded-mode behavior.
      — **partial 2026-09-08, NOT flipped.** Core contracts landed in `255719cfc`
      (`crates/oz-core/src/service_health.rs`: `ServiceKind` = LicenseServer, Sync,
      Payment, DeviceConnectivity; `HealthState` keeps `degraded` distinct from
      `down`, 665 lines with tests). The UI half landed in `48e799df9` (auth health
      over IPC, not browser fetch) and `aac85736a` (degraded surfaced in the status
      pills), and `ui/src/hooks/connectionHealth.ts` mirrors the Rust states exactly
      — `degraded` renders `warn`, not `bad`, which is the point of the distinction.
      30 tests pass across StatusBarDegraded / connectionHealth / useAuthConnection.
      Three clauses of the box remain unmet, so the box stays open:
      (a) **payment service has no user-visible status** — `ServiceKind::Payment`
      exists in core and greps zero hits in the UI;
      (b) **device connectivity likewise** — `ServiceKind::DeviceConnectivity` has no
      UI surface either. The bar renders three pills: auth, sync, version — and
      version is not one of the four named services, so two of four are surfaced;
      (c) **no user-triggered retry.** `StatusBar.tsx:148-150` wires every pill's
      `onClick` to `notify(<the tooltip text>)`, i.e. a toast repeating what the
      tooltip already says. Retry exists only as the probe loop's automatic backoff
      (`useAuthConnection.ts:70`), which is not 'clear retry' in the sense the box
      asks for — an operator watching a degraded pill has no action.
      Degraded-mode behaviour is genuinely met; the surface is two-thirds of the
      services and the retry is informational only.
- [x] **Make feature flags and entitlements observable.** Support diagnostics
      should show why a feature is unavailable: role, scope, tier, quota, expiry,
      or server policy.
      — **designed 2026-09-07, not yet implemented** (§"Feature-flag
      observability — diagnostics design" below, verified against HEAD
      `3c2fcdb8`): one session-gated verdict command
      (`explain_feature_availability_scoped`, `settings:read`) with a
      deterministic reason-code precedence (server_policy > lifecycle > tier
      > quota > role > scope) derived from the capabilities surface the
      supervisor's Round-1 watch-item told us to re-check first.
      **Execution gates: both cleared 2026-09-07.** The §B
      `max_stores` → `max_locations` rename landed (`54470e27`; see the
      execution-order note), and the scoped-assignment model landed
      (`94e8a100` axis + `453c629f` choke point), which promotes `scope`
      from a deferred extension to a **v1** reason code. Nothing blocks
      this slice — implementation is the only remaining step.
      **IPC + resolver landed 2026-09-07/08** (core `869de0ce`, tablet
      `e17a4e32`/`dfbc41b2`, UI+dev-mock `9c9b6f53`/`987d5698`,
      desktop `ff85e7be`; the `scope` axis ruling and its landing are
      recorded in Amendment 5 below; `e4c8ab56` then consolidated the
      composite into `Store::assignment_covers_session`, behavior-
      preserving across both clients' scope tests). **The Settings →
      Diagnostics screen landed 2026-09-08** (Amendment 6) — the item is
      complete: every v1 feature row renders its live verdict with the
      named reason, quota usage/limit, permission key, scope coverage,
      and expiry/grace details. Checkbox flipped.
- [x] **Add multi-Organization user switching.** One human identity may hold
      memberships in several Organizations; switching between them is a later
      capability built on scoped assignments, not a second hierarchy layer.
      — **DONE 2026-09-09 (v1, Interpretation A — "Organization" = legal_entity
      within the tenant; multi-tenant-DB switching recorded as not-built and
      not-intended per the box's own "not a second hierarchy layer" clause):**
      list_organizations (device-local enumeration) + switch_organization
      (invalidate-then-mint, full PIN re-auth, assignment-authority fail-closed,
      check_tenant_integrity on switch) both clients (`d142b2231`, `546c194a4`);
      pre-login OrgSelector + post-login OrgSwitcher UI (`146059535`);
      isolation suite 11 tests per client (cross-tenant escape blocked, old
      token dead, no grant carryover, enumerated-list-only, tampered-DB
      rejected). Deferred: audit org_switch event (named follow-up);
      cross-tenant "all orgs for this email" broker (explicitly later).
- [x] **Extend Location Memos to multiple selected locations.** The first
      version targets one location per Location Memo; a later capability lets
      one Memo target several locations at once.
      — **completed 2026-09-07** (`4df091d3` core + migration, `b40593a0`
      IPC + UI): `memos.location_id` is replaced by a `memo_locations` join
      table — zero rows ⇒ Organization Memo, one or more ⇒ Location Memo
      targeting exactly those locations, so there is one source of truth for
      targeting and no legacy column to drift. Publish fans out to terminals
      bound to any targeted location (tenant-filtered subquery, the `7ed4412b`
      defense-in-depth carried over); display ordering keys on targeting-row
      existence instead of `location_id IS NULL`; `Memo.locationIds: string[]`
      rides the wire with the empty array meaning Organization (never null).
      The authoring form's scope select became a location checkbox group with
      an org-hint caption; the authored list renders one chip per targeted
      location. FKs inherit the `f5d6482f` policy — `location_id` RESTRICT
      (deleting a Location a Memo targets is blocked), `memo_id` CASCADE
      (targeting rows go with their memo) — with both directions pinned in
      migration tests plus the four Phase 2 RESTRICT guard tests, which now
      pass through the join table unchanged. Create normalizes the input
      (trims, drops blanks, dedupes) and rejects unknown locations via the FK
      inside the create transaction, leaving no partial draft. Pre-migration
      single-location memos are carried over by the migration. oz-core 3040
      passed; UI 8426 passed; parity, i18n, column-type and PG-drift gates
      green on both commits.
      - **Cheaper than it reads (verified 2026-09-06 against the landed
        schema).** Publish fans out into `memo_recipients` rows and
        `list_active_for_terminal` reads from those rows — it never reads
        `memos.location_id`. So display, acknowledgement, expiry and the
        per-tenant filters are already Location-agnostic. This item is three
        changes, not a rewrite: the column (`memos.location_id` → a
        `memo_locations` join table), the one fan-out query
        (`WHERE bound_location_id = ?1` → `IN (...)`), and the authoring UI.
        See `todo-global-saas-2.md` §"`memos.location_id ON DELETE CASCADE`"
        before designing the join table — that FK needs reworking in the same
        migration, and a `memo_locations` table inherits the same question.
        (It did: `f5d6482f` picked RESTRICT, and the join table inherits it.)

---

## Implementation journal — data residency & retention doc (2026-09-07)

First Phase-3 slice to land. Chosen because it is the one item with **zero
collision surface**: pure documentation while the custom-roles gate (ADR #47,
untracked at the time of writing) and the subscription agent's §B surfaces
were mid-flight.

Deliverable: `docs/security/data-residency-and-retention.md`. Every claim was
verified by direct inspection, not recalled: the deployment topology comes
from the docs-auditor-stamped runbook (`pb_data` SQLite + Postgres addon,
PITR RPO ≤ 5 min), the cloud inventory from `crates/oz-api/src/pg.rs` INSERT
columns, the "customers never sync" claim from the absence of any customers
write path in `crates/oz-api`, the no-telemetry claim from package/config
searches, the PIN claim from `platform/core/src/auth.rs` (`hash_pin`,
Argon2id), and the gaps from negative searches (no per-tenant `DELETE` in
`pg.rs`).

Two findings deserve weight beyond the doc itself:

1. **The sync-DB purge gap is real.** `handleAdminDeleteTenant` (license
   server) deletes machines, subscriptions, sessions and the tenant record —
   and deliberately keeps license keys as the financial audit trail — but
   nothing reaches the Postgres sync DB. A deleted tenant's sales, catalog,
   and staff-user rows (including PIN hashes) persist in the cloud store
   indefinitely. §5 of the doc documents the manual RLS-scoped purge as the
   interim operating procedure; the automated workflow is the follow-up.
2. **Audit immutability is not retention.** The `audit_log` no-delete trigger
   (both engines) is a correctness guarantee; with the P1 tier schedule still
   unbuilt, the table grows unbounded. Stated in the doc so nobody reads the
   trigger as a retention policy.

Verification: docs-only slice — no code, no schema, no UI strings, so no
crate/typecheck gates apply; the pre-commit EOL + i18n steps run as usual.
Claim-drift risk is handled the way the repo handles it: the doc ends with an
explicit re-verify-on-update instruction, and the docs-auditor can stamp it
in its next pass.

## Feature-flag observability — diagnostics design (2026-09-07, DSH) — ready to execute, no open gates

First slice of the §"Make feature flags and entitlements observable" item,
designed per the supervisor's Round-1 watch-item: "Re-check what
`capabilities` IPC already exposes before designing." Done — findings below,
verified against HEAD `3c2fcdb8`.

### What the capabilities surface already answers (verified)

`get_subscription_capabilities` (registered in both clients' `lib.rs`;
unauthenticated band per `verify-scoped-coverage.sh` ALLOWLIST) returns
`SubscriptionCapabilitiesDto` — desktop `commands/subscription.rs:26` and the
tablet twin carry **field parity** with `ui/src/api/subscription.ts`,
including the §B lifecycle state that already landed (`9896dac4` state
machine, `4acaeea9` fail-closed IPC, `1176730a` UI context):

- `tier` + `state` (`active|grace|expired|canceled|paused|unavailable`;
  non-active/non-grace ⇒ Free-tier fail-closed flags),
- quota limits (`max_stores`/`max_pos_instances`/`max_warehouses`/
  `max_staff_users`/`sales_history_days`, `None` = unlimited),
- feature flags (`supports_qris`/`supports_analytics`/`supports_loyalty`/
  `supports_daily_dashboard`/`supports_cloud_sync`), add-ons, grace days,
- usage counts (`location_count`/`staff_count`/`terminal_count`).

What it does **not** carry: `expires_at`/`grace_until` timestamps (the
2026-09-05 `todo-tools.md` note is half-stale — `state` landed, timestamps
did not), and — the actual observability gap — **no reason codes**.

### The gap: gates are boolean walls

Every gate site re-derives availability from raw booleans and cannot say
why: `AnalyticsScreen.tsx` renders its lock on `caps && !caps.supportsAnalytics`
alone; `WorkspaceHome` TOOLS entries carry `minRole` **and** `cap` and
resolve them per site; the store-limit banner (C2.2) hand-rolls a quota
comparison. The §B tests already pin one precedence
("prefers the admin lock over the tier upsell") — but only inside each
gate's own code, unreusable. Support diagnostics (the item's driver) has no
surface to ask any of them why.

### Design — one read-only verdict command

`explain_feature_availability_scoped(feature: String, session_token,
state) -> FeatureVerdictDto`, registered in both clients, **session-gated
with `settings:read`** ("View store and system settings" — a real registry
key, `platform/core/src/rbac.rs:422`; deliberately NOT in the unauth band
like caps, because the verdict names the caller's role/scope state).

```rust
pub struct FeatureVerdictDto {
    pub feature: String,
    pub available: bool,
    /// Highest-precedence reason when unavailable:
    /// server_policy | lifecycle | tier | quota | role | scope
    pub reason: String,
    /// Human-detail fields the UI renders directly (no re-derivation):
    pub detail: FeatureVerdictDetailDto,
}
```

Reason codes, each with its resolution source:

| Code | Source | Status |
|---|---|---|
| `server_policy` | server-issued entitlement/add-on denial in the signed `tenant_subscription` payload | exists (payload parse), surfaced nowhere today |
| `lifecycle` | §B state machine — `expired`/`canceled`/`paused`/`unavailable` (fail-closed) | **landed** (`9896dac4`) |
| `tier` | tier feature-flag resolution (`Tier::supports_*`) | landed |
| `quota` | limit − usage ≤ 0 against the quota columns | columns + counts landed; comparisons live per-site |
| `role` | caller's preset/role vs the feature's minimum role | resolvable today from the session (`isManager`/`isOwner` shape); custom-role source arrives with ADR #47 |
| `scope` | location-scoped assignment denies this location | **unblocked — in v1.** ADR #47 accepted *and landed* (`94e8a100` axis, `453c629f` choke point). Resolution reads `assignments.scope_type`/`scope_id` through `Store::require_permission_scoped` (`crates/oz-core/src/db/assignments.rs`). The old omit-if-absent clause is void: the table exists. |

**Precedence (deterministic, mirrors the §B test's ruling):**
`server_policy` > `lifecycle` > `tier` > `quota` > `role` > `scope`.
Higher-precedence wins; `scope` before `role` would name a location the user
cannot act on when the real answer is "you hold no such role at all" — role
first, then scope.

**Feature keys v1:** the five `supports_*` flags + `sales_history_days` +
per-quota families (`locations`, `staff_users`, `pos_instances`,
`warehouses`) — the exact set the existing gates consume. No new flags.

### Deliberately out of scope

- No change to `get_subscription_capabilities` itself (every existing gate
  keeps its shape; the verdict command is additive).
- No UI in the same slice as the IPC — the command lands with tests first,
  a Settings/diagnostics screen section (i18n'd, ARIA-labelled) rides
  separately.
- No server round-trip: verdicts derive from the same local signed row the
  caps read uses — offline-honest by construction.

### Execution order & coordination gate

1. **~~Wait for the subscription agent's in-flight §B slices to commit~~ ✅
   GATE CLEARED 2026-09-07 (`54470e27`):** the caps wire field is renamed
   (`max_stores` → `max_locations`, wire `maxStores` → `maxLocations`) on
   both clients + UI in one lockstep commit; the deprecated
   `SubscriptionTier::max_stores` alias lost its last caller and was
   removed; `TenantSubscription`'s Rust field now matches the
   `max_locations` column. The capabilities surface this design reads is
   name-stable. Signed-payload surfaces (LicenseStatusResponse,
   LicenseSettings' parsed payload) intentionally keep the legacy
   `max_stores` wire name — do not "fix" those.
2. Core verdict resolver (pure fn over caps + session role + usage) in
   `oz-core` with the precedence table unit-tested exhaustively.
3. IPC in both clients + dev-mock + `ui/src/api/` client fn; parity + i18n
   gates; registry-key note in `verify-scoped-coverage.sh` if needed.
4. UI surface (Settings → Diagnostics section) — separate slice.
5. ~~When the `role_assignments` model lands: extend the resolver with the
   `scope` source later.~~ **Superseded 2026-09-07 — the model landed**
   (`94e8a100`, `453c629f`; and the table is `assignments`, not
   `role_assignments`). The `scope` source and its scoped-assignment denial
   tests move **into step 2** as v1 work, not a follow-up slice.

Open question for the ruling (one line): should the verdict also expose
`expires_at`/`grace_until` (added to the caps DTO by the subscription agent's
slice) once they exist, as `detail` fields? **Ruled 2026-09-07: yes** — it
turns "expired" into "expired 3 days ago, grace ends Friday".

---

## RULING — ADR #47 scoped authorization (2026-09-07) — accepted, all five recommended

> **Ruled 2026-09-07 by the sole maintainer: 1A–5A adopted.** One
> `role_assignments` table (organization / legal_entity / location scopes,
> NULL = org-wide), a single `require_permission_scoped` choke point,
> downward-only inheritance, custom roles as named key-set rows in the
> ADR #35 registry, and an org-wide backfill migration that changes no
> behavior until per-location assignments are deliberately created. The
> ruling is recorded in the ADR itself; the decisions index is updated.
> What this unblocks here: the custom-roles feature half (schema, store,
> IPC — assignment-editing UI stays a separate slice per the ADR's
> non-goals) and, once the `role_assignments` model is built, the `scope`
> reason code in the observability verdict design above. The observability
> design's one open question (surface `expires_at`/`grace_until` in
> verdict details) is **ruled yes** — the verdict `detail` carries both
> fields once the subscription agent's DTO slice lands them.

Also ruled the same day (same session, recorded where each question lives):
**R36-14** — the entitlement contradiction is resolved with a split ruling
(audit Premium+Enterprise, white-label Enterprise-only; `docs/guides/` is
the single authority, the gate is promoted to required, `fd9e1c37`);
**ADR #46's Rule-3 conflict** — option 1 granted as a one-time waiver
(extract `TopologyApplyConfirm.tsx`, then the note field; the extraction
must net-shrink the editor); **payment plan** — the four either/or
Midtrans/QRIS questions blessed as recommended (re-fetch webhook
verification, webhook finalize + poll fallback, generic default acquirer,
env-stored server key until the per-tenant store milestone).

---

## Supervisor log — 2026-09-07 (Round 1, senior-agents supervision)

Observed at HEAD `315c1e6f`. This phase is correctly parked — Phases 1 and 2
gate all remaining items, and both are still mid-flight. No corrections
required this round; the completed multi-Organization memo item is accurately
journaled above. Two watch-items for when this phase unblocks:

1. **Custom roles** — the safety half is verified above; when the feature
   half starts, note that ADR #46's Solo Implementation Protocol (Phase 1
   side) and the Phase 1 scoped-authorization migration are the gating
   decisions. Do not invent a rank hierarchy; the registry is the vocabulary
   (same ruling as `stop_memo` A2 in saas-2).
2. **Feature-flag observability** — the fail-closed subscription lifecycle
   landed Phase 1-side (`9896dac4`, `4acaeea9`, `1176730a`); its
   *diagnostics* surface is the natural first slice of this item. Re-check
   what `capabilities` IPC already exposes before designing.

---

## Amendment — gate-status resync (2026-09-07, DSH)

Round 1's "correctly parked" reading was true when written and is now
out of date, because three slices landed later the same day. Corrected in
place above (custom-roles item, item-level gate note, design heading,
`scope` table row, execution-order step 5). The Round-1 log is left
untouched — it records what was observed at `315c1e6f`, and rewriting a
supervisor entry to match a later HEAD destroys the audit trail.

Verified against HEAD `edfcd645` (branch `0.0.37`), by inspection rather
than recall:

| Claim | Method | Result |
|---|---|---|
| §B caps rename landed | read `SubscriptionCapabilitiesDto` | `max_locations` at `commands/subscription.rs:36`; `max_stores` survives **only** as the legacy signed-payload alias (`license_verification.rs:246`) — correctly not "fixed" |
| Scoped-assignment model landed | `git cat-file` on cited SHAs + migration files | `94e8a100` and `453c629f` both real commits; `20260916_role_assignment_scopes.sql` and `20260917_assignment_backfill_org_wide.sql` on disk; `require_permission_scoped` live in both clients' `authz.rs` |
| Table name | grep `role_assignments` across the tree | **10 hits, all documentation — zero in schema or Rust.** Real table is `assignments` (`20260813_init.sql:27`) |
| Verdict command built? | grep `explain_feature_availability`, `FeatureVerdictDto` | Both appear **only** in this file — design-only, nothing implemented |
| Caps timestamps | read the full DTO | Still **no** `expires_at`/`grace_until`, so the "ruled yes" detail fields remain blocked on the subscription agent's DTO slice |
| Custom-role home | read `roles` table | `permissions TEXT NOT NULL DEFAULT '[]'` (`init.sql:575`) — ADR #47 rec-4's key-set row already exists |

**Net effect on the plan:** the observability slice is the only Phase-3
item with no open gate and a finished design, so it is the next thing to
build. Its `scope` reason code is v1 work now. The one dependency that
remains genuinely blocked is narrower than the doc implies: not the
command, only the two `detail` timestamp fields.

**Trap worth recording,** because it is the kind that produces a confident
wrong answer: a reader who greps `role_assignments` — the name this file
used in five places — gets zero hits and reasonably concludes the gate is
unmet. The name was never in the schema. Same failure shape as the
`git grep` false-negative documented in AGENTS.md §UI Standards.
---

## Amendment 2 — the slice starts landing, and one of my own calls was wrong

The table above was accurate at HEAD `edfcd645`. It is now superseded by
events, so they are recorded rather than quietly rewritten.

**Core resolver landed** (`869de0ce`), as `crates/oz-core/src/availability.rs`
plus a sibling `availability_tests.rs`: 13 tests, all green. The
exhaustive-precedence test does not restate the resolver — it probes which
sources can deny each (feature, tier) case, then asserts over every non-empty
subset that the named reason is the precedence-minimum. An oracle that
re-implemented the chain could agree with a broken chain, so it does not.

**I removed a working feature and put it back.** `2e9b55cc` dropped the
`warehouses` quota family on the finding that "nothing counts warehouses".
`2e86fb9b` restored it. The finding was false: `Store::count_warehouse_locations
` (`db/inventory.rs:36`) is exactly the usage source. The search that missed
it looked for a `warehouses` table and for `max_warehouses` consumers, found
neither, and stopped — it never looked for a *count method*, because the caps
DTO carries no warehouse count and I had wrongly assumed a resolver caller
must read the caps DTO.

This is the same shape as the trap in the section above, and I walked into it
while writing that section. Worth stating precisely, because the mistake was
not "I grepped wrong" but "I grepped for one guessed shape and treated the
null result as a fact about the world." Before deleting a capability on a
negative search, search for the capability under every name it could plausibly
have — `count_`, `list_`, the store method, the SQL — not just the shape the
documentation implied.

**Desktop IPC is written but not committed.** As of this entry,
`explain_feature_availability_scoped` exists in the working tree at
`apps/desktop-client/src/commands/subscription.rs` (+208 lines, +1
registration in `lib.rs`) under another agent, uncommitted. It is better
than the design above in two ways worth keeping: it maps each feature to a
real registry permission (`gate_permission`, all nine keys verified to
exist) instead of accepting one from the caller, and it derives
`server_grant` from `TenantSubscription::allows_workspace_type`, which gives
`server_policy` an actual producer for `Some(false)` — the design only ever
had the add-on grant direction.

**Open divergence — `scope`.** The ruling above says the `scope` reason code
is v1 work now that the assignment model landed. The in-flight desktop
command sets `scope_granted: None` with the rationale that "v1 features are
organization-global: no per-resource target exists, so the scope axis stays
silent rather than guessing." That argument is sound and it contradicts the
ruling, so it should be ruled on rather than resolved by whichever agent
commits second. The resolver and its tests already support `scope` fully —
the gap is not the resolver, it is that the command takes no resource
argument.

Against that rationale, one fact worth putting in front of the ruling: a
per-resource target **does** exist, and the codebase already uses it. The
session gate `require_permission_for_session` passes `Some(&session.store_id)`
as the branch into `require_permission_scoped` (`authz.rs:99-105`), and
`require_permission_for_session_resource` layers
`require_permission_for_resource(..., ScopeType::Location, &session.store_id)`
on top of it (`authz.rs:125-144`). So "organization-global, no target"
describes the *feature keys*, not the session — the caller's location is
already in hand at the point the verdict is built, and `scope_granted` could
be computed from it without changing the command signature at all.

That leaves a narrower question for the ruling: is a verdict about the
caller's *current* location the useful diagnostic, or should the command take
an explicit location argument so support can ask about a location the caller
is not standing in? The first needs no signature change; the second is more
useful for the support case that motivated the item.

**Still true from the table above:** the caps DTO carries no
`expires_at`/`grace_until`. The desktop command works around it by reading
the signed row directly for the expiry and deriving the grace deadline, so
the "ruled yes" detail fields are satisfied without touching the caps
surface — which the design had explicitly put out of scope.
---

## Amendment 3 — slice landed, and two defects worth the lesson (2026-09-07, DSH)

The observability slice is now built end to end except the screen:

| Surface | Commits | State |
|---|---|---|
| Core resolver + 13 tests | `869de0ce`, `2e86fb9b` | in HEAD |
| Desktop IPC command | uncommitted (another agent) | written, not landed |
| Tablet IPC command | `e17a4e32`, `dfbc41b2` | in HEAD, 4 tests |
| `ui/src/api` + dev-mock | `9c9b6f53`, `987d5698` | in HEAD |
| Settings → Diagnostics screen | — | separate slice, per the design |
| `scope` reason code | — | **awaiting ruling**, see above |

**Defect 1 — a wire key typechecking cannot see.** The UI client fn shipped
in `9c9b6f53` passed the session as `session_token`. Tauri binds command
arguments by the camelCase form of the Rust parameter, and every other scoped
call in `ui/src/api` uses `sessionToken`. The call would have failed at
runtime with a missing-argument error while `npm run typecheck` stayed green,
because the invoke args object is an untyped literal. Fixed in `987d5698`.

The report that delivered it listed "typecheck passed" as evidence of health
in the same breath as the key name. Those two facts were in tension; the
typecheck was the weaker one. A green type system over an untyped boundary
proves nothing about that boundary.

**Defect 2 — the wrong parity invariant.** The tablet command mirrored
desktop's debug Free→Premium tier upgrade into the tablet verdict, with a
comment saying this stops the tablet verdict contradicting the *desktop*
verdict. It stopped the wrong pair. The tablet's `get_subscription_capabilities
applies no such upgrade (`subscription.rs:105-108`), so in a debug tablet
build the verdict reported `premium` while the caps payload beside it
reported `free` — the diagnostics surface telling support a feature was
available on a register whose tier gates were locked. Desktop's own comment
states the real rule: mirror *this client's* caps so a verdict can never
contradict the payload the gates actually read. Fixed in `dfbc41b2`, which
also adds `verdict_resolves_fail_closed_like_the_tablet_caps_command` across
all ten keys.

That test was verified to bite, not merely written: restoring the upgrade
fails it with `left: "premium" / right: "free"`. The `fresh_db()` fixture
seeds a validly-signed **active** Free row, which is exactly the input the
upgrade promotes — so the branch is reachable in tests after all.

**Unowned finding:** the tablet's capabilities command lacks the debug
Free→Premium upgrade that desktop's has. Every tablet dev-mode tier gate
therefore locks where the equivalent desktop gate opens. Pre-existing,
unrelated to this slice, and deliberately *not* fixed from here — the verdict
now agrees with caps as shipped, and closing the caps gap is that command's
owner's call. Recorded rather than papered over.

---

## Amendment 4 — the desktop command landed; scope answer; sweep ownership (2026-09-08, the desktop-command agent)

**Amendment 3's open table row is closed.**
`explain_feature_availability_scoped` landed desktop-side as `ff85e7be`
(3 files, 377 insertions): the command, eight verdict tests in
`subscription_tests.rs` (tier, quota at-cap/below, server_policy, role,
lifecycle + `expires_at` echo, grace + `grace_until`, add-on grant,
unknown-key fail-closed), and the `generate_handler!` registration.
`commands::subscription` is 18/18 with the tablet re-add of `Warehouses`
in the tree; the pre-commit fmt/i18n gates ran clean.

The command keeps the two traits Amendment 2 singled out as worth keeping
(`gate_permission` over real registry keys; `server_grant` produced from
`TenantSubscription::allows_workspace_type`), keeps the desktop dev
tier upgrade (desktop caps HAS it — the dfbc41b2 invariant is per-client,
and the desktop verdict mirrors the desktop payload, exactly as that
commit's message prescribes), and passes no `scope` target — which is the
last open item below.

**Sweep ownership, recorded from this side.** The `869de0ce` commit that
Amendment "Downgrade detection slice" (todo-global-saas-2.md) flags for
sweeping four untracked downgrade files under its message is mine. The
pathspec was explicit, not whole-tree — but it was built from a wrong
ownership premise: the files predated my session in the working tree and I
attributed them to my own lane's prior work without checking the todo
journals first, which is where their authorship was recorded. The lesson
goes one step past the AGENTS.md pathspec rule: **an explicit pathspec
only limits the damage to what you name — it does not tell you what the
names are.** Untracked files carry no author trail; the journals do. I
should have read them before committing anything I did not personally
write in that session. The content landed byte-identical and green
(verified independently by its author), so the cost is attribution only.

**Scope — answer for the ruling, not a unilateral change.** The command
still ships `scope_granted: None`. Amendment 2 is right that the session
already carries a location (`session.store_id`) and the axis could light
up without a signature change. My recommendation to whoever rules:

- **v1 (now): compute `scope_granted` from the caller's current session
  location.** The verdict's contract is "explain the gates that bind the
caller where they stand" — and the session gate itself already scopes on
`session.store_id` (`authz.rs:99-105`), so the verdict would explain the
scope check the caller is actually subject to. Silent-`None` is honest
about the features (organization-global) but under-sells the surface: for
a scoped staff user, `scope` is a real denial reason for real features
and today the verdict would name `role` or nothing instead.
- **Later, on evidence: an explicit target argument.** Support asking
"why can't USER X use Y at LOCATION Z" is a different query — it needs a
different permission shape too (the caller must be allowed to diagnose
another user, not just read settings). Building that spec before anyone
asks for it is how speculative surface accumulates.

This is a behavior change to a command that has been in HEAD for one
day, in one client — the cheapest moment it will ever have. I have not
implemented it: Amendment 2 explicitly asked for a ruling, and
"resolved by whichever agent commits second" is the failure mode it
named. If the ruling comes back "current-location, v1", the change is
small: gather the assignment in `load_feature_verdict`, evaluate
covers-resource on `session.store_id`, wire `scope_granted`, and extend
the oracle test — the resolver side is already built and tested.

---

## Amendment 5 — scope ruling + landing (2026-09-08, DSH)

**RULING (maintainer, this session): v1 = current-location, per
Amendment 4's recommendation.** The verdict explains the gates that bind
the caller where they stand; `session.store_id` is already the branch the
session gate scopes on, so the verdict answers the scope check the caller
is actually subject to. An explicit target argument ("why can't USER X
use Y at LOCATION Z") stays deferred until support actually asks — it
needs a different permission shape (diagnose-another-user) and is
recorded here as future work, not silently dropped.

**Landed, one commit:** both clients' `load_feature_verdict` now takes
the session's `(store_id, type_key)` and computes `scope_granted` as the
**composite the authorization model actually asks for** — the spec-0048
branch/workspace check (`matches_scope`, what `require_permission_scoped`
runs) AND the ADR #47 resource-coverage check on the session location
(`covers_resource(Location, …)`, or the entity walk through
`location_legal_entity_id` for `legal_entity` rows), with legacy users
without an assignment row staying silent `None` (ruling 5, bit-for-bit).
One design subtlety worth recording: the diagnostics gate itself
(`require_permission_for_session` on `settings:read`) already applies
the 0048 check, so mirroring only that check could never fire `scope` —
the caller would get an error instead of a verdict. The composite makes
the axis observable while still explaining the exact coverage question
the choke point (`authz.rs:125-144`) layers on top. The desktop debug
tier-upgrade mirror is preserved (per-client invariant, `dfbc41b2`'s
rule), so a verdict can never contradict the caps payload beside it.

`VerdictDetail` gains `scope_granted: Option<bool>` (wire
`scopeGranted`, TS mirror + dev-mock updated) so the M2 diagnostics
screen can render "you're scoped out of this location" without
re-deriving it. Resolver detail population is centralized — the oracle
tests stay valid (`cargo test -p oz-core --lib availability` 13/13).

**Tests:** desktop adds three (out-of-scope location denies `scope`;
in-scope clears `Some(true)`; out-of-scope workspace dimension denies
`scope`), tablet mirrors the desktop verdict on the same assignment and
pins ruling 5 (`None`) — 24/24 desktop, 5/5 tablet, all with the
premium-seed caveat recorded in the tablet test (no debug upgrade there,
so Free would let the tier axis outrank scope and the test would verify
the wrong denial). UI `tsc --noEmit` clean. Ruling-5 semantics were
already covered at the choke-point layer (`authz_tests.rs`); these pin
the verdict's echo of them.

---

## Amendment 6 — the same ruling from the other side, and one dedup (2026-09-08)

Two agents picked up Amendment 4's open `scope` question in the same
window and reached the same ruling and the same load-bearing finding
independently. That convergence is the useful signal, so both records
stand rather than one being edited to match the other.

- **Ruling: v1 = current-location**, as Amendment 4 recommended. Explicit
  target argument stays deferred until support actually asks.
- **The dead axis.** Amendment 4 justified computing `scope_granted` from
  `matches_scope` on `session.store_id` (citing `authz.rs:99-105`). That axis
  cannot fire: the verdict command's own session gate already runs
  `require_permission_scoped` with those exact values, so every caller who
  reaches the resolver has passed it — a diagnostic built on it is a
  constant `Some(true)`. The axis that can answer is ADR #47's
  `scope_type`/`scope_id`, which the session gate does **not** consult.
  Amendment 5 found the same thing in its own words; the shipped composite
  is the fix.

**What this side contributed, in two commits:**

1. `62003be9` — `Store::resource_covered_by` as the single implementation of
   ruling 3's inheritance, with `assignment_covers_resource` exposing it as a
   non-throwing `Option<bool>`. The trap it avoids is concrete, not
   hypothetical: `Assignment::covers_resource` deliberately omits the
   `legal_entity` → `location` downward walk (the walk needs the `locations`
   table, which the model layer must not assume), so a diagnostic calling
   it directly reports `scope` for a legal-entity manager standing in a
   location their own entity owns — a false denial about enforcement, worse
   than no diagnostic. Verified to bite by mutation: replacing the helper
   with a direct `covers_resource` call fails
   `coverage_diagnostic_agrees_with_the_resource_gate` with
   `left: Some(false) / right: Some(true)`.
2. `e4c8ab56` — Amendment 5 landed the composite correctly but wrote the rule
   out again inside each client command, byte-identical in desktop and
   tablet: three implementations of one authorization rule, free to drift.
   `Store::assignment_covers_session` now holds it and each client is one
   call. Behavior-preserving — desktop's three scope tests and the tablet's
   mirror pass unchanged across the swap, which is the point of routing
   them through shared code.

**Collision note, because it is this branch's recurring hazard.** The M2
diagnostics screen was picked up in the same window
(`DiagnosticsSection.tsx`, `SettingsPage.tsx`, `SettingsNavTree.tsx`,
`settings*.ftl`) and `assignments_tests.rs` was being extended live. Every
commit here used an explicit pathspec and none of those files were
touched. One trap worth recording: `cargo fmt -p oz-core` rewrites other
agents' files in that package too, so it can silently widen a
pathspec-limited commit's content — re-check `git diff` after running it
rather than trusting the pathspec alone.

**Item status:** observability is core + both IPC surfaces + UI client +
dev-mock + the `scope` reason code. Only the screen remains, and it is
owned elsewhere.

---

## Amendment 6 — the Diagnostics screen landed (2026-09-08, DSH)

The observability item's last open slice is done — the "owned elsewhere"
line above is now closed by this entry:
**Settings → System → Diagnostics** (`sections/DiagnosticsSection.tsx`,
registered in `SettingsNavTree` under the System category after License,
scope tag `organization`, KEPT_SECTIONS deep-link allowed). Read-only:
on mount it asks `explain_feature_availability_scoped` for all ten v1
feature keys and renders one row each — feature label, an
available/reason badge, and the resolver's detail line verbatim (tier,
lifecycle state, usage/limit for quota-kind features, the gate
permission, the scope coverage phrasing from the M1
`scopeGranted` detail field, and `expiresAt`/`graceUntil` when
present). No mutation, no server round-trip — offline-honest like the
command it reads. A failed batch renders a `role="alert"` hint with a
Refresh retry; a missing session token fires nothing.

FTL: 33 new keys × both locales (`settings-diagnostics-*`), every one
referenced by a literal in the component so bundle parity and the orphan
gate see them live — the reason labels are a literal
`Record<NonNullable<FeatureVerdictReason>, string>` map, deliberately
not dynamic composition. Indonesian strings are real translations, not
id-identical copies.

Tests: `DiagnosticsSection.test.tsx` (7) — all-ten-rows render with the
session token carried on every call, the reason badge for a tier denial,
the quota usage/limit line, the scope not-covered phrasing, expiry/grace
details, the failure alert, and the token-less no-call invariant. Suite
green 7/7; i18nBundle + SettingsPage suites 69/69; `tsc --noEmit`
clean; `lint-i18n.sh` clean; the refactored scope tests above still
pass (24/24 desktop, 5/5 tablet). One testing note worth keeping: the
global `test-setup.ts` stub owns `useWorkspace`, so per-test overrides
must go through `vi.mocked(useWorkspace).mockReturnValue(...)` per its
documented pattern — a local `WorkspaceContext.Provider` is silently
ignored by the stub, which cost one false-red round here.

