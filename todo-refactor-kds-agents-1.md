# Orchestrator Agent 1: KDS Ticket State Machine & Input Peripherals

**Document:** `todo-refactor-kds-agents-1.md`  
**Role:** Orchestrator Agent 1 (Kitchen Operations State Architect)  
**Goal:** Decompose ticket polling/websocket subscriptions, bump bar keyboard events, order status transitions, and audio buzzer alerts from `KdsScreen.tsx` (1,127 lines) into headless custom hooks.

**Target File:** `ui/src/features/kds/KdsScreen.tsx`  
**Sibling Documents:**
- [`todo-refactor-kds-agents-2.md`](./todo-refactor-kds-agents-2.md) (Agent 2 — Order Ticket Cards & Station Timers)
- [`todo-refactor-kds-agents-3.md`](./todo-refactor-kds-agents-3.md) (Agent 3 — Restaurant Menu & Modifier Popups)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(kds-state): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/features/kds/hooks/useKdsTickets.ts` (NEW)
   - `ui/src/features/kds/hooks/useBumpBar.ts` (NEW)
   - `ui/src/features/kds/utils/kdsAudioAlerts.ts` (NEW)
   - Hook declaration block in `ui/src/features/kds/KdsScreen.tsx` (Lines 1–350).
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `RestaurantMenu.tsx` (Owned by Agent 3).
   - DO NOT edit card presentation JSX (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `npm run test -- KdsScreen` in `ui/`.

### Phase 1.1: Extract Bump Bar Keyboard Navigation & Audio Alert
- [ ] Extract bump bar keyboard shortcuts (`Enter`, `Space`, numbers 1-9, Recall) into `hooks/useBumpBar.ts`.
- [ ] Extract sound synthesizers / buzzer audio triggers to `utils/kdsAudioAlerts.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-state): extract bump bar key navigation and audio alerts"
  ```

### Phase 1.2: Extract KDS Ticket Lifecycle State Machine
- [ ] Extract ticket fetching, LAN synchronization listeners, status updates (`bumpOrder`, `recallOrder`, `holdTicket`) into `hooks/useKdsTickets.ts`.
- [ ] Wire hook into `KdsScreen.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-state): decouple ticket lifecycle state machine into useKdsTickets"
  ```
