---
num: 46
area: topology
title: ADR #46: Topology Revision History, Change Notes, and Draft Restore
status: Proposed
---
# ADR #46: Topology Revision History, Change Notes, and Draft Restore

**Status:** Proposed
**Date:** 2026-09-07
**Author:** Architecture Team & OZ-POS Contributors
**Tags:** topology, revision-history, rollback, retention, audit, cold-start

---

## Context

Apply has already solved the hard part of topology writes and solved it well.
`save_topology_json_at_key_with_revision` (`persistence.rs:247`) opens one
`TransactionBehavior::Immediate` transaction that writes the graph envelope, the
compiled runtime plan, and the request ledger, clears the recovery journal, and
commits — returning the new `revision`. The envelope already carries
`{schema_version, revision, nodes, wires, resolved_issue_keys}`. Optimistic
concurrency is real: `base_revision` mismatch raises `topology-revision-conflict`,
and the comment at `persistence.rs:265-272` records a fixed lost-update TOCTOU.

What it does **not** do is keep the previous envelope. The row is overwritten.
`revision` increments and revision *N−1*'s graph is gone. So the system has a
revision **number** and no revision **history**.

The roadmap already asks for the history, in as many words
(`todo-global-saas-1.md:252-256`):

> "Treat topology edits as a draft revision. Apply should require validation, a
> human-readable diff, optimistic concurrency protection, and an explicit publish
> boundary. **Store revision history and support rollback to the last valid
> revision.**"

Of those five obligations, three are done (validation, human-readable diff via
`computeTopologyDiff`, optimistic concurrency). Two are not: the publish boundary
and revision history. `todo-global-saas-1.md:186` also places "topology edges and
graph revisions" under **per-location** ownership, which matches how topology is
already keyed (`oz-pos/topology/{branch_id}`).

### Two findings that shape this decision

**Topology is not synchronised anywhere.** It is absent from `offline_queue`
(the queue carries only `complete_sale` / `void_sale`), absent from
`lan_server.rs`, and absent from `apps/cloud-server` (zero references). The graph
is local state in the desktop client's global database. This is not a gap this
ADR introduces, but it bounds what "restore" can promise — see §8.

**Apply writes no audit record.** `log_audit(&AuditEntry)` exists
(`crates/oz-core/src/db/audit.rs:125`) and topology does not call it. Today there
is no answer to "who archived the kitchen workspace last Tuesday, and why." §6
closes that, and it is the cheaper half of the feature.

### Prior art in this repo

`memo_revisions` (`20260909_memos.sql:51`) is the shape to follow, not to
reinvent:

```sql
CREATE TABLE memo_revisions (
    id TEXT PRIMARY KEY,
    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL,
    ... payload ...
    published_at TEXT NOT NULL,
    published_by TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    UNIQUE (memo_id, revision)
);
```

Memos already operate on "do NOT edit in place — insert a NEW immutable revision
row and bump the counter" (`db/memos.rs:250`). `published_at` / `published_by`
map directly onto the publish boundary the roadmap wants.

For retention, `cleanup_old_kds_orders(30)` runs inside the existing
`spawn_daemon` + `tokio::time::interval(300s)` loop (`lib.rs:316`, call at
`:394`), and `20260914_memo_retention.sql` records a ruled 30-day archival window
with an `archived_at` anchor. Both are precedents to copy.

---

## Decision

### 1. Append-only revisions in a dedicated table

New table, mirroring `memo_revisions`:

```sql
CREATE TABLE IF NOT EXISTS topology_revisions (
    id                TEXT PRIMARY KEY,
    branch_id         TEXT NOT NULL,
    revision          BIGINT NOT NULL,
    change_note       TEXT NOT NULL DEFAULT '',
    diagram           TEXT,                 -- envelope JSON; NULL once deflated
    workspace_creations BIGINT NOT NULL DEFAULT 0,
    workspace_updates   BIGINT NOT NULL DEFAULT 0,
    workspace_archives  BIGINT NOT NULL DEFAULT 0,
    node_count        BIGINT NOT NULL DEFAULT 0,
    wire_count        BIGINT NOT NULL DEFAULT 0,
    schema_version    BIGINT NOT NULL,
    pinned            INTEGER NOT NULL DEFAULT 0,
    published_at      TEXT NOT NULL,
    published_by      TEXT NOT NULL,
    tenant_id         TEXT NOT NULL DEFAULT 'default',
    UNIQUE (branch_id, revision)
);
```

Not new keys inside `settings`. That table is key/value with no index for a
range scan by branch, no `tenant_id`, and no place to put `pinned` without
inventing a second convention inside a JSON blob.

Lives in the **global** database, beside the graph it describes. Workspace
instances stay in the per-store database, exactly as today — this table records
counts of what an Apply did to them, not their contents (§2).

### 2. Store the diagram and the workspace-diff *counts*, not workspace rows

`diagram` holds the same envelope that overwrites `settings`, so a revision is
self-contained and needs no reconstruction.

