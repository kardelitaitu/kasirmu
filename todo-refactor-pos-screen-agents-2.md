# Orchestrator Agent 2: Cart UI Panels, Modals & Peripherals

**Document:** `todo-refactor-pos-screen-agents-2.md`  
**Role:** Orchestrator Agent 2 (UI Decomposition & Peripheral Wiring)  
**Goal:** Extract large JSX sub-trees from `PosScreen.tsx` (cart line items, totals footer, action bar, promotions modal, price override modal, and hardware listeners) into modular presentation components. Reduce `PosScreen.tsx` into a thin composition root.

**Target File:** `ui/src/features/sales/PosScreen.tsx`  
**Sibling Documents:**
- [`todo-refactor-pos-screen-agents-1.md`](./todo-refactor-pos-screen-agents-1.md) (Agent 1 — Cart Engine & State Architect)
- [`todo-refactor-pos-screen-agents-3.md`](./todo-refactor-pos-screen-agents-3.md) (Agent 3 — PaymentModal & Split Tenders Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 2 MUST use:
     - `refactor(pos-ui): ...`
3. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/sales/components/CartPanel.tsx` (NEW)
   - `ui/src/features/sales/components/CartLineItem.tsx` (NEW)
   - `ui/src/features/sales/components/CartFooterTotals.tsx` (NEW)
   - `ui/src/features/sales/components/CartActionBar.tsx` (NEW)
   - `ui/src/features/sales/components/CourseSelectorBar.tsx` (NEW)
   - *JSX Render Tree only* in `ui/src/features/sales/PosScreen.tsx` (Lines 800+).
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit state hooks or calculation logic at the top of `PosScreen.tsx` (Owned by Agent 1).
   - DO NOT edit `PaymentModal.tsx` (Owned by Agent 3).
5. **Git Dependency Waiting Protocol:**
   - Before Phase 2.3 (assembling `<CartPanel />`), verify Agent 1 has committed hook extractions:
     ```powershell
     git log -n 50 --oneline --grep="refactor(pos-cart): extract cart line manipulations"
     ```
   - If not found, create and test components in `ui/src/features/sales/components/` first before replacing `PosScreen.tsx` markup.

---

## 📋 Task Checklist

### Phase 2.0: Component Seam Planning
- [ ] Inspect lines 1,000–2,300 of `PosScreen.tsx` to map JSX presentation blocks.
- [ ] Identify component boundaries:
  - Line items list (`<div role="group">`)
  - Course selection bar
  - Totals calculation display
  - Bottom action rack (Pay, Hold, Discount, Clear)

### Phase 2.1: Extract Cart Line Items & Course Bar
- [ ] Extract `<CartLineItem />` component into `components/CartLineItem.tsx`.
  - Props: line data, item index, selection, handlers for qty +/-/remove/course change.
  - Maintain exact CSS classes (`CartPanelLineItem.css`) and ARIA labels.
- [ ] Extract `<CourseSelectorBar />` into `components/CourseSelectorBar.tsx`.
- [ ] Replace inline JSX in `PosScreen.tsx` with `<CartLineItem />` and `<CourseSelectorBar />`.
- [ ] Verify: `npm run test` and `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components"
  ```

### Phase 2.2: Extract Cart Footer Totals & Action Rack
- [ ] Extract `<CartFooterTotals />` into `components/CartFooterTotals.tsx`.
  - Displays subtotal, discounts, tax estimate badge, tips, and grand total.
- [ ] Extract `<CartActionBar />` into `components/CartActionBar.tsx`.
  - Buttons: Pay, Hold Bill, Recall, Discount, Clear Cart.
- [ ] Replace inline JSX in `PosScreen.tsx`.
- [ ] Verify: `npm run test` and `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-ui): extract CartFooterTotals and CartActionBar components"
  ```

### Phase 2.3: Assemble `<CartPanel />` Container & Final Shell Reduction
- [ ] *Wait Gate:* Check `git log --grep="refactor(pos-cart): extract cart line manipulations"`.
- [ ] Create `components/CartPanel.tsx` combining the line items, course bar, totals, and action bar into a standalone collapsible/resizable panel.
- [ ] Reduce `PosScreen.tsx` to orchestrating:
  - Left panel: Catalog / Restaurant Menu / Table Management
  - Right panel: `<CartPanel />`
  - Overlays / Modals: `<PaymentModal />`, `<PriceOverrideModal />`, `<PromotionsModal />`
- [ ] Verify line count in `PosScreen.tsx` dropped from 2,329 to < 600 lines.
- [ ] Verify all tests green: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root"
  ```
