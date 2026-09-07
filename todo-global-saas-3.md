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

- [ ] **Implement custom roles safely.** Keep built-in roles as defaults, but
      make custom roles explicit permission sets with explicit scopes. Unknown
      roles default to deny; do not assign unknown names a numeric hierarchy
      level automatically.
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
      only). The `role_assignments` model is now buildable; note the
      assignment-editing UI is explicitly a separate slice per the ADR's
      non-goals.
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
- [ ] **Make feature flags and entitlements observable.** Support diagnostics
      should show why a feature is unavailable: role, scope, tier, quota, expiry,
      or server policy.
      — **designed 2026-09-07, not yet implemented** (§"Feature-flag
      observability — diagnostics design" below, verified against HEAD
      `3c2fcdb8`): one session-gated verdict command
      (`explain_feature_availability_scoped`, `settings:read`) with a
      deterministic reason-code precedence (server_policy > lifecycle > tier
      > quota > role > scope) derived from the capabilities surface the
      supervisor's Round-1 watch-item told us to re-check first. Execution
      gate: the subscription agent's in-flight §B slices commit first (their
      `max_stores` deprecation renames fields under this surface); `scope`
      wiring waits on the `role_assignments` model landing — **ADR #47 is
      accepted (2026-09-07), so the model is buildable**; implementation,
      not the ruling, is the remaining gate.
- [ ] **Add multi-Organization user switching.** One human identity may hold
      memberships in several Organizations; switching between them is a later
      capability built on scoped assignments, not a second hierarchy layer.
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

## Feature-flag observability — diagnostics design (2026-09-07, DSH) — ready-to-execute, one coordination gate

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
| `scope` | location-scoped assignment denies this location | **blocked on ADR #47** (Proposed, awaiting ruling) — v1 returns `scope` only when the scoped-assignment table exists, else omits the code |

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

1. **Wait for the subscription agent's in-flight §B slices to commit** — the
   command reads their `TenantSubscription` state machine, and their
   `max_stores` → `max_locations` deprecation (visible deprecation warning in
   the tablet build) will rename fields under this surface. Do not collide.
2. Core verdict resolver (pure fn over caps + session role + usage) in
   `oz-core` with the precedence table unit-tested exhaustively.
3. IPC in both clients + dev-mock + `ui/src/api/` client fn; parity + i18n
   gates; registry-key note in `verify-scoped-coverage.sh` if needed.
4. UI surface (Settings → Diagnostics section) — separate slice.
5. When the `role_assignments` model (ADR #47 — **accepted 2026-09-07**, all
   five recommendations adopted) lands: extend the resolver with the `scope`
   source and add the scoped-assignment denial tests.

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
