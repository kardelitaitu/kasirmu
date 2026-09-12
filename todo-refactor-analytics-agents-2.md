# Orchestrator Agent 2: KPI Card Decomposition

<!-- Audit stamp: 2026-09-13 · Budak Korporat · status: REPAIRED against HEAD ce8666604 · WHAT WAS WRONG IN THE PREVIOUS REVISION: (1) baseline "1,467 lines" -> 1,529 (`wc -l`); (2) ALL FIVE proposed component names were invented — `RevenueKpiCard`, `GrossMarginCard`, `BasketSizeCard`, `CustomerTrafficCard` and `RefundRateCard` do not exist anywhere in the repo. The file holds SIXTEEN cards under different names, enumerated below; the closest real matches are RevenueCard, BasketCard, CustomersCard and RefundsCard, and there is no gross-margin card at all (margin is a series inside RevenueCard); (3) the proposed props contract — "current period value, previous period value, percent change, currency" — is invented: every real card takes a single `q: AnalyticsQuery` object plus `{ title, expanded?, compare? }`; (4) "Turn AnalyticsCardContent.tsx into a clean switch/router" describes work that is ALREADY DONE — the dispatcher exists at lines 1510–1526 and already returns null for an unknown key; (5) the plan silently orphaned `ExportCsvButton` (exported, and imported by a test), the 11 per-card CSV exporters, and ~15 shared primitives; (6) the `< 250` target is unreachable if those stay in the file, so the split is now specified. All six repaired below. -->

**Document:** `todo-refactor-analytics-agents-2.md`
**Role:** Orchestrator Agent 2 (Metric Card & KPI Presentation Architect)
**Goal:** Decompose `AnalyticsCardContent.tsx` into a dispatcher, a shared card-primitive layer, seven chart-free card modules, nine chart-bearing card shells, and a card CSV module.

**Target File:** `ui/src/features/analytics/AnalyticsCardContent.tsx` — **1,529 lines** (measured `wc -l`, HEAD `ce8666604`)
**Sibling Documents:**
- [`todo-refactor-analytics-agents-1.md`](./todo-refactor-analytics-agents-1.md) (Agent 1 — Query State, Date Range & Export)
- [`todo-refactor-analytics-agents-3.md`](./todo-refactor-analytics-agents-3.md) (Agent 3 — Chart Extraction)

---

## 📐 Measured anatomy of the target file

The 16 real cards, their line ranges, and which ones carry a chart. **These are the names to use** — the previous revision's five names exist nowhere.

| Line | Component | Chart? | Owner after split |
|---|---|---|---|
| 674 | `RevenueCard` | ✅ echarts @721 | shell → `cards/`, chart → Agent 3 |
| 729 | `AovCard` | ✅ @779 | shell → `cards/`, chart → Agent 3 |
| 787 | `StaffCard` | — | `cards/StaffCard.tsx` |
| 816 | `CustomersCard` | ✅ @851 | shell → `cards/`, chart → Agent 3 |
| 891 | `PaymentsCard` | ✅ @940 | shell → `cards/`, chart → Agent 3 |
| 947 | `DiscountsCard` | — | `cards/DiscountsCard.tsx` |
| 976 | `RefundsCard` | — | `cards/RefundsCard.tsx` |
| 1008 | `TopItemsCard` | — | `cards/TopItemsCard.tsx` |
| 1040 | `CategoryCard` | ✅ @1116 | shell → `cards/`, chart → Agent 3 |
| 1123 | `BasketCard` | ✅ @1173 | shell → `cards/`, chart → Agent 3 |
| 1181 | `InventoryCard` | ✅ @1229 | shell → `cards/`, chart → Agent 3 |
| 1235 | `LowStockCard` | — | `cards/LowStockCard.tsx` |
| 1283 | `TablesCard` | ✅ @1333 | shell → `cards/`, chart → Agent 3 |
| 1341 | `OccupancyCard` | ✅ @1408 | shell → `cards/`, chart → Agent 3 |
| 1415 | `WaitstaffCard` | — | `cards/WaitstaffCard.tsx` |
| 1449 | `VoidsCard` | — | `cards/VoidsCard.tsx` |

Nine chart-bearing, seven chart-free. **Agent 3 owns the chart inside each of the nine; you own the shell around it.**

### What is already done

The dispatcher you were told to create exists at **1510–1526**: a `switch (cardKey)` with one case per card, falling through to `null`. `AnalyticsCardContent.test.tsx:150` already asserts that null. Do not rewrite it — the real work is getting 1,400 lines of helpers out from under it.

### The real props contract

Every card takes the same shape. Use it; do not invent scalar props:

```ts
function XCard({ q, title, expanded, compare }: {
  q: AnalyticsQuery;
  title: string;
  expanded?: boolean | undefined;
  compare?: boolean | undefined;
})
```

Two exceptions to preserve exactly: `RefundsCard` takes only `{ q, compare }` (no `title`/`expanded`), and `LowStockCard` takes only `{ q, title, expanded }` (no `compare`).

