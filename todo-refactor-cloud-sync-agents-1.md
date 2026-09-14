# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence named `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`, a single file that does not exist — it became a module DIRECTORY at `2c35ec1a2` — and the `sync_store.rs` baseline was ~578 lines stale; both found by globbing `apps/cloud-server/src/**/*.rs` and re-measuring with `wc -l` instead of trusting the prose. -->

**Document:** `todo-refactor-cloud-sync-agents-1.md`  
**Role:** Orchestrator Agent 1 (Sync Protocol & Conflict Architect)  
**Goal:** Decompose `apps/cloud-server/src/sync_store.rs` (1,757 lines) and `sync_api.rs` (800 lines) to streamline conflict resolution and SQLite-to-Cloud replication.

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

### Phase 1.1: Decompose `sync_store.rs`
- [x] Separate storage backend adapters from conflict resolution logic.
  > **Landed — but not by this agent, and only halfway.** `conflict_resolution.rs` (401 ln, pure, no
  > I/O) is imported at `sync_store.rs:40` (`use crate::conflict_resolution::{…}`), registered at
  > `main.rs:31`, added by `230642b64` (2026-09-13). What moved out is the *classifier*; the storage
  > *adapters* are still in the same file (35 `sqlite_`/`pg_` references in `sync_store.rs`), which is
  > what the unchecked bullet below is for.
- [ ] Extract batch mutation application into dedicated transaction chunks.
  > Pre-existing partial: `sqlite_push_batch_multirow` (`sync_store.rs:615`) and
  > `pg_push_batch_multirow` (`:691`) were pulled out of `push_batch` (`:182`) by `0e52f1d46`
  > (2026-09-01) as a **perf** change, not as this refactor. `push_batch` still owns the dispatch.
- [ ] Split the SQLite and PostgreSQL adapters out of `sync_store.rs`.
  > **Bullet added by this audit (wrong-by-omission).** The file is 1,757 ln against the 1,000-line
  > production-file ceiling in `AGENTS.md` §2, and `grep -n 'mod ' sync_store.rs` returns exactly one
  > hit — `mod tests;` at `:1757` — so there is no submodule structure to inherit a split. Three
  > separate `impl SyncStore` blocks (`:84`, `:1272`, `:1457`) confirm the file has grown by
  > accretion, not by decomposition.
- [ ] Verify `cargo test -p oz-cloud-server sync` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-sync): decouple conflict resolution from sync storage backend"
  ```
  > Not exercised: `git log --format=%s | grep -c 'refactor(cloud-sync)'` = **0** (measured
  > 2026-09-14). No commit in this repository has used this agent's declared prefix, so none of
  > Phase 1.1's landed work was done under this work order.
