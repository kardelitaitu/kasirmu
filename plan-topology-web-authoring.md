# plan-topology-web-authoring.md — centralise topology authoring on the web

**Status (2026-10-03): PROPOSED, REVISED. Not started. Phase 0 is blocking — no code in Phases 1-5
may begin until it closes.**

| | |
|---|---|
| Token | `plan-` — `done-` is earned only when §8's acceptance commands have RUN **and PASSED** (AGENTS.md §7.4) |
| Author | Budak Korporat |
| Branch | `0.0.41` |
| Builds on | **ADR #46** (revision history, Phase 1 complete), ADR #22 (topology builder, Implemented), ADR #6 (CRDT delta ledger, Implemented), ADR #21 (conflict resolution, Phase 1), ADR #4/#7 (scoped sessions), SaaS-3 (orgs) |
| Supersedes | nothing — ADR #22 stays as the editor's specification |

---

### Revision note (2026-10-03) — read this before trusting anything below

The first draft of this plan was committed as `011c3fdf6` and was **wrong in ways that mattered**,
because it was written without finding **ADR #46**
(`docs/decisions/2026-09-07-adr46-topology-revision-history-and-restore.md`). That ADR is the single
most relevant record to this question and the draft cited only #22, #6 and #21. Reviewing against it
produced seven findings; four changed the plan's shape:

| # | Draft said | Reality | Where fixed |
|---|---|---|---|
| F1 | revisions ride "the existing sync transport" | ADR #46: *"Topology is not synchronised anywhere"* — no transport exists | §3, Phase 3 |
| F2 | key revisions by `tenant_id` + `org_id`, monotonic per tenant | the log is keyed `(branch_id, revision)`; ownership is **per-location** | §3, Phase 1 |
| F3 | Phase 1 creates/extends a revision log with `parent_revision` | the log already exists; `base_revision` optimistic concurrency is already implemented | Phase 1, I4 |
| F5 | "route topology through the audit module" | apply writes **no** audit record; ADR #46 §6 is what closes it | §4.5 |

Also corrected: F4 (an internal inconsistency about the PG topology tables), F6 (the two-writer
problem was deferred to Phase 6 but Phase 3 depends on its answer — moved to Phase 0), F7 (the
acceptance command set). Full basis in §10.

**The practical consequence is cost.** The draft treated replication as existing plumbing. It is not.
Phase 3 is now the largest item in this plan and is scoped as such.

---

## 0. Scope card

| | |
|---|---|
| **Goal** | One place to author store topology for a multi-store tenant, without making a till depend on the network. |
| **Not the goal** | Making the cloud the runtime source of truth (rejected, §1). Moving sales, stock or money data. Rewriting the canvas editor. |
| **Why now** | The `settings/topology` route on the tablet lands on `settings-screen-placeholder` ("Halaman ini sedang dibangun ulang", `shared-ui/locales/settings.id.ftl:69`). The surface is already being rebuilt — build it on the intended seam rather than rebuilding it locally and moving it. |
| **Hard constraint** | The terminal's SQLite file is the system of record. A till must open, sell and print with the cloud unreachable. |
| **Largest single cost** | Phase 3 — the replication path, which does not exist today. |

---

## 1. The decision that gates everything: who is authoritative

Two models. They look similar and are not.

**A. Cloud as source of truth (REJECTED).** The web writes topology; terminals read it live. Breaks
the offline-first invariant, and moves the blast radius of one bad edit from one terminal to every
till a tenant owns simultaneously.

**B. Cloud authors; terminal is authoritative at runtime (RECOMMENDED).** The web produces a
*desired-state* document. The server validates it, produces a plan, signs it as a revision. Terminals
pull revisions, verify, and apply them in one local transaction — or reject and keep the last known
good. Boot never waits on the network.

The atomicity argument for B is corroborated twice. ADR #22 Amendment 1 §B gets it from
`apply_topology_diff` running every write in one `conn.transaction()`. ADR #46 §Context states it
independently and more precisely: `save_topology_json_at_key_with_revision`
(`persistence.rs:247`) opens one `TransactionBehavior::Immediate` transaction that writes the graph
envelope, the compiled runtime plan and the request ledger, clears the recovery journal, and commits.
Split that across a network and the guarantee is gone.

If the owner rules A instead, this plan is void from §3.

---

## 2. Why topology must not be synced as a CRDT

