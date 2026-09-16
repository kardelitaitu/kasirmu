# Orchestrator Agent 1: Entitlement, Expiry & Grace Period Engine

**Document:** `todo-tools-agents-1.md`  
**Role:** Orchestrator Agent 1 (License & Entitlement Architect)  
**Goal:** Implement authoritative server-side license verification, 14-day offline grace countdowns, and capability checking in `oz-core` so tools lock deterministically when expired.

**Target Crates:** `crates/oz-core/src/subscription.rs`, `apps/desktop-client/src/commands/license.rs`  
**Sibling Documents:**
- [`todo-tools-agents-2.md`](./todo-tools-agents-2.md) (Agent 2 — Workspace Navigation & Home Grid Categorization)
- [`done-todo-tools-agents-3.md`](../../done-todo-tools-agents-3.md) (Agent 3 — Route Guards, Locked Badges & Upgrade Modals)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(tools-entitlement): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `crates/oz-core/src/subscription.rs`
   - `apps/desktop-client/src/commands/license.rs`
   - `apps/desktop-client/src/commands/subscription.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `WorkspaceHome.tsx` (Owned by Agent 2).
   - DO NOT edit upgrade modal UI (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [x] Review `todo-tools.md` §Subscription/auth verification.

### Phase 1.1: Expose Expiry and Grace Status to IPC DTO
- [x] Extend `SubscriptionCapabilitiesDto` to return `status`, `expiresAt`, `graceUntil`, and `isExpired`.
- [x] Connect `check_license_status` to refresh local capability cache upon successful license-server response.
- [x] Verify: `python scripts/verify-ipc-parity.py`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "feat(tools-entitlement): expose expiry timestamps and grace period status in subscription DTO"
  ```
