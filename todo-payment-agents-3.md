# Orchestrator Agent 3: Checkout UI, Dynamic QR & Payment Polling

**Document:** `todo-payment-agents-3.md`  
**Role:** Orchestrator Agent 3 (Payment Checkout Experience Architect)  
**Goal:** Integrate online dynamic QRIS generation, polling fallback loops, card swipe progress overlays, and tender selection permissions into the front-end checkout flow.

**Target Files:** `ui/src/features/sales/PaymentModal.tsx`, `ui/src/components/QrisQrDisplay.tsx`  
**Sibling Documents:**
- [`todo-payment-agents-1.md`](./todo-payment-agents-1.md) (Agent 1 — Cloud Gateway, Midtrans API & Webhooks)
- [`todo-payment-agents-2.md`](./todo-payment-agents-2.md) (Agent 2 — Hardware Abstraction Layer & LAN EDC Drivers)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(payment-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/components/QrisQrDisplay.tsx`
   - `ui/src/features/sales/PaymentModal.tsx` (Tender integration)
   - `ui/src/api/paymentGateway.ts` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `cloud-server` (Owned by Agent 1).
   - DO NOT edit `oz-hal` (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Inspect existing `QrisQrDisplay.tsx` and modal tender selection.

### Phase 3.1: Dynamic QRIS Generation & Status Polling
- [ ] Connect `QrisQrDisplay.tsx` to `generateDynamicQrisScoped` IPC API.
- [ ] Implement exponential backoff polling fallback (`GET /api/v1/payments/:id/status`) to confirm payment when webhooks are delayed.
- [ ] Render clear countdown timer showing QR expiration window (e.g. 15 minutes).
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-ui): implement dynamic QRIS generation and settlement status polling"
  ```

### Phase 3.2: Card EDC Terminal Flow & Approval Modal
- [ ] Add card terminal interaction modal ("Please tap, insert, or swipe card on terminal...").
- [ ] Listen for approval, decline, or user cancellation from HAL driver.
- [ ] Automatically print merchant and customer receipt copies upon approved EDC response.
- [ ] Run pre-commit checks: `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(payment-ui): integrate EDC terminal interaction flow and auto-receipt printing"
  ```
