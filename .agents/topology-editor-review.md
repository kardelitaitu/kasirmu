# Topology editor — code review

<!-- Audit stamp: 2026-09-15 · DSH · status: REVIEW, FIRST PASS · reviewed HEAD `257ff6122` on branch `0.0.39`. METHOD: static reading only — no test suite was executed and no file was modified. Every finding carries a `file:line` re-read in this checkout; every count has its command beside it. Two claims are explicitly marked NOT VERIFIED where I could not close them. · SCOPE: the backend command layer (`crates/oz-bridge/src/topology/`), the desktop IPC shim, the wire contract (`ui/src/api/topology.ts`), and the topology test suites. NOT reviewed in this pass: the canvas geometry/pointer/keyboard modules (~57k lines of topology-named UI code), the CSS, and the React rendering path beyond the Apply lifecycle. · This review builds on a prior security pass whose five minors (M1–M5) are recorded at `docs/archived/manager-2-journal.md:2223-2245`; those are RE-CONFIRMED live rather than re-discovered, and are kept separate from the five findings this pass adds. -->

**Reviewer:** Budak Korporat
**Subject:** the topology editor — visual node-graph editor for store layout (branch locations, terminals, warehouses, POS instances)
**Verdict:** **the most carefully engineered write path I have read in this repository.** The transaction discipline, the cross-database compensation, and the failure-mode documentation are genuinely excellent. It also has one unauthenticated read, one validation scope mismatch, and a test that asserts a property its own mechanism cannot produce.

---

## 1. Scope and method

| Surface | Size | Reviewed |
|---|---|---|
| `crates/oz-bridge/src/topology/commands.rs` | 1,046 lines | **yes — full read** |
| `crates/oz-bridge/src/topology/persistence.rs` | 869 | partial (the gate, recovery, journal) |
| `crates/oz-bridge/src/topology/semantics.rs` | — | the ownership gate only |
| `apps/desktop-tauri/src/commands/topology/commands.rs` | shim | the 10 command signatures |
| `ui/src/api/topology.ts` | 294 | full read |
| topology test suites (Rust + 52 UI files) | ~6,000 + 52 files | breadth pass + targeted verification |
| canvas geometry / pointer / keyboard / CSS | ~57k lines | **NOT reviewed** |

Counts used below, with their commands:

```bash
ls ui/src/features/locations/ | grep -icE 'topolog'          # 79
find ui/src -ipath '*topolog*' -type f -print0 | xargs -0 wc -l | tail -1   # 57567
wc -l crates/oz-bridge/src/topology/*.rs | tail -1           # 10046
```

---

## 2. What is genuinely strong — and should not be refactored away

Recorded first because it is the honest report, and because a future session tempted to "simplify" this code needs to know what it would be deleting.

**The Apply transaction discipline is correct and the reasoning is written down.** `commands.rs:363-387` documents the nested-transaction hazard: the create step runs its INSERT SQL *directly* on the outer transaction rather than delegating to `Store::create_workspace_instance`, because that helper opens its own `unchecked_transaction` and SQLite rejects a nested `BEGIN`. The update and archive steps do delegate, and the comment states why that is safe (`Connection::execute`, no `BEGIN`). That is a distinction most codebases get wrong by accident.

**Cross-database atomicity is handled properly.** There are two databases (workspace rows in the per-store DB, the diagram in the global DB) and no shared transaction. The design: a durable recovery journal written **before** any store mutation (`:646-660`), a snapshot of the rows a compensation may need (`:587-594`), compensation of both databases on save failure (`:957-987`), and a startup/next-Apply recovery (`persistence.rs:445-495`) that distinguishes "the apply completed, just finalize" (`:469-479`) from "compensate" (`:481-493`). A compensation failure is returned **explicitly** rather than swallowed (`:969-971`, `:978-980`), so the caller can surface an operator-recovery condition.

**The idempotency design is better than idempotent.** The request ledger stores a *fingerprint* (`:447-457`), so a replayed `requestId` returns the original revision (`:508-514`) but the same id with a *different* payload is **rejected** (`:503-506`) rather than silently deduplicated. The pre-fingerprint ledger entry is removed rather than treated as a match (`:516-519`) — with a comment naming the only way such an entry can exist.

