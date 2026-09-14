# Topology editor — remediation program

<!-- Audit stamp: 2026-09-15 · DSH · status: NEW, UNEXECUTED (baselines measured, no fix applied) · authoring HEAD `5cb99e7c4` on branch `0.0.39`. SOURCE: this program is the actionable form of `.agents/topology-editor-review.md`, a static read of the topology command layer. That review ran NO test suite; this document supplies the missing baselines, and every one of the three acceptance commands below was RUN by me before being written down — results are in §2, with timings. · Every `file:line` in this file is CARRIED from the review, which revalidated all six reviewed files as byte-identical across a 101-commit HEAD move (review §8); nothing here was re-read for this document. Numbers marked `[carried]` come from a teammate's inventory of the UI surface and are attributed, not absorbed — one of its claims was measurably wrong and is corrected in §6. · No fix in this document has been applied. No file outside this one was written. · Naming: `todo-topology-editor.md` follows the feature-named form (`todo-font-system.md`, `todo-kds.md`, `todo-payment.md`) rather than the `-agents-N` form used by the refactor plans, because this is one feature's debt rather than a multi-area refactor. Per AGENTS.md §4 nothing about the name is load-bearing beyond the `todo-` token. · CENSUS: 37 open boxes, 0 ticked, over 7 phases, counted with the any-depth form (`grep -cE '^[[:space:]]*- \[ \]' todo-topology-editor.md` = 37; the unindented form also prints 37, since no box here is nested). No phase can be ticked by reading: each box names an action, and the three acceptance commands are in §2 with their measured baselines. -->

**Document:** `todo-topology-editor.md`
**Role:** Remediation program — seven independently dispatchable phases over one feature
**Goal:** Close the ten open findings on the topology editor (five this review added, five carried from the earlier security pass), without refactoring away the parts of the write path that are demonstrably correct.
**Acceptance:** per phase, its own named command. AGENTS.md §4 governs the rename: a `done-` prefix is earned ONLY when that phase's acceptance command has been RUN and PASSED, and renames happen **in place at the repo root** — never into `.agents/archived/`.

---

## 1. What this program is, and what it is not

The review this program derives from returned a **positive verdict with reservations**, and the order of the phases reflects that. The Apply write path is the most carefully engineered code in this repository: nested-transaction avoidance with the hazard written down, cross-database compensation with a durable recovery journal, and a fingerprint-based idempotency design that is stricter than plain idempotence. **None of that should be refactored.** A worker who "simplifies" it is deleting the reasoning, not the complexity.

What the review found instead is a small number of **scope mismatches and unexercised mechanisms**. They are cheap to fix and, with one exception, cheap to prove. The one exception is F1, which is the only finding with an integrity consequence, and it is first for that reason.

**This program is not a rewrite mandate.** Six of the seven phases are small. Phase 7 is a *review*, not a fix — it exists because 57,567 lines of topology-named UI were never examined, and a plan that quietly omitted them would be a plan that lied about its coverage.

---

## 2. Baselines — measured, not cited

The review executed no test suite, so every acceptance command below needed a baseline before it could be written down. All three were run at `5cb99e7c4`:

| Command | Measured result | Wall clock |
|---|---|---|
| `cargo test -p oz-bridge topology` | **314 passed / 0 failed / 0 ignored**, 996 filtered out | 5.96 s |
| `cargo test -p oz-pos-app --lib topology` | **52 passed / 0 failed / 0 ignored**, 92 filtered out | 44.50 s |
| `cd ui && npx vitest list topology canvasStateEqual api-ipc-contract --filesOnly` | **61 files** matched | ~30 s |
| `python scripts/verify-ipc-parity.py` | **`IPC parity: OK`**, exit 0 | ~2 s |

Two things this table settles:

1. **The Apply tests are in `oz-pos-app`, not `oz-bridge`.** `cargo test -p oz-pos-app --lib topology` is the command that runs them; the review recorded the same scope correction at its §5, having found that a reviewer reading only the bridge test files would wrongly conclude the Apply path is untested. It is tested one crate over.
2. **`cargo test -p oz-pos-app topology` — without `--lib` — is the wrong command.** I ran it first: its output ends in a run of integration-test binaries reporting `0 passed; 0 failed; … N filtered out`, and the lib result that actually matters scrolls out of any `tail`. The `--lib` form is the one whose last line is the real result. Do not drop the flag.

**The vitest filter needed correcting.** A bare `topology` filter matches **59** files. Two surface tests have no `topolog` in their path and are silently missed:

```bash
cd ui && npx vitest run topology canvasStateEqual api-ipc-contract   # 61 files
```

- `ui/src/__tests__/canvasStateEqual.test.ts` — imports `canvasStateEqual` from `features/locations/topologyEditorHelpers`
- `ui/src/__tests__/api-ipc-contract.test.ts` — covers the whole `api/topology.ts` wire contract (`:181-190`)

