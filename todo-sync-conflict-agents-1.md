# Orchestrator Agent 1: Core CRDT & Additive Delta Math

**Document:** `todo-sync-conflict-agents-1.md`  
**Role:** Orchestrator Agent 1 (Distributed State & CRDT Architect)  
**Goal:** Implement Conflict-Free Replicated Data Type (CRDT) counter semantics and additive delta mutation tracking in `platform-sync` for offline numerical fields (stock inventory counts, customer loyalty points, gift card balances).

**Target Crate:** `platform/sync/`  
**Sibling Documents:**
- [`todo-sync-conflict-agents-2.md`](./todo-sync-conflict-agents-2.md) (Agent 2 — Cloud Conflict Detection & Vector Clock Orchestrator)
- [`todo-sync-conflict-agents-3.md`](./todo-sync-conflict-agents-3.md) (Agent 3 — Manager Conflict Resolution UI & Audit Trail)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-crdt): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `platform/sync/src/crdt/` (NEW)
     - `pn_counter.rs`
     - `lww_register.rs`
     - `delta_mutation.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit cloud server sync storage (Owned by Agent 2).
   - DO NOT edit front-end review UI (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Inspect existing sync transaction log in `platform/sync`.

### Phase 1.1: Implement Additive Delta Math & LWW Registers
- [ ] Implement Positive-Negative Counter (PN-Counter) for stock decrements and point redemptions.
- [ ] Implement Last-Write-Wins (LWW) with logical Lamport timestamps for catalog metadata.
- [ ] Verify: `cargo test -p platform-sync crdt`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-crdt): implement PN-Counter and Lamport timestamp delta math in platform-sync"
  ```