**Failure-mode reasoning is explicit where it matters.** The audit write is deliberately non-fatal with a stated rationale — returning an error would tell a merchant their deploy failed when it did not (`:1007-1015`). The load boundary is deliberately raw so one corrupt stored row cannot brick the editor (`:145-153`). The deadlock on the success path is documented at `:989-993` along with the fact that no test exercised it until round 136.

**The prior extraction's parity evidence is unusually strong.** `docs/archived/manager-2-journal.md:2218-2222`: a normalized diff of the desktop and bridge copies produced "22 hunks / 336 lines, every one attributable to ctx-param, import block, `&state`→`&ctx.db_manager` threading, or rustfmt re-wrap; **ZERO hunks touch a gate, a SQL string, a log line, or a lock**."

---

## 3. New findings

### F1 — The ownership gate and the mutation scope read *different stores*

**Severity: moderate (integrity). Not previously recorded.**

`apply_topology_diff` resolves an "effective store" from the diagram's own Branch Location node, and explicitly says it may differ from the session's store:

> `commands.rs:459-466` — *"this may differ from the session's store (e.g. the admin workspace is in store A but the topology references Branch Location B). Use the diagram's storeProfileId as the authoritative scope for all workspace operations"*

Three of the four consumers honour that. One does not:

| Step | Store used | Line |
|---|---|---|
| Authorization (`require_user_permission_scoped`) | `effective_store_id` | `:476-482` |
| **Ownership gate registry** (`validate_apply_gate`) | **`session.store_id`** | **`:555`** |
| Workspace CRUD transaction | `effective_store_id` | `:677` |
| Audit record | `effective_store_id` | `:1021` |

The gate is `validate_semantic_ownership_in` (`persistence.rs:624-633`), which returns `Ok` if the branch profile id exists in **any** supplied registry, and it is handed `[global_db, session_store_db]`. The `effective_store_id` registry is never consulted.

**Consequence, in the direction that matters.** When the two stores differ and `workspace_creations` is empty (a pure diagram edit — the common case), the gate can pass on the *session* store's registry while the target store has no such `locations` row. Nothing downstream re-checks it: the only thing that would is the `REFERENCES store_profiles(id)` foreign key on `workspace_instances` (`crates/oz-core/migrations/20260813_init.sql:986-988`, table since renamed to `locations` by `20260906_rename_store_to_location.sql:14`), and that fires only on an INSERT. **So a diagram naming a branch identity the target store does not know can be committed.**

**The other direction is a false-reject**, and it is the failure mode the code's own comment at `:547-552` claims to have fixed: a branch profile that exists only in the *effective* store is rejected with `unknown-branch-location`.

**The FK bounds the damage** — with creations present, a genuinely unknown profile fails the INSERT and the whole Apply rolls back. So this is an integrity gap, not a corruption vector, and I am not claiming a privilege escalation.

**No test covers the divergence.** `grep -rn "effective_store\|session_store\|different store\|differs from" crates/oz-bridge/src/topology/*_tests.rs` → **zero hits**. The end-to-end test sets `SessionContext::new(..., store_id.into(), ...)` and a node with `store_profile_id: store_id` — the same value (`apps/desktop-tauri/src/commands/topology/topology_command_tests.rs:1139-1164`).

**Fix:** pass `effective_store_id`'s connection to the gate as well, or instead. The gate already takes a slice; the change is additive. Then add the divergence test — one Apply where the session store and the diagram's branch profile differ.

### F2 — The capability probe and the enforcement disagree about scope

**Severity: low-moderate (correctness/UX). Not previously recorded.**

`can_save_topology` is what the UI uses to decide whether to let you edit:

```rust
// commands.rs:38-46
// Topology is a global admin tool — use scope-free permission check.
ctx.require_permission_for_user(&global_store, &session.user_id, permissions::TOPOLOGY_WRITE)?;
```

The write path uses the **scoped** check:

```rust
// commands.rs:476-482
ctx.require_user_permission_scoped(&global_store, &session.user_id,
    permissions::TOPOLOGY_WRITE, Some(&effective_store_id), None)
```

