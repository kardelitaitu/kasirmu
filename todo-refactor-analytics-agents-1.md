# Orchestrator Agent 1: Analytics Query State, Date Filtering & Export Pipeline

**Document:** `todo-refactor-analytics-agents-1.md`  
**Role:** Orchestrator Agent 1 (Analytics Engine & Export Architect)  
**Goal:** Extract query state, comparison period calculations, date range presets, and CSV/PDF export generation from `AnalyticsScreen.tsx` into modular hooks and pure calculation utilities.

**Target File:** `ui/src/features/analytics/AnalyticsScreen.tsx` (Baseline: 1,551 lines)  
**Sibling Documents:**
- [`todo-refactor-analytics-agents-2.md`](./todo-refactor-analytics-agents-2.md) (Agent 2 — KPI Summary & Metric Cards)
- [`todo-refactor-analytics-agents-3.md`](./todo-refactor-analytics-agents-3.md) (Agent 3 — Data Visualization & Chart Components)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-query): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/features/analytics/hooks/useAnalyticsFilters.ts` (NEW)
   - `ui/src/features/analytics/hooks/useAnalyticsData.ts` (NEW)
   - `ui/src/features/analytics/utils/analyticsExport.ts` (NEW)
   - `ui/src/features/analytics/utils/dateRangePresets.ts` (NEW)
   - Top hook-wiring section in `ui/src/features/analytics/AnalyticsScreen.tsx` (Lines 1–350).
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `AnalyticsCardContent.tsx` (Owned by Agent 2).
   - DO NOT edit chart components (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `npm run test -- Analytics` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.

### Phase 1.1: Extract Date Presets & Filter State Hook
- [ ] Extract today, yesterday, last 7 days, this month, and custom range logic to `utils/dateRangePresets.ts`.
- [ ] Extract filter state (store selection, comparison mode, channel filters) to `hooks/useAnalyticsFilters.ts`.
- [ ] Wire hook into `AnalyticsScreen.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-query): extract date presets and filter state hook"
  ```

### Phase 1.2: Extract Export Pipelines (CSV / PDF)
- [ ] Extract raw data transformation, CSV table generation, and print formatting from `AnalyticsScreen.tsx` into `utils/analyticsExport.ts`.
- [ ] Wire export button handlers.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(analytics-query): decouple CSV and report export logic from UI screen"
  ```