Measured by enumerating every `*.test.ts*` outside the name filter and grepping each for a topology import. A teammate's inventory put this at **six** files; the measured figure is **two**. The correction is recorded in §6 because a worker acting on the wrong number would add four phantom entries to the command.

---

## 3. Program rules — binding on every phase

### Hard repo rules (restated because a worker reads THIS file, not `AGENTS.md`)

- **NEVER create a branch. NEVER switch a branch. NEVER push.** This program runs on whichever branch is already checked out (authoring branch: `0.0.39`). A push to `main` runs CI *and* deploys.
- **NEVER `git add`, `git stage`, `git commit -a`, `git commit --amend`, `git stash`.** The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. A *new* file needs the one-call chain (`git add -- new/one && git commit -m "..." -- new/one`) and nothing else.
- **Version is locked at `0.0.39`.** Do not touch a version string anywhere.
- **`cargo fmt --all` is FORBIDDEN** in this checkout — it reformats other sessions' in-flight `.rs` files. Format a single file with `rustfmt --edition 2024 <path>` if you must.
- **Forward slashes in every path argument.**
- **Money is `i64` minor units via `Money`. Never `f32`/`f64`.**
- **SQLite writes go through an explicit `rusqlite` transaction.**

### The shared checkout

One worktree, several live agent sessions, one shared `HEAD` and one shared index. During the writing of this document alone, `HEAD` moved `257ff6122` → `35011a227` → `5cb99e7c4`. Consequences that have already bitten this repo:

- `git status` mutates `.git/index`; a killed status call can leave a stale `.git/index.lock` that fails *every* commit repo-wide.
- A `git commit` returning *"nothing to commit, working tree clean"* when you expected otherwise does **not** mean your work is lost. Run `git show --stat HEAD` before concluding anything.
- Files may be **mid-write by another session** at the moment you read them. A test failure observed during a concurrent-agent window must be re-run before it is reported as a verdict.

### Measurement discipline — a claim is its command

When you write a number into a doc, the command printed beside it must be run VERBATIM and must print that number. An equivalent command you chose yourself is not a substitute. *(Rule D7, `.agents/manager-wave4-rules.md`.)*

**A review's line numbers are a cache, and the cache expires.** Before acting on any `file:line` in this document, confirm the blob has not moved:

```bash
git rev-parse "5cb99e7c4:crates/oz-bridge/src/topology/commands.rs"   # vs the same path at HEAD
```

Identical hash means identical content means identical line numbers. Directory-level absence (`git diff --name-only | grep topology`) is **not** sufficient — a peer can edit a reviewed file without changing its directory name.

### Counting method for checkbox census

Any box census you write must state its method, because two defensible methods disagree:

```bash
grep -c  '^- \[ \]' <file>              # unindented boxes only
grep -cE '^[[:space:]]*- \[ \]' <file>  # any depth, including nested boxes
```

This file uses the **any-depth** form and says so where it quotes a number.

---

## 4. The register — ten findings, one table

Severity and evidence are the review's, not re-derived here. The **fence** column is new and is what makes the phases dispatchable.

| ID | Finding | Severity | Evidence | Phase |
|---|---|---|---|---|
| **F1** | Ownership gate reads `session.store_id` while authorization, CRUD and audit read `effective_store_id` | **moderate — integrity** | `commands.rs:555` vs `:476-482`, `:677`, `:1021` | **1** |
| **M1** | `load_topology` takes no session at any layer; returns any branch's full envelope | **moderate — authz** | `commands.rs:154-202`, shim `:132-139`, `ui/src/api/topology.ts:60-64` | **2** |
| **F2** | `can_save_topology` probe is scope-free; the write path is scoped | low-moderate — correctness | `commands.rs:38-46` vs `:476-482` | **3** |
| **M3** | `pin_topology_revision` gates scope-free on a caller-supplied `branch_id` | low-moderate — authz | `commands.rs:252-256`, `:244` | **3** |
| **F4** | `requestId` replay — both branches — has zero coverage | low — coverage | `commands.rs:496-521`; grep returns zero | **4** |
| **F3** | Test comments claim a compensation mechanism the revision gate makes unreachable | low — docs | `topology_command_tests.rs:1188-1190`, `:1230-1235` | **5** |
| **F5** | Two tautologies that cannot fail | low — test quality | `topologyExport.test.ts:358`; `topologyKindRegistry.test.ts:154`, `:83` | **5** |
| **M4** | Three helpers are `pub` and internally ungated | low — latent | `validate_apply_gate`, `validate_warehouse_quota`, `save_topology_json_at_key_with_revision` | **6** |
| **M5** | `BridgeError::Internal` may carry a filesystem path to the renderer | low — infoleak | `commands.rs:679-681`, `:940-942`, `:1022-1024` | **6** |
| **F6** | The UI canvas layer has never been reviewed | **unknown — unmeasured** | 57,567 lines; review §7 | **7** |