### Shared building blocks that must not be orphaned

| Line | Symbol | Destination |
|---|---|---|
| 60 | `useMoney` | `cards/shared/useMoney.ts` |
| 186 | `Visual` | `cards/shared/Visual.tsx` |
| 195 / 213 / 225 | `CardLoading` / `CardError` / `CardEmpty` | `cards/shared/CardStates.tsx` |
| 234 | `Kpi` | `cards/shared/Kpi.tsx` |
| 533 | `DeltaChip` | `cards/shared/DeltaChip.tsx` |
| 552 | `activeBuckets` | `cards/shared/buckets.ts` |
| 557 | `RankedList` | `cards/shared/RankedList.tsx` |
| 597 | `Legend` | `cards/shared/Legend.tsx` |
| 622 / 646 / 664 | `useCardData` / `useCardDataCompare` / `rowDeltas` | `cards/shared/useCardData.ts` |
| 139 / 144 / 148 / 155 | `NO_BUCKETS` / `NO_HOURLY` / `NO_NUMBERS` / `CRITICAL_STOCK_LEVEL` | `cards/shared/constants.ts` |
| 244 | `ExportCsvButton` | **stays exported from this file** — see constraint §2 |
| 265 | `staffCsvColumns` + 11 `export*Csv` (277–532) | `utils/analyticsCardCsv.ts` |

**Not yours.** The chart infrastructure — `chartColor` (96), `PALETTE_TOKENS` (107), `PALETTE` (119), `CHART_ACCENT` / `CHART_PREV` / `CHART_BASKET` / `CHART_INVENTORY` / `CHART_TABLES` (122–126), `CHART_ACCENT_SOFT` (128), `DONUT_BORDER` (132), `CHART_TEXT` (134), `CHART_HEIGHT` (162), `chartHeight` (175), and the `echarts.use([...])` registration (56) — moves to `charts/chartTheme.ts` under **Agent 3**. Do not move those, and do not delete them: until Agent 3's Phase 3.1 lands, they are still referenced by the nine chart option-builders you are about to move. (`NO_HOURLY` at 144 is *not* chart infrastructure — it is the empty-state default for the hourly tables, so it goes to `cards/shared/constants.ts` with the other three.)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-kpi): ...`
2. **Owned Path Fence (exclusive to Agent 2):**
   - `ui/src/features/analytics/AnalyticsCardContent.tsx`
   - `ui/src/features/analytics/cards/**` (NEW) — the seven chart-free cards, the nine chart-bearing shells, and `cards/shared/**`
   - `ui/src/features/analytics/utils/analyticsCardCsv.ts` (NEW)
   - `ui/src/__tests__/AnalyticsCardContent.test.tsx`
3. **Forbidden Paths:**
   - `AnalyticsScreen.tsx`, `hooks/**`, `utils/dateRangePresets.ts`, `utils/analyticsExport.ts` (Agent 1 — Agent 1 is now the **sole** owner of the screen)
   - `charts/**`, `AnalyticsHeatmap.tsx` (Agent 3)

---

## ⚠️ Hard constraints — these gates will fail if you skip them

### 1. The eleven CSV exporters are the real export surface

The previous revision put "CSV export" in Agent 1's scope while fencing the file that contains eleven of the twelve exporters into yours. Repaired by assignment, not by hope: **you own the per-card CSV**, because each exporter is typed against its own card's row shape (`exportStaffCsv`, `exportTopItemsCsv`, `exportPaymentsCsv`, `exportCategoryCsv`, `exportTrendCsv`, `exportCustomersCsv`, `exportDiscountsCsv`, `exportRefundsCsv`, `exportVoidedItemsCsv`, `exportLowStockCsv`, `exportOccupancyCsv`). Agent 1's `utils/analyticsExport.ts` holds only the screen's heatmap CSV and the shared `downloadCsv` call.

### 2. `ExportCsvButton` is imported by a test from this exact path

`ui/src/__tests__/AnalyticsCardContent.test.tsx:3`:

```ts
import { AnalyticsCardContent, ExportCsvButton } from '@/features/analytics/AnalyticsCardContent';
```

Sixteen tests depend on this file's public surface. Three named exports must survive: `ExportCsvButton` (line 244), `AnalyticsCardContentProps` (1478) and `AnalyticsCardContent` (1498). If you move the button's implementation, leave a re-export here — repointing the test is a separate, optional commit.

### 3. Behaviour the tests pin, which the refactor must not change

- `renders low-stock card with data`, `renders aov card with data`, `renders customers card with data`, `renders basket card with data` — these four go through the dispatcher and will break if a key is renamed or a shell changes its prop names.
- `returns null for unknown card key` — the default arm must stay.
- `handles compare mode prop` / `handles expanded prop` — keep `expanded` and `compare` optional with the same semantics.
- **`describe('CategoryCard — per-currency pie tabs (REP-06a)')` — four tests** covering one tab per currency present in the rows, defaulting to the display currency, re-rendering on tab switch, and no tab strip for single-currency rows. `CategoryCard` is chart-bearing, so its shell is yours and its pie is Agent 3's. **The tab strip is shell behaviour: it stays with you.** Extract the pie only, and keep the tabs in `cards/CategoryCard.tsx`.