The Apply call site already has `workspace_creations` / `workspace_updates` /
`workspace_archives` in hand (`commands.rs:255-257`) and already logs their
lengths (`:272-274`). Persist those three as **counts**, plus `node_count` and
`wire_count`. That makes a history row honest on its own — "this Apply archived
3 workspaces" is the sentence an operator needs after a bad deploy — without
snapshotting workspace contents, which would duplicate another table's data and
grow without bound.

**Full snapshots, not deltas.** A typical branch envelope is ~5 KB; 20 revisions
is ~100 KB per branch. Reconstruction bugs are not worth that saving.

### 3. The INSERT goes inside the existing IMMEDIATE transaction

This is the one place it is safe, and the reason is already documented in the
file. Writing the revision anywhere outside `save_topology_json_at_key_with_revision`'s
transaction admits two failure modes:

- **Before the workspace transaction** — a compensated Apply leaves a revision
  row for a deploy that never happened, and its `revision` then collides with the
  real one.
- **After `tx.commit()`** — a crash between commit and insert loses the row for
  an Apply that *did* happen, which is worse than the first case because the
  history looks complete.

So: one insert, same `tx`, immediately beside the `Settings::set` of the
envelope. A test must force the compensation path and assert no revision row
survives it.

### 4. Retention is a count plus a pin — not a number of days

Keep the last **20** revisions per branch restorable. Beyond that, **deflate**:
`UPDATE topology_revisions SET diagram = NULL` and keep the row. `pinned = 1`
exempts a row from both pruning and deflation.

Deflation is the substance of this section. It separates the two questions that
"keep 7 days" conflates:

| Question | Answer |
|---|---|
| *What happened here, who did it, and why?* | Keep forever. It is ~200 bytes a row. |
| *Can I restore this exact graph?* | Keep the last 20, plus anything pinned. |

A time window is the right unit for high-volume operational data — sales, logs,
KDS orders — where volume forces a decision. Topology is configuration: a busy
branch Applies a few times a month. "7 days" would keep noise on active branches
and almost nothing on quiet ones, and would delete the record of a known-good
deploy just because nobody touched it that week.

The sweep runs in the existing interval loop as `cleanup_old_topology_revisions(20)`,
mirroring `cleanup_old_kds_orders(30)`. Startup-only pruning is wrong for a
desktop app that may run for weeks.

### 5. Restore loads a draft; it never auto-applies

Restore copies a revision's `diagram` into the editor canvas as an **unsaved
draft**. The merchant reviews it and presses Apply, producing a new revision.
Rollback therefore reuses the entire existing Apply path — validation, the
contract gate, the diff summary, the publish step, the journal, compensation —
and adds no second write path.

**Re-Apply rollback is explicitly out of scope.** Apply mutates real workspace
instances across two databases; reverting revision 12 → 11 as a re-Apply can
archive a POS terminal or a KDS screen mid-service. That is a different feature
with a different risk profile, and it should be proposed on evidence that
draft-restore is insufficient — not shipped because the row is already there.

A third option was considered and rejected outright: revert the diagram while
leaving instances alone. It produces a graph referencing archived workspaces or
orphaning live ones — a knowingly invalid state.

### 6. A change note on Apply, and an audit entry

Add one optional text field to the Apply dialog: *what changed and why*. It is
the difference between a list of timestamps and an actual history, and it is the
single cheapest thing in this ADR.

Also call `log_audit` on Apply. §4's deflated rows already give a readable
history, so this is not strictly required — but audit is where the existing
retention, redaction (`SENSITIVE_DETAIL_KEYS`), and export machinery live, and
topology currently has no answer to "who changed production" at all.

### 7. Old revisions are shown, never migrated

`schema_version` is stored per revision. ADR #45 moved the contract from 1 to 2,
so a pre-v2 revision may fail today's validation.

On browse, re-validate each revision and show *why* it cannot be restored. Do not
migrate revisions forward — that means writing a migration for every future schema
change, forever. Do not hide them — that destroys the history this exists to keep.

Under §5 this is cheap: restoring to a draft lets the existing validation widget
raise whatever the old graph now violates, in front of a merchant who has not
committed anything.

### 8. Local-only, stated plainly

History lives in the desktop client's global database and is not synchronised.
It does not survive a reinstall, and it is not visible from another device.

ADR #45 §4.2 criticised localStorage templates for exactly this — "they do not
survive a different device, a profile switch, or a reinstall." A per-branch table
in the client database is a strictly better answer, but it is the same *class* of
answer, and the record should say so rather than let the next reader discover it.

Syncing topology is a separate project: there is no sync path for it today, so
"sync the history" would really mean "design topology sync." That decision does
not ride in on this ticket.

### 9. Tenancy follows `memo_revisions`, not `settings`

`tenant_id TEXT NOT NULL DEFAULT 'default'`, stamped by the write path, **not**
added to `RLS_TABLES`. That is precisely where `memo_revisions` sits — it carries
the column and remains on the generator's visible "not yet covered" list.
Enabling RLS is a policy decision the repo has deliberately kept separate from
schema, and `settings` (no `tenant_id` at all) is the wrong precedent to follow
against an active tenancy migration series.

