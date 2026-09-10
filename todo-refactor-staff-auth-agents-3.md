# Orchestrator Agent 3: Staff Management UI Deconstruction

**Document:** `todo-refactor-staff-auth-agents-3.md`  
**Role:** Orchestrator Agent 3 (Staff Admin UI Architect)  
**Goal:** Decompose `StaffManagementScreen.tsx` (1,380 lines) into modular sub-components: staff table list, member detail/edit drawer, role matrix editor, and PIN change modal.

**Target File:** `ui/src/features/staff/StaffManagementScreen.tsx` (Baseline: 1,380 lines)  
**Sibling Documents:**
- [`todo-refactor-staff-auth-agents-1.md`](./todo-refactor-staff-auth-agents-1.md) (Agent 1 — Auth & PIN Verification Core)
- [`todo-refactor-staff-auth-agents-2.md`](./todo-refactor-staff-auth-agents-2.md) (Agent 2 — Staff Profile & Permissions Engine)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(staff-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/staff/StaffManagementScreen.tsx`
   - `ui/src/features/staff/components/` (StaffTable, StaffDrawer, RoleMatrix, StaffPinModal)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend Rust command files (Owned by Agent 1 & Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Run `npm run test -- StaffManagementScreen` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.
- [ ] Record line count of `StaffManagementScreen.tsx` (Baseline: 1,380 lines).

### Phase 3.1: Extract Staff Table & Member Drawer
- [ ] Extract `<StaffListTable />` into `components/StaffListTable.tsx`.
- [ ] Extract `<StaffDetailDrawer />` (profile fields, wage, active status) into `components/StaffDetailDrawer.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(staff-ui): extract StaffListTable and StaffDetailDrawer components"
  ```

### Phase 3.2: Extract Role Matrix & PIN Management
- [ ] Extract `<RoleAssignmentMatrix />` into `components/RoleAssignmentMatrix.tsx`.
- [ ] Extract `<StaffPinChangeModal />` into `components/StaffPinChangeModal.tsx`.
- [ ] Reduce `StaffManagementScreen.tsx` to < 400 lines (composition root).
- [ ] Verify: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(staff-ui): extract RoleAssignmentMatrix and reduce StaffManagementScreen to composition root"
  ```
