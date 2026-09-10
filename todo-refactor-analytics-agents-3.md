# Orchestrator Agent 3: Data Visualization & Chart Components

**Document:** `todo-refactor-analytics-agents-3.md`  
**Role:** Orchestrator Agent 3 (Data Visualization Architect)  
**Goal:** Extract complex chart implementations (hourly sales heatmaps, tender distribution breakdowns, category tree maps, and comparison trend lines) from `AnalyticsScreen.tsx` into isolated presentation components.

**Target File:** `ui/src/features/analytics/AnalyticsScreen.tsx` (Lower JSX tree)  
**Sibling Documents:**
- [`todo-refactor-analytics-agents-1.md`](./todo-refactor-analytics-agents-1.md) (Agent 1 — Query State, Date Filtering & Export)
- [`todo-refactor-analytics-agents-2.md`](./todo-refactor-analytics-agents-2.md) (Agent 2 — KPI Summary & Metric Cards)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-charts): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/analytics/charts/` (NEW directory)
     - `HourlySalesHeatmap.tsx`
     - `TenderBreakdownChart.tsx`
     - `CategoryDistributionChart.tsx`
     - `TrendLineChart.tsx`
   - JSX render tree in `ui/src/features/analytics/AnalyticsScreen.tsx` (Lines 500+).
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `AnalyticsCardContent.tsx` (Owned by Agent 2).
   - DO NOT edit query hooks or export logic (Owned by Agent 1).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Inspect chart rendering code in `AnalyticsScreen.tsx` (SVG, D3/Victory wrappers).

### Phase 3.1: Extract Distribution & Heatmap Charts
- [ ] Extract `<HourlySalesHeatmap />` into `charts/HourlySalesHeatmap.tsx`.
- [ ] Extract `<TenderBreakdownChart />` into `charts/TenderBreakdownChart.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-charts): extract HourlySalesHeatmap and TenderBreakdown charts"
  ```

### Phase 3.2: Extract Trend Line Chart & Screen Finalization
- [ ] Extract `<TrendLineChart />` into `charts/TrendLineChart.tsx`.
- [ ] Clean up `AnalyticsScreen.tsx` to render:
  - Header: Filter controls (`useAnalyticsFilters`)
  - Middle: KPI Grid (`AnalyticsCardContent`)
  - Bottom: Visual Charts (`charts/*`)
- [ ] Verify line count in `AnalyticsScreen.tsx` drops from 1,551 to < 450 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-charts): modularize TrendLineChart and reduce AnalyticsScreen to composition root"
  ```
