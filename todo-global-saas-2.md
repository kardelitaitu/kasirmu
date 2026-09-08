# Global SaaS POS — Phase 2: P1 Product Maturity

Phase 2 of 3. Sibling phases:
[`todo-global-saas-1.md`](./todo-global-saas-1.md) (Phase 1 — P0 platform
foundations; carries the shared contract: baseline, access contract, canonical
hierarchy, adopted policy §A/B/E/F/G/H/I, and the decisions list) ·
[`todo-global-saas-3.md`](./todo-global-saas-3.md) (Phase 3 — P2 scale &
operations).

This file holds the P1 work list and the domain specs it implements: Memo
lifecycle, Shifts, downgrades, entitlements beyond tiers, the offline outbox,
audit baseline, and Locations/Topology navigation. Phase 1 gates this work:
the P0 review checkpoint in the Phase 1 file must be complete and verified
before the full Tools redesign and this phase's deeper features begin.

Supersedes the single-file `todo-global-saas.md` (split into phases
2026-09-05).

## Memo lifecycle (adopted §C, merged with former §14)

Two Memo types, adopted 2026-09-05 — Organization Memo (owner/admin, every
registered terminal) and Location Memo (owner/admin/manager, every terminal of
one selected location; v1 rule — multi-location targeting has since landed,
2026-09-07, `4df091d3` + `b40593a0`, see todo-global-saas-3.md). Proposed rules:

- managers may create and edit Location Memo drafts within their assignment
  scope; only owner/admin create Organization Memos;
- publishing requires the same scoped write permission as creation;
- published content is immutable; corrections create a new revision;
- the author picks a duration of 12h, 24h, 3d, 7d, or 30d; 24 hours is the
  default;
- the author or a holder of the `memo:stop` permission may stop a published
  Memo before its duration ends; stopping is a first-class state, distinct
  from natural expiry; *(ruled 2026-09-07: option A2 — `memo:stop` granted to
  the Owner and Admin presets, author short-circuit preserved, everything
  else deny-by-default; fallback A1 reuse `memo:write`. Rationale in the
  ruling section at the end of this file.)*
- authoring, stopping, and archiving lock at `expiresAt` like other
  administrative features; Memos already active keep displaying until their
  duration ends (at most 30 days);
- acknowledgement is optional by default, with a future per-Memo required flag;
- the target terminal is read-only and may acknowledge receipt;
- the author or a scoped admin/owner may archive a Memo;
- stopped and expired Memos remain archived for 30 days before deletion or
  anonymization *(ruled 2026-09-07: fixed 30-day window — the `archived` sweep
  is unblocked)*; the draft-expiry clause this bullet used to carry was
  dropped the same day — a draft is visible only to its author (`memo.rs:61`),
  so a stale draft leaks nothing and no `Draft → Expired` arm is added;