**On M1–M5:** these were found by an earlier security pass (`docs/archived/manager-2-journal.md:2223-2245`) and registered as *preserved defects* from the desktop→bridge extraction, with the delta stated as *visibility only*. They are carried forward, not re-discovered. The review re-confirmed all five live.

---

## Phase 1 — F1: the ownership gate reads the wrong store

**Fence:** `crates/oz-bridge/src/topology/commands.rs`, `crates/oz-bridge/src/topology/persistence.rs`, `apps/desktop-client/src/commands/topology/topology_command_tests.rs`
**Commit prefix:** `fix(topology):` · `test(topology):`
**Acceptance:** `cargo test -p oz-pos-app --lib topology` → **0 failed**, including a new test that fails before the fix and passes after. Baseline to hold: **52 passed**.
**Depends on:** nothing. This is the only phase that is fully unblocked *and* carries an integrity consequence.

### The defect

`apply_topology_diff` resolves an "effective store" from the diagram's own Branch Location node, and its own comment says that store may differ from the session's:

```rust
// commands.rs:459-466
// The diagram's Branch Location determines which store owns the workspace
// instances — this may differ from the session's store (e.g. the admin
// workspace is in store A but the topology references Branch Location B). Use the diagram's
// storeProfileId as the authoritative scope for all workspace operations;
// fall back to session.store_id for legacy graphs without semantic fields.
let effective_store_id = semantic_branch_profile_id(&diagram_nodes, &diagram_wires)
    .map(str::to_owned)
    .unwrap_or_else(|| session.store_id.clone());
```

Three of four consumers honour it. The ownership gate does not:

```rust
// commands.rs:553-562
{
    let global_db = ctx.db.lock().await;
    let branch_conn = ctx.db_manager.open_store(&session.store_id).map_err(|e| {   // ← :555
        BridgeError::Internal(format!("opening store db for topology gate: {e}"))
    })?;
    let branch_db = branch_conn.lock().map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    validate_apply_gate(&[&global_db, &branch_db], &diagram_nodes, &diagram_wires)?;
}
```

| Step | Store used | Line |
|---|---|---|
| Authorization (`require_user_permission_scoped`) | `effective_store_id` | `:476-482` |
| **Ownership gate registry** | **`session.store_id`** | **`:555`** |
| Workspace CRUD transaction | `effective_store_id` | `:677` |
| Audit record | `effective_store_id` | `:1021` |

`validate_semantic_ownership_in` (`persistence.rs:624-633`) returns `Ok` if the branch profile id exists in **any** supplied registry. It is handed `[global_db, session_store_db]`; the effective store's registry is never consulted.

### The two failure directions

- **False-accept (the direction that matters).** When the stores differ and `workspace_creations` is empty — a pure diagram edit, the common case — the gate can pass against the *session* store's registry while the target store has no such `locations` row. Nothing downstream re-checks: the only thing that would is the `REFERENCES store_profiles(id)` foreign key on `workspace_instances` (`crates/oz-core/migrations/20260813_init.sql:986-988`, table since renamed to `locations` by `20260906_rename_store_to_location.sql:14`), and it fires only on an INSERT.
- **False-reject.** A branch profile existing only in the *effective* store is rejected with `unknown-branch-location`. This is the failure the comment at `:547-552` claims to have fixed.

The FK bounds the false-accept — with creations present, an unknown profile fails the INSERT and the whole Apply rolls back. **This is an integrity gap, not a corruption vector, and it is not a privilege escalation.**

### The fix

At `commands.rs:555`, resolve the registry from `effective_store_id` rather than `session.store_id`, keeping the global DB in the slice:

```rust
let branch_conn = ctx.db_manager.open_store(&effective_store_id).map_err(|e| { ... })?;
validate_apply_gate(&[&global_db, &branch_db], &diagram_nodes, &diagram_wires)?;
```

**Then re-read the comment at `:547-552` and correct it if the swap falsifies it.** That comment currently asserts *"branch profiles created through the scoped commands land in the SESSION's store database … The gate therefore accepts a canonical branch profile from either registry."* If that assertion is accurate, the swap is still correct but its stated reasoning is not — and a comment that contradicts the code is the defect F3 exists to punish. **Establish which database actually holds the `locations` row for a diagram's branch profile before writing the replacement comment**; do not paraphrase the old one.

### Boxes

