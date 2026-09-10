# Orchestrator Agent 3: Manager Conflict Resolution UI & Audit Trail

**Document:** `todo-sync-conflict-agents-3.md`  
**Role:** Orchestrator Agent 3 (Conflict Review & Audit UX Architect)  
**Goal:** Build a specialized administrative screen (`SyncConflictReviewScreen.tsx`) where store managers can review flagged data conflicts, compare store versions side-by-side, choose winning revisions, and track resolution audit history.

**Target File:** `ui/src/features/sync/SyncConflictReviewScreen.tsx` (NEW)  
**Sibling Documents:**
- [`todo-sync-conflict-agents-1.md`](./todo-sync-conflict-agents-1.md) (Agent 1 — Core CRDT & Additive Delta Math)
- [`todo-sync-conflict-agents-2.md`](./todo-sync-conflict-agents-2.md) (Agent 2 — Cloud Conflict Detection & Vector Clock Orchestrator)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/sync/SyncConflictReviewScreen.tsx` (NEW)
   - `ui/src/features/sync/components/ConflictDiffViewer.tsx` (NEW)
   - `ui/src/api/syncConflicts.ts` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit CRDT math in `platform/sync/` (Owned by Agent 1).
   - DO NOT edit cloud server endpoints (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Inspect existing offline queue screen (`OfflineQueueScreen.tsx`).

### Phase 3.1: Build Conflict Diff Viewer & Action Modals
- [ ] Create `<ConflictDiffViewer />` displaying side-by-side comparison of conflicting records (Terminal A vs Cloud / Terminal B).
- [ ] Provide single-click resolution actions: `Accept Store A`, `Accept Cloud`, or `Custom Merge`.
- [ ] Connect actions to `resolveSyncConflictScoped` IPC command.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-ui): build ConflictDiffViewer with side-by-side version comparison and resolution actions"
  ```

### Phase 3.2: Build Dedicated Review Screen (`SyncConflictReviewScreen.tsx`)
- [ ] Create `SyncConflictReviewScreen.tsx` with severity filter tabs (High: Inventory/Money, Medium: Customer profile, Low: Catalog tag).
- [ ] Add navigation entry in Tools → Operations menu.
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-ui): build SyncConflictReviewScreen with severity filters and audit logging"
  ```
