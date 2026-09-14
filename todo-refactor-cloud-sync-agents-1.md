# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence named `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`, a single file that does not exist — it became a module DIRECTORY at `2c35ec1a2` — and the `sync_store.rs` baseline was ~578 lines stale; both found by globbing `apps/cloud-server/src/**/*.rs` and re-measuring with `wc -l` instead of trusting the prose. -->

> **Line-number drift from the sizing pass (2026-09-14): the bullets that pass cites by line have
> moved, so both forms appear in this file and this is the map as of THIS pass's final write —
> `:51` now `:59` · `:58` now `:67` · `:64` now `:76` · `:68` now `:94` · `:74` now `:100`. Re-derive before quoting one of these pointers
> after any further edit: a line reference is only true of the revision it was taken from, which is
> the failure class every note below exists to prevent.**

**Document:** `todo-refactor-cloud-sync-agents-1.md`  
**Role:** Orchestrator Agent 1 (Sync Protocol & Conflict Architect)  
**Goal:** Decompose `apps/cloud-server/src/sync_store.rs` (1,757 lines) and `sync_api.rs` (800 lines) to streamline conflict resolution and SQLite-to-Cloud replication.  

> ⚠️ **Honesty pass 2026-09-14 (measured): this Goal line oversells. It is left exactly as written so that no coder is dispatched to re-do shipped work.** Conflict resolution has **already moved out of the file** — `apps/cloud-server/src/conflict_resolution.rs`, 401 ln, pure (no I/O), imported at `sync_store.rs:40`, created by `230642b64` (2026-09-13, *feat(sync-cloud): classify concurrent sync mutations and persist conflict rows*) on the sync-conflict lane, not under this work order. Version vectors are **real and in use**: `use platform_sync::crdt::VersionVector;` at `sync_store.rs:47`, **26** `VersionVector` references across `apps/cloud-server/src/` (`grep -rn VersionVector apps/cloud-server/src | wc -l` = 26), over `platform/sync/src/crdt/version_vector.rs` (146 ln). **What this document still owns is `:68`, and `:68` is a STRUCTURAL / POLICY split: funding it buys `AGENTS.md` §2 compliance — `wc -l apps/cloud-server/src/sync_store.rs` = **1,757** against the 1,000-line production-file ceiling — it does not buy a better sync. That is the honest sales pitch, and no phase here changes replication behaviour (where behaviour work lives: the closing note).**

> ⚠️ **Baseline correction (audit 2026-09-14, measured):** the Goal named "1,179 lines" for
> `sync_store.rs`. `wc -l apps/cloud-server/src/sync_store.rs` = **1,757** today. It was **1,232**
> at `1af143f23` (the commit that added this document), so the quoted figure matched no revision of
> the file. Counts here are `wc -l`; a ±1 difference against a split-on-newline measure is method,
> not error.
> The Goal also named a mechanism that does not exist: **"revision diffing"** — the string
> `revision` appears **0 times** anywhere in `apps/cloud-server/`. The pull path pages by a `since`
> timestamp plus an opaque `cursor`/`next_cursor` (`sync_api.rs:357-361`), which the following
> sentence now says instead.
> **"Vector clock resolution"** was nearly deleted by an earlier audit pass on the grounds that
> `vector_clock` returns 0 hits. That correction is **rejected**: the mechanism is real and is called
> a **version vector** — `platform/sync/src/crdt/version_vector.rs` (146 ln), imported at
> `sync_store.rs:47` (`use platform_sync::crdt::VersionVector;`) and consumed by
> `conflict_resolution.rs` (26 `VersionVector` references across `apps/cloud-server/src/`).
> Vocabulary differing from the doc is not absence of the feature.