### 10. UI is its own module, and the differ is new code

The version browser ships as a standalone overlay module, following
`topologyBranchCompare.ts` (488 lines), which already solves "render a second
graph against the live one" with `layoutGhosts` and `compareFocusDimIds`.

`NodeTopologyEditor.tsx` is 6,146 lines — 29% of the feature's TypeScript — and
ADR #45 §4.2 documented a four-handler change there being attempted and reverted.
It is not the place to add a panel.

**The existing differ does not do this job.** `planTopologyDiff(nodes,
workspaceInstances)` and `computeTopologyDiff` compare *canvas against live
backend instances*. Revision comparison is *graph against graph*. A new pure
function is required; it is small, but it is not reuse.

---

## Non-goals

- Re-Apply / automatic rollback (§5)
- Topology synchronisation, in any form (§8)
- Per-node or per-wire history — revisions are whole-graph
- Branch-to-branch comparison, which already exists
- Retention as a subscription entitlement or plan gate
- Editing a past revision in place; revisions are immutable
- A staging/environment model — there is one live graph per branch

---

## Consequences

**Positive**

- The roadmap's "store revision history and support rollback to the last valid
  revision" is satisfied without touching Apply's semantics.
- Phase 1 is purely additive: one migration, one INSERT in a transaction that
  already exists, one read command. No behaviour change for anyone who never
  opens the panel.
- "Who changed this and why" becomes answerable, which today it is not.
- Restore inherits every guarantee Apply already has — contract gate, validation,
  journal, compensation — because it *is* Apply.
- Deflation makes the retention rule nearly free, so the honest answer
  ("keep the record, bound the snapshots") stops costing more than the dishonest
  one.

**Trade-offs & mitigations**

| Trade-off | Mitigation |
|---|---|
| History is device-local; a reinstall loses it | Stated in §8, not hidden. Sync is a separate decision. |
| A new table means a new migration | The Postgres schema is *generated* from the SQLite registry by `scripts/generate-pg-migration.py`; one `.sql` file plus a generator run, and `--check` already runs in CI and the pre-commit hook. |
| `diagram = NULL` rows are a state the reader must handle | Every read path that restores must check for NULL and say "record only — snapshot pruned." One test per surface. |
| Revision count grows with a `UNIQUE (branch_id, revision)` | Matches `memo_revisions`. Pruning is by branch, so growth is bounded by §4. |
| Change note adds a field to Apply | Optional, empty by default, no migration of existing rows needed. |
| 20 is a guess | It is a constant in one place, and deflation means changing it later is a sweep, not a migration. |

---

## Rollout

**Phase 1 — history only.** Migration, the transactional INSERT, `cleanup_old_topology_revisions`,
the change-note field, and the `log_audit` call. No UI beyond nothing at all.
Ships value on its own (the record exists) and carries no restore risk.

**Phase 2 — browse, diff, restore-to-draft.** The overlay module, the new
graph↔graph differ, pin/unpin, and the pruned-snapshot messaging.

**Phase 3 — re-Apply rollback.** Only on evidence that Phase 2 is insufficient,
as its own ADR.

Phases 1 and 2 are independently shippable and independently revertible.

---

## Verification

- **Migration** — `20260915_topology_revisions.sql`, registered in
  `crates/oz-core/src/migrations.rs` (registry order is canonical, not filename
  order); `generate-pg-migration.py --check` clean; migration column-type lint clean.
- **Atomicity** — a test forcing Apply compensation asserts no revision row
  survives; a test crashing after commit asserts one does not go missing.
- **Concurrency** — two simultaneous Applies produce two consecutive revisions
  with no gap and no duplicate, under the existing IMMEDIATE lock.
- **Retention** — 25 Applies leave 20 with payloads and 5 deflated; a pinned row
  outside the window survives intact.
- **Restore** — restoring a revision and pressing Apply yields revision N+1, not
  a rewrite of N.
- **Schema drift** — a pre-v2 revision renders with its reason and cannot be
  restored.
- **Tenancy** — every INSERT stamps `tenant_id`; the generator's uncovered-table
  comment lists `topology_revisions` rather than failing.

---

## Related decisions

- [ADR #22: Visual Node-Based Store & Workspace Topology Builder](./2026-07-20-node-based-store-topology-builder.md)
- [ADR #34: Topology Editor as the Business Logic Builder](./2026-08-07-business-logic-topology-builder.md) — its "explicit publish boundary" is §5 here
- [ADR #44: Typed Connection Gating & Live Validation](./2026-08-08-adr34-typed-connection-gating.md)
- [ADR #45: Topology Semantic Contract v2](./2026-09-02-adr45-topology-semantic-contract-v2.md) — §4.1 cold start is the philosophy this history serves; §4.2's device-portability critique is §8's stated limit
- [ADR #41: App Lifecycle, Device Onboarding, Dynamic Topology Workspaces](./2026-08-28-adr41-app-lifecycle-device-onboarding-topology-home-gating.md)
