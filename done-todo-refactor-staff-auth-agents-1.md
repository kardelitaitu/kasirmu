# Orchestrator Agent 1: Auth & PIN Verification Core

<!-- Superseded stamp: 2026-09-13 · DSH · DO NOT EXECUTE. `commands/auth.rs`
is now 300 lines (claim: 1,189) and `authz.rs` 262: the oz-bridge campaign
moved the auth business logic to `crates/oz-bridge/src/auth.rs` (1,348
lines, tests alongside). The goal — modular headless security services —
was achieved by a different mechanism than this doc's fence anticipated.
No checklist item here was ever run. -->

**Document:** `todo-refactor-staff-auth-agents-1.md`  
**Role:** Orchestrator Agent 1 (Security & Identity Architect)  
**Goal:** Modularize authentication, PIN hashing, session generation, and lockout policy from `apps/desktop-client/src/commands/auth.rs` (1,189 lines) into headless security services.

**Target File:** `apps/desktop-client/src/commands/auth.rs`  
**Sibling Documents:**
- [`todo-refactor-staff-auth-agents-2.md`](./todo-refactor-staff-auth-agents-2.md) (Agent 2 — Staff Profile & Permissions Engine)
- [`todo-refactor-staff-auth-agents-3.md`](./todo-refactor-staff-auth-agents-3.md) (Agent 3 — Staff Management UI Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(auth-core): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/desktop-client/src/commands/auth.rs` & `auth_tests.rs`
   - `apps/desktop-client/src/commands/authz.rs` & `authz_tests.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `commands/staff.rs` (Owned by Agent 2).
   - DO NOT edit `StaffManagementScreen.tsx` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-pos-app auth authz` (or via check.sh).

### Phase 1.1: Modularize Authentication Commands
- [ ] Separate PIN login, password verification, fast switch, and session token generation into dedicated sub-handlers.
- [ ] Centralize rate limiting and brute-force lockout logic.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(auth-core): modularize PIN authentication and lockout enforcement"
  ```