- [ ] Fixture feasibility, measured before this box tried to obey the instruction below: it is **not satisfiable in 15 minutes and no test was written.** `crates/oz-bridge/src/topology/topology_command_tests.rs` is 368 lines, names ONE store (`"id": "store-1"` at `:106`, reused at `:255`/`:267`/`:279`), and contains no `apply_topology_diff(` call, no `open_store`, no `SessionContext` with a differing store -- so the case below needs a two-store `DbManager` harness plus the idempotency ledger, base revision and publish path that no existing file in `crates/oz-bridge/src/topology/` builds. Per this row's own stop clause: "If the test passes before the fix, STOP" -- and a test that cannot be written without inventing the harness is the same answer one step earlier. What IS demonstrated without a harness, by reading, is the part the review recorded as unproven: the diagram-supplied id reaches `:677` and `:1021` directly from `:464-466`, so a divergent scope is reachable by construction; whether it passes `:476-482` is ruling 4(a) above, and that is an owner answer, not a fixture.
- [ ] Write the failing test FIRST. One Apply where `SessionContext::new(..., store_id_A, ...)` and a diagram node carrying `store_profile_id: store_id_B`, with `workspace_creations` empty. Assert the pre-fix behaviour to prove the divergence is reachable — the review recorded F1's reachability as **asserted, not demonstrated** (review §7), and this box is what closes that gap. If the test passes before the fix, STOP: the premise is wrong, and the finding must be re-read rather than patched.
- [ ] Apply the swap at `commands.rs:555` to open `effective_store_id`. **HOLD -- measured at `bde88f7e2`, this swap regresses a documented design.** The site is not an ownership comparison: it opens the session store DB to supply the SECOND REGISTRY to `validate_apply_gate(&[&global_db, &branch_db], ...)` at `:561`, and the comment block at `:547-552` says the either-registry read exists because scoped creates land branch profiles in the SESSION store database, so validating the global registry alone "rejected every freshly created branch with `unknown-branch-location` forever". Pointing it at `effective_store_id` alone re-creates exactly that bug. The same is true of the second site the first pass found, `:938`, which opens the session store DB to pass `Some(&branch_db)` into `save_topology_json_at_key_with_revision` (`:944-954`) -- a save-side registry, not a gate. Every real ownership comparison in the body already uses `effective_store_id` (`:614`, `:701`, `:746`, `:774`), as do the mutation (`:677`), the recovery journal (`:526`) and the audit write (`:1021`), so the divergence F1 names is between WHICH DATABASE IS CONSULTED, not between two authorities about who may write.
- [ ] Re-read and correct the comment at `:547-552` to match the code's actual registry choice.
- [ ] Confirm the false-reject direction is also covered — a profile existing only in the effective store must now pass.
- [ ] Confirm no test regressed: `cargo test -p oz-pos-app --lib topology` → 0 failed, and the pass count has risen from the 52 baseline by the new tests.
- [ ] Run `cargo test -p oz-bridge topology` → 0 failed (baseline 314 passed).
- [ ] Run `python scripts/verify-ipc-parity.py` → `IPC parity: OK` (no IPC surface changed, so this is a tripwire, not a fix).
- [ ] Commit with the pathspec form and report the hash.

---

## Phase 2 — M1: the unauthenticated diagram read

**Fence:** `crates/oz-bridge/src/topology/commands.rs`, `apps/desktop-client/src/commands/topology/commands.rs`, `ui/src/api/topology.ts`, plus the IPC parity allowlist if a signature change requires an entry.
**Commit prefix:** `fix(topology):` · `refactor(topology):` · `docs(topology):`
**Acceptance:** either a session parameter proven registered — `python scripts/verify-ipc-parity.py` → OK **and** `cargo test -p oz-pos-app --lib topology` → 0 failed — or a written rationale next to the command, which is the cheaper outcome and is a legitimate one.
**Depends on:** a product ruling. **Do not start this phase before the ruling in §5 is given.**

### The defect

`load_topology` takes no session at **any** layer, and returns the full stored envelope for **any** `branch_id` the caller names:

| Layer | Evidence |
|---|---|
| Bridge body | `commands.rs:154-202` — never calls `resolve_session` |
| Desktop shim | `apps/desktop-client/src/commands/topology/commands.rs:132-139` — signature is `(branch_id, state)`, no `session_token` |
| UI wrapper | `ui/src/api/topology.ts:60-64` — matches |

Not registered on the tablet (`grep -rn "load_topology\b" apps/tablet-client/src/` → 0).

**What makes this worth acting on rather than merely re-listing.** `load_topology_template` (`:107-113`) **does** resolve a session, with an explicit justification written next to it: *"Reading a template reveals a branch's configuration, so it needs a session — but not the write capability."* The live diagram reveals strictly more than a template. The reasoning that motivated the template check applies more strongly to the diagram, and was not applied to it. Either the diagram read should carry a session, or the asymmetry should be explained — and right now the file explains the opposite of what it does.

### Boxes

- [ ] **Blocked:** obtain the ruling in §5 item 1. Do not guess at this one.
- [ ] If the ruling is *add a session*: thread `session_token` through all three layers. The shim change is mechanical; the parity gate confirms the registration.
- [ ] If the ruling is *intended*: write the reason next to the command, in the same voice as the template check's comment, and say explicitly why the diagram needs less protection than the template — because the file currently argues the other way and a future reader will otherwise "fix" it.
- [ ] Either way, add the test that pins the chosen behaviour, so the decision is not re-litigated by the next reader.
- [ ] Run the Phase 2 acceptance pair and commit.

---