**Target Crate:** `apps/cloud-server/src/` (Cargo package name is `oz-cloud-server`)  
**Sibling Documents:**
- `done-todo-refactor-cloud-sync-agents-2.md` (Agent 2 — Email PG Daemon & Outbound Dispatch) — **finished and archived**. Its slice has landed: `email_pg.rs` is now a 75-line module header over four children (`analytics.rs` 712, `popularity.rs` 401, `queue_worker.rs` 373, `settings_store.rs` 114), split by `01e62dec1`.
- `done-todo-refactor-cloud-sync-agents-3.md` (Agent 3 — Tenant Migration & Schema Synchronization) — **finished and archived**.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(cloud-sync): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/cloud-server/src/sync_store.rs` (1,757 ln) & `sync_store_tests.rs` (1,386 ln)
   - `apps/cloud-server/src/sync_api.rs` (800 ln) & `sync_api_tests.rs` (2,525 ln)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `email_pg.rs` **or the `email_pg/` module directory** (owned by Agent 2 — already decomposed by `01e62dec1`).
   - DO NOT edit `src/bin/migrate_sqlite_to_pg/` — a **directory** (`main.rs` 215, `copy.rs` 168, `rows.rs` 324, `schema.rs` 125, `migrate_sqlite_to_pg_tests.rs` 441) — or `db.rs` (431 ln). Owned by Agent 3.
     > ⚠️ This fence previously named `bin/migrate_sqlite_to_pg.rs` as a single file. It is not one:
     > `2c35ec1a2` (2026-09-13) split the bin into the module directory above, so the Agent 3
     > decomposition this roadmap anticipated has already happened.
   - DO NOT edit `conflict_resolution.rs` (401 ln) — created on the sync-conflict lane by `230642b64`, not by this agent. See Phase 1.1.

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-cloud-server sync` to establish baseline.
  > Package name verified: `apps/cloud-server/Cargo.toml:2` declares `name = "oz-cloud-server"`, so
  > the command is well-formed, and the suite exists (`sync_store_tests.rs`: 20 `#[tokio::test]`,
  > 0 plain `#[test]`). **The test run itself was NOT performed by this docs audit** (it is a cargo
  > build, out of scope here), so the box stays unticked: valid command, unknown result.
  > **Sizing pass 2026-09-14 — and the command as written cannot be honestly ticked whatever the pass count reads.** Of the 20 `#[tokio::test]` cases in `sync_store_tests.rs`, **SEVEN** `pg_integration_*` cases (`:272`, `:451`, `:515`, `:576`, `:1016`, `:1115`, `:1185`) open with `let Some((pool, db_name)) = throwaway_pool().await else { eprintln!("… skipped: cannot create throwaway DB"); return; };` — at `:273`, `:452`, `:516`, `:577`, `:1017`, `:1116`, `:1186`. **A `return` inside the `else` arm is a PASS to cargo, not a test that ran: "20 passed" can mean "13 ran".** Condition for a tick: container **`oz-pg-test-15432`** up (`scripts/reset-dev-pg.sh` names it; the suite dials `postgres://postgres:postgres@localhost:15432/postgres` unless `OZ_TEST_PG_URL` is set — `sync_store_tests.rs:15-16`), **and** the captured output must show **ZERO `skipped:` lines** — grep the log, do not eyeball the summary. Not theoretical: `sync_store_tests.rs:42-44` records that the hex-only `.simple()` DB names exist because UUID `Display` hyphens made `CREATE DATABASE` a syntax error and *"silently skipped every sync-store PG test"*. This exact suite has already been green while skipping everything.

### Phase 1.1: Decompose `sync_store.rs`
- [x] Separate storage backend adapters from conflict resolution logic.
  > **Landed — but not by this agent, and only halfway.** `conflict_resolution.rs` (401 ln, pure, no
  > I/O) is imported at `sync_store.rs:40` (`use crate::conflict_resolution::{…}`), registered at
  > `main.rs:31`, added by `230642b64` (2026-09-13). What moved out is the *classifier*; the storage
  > *adapters* are still in the same file (35 `sqlite_`/`pg_` references in `sync_store.rs`), which is
  > what the unchecked bullet below is for. Re-counted 2026-09-14: `grep -o -E 'sqlite_|pg_' apps/cloud-server/src/sync_store.rs | wc -l` = **35**.
  > **So this `[x]` means CLASSIFIER OUT, ADAPTERS STILL IN — the classifier moved while the adapters
  > did not. It is PARTIAL-BY-OTHERS and must not be read as "split done"; the split is the unchecked
  > `:68` below, and it is still open.**
