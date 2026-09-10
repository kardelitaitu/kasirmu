# Orchestrator Agent 3: Restaurant Menu, Course Grouping & Modifier Popups

**Document:** `todo-refactor-kds-agents-3.md`  
**Role:** Orchestrator Agent 3 (Menu & Modifier Experience Architect)  
**Goal:** Decompose `RestaurantMenu.tsx` (1,114 lines) from a monolithic menu grid into modular category tab bars, product tiles, modifier selection modals, and course assignment controllers.

**Target File:** `ui/src/features/restaurant/RestaurantMenu.tsx` (Baseline: 1,114 lines)  
**Sibling Documents:**
- [`todo-refactor-kds-agents-1.md`](./todo-refactor-kds-agents-1.md) (Agent 1 — KDS Ticket State Machine & Input Peripherals)
- [`todo-refactor-kds-agents-2.md`](./todo-refactor-kds-agents-2.md) (Agent 2 — Order Ticket Cards & Station Timers)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(restaurant-menu): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/restaurant/RestaurantMenu.tsx`
   - `ui/src/features/restaurant/components/` (NEW directory)
     - `MenuCategoryTabBar.tsx`
     - `MenuItemGrid.tsx`
     - `MenuItemTile.tsx`
     - `ItemModifierModal.tsx`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `KdsScreen.tsx` or KDS hooks (Owned by Agent 1 & Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Run `npm run test -- RestaurantMenu` in `ui/`.

### Phase 3.1: Extract Modifier Modal & Item Tiles
- [ ] Extract `<ItemModifierModal />` into `components/ItemModifierModal.tsx` (handles option groups, min/max selection, price delta).
- [ ] Extract `<MenuItemTile />` into `components/MenuItemTile.tsx` (86'd out-of-stock badge, picture/monogram, price pill).
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(restaurant-menu): extract ItemModifierModal and MenuItemTile components"
  ```

### Phase 3.2: Extract Category Bar & Reduce `RestaurantMenu.tsx`
- [ ] Extract `<MenuCategoryTabBar />` and `<MenuItemGrid />`.
- [ ] Reduce `RestaurantMenu.tsx` to a clean composition shell.
- [ ] Verify `RestaurantMenu.tsx` line count drops from 1,114 to < 300 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(restaurant-menu): modularize category tabs and reduce RestaurantMenu to composition root"
  ```
