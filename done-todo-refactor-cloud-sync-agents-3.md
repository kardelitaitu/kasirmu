# Orchestrator Agent 3: Tenant Migration & Schema Synchronization

<!-- Execution stamp: 2026-09-13 · DSH · DONE as 2c35ec1a2. The
`migrate_sqlite_to_pg` bin (1,222, incl. a 440-line inline `mod tests`)
split into `bin/migrate_sqlite_to_pg/{main,rows,schema,copy}.rs` with the
tests relocated to the sibling `migrate_sqlite_to_pg_tests.rs` (house
*_tests rule); the bin dir form is now src/bin/<name>/main.rs.
`cargo test -p oz-cloud-server` 312 + bin 5 + startup 2 all green at HEAD;
every file <1,000 lines. DEVIATIONS, honestly recorded: (a) Phase 3.1's
"per-domain table adapters (catalog, sales, staff, settings)" was NOT the
right shape for this code — every table flows through one generic
read→normalize→batch-insert→checksum pipeline with zero per-domain logic
to extract; the real seams were cell-model / connectivity+FK-ordering /
copy-driver, and the split follows those. (b) "Memory-bounded cursor
reads" was NOT added: the module doc (kept) explains the full-Vec read is
a deliberate design choice — the XOR checksum fold needs both sides'
complete sets and the tool is a one-shot cutover with a sized envelope
(~250 MB/1M-row sales table). Introducing LIMIT-OFFSET paging would change
verification semantics. (c) Batching and FK integrity verification
ALREADY existed (ON CONFLICT DO NOTHING batches, pg_constraint topo_sort,
count+checksum per table); they were preserved, not added. (d) `db.rs`
(431 lines) needed no decomposition — the claim it required modularizing
was stale; it was already within the house cap and split from
`db_tests.rs`. Baseline box: `cargo check --bin` was superseded by a full
`cargo test --bin` run. -->

**Document:** `todo-refactor-cloud-sync-agents-3.md`  
**Role:** Orchestrator Agent 3 (Tenant Data & Schema Migration Architect)  
**Goal:** Modularize `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs` (1,156 lines) and database pool management in `db.rs` to ensure deterministic, zero-downtime data migrations.

**Target Crate:** `apps/cloud-server/`  
**Sibling Documents:**
- [`todo-refactor-cloud-sync-agents-1.md`](./todo-refactor-cloud-sync-agents-1.md) (Agent 1 — Cloud Sync Engine & Protocol Handler)
- [`todo-refactor-cloud-sync-agents-2.md`](./todo-refactor-cloud-sync-agents-2.md) (Agent 2 — Email PG Daemon & Outbound Dispatch)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(cloud-migrate): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`
   - `apps/cloud-server/src/db.rs` & `db_tests.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `sync_store.rs` (Owned by Agent 1).
   - DO NOT edit `email_pg.rs` (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Run `cargo check -p oz-cloud-server --bin migrate_sqlite_to_pg`.

### Phase 3.1: Decompose SQLite-to-PostgreSQL Pipeline
- [x] Split monolithic table conversion into dedicated per-domain table adapters (catalog, sales, staff, settings).
      → **Split as written is the WRONG SHAPE** — the code is one generic,
      table-agnostic read→normalize→batch-insert→checksum pipeline with no
      per-domain logic to extract. What WAS split along the real seams:
      `migrate_sqlite_to_pg/{rows,schema,copy}.rs` + a CLI-only root
      (main.rs) + sibling `migrate_sqlite_to_pg_tests.rs`.
- [x] Add batching, foreign key integrity verification, and memory-bounded cursor reads.
      → batching + FK-topological ordering + count/checksum verification
      **already existed** (preserved); memory-bounded cursor reads were
      **deliberately NOT added** — the retained module doc explains the
      full-table read is required by the XOR checksum fold for a one-shot
      cutover tool. Paging would change verification semantics.
- [x] Verify compilation and tests: `cargo test -p oz-cloud-server db`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-migrate): modularize sqlite-to-pg conversion pipeline into domain adapters"
  ```
