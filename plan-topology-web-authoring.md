# plan-topology-web-authoring.md — centralise topology authoring on the web

**Status (2026-10-02): PROPOSED. Not started. Phase 0 is a blocking decision plus a security audit —
no code in Phases 1-4 may begin until Phase 0 closes.**

| | |
|---|---|
| Token | `plan-` — `done-` is earned only when §8's acceptance commands have RUN **and PASSED** (AGENTS.md §7.4) |
| Author | Budak Korporat |
| Branch | `0.0.41` |
| Builds on | ADR #22 (topology builder, Implemented), ADR #6 (CRDT delta ledger, Implemented), ADR #21 (conflict resolution, Phase 1), ADR #4/#7 (scoped sessions), SaaS-3 (orgs) |
| Supersedes | nothing — ADR #22 stays as the editor's specification |

---

## 0. Scope card

| | |
|---|---|
| **Goal** | One place to author store topology for a multi-store tenant, without making a till depend on the network. |
| **Not the goal** | Making the cloud the runtime source of truth. Rejected in §1. Moving sales, stock or money data. Rewriting the canvas editor. |
| **Why now** | The `settings/topology` route on the tablet lands on `settings-screen-placeholder` ("Halaman ini sedang dibangun ulang", `shared-ui/locales/settings.id.ftl:69`). The surface is already being rebuilt — build it on the intended seam rather than rebuilding it locally and moving it. |
| **Hard constraint** | The terminal's SQLite file is the system of record. A till must open, sell and print with the cloud unreachable. |

---

## 1. The decision that gates everything: who is authoritative

Two models. They look similar and are not.

**A. Cloud as source of truth (REJECTED).** The web writes topology; terminals read it live.
Breaks the offline-first invariant, and moves the blast radius of one bad edit from one terminal to
every till a tenant owns simultaneously. ADR #22 Amendment 1 §B gets its atomicity from
`apply_topology_diff` running every write inside one `conn.transaction()` on the local file. Split
that across a network and the guarantee is gone.

**B. Cloud authors; terminal is authoritative at runtime (RECOMMENDED).** The web produces a
*desired-state* document. The server validates it, produces a plan, signs it as a numbered revision.
Terminals pull revisions, verify, and apply them in one local transaction — or reject and keep the
last known good. Boot never waits on the network.

§3 onward assumes **B**. If the owner rules A instead, this plan is void from §3 and Phase 0 must
produce a new one; do not partially apply it.

---

## 2. Why topology must not be synced as a CRDT

This is the easy mistake, and it is worth writing down.

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
the Terraform/Git model, not the CRDT model. ADR #22 already specified the front half of this and
deferred it: "TopologyDiffModal … before committing atomically" (Amendment 1 §B.3). This plan moves
that plan/apply to the server, where it can be validated and signed.

---

## 3. Architecture

```
Web editor (tenant + org scoped, owner/admin)
   │  desired-state document
   ▼
Server: validate ──► plan (created / updated / archived / type-changed)
   │                    │
   │                    └─► reject on validation failure, never partially apply
   ▼
Signed revision (numbered, parent_revision, tenant_id, actor, signature)
   │  pulled over the existing sync transport
   ▼
Terminal: verify signature ──► validate locally ──► apply in ONE transaction
   │                                                  │
   │                                                  └─► on failure: roll back, keep last known good
   ▼
Terminal SQLite ── system of record at runtime; boots with no network
```

Invariants, each of which needs a test in §7:

1. **I1 — Offline boot.** A terminal with no network opens, sells and prints on its last applied
   revision. Measured today: the tablet renders and runs with the cloud unreachable.
