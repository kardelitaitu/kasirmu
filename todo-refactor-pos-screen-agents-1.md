# Orchestrator Agent 1: Cart Core, State Machines & Tax Estimation

**Document:** `todo-refactor-pos-screen-agents-1.md`  
**Role:** Orchestrator Agent 1 (Cart Engine & State Architect)  
**Goal:** Decompose the core sales state machine, cart actions, line calculations, course groupings, tax estimation, and hold/recall workflows from `PosScreen.tsx` into modular hooks and pure calculation utilities.

**Target File:** `ui/src/features/sales/PosScreen.tsx` (Baseline: 2,329 lines)  
**Sibling Documents:**
- [`todo-refactor-pos-screen-agents-2.md`](./todo-refactor-pos-screen-agents-2.md) (Agent 2 — Cart UI Panels, Modals & Peripherals)
- [`todo-refactor-pos-screen-agents-3.md`](./todo-refactor-pos-screen-agents-3.md) (Agent 3 — PaymentModal & Split Tenders Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 1 MUST use:
     - `refactor(pos-cart): ...`
     - `refactor(pos-state): ...`
3. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/features/sales/hooks/usePosCartActions.ts` (NEW)
   - `ui/src/features/sales/hooks/usePosHeldCarts.ts` (NEW)
   - `ui/src/features/sales/hooks/usePosShifts.ts` (NEW)
   - `ui/src/features/sales/utils/cartCalculations.ts` (NEW)
   - `ui/src/features/sales/components/CartTaxWatcher.tsx` (NEW)
   - *Hook calls only* at the top of `ui/src/features/sales/PosScreen.tsx` (Lines 1–450).
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `ui/src/features/sales/PaymentModal.tsx` (Owned by Agent 3).
   - DO NOT edit presentation JSX in `PosScreen.tsx` below the hook declarations (Owned by Agent 2).
5. **Merge Conflict Prevention with Agent 2:**
   - Agent 1 works in new files in `hooks/` and `utils/`, only wiring the hook calls at the top of `PosScreen.tsx`.
   - Agent 2 begins UI component extraction from the bottom JSX render tree.

---

## 📋 Task Checklist

### Phase 1.0: Baseline & Characterization
- [ ] Run `npm run test -- src/__tests__/PosScreen.test.tsx` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.
- [ ] Record current line count of `ui/src/features/sales/PosScreen.tsx` (Baseline: ~2,329 lines).

### Phase 1.1: Pure Calculations & Tax Watcher Extraction
- [ ] Extract `clampCartWidth`, `lineThumbnail`, and pure cart total/discount helpers to `utils/cartCalculations.ts`.
- [ ] Extract `CartTaxWatcher` and `IDLE_TAX_STATE` from `PosScreen.tsx` into `components/CartTaxWatcher.tsx`.
- [ ] Verify types and tests: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-cart): extract cart calculations and CartTaxWatcher component"
  ```

### Phase 1.2: Shift State Machine Extraction (`usePosShifts.ts`)
- [ ] Extract active shift queries, shift opening, closing, cash float prompts, and PIN verification from `PosScreen.tsx` into `hooks/usePosShifts.ts`.
- [ ] Wire hook into `PosScreen.tsx`.
- [ ] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-state): extract shift lifecycle into usePosShifts hook"
  ```

### Phase 1.3: Held Carts & Open Bills Extraction (`usePosHeldCarts.ts`)
- [ ] Extract cart hold, open bill listing, recall bill, and delete bill logic into `hooks/usePosHeldCarts.ts`.
- [ ] Wire hook into `PosScreen.tsx`.
- [ ] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-state): extract held cart management into usePosHeldCarts hook"
  ```

### Phase 1.4: Cart Line Actions & Deduction Logic (`usePosCartActions.ts`)
- [ ] Extract item addition, quantity modification, course assignment, line removal, and deduction location override into `hooks/usePosCartActions.ts`.
- [ ] Wire hook into `PosScreen.tsx`.
- [ ] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-cart): extract cart line manipulations into usePosCartActions hook"
  ```
