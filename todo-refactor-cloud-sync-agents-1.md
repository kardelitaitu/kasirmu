# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

**Document:** `todo-refactor-cloud-sync-agents-1.md`  
**Role:** Orchestrator Agent 1 (Sync Protocol & Conflict Architect)  
**Goal:** Decompose `apps/cloud-server/src/sync_store.rs` (1,179 lines) and `sync_api.rs` to streamline revision diffing, vector clock resolution, and SQLite-to-Cloud replication.

**Target Crate:** `apps/cloud-server/src/`  
**Sibling Documents:**
- [`todo-refactor-cloud-sync-agents-2.md`](./todo-refactor-cloud-sync-agents-2.md) (Agent 2 — Email PG Daemon & Outbound Dispatch)
- [`todo-refactor-cloud-sync-agents-3.md`](./todo-refactor-cloud-sync-agents-3.md) (Agent 3 — Tenant Migration & Schema Synchronization)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(cloud-sync): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/cloud-server/src/sync_store.rs` & `sync_store_tests.rs`
   - `apps/cloud-server/src/sync_api.rs` & `sync_api_tests.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `email_pg.rs` (Owned by Agent 2).
   - DO NOT edit `bin/migrate_sqlite_to_pg.rs` or `db.rs` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-cloud-server sync` to establish baseline.

### Phase 1.1: Decompose `sync_store.rs`
- [ ] Separate storage backend adapters from conflict resolution logic.
- [ ] Extract batch mutation application into dedicated transaction chunks.
- [ ] Verify `cargo test -p oz-cloud-server sync` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-sync): decouple conflict resolution from sync storage backend"
  ```
