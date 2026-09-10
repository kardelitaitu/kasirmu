# Orchestrator Agent 2: KPI Summary & Metric Cards

**Document:** `todo-refactor-analytics-agents-2.md`  
**Role:** Orchestrator Agent 2 (Metric Cards & KPI Presentation Architect)  
**Goal:** Decompose `AnalyticsCardContent.tsx` (1,467 lines) into modular, reusable KPI card components with comparison delta badges, skeleton loading states, and currency formatters.

**Target File:** `ui/src/features/analytics/AnalyticsCardContent.tsx` (Baseline: 1,467 lines)  
**Sibling Documents:**
- [`todo-refactor-analytics-agents-1.md`](./todo-refactor-analytics-agents-1.md) (Agent 1 — Query State, Date Filtering & Export)
- [`todo-refactor-analytics-agents-3.md`](./todo-refactor-analytics-agents-3.md) (Agent 3 — Data Visualization & Chart Components)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-kpi): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/analytics/AnalyticsCardContent.tsx`
   - `ui/src/features/analytics/cards/` (NEW directory)
     - `RevenueKpiCard.tsx`
     - `GrossMarginCard.tsx`
     - `BasketSizeCard.tsx`
     - `CustomerTrafficCard.tsx`
     - `RefundRateCard.tsx`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `AnalyticsScreen.tsx` (Owned by Agent 1 & Agent 3).
   - DO NOT edit chart visualizations (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Run `npm run test -- AnalyticsCard` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.

### Phase 2.1: Extract Core Financial KPI Cards
- [ ] Extract `<RevenueKpiCard />` and `<GrossMarginCard />` into `cards/`.
  - Props: current period value, previous period value, percent change, currency.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-kpi): extract Revenue and GrossMargin KPI card components"
  ```

### Phase 2.2: Extract Operational Metric Cards & Thin Facade
- [ ] Extract `<BasketSizeCard />`, `<CustomerTrafficCard />`, and `<RefundRateCard />` into `cards/`.
- [ ] Turn `AnalyticsCardContent.tsx` into a clean switch/router selecting the appropriate card component.
- [ ] Verify line count in `AnalyticsCardContent.tsx` drops from 1,467 to < 250 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-kpi): modularize operational KPI cards and reduce AnalyticsCardContent"
  ```