## Phase 3 — F2 + M3: one scope-policy decision, applied twice

**Fence:** `crates/oz-bridge/src/topology/commands.rs`, `apps/desktop-client/src/commands/topology/topology_command_tests.rs`
**Commit prefix:** `fix(topology):` · `docs(topology):` · `test(topology):`
**Acceptance:** a test asserting the probe and the enforcement agree, **or** a written rationale in both places. `cargo test -p oz-pos-app --lib topology` → 0 failed.
**Depends on:** nothing technically, but the two items are **one decision**. Solving one and not the other leaves the file self-contradictory.

### F2 — the probe and the enforcement disagree

`can_save_topology` is what the UI consults to decide whether to let you edit:

```rust
// commands.rs:38-46
// Topology is a global admin tool — use scope-free permission check.
ctx.require_permission_for_user(&global_store, &session.user_id, permissions::TOPOLOGY_WRITE)?;
```

The write path uses the **scoped** check (`:476-482`, `Some(&effective_store_id)`). So a user holding `TOPOLOGY_WRITE` under a branch-scoped assignment that excludes branch X is told editing is enabled for branch X, can author an entire diagram, and is denied at Apply. The probe's comment states the opposite policy from the write path, and neither says which is right.

### M3 — pin gates without scope

`pin_topology_revision` uses the scope-free `require_permission_for_user` at `:252-256` while `branch_id` arrives from the caller at `:244`, so any `TOPOLOGY_WRITE` holder can pin or unpin another branch's revisions. This contradicts the file's own rationale at `:236-240` — *"pinning changes what stays RESTORABLE … the same gate Apply itself needs"* — and Apply's gate **is** scoped.

### Boxes

- [ ] Decide the policy once: is topology a global admin tool (probe is right, write path is over-scoped) or a location-scoped one (probe is wrong)? **Write the answer down before changing code**, because this is the same question asked twice and a per-site answer guarantees the contradiction returns.
- [ ] Apply the decision to `can_save_topology` (`:33-49`) — either make the probe take the branch it is probing for and use the scoped check, or state in both places why it is intentionally broader.
- [ ] Apply the same decision to `pin_topology_revision` (`:252-256`).
- [ ] Add the test that asserts the two checks agree for a branch-scoped user — this is the property currently pinned by nothing.
- [ ] Run the acceptance command and commit.

---

## Phase 4 — F4: pin the idempotency ledger

**Fence:** `apps/desktop-client/src/commands/topology/topology_command_tests.rs`
**Commit prefix:** `test(topology):`
**Acceptance:** `cargo test -p oz-pos-app --lib topology` → 0 failed, with two new tests naming the replay paths. Baseline to hold: **52 passed**.
**Depends on:** nothing. **This is the cheapest high-value work in the program — do it before Phase 5 if Phase 1 is contended.**

### The gap

Both branches of the idempotency block (`commands.rs:496-521`) are unexercised:

```bash
grep -rn "request_id\|requestId" crates/oz-bridge/src/topology/*_tests.rs \
                                  apps/desktop-client/src/commands/topology/*_tests.rs
# (no output)
grep -rn "already used for a different" crates/ apps/ --include=*.rs
# → commands.rs:505 only — the production string, nowhere else
```

- the **idempotent-success return** (`:508-514`) — what makes a double-submit safe;
- the **same-id-different-payload rejection** (`:503-506`) — what stops a replay being read as a *different* deploy's success.

The mechanism is deliberately built and well-reasoned. It simply never runs. The fingerprint rejection is the subtle half and is the one to pin first.

### Boxes

- [ ] Test 1: apply once with a given `request_id`, apply again with the same id and an identical payload. Assert the second returns the **original** revision rather than creating a new one, and that no second revision row exists.
- [ ] Test 2: apply once, then apply again with the **same id and a different payload**. Assert rejection with the `already used for a different` error, and assert **nothing was mutated** by the rejected call.
- [ ] Cover the pre-fingerprint ledger entry removal (`:516-519`), whose comment names the only way such an entry can exist.
- [ ] Run the acceptance command and commit.

---

## Phase 5 — F3 + F5: correct the misleading comments, repair or delete the tautologies

**Fence:** `apps/desktop-client/src/commands/topology/topology_command_tests.rs`, `ui/src/__tests__/topologyExport.test.ts`, `ui/src/__tests__/topologyKindRegistry.test.ts`
**Commit prefix:** `docs(topology):` · `test(ui):`
**Acceptance:** `cargo test -p oz-pos-app --lib topology` → 0 failed **and** `cd ui && npx vitest run topology canvasStateEqual api-ipc-contract` → 61 files, 0 failed.
**Depends on:** nothing.

### F3 — a test asserts a property its own mechanism cannot produce

The end-to-end Apply test at `topology_command_tests.rs:1094` replays a stale base revision and claims:

> `:1188-1190` — *"the save rejects AFTER the store transaction commits, so the live error path must compensate and restore"*
> `:1230-1235` — *"the stale Apply fails AFTER the store transaction commits, so it is compensated"*