ADR #6 is implemented and is the right model for *inventory*: append-only immutable deltas
(`stock_movements` `+5` / `-2`) that sum deterministically. Topology is not that. It is constrained
configuration:

- A wire must reference nodes that exist. A dangling endpoint is not a value to merge; it is invalid.
- `type_key` on `workspace_instances` is **immutable** by backend contract. A type change is
  archive + recreate, not an update (ADR #22 Amendment 1 §A and §G).
- Stock-deduction fallback wires carry **ordering** (Priority 1, Priority 2). Ordering is not
  commutative.

Merging two concurrent topology edits with a CRDT can produce a graph that is individually
well-formed and globally invalid. So topology gets **declarative desired-state with plan/apply** —
the Terraform/Git model. This is not a new idea in this repo: ADR #46 quotes the roadmap asking for
exactly it — *"Treat topology edits as a draft revision. Apply should require validation, a
human-readable diff, optimistic concurrency protection, and an explicit publish boundary. Store
revision history and support rollback to the last valid revision."* Of those five, ADR #46 records
three as done (validation, diff via `computeTopologyDiff`, optimistic concurrency) and **two as
outstanding: the publish boundary and revision history**. This plan is the publish boundary. Cite
that lineage rather than treating the idea as new.

---

## 3. Architecture

```
Web editor (tenant + org + location scoped, owner/admin)
   │  desired-state document
   ▼
Server: validate ──► plan (created / updated / archived / type-changed)
   │                    │
   │                    └─► reject on validation failure, never partially apply
   ▼
Signed revision — keyed (branch_id, revision), carrying tenant + org as ownership metadata
   │  Phase 3: a replication path that DOES NOT EXIST TODAY and must be built
   ▼
Terminal: verify signature ──► validate locally ──► apply in ONE transaction
   │                                                  │
   │                                                  └─► on failure: roll back, keep last known good
   ▼
Terminal SQLite ── system of record at runtime; boots with no network
```

### 3.1 The replication path does not exist

ADR #46 §Context, as a measured finding: *"Topology is not synchronised anywhere."* Absent from
`offline_queue` (which carries only `complete_sale` / `void_sale`), absent from `lan_server.rs`, and
zero references in `apps/cloud-server`. The graph is local state.

Re-verified 2026-10-03: the only `topolog` hits under `apps/cloud-server/src` are four, and three of
those are the phrase *"FK-topological"* inside the `migrate_sqlite_to_pg` tool — a wording
coincidence, not topology data.

So Phase 3 is **not** "pull and apply over the existing transport". It is designing and building
topology replication: transport, authentication of the terminal to the server, watermark tracking,
idempotent delivery, and the failure/rollback semantics below. Budget it accordingly.

### 3.2 Ownership granularity — the correction that matters most

The existing revision log is keyed `(branch_id, revision)`, and ADR #46 records the roadmap placing
"topology edges and graph revisions" under **per-location** ownership, keyed like
`oz-pos/topology/{branch_id}`. The draft proposed keying revisions by `tenant_id` with a monotonic
per-tenant sequence. That is a schema fork.

Resolution: **keep `branch_id` as the merge domain; add tenant and org as the authorization domain.**
Revisions stay `(branch_id, revision)`. `tenant_id` and `org_id` are added as ownership metadata used
for authorization and containment, never as a replacement for the branch key. The branch is where
concurrent edits are arbitrated; tenant and org decide who may edit at all.

### 3.3 Invariants

1. **I1 — Offline boot.** A terminal with no network opens, sells and prints on its last applied
   revision. Measured today: the tablet renders and runs with the cloud unreachable.
2. **I2 — Atomic apply.** Revision apply is one transaction, envelope and relational rows together
   (ADR #22 Amendment 1 §B.1-2; ADR #46 §Context). No orphaned diagram, no partial create.
3. **I3 — Reject, never half-apply.** A revision failing local validation is discarded whole; the
   previous revision stays live.
4. **I4 — Optimistic concurrency, already implemented — reuse it.** `base_revision` mismatch already
   raises `topology-revision-conflict`, and `persistence.rs:265-272` records a fixed lost-update
   TOCTOU. The draft's `parent_revision` linked list is wrong: the model is a per-branch counter
   advanced only when the presented base matches. Do not rebuild this.
5. **I5 — Tenant containment.** No request reads or writes topology across a tenant boundary, ever.

---

## 4. Security plan — this is the gate, not a phase

### 4.1 Tenant isolation audit (blocking, Phase 0)

`tenant_id` exists in the cloud server — measured at `apps/cloud-server/src/conflict_resolution.rs:41`,
`:359`, `:370` and `apps/cloud-server/src/email_pg/analytics.rs:69-101`. That is a **spot check, not
proof of isolation**. Before any topology endpoint ships, enumerate every query the new surface
touches and assert each filters on `tenant_id` **and** the org scope from SaaS-3. One missing
`WHERE` clause means one merchant reading another's store layout, warehouse list and printer
bindings.

Deliverable: a table of endpoint → query → tenant predicate, plus a failing test for each (§7 T1).
Do not rely on review; make it a test.

### 4.2 Authorization

Today the editor is reachable only from a device holding a session token scoped by store and instance
(ADR #4/#7). A web surface is a second, weaker perimeter. Required:

- Role gate to owner/admin. Topology controls stock routing and receipt/KDS routing, so it is a
  money-adjacent surface and must not be manager-reachable.
- Org **and** location scope on every call (§3.2), not inferred from the session alone.
- Re-authentication (PIN or step-up) for publish, distinct from editing.

### 4.3 Origin, CSRF, CORS

A new browser origin brings CSRF and CORS. This repo already treats origins as a known pain point
(`ozpos-web-origin-allowlist-diagnosis` skill exists for exactly this). Publish must be
same-origin-with-CSRF-token at minimum; do not widen the allowlist to make the editor work.

### 4.4 Signed artifacts

Revisions are signed server-side; terminals verify before apply. This is what makes "pull from the
cloud" safe on a device that cannot fully trust its transport. Unsigned revisions are refused.

### 4.5 Audit — already-planned work, not existing infrastructure

Corrected from the draft. ADR #46 states plainly: *"Apply writes no audit record."* `log_audit`
exists and topology does not call it; ADR #46 §6 is the work that closes it. This plan therefore
**depends on ADR #46 §6 landing**, and Phase 0 must confirm it has. Every publish then records
actor, tenant, org, branch, base revision and the plan summary.

### 4.6 Quota

`QuotaDimension::TopologyNodes` already exists (`crates/kasirmu-core/src/db/quota_gate.rs:34`,
`:101-107`, `:153-156`) and is documented as read-computed, never persisted. Enforcement stays
server-side, as ADR #22 §5 already requires via `TenantSubscription`.

---

## 5. Phases

### Phase 0 — Decisions and audit (blocking)

- [ ] Owner rules on §1: model B (recommended) or model A (plan void from §3).
- [ ] **Owner rules on the local editor.** Recommended: when web authoring is enabled for a tenant,
      the local editor becomes **read-only**, which removes the two-writer problem at the root. The
      alternative — locally-originated revisions on a side branch requiring explicit rebase — is
      materially more work and is the option only if an offline escape hatch is a hard requirement.
      This must be decided here, not in Phase 6: Phase 3 cannot be designed without the answer.
- [ ] ADR drafted recording the authority model, the signed-revision contract, §3.2 granularity and
      I1-I5.
- [ ] §4.1 tenant isolation audit complete, expressed as tests.
- [ ] ADR #46 §6 (audit on apply) confirmed landed, per §4.5.
- [ ] Replication path design reviewed — see §3.1; this is the largest item and needs its own estimate.

**Exit gate:** ADR committed; every §7 T1 test fails-then-passes; audit work confirmed.

### Phase 1 — Extend the existing revision log (not create one)

`topology_revisions` already exists (`crates/kasirmu-core/migrations/20260915_topology_revisions.sql`)
with `id`, `branch_id`, `revision`, `change_note`, a self-contained envelope, DEFLATE support and
immutable revisions. `set_topology_revision_pinned` is at
`crates/kasirmu-bridge/src/topology/revisions.rs:364`.

- [ ] Add `tenant_id`, `org_id`, `actor`, `signature` as **metadata** — not as a new key (§3.2).
- [ ] Give the table a Postgres twin. Today the migration has **no** `.pg.sql` counterpart, so the
      revision history is local-only; the server cannot hold canonical history without it.
- [ ] Generate the PG migration with `python3 scripts/generate-pg-migration.py` (house rule).

### Phase 2 — Server plan/apply

- [ ] Validate desired-state: node existence, wire endpoints, quota, tier gates, `type_key`
      immutability (archive + recreate path).
- [ ] Emit a plan of creates / updates / archives / type-changes — the deferred
      `TopologyDiffModal` payload, computed server-side. `computeTopologyDiff` already exists and
      should be reused rather than reimplemented.
- [ ] Sign and append the revision against `(branch_id, revision)`, honouring the existing
      `base_revision` conflict check (I4). **No cloud-side writes to terminal tables in this phase.**

### Phase 3 — Build the replication path, then pull and apply

The largest phase. Nothing here exists today (§3.1).

- [ ] Transport: how a terminal authenticates to the server and fetches revisions since its watermark.
- [ ] Idempotent, ordered delivery per branch; replay and out-of-order are no-ops (I4).
- [ ] Pull → verify signature → validate locally → apply in one transaction, reusing
      `apply_topology_diff` semantics (ADR #22 Amendment 1 §B; also present at
      `apps/desktop-tauri/src/commands/topology/commands.rs:212` and
      `crates/kasirmu-bridge/src/topology/commands.rs:417`).
- [ ] On any failure: roll back, keep last known good, surface it. Never half-apply (I3).
- [ ] Network-optional by construction: absence of the server is a normal state, not an error (I1).

### Phase 4 — Web editor

- [ ] Build on the `settings/topology` seam, not a new route.
- [ ] Reuse the canvas decomposition under `ui/src/features/locations/` (`NodeTopologyEditor.tsx`
      plus ~20 extracted modules — ADR #22's own audit stamp records the decomposition).
- [ ] Plan preview before publish; publish requires step-up auth (§4.2).

### Phase 5 — Rollout

- [ ] Shadow mode: web produces plans, terminals do not apply. Compare against what the local editor
      would have produced.
- [ ] Single willing tenant, then staged.
- [ ] Kill switch: disable web publish without a terminal update.

### Phase 6 — Execute the local-editor decision

Not a decision point any more — Phase 0 decided it. This phase carries it out: flip the local editor
to read-only per tenant, or ship the rebase path.

---

## 6. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| Replication is greenfield | ADR #46: topology is synced nowhere; the draft assumed otherwise | Phase 3 scoped as the largest item; Phase 0 reviews its design |
| Bad revision bricks tills | Topology decides stock routing and print routing | I2/I3, signed revisions, staged rollout, kill switch |
| Cross-tenant leak | Highest severity; config reveals layout and devices | §4.1 audit as tests, not review |
| Two writers diverge | Terminal and web both mutate topology | Resolved in Phase 0, not deferred |
| Granularity fork | Tenant keying vs the existing `(branch_id, revision)` | §3.2: branch is the merge domain, tenant/org the authz domain |
| Network on the boot path | Contradicts offline-first | I1 enforced by an explicit offline test |
| Scope creep into sync rewrite | Tempting; ADR #6 already covers inventory | This plan adds no CRDT; it builds a config replication path |

---

## 7. Tests that must exist

| ID | Test | Asserts |
|---|---|---|
| T1 | Cross-tenant topology read/write | Fails; tenant B cannot see or change tenant A's topology. One per endpoint. |
| T2 | Offline boot | Terminal with no network opens and completes a sale on its last revision (I1) |
| T3 | Atomic apply | A revision that fails mid-apply leaves zero partial state (I2) |
| T4 | Bad revision rejection | Malformed or unsigned revision is refused; previous revision still live (I3) |
| T5 | Replay / out-of-order | Duplicate and out-of-order revisions are ignored idempotently (I4) |
| T6 | Type change | `type_key` change goes through archive + recreate, never an UPDATE (ADR #22 §A/§G) |
| T7 | Local parity | Web-published revision and local `apply_topology_diff` produce identical final state |
| T8 | Branch concurrency | Two publishes against the same `branch_id`; the second either rebases or raises `topology-revision-conflict` — never silently wins |
| T9 | Location containment | A location-scoped session cannot read or edit another location's branch (§3.2) |

---

## 8. Acceptance

The file keeps the `plan-` token until all of these have run and passed:

```bash
cd /c/dev/kasirmu/ui && npm run typecheck && npm run lint
cd /c/dev/kasirmu/ui && npm test -- --run src/__tests__/<new topology web tests>
cd /c/dev/kasirmu && cargo test -p kasirmu-bridge topology
cd /c/dev/kasirmu && python3 scripts/generate-pg-migration.py --check
cd /c/dev/kasirmu && bash scripts/check.sh
```

Corrected from the draft: the second command names the new test files rather than sweeping
`src/__tests__/`, which would run the entire UI suite. `kasirmu-bridge` is confirmed as the package
name (`crates/kasirmu-bridge/Cargo.toml`), and `--check` is confirmed for the PG generator
(`scripts/generate-pg-migration.py:63`).

Plus one manual gate no command substitutes for: **T2, on the tablet, with the network genuinely
off** — a till that opens and sells is the whole point.

Rename to `done-` only then (AGENTS.md §7.4).

---

## 9. Open questions for the owner

1. §1 — model B or model A?
2. **Local editor: read-only when web authoring is on, or retained with a rebase path?** Blocks Phase 3.
3. Is the web editor for multi-store tenants only? Single-store tenants get little from
   centralisation and carry all the risk.
4. Who signs revisions — the sync server, or a separate key rotated out of band?
5. Does publish need MFA, or is PIN step-up enough for v1?
6. Confirm the branch↔location mapping: is `branch_id` exactly a location, or a sub-unit of one?

---

## 10. Measured basis

Every claim was read out of the tree or off the device; dates given per item.

**Read 2026-10-02 (branch `0.0.41`):**
- ADR #22 *Implemented (2026-07-22) — Amended (2026-07-23)*; atomic commit via `apply_topology_diff`
  in one transaction; `type_key` immutable; diff modal deferred.
- ADR #6 *Implemented (2026-07-15)* — append-only inventory delta ledger. Not applicable to config.
- ADR #21 *Approved — Phase 1 implemented*.
- `QuotaDimension::TopologyNodes` at `crates/kasirmu-core/src/db/quota_gate.rs:34`, `:101-107`,
  `:153-156`.
- `settings/topology` resolves to `settings-screen-placeholder`
  (`shared-ui/locales/settings.id.ftl:69`).
- No web topology surface; `website/src/pages/` is marketing, account, pricing and pair.
- Tablet: home renders 17 tool cards after the WorkspaceHome fix (`b5d9ea83a`); tapping Add Workspace
  reaches the placeholder.

**Read 2026-10-03 during review — the corrections:**
- ADR #46 *Accepted — phased; Phase 1 complete (racing-publishes gate `9b9a1d8a`; change-note
  `8ce2c805`; immutable revision `313157be`; deflate `93e519cd`); Phase 2 in progress (graph differ
  `51ad987f`)*.
- ADR #46 §Context: *"Topology is not synchronised anywhere"* — absent from `offline_queue`,
  `lan_server.rs`, and `apps/cloud-server`; and *"Apply writes no audit record."*
- `topology_revisions` schema confirmed at `20260813_init.pg.sql:1863` and
  `20260915_topology_revisions.sql:22` — `id`, `branch_id`, `revision`, `change_note`; the 20260915
  migration has **no** `.pg.sql` twin.
- `set_topology_revision_pinned` at `crates/kasirmu-bridge/src/topology/revisions.rs:364`;
  `branch_id` is `""` for the default branch (`revisions.rs:174`).
- `apply_topology_diff` at `apps/desktop-tauri/src/commands/topology/commands.rs:212` and
  `crates/kasirmu-bridge/src/topology/commands.rs:417`.
- `topolog` under `apps/cloud-server/src`: 4 hits, 3 of them the phrase "FK-topological".

**Corrected from the draft.** The draft cited the presence of topology tables in
`20260813_init.pg.sql` as evidence of cloud readiness. That was misleading: the table exists, and no
runtime code in `apps/cloud-server` touches it. §3.1 now carries the corrected reading.

**Not verified, and flagged as such:** the exact `branch_id` ↔ location mapping (§9 Q6); whether the
mobile Tauri app carries the same topology persistence as desktop (only desktop paths were read);
and that every cloud-server query is tenant-filtered — which is precisely what Phase 0 establishes.

**Stale references found, both worth a `docs(decisions)` chore:**
- ADR #22 Amendment 1 §B cites `apps/desktop-client/src/commands/topology.rs`. There is no
  `apps/desktop-client`; the command lives under `apps/desktop-tauri/src/commands/topology/`.
- ADR #46 cites `todo-global-saas-1.md:252-256` and `:186`. That file no longer exists, so the
  roadmap obligation ADR #46 quotes cannot currently be checked at source.