- active Memos display on the staff login screen and lock screen, plus a
  dismissible chat-bubble overlay pinned bottom-left every 15 minutes
  (30s per cycle; on KDS
  the interval doubles to 30 minutes — kitchen traffic cannot afford a
  15-minute interruption — and the cadence must be implemented as 2× the
  shared base interval, never a second independently-tuned constant);
  when both types are active they stack with Location above Organization
  *(ruled 2026-09-07: "staff login screen" means once the staff PIN pad is
  up — after authentication, via the existing session-scoped read; no
  pre-auth Memo read will exist; amended 2026-09-07, `eef79ebd`: the
  notification surface was redesigned from a top-sliding bar to a
  bottom-left chat bubble at the owner's direction)*;
- stopping or expiry removes the Memo from every surface immediately;
- the notification's visual design is TBD — the working candidate is the
  tooltip treatment with a close button revealed on hover or first click, so
  dismissal on a no-mouse (touch) environment takes two interactions and
  cannot happen accidentally.

Memos use the states `draft`, `published`, `queued`, `delivered`,
`acknowledged`, `stopped`, `expired`, and `archived` (`stopped` records a
deliberate early end, distinct from natural expiry). There is no `read` state:
the display surfaces are passive, so only terminal receipt and explicit
acknowledgement are measurable. Memo delivery is confirmed when the target
terminal reports receipt (`delivered`); operator acknowledgement
(`acknowledged`) is optional and tracked as a separate state (from former
§12's Memo clause).

> **Implemented as two orthogonal machines, not one 8-state list — the spec
> above is now stale and should be read as superseded on this point.**
> `cf69ec3c`/`7fed26cc`/`ebddda1f` landed:
>
> - `MemoStatus` (5): `draft → published → {expired | stopped} → archived`
> - `DeliveryStatus` (3), **per recipient, per terminal**: `pending →
>   delivered → acknowledged`
>
> `queued` became `DeliveryStatus::Pending`; `delivered`/`acknowledged` moved
> onto the recipient row, not the memo. The module doc at `memo.rs:13-17`
> gives the reason, and it is the right one: *"conflating them
> is the classic memo bug"* — a Published memo legitimately has Pending
> recipients while a terminal is offline, which a single linear machine cannot
> express. The schema CHECK constraints mirror the enums exactly
> (`20260909_memos.sql:26-27,73-74`), so code and storage agree.
>
> **Why this is recorded rather than fixed in place:** the 8-state list above
> is adopted policy §C, so rewriting it is the owner's call, not a
> drive-by. But leaving it as-is is the worse option — the next agent to read
> "Memos use the states … `queued` … `acknowledged`" may well "correct" the
> working two-machine design to match the spec and break offline delivery.
> Anyone picking up Memo work should read the two enums as normative.
>
> Verified 2026-09-06: no inconsistency between the domain enums and the
> schema — all 5 + 3 states are persistable and nothing in the enums lacks a
> CHECK arm.

## Shifts (adopted §D)

Keep Shifts in Operations with `manager+` access for active tiers. Scope all
reads and mutations to assigned locations. Basic open/close, break, handover,
and shift history remain role-only. Advanced scheduling, forecasting, or
labor analytics may become a Pro+ entitlement later, but should not block the
first operational implementation.

## Downgrade behavior (adopted §J, merged with former §11)

A downgrade must not interrupt an active sale or delete customer data. Mark
resources above the new quota as `over_quota`, keep existing data readable, and
block new creation, registration, expansion, or premium mutations. Show owners
which resources are affected and offer archive-or-upgrade remediation. Retain
historical records according to the tenant's retention policy. Active sales
are not interrupted mid-transaction; premium data remains retained under the
data-retention policy.

## Entitlements beyond tiers (from former §10)

The server returns features, quotas, add-ons, billing state, trial state,
expiry, grace policy, and Enterprise overrides. UI `minimumTier` values are
configuration hints; final access uses server-issued feature entitlements.

## Offline synchronization (from former §12)

Use an outbox with `pending`, `sending`, `delivered`, retryable-failure, and
permanent-failure states. Every mutation carries a tenant/scope, aggregate ID,
and idempotency key. Retries use backoff; aggregate ordering is preserved;
conflicts are visible rather than silently overwritten. Offline Queue visibility
is available to all active tiers; Cloud Sync and advanced conflict tools are
Plus+.

## Audit baseline (from former §13)

Premium and Enterprise receive full business audit logging. Paid tiers
retain basic security events: failed login, role changes, terminal
registration, topology Apply, license changes, and destructive actions. Full
plans add longer retention, filtering, export, and compliance views. Free has
no tenant-facing audit logs and no audit-log retention entitlement.

Adopted default retention schedule:

- **Free:** no audit logs.
- **Plus:** 90 days.
- **Pro:** 180 days.
- **Premium:** 1 year.
- **Enterprise:** 3 years by default, with a configurable retention period for
  contracted compliance requirements.

Retention is measured from the event timestamp. Expired audit data is deleted
or irreversibly anonymized according to the tenant's data-retention policy;
legal holds and compliance exports must be handled separately.

## Locations and Topology navigation (from former §15)

Locations remains a status-oriented page with `View details` and
`Configure topology` actions. Location creation begins from Locations for
discoverability, then opens the scoped Topology Editor for workspace, terminal,
KDS, warehouse, and routing configuration. Topology remains the owner of the
actual relationship mutation.

## P1 — required for a mature global product

- [ ] **Implement regional configuration.** Support locale, language, timezone,
      currency, tax regime, fiscalization, receipt format, numbering, and local
      payment settings at the decided organization/legal-entity/location scopes.
      — **Unblocked 2026-09-08** (§G closed by `20260908_legal_entities.sql`).
      **Design written:** see §"Regional configuration — design" below — nine
      axes, six of which already exist somewhere with no stated precedence, three
      (`fiscalization`, `numbering`, any entity-level default) that do not exist
      at all, and one live defect the inventory surfaced: `locations.timezone` is
      written as an IANA name and read as a fixed UTC offset, so a Jakarta
      location buckets its own business dates in UTC. **Slice 1** (schema +
      `oz_core::regional` resolver, core-only) is the one landing this round;
      slices 2–7 are queued below. Box stays open until the axis set is
      complete.
- [ ] **Separate business tax configuration from application defaults.** Tax
      rules, effective dates, tax-inclusive behavior, and fiscal requirements
      should be location-aware; display currency and UI preferences should not
      accidentally change tax calculation.
- [ ] **Implement entitlements beyond tier comparison.** Model plan, add-ons,
      quotas, billing state, trial state, expiry, grace policy, and server-issued
      feature entitlements. Tiers alone are not enough for custom Enterprise
      contracts.
      — **⚠️ Read `todo-global-saas-3.md` §"Feature-flag observability" before
      starting — much of this vocabulary already exists, and a second model
      would sit beside it.** `oz_core::availability` (landed `869de0ce`)
      already names and resolves six of the axes listed above —
      `server_policy`, `lifecycle` (billing state), `tier` (plan), `quota`,
      `role`, `scope` — under a fixed precedence with 13 tests, and both
      clients' `explain_feature_availability_scoped` returns a verdict
      carrying `expiresAt`/`graceUntil`. But it models *explanation*, not
      *enforcement*: the gates still read the caps DTO independently. So this
      item's real remaining work is consolidating enforcement onto one
      entitlement source, not re-deriving a reason taxonomy. — **Design
      written 2026-09-08:** see §"Entitlement enforcement consolidation"
      below (four phases: one read model, one limit table, trial state,
      server-issued per-feature grants).

      Genuine gaps the resolver does NOT close: **trial state** exists only
      server-side (`license_keys.is_trial`) and the client collapses it away
      (`SubscriptionTier::from_db("trial") => Free`, `subscription.rs:98`), so
      there is no client-visible trial flag and no trial end date anywhere in
      the local model; **custom Enterprise contracts** depend on ADR #47's
      key-set roles, where the `assignments` scope model has landed
      (`94e8a100`, `453c629f`) but custom-role authoring has not; and
      `server_policy` has exactly one denial producer today
      (`TenantSubscription::allows_workspace_type`), so most server-issued
      entitlements remain unrepresented.
- [x] **Publish the numeric plan limits.** ~~Put the real quota numbers~~
      — **premise was stale**: the pricing page has carried the full §3
      numeric matrix since 2026-08-17. What was actually missing was the §E
      verification half, delivered 2026-09-06 in `883386f4`:
      - `pricing-content-invariants` now pins all nine quota rows in both
        locales to the canonical enforcement values (`tierQuotas()` ↔
        `SubscriptionTier::max_*()`), so pricing ↔ code drift fails CI;
      - the adopted audit retention schedule is published (Free none, Plus
        90d, Pro 180d, Premium 1y, Enterprise 3y);
      - Enterprise grace published as 60 days per adopted §B;
      - §3 footnotes the two published-but-unenforced numbers (KDS screen
        count, product quota) as the contract Phase 1 "centralize quota
        enforcement" must match — **these remain open work, tracked there**;
      - QRIS docs row split static-vs-dynamic to resolve the apparent
        docs↔pricing contradiction (both were right about different things).
      Remaining sub-decisions this surfaced, NOT resolved here: whether
      staff/KDS/products quotas become server-issued payload fields
      (Phase 1 §E says they must), and whether Free keeps the "QRIS
      payments" marketing label while `supports_qris()` is dynamic-only.
- [ ] **Implement downgrade behavior.** Preserve over-limit locations,
      terminals, staff, KDS screens, history, and topology nodes as
      readable/marked `over_quota`; block new creation and provide
      archive-or-upgrade remediation.
      **PARTIAL (2026-09-08, `869de0ce`): the tenant-level detection layer
      landed** — `oz_core::downgrade` (`evaluate` + `OverQuotaReport`) and
      `Store::assess_downgrade` answer "which resources are above the
      (downgraded) tier's quota, and by how much," reusing the exact
      `count_*` the creation gates consult so over-quota ⟺ the next
      creation is blocked. "Block new creation" was already true (the
      `enforce_*_quota` gates + POS `suspend_surplus_instances`). Still
      open, so the box stays unchecked: the owner-facing remediation view
      ("show which, offer archive-or-upgrade"), a persisted per-resource
      `over_quota` marker, and the per-location dimensions (KDS screens,
      topology nodes) which `assess_downgrade` deliberately excludes.
      See §"Downgrade detection slice".
- [x] **Implement offline synchronization guarantees.** Add durable outbox
      states, retries, conflict handling, idempotency, ordering, clock handling,
      and visible failure states. — **verified complete 2026-09-06** across
      rounds 3–5 against the live code (not the todo's stale premise). Each
      spec clause maps to existing, tested behaviour:
      - **durable outbox states** — `offline_queue.status` pending/synced/failed
        + a `sync_remote_failures` dead-letter side table (pull side). The
        spec's 5-name enumeration is covered semantically: `sending` is
        deliberately absent (at-least-once + idempotency make an in-flight
        state unnecessary and crash-stuck-prone), and retryable-failure folds
        into `pending` (transient failures stay pending and re-drive next
        cycle). Assessed, not an oversight.
      - **retries** — daemon cycle-level exponential backoff with full jitter
        (`compute_backoff`, capped 60s, 60–120s rhythm) + pull-side retry
        budget 3 → dead-letter.
      - **conflict handling** — ADR #21 shared resolver (`apply_push_conflict`);
        a remote product update that disagrees with the local row returns
        `CoreError::Conflict` and dead-letters visibly rather than overwriting.
      - **idempotency** — client-generated item id + server `ON CONFLICT (id)
        DO NOTHING` + `sync_applied_items` receipts; `09c9d0f1` fixed the one
        real gap (a `duplicate id:` replay was stranded as terminal-failed
        instead of synced).
      - **ordering** — strict `created_at ASC` FIFO on every pending query.
      - **clock handling** — durable pull anchor (SYNC-01), operator-rewind
        detection (SYNC-09), AnchorExpired→snapshot recovery.
      - **visible failure states** — daemon status (`backoff_ms`,
        `consecutive_failures`, `last_error`), summary (`failed_count`,
        `conflict_count`), `8dad239c` COR-20 made degraded reads log, and
        dead-lettering stays surfaced in status after the page advances.
      Commits this session: `8dad239c` (COR-20), `09c9d0f1` (duplicate-id),
      `3901b5e3` (unblock platform-sync), `e0a1d7f3` (correct the misleading
      pull-path validation stamp). Remaining outbox ideas (per-item
      `next_attempt_at`, non-retryable fast-fail) are enhancements beyond the
      spec, each needing a migration or a highest-risk-path behavior change —
      deferred, not dropped.
- [ ] **Implement the audit baseline and retention schedule.** Paid tiers
      retain basic security events; Plus defaults to 90 days, Pro to 180 days,
      Premium to one year, and Enterprise to three years with a configurable
      contract override. Free has no tenant-facing audit logs. Premium and
      Enterprise also receive full business audit logging, filtering, export,
      and compliance views.
- [x] **Implement the Memo lifecycle.** Ship both Memo types — Organization
      Memo (owner/admin, all registered terminals) and Location Memo
      (owner/admin/manager, one selected location — since widened to multiple
      locations, `4df091d3`) — with author-chosen
      duration (12h/24h/3d/7d/30d, default 24h), early stop by author or
      higher role, immutable published revisions, delivery and acknowledgement
      states, offline delivery, and retention. Display: staff login screen,
      lock screen, and a dismissible chat-bubble overlay pinned bottom-left
      (redesigned from the top-sliding bar, `eef79ebd`) every 15 minutes
      (30s per cycle; KDS doubles the interval to 30 min, coded as 2× the
      base interval); Location stacks above Organization.
      — **complete except offline delivery and the cloud data path
      (2026-09-07):** schema, state machine, store, desktop authoring IPC +
      screen, banner mounts, server-issued cadence, early stop (`memo:stop`,
      A2), 30-day retention sweep, and revisions all landed
      (`cf69ec3c` → `9062a7c1`; rulings recorded inline below and in the
      ruling journal). "Early stop by higher role" is now author-or-`memo:stop`
      (registry grant, no rank map); "staff login screen" means once the PIN
      pad is up (no pre-auth read); "drafts expire after 30 days" was dropped.
      Open: (a) offline delivery (rides the outbox; needs the tablet data
      path below to matter); (b) the KDS/tablet cloud-read data path —
      memos authored on desktop must reach the cloud DB and the tablet read
      a tenant-scoped endpoint (§"The tablet's Memo surface").
      **SUPERVISOR UPDATE 2026-09-07, HEAD `52af7f9b`: (b) is now COMPLETE
      - the item is functionally done end-to-end.** The full loop is
      committed: publish on desktop -> daemon push (`a009d3cf`) -> cloud
      serving (`eb71d071`/`9d125484`) -> tablet cloud-first read with local
      fallback (`2c5dde8a`) -> upstream ack with monotonic stale-push merge
      (`52af7f9b`, rank-merge integration test pins the downgrade scenario)
      -> retention, early stop, revisions, spec docs all previously landed.
      The only ruled-future sub-item is (a) offline delivery riding the
      outbox - future work, not an open defect. Supervisor recommends
      flipping this checkbox in the next journal pass.
      **FLIPPED 2026-09-07 (journal pass):** closed on that recommendation —
      the terminal ack half landed as `b9278fb0` (tablet cloud-first ack
      + local fallback, wire contract pinned), completing the loop's last
      open slice; offline delivery remains the recorded future-work item.
- [x] **Wire `revise_memo_scoped` (corrections).** The store path is fixed and
      TOCTOU-guarded (`e7b47b83`); this slice is the desktop IPC — gated
      `memo:write`, published-only, tenant-scoped — plus a revise control in
      `MemosScreen`. Ruled in scope 2026-09-07 (§"Separate, smaller point").
      **DONE, supervisor-verified 2026-09-07 at HEAD `315c1e6f`:** command
      registered in desktop `generate_handler!` (`lib.rs:1017`), wired in
      `ui/src/api/memos.ts` + dev-mock, `MemosScreen` revise control landed in
      `9062a7c1`. The checkbox had lagged the code; the journal below was
      already correct.
      **FLIPPED 2026-09-07 (journal pass):** closed on that verification —
      no code change; the box had simply lagged its landed work.
- [ ] **Add the Locations-to-Topology entry point.** Keep Locations
      status-oriented, but route location creation/details into the relevant
      scoped Topology Editor graph.
- [x] **Version and publish topology changes.** Preserve validation, optimistic
      concurrency, diff review, rollback/recovery, and an explicit Apply/publish
      boundary for location/workspace/device relationships.
      **CLOSED 2026-09-08 (supervisor round 1)** by ADR #46 Phase 2 — commits
      `af09ff15` (restore-to-draft + pruned-snapshot messaging) and `baecb7d8`
      (the ADR record), logged as Amendment 7 in `todo-global-saas-3.md:32`.
      Validation, optimistic concurrency and the Apply/publish boundary pre-date
      that work; revision history (`315c1e6f`) and the restore-to-draft browser
      UI (`TopologyRevisionBrowser.tsx`, `TopologyScreen.tsx`) are landed.
      **Still open, recorded so it is not dropped: the re-Apply rollback remains
      Phase 3 future work behind its own ADR** (ADR #46 §Phase 3 — taken up only
      on evidence that Phase 2 is insufficient).
      **SUPERVISOR NOTE 2026-09-07: this item is partially unblocked and
      partially delivered by ADR #46** (accepted, see
      `docs/decisions/2026-09-07-adr46-topology-revision-history-and-restore.md`):
      revision history (`315c1e6f`) + the revision INSERT in Apply's
      transaction satisfy the history/rollback half; validation, optimistic
      concurrency and the publish boundary already exist in Apply. Remaining
      when ADR #46 lands: browse/restore UI (Phase 2) and re-Apply rollback
      (Phase 3, own ADR).
- [x] **Scale navigation.** Preserve Operations, Insights, and Configuration;
      add search, stable page registration, favorites, or recent pages before the
      home screen becomes an unstructured card grid. — **verified complete
      2026-09-06** (round 6). The spec's list is disjunctive ("or"); three of the
      four affordances already ship, and the fourth is premature:
      - **stable page registration** — `platform/ui/page-registry` +
        `menu-registry` are the single source of truth; `AppLayout` renders the
        sidebar from `getNavItems()` grouped by a canonical `SECTION_ORDER`
        accordion (Operations/Insights/Configuration preserved), never a
        hardcoded list.
      - **favorites** — `WorkspaceHome` pins by `type_key` (`pinnedKeys`,
        `togglePin`, persisted via `savePins`/`loadPins`), pinned cards sort
        first.
      - **recent pages** — `WorkspaceContext.lastWorkspace` + `WorkspaceHome`
        `lastUsedMap` (`recordLastUsed`/`saveLastUsed`) sort unpinned cards by
        recency.
      - **search** — deliberately NOT added: the picker keys one card per
        workspace *type* (~6-8, bounded regardless of location count because
        `availableWorkspaces` is consumed by `type_key`), so the grid never
        becomes the "unstructured card grid" the clause guards against; a search
        box over 6-8 pinned/recency-sorted cards is gold-plating. Revisit only
        if the picker is ever changed to one-card-per-location-instance.

## Entitlement enforcement consolidation — design (2026-09-08, DSH)

The design for the "Implement entitlements beyond tier comparison" item,
written against HEAD `98cd2b62` and building on the warning recorded on
that item. The resolver (`oz_core::availability`) and the down-grade
detection layer (`oz_core::downgrade` + `Store::assess_downgrade`)
already *explain* and *detect*; this plan makes them the same source the
*enforcement* reads, so a verdict, a gate, and a remediation report
cannot disagree. Nothing here re-derives the reason taxonomy — it exists,
it is tested, and it wins.

**The drift this design closes, measured today:** the tier limit for a
quota family is resolved in three independent places — the creation gates
call `tier.max_*` inline (`enforce_location_quota` at
`db/locations.rs:97`, `enforce_product_quota` at `db/products_crud.rs:212`,
and their three siblings), `QuotaDimension::limit_for` resolves it for
`downgrade::evaluate`, and `AvailabilityFeature::tier_limit` resolves it
for verdicts. All three agree today because they all delegate to the same
`SubscriptionTier::max_*` methods — but "three callers agree by calling
the same four functions" is convention, not structure. The caps DTO adds
a fourth surface: desktop's applies the debug Free→Premium upgrade while
tablet's does not (the gap `dfbc41b2` recorded as unowned), so the two
clients' caps payloads already diverge by construction in dev builds.

**Phase A — one read model per client (`Entitlements`).** New
`oz_core::entitlements`: `Entitlements::from_subscription(&TenantSubscription,
usage: UsageCounts)` builds the session's entitlement facts once — tier
(effective), lifecycle state, add-ons, allowed workspace types, quota
limits, usage counts. Each client's `load_capabilities` becomes a
projection of that struct into its DTO, and `load_feature_verdict`
gathers its `AvailabilityFacts` from the same instance. The per-client
divergence is preserved deliberately: desktop's builder applies the dev
upgrade, tablet's does not (until tablet's caps owner closes that gap),
because the invariant is per-client agreement, not cross-client equality.
Deliverable: caps and verdict share one gather; a new entitlement axis
lands in one place, not four.

**Phase B — one limit table.** `QuotaDimension::limit_for` becomes the
single limit lookup; the five `enforce_*_quota` gates take their limit
from it instead of calling `tier.max_*` inline (signature unchanged —
they already receive the tier). The mapping is verified by a
correspondence test asserting `limit_for(d) ==` the gate's current
lookup for every dimension, so consolidation cannot silently change a
limit. After this, a tier-limit change surfaces identically in a gate
rejection, an `OverQuotaReport` row, and a `quota` verdict.

**Phase C — trial state, client-visible.** The server adds `is_trial` and
`trial_ends_at` to the signed payload (JSON — no schema migration; the
signature covers the payload). The client parses them into
`Entitlements`; `SubscriptionTier::from_db("trial") => Free` remains the
quota answer, with trial-ness carried as a flag and an end date instead
of collapsed away. This unblocks trial-specific UI ("N days left") and
trial-specific policy without a new wire surface.

**Phase D — server-issued per-feature grants.** `server_policy` has one
producer today (`allows_workspace_type`). The signed payload gains an
optional `features` block (`{"analytics": false}` for withhold, true for
grant-beyond-tier), consumed as additional `server_grant` producers in
the verdict path — the resolver's `Some(false)`/`Some(true)` semantics
already cover both directions and their precedence. Enterprise custom
contracts then become payload authoring rather than tier proliferation,
and depend only on custom-role authoring (todo-global-saas-3.md) for the
role half.

**Sequencing and gates.** A and B are client-core-only (no migration, no
wire change) and can land independently; C and D each need a
license-server change to author the payload fields and belong behind a
supervisor go. UI consumers are untouched throughout: the caps DTO keeps
its wire shape, so the parity gate and FTL surfaces stay quiet. The
`scope` axis joins through the same `Entitlements` instance once the
ruling recorded in todo-global-saas-3.md Amendment 4 lands.

## Phases A+B landed — implementation journal (2026-09-08, DSH)

Both client-core phases are in, per the sequencing note above (no
migration, no wire change, UI untouched):

**Phase A — one read model.** `oz_core::entitlements`:
`Entitlements::from_subscription` assembles tier (effective), §B state,
add-ons, and usage once; `build_entitlements` wraps the shared
fail-closed loader (missing/tampered/unreadable → `fail_closed`, never
an error) and takes `debug_upgrade` as a named decision — desktop passes
`true`, tablet `false`, so the per-client divergence the design
preserves is a builder argument rather than an inline `cfg` block that
reads like an accident. Both clients' `load_capabilities` are now
projections (`project_capabilities`) of that instance, and both
`load_feature_verdict`s gather their `AvailabilityFacts` through
`ent.availability_facts(...)` from the same shape — the desktop dev
upgrade runs through `Entitlements::apply_debug_upgrade`, shared with
caps, so a verdict and the payload beside it cannot disagree
(`dfbc41b2`'s rule, now structural instead of two parallel comments).

**Phase B — one limit table.** The five `enforce_*_quota` gates
(locations, terminals, warehouses, staff, products) now take their limit
from `QuotaDimension::limit_for(tier)` instead of calling `tier.max_*`
inline, signatures unchanged, and `AvailabilityFeature::tier_limit`
routes through the same table — the three-callers-agree-by-convention
drift the design measured is closed by structure. `Entitlements`'
limit projections (`max_locations` etc.) read the table too, so a
tier-limit change surfaces identically in a gate rejection, an
`OverQuotaReport` row, a caps payload, and a verdict.

**Correspondence tests** (`entitlements_tests.rs`, 7): the limit
identity is pinned per dimension across every tier from the read-model
side — `limit_for(d) == tier.max_x()` — so consolidation cannot
silently change a limit; plus fail-closed projection identity, usage
in/out identity, the analytics add-on flowing only while active or in
grace, the named dev upgrade promoting only a genuinely active Free row,
and the tablet path (`debug_upgrade: false`) never promoting even in
dev. Both clients' existing subscription suites (24 desktop / 5 tablet)
are the regression proof that the projection is behavior-preserving:
wire shape, numbers, and the `dfbc41b2` fail-closed invariant all pin
unchanged.

**Deliberately left:** `supports_analytics_with_addons`' nominal-Plus
requirement lives on in `Entitlements::supports_analytics` via the
`addon_grant_flows` + advanced_analytics check against the projected
tier — a Free row with the add-on gets analytics in caps exactly as
before, and the verdict's addon server-grant keeps its (pre-existing,
unowned) no-nominal-check shape, recorded here so nobody "unifies" the
two without a ruling.

## Remediation surface landed — journal (2026-09-08, DSH)

The §J item's remaining open halves (owner-facing remediation view) are
now in, commit `aa420395`:

**IPC** — `get_over_quota_report` in both clients, gated
`settings:read` (a diagnostics read echoing quota numbers, same band as
the verdict command), read-only, registered in both `generate_handler!`
lists so the shared UI can invoke it from either shell. It assesses
against the **effective tier** (`build_entitlements(..., debug_upgrade)`
→ `assess_downgrade(&ent.tier)`) — the tier the creation gates actually
enforce — so a dimension reported over quota is exactly one whose next
creation the gate rejects, the detection-layer contract. Desktop splits
the body into `load_over_quota_report` so tests run the production path
synchronously.

**View** — `OverQuotaCard` mounted in LicenseSettings: all-clear line
when nothing is over (`aria-live="polite"`), otherwise each over
dimension renders current/limit/excess with the archive-or-upgrade
guidance. Archiving itself stays in the resource screens — this card
deliberately does not delete anything, matching the §J rule that a
downgrade never silently removes resources. Upgrade CTA rides the
existing pricing flow (C2.2 banners already link it).

**Deliberately deferred, per the detection-slice note:** the persisted
per-resource `over_quota` marker. The live report is computed from the
same `count_*` the gates consult, so it cannot lie about a dimension's
state; a marker would add a migration competing with the rename/ADR
agents' hot files for a number the live assessment already answers. If
an offline-first audit trail of over-quota states is ever needed, that
is the slice that adds it.

**Tests:** desktop 2 (effective-tier assessment incl. the
at-cap-not-over distinction; post-downgrade excess arithmetic — 3
locations / 2 staff / 2 terminals on Free → excess 2/1/1, total 4),
tablet mirror 1 (assesses the same effective tier; 6/6 suite), desktop
suite 26/26, i18nBundle 20/20, `tsc` clean, parity + orphan gates green
on the commit.

## Phase 2 execution plan (2026-09-06)

Phase 1 gates this file, so the P1 list was dependency-triaged against the
Phase 1 checkboxes rather than taken in order. Triage result:

- **Unblocked now:** publish numeric plan limits ✅; offline outbox hardening
  ✅; scale navigation ✅. **All three are now verified complete (2026-09-06)**
  — the migration-free, non-Phase-1-blocked work is exhausted. Everything
  remaining is either migration-gated with an ambiguous window (Memo schema,
  Shifts) or blocked on Phase 1 P0 (entitlements, downgrade, audit baseline,
  regional config, topology entry/versioning).
- **Partially startable:** Memo lifecycle (schema, state machine, and
  owner/admin paths work under today's role checks; manager Location-Memo
  scoping waits for Phase 1 scoped authorization and the §F `memo:write`
  constant); Shifts scope validation (commands exist, per-location scoping
  waits).
- **Blocked:** entitlements beyond tiers (§B), downgrade behavior (centralized
  quotas), audit baseline (entitlement plumbing), regional configuration (§G
  Legal Entity, in flight), Locations→Topology entry and topology
  versioning/publish (rename completion + §I).

Execution order agreed 2026-09-06:

1. **Publish numeric plan limits.** ✅ DONE 2026-09-06 (`883386f4`) — see the
   P1 checkbox above for findings; the enforcement gaps it surfaced are
   recorded there and belong to Phase 1's quota-centralization item. Truth sources: `tierQuotas()` in
   `apps/license-server/paddle_webhook.go` (server-issued stores/POS
   instances/workspace types per tier), `SubscriptionTier::max_locations()` /
   `max_warehouses()` in `crates/oz-core/src/subscription.rs` (client mirror),
   §B grace days (Free/OneTime 7 · Plus 14 · Pro 14 · Premium 30 · Enterprise
   60), and the audit retention schedule above. Render into the website
   pricing table (en + id), `docs/guides/subscription-tiers.md`, and pin the
   numbers with `pricing-content-invariants` assertions. Known gap to surface
   as a decision, not invent: staff identities and KDS screens have no
   server-issued quota field today.
2. **Offline outbox hardening** — queue states, idempotency keys, aggregate
   ordering, visible failure surface. ✅ CLOSED 2026-09-06 — all seven spec clauses
    verified against live code; delivered 8dad239c (COR-20 visibility),
    09c9d0f1 (duplicate-id replay to synced), 3901b5e3 (unblock suite),
    e0a1d7f3 (correct pull-path stamp). See the checked P1 entry + Step 2 status.
3. **Memo groundwork** — `memo:write` constant → schema + 8-state machine →
   owner/admin IPC → deferred manager scoping → display surfaces (KDS cadence
   coded as 2× the shared base interval).
   - Checkpoint (2026-09-06): `728b1598` registered `memo:write` (Manager +
     Admin) and `topology:write` (Admin) through the full inventory contract
     (rbac.rs constant, REGISTRY 83→85, ALL_ENFORCED, preset grants);
     platform-core 330/330. Grants land ahead of enforcement so the §I
     staff:update→topology:write switch cannot lock Admin out.
4. **Scale navigation** after the rename churn settles.

Step 2 (outbox) status: audit closed 2026-09-06 (the delegated audit agent
was stopped after 3 rounds without a report; its scope was fully covered by
direct evidence gathered in rounds 1-2, recorded below). Findings: client
queue is `pending|synced|failed` with no CHECK constraint; permanent-failure
exists as the `sync_remote_failures` side table (attempts/max_attempts/
dead_lettered, atomic requeue); idempotency = item id + server
`ON CONFLICT (id) DO NOTHING` with per-item outcomes; push ordering is
strict `created_at ASC` FIFO (priority column deliberately not honored in
push — priority-jumping would break aggregate ordering); conflicts are
server-wins with a `resolved: conflict` marker counted in the status summary
(OFF-11); tier gating holds (queue visible all tiers, sync gated via
PlanRequired 403 + supports_cloud_sync). The sync_client.rs audit stamp was
stale (its "next: COR-31 timeout" had already landed in sync_pull.rs
10s/120s) — corrected by the rename agent in `c1d14ce8`.

- Checkpoint (2026-09-06): `8dad239c` closed **COR-20**, the spec's
  "visible failure states" requirement for the queue's defensive paths:
  dedup EXISTS and the status summary keep their benign defaults but now
  log op + error via `log_degraded`, and `query_or_none` separates the
  normal `QueryReturnedNoRows` empty case from real DB errors that `.ok()`
  conflated. 5 new tests; offline 54/54, sync 59/59.
- Checkpoint (2026-09-06): deeper push-path read found a real state bug the
  spec's "correct outbox states" clause covers. The server's `push_batch`
  emits only Accepted/Rejected (never Conflict), and a `duplicate id:`
  Rejected means the server already holds the item — the crash-then-repush
  recovery signal. Both client handlers marked ALL Rejected as terminal
  `failed`, but push-side failed items have no requeue path, so an item that
  had actually synced was stranded as a permanent failure polluting
  `failed_count`. `09c9d0f1` routes duplicate-id rejections to
  `mark_offline_synced` (shared `is_duplicate_id_rejection` predicate used by
  both `apply_sync_outcomes` and the daemon's `apply_push_results`); genuine
  rejections still fail, pinned by a boundary test. 3 new tests; oz-core
  sync_client 35/35, platform-sync 299/299.
- Checkpoint (2026-09-06): `3901b5e3` repaired two platform-sync
  `import_snapshot` test fixtures still inserting into the pre-rename
  `store_profiles` table — red at HEAD since `10260a03` renamed it to
  `locations` (the migration preserves columns, so the fix is the table name
  alone). Unblocked the platform-sync suite needed to verify the fix above.
- Checkpoint (2026-09-06): traced the pull (apply_remote) path to settle the
  queue.rs stamp's open "payload validation parity" question. It was a
  non-issue: `create_product_if_absent_in_tx` already rejects blank/oversize
  sku+name, negative price/initial_stock, and returns `CoreError::Conflict` on
  a same-sku-different-data replay, so malformed/conflicting pull items fail
  closed and dead-letter rather than writing garbage. `e0a1d7f3` corrected the
  misleading stamp (comment-only). **Step 2 is now closed as a spec item** —
  all seven clauses verified against live code (see the checked P1 entry); the
  only residuals are beyond-spec enhancements below.

Remaining Step 2 candidates (both need a migration, so they collide with
the rename agent's hot files `migrations.rs`/`migrations_tests.rs`/PG init
while their Legal Entity work is in flight — deferred, not dropped):
client-side per-item retry backoff (no `next_attempt_at` on offline_queue;
note the daemon ALREADY has cycle-level exponential backoff with full jitter
— `compute_backoff`, capped 60s — so the gap is only per-item pacing, which
is lower-value than it first looked) and whether a `sending` in-flight state
is worth its crash-stuck risk given at-least-once + dedup + the
duplicate-id-synced fix now cover correctness. The push-side state model is
now: `pending` (incl. transient-retry), `synced` (delivered incl. replay),
`failed` (genuine server rejection = permanent), pull-side dead-letter.

Coordination: the concurrent Phase 1 rename agent owns the store→location
workstream and recently committed website pricing copy — every Step 1 commit
re-checks tree state first and uses an explicit pathspec.

## Assist-pass verification (2026-09-06, DSH)

- **Repo-wide sweep for the COR-31 defect class came back clean.** Every
  `findings:`/`next:` audit stamp under `crates/`, `apps/`, `platform/` and
  `modules/` was scanned for parenthesized line citations past its own file's
  EOF. One hit — and it was the quoted text inside the `c1d14ce8` correction.
  Nothing else of that kind outstanding.
- **Step 2's remaining starting claims are true as read**, so no phantom work:
  `offline_queue.status` is `TEXT NOT NULL DEFAULT 'pending'` with **no CHECK
  constraint** (`20260813_init.sql:357`), `retry_count` exists while
  `next_attempt_at` does not; and `priority` really is never honored in push —
  every pending-queue query orders by `created_at ASC`
  (`db/offline.rs:252,275,473`), none by `priority`.
- **Green baseline at `728b1598`, so any red from here is new:** website
  `npm run check` exits 0 (42 files / 758 tests; `astro check` 0 errors /
  0 warnings / 25 hints); UI `npm run test` exits 0 (494 files / **8781
  passed, 16 skipped**); UI `npm run typecheck` clean. The website suite's
  stderr is noisy **by design** — jsdom `Not implemented: navigation` and
  `checkout open failed` are failure paths a test provokes on purpose, not
  failures. `todo-global-saas-1.md` used to call these "known failures";
  corrected there so no agent dismisses a real red as expected noise.
- **Docs pointer repair** (`f86b5a72`): both `subscription-tiers.md` copies
  cited a `BUSINESS_PLAN.md` path that never existed; now point at
  `docs/guides/BUSINESS_PLAN.md`. The guides↔records *entitlement* divergence
  is **R36-14 and still open** — deliberately untouched, it needs a ruling,
  not a reformat.

## Memo technical design (2026-09-06, DSH) — ready-to-execute, migration pending

> Superseded 2026-09-07: the window opened and this design landed **as
> amended** — `memos.location_id` became the `memo_locations` join table
> (multi-location, `4df091d3`) and the wire shape carries
> `locationIds: string[]` (`b40593a0`). The single-location `location_id`
> column below is the pre-landing pin, kept for the record.

The migration window is ambiguous (rename agent past schema into dev-mock, but
the LE migration comment says `legal_entity_id` is "intentionally nullable in
this schema-only slice," implying a future NOT-NULL enforcement migration), so
the Memo schema is NOT written this round. This design pins it so the moment
the window opens the migration + state machine + owner/admin IPC is one clean
slice. Grounded in verified conventions: `tenant_id` scoping + RLS (fd7f2ebc),
`locations(id, …, legal_entity_id)` (20260908), `Money`/i64 minor units, the
offline outbox just hardened (delivery/ack ride it), `memo:write` already
registered (728b1598), `init.pg.sql` is generated not hand-edited.

**Two orthogonal state dimensions** (the spec's "delivery and acknowledgement
states" are per-recipient, not per-memo — conflating them is the trap):

- Memo lifecycle: `draft → published → {expired | stopped} → archived`.
  `expired` is set by a sweep comparing `expires_at` to now (no DB clock
  trigger); `stopped` is the early-stop path; `archived` is the retention sweep.
- Per-recipient: `pending → delivered → acknowledged`.

**Schema (three tables, one migration `2026xxxx_memos.sql`):**
- `memos(id, tenant_id→tenants, location_id NULL→locations, author_user_id,
  author_role, title, body, status, duration, published_at, expires_at,
  stopped_at, stopped_by, revision, created_at, updated_at)`. `location_id
  IS NULL` ⇒ Organization Memo (all locations); set ⇒ Location Memo. Index
  `memos(tenant_id,status)`, partial `memos(expires_at) WHERE status='published'`
  for the expiry sweep.
- `memo_revisions(id, memo_id→memos ON DELETE CASCADE, revision, title, body,
  published_at, published_by, UNIQUE(memo_id,revision))` — immutability: an
  edit after publish inserts a NEW revision row and bumps `memos.revision`;
  prior rows are never UPDATEd.
- `memo_recipients(id, memo_id→memos ON DELETE CASCADE, terminal_id,
  user_id NULL, delivery_status, delivered_at, acknowledged_at, acknowledged_by,
  UNIQUE(memo_id,terminal_id))` — `user_id NULL` ⇒ terminal-wide (any user at
  that terminal acks). Offline delivery = a `memo.deliver` pull item; an offline
  ack = a `memo.acknowledge` push item through the existing outbox.

**Guards (server-side, not just UI):**
- Org Memo author ∈ {owner, admin}; Location Memo author ∈ {owner, admin,
  manager} AND author has access to that location (Phase 1 scoped authz — the
  deferred manager half).
- Early stop allowed iff `actor == author_user_id` OR `role_rank(actor) >
  author_role` (author_role is the snapshot taken at publish, so a later role
  change can't retroactively lock the author out or grant a demoted user).
  *(Ruled 2026-09-07: ranks never materialized — early stop is author OR
  `memo:stop` holder; see the ruling section at the end of this file.)*
- All writes require `memo:write`; reads are tenant-scoped + location-scoped.

**Display cadence (spec-pinned constants, single source of truth):**
base notification interval 15 min, 30 s per cycle; KDS = `2 × base` = 30 min
(code the multiplier, not the literal 30, so the "2×" intent survives a base
change); Location Memos stack above Organization Memos. Surfaces: staff login
screen, lock screen, dismissible bottom-left chat-bubble overlay
(amended 2026-09-07, `eef79ebd` — was "top-left notification").

**Open decision to surface, not invent:** memo retention window — the spec says
memos have "retention" but gives no schedule (unlike audit's tier ladder).
Options: reuse the audit retention schedule, or a fixed window. Needs a ruling
before the `archived` sweep is written. — **Ruled 2026-09-07: fixed 30-day
window**, matching the promise the spec already makes ("stopped and expired
Memos remain archived for 30 days before deletion or anonymization"). The
`archived` sweep is unblocked; the exact stopped/expired → archived → deleted
staging is the slice's design work.

**A second open decision of the same kind, currently untracked:** stale-draft
expiry. The rule is stated twice as settled — here ("drafts expire after 30
days without activity") and at `todo-global-saas-1.md:775` — but the state
machine cannot express it. `MemoStatus::can_transition` (`memo.rs:121-131`)
allows `Draft → Published` and `Draft → Archived`, and the doc comment labels
the latter **"(discard)"**, i.e. an explicit author action. There is no
`Draft → Expired` arm, and the store's only sweep is `Published → Expired`
(`db/memos.rs:324`), so nothing ever touches a stale draft.

That is not a free omission, and the module says so itself one line lower: a
live `Published` memo may not go straight to `Archived` because "ending a live
memo is an explicit `Stopped` (early stop), never a silent archive, so the
reason for ending is always recorded." Routing stale drafts to `Archived` to
satisfy the 30-day rule performs exactly that conflation on the draft side —
discard and expiry become indistinguishable afterwards.

Options, none of them invented here:

1. Add `(Draft, Expired)`. Cheapest, but overloads `Expired` to mean both
   "published then elapsed" and "never published", which display and audit
   then cannot tell apart.
2. Add a distinct terminal status for stale drafts. Honest, but changes the
   enum, the schema CHECK, and the generated PG init.
3. Keep `Draft → Archived` and add an `archived_reason` column, which preserves
   the "reason is always recorded" principle the module already commits to.
4. Drop the rule. Genuinely defensible — a draft is visible only to its author
   (`memo.rs:61`), so an un-expired draft leaks nothing to anyone — but then
   amend both spec sentences rather than leaving them to be re-discovered as a
   bug.

Worth ruling on before step (4) builds UI that has to render whichever answer
wins. Unlike the retention window, nothing currently flags this as open, which
is precisely how a decided-sounding spec line goes missing unnoticed.

**Ruled 2026-09-07: option 4 — drop the rule.** A draft is visible only to its
author (`memo.rs:61`), so an un-expired draft leaks nothing and the nuisance
stays cosmetic. Both spec sentences are amended (§"Memo lifecycle" above and
todo-global-saas-1.md's decisions list), `can_transition` gains no
`Draft → Expired` arm, and no sweep touches drafts.

**Build order when the window opens:** (1) migration + `init.pg.sql` regen +
registry entry + column-type lint; (2) `oz-core` memo store + state machine
with tests (the transitions/guards above are pure logic, testable before any
IPC); (3) owner/admin scoped IPC (desktop + tablet, `*_scoped`, parity
allowlist); (4) display surfaces + cadence; (5) deferred manager Location-Memo
scoping after Phase 1 scoped authz lands.

### Step (3) status: ✅ RESOLVED — `verify-ipc-parity.py` is green at `86c278fd`

Kept in place because the reasoning still applies to the next slice, but the
state below is historical. **Resolved 2026-09-06 by `86c278fd`**: the read pair
was registered on tablet (285→287) rather than allowlisted, dev-mock handlers
added for both (508→510), and the two now-stale `scoped_orphans` entries
removed — which is the mechanism working as intended, since the allowlist
comment itself says "an entry that gains a caller fails the gate as stale".
`create_memo_scoped`/`publish_memo_scoped` remain allowlisted as genuinely
transient (no authoring UI yet). Re-run the script before calling any IPC slice
done; do not assume the pre-commit hook covers it.

Checked at `c9772415` with the memo commands registered: **4 violations, exit
1**, all from the new desktop commands having no UI caller yet —
`create_memo_scoped`, `publish_memo_scoped`, `list_active_memos_scoped`,
`acknowledge_memo_scoped`. This is the same trap that shipped Legal Entities
red (`bcd1f501`): the gate is **not** one of the ten `.githooks/pre-commit`
steps and `dev-ci.yml` has no `push` trigger, so it passes every local check
and first appears at PR time. Run the script directly before calling step (3)
done.

Most of it self-resolves once `ui/src/api/memos.ts` exists and invokes them —
that is the expected direction, and the remaining Legal Entity lesson applies:
the dev-mock needs a handler for each, or `invoke()` returns `null` and the
caller silently renders its failure path.

⚠️ **But do not "fix" the two read commands by adding a permission check.**
The gate reports `list_active_memos_scoped` and `acknowledge_memo_scoped` as
"enforces no permission, so it is a redundant twin", which reads like a defect
and is not one. Verified against the spec:

- Memos display on the **staff login screen and the lock screen** — surfaces
  reached before anyone has a role-bearing session. Requiring a permission here
  means staff cannot see the memo the feature exists to show them.
- "The target terminal is read-only and may acknowledge receipt" — an ack is a
  receipt confirmation, not an administrative act. `MEMO_WRITE` would be wrong.

Both correctly do `resolve_session` (authenticated) and nothing more, while
`create`/`publish` both require `MEMO_WRITE`. So the honest remedy is an
`ipc-parity-allowlist.json` `scoped_orphans` entry **with that reasoning**, not
a new check. The gate says as much in its own message; the risk is that the
path of least resistance looks like adding a permission.

Also note the gate now counts **10** "GATED DEAD SURFACE" entries, up from 8 —
`create_memo_scoped` and `publish_memo_scoped` joined. Those two are genuinely
transient (no UI yet); the other 8 predate this workstream.

⚠️ **`list_active_memos_scoped` and `acknowledge_memo_scoped` cannot be
allowlisted on tablet — they have to be registered there.** Checked at
`c9772415`: `apps/tablet-client/src/commands/` has **no `memo.rs` at all**
(every "memo" hit in that crate is the substring "mem**ory**"), so the tablet
currently has zero Memo surface. The tempting move is to add four `tablet`
allowlist entries and call the gate green — the file has 153 of them already,
which is exactly how a tablet gap becomes permanent. But the spec puts Memos on
tablet surfaces by name:

- "on **KDS** the interval doubles to 30 minutes" — KDS is served by
  `apps/tablet-client/src/commands/kds.rs`. Verified the UI actually reaches
  it on tablet: the tablet has its own entry `ui/src/main.tablet.tsx` (built by
  `npm run build:tablet` → `ui/dist-tablet`, a *separate* bundle from desktop's
  `ui/dist`, so "shared source" alone would not prove it) and that entry calls
  `registerAllFeatures()` at line 23 — no KDS exclusion. A KDS cadence that no
  tablet command can serve is unimplementable.
- The staff **login screen and lock screen** are named display surfaces, and
  the tablet has its own `commands/auth.rs` session path.

So: register `list_active_memos_scoped` + `acknowledge_memo_scoped` on tablet.
`create_memo_scoped` / `publish_memo_scoped` are authoring and *may* follow the
`legal_entities` precedent (desktop-only, allowlisted with a reason) — but that
is a product decision about whether a manager can author a Memo from the floor,
not a parity chore, and it should be written down as a choice rather than
inherited from whatever was convenient.

And the part that bit Legal Entities: the **dev-mock needs a handler for each
tablet command too**, or `invoke()` returns `null` in the browser and the KDS
screen renders its failure path with nothing in the CI logs to say why.

### Step (4) status: cadence + surfaces — what the spec pins, measured at `322c8cd5`

Step (4) is in flight (`MemoBanner.tsx`, `useMemos.ts`, `MemoBanner.test.tsx`,
the `memo-banner-*` FTL keys). Checked against the cadence rules above so the
remaining requirements are visible rather than assumed:

- ✅ **Backend cadence is exactly right.** `memo.rs:286-298` defines
  `NOTIFICATION_BASE_INTERVAL_SECS = 15 * 60`, `KDS_INTERVAL_MULTIPLIER = 2`,
  and *derives* `kds_notification_interval_secs()` from them — the spec's "code
  the multiplier, not the literal 30", implemented as written.
- ✅ **FTL keys are clean.** All five `memo-banner-*` keys have real Indonesian
  values (`Pemberitahuan Lokasi` / `Pemberitahuan Organisasi`, not
  byte-identical, so lint category 1 is satisfied), each is referenced by the
  component *and* a test, and `lint-i18n.sh` passes live. "Location notice" is
  not a substring of "Organization notice", so the unanchored-regex hazard
  flagged for Legal Entity labels does not bite here.
- ✅ **The new tests use exact accessible names, not loose regex** —
  `getByRole('button', { name: 'Acknowledge this memo' })`,
  `getByText('Location notice')`. That is precisely the fix the `/charge/i` bug
  needed in `PosScreen.integration.test.tsx` (see `563b23ac`), applied from the
  start rather than after three tests went vacuous.
- ⚠️ **KDS doubling has no client-side counterpart yet.** `useMemos.ts:17` is a
  single `MEMO_POLL_INTERVAL_MS = 900_000`, and there is no `kds`, multiplier or
  1800s path anywhere in `ui/src/features/memo/`. The banner therefore polls
  every 15 minutes on KDS too — the specific interruption the spec's rationale
  says kitchen traffic cannot afford. If it is planned for the mount step,
  fine; recorded because nothing enforces it.
- ⚠️ **`900_000` duplicates the literal the backend just declared a single
  source of truth.** The backend comment says the base exists "so the 'KDS
  doubles it' intent is expressed as a multiplier, not a duplicated literal" —
  and the UI duplicates it anyway. No TS↔Rust constant parity gate exists (the
  parity scripts cover IPC commands, topology and bundles, not consts), so a
  base change drifts silently. Deriving the UI value from a shared constant or
  from the server response is the fix; "mirrors X" in a comment is what is
  there now, and comments are not enforced.
- ❌ **This bullet was overtaken by a real defect while it was being written.**
  I noted `MemoBanner` was mounted nowhere; it is now being mounted in
  `AppLayout.tsx` and `TabletAppLayout.tsx` — and **neither of those renders on
  any of the three surfaces the spec names.** `AppShell.tsx` early-returns
  before `AppLayout` for every one of them:

  | `AppShell.tsx` | branch | reaches `AppLayout`? |
  |---|---|---|
  | `:367` | `return <SessionLockScreen/>` — **lock screen** | ✗ |
  | `:405` | `<StaffLoginScreen/>` — **staff login** | ✗ |
  | `:530` | `activeWorkspace === 'kds'` → `<KdsScreen/>` only | ✗ |
  | `:544` | other `pageRegistration.fullscreen` pages | ✗ |
  | `:560` | normal authenticated workspace | ✓ |

  Tablet is the same shape: `TabletAppShell.tsx:127` (login) and `:175` (KDS)
  both return before `TabletAppLayout` at `:192`.

  And `MemoBannerMount.test.tsx`, added in the same commit, **cannot catch
  this**: it renders `TabletAppLayout` *directly* (`:52`, `route="sales"`),
  bypassing `TabletAppShell` entirely. So it proves the banner appears when the
  layout is mounted by hand — true, and irrelevant to whether a real session
  ever reaches that layout. A mount test has to render the **shell** and drive
  it into each surface; otherwise it certifies the wiring of a component that
  ships invisible. This is the same vacuity shape as the `/charge/i` tests in
  `563b23ac`: green, technically correct, testing the wrong contract.

  So the chosen mount covers the ordinary POS/admin/inventory views — which the
  spec does **not** list as memo surfaces — and misses all three it does. The
  banner will be invisible on the login screen, the lock screen, and KDS.

  **Now proven empirically, not just structurally.** A throwaway probe rendered
  the real `TabletAppShell` with `activeWorkspace: 'kds'` and spied on
  `listActiveMemosScoped`, against a positive control that rendered
  `TabletAppLayout` directly (exactly what `MemoBannerMount.test.tsx` does).
  Same component, same mock, same token — the only variable is the route:

  | render path | `memoApiCalls` |
  |---|---|
  | `TabletAppLayout` mounted directly (the control) | **1** — spy works |
  | Real `TabletAppShell`, `activeWorkspace: 'kds'` | **0**, banner absent |

  Worth recording how the first two attempts were wrong, because the failure
  mode is easy to repeat: the initial probe reported `memoApiCalls=0` for KDS
  and looked like confirmation, but its *control* also read 0 — the number was
  meaningless. Cause: `useMemos` bails at `if (!token)` (`useMemos.ts:62`)
  before touching the API, and `mockWorkspaceValue` in
  `TabletAppShell.test.tsx:124` does not set `sessionToken`, so it defaulted
  null. Only after passing a token did the control go to 1 and the KDS reading
  become real. A negative result with a non-firing control is not evidence.
  Probe was reverted (`git checkout --`), nothing committed.
- ⚠️ **Which makes the KDS cadence question moot rather than merely missing.**
  The doubled interval could not be expressed today even if the banner did
  render: `MemoBanner()` takes no props (`MemoBanner.tsx:21`) and `useMemos()`
  takes no options (`useMemos.ts:44`), so there is no seam to tell a surface
  apart. But the mount is the blocking issue — fix that first, then the
  multiplier. Note the spec's own rationale ("kitchen traffic cannot afford a
  15-minute interruption") presumes the banner is *on* KDS at all.

### The staff-login surface is architecturally unreachable, not merely unmounted

Found while the Memo agent was idle at `f5d6482f`, checking whether round 17's
mount finding explains all three surfaces. **It does not** — two of the three
are fixed by mounting elsewhere, but the login screen cannot use the command
that exists, and that needs a different kind of decision.

`list_active_memos_scoped` (`commands/memo.rs:166-178`) does two things that
both require an authenticated session:

```rust
let session = state.resolve_session(&session_token)?;
... store.list_active_for_terminal(DEFAULT_TENANT_ID, &session.terminal_id, &now)
```

The terminal identity comes **out of the session**, so there is no way to ask
"what is active for this device" before anyone has logged in.

Checked whether the data even exists pre-auth, because that decides how hard the
fix is — **it does exist**:

- `WorkspaceContext.tsx:149-152` resolves `terminalId` once on mount from
  `getDeviceId()` (ADR #22), with no auth dependency; and
- `AppShell.tsx:81` already holds `terminalId` in scope for every branch,
  including the `StaffLoginScreen` one at `:405`.

So the only missing piece is a command that accepts a terminal id without a
session. The repo already has that exact shape: `get_brand_settings(state)` at
`commands/branding.rs:62` takes no `session_token` and calls no
`resolve_session`, because branding must render before login too.

| surface | session available? | what it needs |
|---|---|---|
| Lock screen | ✓ — `AppShell.tsx:366` reads `if (isLocked && session)` | a mount outside `AppLayout`, nothing more |
| KDS notification | ✓ | a mount outside `AppLayout`, nothing more |
| **Staff login** | ✗ by definition | **a new session-free, terminal-keyed read** |

⚠️ **That command should not be added casually.** Branding is public by
construction — a logo and a store name. A Memo is an internal operational
instruction. A session-free read keyed on `terminal_id` means any caller who can
reach the IPC surface (or the cloud HTTP surface once Memos sync) and knows or
guesses a terminal id can enumerate that tenant's active Memos. The existing
command also hardcodes `DEFAULT_TENANT_ID`, so tenancy is not a constraint there
yet either. Options for the owner to weigh explicitly: expose only a scoped
subset pre-auth (titles only, or Organization Memos only); require a device
handshake that is not a full session; or amend the spec so the login surface
means "once the staff PIN pad is up" rather than "before any authentication".

The third option is legitimate and may be what was already intended — but it
should be written down as a decision rather than discovered by the next agent
mid-implementation, which is how the Legal Entity IPC slice lost two days.

**Ruled 2026-09-07: option 3.** The spec's "staff login screen" is amended to
mean *once the staff PIN pad is up* — after authentication, where the existing
session-scoped `list_active_memos_scoped` already works. No session-free,
terminal-keyed read will be added; the enumeration risk is declined by
construction rather than mitigated. Remaining display work is the lock-screen
and KDS mounts ("a mount outside `AppLayout`, nothing more"), both unblocked.

## The tablet's Memo surface is structurally empty — KDS Memos have no data path

Verified end to end at `f5d6482f` while reviewing the in-flight expiry-sweep
daemon. Three links, each checked rather than assumed:

1. **The tablet opens its own SQLite file** — `resolve_db_path(app)` →
   `Connection::open(&db_path)` (`tablet-client/src/state.rs:104-111`), separate
   from desktop's `StoreDatabaseManager::new(db_dir, …)`
   (`desktop-client/src/state.rs:303`).
2. **Memos can only be authored on desktop.** `apps/tablet-client/src/commands/
   memo.rs` has exactly two commands — `list_active_memos_scoped:99` and
   `acknowledge_memo_scoped:116`. Desktop has four, adding
   `create_memo_scoped:120` and `publish_memo_scoped:149`.
3. **Memos are not in the sync path.** `sync_pull.rs` references only `products`,
   `tax_rates` and `users`; `memos`/`memo_recipients` appear nowhere in the sync
   or cloud-API code. The 21 "memo" hits under `crates/oz-api/src` are all
   `in-memory` / `open_in_memory` substrings.

So the tablet's `memos` table is **always empty**, and therefore:

- `list_active_memos_scoped` on tablet can only ever return `[]`, and
  `acknowledge_memo_scoped` can only ever fail to find a recipient;
- **the KDS banner cannot display a Memo no matter where it is mounted.** This
  is upstream of the round-17 mount defect, not the same defect — fixing the
  mount moves an empty box;
- the `tablet memo expiry sweep` daemon now in flight will sweep an empty table
  every five minutes, forever. Harmless, but it advertises a capability the
  deployment does not have.

**This reflects on my own round-11 advice and should be said plainly.** I told
the next agent to *register* the read pair on tablet rather than allowlist it,
because the spec puts Memos on KDS. That was right about intent and it correctly
avoided the Legal Entities failure — but registering commands is not the same as
giving them data. The allowlist would have kept the gap visible; the registration
made it invisible. Treat "registered on tablet" as wiring, not capability.

**What actually unblocks KDS Memos**, in ascending cost: declare Phase 2's KDS
cadence requirement a Phase 3 item and say so in the spec (cheapest, and possibly
the honest reading); or route the KDS read through shared cloud-server Postgres
instead of the local file; or sync `memos` + `memo_recipients` to the tablet,
which drags in the tenant-isolation work — `memo_recipients.tenant_id` exists
now, but `terminals.tenant_id` still does not, so the fan-out cannot be scoped
per tenant yet.

> **Update 2026-09-07:** the tenant-isolation half of option three is DONE:
> `terminals.tenant_id` landed as `56653839` (with a backfill to the `default`
> sentinel), and the fan-out was narrowed to per-tenant as `7ed4412b` — both
> branches of `publish_memo`'s recipient fan-out now filter on the memo's
> tenant, with cross-tenant exclusion tests. What remains open is unchanged and
> is the actual blocker: the tablet's `memos` table is still structurally empty
> (memos are not in `sync_pull`, authoring is desktop-only), so the KDS banner
> has a mount and a cadence but no data until one of the three options above is
> chosen. That choice is an owner decision; see the implementation journal.
>
> **Ruled 2026-09-07: option two — cloud read.** The KDS/tablet Memo read
> routes through the shared cloud-server Postgres instead of the
> structurally-empty local file. Scope this choice buys: memos must reach the
> cloud database (authoring stays desktop-local, so a desktop → cloud write
> path for `memos`/`memo_recipients` is part of the slice), the read endpoint
> must be tenant-scoped (`terminals.tenant_id` landed `56653839` and the
> `7ed4412b` fan-out filter carries over), and the read path needs the same
> isolation care the sync option would have — just on the cloud side.

### Cloud-read design (2026-09-07) — REST serving layer, not queue replication

Grounded in how the cloud actually works today, verified before writing:
the sync queue (`POST /api/sync/push|pull` + `SyncQueue::apply_remote` in
`platform/sync/src/queue.rs`) replicates pushed items into each receiving
terminal's **local** database — that is precisely the rejected *sync* option.
The REST surface (`crates/oz-api/src/routes/*` + `pg.rs`) is what writes and
serves from cloud Postgres directly, with RLS (`set_config('oz.tenant_id')`)
and JWT claims (`tenant_id`, `terminal_id` from terminal client-credentials,
`crates/oz-api/src/auth.rs:58`). So the cloud read is built as REST:

**Write half — desktop → cloud, full-state reconciliation.** A new
`POST /api/v1/memos/sync` accepts the tenant's **complete memo state** from
the desktop (every non-deleted memo row + its `memo_locations` +
`memo_recipients`, including `archived_at` on archived rows) and reconciles
PG with it in one transaction: upsert rows `ON CONFLICT (id)`, insert missing
targeting/recipients, and DELETE any PG memo of that tenant absent from the
snapshot (self-healing — a dropped desktop row, including a retention
delete, propagates by omission; no tombstones, no sync markers, no schema).
Desktop pushes best-effort at write time (publish/stop/revise) and
re-pushes the full state on the existing 5-minute memo daemon tick, so a
failed or offline push self-corrects within one cycle; memos are few
(live for days), so the snapshot is bounded. Auth: the same JWT the sync
stack already mints; the server stamps `tenant_id` from claims, never the
body (the push_handler pattern).

**Read half — `GET /api/v1/memos/active?terminal_id=`.** Serves the exact
`MemoDisplayDto` envelope the banner already consumes (`memos` +
server-issued `cadence` from `oz_core::memo` constants — one source of
truth, no drift), reading PG `memos` joined `memo_recipients` where
`status='published' AND expires_at > now`, tenant = claims, ordered
Location-above-Organization (the `7ed4412b`/`list_active_for_terminal`
semantics, ported to PG with RLS). `terminal_id` comes from the query and
must equal `claims.terminal_id` when the token is terminal-scoped (defense
in depth, matching `require_admin_write`'s pattern of scoping device
credentials).

**Tablet integration.** `list_active_memos_scoped` (tablet command) gains a
cloud path: when sync is configured (the existing `SyncConfig`), it fetches
the cloud endpoint and maps the response 1:1; when unconfigured or
unreachable it falls back to the local read (structurally empty — the
banner is silent, exactly today's behaviour, with a `tracing::warn`).
No new UI surface, no parity-gate change (the command name and DTO are
unchanged; the switch is inside the command).

**Work breakdown, in order:** (1) `crates/oz-api/src/pg.rs`:
`sync_memos` (the reconciling upsert) + `list_active_memos_for_terminal`,
both RLS-scoped, with tests; (2) `crates/oz-api/src/routes/memos.rs`: the
two endpoints + auth guards + route registration + tests; (3) desktop:
push-at-write + daemon reconciliation in the memo sweep (requires the
desktop's sync config/token plumbing — reuse, do not invent, the pg sync
daemon's credentials path); (4) tablet: the cloud-first read with local
fallback; (5) cloud retention mirror: the push handler deletes PG archives
past `RETENTION_WINDOW_DAYS` for the tenant (piggyback maintenance — no new
daemon). Each numbered step is one commit.

- **Progress (2026-09-06, round 6):** step (2)'s schema-independent half LANDED
  as `cf69ec3c` — `oz-core::memo` (MemoScope, MemoStatus + DeliveryStatus state
  machines, MemoDuration + expiry, `may_stop` rule, cadence constants; 16
  tests). It needs no migration, so it shipped ahead of the window. Remaining:
  step (1) migration + store (persists these validated states), then (3)-(5).

## `revise_memo` discards its UPDATE's affected-row count — a TOCTOU the new sweep daemon just made reachable

> **✅ RESOLVED 2026-09-06 — committed as `e7b47b83`** (`fix(core): guard
> revise_memo against the expiry-sweep TOCTOU`). The fix is the suggested one:
> `revise_memo` now captures the UPDATE's affected-row count and, on 0 rows
> (sweep raced it to `expired` mid-transaction), errors out before the revision
> INSERT, so the transaction rolls back and `memo_revisions` can never hold a
> revision the memo never had. Everything below is the original finding, kept
> for the reasoning.

Reviewed `e560138e` (Memo revise) on commit. The design is otherwise careful:
tenant-scoped read, non-blank validation, `Published`-only gate, prior revision
rows never mutated, and `published_at`/`expires_at` deliberately left alone so a
correction cannot extend a memo's life. It uses a transaction, as required.

But the guard it wrote into the UPDATE is never read:

```rust
tx.execute(
    "UPDATE memos SET title=?2, body=?3, revision=?4, updated_at=?5
     WHERE tenant_id = ?1 AND id = ?6 AND status = 'published'",
    params![...],
)?;                                    // <- rows-affected discarded
tx.execute("INSERT INTO memo_revisions (...) VALUES (...)", ...)?;
```

**Its own file does this correctly three functions earlier.** `mark_delivered`
(`memos.rs:353-362`) runs the same shape — conditional UPDATE with a status guard
— captures `let changed = …`, and handles `if changed == 0`. So this is a
deviation from local convention, not a matter of taste.

The interleaving that matters:

1. `get_memo` reads the memo: `status = published`, `revision = 1`
2. the expiry sweep transitions it to `expired`
3. the UPDATE's `status = 'published'` predicate matches **0 rows** — silently
4. the INSERT still writes a `revision = 2` row, and the transaction commits
5. the final `get_memo` returns `revision = 1`, `status = expired`

`memo_revisions` now holds a revision the memo never had. That is precisely the
audit-integrity property the feature is named for, broken by the one step that
checks nothing.

**Why this is new rather than pre-existing:** step 2 needs a concurrent writer
that moves `published → expired`, and until `5ee1064a` (the commit immediately
before) the only such writer was a user-facing action. `5ee1064a` added a daemon
that does it on a timer every five minutes. The two commits are individually
fine; it is their combination that opens the window.

**Not empirically proven, and it would be dishonest to imply it was.** The race
cannot be made deterministic from outside: the read happens before
`unchecked_transaction()`, and the test `Store` shares one mutex-guarded
connection, so nothing can interleave between them. A test that hand-ran the two
statements would only demonstrate the author's own SQL, not this code path. The
claim rests on reading the affected-row count away, which is a static fact, plus
the file's own convention at `:360`.

Suggested fix, matching `mark_delivered`: capture the count and, if 0, roll back
the revision insert by returning an error before `tx.commit()` — the transaction
makes that free, since nothing has been written yet.

### Separate, smaller point: `revise_memo` has no path to a user, and no plan step owns one

`git grep revise_memo` returns the definition (`memos.rs:206`) and five call
sites, **all in `memos_tests.rs`**. No command in either shell, no UI reference.
For contrast, `publish_memo` shows up in `apps/desktop-client/src/commands/
memo.rs` *and* `lib.rs` — the shape a wired feature has.

That is not sloppiness: the commit is honestly scoped as `feat(core)`, and a
core-first slice is a reasonable way to build. The gap is that **the Phase 2 plan
has no step that would ever wire it.** Step 3's chain is `memo:write` constant →
schema + 8-state machine → owner/admin IPC → deferred manager scoping → display
surfaces. Revise is not named in it, and the word does not appear in any of the
three todo files as a task. Meanwhile the spec states the requirement directly,
at the top of this file: "published content is immutable; corrections create a
new revision" (`todo-global-saas-2.md:28`).

So a spec'd behaviour now has a tested core implementation and no owner for the
last mile — which is the mirror image of round 21's finding, where the tablet had
wiring with no data. Both directions of the same failure: **capability and
wiring get tracked as if they were one thing.** Worth one checkbox naming the
IPC + UI slice, or an explicit note that corrections are out of scope for Phase
2, so the next agent does not have to rediscover which it is.

**Ruled 2026-09-07: corrections are in scope.** The plan step now exists —
see the `revise_memo_scoped` checkbox in the P1 list above (IPC gated
`memo:write`, published-only; the TOCTOU guard is already in the store).

## Assist-pass notes (2026-09-06, DSH) — applies to Memo steps (3) and (4)

**Static-gate baseline: all 24 CI gates pass at HEAD.** Ran the whole
`dev-ci.yml#static-gates` set locally (architecture-boundaries, money-format,
windows-config, unwrap-panic, release-workflow +selftest, pg-schema-drift,
migration-column-types, test-shadow-copies, ipc-parity, invoke-parity,
scoped-reads +selftest, topology-parity, feature-registry,
plugin-guide-parity, ci-docs-drift, ftl-orphans-selftest, bundle-parity-full,
lint-i18n, no-raw-params, scoped-coverage, eol-guard-selftest,
typecheck-gate-selftest) — **24 pass / 0 fail**. Worth stating because nothing
else does: `dev-ci.yml` has no `push` trigger and the pre-commit hook is
opt-in, so on this branch these gates are otherwise unrun until a PR. Re-run
them before declaring a slice verified. UI baseline alongside it: 495 files /
**8798 passed / 5 skipped**, typecheck and eslint clean.

**Hazard for step (4) display surfaces — an unanchored dialog regex makes a
green test that proves nothing.** Found and fixed in `b907b985`. PosScreen has
two controls whose names are substrings of each other ("Save as open bill" vs
"View open bills") opening two modals likewise nested as strings ("Open bill"
vs "Open bills list"). A test clicking `/open bills/i` and asserting
`getByRole('dialog', { name: /open bill/i })` passes against the LIST modal
while believing it opened the INPUT one — and it dragged two correct tests
into `it.skip` that then looked unfixable. Six tests were recovered; four
needed nothing at all, one skip comment blaming "FTL variable interpolation
complexity" was simply false.

Memo will hit exactly this: Organization Memo vs Location Memo are two scopes
with near-identical labels, and the surfaces stack (Location above
Organization). **Anchor the accessible names (`/^open bill$/` style) wherever
one label is a substring of another**, and when a test in a new area fails,
check which control the test actually clicked before assuming the assertion is
wrong.

**Method that made this safe on a shared tree:** establish the skip/no-skip
split by running the file with every `it.skip` flipped, then `git checkout --`
the same file inside the *same* bash invocation, so the working tree was never
left modified while other agents were committing. Every commit this pass used
an explicit pathspec; `b907b985` landed clean alongside an in-flight Memo
migration touching `migrations.rs`/`init.pg.sql`.

### Tenant-isolation gap in the committed Memo schema (`7fed26cc`)

Aimed at the memo store being written right now (`db/mod.rs` + `memo.rs` are
the in-flight files). **Not a blocker claim — a decision to make explicitly
before the store's queries are fixed in shape.**

`memo_revisions` and `memo_recipients` carry **no `tenant_id` column**. The
consequence is not just "RLS cannot cover them" — it is that **they cannot be
tenant-filtered in either backend.** SQLite here is a single shared database
filtered by predicate (`db/offline.rs:275,309,361` — `WHERE … AND tenant_id =
?1`), so a missing column removes the filter there too, not only on Postgres.
Isolation for these two tables rests entirely on every future caller routing
through `memos`.

The sharper problem is that **nothing will ever surface this as debt.** The
generator's to-do block is built from tables that *have* `tenant_id` but are
not covered — `init.pg.sql` currently lists exactly: `image_refs`,
`legal_entities`, `memos`, `sale_lines`, `snapshot_versions`,
`webhook_endpoints`. `memos` is tracked; the two child tables are invisible to
the only mechanism that watches this, because they lack the column the
mechanism keys on.

This deviates from an unambiguous convention in this repo. Child tables get
`tenant_id` denormalized onto them precisely so they can be covered:
`20260814_sale_lines_tenant.sql`, `20260814_tenant_uniqueness.sql`
(`bundle_items`, `product_bundles`, `product_taxes`, `product_variants`),
`20260827_refunds_tenant.sql`, `20260831_per_tenant_unique_rebuild.sql`
(`product_activity`). Three of those are child tables that **are** in
`RLS_TABLES` today — so the pattern is proven in practice, not theoretical.

Why it will actually bite: the migration ships
`idx_memo_recipients_terminal ON memo_recipients(terminal_id,
delivery_status)`, which exists to answer "what is pending at this terminal" —
a query that never touches `memos`. That index is the tell that a direct read
is planned. Phase 1's P0 list also requires isolation tests to cover **Memos**
by name.

Two ways to close it; pick one deliberately:

1. **Follow the convention.** Add `tenant_id TEXT NOT NULL` to both child
   tables, populate it on insert, then add all three Memo tables to
   `RLS_TABLES` in `scripts/generate-pg-migration.py` once the write path sets
   it. Regenerate `init.pg.sql` — pre-commit step 7 and CI both police drift.
2. **Keep the schema and make the dependency explicit.** Forbid direct reads
   on the child tables (every query joins `memos` for its tenant predicate)
   and pin that with the Phase 1 isolation test, so a later caller cannot
   regress it silently.

Option 1 matches how every other child table here was handled. Option 2 is
defensible only if the isolation test genuinely lands — without it the gap is
both real and untracked, which is the combination worth avoiding. Raised for
the owner to decide, deliberately not edited: the migration is committed and
the store is mid-write by another agent.

**Concrete instance — now COMMITTED in `ebddda1f`, not merely in-flight.**
`crates/oz-core/src/db/memos.rs`, Organization-Memo fan-out:

```rust
// Organization Memo: every registered terminal.
None => { let mut s = tx.prepare("SELECT id FROM terminals ORDER BY id")?; … }
```

`terminals` has **no `tenant_id` column** — verified absent from the
`CREATE TABLE terminals` block in *both* `20260813_init.sql` and
`20260813_init.pg.sql`, and `20260907_add_location_tenant_id.sql` adds the
column to `locations` and `user_location_access` only. So terminal tenancy is
transitive: `terminals.bound_location_id → locations.tenant_id`.

That query applies no such filter, so publishing an Organization Memo inserts
a `memo_recipients` row for **every terminal in the shared database, across all
tenants**. The store is otherwise careful — `publish_memo` validates via
`get_memo(tenant_id, …)` and `WHERE tenant_id = ?1 AND id = ?4 AND status =
'draft'` — which makes this one branch a genuine oversight rather than a
convention. Consequences: cross-tenant rows in a tenant's memo, a plausible
path for one company's staff memo to surface on another company's terminal,
and unbounded row growth on every publish. The Location-Memo branch directly
above it *is* scoped (`WHERE bound_location_id = ?1`, and that location is
tenant-validated), so only the `None` arm needs the join.

Suggested shape, matching how tenancy already works for this table:

```sql
SELECT t.id FROM terminals t
  JOIN locations l ON t.bound_location_id = l.id
 WHERE l.tenant_id = ?1
 ORDER BY t.id
```

Note this also silently excludes unbound terminals (`bound_location_id IS
NULL`), which is arguably correct — an unbound terminal belongs to no location,
so it has no provable tenant. Worth stating explicitly in the Memo spec,
because "every registered terminal" currently reads as including them.

**Severity, stated honestly:** latent, not live. Every write path still pins
the staged sentinel — `DEFAULT_TENANT_ID: &str = "default"` in
`legal_entities.rs:17`, and the Phase 1 journal records the sentinel being kept
"until tenant claims are available in the session context" — so today exactly
one tenant exists and the fan-out cannot cross a boundary that isn't there.
The defect is that it becomes cross-tenant data **the moment tenant claims
land**, with no test and no schema constraint to catch it, and by then
`memo_recipients` rows are already persisted. Fixing the query now costs one
JOIN; fixing it later means a backfill plus an isolation incident. Treat it as
cheap-now/expensive-later, not as a shipping blocker.

**The scoping gap predates Memos; Memos is what makes it persist data.**
`db/terminals.rs:22` already runs an unfiltered `FROM terminals ORDER BY name`,
and every other terminal query in that file keys off `id`/`device_id` with no
tenant predicate either. That has been tolerable because terminals were only
ever *read* within a single-tenant install. Writing per-terminal rows into a
tenant-owned table is new: it converts a latent read-side scoping gap into
persisted cross-tenant rows. Phase 1's isolation list names Memos
specifically, so the test that closes this belongs to that P0 item rather than
to the Memo feature alone.

**The specific test that is missing (checked against `memos_tests.rs` as
written now).** The file already has `get_is_tenant_scoped` (cross-tenant read
rejection), `location_memo_fans_out_only_bound_terminals`, and
`publish_fans_out_one_pending_recipient_per_terminal`. What none of them do is
put a **second tenant's** terminal in the database and assert the
Organization-Memo fan-out skips it. `publish_fans_out_one_pending_recipient_per_terminal`
is the one that matters: with a single tenant seeded it passes either way, so
today it would still pass *after* the bug is fixed — it does not pin the
behavior.

The existing helpers make it a ~10-line addition; `seed_terminal` already takes
`bound_location`, and `seed_location` already writes `tenant_id`:

```rust
#[test]
fn org_memo_fanout_excludes_other_tenants_terminals() {
    let store = store();
    // two tenants, one location each, one terminal each
    seed_location_with_tenant(&store, "loc-a", "tenant-a");
    seed_location_with_tenant(&store, "loc-b", "tenant-b");
    seed_terminal(&store, "term-a", Some("loc-a"));
    seed_terminal(&store, "term-b", Some("loc-b"));

    let memo = store.create_memo_draft(&new_memo("tenant-a", None)).unwrap();
    store.publish_memo("tenant-a", &memo.id).unwrap();

    // tenant-b's terminal must NOT receive tenant-a's organization memo
    assert_eq!(recipient_count(&store, &memo.id), 1);
}
```

`seed_location` currently hardcodes `'default'` (`memos_tests.rs:29`), so it
needs a tenant parameter or a sibling — hence the `seed_location_tenant` name
above. Without that the test cannot be written at all, **which is itself the
tell: the fixture cannot express a second tenant, so no fan-out test ever could
have caught this.** Worth checking the same limitation in the Legal Entity and
Location store fixtures.

**One thing the existing tests settle, and it changes the fix.**
`publish_fans_out_one_pending_recipient_per_terminal` seeds both terminals with
`bound_location = None` and asserts 2 recipients — so **unbound terminals do
receive Organization Memos today**, which answers the open question raised
above in the "yes" direction. That means the suggested JOIN is not safe as
written: `JOIN locations ON t.bound_location_id = l.id` silently drops every
unbound terminal and turns that test red. Either:

1. keep unbound terminals in scope and give `terminals` a real `tenant_id`
   (the convention every other child table here followed), or
2. accept that unbound terminals stop receiving org memos, and change that
   test deliberately with the reason recorded.

Option 1 is the only one that is both tenant-safe and behavior-preserving.
Option 2 quietly changes what "every registered terminal" means in the spec.

### Reconciliation — `5f263d11` fixed the schema half and rebutted the rest

**The substantive part was accepted and is verified fixed.**
`20260910_memo_child_tenant_id.sql` denormalizes `tenant_id` onto both child
tables, backfills from the owning memo, adds tenant-scoped indexes, and the
store populates it on both inserts. Confirmed against the regenerated PG init:
`memo_recipients` and `memo_revisions` now appear in the generator's
not-yet-covered list (it went 4 → 6 → **8**), so the *invisibility* problem —
the part that would have let this rot unnoticed — is genuinely closed. Choosing
a follow-up migration over editing `7fed26cc` is also right: the runner
enforces DB-02 checksum-fails-closed on applied migrations.

**The rebuttal is real but over-reads its citation.** `edc_terminals.rs:4` does
say "multi-tenancy that does not exist", quoted accurately — but in context it
argues something narrower: *do not write `'default'` explicitly on inserts,
because that would imply callers thread a tenant when none does yet.* That is a
comment-honesty rule about the write path, not an architectural ruling that
`terminals` should never be tenant-scoped. Phase 1's premise is making the
platform safe to call multi-tenant, and `legal_entities.rs:6` explicitly
anticipates "future tenant claims … supply the resolved tenant".

**Their fix also weakens my own original claim, and that should be said
plainly.** I wrote that one company's staff memo could surface on another
company's terminal. With `memo_recipients.tenant_id` now NOT NULL and populated
from the memo, a correctly-written read (`WHERE terminal_id = ? AND tenant_id =
?`) filters foreign rows out. What survives is narrower: **(a)** unbounded row
growth — every publish still writes one recipient row per terminal in the whole
database — and **(b)** those rows assert a tenant claim about a terminal the
tenant does not own, which is false data even while nothing reads it wrongly.
Neither is a shipping blocker on a single-tenant desktop.

**Still genuinely unresolved: the question cannot be tested.** `seed_location`
hardcodes `'default'` (`memos_tests.rs:29`), so no fixture can place a location
— and therefore a bound terminal — in a second tenant. The new
`publish_populates_child_table_tenant_id` asserts `"default"` for both children,
which confirms plumbing, not isolation. So the fan-out dispute cannot be settled
by a test in either direction today. Prerequisite for closure: a tenant
parameter on `seed_location`. The assertion after that is one line.

**Net:** the durable finding (untracked, unfilterable child tables) is fixed.
The behavioral finding is deferred with a defensible rationale that cites
slightly more than its source says.

## `memos.location_id ON DELETE CASCADE` inverts the schema's own convention

> ### ✅ RESOLVED — committed as `f5d6482f`
>
> The Memo agent picked **option 2 (RESTRICT)** — the one this note called "the
> only option that cannot lose data by accident" — and the migration header
> cites both **CUST-11** and the nine-FK enumeration from the round-14
> correction, so the precedent did the work rather than the preference.
> Verified against the working tree rather than taken on faith:
>
> - **Both** instances fixed, not just the headline one: `memos.location_id`
>   *and* `memo_recipients.terminal_id` → `ON DELETE RESTRICT`.
> - **Correctly left alone:** `memo_revisions.memo_id` and
>   `memo_recipients.memo_id` stay `ON DELETE CASCADE` — true child tables that
>   must go with their memo. That distinction was not spelled out in this note;
>   getting it right is what stops the fix from breaking publish.
> - Reached the generated PG schema: `20260813_init.pg.sql:753` and `:1065` now
>   read `ON DELETE RESTRICT`. `generate-pg-migration.py --check` green (109
>   tables, 134 indexes); `verify-migration-column-types.py` green.
> - Registered in `migrations.rs` via `include_str!`, using the
>   `20260831_per_tenant_unique_rebuild` table-rebuild pattern, since SQLite
>   cannot alter a column's FK in place.
> - Checked the remaining `terminal_id … ON DELETE CASCADE` edges for the same
>   class of problem and they are **not** it: `terminal_feature_overrides`,
>   `terminal_profiles` (1:1 PK extension) and a topology node config — all
>   configuration owned by the terminal and meaningless without it. The
>   records-vs-config line the migration draws is the right one, and there is no
>   wider pattern to chase here.
>
> **The test suite is better than what this note asked for.** Four tests cover
> all four directions, so the fix cannot be wrong in either the too-weak or the
> too-strong way:
>
> - `location_delete_is_blocked_by_its_memos` / `terminal_delete_is_blocked_by_its_recipients`
>   — the guard fires.
> - `parent_delete_still_works_without_memo_dependents` — the guard does **not**
>   over-block. A fix that rejected every Location delete would pass the first
>   two and break real usage; this is the test that catches that.
> - `deleting_a_memo_still_cascades_to_its_children` — the deliberately-kept
>   child CASCADE still works, so the records-vs-config decision is pinned, not
>   just asserted in a comment.
>
> Mutation-checked: rewriting the two `ON DELETE RESTRICT` clauses back to
> `CASCADE` fails **exactly those two blocking tests** (37 passed / 2 failed),
> and the file restores clean. So the tests genuinely pin the FK action rather
> than passing alongside it. `cargo test -p oz-core memo` 39/39 at `f5d6482f`.
>
> This closes the highest-severity finding of the assist passes: raised as a
> schema observation on `7fed26cc` (round 5), traced to a reachable data-loss
> path and the CUST-11 precedent (rounds 10 and 13), fixed and tested (round
> 17), now committed and mutation-verified (round 19).

Found in the round-10 assist pass while checking whether Phase 3's
multi-location Memo item is blocked by the new schema. It is not (note at the
end) — but that check surfaced something that is.

**The rule.** `20260909_memos.sql:18`:

    location_id  TEXT REFERENCES locations(id) ON DELETE CASCADE

Enumerating every FK in the schema pointing at `locations`/`store_profiles`
(the rename means both names matter): **9 total — 5 `ON DELETE SET NULL`, 3
default `NO ACTION`, exactly 1 `CASCADE`.** This one. Every other table that
can name a Location either *detaches* the record when the Location goes away or
*blocks* the deletion. `memos` is the only one that destroys it.

**Why that is a problem, not a style preference.** The delete path is live and
user-reachable:

    ui/src/api/locations.ts:71   loggedInvoke('delete_location_profile_scoped')
      → commands/locations.rs:258            (registered at lib.rs:917)
        → db/locations.rs:198                DELETE FROM locations WHERE id = ?1

`delete_location_profile` guards exactly one thing — `is_primary` — and checks
nothing about dependents. So deleting a non-primary Location silently deletes
every Location Memo scoped to it, **their `memo_revisions` rows** (which exist
precisely because "prior revisions are never mutated" and *are* the audit
trail), and **their `memo_recipients` rows** (the delivery/acknowledgement
record).

That contradicts this file's own promise: *"stopped and expired Memos remain
archived for 30 days before deletion or anonymization."* A Location delete
bypasses the window entirely, and because the erased rows are the record,
nothing testifies the Memo ever existed. No warning, no audit entry naming the
erasure.

**Same class, second instance.** `memo_recipients.terminal_id` also cascades
(`20260909_memos.sql:71`) and `db/terminals.rs:147` hard-deletes. Deleting a
terminal erases its delivery history — the evidence behind "delivery is
confirmed when the target terminal reports receipt".

**How it happened.** `delete_location_profile` predates Memos by many releases
and could not guard a table that did not exist. `CASCADE` is what a child-table
FK usually wants; here the parent has an established delete path whose semantics
were settled before Memos arrived.

### Round-14 correction and strengthening

Two things found later change the shape of the above, one in each direction.

**My reachability claim was overstated.** I wrote as though deleting a
non-primary Location always cascade-destroys Memos. It does not: three of the
nine location FKs use the default `NO ACTION`, so with FK enforcement on a
Location delete is **already blocked** whenever the Location has

- a terminal bound to it (`terminals.bound_store_id`, `20260813_init.sql:936`),
- a user access grant (`user_store_access.store_id`, `:948`), or
- a workspace instance (`workspace_instances.store_id`, `:986`).

The cascade needs those absent. It is still reachable, by a specific but
entirely ordinary sequence:

1. bind terminals to Location L and publish Location Memos, so recipients and
   revisions accumulate;
2. `clear_terminal_binding` on each — IPC-exposed at
   `commands/terminals.rs:796`, and it sets `bound_location_id = NULL`
   (`db/terminals.rs:227`) rather than deleting the terminal, so the blocking FK
   stops applying while the memo history stays behind;
3. delete Location L. Nothing blocks — creating a Location inserts no
   `user_store_access` or `workspace_instances` rows (verified: no such INSERT
   in `db/locations.rs`) — and the CASCADE erases the Memos with their audit
   trail.

Narrower than I said, but not theoretical, and every step is a normal admin
action.

**The normative case is much stronger than "inconsistent with 9 FKs".** The
repo already has a *named, tested policy* for this exact problem:
`delete_customer_scoped_is_blocked_by_loyalty_and_sales_references`
(`apps/desktop-client/src/commands/customers_tests.rs:683`, **CUST-11**) —
"a customer referenced by a loyalty account or sales rows must NOT be silently
deleted — the FK guard (`foreign_keys = ON`) rejects the delete so no orphaned
child rows can be left behind." Its mechanism is `REFERENCES customers(id)`
with no ON DELETE clause (`20260813_init.sql:302,615`), i.e. `NO ACTION`.

So this is not really a three-way judgment call. The codebase has already
answered "should a parent delete be blocked rather than silently destroy
dependents?" with *yes, and a test enforces it* — for customers. `memos` chose
the opposite.

**And the CASCADE is live, not inert.** Worth stating explicitly, because SQLite
silently disables FK enforcement by default and that alone would have made this
whole finding moot: `PRAGMA foreign_keys = ON` is set on every connection path —
`desktop-client/src/state.rs:207`, `desktop-client/src/local_api.rs:149`,
`tablet-client/src/state.rs:112`, `cloud-server/src/db.rs:132,142`. The cascade
fires.

**Options — none chosen, this is the owner's call:**

1. `SET NULL`, matching the 5 precedents. But an orphaned Location Memo loses
   its audience and would need a guard so it does not silently start displaying
   org-wide — wrong in a different way.
2. `RESTRICT` / default `NO ACTION`, matching the 3 others. Deleting a Location
   that has Memos fails with a clear error. Consistent with "the primary
   location cannot be deleted" already being a blocking guard in the same
   function.
3. Keep CASCADE and amend the spec to state that Location Memos are erased with
   their Location. Honest, but it makes the 30-day retention promise have an
   exception triggered by an ordinary admin action.

Option 2 is the only one that cannot lose data by accident.

**Timing matters.** No Location Memos exist in the wild yet — the store landed
today and the UI is being written now. Changing the FK is a fresh-migration edit
today, and a backfill-plus-recovery conversation next month.

**The Phase 3 question, answered.** Multi-location Memos
(`todo-global-saas-3.md:48-50`) are *not* blocked by this schema. Publish fans
out into `memo_recipients` rows and `list_active_for_terminal` reads from those
rows — never from `location_id` — so display, acknowledgement, expiry and the
tenant filters are already Location-agnostic. Multi-location targeting touches
exactly three things: the column (→ a `memo_locations` join table), the one
fan-out query (`WHERE bound_location_id = ?1` → `IN (...)`), and the authoring
UI. Worth recording in the Phase 3 item so it is not estimated as a rewrite.

## Memo implementation journal — mounts, cadence, authoring UI (2026-09-07)

Four slices landed this session, each verified against the gates it could break
and committed with an explicit pathspec. They complete the Memo workstream's
implementable remainder — what is left is decision-gated, listed at the end.

1. **`7ed4412b` — fan-out narrowed to the memo's tenant (`fix(core)`).** The
   Org branch of `publish_memo`'s recipient fan-out was
   `SELECT id FROM terminals ORDER BY id` — unfiltered — so an Organization
   Memo fanned out to every terminal in the database, not the tenant's.
   `56653839` (concurrent Phase 1 agent) added `terminals.tenant_id` with a
   backfill to the `default` sentinel, which unblocked the fix: both fan-out
   branches now filter `tenant_id = ?`, and unbound terminals keep working
   because the backfill assigned them the sentinel. Tests:
   `org_memo_fanout_excludes_other_tenants_terminals` and
   `org_memo_fanout_still_reaches_unbound_terminals_of_same_tenant`, on new
   `seed_location_with_tenant` / `seed_terminal_with_tenant` fixtures.
   oz-core: 2521/2521.

2. **`796f1c7a` — `MemoBanner` mounted on the spec'd surfaces (`fix(ui)`).**
   The banner was in `AppLayout`/`TabletAppLayout`, but the shells early-return
   before those layouts on every surface the spec names. Now mounted in
   `AppShell`'s lock-screen branch and all four KDS branches (kiosk,
   standalone, restaurant-pos-kds, store-pos-kds) and `TabletAppShell`'s kds
   branch. `MemoBannerMount.test.tsx` was rewritten to render the REAL shells
   and drive them into each surface, asserting the memo API is called with the
   harness session token — the previous version rendered `TabletAppLayout`
   directly and certified wiring that shipped invisible (round 17's finding,
   fixed by testing the thing the spec names). The lock screen deliberately
   gets the base interval (no `kds` prop); the KDS branches get `kds`.

3. **`10bfb9ff` — cadence served by the backend (`feat(ui,ipc)`).** Killed the
   `MEMO_POLL_INTERVAL_MS = 900_000` duplicate of the backend constant: the UI
   now polls on the server-issued cadence. `list_active_memos_scoped` (desktop
   + tablet) returns `MemoDisplayDto { memos, cadence: { baseIntervalSecs,
   kdsIntervalSecs } }`; `useMemos({ kds })` schedules its poll only after the
   cadence arrives (no client-side fallback literal to drift), `MemoBanner({
   kds })` threads the surface, and the KDS branches pass `kds` so kitchen
   displays run at the doubled interval. Dev-mock serves the envelope.

4. **`3fb745cf` — authoring screen + desktop writer IPC (`feat(ui,ipc)`).**
   - `MemosScreen` (`ui/src/features/memo/`): create-draft form (scope
     Organization-vs-location via `listLocationsScoped`, duration select
     defaulting 24h, non-blank title/body), publish on draft rows, authored
     list (title + body preview, scope chip, status badge, duration, revision,
     created). Registry-gated `manager` + `memo:write`; loading skeleton,
     error + retry, and empty states follow the AuditLog screen conventions;
     every string through `@fluent/react` (`memos-*` keys in both locales).
     Create/publish failures surface in a dedicated `role="alert"` notice —
     the list-load error state only renders when the table is empty, so a
     publish failure with rows present would otherwise be silent (the AUD-09
     rationale). Locations fetch failure is non-fatal: the scope selector
     degrades to Organization-only rather than blocking authoring.
   - `list_authored_memos_scoped` desktop command (MEMO_WRITE-gated, reads
     `list_memos_authored_by`), registered in `lib.rs`; the UI api gained
     `createMemoScoped` / `publishMemoScoped` / `listAuthoredMemosScoped`.
   - Dev-mock handlers for all three (drafts are invisible to terminals until
     published; `listMockActiveMemos` now filters to `published`), so browser
     previews exercise the same draft→publish→display path.
   - `useMemos` fetch errors now map through `plainErrorMessage` — the ERR-10
     static scan flagged the hook's raw `e instanceof Error ? e.message` as a
     user-visible leak; the hook's `error` field is diagnostic (the banner
     renders nothing when cold), and the mapper is the sanctioned non-Fluent
     path. The hook test that asserted the raw message was updated to the
     mapped copy.
   - **Product choice, written down:** authoring is desktop-only. The parity
     gate requires every UI-invoked command registered on both shells (the UI
     api is shared), so `create_memo_scoped`, `publish_memo_scoped` and
     `list_authored_memos_scoped` are allowlisted in the `tablet` array
     following the legal-entity precedent — with the reason recorded in the
     allowlist's `_comment` per the spec's own instruction (todo §"Step (3)
     status": "a product decision … written down as a choice rather than
     inherited"). They come off the list only if authoring is ever ported to
     the tablet shell. `verify-ipc-parity.py` is green after the change.

**Deliberately NOT built here, each for a recorded reason:** (all of these
were subsequently unblocked — see the ruling journal below)

- ~~**Staff-login display surface**~~ — **ruled 2026-09-07, option 3**: the
  spec's "staff login screen" now means *once the staff PIN pad is up* —
  after authentication, where the session-scoped read already works. No
  pre-auth command will be added; the lock-screen mount covers the ruled
  reading.
- ~~**Early stop (`stop_memo`)**~~ — **ruled and built**: option A2 landed
  (`a23d81bd`, see the RULING section and the journal below).
- ~~**Revise UI**~~ — **ruled in scope and built** (`9062a7c1`).
- ~~**Tablet/KDS data path**~~ — **ruled 2026-09-07: cloud read; built and
  verified.** The serving layer (`eb71d071` + the route-placement fix
  `9d125484`), the desktop push (`a009d3cf`), the tablet cloud-first read
  with local fallback (landed entangled in `2c5dde8a`, journal entry below),
  and the spec documentation (`f2dbb745`). PG integration test
  `pg_integration_memo_sync_and_active_read` pins push → read →
  delete-by-omission → code-level cross-tenant isolation (token-stamped
  inserts + tenant-filtered reads — see the Round-14 wording correction
  in the acknowledgement journal below).
- ~~**Retention sweep + stale-draft expiry**~~ — **ruled and built**:
  fixed 30-day window via `archived_at` (`c8d2a54f`); the draft-expiry rule
  was dropped per ruling.

## Memo ruling journal — stop, retention, revise (2026-09-07)

After the owner ruled on all six open questions (each ruled section in this
file carries the decision inline), three implementation slices landed:

1. **`a23d81bd` — `stop_memo_scoped` + `memo:stop` (A2, `feat(ipc,ui)`).**
   New registry key `memo:stop` granted to the Owner (`*`) and Admin presets
   only — Manager keeps `memo:write` without it, pinning via
   `memo_stop_follows_the_a2_ruling_owner_admin_only` the property the old
   strict-`>` rank rule held (a peer manager cannot stop another manager's
   memo). The desktop command allows the AUTHOR unconditionally (the
   author-or-permission gate reads `author_user_id` from the memo row and the
   actor from the session, so the client cannot forge the match), and the
   rank-based `may_stop` helper was deleted with its tests per the ruling's
   cleanup item. `memo:write`'s description drops "stop". UI: Stop button on
   published authored rows (en+id), dev-mock handler, contract + screen
   tests; tablet allowlist entry with the desktop-only reason. Command tests
   drive the real session gate (author stop, admin stop, peer-manager deny,
   staff deny, invalid session).

2. **`c8d2a54f` — 30-day retention (`feat(core)`).** Migration
   `20260914_memo_retention.sql` adds nullable `memos.archived_at` — the
   deletion-clock anchor, because `stopped_at`/`expires_at` anchor the END,
   not the archival. The sweep runs in the existing 5-minute memo daemon on
   both shells: `sweep_ended_to_archived` transitions `stopped`/`expired` →
   `archived` (stamping the clock; never touching draft/published), then
   `sweep_expired_archives` deletes archives past
   `RETENTION_WINDOW_DAYS = 30` (children cascade — the spec's sanctioned
   deletion, only after the window). PG init regenerated (counts unchanged);
   registry parity and the 110-table/157-index pins updated; tests cover
   stamping, the day-29 boundary, cascade deletion, and the constant.

3. **`9062a7c1` — `revise_memo_scoped` + revision UI (`feat(ipc,ui)`).** The
   store's TOCTOU-guarded revise path gains a desktop command gated
   `memo:write`, and `MemosScreen` gets a Revise control on published rows:
   it loads the row into a revise-mode form that submits a new immutable
   revision (v+1) — text-only by design, since a correction fixes the text,
   not the duration or audience (those controls are disabled in revise
   mode). Dev-mock handler, en+id keys, contract + screen tests; the
   allowlist comment now covers five desktop-only management commands.

**Remaining after the rulings: the cloud-read data path** — CLOSED 2026-09-07
(the ruling journal below records the four landing commits and the open
acknowledgement-path gap; the display work is already complete — lock screen
+ all KDS branches mount the banner with server-issued cadence, per
`796f1c7a` + `10bfb9ff`).

**Verification at commit time:** `npm run typecheck` clean; `npx eslint` clean
on touched files; UI suite 500 files / 8815 passed (including the new
`MemosScreen.test.tsx`, 7 tests over real `@fluent/react` with `shared.ftl`);
`cargo test -p oz-pos-app memo` 7/7; `scripts/lint-i18n.sh` clean;
`verify-ipc-parity.py` OK. All ten pre-commit gates ran green on `3fb745cf`
(bundle parity: 35 new keys, 0 missing; FTL orphans: OK).

## Memo implementation journal — the cloud-read data path (2026-09-07)

The ruled cloud-read slice landed as five pathspec-scoped commits plus one
cleanup; each is recorded with its gates. Design source: §"Cloud-read design
(2026-09-07)".

1. **`eb71d071` — serving layer (`feat(api)`).** `crates/oz-api/src/pg.rs`
   gains `sync_memos` (reconciling upsert + delete-by-omission under one RLS
   transaction) and `list_active_memos_for_terminal` (the PG twin of
   `list_active_for_terminal`), plus `routes/memos.rs` with both endpoints.
   Two defects in this commit were caught and fixed in `9d125484`: the active
   read was registered on the PUBLIC router where its
   `Extension<ApiTokenClaims>` extract would 500 every request (moved to the
   protected router; the read gate passes it through — no READ_KEY_MAP entry,
   memo reads are authenticated-only like the local command), and
   `ActiveMemoPg` lacked `created_at`, which the tablet display DTO requires
   (wire had no consumers yet — added before any shipped).

2. **`a009d3cf` — desktop push (`feat(core,desktop)`).**
   `Store::collect_memo_sync_snapshot` reads the DATABASE's complete
   non-deleted memo state — all tenants, deliberately unfiltered; the desktop
   global DB is the single authoring authority and the cloud keys tenant
   isolation off the authenticated token's tenant_id, never the payload
   (`MemoSyncRow` carries no tenant_id). The doc comment was corrected to
   say this in `49de4fc3` after the supervisor's Round-2 flag. The 5-minute
   memo daemon now runs sweeps → snapshot → HTTP push per tick, best-effort
   (failure logs; next tick re-pushes; delete-by-omission makes retention
   deletes propagate). `push_memos_to_server` mirrors `request_token`'s
   `OZ_ADMIN_KEY` passthrough so a desktop provisioned via the fallback
   (admin-minted) path keeps pushing on gated deployments; the
   client-credentials path (terminal_id claim) needs no admin key by design.
   The daemon block confines the connection guard to a scoped block with no
   awaits inside — the `Store` borrow is not `Send` (drop() alone did not
   convince the generator analysis; the guard itself had to die lexically
   before the await).

3. **The tablet read half — landed entangled in `2c5dde8a`, whose message
   says `docs(topology)`.** Recorded here rather than hidden: the commit
   carries `fetch_active_memos_from_server` (oz-core), the
   `ActiveMemoCloud → ActiveMemoDto` mapping (cloud query only returns
   published and echoes no tenant, so status/tenant are filled from the
   read's own invariants), the cloud-first `list_active_memos_scoped` with
   local fallback on unconfigured/unreachable, and three tests: the
   wire-shape decode (snake_case in from `ActiveMemoPg`, camelCase out like
   the local command), the unconfigured path serving a seeded local memo, and
   the unreachable-cloud path (port 1) degrading to the local read instead of
   erroring. `cargo test -p oz-pos-tablet commands::memo` 6/6. No code defect;
   the misattribution is a pathspec-discipline failure on a shared tree —
   `git log -- apps/tablet-client/src/commands/memo.rs` points at a topology
   commit, and this entry is the durable record of the true contents.

4. **`f2dbb745` — spec documentation (`docs(api)`).** Both memo routes are
   now in the OpenAPI base spec (Memos tag + six schemas), closing the
   router↔spec drift `every_registered_route_is_documented` had been catching
   since `eb71d071`; the active read is exempted from the READ_KEY_MAP
   coverage guard the same way `/api/sync/*` is — device-facing poll,
   audience already terminal-scoped by the recipient join plus the claims, no
   read-tier key in the registry. oz-api 277/277; cloud-server openapi 16/16.

5. **`49de4fc3` — doc-comment correction** for the snapshot semantics (see
   item 2); the supervisor's Round-5 write-side question is answered by
   `sync_memos`'s own shape: every INSERT stamps `$2 = tenant_id` from the
   JWT claims and the reconciliation DELETE is `tenant_id = $1`, so the body
   cannot write across tenants even in principle (the row structs carry no
   tenant field to spoof).

**Verification of the whole path:** `pg_integration_memo_sync_and_active_read`
(`pg_tests.rs`, throwaway-DB pattern, skips clean without the dev PG
container) drives push → terminal read (fields incl. `created_at` and
`delivery_status`) → stranger terminal sees nothing → delete-by-omission →
code-level cross-tenant isolation (token-stamped inserts + tenant-filtered
reads — the Round-14 wording correction below explains why "RLS" was
wrong here). `cargo test -p oz-core --lib sync_client`
35/35; `db::memos` 39/39; `cargo check -p oz-pos-app` clean.

**Deliberately NOT built here — the acknowledgement upstream path.**
`acknowledge_memo_scoped` (tablet) still writes the LOCAL memo_recipients
row, which is structurally empty on a terminal: the command can only return
`NotFound` on a cloud-fed tablet, and nothing marks `delivered` upstream
either (`mark_recipient_delivered` has no production caller — delivery state
in the cloud is whatever the desktop last pushed). Today's UI degrades
correctly (ack is optimistic, failure non-fatal, the memo returns next poll),
but durable acks need a cloud write (a `POST /api/v1/memos/ack` gated to the
terminal's own claims, folded into the desktop push, or a `memo.acknowledge`
outbox item). No UI, IPC, or parity surface changes until that is ruled —
recorded as the workstream's remaining open item.
  **RESOLVED since (2026-09-07):** the cloud ack route landed (`52af7f9b`)
  and the tablet cloud-first ack with local fallback in `b9278fb0` — see
  the acknowledgement journal below.

## Memo implementation journal — acknowledgement upstream (2026-09-07)

The cloud-read journal above ended by recording the acknowledgement
upstream path as the workstream's remaining open item ("Deliberately NOT
built here"). Two commits close it:

1. **`52af7f9b` — cloud ack route (`feat(api)`).**
   `POST /api/v1/memos/{memo_id}/ack` (`ack_memo` in `pg.rs`,
   `ack_memo_handler` in `routes/memos.rs`): terminal-scoped tokens only
   (403 `not_terminal_token` when the claims carry no `terminal_id`), the
   caller cannot name another terminal (the UPDATE keys on the claim),
   tenant comes from the claims (RLS GUC), unknown recipient is 404, and
   the state machine `WHERE delivery_status IN ('pending','delivered')`
   with `delivered_at = COALESCE(delivered_at, now)` backfills delivery
   when an ack lands on a `pending` row — double-ack is a no-op
   `changed: false`. Spec'd in the OpenAPI (`MemoAckRequest` /
   `MemoAckResult`). The same commit made `sync_memos`'s recipient merge
   MONOTONIC (rank pending=0 < delivered=1 < acknowledged=2, desktop wins
   ties): without it, every desktop push would downgrade cloud-side
   acks, because the desktop snapshot still carries the older delivery
   state — the "snapshot delivery state is the newest fact" premise died
   the moment acks started landing in the cloud. **Ack lands between a
   snapshot collect and the next push?** Benign by that merge: the stale
   push cannot regress the rank, and existence reconciliation only
   deletes rows the desktop no longer fans out to.

2. **`b9278fb0` — terminal ack client (`feat(tablet,core)`).**
   `ack_memo_on_server` in `oz-core`'s `sync_client` (`sync-http`
   feature; the disabled-feature stub returns Err so the fallback
   applies — a durable ack has no honest pretend-success) POSTs
   `{ "acknowledged_by": ... }` and parses the snake_case `MemoAckCloud`
   (the server's `MemoAckResult` carries no serde rename). `user_id` is
   informational only — terminal tokens have no user identity, and it
   must never become an authorization input. `acknowledge_memo_scoped`
   is now cloud-first with the local write as fallback; the config read
   happens in a scoped block so the connection guard never spans the
   HTTP await (it is not `Send`).

**Tests:** `ack_goes_to_the_cloud_and_carries_the_wire_contract` drives a
live TCP stub and pins the POST path, bearer token, and `acknowledged_by`
body; `ack_falls_back_to_local_write_with_seeded_recipient` pins the
fallback write (`delivery_status` acknowledged, `acknowledged_by` =
session user). oz-core sync_client 35/35, oz-api 279/279, cloud-server
openapi 16/16, tablet memo 8/8, `verify-ipc-parity.py` OK.

**Round-14 wording correction (owed since the push slice):** the PG test
pins CODE-level cross-tenant isolation — token-stamped inserts +
tenant-filtered reads — not "RLS cross-tenant invisibility". The test
connects as the table owner (superuser-scoped dev pool), and RLS on an
owner connection is bypassed without `FORCE ROW LEVEL SECURITY`, so the
two occurrences above now say what the test actually proves. The memo
tables ARE RLS-enabled (`memos`, `memo_locations`, `memo_recipients` in
`RLS_TABLES`; the generated init carries the DO-block policies) — that
is the second layer, enforced for non-owner connections; the exemption
gate (`07197574`) keeps that coverage honest going forward.

**Known limit, accepted:** the cloud merge reconciles existence by
omission against the pushing desktop snapshot, so a desktop restored
from a backup (rewound memo state) would omit memos/rows that still
carry newer cloud acks — and the push would delete them. Acks ride the
desktop's authority over fan-out membership; a tombstone or merge-window
design is the future fix if this ever bites in practice.

## Memo implementation journal — display surface redesigned as a chat bubble (2026-09-07)

**`eef79ebd` (`feat(ui)`) — owner-directed redesign of the MemoBanner.**
The notification was a full-width bar pinned across the top that slid in
from the top edge; the owner asked for a chat bubble instead. The surface
is now a `position: fixed` overlay at bottom-left (`--space-6` inset,
`--z-overlay`) with a speech-bubble tail (a rotated 12px square sharing
the bubble's solid `--color-bg-popover` background and border on its two
outward faces — the tail trick needs a SOLID background; the old
translucent gradient would have shown the seam). Entry rises from the
bottom (`translateY(16px)` → 0); the exit mirrors it (sink + fade), both
still inside `prefers-reduced-motion: no-preference` per the
exit-animation-pattern skill. Solid tokens carry dark mode, so the
`[data-theme='dark']` gradient override is gone.

**Semantic change, deliberate:** the old surface had two buttons —
Acknowledge (durable) and × (session-only dismiss). The bubble has ONE
close button (×) and it maps to the DURABLE acknowledge — chat-bubble
semantics: read it, done; the memo never returns on this terminal. The
session-only `dismiss` path stays on `useMemos` (hook API unchanged, its
tests unchanged); only the banner stops consuming it. The close keeps
the `memo-banner-acknowledge-aria` label so the mount tests and screen
readers still see "Acknowledge this memo". FTL keys
`memo-banner-acknowledge` and `memo-banner-dismiss-aria` were dropped
from both locales in the same commit (staged-scoped orphan gate).

**Tests:** MemoBanner.test.tsx updated (dismiss test removed, close-
button durability asserted); MemoBannerMount.test.tsx passed UNCHANGED —
its assertions (title, Location notice badge, the acknowledge-aria
button) were already surface-shape-agnostic. Compliance gates green:
animation, themeToken, nativeTooltip, screenExtraction, useMemos,
typecheck, eslint. The three "top-left" spec sentences in this file were
amended in the docs commit that carries this entry.

## RULING — `stop_memo` early-stop authorization (2026-09-07) — approved: option A2, fallback A1

> **Ruled 2026-09-07: option A2 approved, A1 the named fallback** — a new
> `memo:stop` key granted to the Owner and Admin presets, the author
> short-circuit preserved, everything else deny-by-default. If A2 hits a wall
> in implementation, fall back to A1 (reuse `memo:write`) and record why.
> The options below are kept as the ruling's rationale. The implementation
> slice: registry entry + preset grants + `stop_memo_scoped` desktop command
> + `MemosScreen` stop control + tests + the `may_stop` cleanup item below.
> Nothing below is implemented yet.

**The spec requirement** (§"Memo lifecycle"): "early stop by author or higher
role". Both halves below it already exist, tested, with authorization
deliberately left at the seam:

- `Store::stop_memo` (`crates/oz-core/src/db/memos.rs:335`) rejects
  non-published memos and stamps `stopped_by`/`stopped_at`; its doc comment
  puts the gate in the caller: "Authorization (author-or-higher) is the
  caller's gate."
- `may_stop(actor_is_author, actor_rank, author_rank)`
  (`crates/oz-core/src/memo.rs:280`) — author short-circuit OR strict `>` —
  with semantics pinned in `memo_tests.rs:176-193`: a demoted author can still
  stop their own memo; a peer manager cannot stop another manager's.

**The blocker is a missing vocabulary, not shyness.** `may_stop` consumes
*ranks*, and no rank mapping exists anywhere: `platform/core/src/rbac.rs`
defines permission sets only (`role-owner/manager/admin/auditor/staff/custom`).
There is no owner>admin>manager ordering to consult, and Phase 3's
custom-roles item requires unknown roles to default to deny — inventing a
numeric hierarchy now would be a second authorization vocabulary outside the
registry, the exact thing ADR #35's single deny-by-default registry
(`crates/oz-core/src/db/staff.rs:306`) exists to prevent. Meanwhile the
registry already names the verb: `memo:write` is described as "Author,
publish, **stop**, or archive a Memo (Organization or Location.)"
(`platform/core/src/permission_registry.rs:585`), granted to Owner (`*`),
Manager, and Admin presets, and every memo command already passes through
`require_permission_for_session` (`commands/authz.rs:91`). `may_stop` has no
non-test caller today, so nothing is half-wired and nothing breaks by
choosing.

### Option A (recommended) — author-or-permission

`stop_memo_scoped(memo_id, session_token)` on desktop: tenant-scoped read,
then allow iff `author_user_id == session.user_id` OR the session authorizes
the chosen key, then `store.stop_memo`. The author short-circuit preserves
`may_stop`'s first half; "higher role" becomes a grant-list question instead
of arithmetic.

Sub-decision the owner must make — which key:

- **A1: reuse `memo:write`.** Zero registry churn and the description already
  names stop. But Manager and Admin presets both hold it, so a Manager could
  stop an Owner's memo — weaker than the spec's "higher role" intent.
- **A2: new `memo:stop` key**, granted to Owner and Admin presets only
  (Staff/Auditor/Custom deny by default). Preserves the intent in registry
  vocabulary; costs one registry entry, two preset grants, amending
  `memo:write`'s description to drop "stop" (or scope it to archive), and the
  usual gate re-runs (feature-registry, ipc-parity, bundle docs).

Either way the UI slice is the same: a stop control on published rows the
viewer authored in `MemosScreen`, and `stop_memo_scoped` on the tablet
allowlist with a recorded reason, following the authoring precedent (the UI
api layer is shared, so the parity gate requires it there even though the
surface is desktop-only).

### Option B — build the rank map (rejected leaning)

owner > admin > manager > staff, custom roles deny. Makes `may_stop` live as
written, but the ordering is invented (nothing else in the codebase says admin
outranks manager), it forks authorization into permission-set + rank
arithmetic, and it collides with the Phase 3 custom-roles item. Only worth
revisiting if the owner explicitly wants semantics permissions cannot express.

### Option C — defer entirely

Status quo: Memos stay un-stoppable until the retention sweep expires them.
Costs nothing now, but leaves a spec'd behaviour permanently unimplemented,
and the live expiry sweep is the only path by which a wrong memo ever ends.

### If A lands — cleanups that come with it

- Give `may_stop` a caller again (reworked to take an author-or-permission
  verdict) or delete it with its tests; leaving a tested pure rule with zero
  callers is the "capability and wiring tracked as one thing" failure this
  file keeps catching.
- Update the `commands/memo.rs` module doc, which records the deferral.
- Flip open item (b) in the P1 Memo checkbox above.

---

## Supervisor log — 2026-09-07 (Round 1, senior-agents supervision)

Observed state at HEAD `315c1e6f`, working tree dirty (~1,100 insertions,
two concurrent uncommitted streams: ADR #46 Phase 1 Step 1b in
`commands/topology/*`, memo cloud-read slice in `memos.rs`/`sync_client.rs`
/ tablet `memo.rs`). Actions taken this round:

1. **Re-ran the dependency triage (§"Phase 2 execution plan") against HEAD.**
   Its two "blocked" verdicts are stale:
   - **Downgrade behavior** — blocked on "centralized quotas"; that gate
     CLOSED with `73e77c5f` (terminal/warehouse) and `de6d2df2`
     (product/KDS-screen). **Startable now.** Owner: Phase 2 agent.
   - **Entitlements beyond tiers (§B)** — blocked on "entitlement plumbing";
     the fail-closed subscription lifecycle (`9896dac4`, `4acaeea9`,
     `1176730a`), grace policy, and admin-vs-operational split (`ed3731b2`,
     `cc5d6c71`) have landed on the Phase 1 side. **Partially startable —
     re-verify the remaining §B clause list against current IPC before
     writing code.**
   - Still blocked: audit baseline (waits on §B plumbing), regional
     configuration (§G default-entity migration, Phase 1 side), tax
     separation, Locations→Topology entry.
2. **Fixed a stale checkbox:** `Wire revise_memo_scoped` was checked above —
   it was built in `9062a7c1` but never flipped. Lesson for both agents, the
   file's own recurring one: **flip the checkbox in the same commit that
   lands the capability.**
3. **Interleaved-working-tree caution:** both uncommitted streams share this
   checkout. The journals show pathspec-scoped commits working — keep doing
   exactly that; never `git add -A` / `git stash` across streams; run
   `git status --short` before every commit and stage explicitly.
4. **No agent should start ADR #46 Phase 1c–1e until Step 1b's tests are
   committed green** (`topology_command_tests.rs`, `topology_tests.rs` are
   mid-edit right now). The ADR's Solo Implementation Protocol governs that
   work, not this file.

---

## Supervisor log — 2026-09-07 (Round 2)

Observed at HEAD `315c1e6f` (unchanged since Round 1); working tree grew to
27 modified files / +1,345 insertions — both streams still uncommitted, both
actively progressing. No new IPC surface, no handler registrations, dev-mock
untouched (parity-gate risk low this round), and the migration-file edits in
both streams are **cosmetic column alignment only**, applied in lockstep to
the SQLite and PG copies — consistent with the PG-drift gate.

**PRE-COMMIT REVIEW FLAG — `collect_memo_sync_snapshot` tenant scoping.**
The in-flight function's doc comment promises "the tenant's COMPLETE
non-deleted memo state", but its query is `SELECT ... FROM memos m ORDER BY
created_at` with **no `WHERE tenant_id` filter** (crates/oz-core/src/db/
memos.rs, uncommitted). Today this is latent — the desktop global DB is
effectively single-tenant and the cloud reconciles by upsert +
delete-by-omission — but it is the same bug class as `7ed4412b` (unfiltered
fan-out) and the same contract gap that `56653839` (tenant_id backfill)
existed to close. Ask before landing: (a) does the caller hold a tenant_id to
filter by, and is there a multi-tenant row in this DB at all; (b) if the
whole-DB read is deliberate, the doc comment and the push envelope should say
"all tenants, desktop-is-authoritative" explicitly, and the cloud side must
not key its reconciliation on `tenant_id`; (c) either way, add a test pinning
the chosen semantics. Resolve this in the same commit that lands the slice —
do not defer to a follow-up.

Also noted: `pg_integration_memo_sync_and_active_read` is being added to
`crates/oz-api/src/pg_tests.rs` — good, that is the right surface for the
cloud-read slice; make sure it asserts the tenant-scoping semantics decided
in the flag above, and that it is skipped cleanly when the PG DSN is absent
so local gates stay green.

---

## Supervisor log — 2026-09-07 (Round 5)

New commits since Round 4: `a009d3cf` (desktop memo push), `9d125484` (memo
active-read moved behind auth — good self-catch: it was on the public router,
where its handler's `Extension<ApiTokenClaims>` would 500 every request),
`15c40cec` (splash polish, unrelated). State of this file's work:

**1. The Round-2 pre-commit flag was NOT resolved before the commit landed.**
`collect_memo_sync_snapshot` committed with the unfiltered
`SELECT ... FROM memos ORDER BY created_at` and the "the tenant's COMPLETE
memo state" doc comment — now in permanent history — and no test pins the
push semantics. The `9d125484` message does say "Tenant scope rides the JWT,
never the body", which reads like option (b) from the Round-2 flag was chosen
implicitly: whole-DB push, cloud keys reads by token tenant. That design can
be sound — but "implicitly chosen and undocumented" is precisely what the
flag said not to do. **Resolution now demanded (post-commit):**
   - (i) Fix the doc comment and future commit messages: say "the DATABASE's
     complete memo state; the cloud keys tenant isolation off the
     authenticated token, not the payload" — the current wording is wrong
     and will mislead the next reader.
   - (ii) Pin the semantics with one test: seed two tenants' memos in the
     desktop DB, assert the snapshot includes both (whole-DB push), and
     assert the cloud-side ack. If instead the call site is supposed to
     filter, filter it — but then say which tenant_id and where it comes
     from.
   - (iii) Answer the write-side question explicitly in the journal: does
     `sync_memos_handler`'s upsert trust body `tenant_id` per row? If yes,
     what stops a tenant's sync token from writing rows stamped with another
     tenant_id? The read side is JWT-scoped (verified); the write side needs
     one sentence of design or one guard.
   - (iv) Journal this slice in this file — nothing here records `a009d3cf`
     yet, and the §"Memo implementation journal" pattern (slice → gates →
     tests) is the file's own standard.

**2. Worktree state:** the tablet READ half of the cloud-read path is
written and uncommitted (`fetch_active_memos_from_server`, DTO conversions,
`cloud_wire_shape_decodes_into_display_dto`,
`local_read_serves_seeded_memo_when_sync_unconfigured` — the local fallback
test is good design, keep it). Land it with its tests; it completes open
item (b)'s remaining half.

**3. Checkbox discipline again:** the P1 Memo item's open-list and the
ruling journal's "designed and pending" line both lagged the landed push
commit; supervisor updated them this round (see the SUPERVISOR UPDATE note
at the P1 checkbox). Same lesson as Round 1, third occurrence: **flip the
checkbox in the same commit that lands the capability.**

---

## Supervisor incident note (2026-09-07, Round 5) — journal integrity

During Round 5 the supervisor corrupted this file twice in the working tree:
first a botched shell heredoc wrote an invalid UTF-8 byte (mangled emoji),
then a careless binary-level "repair" deleted a large span of sections
between the execution-plan section and the file tail. Both mistakes are the
supervisor's, not any agent's. The file was rebuilt from HEAD
(`git show HEAD:todo-global-saas-2.md`, which contains all agent content as
committed) plus re-applied supervisor additions (Rounds 1, 2, 5 and the
three in-place status notes). A pre-repair copy is preserved at
`/tmp/saas2-corrupted-backup.md` for diffing. **Agents: re-read this file
before your next edit; if anything you wrote after your last commit appears
missing, it is supervisor damage — restore from your last commit and
re-apply, or flag it in the next supervisor round.** Rule adopted for the
supervisor going forward: journal edits go through byte-safe, anchor-asserted
inserts only — never binary patching, never unvalidated heredoc content with
multi-byte characters.

---

## Supervisor log — 2026-09-07 (Round 6)

**1. Open item (b) is now FULLY delivered** — the tablet read half landed
(`fetch_active_memos_from_server`, DTO mapping, wire-shape tests, and the
local-fallback test) — but it landed inside `2c5dde8a`, whose title says
`docs(topology): correct ADR #46's retention-sweep anchor`. **That commit
carries 226 lines of tablet product code under a docs-only message.**
Consequences and required action:
   - Git history now misattributes the tablet read slice; `git log -- <tablet
     path>` points at a topology-docs commit.
   - This is the file's own pathspec-discipline failing (Round 1 rule 3, R5
     log item 3). Since the branch is unmerged, a rebase to split/split-name
     the commit is cheap NOW and expensive after PR. Either split it, or at
     minimum journal the true contents against `2c5dde8a` in this file.
   - No code defect was found in the landed tablet read itself; the local
     fallback test is good design.

**2. Round-5 demand status (tenant semantics on the memo push):**
   - (i) STILL OPEN and now worse: the committed module doc
     (`crates/oz-core/src/db/memos.rs` line 5) claims "Every read/write is
     tenant-scoped (`WHERE tenant_id = ?`)" while
     `collect_memo_sync_snapshot` in the SAME FILE is the one unfiltered
     read. The doc is factually false at HEAD. Fix the doc or add the filter.
   - (ii) STILL OPEN: no test pins whole-DB push semantics.
   - (iii) STILL OPEN: write-side answer for `sync_memos_handler` upsert and
     body `tenant_id`.
   - (iv) STILL OPEN: no journal entry for the push slice (`a009d3cf`) in
     this file.

**3. Progress on the Round-1 unblock calls:** `776af581` gated Memo and
Data Management screens behind the §B admin gate with dedicated UI tests —
the first slice of the "partially startable" §B entitlements work. The
triage's remaining §B clause list should be re-verified against current IPC
before the next slice, per Round 1.

**4. Five commits landed this session without journal entries in this file**
(`a009d3cf`, `9d125484`, `776af581`, `33b5789b`, `15c40cec` + the entangled
`2c5dde8a`). The Memo implementation journal (§"Memo implementation journal")
is the file's standard — backfill at least the push slice and the §B gate.

---

## Supervisor log — 2026-09-07 (Round 12)

**Round-5 demand status after `49de4fc3`:**

- **(i) RESOLVED.** The doc fix is thorough and honest: "the DATABASE's
  complete non-deleted memo state — all tenants, deliberately unfiltered",
  with the isolation model stated ("the cloud keys tenant isolation off the
  authenticated token's tenant_id, never the payload — MemoSyncRow carries
  no tenant_id"). Commit message does the same. Supervisor verified against
  the committed code.
- **(iii) ANSWERED by code review (supervisor-verified at HEAD `49de4fc3`):**
  the write side is safe by construction — `sync_memos` binds `&tenant_id`
  derived from `require_tenant_write` (the token), never the payload, for
  the `memos` INSERT *and* the `memo_locations`/`memo_recipients` rows;
  delete-by-omission is `WHERE tenant_id = $1 AND NOT (id = ANY($2))` with
  `$1` = token tenant. There is no payload forgery vector for tenant
  attribution. One caveat: see the RLS gap in saas-1's Round-12 note — the
  memo tables are NOT RLS-covered, so the "RLS: scope to the tenant"
  comment in `pg.rs` is aspirational on this path (defense-in-depth absent,
  code-level isolation present).
- **(ii) STILL OPEN:** no test pins whole-DB push semantics (two tenants
  seeded in the desktop DB, snapshot includes both; cloud ack asserted).
- **(iv) STILL OPEN:** this file still has no journal entry for the push
  slice (`a009d3cf`) — the commit message of `49de4fc3` is a paper record,
  but the Memo implementation journal is this file's standard. Backfill.

No other movement: Step 1c (topology) still awaiting commit with its cleared
tests; the §B read-only slice is mid-flight and compile-green as of this
round.

---

## Supervisor log — 2026-09-07 (Round 13)

`f2dbb745` documents the memo serving routes (`/api/v1/memos/sync`,
`/api/v1/memos/active`) in the OpenAPI spec — the cloud-read slice's API
surface is now formally recorded. Noted toward the still-open demands:
- (ii) two-tenant push-semantics test — still open (unchanged).
- (iv) journal backfill for the push slice — `49de4fc3` + `f2dbb745` are
  paper records now, but the Memo implementation journal entry is still
  owed. Two commits is enough history to write it from; write it before the
  slice's context leaves working memory.
Round-12's RLS finding (memo tables uncovered) also stands — see saas-1.

---

## Supervisor log — 2026-09-07 (Round 14)

**Demand (iv) RESOLVED** (`3770847b`): the push slice is journaled at the
file's standard — including the entangled `2c5dde8a` tablet code, recorded
"here rather than hidden." The split-or-journal decision from Rounds 6–13 is
resolved as journal; accepted.

**One precision correction to the new journal text:** it says the PG test
pins "RLS cross-tenant invisibility." The test is real and valuable, but the
mechanism it proves is CODE-level isolation (token-stamped inserts +
tenant-filtered reads) — the memo tables are NOT RLS-enabled (verified again
at HEAD `3770847b`; see saas-1's Round-14 note). Saying "RLS" overstates the
defense layer and will mislead the next reader into assuming a protection
that does not exist. Either fix the wording, or — better — close the RLS gap
and make the wording true.

**Demand (ii) still open:** `collect_memo_sync_snapshot` has zero tests in
`memos_tests.rs`. The PG test seeds two tenants in the CLOUD db; the demand
was for the DESKTOP-side snapshot (seed two tenants in the desktop DB,
assert the snapshot includes both — the whole-DB push semantics). Still owed.

Watch item: Step 1d (`log_audit` on topology Apply) is in flight in the
working tree with correct redaction reasoning about the change note.

---

## Supervisor log — 2026-09-07 (Round 23)

**Demand (ii) refinement (interacts with the RLS closure now in flight —
see saas-1 Round 23):** the memo tables are entering RLS with WITH CHECK on
the tenant GUC. When the demand (ii) test is written, its cloud-side
assertion changes shape: seed two tenants in the desktop DB -> snapshot
includes both -> the push under one token ACCEPTS the token tenant's rows
and REJECTS the foreign-tenant rows (WITH CHECK) — decide and pin whether
that rejection skips the row or aborts the batch (per-row resilience fits
the best-effort push design; a silent whole-batch loss does not). The test
that proves the rejection is the defense-in-depth proof this file has been
asking for since Round 2.

---

## Supervisor log — 2026-09-07 (Round 28)

**Demand (ii) RESOLVED** (`e09ccde6 test(core): pin whole-database memo
snapshot semantics`): two tenants seeded in the desktop DB, the snapshot
asserted to include both, recipients per fan-out asserted, and the test
comment carries the contract: "If someone later fixes the unfiltered query
by adding a tenant filter without changing the push contract, this test
fails loudly and forces the decision to be re-made consciously." The
test-as-contract pattern, exactly as demanded in Rounds 2 and 23.

**Correction to my Round-23 refinement** (per-row-skip vs batch-abort): the
question is MOOT, and I should have seen it then. The sync INSERT binds the
token-derived tenant_id for every row at bind time (`pg.rs` sync_memos), so
the RLS WITH CHECK (tenant_id = GUC) never triggers a rejection — rows are
re-stamped with the pushing token's tenant, not rejected. The real residual
is a deployment constraint, not a code path: one desktop global DB maps to
one authority token, and a multi-tenant desktop DB would attribute every
tenant's memos to the pushing token's tenant in the cloud. That constraint
is already implied by "single authoring authority" (memos.rs doc) — if it
ever needs to become an explicit validation (warn on push when the local DB
holds >1 distinct tenant_id), that is a small follow-up slice, not a defect.

---

## Supervisor log — 2026-09-07 (Round 29)

**Design decision worth its record before it commits:** the memo sync path
is gaining a MONOTONIC delivery-state merge in `pg.rs` (uncommitted). Why it
matters: the cloud-read ruling made terminal acks land in the CLOUD
(`ack_memo`) while the desktop snapshot still holds older delivery state —
so the original wholesale recipient-row replace would DOWNGRADE cloud-side
acks on every push. The fix merges by rank (`pending < delivered <
acknowledged`), desktop wins ties (authoring authority; equal ranks cannot
regress), existence still reconciles by omission. This is a real
distributed-state decision — convergent merging with a monotonic field —
and it is the first piece of state in the codebase with this shape. When it
commits: (a) the commit message should carry the downgrade scenario as the
rationale; (b) a test must pin rank-merge semantics explicitly
(pending-then-acknowledged survives a stale push; delivered-then-pending
cannot happen but the tie rule should be pinned anyway); (c) `ack_memo`'s
interaction with the push (ack lands between snapshot collect and push)
deserves one sentence in the journal — the merge makes it benign, say so
where the next reader will look.

---

## Supervisor log — 2026-09-07 (Round 34)

**Cloud-read loop completing in-tree (uncommitted): the upstream ack half.**
`POST /api/v1/memos/{memo_id}/ack` — a terminal acknowledges a memo it
received. Pre-commit review verdict: sound by construction.
- Auth: JWT required (new `memo_ack_requires_auth` test), terminal-scoped
  tokens only.
- Self-scoping: the caller CANNOT name another terminal — the UPDATE keys
  on `claims.terminal_id`; tenant comes from claims (RLS GUC set); unknown
  recipient is 404.
- State machine: `WHERE delivery_status IN ('pending','delivered')` with
  `delivered_at = COALESCE(delivered_at, now)` — acking from `pending`
  backfills delivery; double-ack is a no-op `changed: false`. All pinned in
  the OpenAPI description (spec/paths.rs + schemas.rs updated too).
- Convergence: the spec text explicitly states the ack survives stale
  pushes via the monotonic merge — the two halves of the design now
  reference each other in the docs.
- `acknowledged_by` is correctly documented as a display fact (terminal
  tokens carry no user identity) — keep it that way; it must never become
  an authorization input.

With this landed, the memo cloud-read path is end-to-end: publish on
desktop -> push -> terminal read (cloud-first, local fallback) -> ack ->
monotonic merge back. Remaining owed on this stream: the rank-merge TEST
conditions from Round 29 (still absent), and the slice journal entry.

---

## Supervisor log — 2026-09-07 (Round 35)

**Memo cloud-read loop: COMMITTED END-TO-END** (`52af7f9b`). All three
Round-29 conditions verified in the commit:
1. Rank-merge test: ack -> stale re-push with older `pending` -> cloud-side
   `acknowledged` survives (the exact downgrade scenario, pinned as an
   integration test through the real REST functions under RLS).
2. Downgrade rationale carries in the commit message with the invariant
   named.
3. Delivered-backfill + double-ack-no-op semantics pinned in the same test.
The OpenAPI spec documents the whole route. **The Memo lifecycle P1 item is
now functionally complete across the stack**: authoring (desktop, multi-
location), fan-out, delivery, cloud-first tablet/KDS read with local
fallback, upstream ack, monotonic reconciliation, retention sweep, early
stop, revisions. Remaining for the checkbox: nothing functional — flip it
with a summary line when the next journal pass runs (the offline-delivery
sub-item was ruled to ride the outbox and remains future work, recorded
that way).

Still open on this file: RLS closure commit (order step 1), ADR #46
Phase-1 gate (1e UI + concurrency, order step 4), ADR #47 ruling
(order step 5).

## Downgrade detection slice (2026-09-08, DSH) — the missing half of §J

Supervisor Round 1 (2026-09-07) re-triaged "Implement downgrade behavior"
from *blocked* to **startable now**: the centralized-quotas gate it waited
on closed with `73e77c5f` (terminal/warehouse) and `de6d2df2`
(product/KDS-screen). Re-verified against HEAD before writing: the
creation-time half of §J is genuinely already in place — every
globally-countable dimension has a live `enforce_*_quota` gate
(`enforce_location_quota`, `enforce_terminal_quota`,
`enforce_warehouse_quota`, `enforce_staff_quota`,
`enforce_product_quota`) returning `QuotaError::*Limit` →
`SubscriptionLimitExceeded`, and POS registers additionally have the
suspend/restore path (`suspend_surplus_instances`, ADR #5 Phase 3c).
What §J still lacked was the *complementary* question — after a downgrade,
**which already-existing resources are above the new quota, and by how
much** — the detection an owner-facing "archive or upgrade" view needs.
`over_quota` appeared nowhere in code (only in these todo files).

**Delivered:** a migration-free, purely additive detection layer.

- `crates/oz-core/src/downgrade.rs` — pure domain: `QuotaDimension`
  (Locations / PosRegisters / Warehouses / Staff / Products),
  `QuotaCounts`, `QuotaUsage`, `OverQuotaReport`, and `evaluate(tier,
  counts)`. Two thresholds are deliberately distinguished: **over quota**
  (`current > limit`, §J's "above the new quota", needs remediation) vs
  **at the cap** (`current == limit`, compliant but `blocks_creation`).
  Unlimited tiers (`None`) are never over and never block.
- `crates/oz-core/src/db/downgrade.rs` — `Store::assess_downgrade(tier)`,
  a read-only gatherer that feeds `evaluate` the **same** `count_*`
  methods the creation gates use (`count_locations`, `count_terminals`,
  `count_warehouse_locations`, `count_staff_users`, and a new
  `count_products` mirroring `enforce_product_quota`'s inline count).
  That identity is the contract: a dimension reported over quota here is
  exactly one whose next creation the gate rejects — assessment and
  enforcement cannot drift.
- 12 tests (8 pure in `downgrade_tests.rs`, 4 gatherer in
  `db/downgrade_tests.rs`). The gatherer test seeds a deterministic
  tenant and asserts both the wiring (report.current == the count method)
  and the §J semantics (Free downgrade: registers/warehouses/staff over
  by 1, the single default location at-cap-not-over, products under).
  `cargo test -p oz-core --lib downgrade` 15/15; rustfmt clean;
  `cargo check -p oz-core --all-targets` zero warnings.

**Deliberately excluded, and why:** KDS screens and topology nodes are
capped *per location* (`max_kds_screens` vs `count_active_kds_instances
(store_id)`, checked during topology Apply), so they have no honest
tenant-global row here — forcing one would invent a number the gates
never compare. They belong to the workspace/topology path.

**⚠️ Concurrency incident, recorded honestly (this file's own recurring
lesson):** the four files and the two `pub mod downgrade;` wirings landed
in `869de0ce` — a *concurrent agent's* whole-tree commit
(`feat(core): availability verdicts and downgrade report`) that swept my
untracked work in under **their** message, the exact `3b10ea3a` hazard
AGENTS.md warns about. I verified the landed content is byte-identical to
what I wrote (`git diff HEAD` empty on all four) and still green at HEAD,
so nothing was lost or mangled — but the code carries the wrong author
trail. **This journal entry is the durable record of the true authorship
and rationale.** The lesson (flip the checkbox in the landing commit)
could not be followed here because the landing commit was not mine; the
detection layer is a partial step, so the §J box stays unchecked.

**Next slice (not built here, each needs a decision or a hot file):**
the owner-facing remediation surface (IPC command returning
`OverQuotaReport` + a screen listing affected resources with
archive-or-upgrade actions — touches the parity gate + dev-mock + FTL),
and whether to persist a per-resource `over_quota` marker (a migration,
which the rename/ADR agents keep hot).

## Regional configuration — design (2026-09-08, coder-4)

The design for the P1 item **"Implement regional configuration"** (line ~167),
written against HEAD `7a2e472b`. The item sat behind §G Legal Entity; that gate
CLOSED with `20260908_legal_entities.sql` (the `legal_entities` table,
`locations.legal_entity_id`, and scoped IPC on both clients), so the item is
unblocked. This section is design + the slice queue; **only Slice 1 lands with
it** — the P1 box stays unchecked until the whole axis set is delivered.

### The inventory: what already exists per axis

Nine axes are named. Six already exist somewhere; three do not exist at all.
"Exists" is measured against code, not against the todo text.

| Axis | What exists today (verified) | Where it lives | Real gap |
|---|---|---|---|
| **currency** | `locations.currency` column (default `'USD'`); `settings` key `currency.default` + 3 display keys (`currency.format`, `currency.symbol_position`, `currency.decimal_separator`, `currency.thousands_separator`); `currencies` reference table (code/numeric/minor_exponent/symbol); `currency_info` IPC on both clients | location column **and** an org-global KV row | two sources, no stated precedence |
| **timezone** | `locations.timezone` column (default `'UTC'`); consumed by `db/reports.rs::tz_modifier` (REP-03) | location column | **contract conflict, see below** |
| **locale** | `user_preferences` KV (`locale`, per-user); `ui.locale` written by `GeneralSection.tsx:50` via `setSettingScoped` | per-user table + one KV row | **the KV row has no reader anywhere in the repo** — an orphan write |
| **language** | Fluent negotiation in `ui/src/i18n/*` + `LanguageSelector`; persisted only as that same `ui.locale` | UI/localStorage + KV | no org/entity default; user-only |
| **receipt format** | 10 `settings` keys (`receipt.footer`, `receipt.paper_width`, `receipt.show_tax`, `receipt.show_currency`, `receipt.decimal_separator`, `receipt.show_table_number`, 4 margins) + `ReceiptSettingsDto` IPC on both clients + `ReceiptSection.tsx` | org-global KV (the `settings` table has **no scope column**) | not scoped at all |
| **tax regime** | `tax_rates` table (`rate_bps`, `is_default`, `is_inclusive`, `is_active`, `tenant_id`) + `tax.rounding_mode` KV + `TaxConfigurationScreen` | tenant-global | **the adjacent P1 box owns this** — see "Where the two items meet" |
| **fiscalization** | **nothing** — `git grep -i fiscal` over `*.rs` returns zero hits | — | whole axis |
| **numbering** | **nothing** that is a numbering scheme: `sales.receipt_number` is just `sale.id` (`sales_checkout.rs:495`), and `kds_daily_counters` is a KDS ticket display counter | — | whole axis |
| **local payment** | `supports_qris` is a **tier** capability (`entitlements`/caps DTO), not a regional setting; `payment_gateways` table is provider credentials | org KV / tenant table | conflates "which market" with "which plan" |
| **residency** | `docs/security/data-residency-and-retention.md`; no column anywhere | doc only | **explicitly later — §K** |

Two structural facts drive every mapping below:

1. **`settings` is a flat, unscoped KV** (`key TEXT PRIMARY KEY`). It is the
   only config store today, so every "org-global" key is also the only place a
   location could put its own value. Scoping it is a schema change, not a
   naming convention.
2. **The location row is a full-overwrite surface.**
   `update_location_profile_scoped` takes every mutable field, and
   `TopologyScreen.tsx:520` hand-lists them at the call site. Any new column
   that rides that path gets silently reset by every caller that does not know
   about it. That is why the regional axes get their **own** write path instead
   of being appended to the location update.

### The timezone contract conflict (found while inventorying, not invented)

`LocationProfile.timezone` is documented as **IANA** (`"Asia/Jakarta"`), the
IPC tests seed `"Asia/Jakarta"`, and `MultiStoreDashboardScreen` renders the
column raw. But `db/reports.rs:414` (REP-03) documents the *same column* as
holding `'+HH:MM'` / `'-HH:MM'` / `'UTC'` and **deliberately falls back to UTC
on an IANA name** (no tzdata dependency in core). `iana_timezone_names_fall_back_to_utc`
pins that fallback. So the value the UI writes is the value the reports layer
ignores: a Jakarta location buckets its own business dates in UTC. This is a
pre-existing defect this design inherits rather than fixes, and it is why
Slice 1 stores timezone as an **offset** and names the axis honestly — see the
open questions. Do not "fix" it by adding tzdata to core without a ruling.

### Axis → scope map (§H, with §K's rollout order)

§H (todo-global-saas-1.md:222) is the contract; §K (todo-global-saas-3.md:16)
is the rollout order. Mapped:

| Axis | Owning scope | Inherited by | Mechanism |
|---|---|---|---|
| locale | organization → legal entity → location | ↓ | new columns (Slice 1) |
| language | **user** (unchanged) | — | existing `user_preferences` / Fluent; org default joins at Slice 4 |
| timezone | legal entity → location | ↓ | new entity column; existing location column (Slice 1) |
| currency | organization → legal entity → location | ↓ | new entity column; existing location column + `currency.default` (Slice 1) |
| tax regime | legal entity (+ location override) | ↓ | **adjacent P1 box**, not this one |
| fiscalization | legal entity | — | new table (Slice 5) |
| receipt format | statutory content = legal entity; layout = workspace/terminal | ↓ | split, then scoped KV (Slice 3) |
| numbering | legal entity (statutory sequence) | location ticket prefix | new table (Slice 5) |
| local payment | legal entity → location | — | new scoped rows (Slice 6) |
| residency | organization | — | **later slice, §K — explicitly not pulled in** |

`country_code` on `legal_entities` is the **market anchor** the fiscalization,
numbering and payment axes key off. It is NOT residency: residency is where the
data is *stored* (an organization-level deployment decision, §K), market is how
it is *traded*. The two must not collapse into one column, and the naming here
is deliberate so a later reader cannot merge them.

### Rename vs new column vs new table

- **Rename / re-declare (no schema):** `currency.default` and `ui.locale` stay
  where they are and become the **organization level** of the chain rather than
  pretending to be location config. `ui.locale` finally gets a reader.
- **New columns (Slice 1):** `legal_entities.{country_code, locale, timezone,
  currency}` and `locations.locale`. Nullable, `''` = *not set, inherit* — the
  same "empty means unset" convention `legal_entities.legal_name`/`tax_id`
  already use, so no sentinel value is invented.
- **New table (Slice 5):** `fiscal_schemes` / `document_number_sequences` —
  both are multi-row-per-entity (a scheme has parameters; a sequence has a
  prefix + counter + reset period), so neither fits a column. A new
  tenant_id-bearing table must join `RLS_TABLES` in
  `scripts/generate-pg-migration.py` or carry an `RLS_EXEMPT` reason.
- **NOT a new table:** scoped receipt/payment settings ride a
  `regional_settings(scope_type, scope_id, key, value)` KV (Slice 3) rather
  than widening `locations` — widening the location row hits the
  full-overwrite hazard above and forces every DTO on the wire to grow.

### Slice queue (each independently revertible)

1. **Schema + model + resolver (core only) — LANDS WITH THIS DESIGN.**
   Migration adds the five columns; `oz_core::regional` gains `RegionalConfig`
   + `ConfigScope` and `Store::regional_config_for_location(location_id)`
   walking location → legal entity → organization KV → built-in default, with
   per-axis provenance. No IPC, no UI, no wire change → the parity gate, the
   FTL gates and `ui/` typecheck are all untouched, and no hot file is edited.
2. **Read-side IPC.** `get_regional_config_scoped` on both clients
   (`settings:read`), `ui/src/api/regional.ts`, dev-mock entry. Needs
   `verify-ipc-parity.py` (not in pre-commit — run it manually) and
   `verify-scoped-coverage.sh`.
3. **Write-side IPC + UI.** `set_regional_config_scoped` (`settings:edit`,
   transactional, validates ISO-4217/ISO-3166/offset shape at the core
   boundary, not in React) + a Regional card in the Settings hub with its §H
   scope tag. This is the slice that touches `ui/src/locales/shared.ftl` —
   currently a **hot file** — so it needs a coordination window.
4. **Language default.** Org/entity default locale feeds Fluent's negotiation
   order; per-user override keeps winning. UI-only + one read of Slice 1's
   chain.
5. **Fiscalization + numbering** (legal entity). New tables, RLS decision,
   statutory sequence writes inside the sale transaction.
6. **Local payment settings** (entity → location): which rails exist in the
   market, kept separate from `supports_qris`, which stays a tier answer.
7. **Residency** (§K, Phase 3): organization-level, its own ADR. Not here.

### Where the two items meet (and do not)

The adjacent P1 box — *"Separate business tax configuration from application
defaults"* — owns `tax_rates` scoping (it needs a `legal_entity_id`/
`location_id` on the rate rows and an effective-date model), tax-inclusive
behavior, and fiscal requirements. This item owns the **market facts**
(`country_code`, locale, timezone, currency) and the **resolution chain**.
They meet at exactly one seam: `RegionalConfig::tax_regime` will be *derived
from* `country_code` + the tax box's scoped rates, and both items read the same
location → entity → org walk. Deliberately **not** bundled: the tax box changes
money math on every sale, this slice changes none, and a migration that touches
`tax_rates` collides with the tax box's own migration. Slice 1 therefore adds
no tax column at all — the tax box should not have to share a migration with a
locale change.

### Open questions (cannot ask the human from here)

1. **Timezone representation.** Core has no tzdata and REP-03 pins the
   IANA→UTC fallback. Either (a) store `'+07:00'` offsets and accept that DST
   is wrong twice a year, or (b) add a tz dependency and store IANA properly.
   Slice 1 stores what is there and resolves it; it does not pick. Needs a
   ruling before Slice 3 exposes an editor, because the editor's format is the
   answer.
2. **Does `ui.locale` become the organization default**, or is it legacy
   per-user state that should move to `user_preferences` and be deleted from
   `settings`? Slice 1 reads it as the org level (the cheapest honest reading
   of an orphan write); if the ruling is "legacy", Slice 1's fallback is one
   line to remove.
3. **One entity or many for a small customer?** §G seeds exactly one default
   entity per tenant, so the chain degenerates today. The design does not
   assume multi-entity, but Slice 3's UI has to be usable when there is only
   one — do not build a per-entity editor that requires a picker first.
4. **Currency exponent source.** `currencies.minor_exponent` (table) vs
   `foundation::money::Currency::minor_unit_exponent` (compiled table) are two
   answers to the same question. Out of scope here, but the regional UI must
   not become a third.