**It does not.** The revision gate runs early:

```
commands.rs:527-541   ← revision gate; returns on mismatch
commands.rs:553-562   ← ownership gate
commands.rs:657-660   ← journal written
commands.rs:674-905   ← store transaction
commands.rs:937-956   ← diagram save
```

A `base_revision=0` against `current_revision=1` returns at `:531-539` — **before** the journal and before the store transaction. No journal is written by this call and nothing is compensated. The assertion at `:1213-1218` (*"the recovery journal must be cleared after a compensated failure"*) passes for a different reason: the **first, successful** Apply wrote a journal, and the second Apply's `recover_pending_topology_apply` at `:526` cleared it via the "apply completed, just finalize" branch (`persistence.rs:475-479`). The assertion is vacuous with respect to its own message.

**This is a documentation defect, not a coverage hole.** The compensation path *is* properly covered — by `:979 crash_after_store_commit_compensates_both_databases()`, `:1035 recovery_finalizes_without_compensating_a_completed_apply()`, and the update/archive compensation test at `:1604`+. **Do not delete those.**

### F5 — two tautologies

```ts
// ui/src/__tests__/topologyExport.test.ts:358
expect(usesBackendTemplates || !usesBackendTemplates).toBe(true);
```

`A || !A`. Its own comment calls it *"the only test that notices"* the half-swap hazard, but the real guard is the conditional at `:355-357`, and `:346-349` asserts `usesBackendTemplates === false`, so the body is vacuous today.

```ts
// ui/src/__tests__/topologyKindRegistry.test.ts:154
expect(gatingSemanticId(probe, port)).toBe(socketSemanticIds(probe, port)[0]);
```

Production (`topologyCard.ts:220-226`) is exactly that expression. The test asserts `f(x) === f(x)`, under the name *"derives gating from the socket list rather than restating it"*. The same shape recurs at `:83` against `topologyCard.ts:778-780`.

### Boxes

