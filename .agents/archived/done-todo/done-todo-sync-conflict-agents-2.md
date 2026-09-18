# Orchestrator Agent 2: Cloud Conflict Detection & Resolution Endpoints

<!-- Audit stamp: 2026-09-13 · DSH · REPAIR RECONCILIATION (supersedes the
stamp below). Landed as d5a64d604 / 230642b64 / 4413a79ae / 27f2e7678.
Post-repair gates all green at this stamp's HEAD: conflict_resolution tests
23/23 (the six in 98d306ba0 drive push_batch end to end, closing the
"correct but unwired classifier" gap); clippy -p oz-cloud-server
--all-targets -D warnings exit 0 — it was NOT green when this file was
marked done: the gate failed on two lints in the oz-api dependency
(fixed by 886bee158: a let-else to `?` in guard_key_reject and a collapsed
if at the unguarded-note site) and on too_many_arguments in this crate's
own build_conflict_row (allow-documented in 0d8d8cc9).
Verified against code: routes live at `/api/sync/conflicts[/:id/resolve]`
exactly as specified; `sync_conflicts` + `sync_entity_vectors` are in the
SQLite registry (20261002, 20261003) and the regenerated PG init; openapi
documents both endpoints; tenant scoping comes from the JWT, asserted by
test. Deviation: detection is keyed on Agent 1's VersionVector (with the
Lamport order as tie-break) rather than a scalar clock compare. -->

<!-- Audit stamp: 2026-09-13 · verified against HEAD `e046e2f26` (0.0.37).
Every claim below was read out of the files themselves. Supersedes the previous
revision, which used an `/api/v1/sync/...` route prefix that does not match any
existing route, and which did not say where the `sync_conflicts` schema lives
or who registers the new routes. -->

**Document:** `todo-sync-conflict-agents-2.md`
**Role:** Orchestrator Agent 2 (Cloud Distributed Reconciliation Architect)
**Goal:** Detect concurrent (causally divergent) mutations on the same entity
in the cloud sync store, auto-merge what is safely mergeable, and flag what is
not for manager review.

**Target Crate:** `apps/cloud-server/` (package name `oz-cloud-server`)
**Sibling Documents:**
- [`todo-sync-conflict-agents-1.md`](./todo-sync-conflict-agents-1.md) (Agent 1 — Causality Clock & Delta Merge Contract)
- [`todo-sync-conflict-agents-3.md`](./todo-sync-conflict-agents-3.md) (Agent 3 — Resolution UI & Audit)

---

## Baseline findings (read these first)

1. **Existing sync routes use `/api/sync/...`, with no version segment.**
   `apps/cloud-server/src/sync_api.rs` line 191:
   ```rust
   Router::new()
       .route("/api/sync/push", post(push_handler))
       .route("/api/sync/pull", post(pull_handler))
       .route("/api/sync/status", get(status_handler))
       .route("/api/sync/snapshot", get(snapshot_handler))
   ```
   The previous revision specified `/api/v1/sync/conflicts`. **Match the
   existing prefix** (`/api/sync/conflicts`) unless a deliberate versioning
   change is wanted — and if it is, that is a separate decision, not a side
   effect of this work order.

2. **There is no `apps/cloud-server/migrations/` directory and no `.sql` file
   in the cloud server.** The cloud schema is the Postgres port of the SQLite
   init, generated into
   `crates/oz-core/migrations/20260813_init.pg.sql` by
   `scripts/generate-pg-migration.py`, and applied at startup by
   `apps/cloud-server/src/db.rs` via the `apply_schema` / `PG_INIT` path.
   So a new table means: **a new SQLite migration in
   `crates/oz-core/migrations/`, then regenerate the PG file.** Never
   hand-edit `20260813_init.pg.sql`.

3. **Causality has to come from Agent 1.** Nothing in the repo carries a
   vector or Lamport clock (`grep -rniE "lamport|vector_clock"` over
   `crates platform foundation apps modules` returns nothing). Do not invent a
   second clock here — consume `platform_sync::crdt::LamportClock` from
   Agent 1's Phase 1.1.

4. **Money fields must not be auto-merged.** Gift card redemption is guarded
   by an atomic conditional `UPDATE` plus the partial unique index
   `uq_gift_card_redeem_sale` (migration `20260901`) for sync-replay
   idempotency. Conflicting redemptions are a **High-severity conflict for
   human review**, never an automatic merge. See the severity table below.

---

## Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-cloud): …`
2. **Owned Path Fence (exclusive to Agent 2):**
   - `apps/cloud-server/src/sync_store.rs` (conflict detection block)
   - `apps/cloud-server/src/conflict_resolution.rs` (NEW)
   - `apps/cloud-server/src/conflict_resolution_tests.rs` (NEW)
   - `apps/cloud-server/src/sync_api.rs` — **only** the new `.route(...)` lines
   - `crates/oz-core/migrations/<date>_sync_conflicts.sql` (NEW)
3. **Forbidden Paths (owned by siblings):**
   - `platform/sync/src/crdt/**` (Agent 1)
   - `ui/src/**`, `apps/desktop-tauri/**` (Agent 3)

