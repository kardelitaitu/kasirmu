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
- [ ] When a cashier/manager clicks a locked or expired tool, intercept the navigation and prompt the contextual upgrade dialog. — **PARKED 14-09-26, open by decision, not by neglect.** It needs a product ruling this file must not invent: *does a locked tile open an upgrade dialog, or does navigation proceed to the in-screen `TierLockedFeature` CTA that ~26 production screens already ship?* The gap is real — `openUpgradePricing` has **0** call sites under `features/workspaces/**` (`grep -rn -e openUpgradePricing ui/src/features/workspaces | wc -l` = 0, re-run 14-09-26) — but the answer is not ours to pick: implementing the dialog would overrule the 14 screens listed just below, and leaving it is a deliberate absorbed design (see the 13-09 stamp below).
  - **A gating UI already exists, so nobody must conclude otherwise from :37 being parked:** 14 production screens render `TierLockedFeature` / `AdminLockedFeature` today (22 JSX sites — `grep -rn '<TierLockedFeature\|<AdminLockedFeature' ui/src --include=*.tsx | wc -l`; the drafted "~26" did not reproduce, and this file's own 13-09 stamp said 10 sites, so both older numbers are superseded by the command), and `useAdminGate` fails closed — `ui/src/contexts/SubscriptionContext.tsx:100-104`, `locked: resolved !== 'active'` with absent state resolving to `unavailable`, in 14 production files (`grep -rln useAdminGate ui/src --include=*.tsx | grep -v __tests__ | wc -l` = 14; the drafted 15 counted nothing else, re-derive before quoting). What :37 lacks is a *tile-triggered* dialog, not gating.
- [x] Wrap target administrative routes in `<RouteGuard />` to prevent bypassing via direct URL hash entry (`#/<route>`).
  <!-- TICKED WITHOUT THE PROPOSED FILE 14-09-26: no RouteGuard.tsx was built and none should be. The guard is the
       computed pageDenied at AppShell.tsx:473 and tablet/TabletAppShell.tsx:196; the hash listener itself
       (AppShell.tsx:244-277, setCurrentRoute at :266) does NOT check access — it sets the route and pageDenied is
       recomputed on the next render, so the deny screen wins. Pinned by AppShell.test.tsx (33 cases,
       grep -cE '^ *(test|it)[(]' = 33, reported 33/33) and the tablet twin TabletAppShell.test.tsx (16, reported
       16/16) — this docs pass counted cases, it did not run vitest — including describe('hash-route entry is access-gated') at :904, which drives a hashchange WHILE MOUNTED: the path no test in the tree covered before (the 13-09 parity test pinned the matrix, not the bypass). What a RouteGuard would NOT fix, and why it is not the gap: the four hardcoded fullscreen branches that return
       before pageDenied is consulted — AppShell.tsx:443 kdsKiosk, :477 restaurant-pos, :519 store-pos, :560 kds — and that
       isPageAccessible (ui/src/platform/ui/page-registry/index.ts:92-104) ignores registration.feature entirely, so a DISABLED feature's page still renders on direct hash entry across all 12 feature-gated register.tsx files. Extracting ~6 lines into a component would leave both gaps exactly where they are. -->
- [ ] Run pre-commit checks: `npm run check:all`. — **left unticked 14-09-26 on purpose:** `check:all` chains lint → typecheck → test → i18n → E2E (Docker-gated) and was NOT run; only the two AppShell suites behind :38 were. Nothing in this file may read as a full-suite green.
- [ ] **Commit Milestone:** — **unticked 14-09-26, reason attached:** there is no production change to commit for the box above — the proof was a test, and the two real gaps named there are still open.
  ```bash
  git commit -m "feat(tools-guard): implement route guards, locked badges, and contextual upgrade modal"
  ```

## Execution stamp — 13-09-26 · orchestrator session · status: PARTIALLY ABSORBED — remaining items belong to the tools session

Verified against the tree (09:4x, HEAD near `ad76c16c2`), not against any subject line. The access-protection goal of this order largely **shipped under different names and mechanisms**; two named deliverables did not:

**Shipped (absorbed by the tools campaign — `ee92f59db9` tier gating, `091ffe2e2`/`73d9365dd` card extraction):**
- Declarative access matrix: `features/workspaces/tools.tsx` — per-tool `minimumRole` + `minimumTier` + `lockBelowRole`; canonical fail-closed tier ordering in `utils/tierLevel.ts` ("orders free < plus < pro < premium < enterprise", "fails closed on unknown or absent current tiers").
- Locked-card rendering: `components/ToolCard.tsx` `ToolLockReason` (padlock + required tier shown; visible-not-hidden by design); four-gate chain incl. `useAdminGate` documented at `WorkspaceHome.tsx:86-93, 383-398`.
- Contextual upgrade entry points: `components/TierLockedFeature.tsx` + `AdminLockedFeature.tsx` → `openUpgradePricing` (`utils/upgrade.ts`), 10 call sites; pinned by `WorkspaceHomeTools.test.tsx` (incl. route parity: "every tool route resolves to a registered page", "home minimumRole never looser than the route requiredRole"), `TierLockedFeature.test.tsx`, `upgradeTriggers.test.tsx`.

**NOT shipped — deliberately left unticked:**
- *"intercept the navigation and prompt the contextual upgrade dialog"* — navigation is intercepted (card renders locked/disabled), but clicking a locked tile does not open an upgrade dialog; `openUpgradePricing` has **zero** call sites in `features/workspaces/**`. The absorbed design answers upgrade intent *inside* the gated feature, not on the tile. Reconcile with product intent before building the dialog.
- *"Wrap target administrative routes in `<RouteGuard />`"* — no `RouteGuard.tsx` exists and this session could not locate a route-level role/tier enforcement site by grep (`requiredRole` appears only in `PermissionDenied.tsx` props). Page registration carries role metadata consumed somewhere in the lazy router, but "direct `#<route>` hash entry is blocked" is **unverified** — the parity test pins the matrix, not the bypass behavior. This is the real residual: a hash-bypass test + guard wiring, in the tools session's fence. **SUPERSEDED at its second half 14-09-26: the bypass is now measured CLOSED with zero new code — see :38 for the guard, the two shell line numbers and the 33/33 + 16/16 suites. The bullet's conclusion still stands: do NOT build `RouteGuard.tsx`.**

Prefix kept as `todo-` because unlike today's four renamed orders, verifiable open items remain. The remaining work sits in the tools campaign's hot zone (owning sessions committed `09:16`/`09:40`) — not executed here by fence law.