So a user holding `TOPOLOGY_WRITE` under a **branch-scoped** assignment that excludes branch X is told editing is enabled for branch X, can author an entire diagram, and is denied at Apply. The probe's comment states the opposite policy from the write path — one of the two is wrong, and the comment does not say which.

**Fix:** make the probe take the branch it is probing for and use the same scoped check, or state in both places why the probe is intentionally broader. The second is cheaper but must be *written down*, because right now the two comments contradict each other.

### F3 — A test asserts a property its own mechanism cannot produce

**Severity: low (test/documentation). Not previously recorded.**

`apps/desktop-tauri/src/commands/topology/topology_command_tests.rs:1094` is the end-to-end Apply test. Its second half replays a stale base revision and claims:

> `:1188-1190` — *"the save rejects AFTER the store transaction commits, so the live error path must compensate and restore"*
> `:1230-1235` — *"This test already forces exactly that path — the stale Apply fails AFTER the store transaction commits, so it is compensated — which makes it the right place to pin the §3 claim"*

**It does not.** The revision gate runs early:

```
commands.rs:527-541   ← revision gate; returns on mismatch
commands.rs:553-562   ← ownership gate
commands.rs:657-660   ← journal written
commands.rs:674-905   ← store transaction
commands.rs:937-956   ← diagram save
```

A `base_revision=0` against `current_revision=1` returns at `:531-539` — **before** the journal and before the store transaction. So no journal is written by this call and nothing is compensated.

The assertion at `:1213-1218` — *"the recovery journal must be cleared after a compensated failure"* — passes for a different reason: the **first, successful** Apply wrote a journal (the success path never clears it; only `commands.rs:984` and `persistence.rs:477/492` do), and the second Apply's `recover_pending_topology_apply` at `:526` cleared it via the "apply completed, just finalize" branch (`persistence.rs:475-479`). The assertion is therefore vacuous with respect to its own message.

**This is a documentation defect, not a coverage hole.** The compensation path *is* properly covered — by `:979 crash_after_store_commit_compensates_both_databases()`, `:1035 recovery_finalizes_without_compensating_a_completed_apply()`, and the update/archive compensation test at `:1604`+. The problem is that this test's comments claim a mechanism it does not use, which will mislead the next reader into thinking the §3 claim is pinned here.

