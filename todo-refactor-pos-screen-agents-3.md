# Orchestrator Agent 3: `PaymentModal` & Split Tenders Deconstruction

**Document:** `todo-refactor-pos-screen-agents-3.md`  
**Role:** Orchestrator Agent 3 (Payment & Checkout Architect)  
**Goal:** Decompose `PaymentModal.tsx` (1,933 lines) from a monolithic checkout modal into modular tender providers, split-payment state machines, currency conversion helpers, and receipt preview layers.

**Target File:** `ui/src/features/sales/PaymentModal.tsx` (Baseline: 1,933 lines)  
**Sibling Documents:**
- [`todo-refactor-pos-screen-agents-1.md`](./todo-refactor-pos-screen-agents-1.md) (Agent 1 — Cart Engine & State Architect)
- [`todo-refactor-pos-screen-agents-2.md`](./todo-refactor-pos-screen-agents-2.md) (Agent 2 — Cart UI Panels, Modals & Peripherals)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(payment): ...`
3. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/sales/PaymentModal.tsx` (Primary target)
   - `ui/src/features/sales/payment/` (NEW directory for sub-panels & hooks)
     - `usePaymentStateMachine.ts`
     - `useSplitTenders.ts`
     - `CashTenderPanel.tsx`
     - `CardTenderPanel.tsx`
     - `QrisTenderPanel.tsx`
     - `LoyaltyTenderPanel.tsx`
     - `PaymentSummaryFooter.tsx`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `PosScreen.tsx` or its cart hooks/components (Owned by Agent 1 & Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline & Checkout Invariant Safeguards
- [ ] Run `npm run test -- PaymentModal` or checkout test suites.
- [ ] Record lines of code in `PaymentModal.tsx` (Baseline: ~1,933 lines).
- [ ] Document critical invariants:
  - Exact minor unit math: Total tender must strictly equal sale total before completion.
  - Cash change calculation must handle multi-currency rounding correctly.
  - Split tenders must support mixed tender types (e.g. Cash + Card, Points + QRIS).
  - Stock shortfall detection must block sale completion when negative inventory is disallowed.

### Phase 3.1: Extract Payment State Machine (`usePaymentStateMachine.ts`)
- [ ] Extract payment state transition logic:
  - Modes: `idle` → `selecting_method` → `collecting_tender` → `processing` → `completed` → `receipt`
  - Integration with `startSaleScoped`, `addLineScoped`, `completeSaleScoped`, and `finalizeSale`.
- [ ] Move into `ui/src/features/sales/payment/usePaymentStateMachine.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(payment): extract checkout workflow into usePaymentStateMachine hook"
  ```

### Phase 3.2: Extract Split Tenders & Currency Hook (`useSplitTenders.ts`)
- [ ] Extract split rows state management (`SplitRow`), balance remaining, multi-currency conversion, and quick cash suggestions (`[50k, 100k, exact]`).
- [ ] Move into `ui/src/features/sales/payment/useSplitTenders.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(payment): extract tender splitting and currency logic into useSplitTenders hook"
  ```

### Phase 3.3: Extract Tender Panels
- [ ] **Cash Tender Panel:**
  - Create `payment/CashTenderPanel.tsx` (quick cash pills, change calculation, cash drawer trigger).
- [ ] **Card & EDC Tender Panel:**
  - Create `payment/CardTenderPanel.tsx` (card type selection, EDC terminal bridge, reference/auth codes).
- [ ] **QRIS & Digital Tender Panel:**
  - Create `payment/QrisTenderPanel.tsx` (dynamic QR code generation, payment confirmation polling).
- [ ] **Loyalty & Store Credit Panel:**
  - Create `payment/LoyaltyTenderPanel.tsx` (points balance, redemption calculator, customer link).
- [ ] Verify: `npm run typecheck` and unit tests.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(payment): extract modular tender panels (Cash, Card, QRIS, Loyalty)"
  ```

### Phase 3.4: Reassemble `PaymentModal.tsx` & Verify
- [ ] Reassemble `PaymentModal.tsx` as a clean coordinator wiring the state machine, active tender tab panel, and receipt preview.
- [ ] Verify `PaymentModal.tsx` line count dropped from 1,933 to < 450 lines.
- [ ] Run full UI tests: `npm run test` and `npm run typecheck`.
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(payment): consolidate PaymentModal into thin coordinator component"
  ```
