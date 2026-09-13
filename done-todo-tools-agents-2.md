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
- [x] Inspect `WorkspaceHome.tsx` lines 520–700 (Tools section). → Done; the Tools render is the inline grouped-grid block, and the categorization data already lives in `tools.ts` (`TOOL_GROUP_ORDER`, `ToolGroupId`).

### Phase 2.1: Categorize Tools & Render Grid
- [x] Group tools into 3 sections: → The grouping half landed BEFORE the extraction, in `ee92f59db9` (rebuild home Tools with grouped IA and tier gate, 09-07) — Operations/Insights/Configuration come from `tools.ts`, not from this doc's execution.
  - **Operations:** Staff, Shifts, Terminals, Offline Queue, Stores.
  - **Insights:** Analytics, Reports, Audit Log.
  - **Configuration:** Settings, Tax Config, Exchange Rates, Promotions, Data Management.
- [x] Extract `<ToolCard />` component displaying tool icon, title, description, and permission/tier status. → Components were authored 09-11 04:41 by the original session, which died after only adding the two imports; the swap itself completed 09-13 at `091ffe2e29`.
- [x] Verify: `npm run typecheck`. → 09-13: `tsc --noEmit` clean repo-wide; `vitest WorkspaceHome.test.tsx` 48/48; eslint clean on all three files; pre-commit bundle-parity 0 missing keys.
- [x] **Commit Milestone:** → LANDED `091ffe2e29`. DEVIATION (recorded): the verbatim mandated subject describes the categorization half, which had already landed in `ee92f59db9`; a commit's subject must describe its own diff, so this one reads `refactor(tools-ui): finish the ToolCard/ToolsCategoryGrid extraction left in flight in WorkspaceHome`.
  ```bash
  git commit -m "feat(tools-ui): categorize Tools grid into Operations, Insights, and Configuration"
  ```

---

## Completion record (closed by a manager-level pass, 2026-09-13)

The assigned session wrote both components (09-11 04:41:24 / :04:41:29) and
the two import lines in `WorkspaceHome.tsx`, then stopped **mid-swap**:
inline JSX still present, local `type ToolLockReason` still present, so the
working tree was typecheck-red (TS2440 duplicate identifier, TS6133 unused
import). Its session journals (`ui-coder-52/53/54-journal.md`) were later
deleted by housekeeping commit `2bb16752a`, leaving the state with no owner.
Nothing caught it: HEAD stayed green (the bad imports were never committed),
CI only runs on PRs while work lands directly on `0.0.37`, and `1c59fea5f`
had just moved the repo-wide typecheck off the pre-commit hook — the state
was already logged as FOREIGN-red by the pos-screen lane the same afternoon
(`docs/archived/manager-2-journal-posscreen.md` LIVE block, 09-11 14:2xZ; archived root-relative since the journal moved).

Closed by commit `091ffe2e29` (one-line pathspec form: `WorkspaceHome.tsx`,
`components/ToolCard.tsx`, `components/ToolsCategoryGrid.tsx`):
local type alias removed (imported one kept); 84-line inline Tools block
replaced by `<ToolsCategoryGrid groups={toolGroups} onNavigate={handleShortcutNav}
getAriaLabel={(key) => l10n.getString(key)} />`; the wrapper-only
`visibleTools` memo removed; and the `'hidden'` filter in `toolGroups`
became a TYPE PREDICATE — a plain boolean filter leaves `'hidden'` in the
element type and the prop would not check against the component contract,
so the stalled agent's "verify" box could not have passed without this.
Verified behavior-preserving by the existing testid-pinning suite
(`ui/src/__tests__/WorkspaceHome.test.tsx`, 48/48 — the components carry
identical `workspace-tool-card`/`workspace-tool-card-locked` testids,
classes, and Localized keys).
