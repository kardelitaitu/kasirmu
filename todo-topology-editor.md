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

- [x] Fixture feasibility, measured before this box tried to obey the instruction below: it is **not satisfiable in 15 minutes and no test was written.** `crates/oz-bridge/src/topology/topology_command_tests.rs` is 368 lines, names ONE store (`"id": "store-1"` at `:106`, reused at `:255`/`:267`/`:279`), and contains no `apply_topology_diff(` call, no `open_store`, no `SessionContext` with a differing store -- so the case below needs a two-store `DbManager` harness plus the idempotency ledger, base revision and publish path that no existing file in `crates/oz-bridge/src/topology/` builds. Per this row's own stop clause: "If the test passes before the fix, STOP" -- and a test that cannot be written without inventing the harness is the same answer one step earlier. What IS demonstrated without a harness, by reading, is the part the review recorded as unproven: the diagram-supplied id reaches `:677` and `:1021` directly from `:464-466`, so a divergent scope is reachable by construction; whether it passes `:476-482` is ruling 4(a) above, and that is an owner answer, not a fixture.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ALREADY PAID -- and the box is FALSE as written, which is the expensive kind.** Referee re-taken this pass: `ls crates/oz-bridge/src/topology/topology_command_tests.rs` -> **368** lines, `grep -c 'store-1'` -> **4**, `grep -c 'apply_topology_diff('` -> **0**, so every word the box says ABOUT THAT FILE is true. Its operative conclusion -- that a two-store `DbManager` harness exists nowhere and the case below cannot be written -- is refuted: `32dcef1d3 test(bridge): observe which store an apply writes when the diagram names another` landed **+189** lines at `apps/desktop-client/src/commands/topology/topology_command_tests.rs`, which is exactly that harness (`char_apply` at `:1743`, `char_audit_count` calling `state.db_manager.open_store(store_id)` at `:1775`, the case at `:1782`), with the rustfmt follow-up `7685f0a1d`. `docs/plans/notes.md` item 20 says it in its own words at `:1456`: "the case was built at `32dcef1d3` ..., it runs, and the paragraph above it that said the shape is unreachable is now false". **Cost of the stale line: a worker dispatched on this box builds, in the bridge crate, a harness that already exists one tree over.** No box ticked -- this row asserts infeasibility, so it needs deleting, not closing.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ALREADY PAID; the 13:15 disposition had the class right and the marker wrong.** `32dcef1d3 test(bridge): observe which store an apply writes when the diagram names another` (+189/-1 `topology_command_tests.rs`) is the feasibility measurement this box asked for; `32b87afc0 fix(desktop-client): use the errs diagnostic in the foreign-store residual-state assertion` (+2/-1) is its repair. Verified by `git show --numstat --format='' 32dcef1d3 32b87afc0`.
- [x] Write the failing test FIRST. One Apply where `SessionContext::new(..., store_id_A, ...)` and a diagram node carrying `store_profile_id: store_id_B`, with `workspace_creations` empty. Assert the pre-fix behaviour to prove the divergence is reachable — the review recorded F1's reachability as **asserted, not demonstrated** (review §7), and this box is what closes that gap. If the test passes before the fix, STOP: the premise is wrong, and the finding must be re-read rather than patched.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ALREADY PAID.** The requested case is the landed one: `apply_naming_a_foreign_store_records_which_database_receives_the_writes` at `apps/desktop-client/src/commands/topology/topology_command_tests.rs:1782` (`32dcef1d3`, +189), session store `char-store-a` against a diagram node carrying `store_profile_id: char-store-b`. **And this box's own STOP clause has already fired**: `notes.md` item 20 at `:1458` records the measured result -- "the assignment-less user was NOT stopped by the scope gate", the refusal being `PermissionDenied("subscription tier does not allow workspace type pos")`, an entitlement refusal. Per the box's own words, "If the test passes before the fix, STOP: the premise is wrong, and the finding must be re-read rather than patched" -- so the pass-to-tick route here is the re-read, which is ruling `notes.md` item 20, not a test. Not ticked: this lane ran no `cargo test`, so the "it runs" is quoted from item 20 and not re-derived here.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ALREADY PAID; the failing-test-first sequence exists as two commits, not one.** The case is in `apps/desktop-client/src/commands/topology/topology_command_tests.rs` from `32dcef1d3`, red first and repaired by `32b87afc0`, so the box is satisfied by a diff rather than by a comment.
- [ ] Apply the swap at `commands.rs:555` to open `effective_store_id`. **HOLD -- measured at `bde88f7e2`, this swap regresses a documented design.** The site is not an ownership comparison: it opens the session store DB to supply the SECOND REGISTRY to `validate_apply_gate(&[&global_db, &branch_db], ...)` at `:561`, and the comment block at `:547-552` says the either-registry read exists because scoped creates land branch profiles in the SESSION store database, so validating the global registry alone "rejected every freshly created branch with `unknown-branch-location` forever". Pointing it at `effective_store_id` alone re-creates exactly that bug. The same is true of the second site the first pass found, `:938`, which opens the session store DB to pass `Some(&branch_db)` into `save_topology_json_at_key_with_revision` (`:944-954`) -- a save-side registry, not a gate. Every real ownership comparison in the body already uses `effective_store_id` (`:614`, `:701`, `:746`, `:774`), as do the mutation (`:677`), the recovery journal (`:526`) and the audit write (`:1021`), so the divergence F1 names is between WHICH DATABASE IS CONSULTED, not between two authorities about who may write.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** Cites `docs/plans/notes.md` item 20 ("Does a global grant authorise writes into whichever store a request names?"), which is this file's section 5 item 4 and is UNANSWERED. The site is confirmed live, so the ruling is the only blocker: `grep -rn 'validate_apply_gate' crates/oz-bridge/src/topology/commands.rs apps/desktop-client/src/commands/topology/commands.rs` -> one hit, `crates/oz-bridge/src/topology/commands.rs:561`, and `sed -n '555p'` there prints `let branch_conn = ctx.db_manager.open_store(&session.store_id)` -- i.e. the row's `:555` still points where it says. `crates/oz-bridge/src/topology/commands.rs` and the app-layer `commands.rs` are both **clean** at this tip (`git status --porcelain -- apps/desktop-client/src/commands/topology/` -> no path), so the earlier briefing that the app file was mid-edit has aged out; the block is the answer, not the file.
- [ ] Re-read and correct the comment at `:547-552` to match the code's actual registry choice.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING** (same ruling as `:185` -- `notes.md` item 20). Measured so nobody re-derives it: the comment this row wants rewritten still reads as written -- `sed -n '547p' crates/oz-bridge/src/topology/commands.rs` -> "// Ownership registries: branch profiles created through the scoped" -- and a related comment in the app test file WAS corrected since, by `81af7a4f1 docs(core): correct three comments that state the opposite of the code beside them`, whose diff on `topology_command_tests.rs` replaces "the third call below uses a NEW id and is allowed to advance the document" with "a NEW id at the stale base revision is refused with topology-revision-conflict and does not advance". So the correction discipline is in motion under another lane; this row's target line is not yet touched, and what it should say depends on the ruling.
- [ ] Confirm the false-reject direction is also covered — a profile existing only in the effective store must now pass.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** "Must now pass" is a post-swap assertion, and the swap is `:185`, which is blocked on `notes.md` item 20. No test in the tree names this direction today: `grep -c 'pre-fingerprint\|already used' apps/desktop-client/src/commands/topology/topology_command_tests.rs` -> **0**, so the false-reject case is neither covered nor refutable from the committed tree.
- [x] Confirm no test regressed: `cargo test -p oz-pos-app --lib topology` → 0 failed, and the pass count has risen from the 52 baseline by the new tests.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, NOT RUN HERE.** Deliverable is a run, and the referee can disagree: `cargo test -p oz-pos-app --lib topology` fails on a compile error or any failed assert. Package name verified so the command resolves: `grep -m1 '^name' apps/desktop-client/Cargo.toml` -> `name = "oz-pos-app"`. Not ticked, and honestly so: **no cargo was run in this docs pass** (build budget, and three lanes hold Rust/CSS/ui working trees right now), so the "52 baseline, count risen" figure is not re-derived. `grep -c 'async fn \|^fn '` over the test file -> **55** declarations, which is a file census, not a pass count, and must not be read as one.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15, paid after that by `e13ee0fe4`.** Its commit body carries the referee: `cargo test -p oz-pos-app --lib topology: 57 passed 0 failed, was 55 passed 2 failed`, `rustfmt --edition 2024 --check` clean (+140/-0). **The 0-failed half is met; the other half is not the tree's** — this box says the count rose from a **52** baseline while the measured pre-state in that body is 55 passed / 2 failed, so quote 57-vs-55 and treat 52 as rotted. Box text left as written.
- [x] Run `cargo test -p oz-bridge topology` → 0 failed (baseline 314 passed).
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, NOT RUN HERE.** Same referee shape as `:188` (`cargo test -p oz-bridge topology` goes red on any regression), same reason for not ticking: no build was run tonight, so the row's "baseline 314 passed" is a remembered figure, and this pass states that rather than laundering it. Crate name verified present: `grep -m1 '^name' crates/oz-bridge/Cargo.toml` -> `name = "oz-bridge"`.
      - **PAID 2026-09-15 ~18:31 at tip `b3a46feb4` · TICKED — the run happened and its print is recorded here.** Command: `cargo test -p oz-bridge topology` from the repo root. Exit **0**. Verbatim, one line: `test result: ok. 314 passed; 0 failed; 0 ignored; 0 measured; 1000 filtered out; finished in 6.25s`. It is the **only** `test result:` line in the 335-line log (`grep -c '^test result:' -> 1`), emitted by `Running unittests src/lib.rs (target/debug/deps/oz_bridge-c9147c6aa088dd1e.exe)` -- so oz-bridge builds one test binary and 314 is that binary's topology-filtered total. **Baseline met exactly, not exceeded: 314 >= 314, and the same line says 1000 tests were filtered out**, which is the unit of the number -- it is not the crate's whole population and no claim about the other 1000 is made from it. `0 ignored` is the half that keeps this green from being vacuous-by-accident: nothing in the 314 was skipped, so a case that vanished would have printed 311. **Tip attribution:** `git rev-parse --short HEAD` read `b3a46feb4` before the run and `b3a46feb4` after it, so this result belongs to that revision and no other; `git status --porcelain -- crates/oz-bridge` was **empty** immediately before and immediately after, so no lane's in-flight edit under `crates/oz-bridge/src/topology/` was in the tree this graded. Re-derive both facts before repeating them -- they age within minutes here. Nothing outside this file was changed by this pass: run-only, zero code edits.
- [ ] Run `python scripts/verify-ipc-parity.py` → `IPC parity: OK` (no IPC surface changed, so this is a tripwire, not a fix).
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE -- the box's own words say so, and measurement agrees.** This pass RAN it: `python scripts/verify-ipc-parity.py` -> `IPC parity: OK`, exit **0**, with `info[scoped-orphans]: 24 entries allowlisted, 24 orphans measured in the tree, 22 redundant twins (no check), 2 GATED DEAD SURFACE`. It is green now, with zero Phase-1 work done, and it would be green after Phase 1 lands, because the row itself says "no IPC surface changed" -- **a command whose result cannot differ across the change is not acceptance for it, only a tripwire against a stranger's edit.** To grade anything it would have to be re-scoped to the topology arg surface; until then do not tick it off on this exit code.
- [ ] Commit with the pathspec form and report the hash.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING (contingent on `:185`).** Nothing to commit: with `:185`-`:187` open there is no pathspec set to name, and a commit of an unchanged tree would read as a landed phase. Recorded so a next lane does not "satisfy" it with an empty commit.

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
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** The row asks for the ruling and the ruling exists as a question, not an answer: `docs/plans/notes.md` item 16 at `:1410` carries it as "three sentences from the owner -- may a branch diagram be read without authentication, is topology global or location-scoped, may a filesystem path cross into the renderer -- and the program that is waiting on them", and item 16's own line `:1415` recommends "let nothing else in that program be dispatched until they land". Section 5 item 1 of this file is that first sentence. Still unanswered at this tip.
- [ ] If the ruling is *add a session*: thread `session_token` through all three layers. The shim change is mechanical; the parity gate confirms the registration.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING** (notes.md item 16, first sentence). Conditional branch -- it cannot be started before the ruling chooses it, and starting it wrong is a three-layer signature change nobody asked for.
- [ ] If the ruling is *intended*: write the reason next to the command, in the same voice as the template check's comment, and say explicitly why the diagram needs less protection than the template — because the file currently argues the other way and a future reader will otherwise "fix" it.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING** (same). This is the cheap branch: notes.md item 16 prices it at `:1414` -- "If yes, the fix is a comment. If no, it is a three-layer signature change" -- one sentence of ruling buys or cancels an engineer-day of `:219`.
- [ ] Either way, add the test that pins the chosen behaviour, so the decision is not re-litigated by the next reader.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING** (same). A test that pins "the chosen behaviour" has no behaviour to pin yet; the referee is real but its subject is undefined until item 16 is answered.
- [ ] Run the Phase 2 acceptance pair and commit.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING (contingent).** Phase 2's acceptance pair is `verify-ipc-parity` + a cargo run; the first is already green on an untouched queue (see `:190`) and the second needs a build, so running the pair now would produce two numbers about a phase that has not happened.

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
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** Section 5 item 2, filed as the second sentence of `docs/plans/notes.md` item 16 (global vs location-scoped topology). Not re-argued here: the disagreement it decides is still live in code -- `grep -rn 'fn can_save_topology'` hits `crates/oz-bridge/src/topology/commands.rs:33` and `apps/desktop-client/src/commands/topology/commands.rs:37`, and `fn pin_topology_revision` hits `crates/oz-bridge/src/topology/commands.rs:241` and `apps/desktop-client/src/commands/topology/commands.rs:144`.
- [ ] Apply the decision to `can_save_topology` (`:33-49`) — either make the probe take the branch it is probing for and use the scoped check, or state in both places why it is intentionally broader.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING**, plus a citation note: the row's `:33-49` resolves in the **bridge** copy (`crates/oz-bridge/src/topology/commands.rs:33`), not the app shim at `:37`. Say which file, or the next lane edits the wrong one. Both files are clean at this tip, so the pointer rot is the only hazard here, not dirt.
- [ ] Apply the same decision to `pin_topology_revision` (`:252-256`).
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING**, and this row's pointer is STALE at both paths: it cites `:252-256`, and `pin_topology_revision` is now at `crates/oz-bridge/src/topology/commands.rs:241` (and `:144` in the app layer) -- measured by `grep -rn 'fn pin_topology_revision'`. A line number into a file that other lanes are editing is the first thing to rot; re-find by name.
- [ ] Add the test that asserts the two checks agree for a branch-scoped user — this is the property currently pinned by nothing.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** The property is pinned by nothing today -- `grep -rn 'can_save_topology_probe_gate' apps/desktop-client/src/commands/topology/topology_command_tests.rs` finds one probe-side test at `:1290` and no agreement test between the two checks -- so the referee this box wants is writable, but what it must assert is exactly the unanswered sentence in notes.md item 16.
- [ ] Run the acceptance command and commit.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING (contingent)** on `:251`-`:254`.

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

- [x] Test 1: apply once with a given `request_id`, apply again with the same id and an identical payload. Assert the second returns the **original** revision rather than creating a new one, and that no second revision row exists.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ALREADY PAID.** `b2797ba7e test(desktop-client): cover topology replay by request_id` (+**223**, 2026-09-15) landed `a_retried_request_id_answers_from_the_ledger_without_repeating_the_mutation` at `apps/desktop-client/src/commands/topology/topology_command_tests.rs:2071`, on the shared `replay_apply` harness at `:2028`. Not ticked by this lane for the same reason as every other run-box: no cargo was run here, so the green is attributed to the commit and to item 20's record, not re-derived.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ALREADY PAID by the named commit.** `b2797ba7e test(desktop-client): cover topology replay by request_id` (+223/-0, same file) is Test 1, replay of an identical payload returning the original result; re-confirmed present at this tip.
- [x] Test 2: apply once, then apply again with the **same id and a different payload**. Assert rejection with the `already used for a different` error, and assert **nothing was mutated** by the rejected call.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW -- this is real work, and it is the INVERSE of what already exists.** `b2797ba7e` also landed `a_different_request_id_carrying_the_same_content_is_not_treated_as_a_replay` (`:2126`): different id, same content. This box asks the other question -- same id, different payload -- and it is not covered: `grep -c 'already used' apps/desktop-client/src/commands/topology/topology_command_tests.rs` -> **0**, while the production message exists at `crates/oz-bridge/src/topology/commands.rs:505` -> "topology request id was already used for a different Apply". Referee that can disagree: one test on the existing `replay_apply` harness asserting that message; it is red today because nothing reaches that branch.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15, paid since by `e13ee0fe4`.** `a_reused_request_id_carrying_a_different_payload_is_refused_by_name` exists at `apps/desktop-client/src/commands/topology/topology_command_tests.rs:2166` (verified by `grep -n`), and the commit body records the plant: written first expecting a plain `Ok(revision 1)` replay, red against `Err(Invalid("topology request id was already used for a different Apply"))`, then corrected — the assertion this box asked for, built against the real error.
- [x] Cover the pre-fingerprint ledger entry removal (`:516-519`), whose comment names the only way such an entry can exist.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW.** The branch is live and uncalled-out in tests: `sed -n '516,519p' crates/oz-bridge/src/topology/commands.rs` prints the pre-fingerprint comment and `oz_core::Settings::remove(&global_db, &request_key)?`, and `grep -c 'pre-fingerprint' apps/desktop-client/src/commands/topology/topology_command_tests.rs` -> **0**. Same harness as `:286`, so the cost is one case, not a rig.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15, paid since by `e13ee0fe4`.** `a_pre_fingerprint_ledger_entry_is_removed_rather_than_replayed` at `topology_command_tests.rs:2239` (verified by `grep -n`), same plant discipline — it first expected the seeded entry to survive and read `None` against `Some({"revision":7})`. The branch is now called out by name in a test.
- [x] Run the acceptance command and commit.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, NOT RUN HERE** -- `cargo test -p oz-pos-app --lib topology` is the referee and no build ran tonight; also contingent on `:286`/`:287` landing, since its acceptance clause is "two new tests naming the replay paths".
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15; acceptance run and commit both exist now, and they are the same SHA.** The run is the `e13ee0fe4` referee line (57 passed / 0 failed, was 55 passed / 2 failed) and the commit is that commit. **What this tick does not answer:** the wider crate gates — full unfiltered `cargo test` and `verify-ipc-parity.py` are not claimed here.

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

- [x] Correct the two comments at `topology_command_tests.rs:1188-1190` and `:1230-1235`: say the stale revision is rejected at the **early** gate, and state what the journal assertion actually proves (that a prior successful Apply's journal was finalized).
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, with the row's premise left UNGRADED by this pass.** At HEAD both comments still say the opposite of what this box instructs: `git show HEAD:apps/desktop-client/src/commands/topology/topology_command_tests.rs | sed -n '1188,1190p'` -> "the save rejects AFTER the store transaction commits, so the live error path must compensate and restore", and `:1230`-`:1235` repeats "the stale Apply fails AFTER the store transaction commits". Which text is TRUE is a claim about gate ORDER in `crates/oz-bridge/src/topology/commands.rs`, and this lane will not settle a gate-order question by reading alone -- the honest referee is a run that prints which error the second Apply returns. Note `:186`: the sibling correction discipline already landed once here (`81af7a4f1`), so this row is cheap, not blocked.
      - **PAID 2026-09-15 ~17:05 at tip `14df77e92` · TICKED — CLASS: ACTIONABLE NOW at 13:15, and the action was a wording fix, which is what its provenance licenses.** `f0420da09 docs(topology): correct two Apply comments that say the opposite of the gate order` (+22/-8 `apps/desktop-client/src/commands/topology/topology_command_tests.rs`) rewrites both cited comments; `git show f0420da09 -- apps/desktop-client/src/commands/topology/topology_command_tests.rs | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE '^[+-][[:space:]]*(//|///)'` returns **0 non-comment lines** re-measured this pass, so no behaviour moved and the box's `say the stale revision is rejected at the early gate` deliverable is exactly what landed — the corrected comment now reads `revision gate — before the journal or store transaction` at `:1097`, and `grep -c 'AFTER the store transaction'` returns **0** in both trees. **Provenance, verified here rather than carried:** the false phrase was ADDED at `abb4a3c07` (2026-09-07) — it appears as a `+` line in that commit's diff of this test file — and at that commit the only home of the Apply body was `apps/desktop-client/src/commands/topology/commands.rs`, where the revision gate already returned at `:381-388` **before** the journal write its own comment at `:498` describes; `crates/oz-bridge/src/topology/commands.rs` did not exist until `ae02a2216` (2026-09-11, `git log --diff-filter=A`). So the prose was wrong at birth rather than stranded by a later move, which is the case that licenses correcting wording instead of suspecting it hides a change. **One honest loose end, named so this row does not read as finished:** a **wrong assertion message survives at `topology_command_tests.rs:1217`** — the string a failing run would print still suggests a compensation the comment above it now denies; it is code, the lane's fence said comments only, and so it was left and reported. The follow-up is one line, and it belongs to whoever next opens that file, not to this box.
- [x] Add the missing coverage if the intended property is worth having — a test that *does* force a post-commit failure. If the existing `:979` / `:1035` / `:1604` tests already cover it, say so in the corrected comment instead of adding a duplicate.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE as written -- it is a conditional whose other branch measurement already favours.** The three tests it names exist and are the branch it says to take if they cover the property: `git show HEAD:...topology_command_tests.rs | sed -n '979p'` -> `async fn crash_after_store_commit_compensates_both_databases()`, `:1035` -> `async fn recovery_finalizes_without_compensating_a_completed_apply()`. So the deliverable is "say so in the comment", which no command can fail -- acceptance would need the corrected comment plus one named test per property, otherwise a future lane writes a duplicate.
      - **PAID 2026-09-15 ~17:05 at tip `14df77e92` · TICKED — the conditional resolved on the OTHER branch, by reading the two tests it names at HEAD rather than by writing a third.** `:979` is `crash_after_store_commit_compensates_both_databases`, whose header states the case this box asked to force — `Crash point 2: store transaction committed, global save never ran` — so a post-commit failure is already exercised and compensated on both databases; and `:1035` is `recovery_finalizes_without_compensating_a_completed_apply`, whose header carries the recovery contract's explicit promise not to compensate a completed Apply (`Crash point 3: global save committed (current == desired) but the journal is still present. In the current Apply flow the journal is cleared atomically inside the save transaction, so this state is` unreachable). Both headers were read at HEAD this pass, not cited from the 13:15 disposition. Given that, the property the conditional offered to buy is already pinned by name, so the right act was the comment correction at the row above — `f0420da09` makes the file say which test owns which crash point — and **not** a duplicate pin that would read as new coverage while grading nothing. **What this tick does not claim:** the `57 tests green` figure is `e13ee0fe4`'s own referee print, attributed; no `cargo` ran in this pass, and the box's other arm (adding a post-commit-failure test) stays deliberately un-built because the branch is false, not because it was skipped.
- [x] Repair or delete `topologyExport.test.ts:358`. The property it intends (a half-swap is caught) is real; make the assertion test it, or remove the line and let the conditional at `:355-357` carry the guard.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ALREADY PAID.** `c442feecd test(ui): replace two assertions that cannot fail with the properties the code owes` (+**14**/-4 on this file) landed it: at HEAD `ui/src/__tests__/topologyExport.test.ts:356`-`:359` the excluded-middle form survives only as a quoted comment, and `:362` asserts the material implication `!usesBackendTemplates || invokesMigration`. Verified by reading the committed file, not by a run -- `npx vitest run` was not executed tonight.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ALREADY PAID by the named commit.** `c442feecd test(ui): replace two assertions that cannot fail with the properties the code owes` (+14/-4 `ui/src/__tests__/topologyExport.test.ts`), which now carries the material implication `expect(!usesBackendTemplates || invokesMigration, ...)` at `:358-366`, with a comment saying the old `if` only ran the check in the branch where the canary had already fired. Re-read at this tip, not carried from the commit message.
- [x] Repair or delete `topologyKindRegistry.test.ts:154` and `:83`. Replace `f(x) === f(x)` with an assertion that would fail if gating stopped deriving from the socket list.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ALREADY PAID**, same commit `c442feecd` (+**40**/-3 on this file). At HEAD `ui/src/__tests__/topologyKindRegistry.test.ts:83` is `expect(iconForNode(node('store'))).toBe(StoreIcon)` and `:154` is `for (const type of held)` inside a registry-membership loop, so the `f(x) === f(x)` shape is gone from both cited lines. **Note the rot in the row itself:** those line numbers are true only after the fix, which means the row's pointers were already stale when it was read -- re-find by test name, not by line.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ALREADY PAID, same commit, other file.** `c442feecd` also lands +40/-3 in `ui/src/__tests__/topologyKindRegistry.test.ts`: `grep -n 'f(x) === f(x)'` returns **0 matches** at this tip, and the two cited lines hold real assertions (`for (const type of held)` at `:83`, `expect(iconForNode(node('store'))).toBe(StoreIcon)` at `:154`).
- [x] Run both acceptance commands and commit.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, NOT RUN HERE.** Both acceptance commands exist and can go red (`cargo test -p oz-pos-app --lib topology`, `cd ui && npx vitest run topology canvasStateEqual api-ipc-contract`); neither was run in this docs pass, and two of this phase's three boxes are ALREADY PAID, so the remaining work is the `:338`/`:339` comment pair plus one run.
      - **RUN 2026-09-15 ~14:59 at tip `e13ee0fe4` · TICKED, by the docs lane; each half names the runner that produced it.** Both acceptance commands have now been executed against this checkout and neither went red.
        - **Rust half — run by another commit, not here.** `cargo test -p oz-pos-app --lib topology` -> `test result: ok. 57 passed; 0 failed; 0 ignored; 0 measured; 92 filtered out; finished in 51.64s`, exit 0, `RUSTFLAGS`-clean (0 warning lines in the run log). It was run and printed by `e13ee0fe4 test(topology): cover the id-reuse refusal and pre-fingerprint ledger branches` (+140/-0 on `apps/desktop-client/src/commands/topology/topology_command_tests.rs`), whose same tip printed `55 passed; 2 failed` one run earlier -- the two provoked reds, so 57 is that baseline plus those two cases. This docs pass did NOT re-run it; the 52 s compile is bought from the commit that owns the change.
        - **UI half — run by this lane, docs-only, no file under `ui/` touched.** `cd ui && npx vitest run topology canvasStateEqual api-ipc-contract` -> `Test Files  61 passed (61)` / `Tests  2418 passed | 1 skipped (2419)` / `Duration  50.21s`, exit 0. The "61 files" the acceptance names is met exactly, not approximately.
        - **What this green cannot see, so it is not claimed.** Vitest grades the working tree, not a revision. The four paths foreign-dirty at the moment of the run -- `ui/src/__tests__/CartLineItem.test.tsx`, `ui/src/__tests__/CartPanel.test.tsx`, `ui/src/features/sales/CartPanelLineItem.css`, `ui/src/features/sales/components/CartLineItem.tsx` -- are matched by none of the three filters, and `ui/src/__tests__/screenExtraction.test.ts` is not in the selection either, so the known `screenExtraction` failure on an uncommitted restaurant class neither entered this run nor was certified by it. The tick says the topology UI surface is green at this tip; it says nothing about the rest of `ui`.
        - **What the tick does NOT close.** The two F3/F5 work boxes above it -- correcting the `topology_command_tests.rs` gate-order comments, and deciding whether a post-commit-failure test is still owed -- are still open, and the F5 pair was already paid by `c442feecd`. A run box is a gate, not a deliverable: Phase 5 is not finished by this commit.

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
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW** on the narrow branch only. Referee that can disagree: changing a helper to `pub(crate)`/`fn` and running `cargo check -p oz-bridge` -- an out-of-module caller turns it red, and silence means the narrowing was safe. **Measured caution:** `grep -rn 'pub fn ' crates/oz-bridge/src/topology/*.rs | wc -l` -> **44**, so "the three helpers" is not a grep-derivable set; the row must name them by signature or the next lane narrows the wrong three. The prose branch ("write the contract") has no referee at all.
- [ ] M5: decide whether a filesystem path in an error crossing to the renderer is acceptable. If yes, say so; if no, map the error to a path-free variant at the three sites.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NEEDS RULING.** Section 5 item 3, the third sentence of `docs/plans/notes.md` item 16 ("may a filesystem path cross into the renderer"), unanswered; the row's own verb is "decide".
- [ ] Run the acceptance command and commit.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, NOT RUN HERE** (`cargo test -p oz-bridge topology`, no build run tonight) -- and contingent on `:364`, so a green now would be a green over an undecided question.

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
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE** (a review step's output is a finding, and no command fails if the reviewer looks and reports nothing), **but its population is nearly empty and that is measured**: `grep -rn '|| !' ui/src/__tests__/topology*.test.ts ui/src/__tests__/NodeTopologyEditor*.test.tsx | grep -cE '\|\| !'` -> **1**, and the one hit is the explanatory comment at `topologyExport.test.ts:356` documenting the tautology that `c442feecd` already removed. The F5 sweep over the topology-named UI tests is, as of this tip, paid -- the canvas sub-surface beyond those files is what remains, and it needs a reviewer, not a box.
- [ ] Review the pointer, drag, keyboard and touch handlers for the F1 pattern — two consumers reading different sources of truth for the same scope.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE.** Same shape as `:416`: "two consumers reading different sources of truth" is a judgement, and what would make it gradable is a written finding per handler naming both consumers and the file each reads -- a table, not an exit code.
- [x] Assess `NodeTopologyEditor.test.tsx` (12,257 lines) as a structural question: does its size hide skipped or vacuous assertions?
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE**, with a citation repair: the row says 12,257 lines and `wc -l < ui/src/__tests__/NodeTopologyEditor.test.tsx` now prints **12,260** -- it grew by 3 while this file was being written tonight, which is the argument for never quoting a line count that a run can produce. Vitest reports skips/empty tests, so the falsifiable version of this box is `cd ui && npx vitest run src/__tests__/NodeTopologyEditor.test.tsx --reporter=verbose` read for `skipped` and for cases with no expect -- that run was NOT executed here.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: NO REFEREE at 13:15; the assessment has since been made, twice.** `9f47101b5 test(ui): delete the obsolete skipped simulation-pulse topology case` is the finding acted on (the `.simulation-btn` control and its `isSimulating` state were already gone; the case was deleted rather than re-widened into a `describe.skip`), and `114f99f31 docs(agents): referee the Phase-7 canvas boxes and record what this pass did not run` is the structural read. **The box's own number has rotted:** `wc -l < ui/src/__tests__/NodeTopologyEditor.test.tsx` -> **12,184**, not the 12,257 quoted above — the 62-line deletion is the delta — and the file lives under `ui/src/__tests__/`, not in the feature directory.
- [ ] Check `ui/src/dev-mock/handlers/topology*.ts`, which the review flagged as *"the third implementation of the same contract and … a plausible place for the next divergence"*.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE** as a review step; the population is confirmed to exist: `ls ui/src/dev-mock/handlers/ | grep -i topo` -> `topology-state.ts` and `topology.ts`. To be dispatchable it needs the concrete claim attached (which of the three implementations diverges, and against what), and it needs `git status` checked first -- `ui/src/dev-mock/**` was clean at this tip, but three lanes are editing `ui/src/**` right now.
- [x] Write `.agents/topology-canvas-review.md` with a dated audit stamp, a scope table, and an explicit statement of what was **not** covered.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW -- the only Phase-7 box with a real referee.** `test -f .agents/topology-canvas-review.md` -> **ABSENT** (measured this pass). The check can fail, which is what the other six rows lack: the file either exists with a dated audit stamp and a stated scope limit or it does not. New-file path therefore applies: AGENTS.md section 3's one-line `git add -- <path> && git commit -m ... -- <path>` chain, no bare `add`.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15, the one Phase-7 box with a real deliverable, and the deliverable exists.** `114f99f31` adds `.agents/topology-canvas-review.md` (+114/-0, 15,868 bytes): a dated stamp (`Date: 2026-09-15 (this pass measured 07:44Z -> 07:52Z)`), a scope table mapping cited lines to working-tree lines, and `## Scope limit — what this document does NOT examine` with seven numbered non-covers including **No test was run**. All three things this box asked for are in it.
- [ ] Do **not** fix anything found. Add the findings to this document as new phases, or write a follow-up `todo-` doc. A review that silently becomes a refactor is how a program loses its acceptance trail.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: NO REFEREE.** A prohibition has no gate -- nothing in this repo can fail because a reviewer fixed something, and this checkout's own history shows why the sentence exists (a review pass silently becoming a refactor). Keep the row as prose; it cannot become a tick.
- [x] Commit the review document.
      - **DISPOSITION 2026-09-15 ~13:15 at tip `960d00568` · CLASS: ACTIONABLE NOW, contingent on `:420`.** Referee: `git show --stat` listing exactly `.agents/topology-canvas-review.md` and nothing else -- a file list, not a subject line, per AGENTS.md section 3's shared-index hazard.
      - **PAID 2026-09-15 ~16:35 at tip `75e5e5432` · TICKED — CLASS: ACTIONABLE NOW at 13:15, contingent on the row above; both are paid now.** `git show --stat 114f99f31` -> `1 file changed, 114 insertions(+)`, one path, pathspec form. The contingency named at 13:15 resolved in the same commit.

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

---

## 7. Honest count of the 38 open boxes (2026-09-15 ~13:20, disposition pass at tip `960d00568`, no box ticked, no file outside this one touched)

**The census, by the method this file states at `:83`-`:95` (any-depth form, the anchored grep):** open -> **38**, ticked -> **0**, total -> **38**. The five classes, each box named once:

| Class | Count | Boxes |
|---|---|---|
| ACTIONABLE NOW | **11** | `:188` `:189` `:286` `:287` `:288` `:338` `:342` `:363` `:365` `:420` `:422` |
| NEEDS RULING | **15** | `:185` `:186` `:187` `:191` `:218`-`:222` `:251`-`:255` `:364` |
| NO REFEREE | **7** | `:190` `:339` `:416` `:417` `:418` `:419` `:421` |
| ALREADY PAID | **5** | `:183` `:184` (`32dcef1d3` +189, rustfmt `7685f0a1d`) · `:285` (`b2797ba7e` +223) · `:340` `:341` (`c442feecd`) |
| NEEDS FOREIGN FILE | **0** | measured, not assumed -- see the paragraph below |

**11 ACTIONABLE boxes collapse to 5 deliverables, because 6 of them are run-and-commit wrappers**: `:188` `:189` `:288` `:342` `:365` `:422` each ask for a command and a hash, not a change. The 5 are: **one test** at `:286` (same id, different payload -> `topology request id was already used for a different Apply`, `crates/oz-bridge/src/topology/commands.rs:505`, uncalled today: 0 matches in the test file), **one test** at `:287` (the pre-fingerprint `Settings::remove` branch at `:516`-`:519`), **one comment pair** at `:338`, **one visibility narrowing** at `:363`, and **one review document** at `:420`. Four are single-file sized. **So: 38 boxes, 5 deliverables** -- the same collapse the other plans tonight measured (27 to 8, 36 to 27 open), and it is stated low rather than high.

**Zero NEEDS FOREIGN FILE, and that is a correction to how this pass was briefed.** The claim reaching this lane was that `apps/desktop-client/src/commands/topology/commands.rs` was being edited right now and that Phase 7's target was mid-edit by another owner. Measured at this tip: `git status --porcelain -- apps/desktop-client/src/commands/topology/` -> **no path**, and `git status --porcelain -- ui/src/features/locations/ ui/src/__tests__/NodeTopologyEditor.test.tsx ui/src/dev-mock/handlers/` -> **no path**. The 27 dirty paths in this checkout are elsewhere -- `crates/oz-payment/**` (6), `ui/src/features/sales/**` and `restaurant/**` (9), `docs/records/JOURNAL.md`, five other `todo-*.md`, two untracked payment crates and one junk path (`ui/+~]'`) -- none of them a topology file. **The topology surface is free to work on; the gates on it are a build budget (11 boxes, every one `cargo` or `vitest`) and three unanswered owner sentences (`docs/plans/notes.md` item 16 at `:1410`, plus item 20 for `:185`), not another lane's index.** Expect that to age within the hour, and re-run the two `git status` commands before dispatching anything here.

**The single most expensive line in this file, now marked at its box:** `:183` asserts a two-store harness must be invented and, read as written, sends a worker to build one that has existed since `32dcef1d3` at `apps/desktop-client/src/commands/topology/topology_command_tests.rs:1782`. It, `:184` and `:285` `:340` `:341` are stale-plan examples, not open work: **delete or rewrite those five rows rather than dispatch them.** And `:190` is the quiet hazard of this kind of file -- a box whose command exits `0` before and after the work; this pass ran it and got `IPC parity: OK` with 24 allowlisted orphans and 2 gated dead surfaces, on a queue with nothing done.

**Not done by this pass, deliberately:** no box ticked (no acceptance command was run -- no `cargo`, no `vitest` in a 14-minute docs lane on a shared tree), no rename (AGENTS.md section 4: the file's own phase commands have not run), no line above deleted except none, and no path outside this file written. Every figure is a working-tree reading at `960d00568` in a checkout three other lanes edit: re-derive the counts before repeating them.