### 4. i18n gate

Cards are in `features/`, so gate 4 scans them for `<Localized id>` / `getString` keys. Moving a card must move its `Localized` usage with it, in the same commit, or the bundle-parity gate fails on the staged files.

---

## 📋 Task Checklist

### Phase 2.0: Baseline audit

- [ ] `cd ui && npm run typecheck`
- [ ] `cd ui && npm run test -- src/__tests__/AnalyticsCardContent.test.tsx` (16 tests — record the count)
- [ ] `cd ui && npm run test -- src/__tests__/AnalyticsScreen.test.tsx` (106 tests — this is your regression net; the screen renders your cards)
- [ ] Confirm for yourself that the five names in the old plan do not exist: `grep -n 'RevenueKpiCard\|GrossMarginCard\|BasketSizeCard\|CustomerTrafficCard\|RefundRateCard' -r ui/src` returns nothing.

### Phase 2.1: Shared primitives and card CSV

- [ ] Create `cards/shared/**` from the table above. Pure moves; no behaviour change.
- [ ] Create `utils/analyticsCardCsv.ts` from `staffCsvColumns` + the 11 exporters (265–532).
- [ ] Verify: `npm run typecheck`, `npm run test -- src/__tests__/AnalyticsCardContent.test.tsx`.
- [ ] **Commit Milestone:**
  ```bash
  git commit ui/src/features/analytics/AnalyticsCardContent.tsx ui/src/features/analytics/cards ui/src/features/analytics/utils/analyticsCardCsv.ts -m "refactor(analytics-kpi): extract shared card primitives and per-card csv exporters"
  ```

### Phase 2.2: Seven chart-free cards

- [ ] Extract `StaffCard`, `DiscountsCard`, `RefundsCard`, `TopItemsCard`, `LowStockCard`, `WaitstaffCard`, `VoidsCard` into `cards/`, preserving each one's exact prop shape (including the two exceptions).
- [ ] Verify: `npm run typecheck`, `npm run test -- src/__tests__/AnalyticsCardContent.test.tsx`.
- [ ] **Commit Milestone:**
  ```bash
  git commit ui/src/features/analytics/AnalyticsCardContent.tsx ui/src/features/analytics/cards -m "refactor(analytics-kpi): extract seven chart-free analytics cards"
  ```

### Phase 2.3: Nine chart-bearing shells — **waits on Agent 3 Phase 3.1**

- [ ] Do not start until Agent 3 has committed `charts/**` and `charts/chartTheme.ts`. Check the git log for `refactor(analytics-charts):`.
- [ ] Extract `RevenueCard`, `AovCard`, `CustomersCard`, `PaymentsCard`, `CategoryCard`, `BasketCard`, `InventoryCard`, `TablesCard`, `OccupancyCard` into `cards/`, keeping loading/error/empty states, the title row and the delta chips; replace each inline `ReactEChartsCore` block with the corresponding `charts/` component.
- [ ] `CategoryCard`: keep the per-currency tab strip here (constraint §3); only the pie moves.
- [ ] Repoint `AnalyticsCardContent.tsx:54` — `import type { Granularity, WorkspaceView } from './AnalyticsScreen'` — at `utils/dateRangePresets.ts`. Agent 1 kept a re-export in the screen specifically so this could be deferred to your commit; once your commit is in, Agent 1 drops the shim. This is the only line in your file that touches Agent 1's ownership, and it is a type-only import, so it cannot cause a runtime coupling.
- [ ] Verify line count in `AnalyticsCardContent.tsx` drops from 1,529 to **≤ 300**.
- [ ] Verify: `npm run typecheck`, `npm run test -- src/__tests__/AnalyticsCardContent.test.tsx`, `npm run test -- src/__tests__/AnalyticsScreen.test.tsx`.
- [ ] **Commit Milestone:**
  ```bash
  git commit ui/src/features/analytics/AnalyticsCardContent.tsx ui/src/features/analytics/cards -m "refactor(analytics-kpi): extract chart-bearing card shells and thin the dispatcher"
  ```

---

## 📏 Line-count expectation

1,529 → **≤ 300**. The arithmetic, so you can check it rather than trust it: ~450 lines of the seven chart-free cards, ~450 of the nine shells, ~250 of the 11 exporters, ~200 of shared primitives = ~1,350 out; the dispatcher, the props interface and the re-exports stay. If you land above 300, say so and name what remains — do not quietly edit the target.

---

## 🚦 Wait gates

- **Phase 2.1 and 2.2: start immediately.** They touch nothing Agent 3 owns.
- **Phase 2.3: blocked on Agent 3's Phase 3.1** (the `charts/**` commit). Agent 3 is the upstream of the only real dependency edge in this refactor.
- Agent 1 never blocks you. Agent 1 now owns `AnalyticsScreen.tsx` outright, and your file is not in its fence.