- [ ] Extract batch mutation application into dedicated transaction chunks.
  > Pre-existing partial: `sqlite_push_batch_multirow` (`sync_store.rs:615`) and
  > `pg_push_batch_multirow` (`:691`) were pulled out of `push_batch` (`:182`) by `0e52f1d46`
  > (2026-09-01) as a **perf** change, not as this refactor. `push_batch` still owns the dispatch.
  > **Sizing pass 2026-09-14 — read this as MOSTLY IN, not NOT STARTED. It stays unticked, because what
  > remains is ownership, not code.** Anchors re-measured: `push_batch` at `sync_store.rs:182`;
  > `sqlite_push_batch_multirow` defined at `:615` and `pg_push_batch_multirow` at `:691`, called from
  > `push_batch`'s two arms at **`:226`** and **`:270`**. The code's own header audit block at
  > `sync_store.rs:1-6` already states the landed state — *CS-3 FIXED — the SQLite push_batch arm now
  > runs in one transaction. PERF 2026-09: push_batch multi-row fast path …* — and `0e52f1d46`
  > (*perf(cloud): multi-row push insert fast path (PG + SQLite)*, 2026-09-01) predates **this
  > document**, which was added 2026-09-10 by `1af143f23`. **What remains, exactly:** `push_batch`
  > still owns the conflict-detection pre-pass (`:197-219`), the `match self` backend dispatch
  > (`:221`), the fast-path-then-fallback decision in BOTH arms, and the whole fallback inline — the
  > SQLite single-transaction per-item loop (`:233-264`) and the PG SAVEPOINT-per-item loop from `:274`.
  > Ticking this box needs either that ownership extracted behind a named chunk type both adapters
  > share, or a recorded ruling that the `0e52f1d46` shape **is** the transaction chunks and the bullet
  > retires as done-by-perf. Two extracted functions are not that; do not tick on their strength.
- [ ] Split the SQLite and PostgreSQL adapters out of `sync_store.rs`.
  > **Bullet added by this audit (wrong-by-omission).** The file is 1,757 ln against the 1,000-line
  > production-file ceiling in `AGENTS.md` §2, and `grep -n 'mod ' sync_store.rs` returns exactly one
  > hit — `mod tests;` at `:1757` — so there is no submodule structure to inherit a split. Three
  > separate `impl SyncStore` blocks (`:84`, `:1272`, `:1457`) confirm the file has grown by
  > accretion, not by decomposition.
- [ ] Verify `cargo test -p oz-cloud-server sync` passes.
  > **Sizing pass 2026-09-14 — the same condition as `:51` above, and it is the whole point of this box:**
  > "passes" is not "ran". Tick only on a run against a live `oz-pg-test-15432` whose captured output
  > contains **zero `skipped:` lines**. With the container down, 7 of the 20 cases `return` as a pass,
  > so on a default developer machine this box is greenest exactly when it has verified least.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-sync): decouple conflict resolution from sync storage backend"
  ```
  > Not exercised: `git log --format=%s | grep -c 'refactor(cloud-sync)'` = **0** (measured
  > 2026-09-14). No commit in this repository has used this agent's declared prefix, so none of
  > Phase 1.1's landed work was done under this work order.

---

> 📌 **REAL BEHAVIOUR WORK IS ELSEWHERE — named so nobody opens it here (paths verified 2026-09-14,
> all four exist).** `docs/specs/_active/p1-sync-batching-compression-retention.md`,
> `docs/specs/_active/p2-sync-priority-concurrency.md`,
> `docs/specs/_active/p3-sync-pagination-snapshot-observability.md`, and
> `docs/decisions/2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md` (*ADR #43: Cloud Sync
> Performance & Scale-Out Roadmap*). This file is a **file-size and ownership decomposition plan**:
> Phases 1.0–1.1 move code between files and change no sync semantics. Two cautions on those links —
> the three specs carry `2026-07-22` / `2026-07-24` audit stamps reading **STALE**, re-measure before
> costing from them, and ADR43's own status line already reads *Implemented (D1–D4, D7, D9-ready) —
> remaining items deferred or infra-only* (2026-09-02). **Every box in this plan is left as found:
> `:58` ticked as partial-by-others, all others unticked, and no line target here is retired — the
> 1,757-line file still has to be split.**