2. **I2 — Atomic apply.** Revision apply is one `conn.transaction()`, diagram JSON and relational
   rows together (ADR #22 Amendment 1 §B.1-2). No orphaned diagram, no partial create.
3. **I3 — Reject, never half-apply.** A revision that fails local validation is discarded whole and
   the previous revision stays live.
4. **I4 — Monotonic per tenant.** Revisions are numbered; a terminal applies `parent_revision + 1`
   only. Out-of-order or replayed revisions are ignored idempotently.
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

Deliverable: a table of endpoint → query → tenant predicate, plus a failing test for each
(see §7 T1). Do not rely on review; make it a test.

### 4.2 Authorization

Today the editor is reachable only from a device holding a session token scoped by store and
instance (ADR #4/#7). A web surface is a second, weaker perimeter. Required:

- Role gate to owner/admin. Topology controls stock routing and receipt/KDS routing, so it is a
  money-adjacent surface and must not be manager-reachable.
- Org scope carried on every call (SaaS-3), not inferred from the session alone.
- Re-authentication (PIN or step-up) for publish, distinct from editing.

### 4.3 Origin, CSRF, CORS

A new browser origin brings CSRF and CORS. This repo already treats origins as a known pain point
(`ozpos-web-origin-allowlist-diagnosis` skill exists for exactly this). Publish must be
same-origin-with-CSRF-token at minimum; do not widen the allowlist to make the editor work.

### 4.4 Signed artifacts

Revisions are signed server-side; terminals verify before apply. This is what makes "pull from the
cloud" safe on a device that cannot fully trust its transport. Unsigned revisions are refused.

### 4.5 Audit

Every publish records actor, tenant, org, parent revision, and the plan summary. The audit module
already exists; route topology changes through it. This is the record you need when a tenant asks
who rerouted their stock.

### 4.6 Quota

`QuotaDimension::TopologyNodes` already exists (`crates/kasirmu-core/src/db/quota_gate.rs:34`,
`:101-107`, `:153-156`) and is documented as read-computed, never persisted. Enforcement must stay
server-side, as ADR #22 §5 already requires via `TenantSubscription`.

---

## 5. Phases

### Phase 0 — Decision and audit (blocking)

- [ ] Owner rules on §1: model B (recommended) or model A (plan is void from §3).
- [ ] ADR drafted recording the authority model, signed-revision contract and I1-I5.
- [ ] §4.1 tenant isolation audit complete, expressed as tests.
- [ ] §4.1 deliverable table published.

**Exit gate:** the ADR is committed and every §7 T1 test fails-then-passes.

### Phase 1 — Revision log hardening

- [ ] Extend `topology_revisions` (exists: `crates/kasirmu-bridge/src/topology/revisions.rs`) with
  `tenant_id`, `org_id`, `actor`, `parent_revision`, `signature`, monotonic sequence per tenant.
- [ ] `topology_revision_pinned` (already referenced in the topology module) becomes the terminal's
  applied-water mark.
- [ ] PG migration generated with `python3 scripts/generate-pg-migration.py` (house rule for
  migration changes).

### Phase 2 — Server plan/apply

- [ ] Validate desired-state: node existence, wire endpoints, quota, tier gates, `type_key`
  immutability (archive + recreate path).
- [ ] Emit a plan of creates / updates / archives / type-changes — the deferred
  `TopologyDiffModal` payload, computed server-side.
- [ ] Sign and append the revision. **No cloud-side writes to terminal tables in this phase.**

### Phase 3 — Terminal pull and apply

- [ ] Pull revisions since watermark; verify signature; validate locally.
- [ ] Apply in one transaction, reusing `apply_topology_diff` semantics (ADR #22 Amendment 1 §B).
- [ ] On any failure: roll back, keep last known good, surface it. Never half-apply (I3).
- [ ] Idempotent and order-guarded (I4).

### Phase 4 — Web editor

- [ ] Build on the `settings/topology` seam, not a new route.
- [ ] Reuse the canvas decomposition that already exists under `ui/src/features/locations/`
  (`NodeTopologyEditor.tsx` plus ~20 extracted modules — ADR #22's own audit stamp records the
  decomposition).
- [ ] Plan preview before publish; publish requires step-up auth (§4.2).

### Phase 5 — Rollout

- [ ] Shadow mode: web produces plans, terminals do not apply. Compare plans against what the
  local editor would have produced.
- [ ] Single willing tenant, then staged.
- [ ] Kill switch: disable web publish without a terminal update.

### Phase 6 — Only after Phase 5 is clean

- [ ] Decide whether the local editor is deprecated, kept as an offline escape hatch, or kept for
  single-store tenants. Do not decide this early; the answer depends on Phase 5 data.

---

## 6. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| Bad revision bricks tills | Topology decides stock routing and print routing | I2/I3, signed revisions, staged rollout, kill switch |
| Cross-tenant leak | Highest severity; config reveals layout and devices | §4.1 audit as tests, not review |
| Network on the boot path | Contradicts offline-first | I1 enforced by an explicit offline test |
| Two writers diverge | Terminal and web both mutate topology | Terminal writes are the only local writes; web only ever publishes revisions |
| Scope creep into sync rewrite | Tempting, and ADR #6 already covers inventory | This plan adds no CRDT; it reuses the existing transport |

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

---

## 8. Acceptance

The file keeps the `plan-` token until all of these have run and passed:

```bash
cd /c/dev/kasirmu/ui && npm run typecheck && npm run lint        # UI surface
cd /c/dev/kasirmu/ui && npm test -- --run src/__tests__/         # incl. T1, T6, T7
cd /c/dev/kasirmu && cargo test -p kasirmu-bridge topology      # T3, T4, T5
cd /c/dev/kasirmu && python3 scripts/generate-pg-migration.py --check   # schema drift
cd /c/dev/kasirmu && bash scripts/check.sh                       # full gate suite
```

Plus one manual gate that no command substitutes for: **T2, on the tablet, with wireless debugging
and the network genuinely off** — a till that opens and sells is the whole point.

Rename to `done-` only then (AGENTS.md §7.4).

---

## 9. Open questions for the owner

1. §1 — model B or model A?
2. Is the web editor for multi-store tenants only, or all tenants? Single-store tenants get little
   from centralisation and carry all the risk.
3. Does the local editor stay as an offline escape hatch (Phase 6), or is it removed?
4. Who signs revisions — the sync server, or a separate signing key rotated out of band?
5. Does publish need MFA, or is PIN step-up enough for v1?

---

## 10. Measured basis

Every claim above was read out of the tree or off the device on 2026-10-02, branch `0.0.41`:

- ADR #22 status *Implemented (2026-07-22) — Amended (2026-07-23)*; atomic commit via
  `apply_topology_diff` in one transaction; `type_key` immutable; diff modal deferred.
- ADR #6 *Implemented (2026-07-15)* — append-only inventory delta ledger. Not applicable to config.
- ADR #21 *Approved — Phase 1 implemented*.
- `topology_revisions`, `topology_revision_pinned`, `topology_structure`, `topology_validation`
  present in `crates/kasirmu-bridge/src/topology/`.
- Topology tables present in `crates/kasirmu-core/migrations/20260813_init.pg.sql`.
- `tenant_id` present in `apps/cloud-server/src/conflict_resolution.rs` and
  `apps/cloud-server/src/email_pg/analytics.rs` — **not** audited exhaustively (§4.1).
- `QuotaDimension::TopologyNodes` at `crates/kasirmu-core/src/db/quota_gate.rs`.
- `settings/topology` currently resolves to `settings-screen-placeholder`
  (`shared-ui/locales/settings.id.ftl:69`).
- No web topology surface exists; `website/src/pages/` is marketing, account, pricing and pair.

**Not verified, and flagged as such:** that the PG schema's topology tables are actively written by
any runtime code path (only their existence in the migration was checked); and that every
cloud-server query is tenant-filtered — which is precisely what Phase 0 must establish.

**Stale reference found:** ADR #22 Amendment 1 §B cites
`apps/desktop-client/src/commands/topology.rs`. There is no `apps/desktop-client`; the tree has
`apps/desktop-tauri/src/commands/topology/`. Fix as a `docs(decisions)` chore.
