# Orchestrator Agent 3: Route Guards, Locked Badges & Upgrade Modals

**Document:** `todo-tools-agents-3.md`  
**Role:** Orchestrator Agent 3 (Access Boundary & Upgrade UX Architect)  
**Goal:** Implement route-level access protection, render lock/upgrade badges on plan-restricted tools, and display the contextual upgrade modal when an expired or non-entitled tool is clicked.

**Target Files:** `ui/src/components/RouteGuard.tsx`, `ui/src/utils/upgrade.ts`  
**Sibling Documents:**
- [`todo-tools-agents-1.md`](./todo-tools-agents-1.md) (Agent 1 — Entitlement, Expiry & Grace Period Engine)
- [`todo-tools-agents-2.md`](./todo-tools-agents-2.md) (Agent 2 — Workspace Navigation & Home Grid Categorization)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(tools-guard): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/components/RouteGuard.tsx`
   - `ui/src/features/settings/UpgradeModal.tsx` (or `ui/src/utils/upgrade.ts`)
   - `ui/src/components/LockedBadge.tsx` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend license status (Owned by Agent 1).
   - DO NOT edit `WorkspaceHome.tsx` layout (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Inspect existing `openUpgradePricing` in `ui/src/utils/upgrade.ts`.

### Phase 3.1: Implement Locked Badges & Intercept Clicks
- [ ] Create `<LockedBadge />` component showing padlock icon and required plan tier (e.g. "Pro" or "Enterprise").
- [ ] When a cashier/manager clicks a locked or expired tool, intercept the navigation and prompt the contextual upgrade dialog.
- [ ] Wrap target administrative routes in `<RouteGuard />` to prevent bypassing via direct URL hash entry (`#/<route>`).
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(tools-guard): implement route guards, locked badges, and contextual upgrade modal"
  ```