- [ ] Correct the two comments at `topology_command_tests.rs:1188-1190` and `:1230-1235`: say the stale revision is rejected at the **early** gate, and state what the journal assertion actually proves (that a prior successful Apply's journal was finalized).
- [ ] Add the missing coverage if the intended property is worth having — a test that *does* force a post-commit failure. If the existing `:979` / `:1035` / `:1604` tests already cover it, say so in the corrected comment instead of adding a duplicate.
- [ ] Repair or delete `topologyExport.test.ts:358`. The property it intends (a half-swap is caught) is real; make the assertion test it, or remove the line and let the conditional at `:355-357` carry the guard.
- [ ] Repair or delete `topologyKindRegistry.test.ts:154` and `:83`. Replace `f(x) === f(x)` with an assertion that would fail if gating stopped deriving from the socket list.
- [ ] Run both acceptance commands and commit.

---

## Phase 6 — M4 + M5: record as accepted-with-rationale, or fix

**Fence:** `crates/oz-bridge/src/topology/persistence.rs`, `crates/oz-bridge/src/topology/commands.rs`
**Commit prefix:** `docs(topology):` · `fix(topology):`
**Acceptance:** `cargo test -p oz-bridge topology` → 0 failed (baseline 314 passed).
**Depends on:** nothing. Neither item is urgent; both are cheap.

### M4 — three helpers are `pub` and internally ungated

`validate_apply_gate`, `validate_warehouse_quota` and `save_topology_json_at_key_with_revision` carry no gate of their own; the command layer that consumes them does. The prior pass's trigger condition is *"spent for today and LIVE for any future consumer"* — **that is still the correct status.** The decision is between narrowing visibility and documenting the contract.

### M5 — `BridgeError::Internal` may carry a filesystem path

`commands.rs:679-681`, `:940-942`, `:1022-1024` all interpolate `{e}` from `open_store`. Same family, same lines, as the desktop copy.

### Boxes

- [ ] M4: either narrow the three helpers' visibility to the module, or write the contract ("callers must gate; these are not safe to call directly") next to each. Pick one and record why.
- [ ] M5: decide whether a filesystem path in an error crossing to the renderer is acceptable. If yes, say so; if no, map the error to a path-free variant at the three sites.
- [ ] Run the acceptance command and commit.

---

## Phase 7 — F6: review the canvas layer

**Fence:** **read-only.** No production file may be modified in this phase. Findings are written to a new `.agents/topology-canvas-review.md`.
**Commit prefix:** `docs(agents):`
**Acceptance:** the review document exists, carries a dated audit stamp, and states its own scope limit. **There is no test command for this phase** — it produces findings, not code.
**Depends on:** nothing. Can run concurrently with Phases 1–6.

### Why this phase exists

The review examined the backend command layer and explicitly did not examine the rest. That gap is the largest open risk on this feature and a plan that omitted it would misrepresent its own coverage:

```bash
find ui/src -ipath '*topolog*' -type f -print0 | xargs -0 wc -l | tail -1   # 57567
```

The review's own words: *"Given the finding rate in the 1,046-line command file, I would not assume it is clean."*

### What the surface contains

Inventory below is `[carried]` from a teammate's exploration, with the four headline counts independently re-measured by me:

| Measure | Value | Source |
|---|---|---|
| Total topology-named surface | **57,567 lines** | re-measured: `find ui/src -ipath '*topolog*' …` |
| Production files | ~94 files / ~26,254 lines (4,225 CSS) | `[carried]` |
| Test files | ~65 files / ~33,587 lines, ~1,244 declarations | `[carried]` |
| Canvas sub-surface | ~35 files / ~15,600 lines | `[carried]` |

The largest single units, all re-measured:

| File | Lines |
|---|---|
| `ui/src/__tests__/NodeTopologyEditor.test.tsx` | **12,257** |
| `ui/src/features/locations/NodeTopologyEditor.css` | **3,152** |
| `ui/src/features/locations/NodeTopologyEditor.tsx` | **2,478** |
| `ui/src/features/locations/nodeTopologyEditorPointer.ts` | **1,100** |
| `ui/src/features/locations/topologyContract.ts` | **1,056** |
| `ui/src/features/locations/TopologyScreen.tsx` | **1,002** |
| `ui/src/features/locations/nodeTopologyEditorKeyboard.ts` | **591** |

Two structural facts worth carrying into the review:

- **All canvas code lives under `ui/src/features/locations/`.** No generic `canvas/`, `graph/`, `editor/` or `nodes/` directory exists — `[carried]`, and consistent with the file paths above.
- **One test file holds a disproportionate share.** `NodeTopologyEditor.test.tsx` at 12,257 lines and ~549 declarations is roughly 44% of every topology test declaration in the UI — `[carried]`. If it is one monolith, it is also the likeliest place for a tautology of the F5 shape to hide.

### Boxes

- [ ] Review the canvas sub-surface for the F5 pattern first — assertions that restate production, or `A || !A` shapes. It is the cheapest defect class to find and this file is where it will be densest.
- [ ] Review the pointer, drag, keyboard and touch handlers for the F1 pattern — two consumers reading different sources of truth for the same scope.
- [ ] Assess `NodeTopologyEditor.test.tsx` (12,257 lines) as a structural question: does its size hide skipped or vacuous assertions?
- [ ] Check `ui/src/dev-mock/handlers/topology*.ts`, which the review flagged as *"the third implementation of the same contract and … a plausible place for the next divergence"*.
- [ ] Write `.agents/topology-canvas-review.md` with a dated audit stamp, a scope table, and an explicit statement of what was **not** covered.
- [ ] Do **not** fix anything found. Add the findings to this document as new phases, or write a follow-up `todo-` doc. A review that silently becomes a refactor is how a program loses its acceptance trail.
- [ ] Commit the review document.

---

## 5. Rulings needed from the owner — blocking

These are **decisions, not tasks.** A subagent cannot resolve them and must not guess. Phase 2 is fully blocked; Phases 3 and 6 are partially blocked.

1. **Is an unauthenticated branch-diagram read intended?** (Phase 2) If yes, the fix is a comment. If no, it is a three-layer signature change. The file currently argues for the check it does not perform.
2. **Is topology a global admin tool or a location-scoped one?** (Phase 3) One answer, applied to both the probe and pin. The two call sites currently disagree.
3. **Is a filesystem path crossing to the renderer acceptable?** (Phase 6, M5) The prior pass left this open.
4. **Is the diagram's `storeProfileId` allowed to select which store a Apply writes into, and if so what bounds it?** (Phase 1, F1) Measured at `bde88f7e2` and it reads as **documented design, not defect**: `commands.rs:459-463` states in the code that the value "may differ from the session's store (e.g. the admin workspace is in store A but the topology references Branch Location B)" and instructs the reader to treat the diagram value as "the authoritative scope for all workspace operations", with `session.store_id` only the legacy fallback (`:464-466`). Three sub-questions the code cannot answer, in the order they matter: (a) does `require_user_permission_scoped(..., Some(&effective_store_id), None)` at `:476-482` accept an **unscoped or global** `topology:write` grant for *any* store named in a diagram -- if yes, one session can create workspace instances in another store's database at `:677`, which is the admin case and also the blast radius; (b) the diagram record itself is keyed by **branch id**, not by store (`topology_setting_key(branch_id.as_deref())` at `:444`, `persistence.rs:101`), so the store-scoped half and the branch-scoped half of one Apply address different databases and only the store half is scope-checked; (c) a client that **omits** the Branch node fails **closed**, not open -- `semantic_branch_profile_id` (`oz-core/src/topology.rs:136-156`) returns `None` unless the graph carries semantic fields and a `store`/`branch-location` node, so `effective_store_id` falls back to the session store and `validate_apply_gate` at `:543-561` rejects a non-canonical graph before any mutation. No line was changed by this ruling. **SUB-QUESTION (b) — CLOSED BY EVIDENCE at `7d8213f24`, and it was never a defect.** The branch-keyed diagram record beside the store-keyed scope, described above as "one Apply addresses two databases and checks scope on one", is a **ruled decision recorded at the command-registration layer**: `scripts/verify-scoped-coverage.sh:38-53` — allowlist category 2, GENUINELY GLOBAL — reads "topology is a global admin tool keyed by *branch*, and `commands/topology/commands.rs` locks `state.db` and never resolves a store", names `load_topology`, `can_save_topology`, `apply_topology_diff`, `recover_pending_topology_apply_at_startup`, the four `*_topology_template` commands and the three ADR #46 revision commands, and adds that the revision trio "act on `topology_revisions` in the GLOBAL database keyed by branch (ADR #46 §1), so there is no store to resolve and a `_scoped` variant would be an empty ceremony." A `_scoped` twin being "empty ceremony" is precisely a ruling that the store axis does not apply here, so the shape this clause flagged as possible split-brain is the design, asserted by a checker that runs in CI and holds **13** allowlist entries at this tip. The range above was re-read rather than carried: my own first pass cited `:39-52`, and the paragraph actually spans `:38-53`, one line off at each end. **The original clause stays verbatim above as the record of what it looked like before the allowlist was read** — closing a sub-question with evidence is not completing a row, and nothing on this page is ticked.** **SUB-QUESTION (a) REMAINS OPEN, deliberately, and it is a different question.** Whether an unscoped or global `topology:write` grant satisfies `require_user_permission_scoped` for *any* store a client names in `storeProfileId` is unresolved, and a lane is tracing that call right now. An allowlist entry at the command layer cannot answer it: that entry says which *database a record lives in* and whether store scoping applies to the command at all, while (a) asks *whose permission is consulted before the write happens*, one level down, inside the body at `:476-482`. The two halves part on exactly that line — (b) is about the address of a record, (a) is about the authority to change it — so reading (b) closed must not be allowed to read as (a) answered. **COORDINATE STAMP.** Everything cited in this item and in the Phase 1 HOLD was re-read at `7d8213f24`, not inherited: `commands.rs` is 1047 lines and holds as cited at `:444`, `:459-463`, `:464-466`, `:476-482`, `:547-552`, `:555`, `:561`, `:614`, `:677`, `:938`, `:1021`; `crates/oz-bridge/src/topology/topology_command_tests.rs` is 368 lines with the single `"store-1"` node at `:106` reused at `:255`/`:267`/`:279`, so the fixture finding (no `apply_topology_diff` call, no two-store harness) still stands at this tip.

---

## 6. What this program does not cover, and one correction

**Corrections recorded rather than absorbed:**

- **The UI test filter.** A teammate's inventory reported **six** surface test files missed by a bare `topology` filter. Measured, the figure is **two** (`canvasStateEqual.test.ts`, `api-ipc-contract.test.ts`). Had this gone into §2 unverified, four phantom filters would have entered the acceptance command.
- **The teammate's own examples contradicted its own list** — it named `topologyContract.test.ts`, `topologyExport.test.ts` and `topologyKindRegistry.test.ts` as files *lacking* the string `topology` in their filenames, while all three appear in the matched set. The claim and its evidence disagreed, which is why it was re-measured rather than quoted.
- **`cargo test -p oz-pos-app topology` (no `--lib`)** was my first attempt and is the wrong command — its lib result is not the last line of output. Recorded because it is the mistake the next worker will make.

**Not covered by this program:**

- **No fix has been applied.** This document is the plan; the tree is unchanged except for this file.
- **The review's own limits stand.** F1's reachability is asserted from the code's comment and is closed by Phase 1's first box. The canvas is Phase 7. No suite was run for the review.
- **The `-agents-N` split is not performed.** If the owner prefers parallel files, cut on the `## Phase N` headings; the fences already partition the tree, so no coordination is lost. Do not split by *task* — only by phase.
- **The program has no single acceptance command.** Seven phases, seven gates. A green Phase 4 says nothing about Phase 1.

---

## 7. Recommended order

1. **Phase 1 (F1)** — the only integrity finding, and fully unblocked.
2. **Phase 4 (F4)** — cheapest high-value test in the program; runs independently of Phase 1.
3. **Phase 2 (M1)** — the most sensitive read in the file, but blocked on ruling §5.1.
4. **Phase 3 (F2/M3)** — one policy decision, two call sites; blocked on ruling §5.2.
5. **Phase 5 (F3/F5)** — correct the comments, repair or delete the tautologies.
6. **Phase 6 (M4/M5)** — record as accepted-with-rationale or fix.
7. **Phase 7 (F6)** — the canvas review; run it concurrently with any of the above.

Phases 1 and 4 touch disjoint files and can run in parallel. Phase 7 is read-only and can run alongside everything.
