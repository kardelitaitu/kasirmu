# Orchestrator Agent 2: Staff Profile & Permissions Engine

<!-- Superseded stamp: 2026-09-13 · DSH · DO NOT EXECUTE. `commands/staff.rs`
is now 276 lines (claim: 1,248): the oz-bridge campaign moved staff
lifecycle/RBAC logic to `crates/oz-bridge/src/staff.rs` (1,401 lines,
1,514 lines of tests). Same fate as staff-auth-agents-1. No checklist item
here was ever run. -->

**Document:** `todo-refactor-staff-auth-agents-2.md`  
**Role:** Orchestrator Agent 2 (RBAC & Staff Operations Architect)  
**Goal:** Modularize staff member lifecycle, role assignments, wage settings, and audit event dispatching from `apps/desktop-client/src/commands/staff.rs` (1,248 lines).

**Target File:** `apps/desktop-client/src/commands/staff.rs`  
**Sibling Documents:**
- [`todo-refactor-staff-auth-agents-1.md`](./todo-refactor-staff-auth-agents-1.md) (Agent 1 — Auth & PIN Verification Core)
- [`todo-refactor-staff-auth-agents-3.md`](./todo-refactor-staff-auth-agents-3.md) (Agent 3 — Staff Management UI Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(staff-ops): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `apps/desktop-client/src/commands/staff.rs` & `staff_tests.rs`
   - `apps/desktop-client/src/commands/staff_role_holders_tests.rs`
   - `apps/desktop-client/src/commands/staff_security_events_tests.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `commands/auth.rs` (Owned by Agent 1).
   - DO NOT edit `StaffManagementScreen.tsx` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Run `cargo test -p oz-pos-app staff` (or via check.sh).

### Phase 2.1: Decompose Staff Command Suite
- [ ] Separate staff CRUD, role assignment validation, hourly wage tracking, and security event logging into focused modules.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(staff-ops): decompose staff CRUD, RBAC assignment, and audit event dispatch"
  ```
