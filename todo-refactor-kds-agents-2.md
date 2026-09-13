# Orchestrator Agent 2: Order Ticket Cards & Station Timers

**Document:** `todo-refactor-kds-agents-2.md`  
**Role:** Orchestrator Agent 2 (Kitchen Display Presentation Architect)  
**Goal:** Extract order card rendering, course grouping indicators, target preparation time color codes, and line-item modifier lists from `KdsScreen.tsx` into modular presentation components.

**Target File:** `ui/src/features/kds/KdsScreen.tsx` (Render Tree)  
**Sibling Documents:**
- [`todo-refactor-kds-agents-1.md`](./todo-refactor-kds-agents-1.md) (Agent 1 — KDS Ticket State Machine & Input Peripherals)
- [`todo-refactor-kds-agents-3.md`](./todo-refactor-kds-agents-3.md) (Agent 3 — Restaurant Menu & Modifier Popups)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(kds-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/kds/components/KdsTicketCard.tsx` (NEW)
   - `ui/src/features/kds/components/KdsTicketLineItem.tsx` (NEW)
   - `ui/src/features/kds/components/KdsTimerBadge.tsx` (NEW)
   - `ui/src/features/kds/components/KdsHeaderToolbar.tsx` (NEW)
   - Lower JSX tree in `ui/src/features/kds/KdsScreen.tsx` (Lines 400+).
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit state hooks or keyboard listeners (Owned by Agent 1).
   - DO NOT edit `RestaurantMenu.tsx` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Inspect ticket rendering CSS and ARIA roles in `KdsScreen.tsx`.

### Phase 2.1: Extract Ticket Cards & Line Items
- [ ] Extract `<KdsTicketLineItem />` into `components/KdsTicketLineItem.tsx` (handles strike-through, modifier notes, course tag).
- [ ] Extract `<KdsTimerBadge />` into `components/KdsTimerBadge.tsx` (green → yellow → red preparation thresholds).
- [ ] Extract `<KdsTicketCard />` into `components/KdsTicketCard.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-ui): extract KdsTicketCard, line items, and timer badges"
  ```

### Phase 2.2: Extract KDS Header Toolbar & Screen Reduction
- [ ] Extract `<KdsHeaderToolbar />` (station filter, recall modal trigger, volume toggle).
- [ ] Reduce `KdsScreen.tsx` to orchestrating the header toolbar, ticket grid, and recall modal.
- [ ] Verify `KdsScreen.tsx` line count drops from 1,127 to < 350 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-ui): consolidate KdsHeaderToolbar and reduce KdsScreen to composition root"
  ```