### Shared seams — who owns the join

| Seam | Owner | Note |
|---|---|---|
| `pub mod crdt;` in `platform/sync/src/lib.rs` | Agent 1 | |
| Route registration in `apps/cloud-server/src/sync_api.rs` | **Agent 2** | Was unowned |
| IPC command `resolve_sync_conflict_scoped` | Agent 3 | Does not exist yet |

### Ordering dependency

**Wait for Agent 1 Phase 1.1** (Lamport clock + ordering API) before starting
Phase 2.1. If Agent 1 is blocked, stub the clock trait locally and note it —
do not fork the clock implementation.

---

## Severity policy (decide with this table, do not improvise)

| Entity class | Examples | On concurrent divergence |
|---|---|---|
| **High** — money & inventory | gift card redemption, loyalty redemption, payment, refund | Flag for review. Never auto-merge. |
| **High** — stock | `stock.adjusted`, `stock.movement` | Auto-merge via additive delta (Agent 1's `merge_deltas`); flag only if the merge breaches an invariant (e.g. negative resulting quantity and `allow_negative` is false). |
| **Medium** — customer profile | `customer.*` non-financial fields | Auto-merge non-overlapping field sets; flag overlapping field edits. |
| **Low** — catalog metadata | name, tags, category | Last-writer-wins on Agent 1's clock order; no flag. |

This inverts part of the previous revision, which treated "gift card balances"
as an additive numeric field. They are not.

---

## Task Checklist

### Phase 2.0: Baseline Audit
- [x] Read `apps/cloud-server/src/sync_store.rs` (1,232 lines) and
      `apps/cloud-server/src/sync_api.rs` — confirm the route prefix and
      handler shape against finding 1.
- [x] Read `apps/cloud-server/src/db.rs` `apply_schema` path — confirm how
      `PG_INIT` is applied and why there is no cloud-local migration folder.
- [x] Record an audit-stamp comment on each file touched, in the house style.

### Phase 2.1: Conflict Detection
- [x] Compare the incoming mutation's clock against the stored latest clock
      for the same entity, using Agent 1's `LamportClock` ordering.
- [x] Classify as: **causally ordered** (apply silently) or **concurrent**
      (divergent).
- [x] On concurrent divergence, dispatch by the severity table above:
      - auto-merge and continue, or
      - insert a row into `sync_conflicts` and leave the entity untouched.
- [x] **Never** auto-merge a money field. Redemptions, payments and refunds
      always produce a `sync_conflicts` row.

### Phase 2.2: Persistence
- [x] Add `crates/oz-core/migrations/<date>_sync_conflicts.sql`.
      Suggested columns: `id`, `tenant_id`, `entity_type`, `entity_id`,
      `local_terminal_id`, `local_clock`, `remote_terminal_id`,
      `remote_clock`, `local_payload`, `remote_payload`, `severity`,
      `status` (`open` / `resolved`), `resolution`, `resolved_by`,
      `resolved_at`, `created_at`.
      - Any monetary value in the payload is carried in **`*_minor` integer
        columns** — the migration column-type lint (hook gate 6) rejects
        floats for exact-decimal data.
      - `severity` should be a `CHECK`-constrained enum, matching the policy
        table.
- [x] Run `python scripts/generate-pg-migration.py` and stage the regenerated
      `20260813_init.pg.sql` in the same commit. The PG drift guard (gate 7)
      will fail otherwise.
- [x] Add the Rust row struct and queries; **all writes go through an explicit
      transaction** (AGENTS.md: rusqlite/tokio-postgres transactions, no
      bare writes).

### Phase 2.3: Endpoints
- [x] `GET  /api/sync/conflicts` — list, filterable by `status` and
      `severity`, tenant-scoped.
- [x] `POST /api/sync/conflicts/:id/resolve` — body carries the chosen side
      or a custom merge; records `resolution`, `resolved_by`, `resolved_at`.
- [x] Register both in `apps/cloud-server/src/sync_api.rs` next to the
      existing four routes.
- [x] Update `apps/cloud-server/src/openapi.rs` if it enumerates sync routes —
      check, do not assume.

### Phase 2.4: Verification
- [x] `cargo fmt --all`.
- [x] `cargo test -p oz-cloud-server conflict_resolution` — **must report at
      least 6 tests.** (A substring filter that can pass with zero tests is
      not a gate.)
- [x] Required cases: causally ordered mutation applies without a conflict
      row; concurrent stock deltas auto-merge; concurrent gift-card
      redemptions produce a High-severity row and do **not** merge; tenant
      isolation (tenant A cannot read tenant B's conflicts); resolve endpoint
      is idempotent; endpoint returns 404 for an unknown id.
- [x] `cargo clippy -p oz-cloud-server -- -D warnings`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-cloud): detect concurrent sync mutations and expose conflict resolution endpoints"
  ```

---

## Non-goals (explicit)

- No UI. Agent 3 owns all of `ui/src/**`.
- No clock implementation. Consume Agent 1's.
- No changes to `apps/desktop-tauri/**`.
- No new branches, no version bump (locked at `0.0.37`), no `git push`.
