# Orchestrator Agent 3: Tenant Migration & Schema Synchronization

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
- [ ] Run `cargo check -p oz-cloud-server --bin migrate_sqlite_to_pg`.

### Phase 3.1: Decompose SQLite-to-PostgreSQL Pipeline
- [ ] Split monolithic table conversion into dedicated per-domain table adapters (catalog, sales, staff, settings).
- [ ] Add batching, foreign key integrity verification, and memory-bounded cursor reads.
- [ ] Verify compilation and tests: `cargo test -p oz-cloud-server db`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-migrate): modularize sqlite-to-pg conversion pipeline into domain adapters"
  ```
