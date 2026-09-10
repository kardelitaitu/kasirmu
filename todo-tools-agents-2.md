# Orchestrator Agent 2: Workspace Navigation & Home Grid Categorization

**Document:** `todo-tools-agents-2.md`  
**Role:** Orchestrator Agent 2 (Admin Portal & Navigation Architect)  
**Goal:** Redesign the Tools section in `ui/src/features/workspaces/WorkspaceHome.tsx` into clear operational categories (Operations, Insights, Configuration) with role-based and tier-based filtering.

**Target File:** `ui/src/features/workspaces/WorkspaceHome.tsx` (Baseline: 886 lines)  
**Sibling Documents:**
- [`todo-tools-agents-1.md`](./todo-tools-agents-1.md) (Agent 1 — Entitlement, Expiry & Grace Period Engine)
- [`todo-tools-agents-3.md`](./todo-tools-agents-3.md) (Agent 3 — Route Guards, Locked Badges & Upgrade Modals)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(tools-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/workspaces/WorkspaceHome.tsx`
   - `ui/src/features/workspaces/components/ToolsCategoryGrid.tsx` (NEW)
   - `ui/src/features/workspaces/components/ToolCard.tsx` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend subscription code (Owned by Agent 1).
   - DO NOT edit route guards or upgrade pricing modal (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Inspect `WorkspaceHome.tsx` lines 520–700 (Tools section).

### Phase 2.1: Categorize Tools & Render Grid
- [ ] Group tools into 3 sections:
  - **Operations:** Staff, Shifts, Terminals, Offline Queue, Stores.
  - **Insights:** Analytics, Reports, Audit Log.
  - **Configuration:** Settings, Tax Config, Exchange Rates, Promotions, Data Management.
- [ ] Extract `<ToolCard />` component displaying tool icon, title, description, and permission/tier status.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(tools-ui): categorize Tools grid into Operations, Insights, and Configuration"
  ```
