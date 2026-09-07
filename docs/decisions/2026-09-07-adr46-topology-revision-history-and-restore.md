---
num: 46
area: topology
title: ADR #46: Topology Revision History, Change Notes, and Draft Restore
status: Accepted — phased; Phase 1 complete (racing-publishes gate met per 9b9a1d8a; change-note 8ce2c805, immutable revision 313157be, deflate 93e519cd), Phase 2 in progress (graph differ 51ad987f)
---
# ADR #46: Topology Revision History, Change Notes, and Draft Restore

**Status:** Accepted — phased; Phase 1 complete (racing-publishes gate met per 9b9a1d8a; change-note 8ce2c805, immutable revision 313157be, deflate 93e519cd), Phase 2 in progress (graph differ 51ad987f)
**Date:** 2026-09-07
**Reviewed & accepted:** 2026-09-07, sole-maintainer review. Every code citation in this document was verified against the working tree before acceptance: `save_topology_json_at_key_with_revision` at `persistence.rs:247`, `cleanup_old_kds_orders(30)` at `lib.rs:394`, `log_audit` at `audit.rs:125`, `NodeTopologyEditor.tsx` at 6,146 lines, `topologyBranchCompare.ts` at 488 lines, and no pre-existing `topology_revisions` table. Two known topology debts were reviewed and deliberately parked, not attached to this ADR: the localStorage templates in `topologyExport.ts` (criticised by ADR #45 §4.2) and the unfinished ADR #45 §4.2/§4.3 UI. Both are recorded as candidates for their own ADRs.
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

For retention, `cleanup_old_kds_orders(30)` is the precedent to copy — it runs
inside the `"kds health monitoring"` daemon (`spawn_daemon` +
`tokio::time::interval(60s)` at `lib.rs:369`, the call at `:394`), and
`20260914_memo_retention.sql` records a ruled 30-day archival window with an
`archived_at` anchor.

*(Corrected during step 1b. An earlier draft of this section cited the 300s
loop at `lib.rs:316` as the host. That loop is a different daemon — `"session
cleanup"`, sweeping expired in-memory sessions, with no database handle at all.
The two were conflated. See §4 for why this matters beyond the line number.)*

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
    contract_schema_version BIGINT NOT NULL,
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

**A pin is additive, not a substitution** (settled in 1c, which §4 left open).
Pinned rows are excluded from the ranking entirely, so pinning one does NOT
consume a slot from the `keep` budget: 20 unpinned plus 3 pinned keeps 23
restorable. The alternative — pins competing for the budget — would mean a
merchant could *lose* a restorable revision by pinning something, which is
self-defeating for the feature that exists to protect known-good deploys.

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

The sweep runs as `cleanup_old_topology_revisions(20)` on a background interval,
mirroring `cleanup_old_kds_orders(30)`. Startup-only pruning is wrong for a
desktop app that may run for weeks.

**But it is not a drop-in, and step 1c must not treat it as one.** The KDS
precedent iterates `db_manager.open_store_ids()` and prunes a PER-STORE
database. `topology_revisions` lives in the GLOBAL database and is keyed by
`branch_id`, not `store_id`. So the loop body differs in what it enumerates,
and neither existing daemon fits as written:

| Daemon | Cadence | Why it is not simply reused |
|---|---|---|
| `"session cleanup"` (`lib.rs:316`) | 300s | Right cadence for a config table, but holds only the in-memory `session_store` — no DB handle. |
| `"kds health monitoring"` (`lib.rs:369`) | 60s | Has DB handles, but per-store; and 60s is far more often than a table pruned a few times a month needs. |

Step 1c chooses between a third daemon and extending one of these, and that
choice is a decision about daemon sprawl in `spawn_daemon`, not a detail.

**Resolved by 1c: a third daemon, shaped like the memo sweep.** The table above
was still incomplete — it omitted a third loop, `"memo expiry sweep"`
(`lib.rs:418`), which is the one whose *shape* fits: it holds
`app.state::<AppState>().db.clone()` (the global handle this table needs) and
runs at 300s. It is also literally the memo retention precedent §4 already
cites, so the two retention sweeps now look alike instead of inventing a third
convention.

It is not reused as a *host*, because the repo's established pattern is one
daemon per concern — there are already thirteen, including separate `session
cleanup`, `prune daemon`, and `kds health monitoring` loops. Folding topology
pruning into a daemon named for memos would make the sweep's owner unfindable
from its name, which is a worse price than a fourteenth `spawn_daemon` call.
`"topology revision retention"` it is.

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
history, so this is not strictly required — but `audit_log` is what the audit
screen reads, and topology currently has no answer to "who changed production"
at all.

Both records are kept because they live in different databases and serve
different readers: `audit_log` is **per-store** (`resolve_scope` →
`open_store`), while `topology_revisions` is in the **global** database keyed by
branch. The audit row goes to the *effective* store's database — the branch
whose graph changed — so an operator browsing that branch finds the change
without knowing the revision table exists.

Two findings from reading `db/audit.rs` before writing this, both now pinned by
tests rather than left as assumptions:

- **Redaction matches key NAMES, never values.** `SENSITIVE_DETAIL_KEYS`
  (`audit.rs:16-37`) is compared with `eq_ignore_ascii_case` against JSON keys.
  The list contains `pin`, and topology has PIN-pad hardware nodes — so a
  future detail key named `pin` would be silently blanked forever.
  `no_audit_detail_key_collides_with_the_redaction_list` asserts every key in
  the payload survives, which turns that from a trap into a failing test.
- **A free-text change note is therefore NOT protected.** A merchant who types
  "reset the back register's password to hunter2" has it stored verbatim,
  because `change_note` is not a sensitive key name. §6 accepts this: the note
  exists so history is readable, and it is written by staff who can already see
  what they describe. Truncation to `MAX_DETAIL_LEN` still applies.

One correction to this section as first written: it claimed audit holds
"retention" machinery. **It does not.** There is no purge or retention sweep
for `audit_log` anywhere in the crate — `MAX_AUDIT_EXPORT_ROWS` bounds an
export, not the table. That is a pre-existing gap, unrelated to this ADR, and
not fixed here (Rule 3); it is recorded because §4's "keep the metadata row
forever" argument is stronger than it looked if audit rows already accumulate
without bound.

### 7. Old revisions are shown, never migrated

`contract_schema_version` is stored per revision — the CONTRACT axis, not the
envelope axis, which `model.rs:273-285` warns must never be conflated with it.
ADR #45 moved the contract from 1 to 2,
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

Landed as `topologyRevisionDiff.ts::diffTopologyGraphs` — 25 tests, importing
nothing from `NodeTopologyEditor.tsx` (not even a type), so it cannot drag the
forbidden component into its dependency graph.

§10 did not anticipate the one design decision that actually determines
whether the browser is usable: **which fields count as a change.** Stored
envelopes mix three kinds, and treating them alike produces a history nobody
reads:

| Class | Fields | Treatment |
|---|---|---|
| **Semantic** | node `type`/`name`/`subtitle`/`store_profile_id`/`tier_requirement`/`metadata`; wire endpoints, `direction`, `relationship_type`, `*_port_id`, `label` | Listed field by field, with from/to |
| **Geometry** | node `x`/`y`; wire `bends`, `from_port`, `to_port` | **Counted, never listed** |
| **Volatile** | `telemetry_status`, `telemetry_badge` | **Excluded entirely** |

Geometry is counted because dragging three nodes is not three business
changes; itemising it buries the one rename that mattered. The repo already
draws this exact line — `TopologyWireData` documents `from_port_id` as the
"semantic source port" while `from_port` is "geometry [that] remains
presentation-only".

Volatile fields are excluded rather than counted, which is the sharper call.
`telemetry_*` is persisted by `buildDiagramPayloads`, so a terminal that went
offline between two Applies would otherwise appear as a change nobody made.
Counting it would be nearly as misleading as listing it: it would tell the
merchant the graphs differed when the business logic did not.

Two smaller rules, each pinned by a test: metadata is compared with
order-insensitive deep equality, because the payload is re-serialised every
Apply and key order would otherwise read as an edit; and an unrecognised field
is ignored rather than guessed at, because guessing wrong in the noisy
direction is what makes history unreadable.

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

### Phase 1 status, and one rule conflict to adjudicate

Recorded per Rule 6 (parked items get a paper trail, not a branch).

**Phase 1 IS NOW COMPLETE (1a–1e), including 1e's input control.** The
change-note textarea landed with the extraction that the waiver below
authorised, so the conflict it describes no longer exists — see
§"The waiver, executed". `change_note` is accepted over IPC, validated,
trimmed, stored on the revision row, written to the audit record, AND typed by
a real control in the Apply dialog.

1e's UI half is blocked by two rules that jointly forbid it:

- **Rule 5** forbids adding state to `NodeTopologyEditor.tsx`. The Apply
  confirmation dialog lives *inside* it — six hooks at `:914-927`
  (`applyConfirmOpen`, `applyConfirmData`, `applyPin`, `applyPinError`,
  `applyPinVerifying`, `applyPinRef`) and ~150 lines of inline JSX from `:5957`.
  A note field needs one more piece of state and one more input there.
- **Rule 3** forbids the refactor that would make that legal — extracting the
  dialog so the field is added to a new module instead.

The options, in the order I would take them:

1. **Extract `TopologyApplyConfirm.tsx`, then add the field there.** The dialog
   already has its own `topology-apply-confirm-*` CSS namespace, its own
   6-hook state cluster, and a clean boundary — it is a natural seam. This
   *removes* ~150 lines and 6 hooks from the component, which is the opposite
   of what Rule 5 exists to prevent, so Rule 5 arguably does not apply to it;
   Rule 3 does, and would need an explicit waiver.
2. **Ship Phase 1 with the field unwired.** The history still records who and
   when; the note column waits for Phase 2, where §10 already requires new UI
   to be its own module.
3. **Add the field in place**, accepting the Rule 5 breach for a text input.

Recommendation: **(1)**, as a separately-labelled step with its own commit,
because a change note that nobody can type is the least valuable half of §6 and
the seam is genuinely clean. But Rule 3 is the document author's to waive, not
the implementer's to reinterpret.

> **✅ ADJUDICATED 2026-09-07, sole maintainer: option 1 granted.** The Rule 3
> waiver is explicit and one-time — extract `TopologyApplyConfirm.tsx` (own
> module, the `topology-apply-confirm-*` CSS namespace moves with it, the 6-hook
> cluster relocates unchanged), then add the change-note input there, as a
> separately-labelled step with its own commit. The extraction must net-remove
> the dialog's JSX and state from `NodeTopologyEditor.tsx` — growing the editor
> while holding the waiver voids it. Rules 3 and 5 otherwise stand as written.

### Phase 2 status

Landed so far: the **graph↔graph differ** (§10, `topologyRevisionDiff.ts`,
25 tests), the **read path** (`list_topology_revisions`,
`load_topology_revision`), **pin/unpin** (`pin_topology_revision`), and the **overlay/browser module** (`TopologyRevisionBrowser.tsx` + `canViewTopologyHistory` read gate — a385440a).

Pin deserves its own note, because Phase 1 left §4's central protection
*inert*. The deflation logic honoured `pinned` and was tested — by setting the
column with raw SQL. Nothing in production could ever set it, so "a known-good
graph stays restorable however busy the branch gets after it" described a
guarantee no merchant could actually claim. Wiring the command is what makes
§4 real rather than merely correct in principle.

Remaining: restore-to-draft and the pruned-snapshot messaging (the overlay/browser module landed in a385440a).

### The Phase-1 gate, closed (supervisor ratification, 2026-09-07)

The R36 directive made Phase-1 closure conditional on a concurrency
Verification test; Round 109 withheld the declaration while that test was
absent. It now exists — supervisor-authored in `topology_stress_tests.rs`
and committed as `d8ffa281` ("test(topology): pin racing publishes under
the ADR #46 Phase-1 gate"):

- `racing_publishes_to_one_branch_yield_two_ordered_revisions` — two
  concurrent publishers, both succeed via Apply's IMMEDIATE transaction
  (the blocked writer re-reads the fresh revision after the peer commits);
  rows land [1, 2], both change notes present, no gaps. The clobbered-row
  failure mode is asserted impossible.
- `racing_publishes_with_the_same_expected_revision_cas_reject_one` — with
  equal `expected` revisions, CAS admits exactly one; the loser is
  rejected with `topology-revision-conflict`; one row remains.

With this test, every Phase-1 gate condition is met: the extraction
(net-removed), the change-note input (`8ce2c805`), and concurrency
verification (`d8ffa281`). **Phase 1 is RATIFIED complete by the
supervisor.** The overlay/restore-to-draft/pruned-snapshot work listed
above is Phase 2 and no longer blocked by this gate.

### The waiver, executed

`TopologyApplyConfirm.tsx` now owns the dialog: 187 lines of JSX and 268 lines
of CSS moved out, and the editor's `applyPin` / `applyPinError` /
`applyPinVerifying` / `rememberPin` / `applyPinRef` state relocated with it.
`NodeTopologyEditor.tsx` went 6146 → 5963 and its stylesheet 3327 → 3059, so
the move NET-REMOVED as the ruling required rather than merely relocating.

The condition was behaviour preservation, and it was tested rather than
asserted: ten characterization tests were written FIRST, against observable
behaviour rather than file layout, and pass unchanged on both sides of the
move. Two findings came out of doing it that way:

- The dialog closes BEFORE verifying the PIN and re-opens on rejection, so the
  error and the cleared input survive an unmount. A component that unmounted on
  close would silently drop the error. It therefore stays mounted while closed.
- Splitting the stylesheet exposed that the dialog's three animations were
  never reduced-motion gated. `animationCompliance`'s Pattern B exempts a whole
  file that contains any `reduce` block, and the editor's seven had been
  covering them for their entire life.

The change-note input then went in under the same waiver, with the note
traveling dialog → `confirmApply` → `onSave` → `TopologyScreen` →
`topologyApply` → `applyTopologyDiff` → revision row. It is reset on
DISMISSAL, not on open: a re-open after a rejected PIN is indistinguishable
from a fresh open inside the effect, so resetting on open would discard a
paragraph the operator just wrote because they fat-fingered four digits.

### Incident worth recording, because the parallel-work hazard is live

While amending this phase's commit message, `git commit --amend` landed on the
MAINTAINER'S commit instead: they had committed ADR #47 on top in the interval,
so HEAD was no longer mine. The tree was byte-identical and nothing was lost —
only the message was wrong — and it was annotated with `git notes` rather than
a rebase, because they were actively committing (`662e7f3a` landed mid-repair)
and rewriting hashes under them is a worse error than the one being fixed.

The guardrail this establishes: **verify HEAD is the commit you think it is
immediately before any history-rewriting operation**, and prefer additive
annotation over rebase when the maintainer may be working. It is the same
hazard that made `git add -A` unsafe here from the first round; amending is
just the form of it that damages committed work rather than working-tree work.

### Build gate for every phase

No phase begins until the previous one is green. One gate command, run at the
start of a phase's first session:

```bash
cargo test -p oz-pos-app topology    # Rust side, workspace builds clean
```

and, once Phase 2 adds UI, additionally:

```bash
cd ui && npm run typecheck && npm run test
```

If the gate fails, fix or revert before writing any new code. A safety-net
feature must never be built on a red baseline — a green gate is also the
regression reference for the phase's own tests.

### Why Phase 1 first, in one paragraph

Phase 1 is not merely the cheapest slice — it is the slice that protects every
later one. Until revisions are recorded, every Apply irreversibly overwrites the
graph, which makes all topology work (including this feature's own UI phase)
uninsurable. Phase 1 is purely additive, touches no UI, reuses only
already-green machinery (`memo_revisions` shape, the daemon loop, `log_audit`),
and is independently revertible by dropping one table and one insert. It is
therefore the correct first unit of work, ahead of any browse/restore UI.

---

## Solo Implementation Protocol

This project is maintained by a single developer working with LLM assistance.
That combination has a known failure mode: code is generated faster than it can
be understood, and unreviewed surface area accumulates until no one can hold the
system in their head. The following protocol is binding for this ADR's
implementation. It exists so that the safety net this ADR builds is itself
understood by the person who depends on it.

**Rule 1 — Understood slices, not one diff.** Phase 1 lands as five sequential,
independently understandable steps. Each step is one focused session; each ends
with the step's tests passing before the next begins. Never open a second step
in the same session as the first.

| Step | Content | Understanding checkpoint (explain before writing) |
|---|---|---|
| 1a | `crates/oz-core/migrations/20260915_topology_revisions.sql` + registry entry in `crates/oz-core/src/migrations.rs` | Why registry order is canonical and filename order is not; why `generate-pg-migration.py --check` exists and what it compares. |
| 1b | The revision INSERT inside `save_topology_json_at_key_with_revision`'s existing IMMEDIATE transaction, plus the compensation test (§3) | Locate the transaction in `persistence.rs`; explain why inserting before it or after `tx.commit()` each produces a specific wrong history. |
| 1c | `cleanup_old_topology_revisions(20)` + hookup in the existing daemon loop beside `cleanup_old_kds_orders(30)` (`lib.rs:394`) | Explain deflation vs. pruning and why "20 restorable, rest record-only" beats a day window for configuration data. |
| 1d | `log_audit` call on Apply (§6) | Read `audit.rs` retention/redaction notes; state what `SENSITIVE_DETAIL_KEYS` would redact in a topology note. |
| 1e | Optional change-note field threaded from Apply through IPC (§6) | Trace the field's full path: dialog → command → `save_..._with_revision` → row. |

**Rule 2 — Explain before it writes.** In every LLM session, the first output
must be a plain-language explanation of what it is about to change, which
existing code it touches, and why the ADR chose that approach — before any code
is written. If the explanation cannot be given, no code is produced.

**Rule 3 — No additions beyond this document.** Refactors, "while we're here"
improvements, drive-by fixes to neighboring topology debt (localStorage
templates, ADR #45 leftovers), and new abstractions are out of scope. They get
written down as candidate ADRs and left there.

**Rule 4 — No line ships that cannot be explained to a non-author.** At the end
of each step, the implementer re-reads the diff and deletes or rewrites anything
they cannot justify sentence by sentence. The understanding checkpoint in each
step of Rule 1 is the pass condition for the step, equal in standing to its
tests.

**Rule 5 — UI changes stay out of `NodeTopologyEditor.tsx`.** Phase 2's
version browser is a standalone overlay module, per §10. No panel, no hook, no
state is added to the 6,146-line component. If a change seems to require it,
the change is wrong for this ADR.

**Rule 6 — Parked debt gets a paper trail, not a branch.** Anything discovered
mid-implementation that deserves fixing goes into `docs/decisions/README.md`'s
candidate list or a new ADR stub. It is never fixed inside this ADR's commits.

---

## Verification

- **Baseline (before Step 1a)** — `cargo test -p oz-pos-app topology` passes on
  the untouched working tree; the editor launches and one real Apply round-trips
  (validation → diff summary → publish). This is the regression reference every
  later phase is measured against; no phase starts on a red baseline.
- **Migration** — `crates/oz-core/migrations/20260915_topology_revisions.sql`,
  registered in `crates/oz-core/src/migrations.rs` (registry order is canonical, not filename
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
