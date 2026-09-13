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
- [x] Inspect existing `openUpgradePricing` in `ui/src/utils/upgrade.ts`.

### Phase 3.1: Implement Locked Badges & Intercept Clicks
- [x] Create `<LockedBadge />` component showing padlock icon and required plan tier (e.g. "Pro" or "Enterprise").
  <!-- TICKED WITH DEVIATION 13-09-26: no components/LockedBadge.tsx exists; absorbed as the
       inline ToolLockReason lock rendering in features/workspaces/components/ToolCard.tsx
       (workspace-tool-lock-badge / --locked CSS classes). Same behavior, different shape. -->
- [ ] When a cashier/manager clicks a locked or expired tool, intercept the navigation and prompt the contextual upgrade dialog.
- [ ] Wrap target administrative routes in `<RouteGuard />` to prevent bypassing via direct URL hash entry (`#/<route>`).
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(tools-guard): implement route guards, locked badges, and contextual upgrade modal"
  ```

---

## Execution stamp — 13-09-26 · orchestrator session · status: PARTIALLY ABSORBED — remaining items belong to the tools session

Verified against the tree (09:4x, HEAD near `ad76c16c2`), not against any subject line. The access-protection goal of this order largely **shipped under different names and mechanisms**; two named deliverables did not:

**Shipped (absorbed by the tools campaign — `ee92f59db9` tier gating, `091ffe2e2`/`73d9365dd` card extraction):**
- Declarative access matrix: `features/workspaces/tools.tsx` — per-tool `minimumRole` + `minimumTier` + `lockBelowRole`; canonical fail-closed tier ordering in `utils/tierLevel.ts` ("orders free < plus < pro < premium < enterprise", "fails closed on unknown or absent current tiers").
- Locked-card rendering: `components/ToolCard.tsx` `ToolLockReason` (padlock + required tier shown; visible-not-hidden by design); four-gate chain incl. `useAdminGate` documented at `WorkspaceHome.tsx:86-93, 383-398`.
- Contextual upgrade entry points: `components/TierLockedFeature.tsx` + `AdminLockedFeature.tsx` → `openUpgradePricing` (`utils/upgrade.ts`), 10 call sites; pinned by `WorkspaceHomeTools.test.tsx` (incl. route parity: "every tool route resolves to a registered page", "home minimumRole never looser than the route requiredRole"), `TierLockedFeature.test.tsx`, `upgradeTriggers.test.tsx`.

**NOT shipped — deliberately left unticked:**
- *"intercept the navigation and prompt the contextual upgrade dialog"* — navigation is intercepted (card renders locked/disabled), but clicking a locked tile does not open an upgrade dialog; `openUpgradePricing` has **zero** call sites in `features/workspaces/**`. The absorbed design answers upgrade intent *inside* the gated feature, not on the tile. Reconcile with product intent before building the dialog.
- *"Wrap target administrative routes in `<RouteGuard />`"* — no `RouteGuard.tsx` exists and this session could not locate a route-level role/tier enforcement site by grep (`requiredRole` appears only in `PermissionDenied.tsx` props). Page registration carries role metadata consumed somewhere in the lazy router, but "direct `#<route>` hash entry is blocked" is **unverified** — the parity test pins the matrix, not the bypass behavior. This is the real residual: a hash-bypass test + guard wiring, in the tools session's fence.

Prefix kept as `todo-` because unlike today's four renamed orders, verifiable open items remain. The remaining work sits in the tools campaign's hot zone (owning sessions committed `09:16`/`09:40`) — not executed here by fence law.