**Fix:** correct the two comments to say the stale revision is rejected at the early gate, and say what the journal assertion actually proves (that a prior successful Apply's journal was finalized).

### F4 — `requestId` replay has no test at all

**Severity: low (coverage). Independently confirmed.**

```bash
grep -rn "request_id\|requestId" crates/oz-bridge/src/topology/*_tests.rs \
                                  apps/desktop-tauri/src/commands/topology/*_tests.rs
# (no output)
grep -rn "already used for a different" crates/ apps/ --include=*.rs
# → commands.rs:505 only — the production string, nowhere else
```

Both branches of the idempotency block (`commands.rs:496-521`) are unexercised:

- the idempotent-success return (`:508-514`), which is what makes a double-submit safe;
- the same-id-different-payload rejection (`:503-506`), which is the branch that prevents a replay from being read as a *different* deploy's success.

This is a deliberately-built, well-reasoned mechanism with zero execution. Given the fingerprint rejection is the subtle half, it is the one I would pin first.

### F5 — Two tests restate production verbatim, so they cannot fail

**Severity: low (test quality). Independently confirmed.**

`ui/src/__tests__/topologyExport.test.ts:358`:

```ts
expect(usesBackendTemplates || !usesBackendTemplates).toBe(true);
```

`A || !A` is a tautology. Its own comment calls it *"the only test that notices"* the half-swap hazard — but the real guard is the conditional at `:355-357`, and `:346-349` asserts `usesBackendTemplates === false`, so the conditional never fires and the whole body is vacuous today.

`ui/src/__tests__/topologyKindRegistry.test.ts:154`:

```ts
expect(gatingSemanticId(probe, port)).toBe(socketSemanticIds(probe, port)[0]);
```

Production is exactly that expression — `topologyCard.ts:220-226` is `socketSemanticIds(node, port, variantIndex)[0]`. The test asserts `f(x) === f(x)`, under the name *"derives gating from the socket list rather than restating it"*. The same shape recurs at `:83` against `topologyCard.ts:778-780`.

Neither can fail unless the callee becomes non-deterministic. The properties they *intend* to protect (that gating derives from the socket list; that a half-swap is caught) are real and worth pinning — these tests just do not pin them.

---

## 4. The known register, re-confirmed live

These five were found by an earlier security pass (`docs/archived/manager-2-journal.md:2223-2245`) and registered as **preserved defects** from the desktop→bridge extraction, with the delta stated as *visibility only*. I re-read each; all five are still live at `257ff6122`. Recording them here so this review is a complete picture, and so the earlier finding is not lost with the journal.

**M1 — `load_topology` is unauthenticated, and it is the most sensitive read in the file.**
It takes no session at **any** layer: the bridge body (`commands.rs:154-202`) never calls `resolve_session`; the shim's signature is `(branch_id, state)` with no `session_token` (`apps/desktop-tauri/src/commands/topology/commands.rs:132-139`); the UI wrapper matches (`ui/src/api/topology.ts:60-64`). It returns the full stored envelope for **any** `branch_id` the caller names. Not registered on the tablet (`grep -rn "load_topology\b" apps/mobile-tauri/src/` → 0).

What makes this worth re-raising rather than merely re-listing: `load_topology_template` (`:107-113`) **does** resolve a session, with an explicit justification — *"Reading a template reveals a branch's configuration, so it needs a session — but not the write capability."* The live diagram reveals strictly more than a template, and is the one read with no session at all. The reasoning that motivated the template check applies more strongly to the diagram, and was not applied to it.

**M2 — Session existence standing in for authorization.** `commands.rs:110-112` resolves a session, then discards it: `let _ = &session.user_id;`. The comment states the intent; the effect is that any valid session can read any branch's templates.

**M3 — `pin_topology_revision` gates without scope, on a caller-supplied branch.** `:252-256` uses the scope-free `require_permission_for_user` while `branch_id` arrives from the caller (`:244`), so any `TOPOLOGY_WRITE` holder can pin or unpin another branch's revisions. Inconsistent with the file's own stated rationale at `:236-240` (*"pinning changes what stays RESTORABLE … the same gate Apply itself needs"*) — and Apply's gate *is* scoped.

**M4 — Three helpers are `pub` and internally ungated.** `validate_apply_gate`, `validate_warehouse_quota` and `save_topology_json_at_key_with_revision` carry no gate of their own; the command layer that consumes them does. The prior pass's trigger condition is *"spent for today and LIVE for any future consumer"* — that is still the correct status.

**M5 — `BridgeError::Internal` may carry a filesystem path to the renderer.** `:679-681`, `:940-942`, `:1022-1024` all interpolate `{e}` from `open_store`. Same family, same lines, as the desktop copy.

---

## 5. Test coverage — what is pinned, and what is not

**Well pinned** (verified by reading the tests, not by counting them): the ownership/structural gate rejects malformed diagrams before mutation; the cross-database compensation for creations, updates and archives; the "completed apply is finalized, not compensated" negative case; the retention sweep and pin interaction; the revision row living inside the committing transaction; `baseRevision` conflict rejection; the ADR #46 §6 change-note surviving command → save → row → audit.

**Not pinned:**

| Property | Evidence |
|---|---|
| `requestId` idempotent replay + fingerprint rejection | **F4** — zero occurrences in any topology test |
| The session-store / effective-store divergence | **F1** — zero occurrences of either term in the topology tests |
| The ledger write inside the save transaction | `persistence.rs:314-318` — no oz-bridge test passes a request key |
| The probe's agreement with enforcement | **F2** — no test asserts the two checks agree |

**Scope correction worth recording:** `crates/oz-bridge/src/topology/*_tests.rs` never call `apply_topology_diff`, `recover_pending_topology_apply`, `compensate_workspace_diff` or `persist_topology_recovery`. The real end-to-end Apply tests live in `apps/desktop-tauri/src/commands/topology/topology_command_tests.rs`. A reviewer who reads only the bridge test files will conclude the Apply path is untested; it is not — it is tested one crate over.

**Skips and baselines:** exactly one skip in the whole topology UI (`NodeTopologyEditor.test.tsx:6607`), documented. No `#[ignore]`, no `KNOWN_BROKEN`, no `describe.skip` in the Rust topology tests. That is a clean result and worth saying plainly.

---

## 6. Recommended order

1. **F1** — decide the authoritative store for the ownership gate, then pass it. Add the divergence test. This is the only finding with an integrity consequence.
2. **M1** — decide whether an unauthenticated branch-diagram read is intended. If yes, write the reason next to the command, because the template check's own comment currently argues the other way. If no, add the session parameter — the shim change is mechanical and the parity gate will confirm the registration.
3. **F2 / M3** — one decision about scope policy, applied to the probe and to pin together, since both are the same question asked twice.
4. **F4** — pin the fingerprint rejection. It is the cheapest high-value test in this review.
5. **F3 / F5** — correct the misleading comments and either repair or delete the two tautologies.
6. **M4 / M5** — record as accepted-with-rationale or fix; both are cheap, neither is urgent.

---

## 7. What this review did not establish

- **The canvas layer is unreviewed.** ~57k lines of geometry, pointer, keyboard, touch, clipboard, undo/restore and CSS. Nothing here speaks to it. Given the finding rate in the 1,046-line command file, I would not assume it is clean.
- **No test suite was run.** Every claim above is a static read. A green/red claim is not made anywhere in this document.
- **F1's reachability is asserted, not demonstrated.** The code says the two stores may differ; I did not construct a running case that makes them differ. Confirming that needs either a test or a reproduction, which is why the fix recommendation is paired with a test rather than presented alone.
- **The `ui/src/dev-mock/handlers/topology*.ts` layer was not reviewed.** It is the third implementation of the same contract and, on this repo's own history of dev-mock drift, a plausible place for the next divergence.

---

## 8. Amendment — revalidation against a moved HEAD (2026-09-15)

<!-- Amendment stamp: 2026-09-15 · DSH · the review above was authored at HEAD `257ff6122`. By the time it was delivered the shared checkout had advanced to `35011a227` — 101 commits, by peer sessions, not by this review. Every `file:line` citation above is therefore revalidated here rather than assumed. · RESULT: all six reviewed files are byte-identical across the move, so no line number rotted. The finding set stands unchanged. · The measurement is blob identity, not directory absence: a peer could have edited a reviewed file without touching its directory name. -->

The original audit stamp names `257ff6122` and is left as written. This amendment records what the move did to the review's citations.

**Method.** For each reviewed file, compare the blob hash at the review HEAD against the blob hash at the current HEAD. Identical hashes mean identical content, which means identical line numbers.

```bash
for f in crates/oz-bridge/src/topology/commands.rs \
         crates/oz-bridge/src/topology/persistence.rs \
         apps/desktop-tauri/src/commands/topology/topology_command_tests.rs \
         ui/src/api/topology.ts \
         ui/src/__tests__/topologyExport.test.ts \
         ui/src/__tests__/topologyKindRegistry.test.ts; do
  a=$(git rev-parse "257ff6122:$f"); b=$(git rev-parse "35011a227:$f")
  [ "$a" = "$b" ] && echo "IDENTICAL  $f" || echo "CHANGED    $f"
done
```

**Result — all six identical:**

| File | Verdict |
|---|---|
| `crates/oz-bridge/src/topology/commands.rs` | IDENTICAL |
| `crates/oz-bridge/src/topology/persistence.rs` | IDENTICAL |
| `apps/desktop-tauri/src/commands/topology/topology_command_tests.rs` | IDENTICAL |
| `ui/src/api/topology.ts` | IDENTICAL |
| `ui/src/__tests__/topologyExport.test.ts` | IDENTICAL |
| `ui/src/__tests__/topologyKindRegistry.test.ts` | IDENTICAL |

**What did move on the topology surface.** One file, and it is not one this review reasoned about: `ui/src/features/locations/TopologyApplyConfirm.css`. A stylesheet in the Apply-confirmation dialog carries no weight for F1–F5, which are all assertions about Rust control flow and test assertions. It is named here so that the "topology was untouched" claim is bounded rather than absolute.

**Consequence for the register.** F1–F5 and M1–M5 remain live at `35011a227` without re-reading. The recommended order in §6 is unaffected. Had any blob differed, the affected findings would have needed re-reading before they could be quoted again — a review's line numbers are a cache, and this is the check that says the cache is still valid.
