# Orchestrator Agent 3: Station UI, Modifier Badges & Expo Screen

**Document:** `todo-kds-agents-3.md`  
**Role:** Orchestrator Agent 3 (Kitchen UI & Expo Experience Architect)  
**Goal:** Build the dedicated Kitchen Station views and the Expediter (Expo) screen with multi-course consolidation, modifier badges (e.g. "NO ONIONS", "EXTRA CHEESE"), and priority VIP highlight tags.

**Target File:** `ui/src/features/kds/`  
**Sibling Documents:**
- [`todo-kds-agents-1.md`](./todo-kds-agents-1.md) (Agent 1 — Multi-Station KDS Routing Engine)
- [`todo-kds-agents-2.md`](./todo-kds-agents-2.md) (Agent 2 — LAN Order Event Dispatcher & State Sync)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(kds-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/kds/ExpoScreen.tsx` (NEW)
   - `ui/src/features/kds/components/ModifierBadge.tsx` (NEW)
   - `ui/src/features/kds/components/StationSelectorModal.tsx` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend routing rules (Owned by Agent 1).
   - DO NOT edit network transport (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Inspect existing `KdsScreen.tsx` and design language CSS.

### Phase 3.1: Build Modifier Badges & Course Groups
- [ ] Create `<ModifierBadge />` highlighting special instructions with red/green contrast badges.
- [ ] Group order items by kitchen course (Appetizers, Mains, Desserts).
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(kds-ui): implement modifier badges and course grouping on KDS tickets"
  ```

### Phase 3.2: Build Dedicated Expo Screen (`ExpoScreen.tsx`)
- [ ] Create `ExpoScreen.tsx` providing an aggregated bird's-eye view of all prep stations.
- [ ] Highlight tickets when all individual prep stations have bumped their items ("Ready to Serve").
- [ ] Include recall history modal to recover mistakenly bumped tickets within 15 minutes.
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(kds-ui): build Expediter (Expo) screen with cross-station order consolidation"
  ```
