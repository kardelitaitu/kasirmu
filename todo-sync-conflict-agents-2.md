# Orchestrator Agent 2: Cloud Conflict Detection & Vector Clock Orchestrator

**Document:** `todo-sync-conflict-agents-2.md`  
**Role:** Orchestrator Agent 2 (Cloud Distributed Reconciliation Architect)  
**Goal:** Enhance `apps/cloud-server/src/sync_store.rs` and database persistence to detect branching vector clocks, flag concurrent conflicting mutations, and auto-merge non-overlapping attribute edits.

**Target Crate:** `apps/cloud-server/src/sync_store.rs`  
**Sibling Documents:**
- [`todo-sync-conflict-agents-1.md`](./todo-sync-conflict-agents-1.md) (Agent 1 — Core CRDT & Additive Delta Math)
- [`todo-sync-conflict-agents-3.md`](./todo-sync-conflict-agents-3.md) (Agent 3 — Manager Conflict Resolution UI & Audit Trail)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-cloud): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `apps/cloud-server/src/sync_store.rs` (conflict detection block)
   - `apps/cloud-server/src/conflict_resolution.rs` (NEW)
   - Cloud database table `sync_conflicts`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `platform/sync/src/crdt/` (Owned by Agent 1).
   - DO NOT edit UI review screens (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Inspect conflict logging in `apps/cloud-server/src/sync_store.rs`.

### Phase 2.1: Implement Vector Clock Conflict Detector
- [ ] Compare incoming mutation vector clock against latest cloud state.
- [ ] If mutations diverge concurrently on the same entity and cannot be auto-merged by CRDT, insert row into `sync_conflicts` table.
- [ ] Expose query endpoints `GET /api/v1/sync/conflicts` and `POST /api/v1/sync/conflicts/:id/resolve`.
- [ ] Verify: `cargo test -p oz-cloud-server sync`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-cloud): implement vector clock conflict detection and resolution endpoints"
  ```
