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

- [x] typecheck → clean (only the devmock lane's live `tauri-api.ts` errors, unrelated).
- [x] `AnalyticsCardContent.test.tsx` → **16 tests**, recorded.
- [x] `AnalyticsScreen.test.tsx` → **106 tests**, recorded as the regression net.
- [x] The five invented names from the old plan → confirmed absent repo-wide (`grep` returns 0) at close too.

### Phase 2.1: Shared primitives and card CSV

> Landed in two halves. The stalled analytics lane's `a9c0fdf3b7` moved the 11 CSV
> exporters + `PAYMENT_NAMES` only; the primitives table below was finished in
> `8703694583`, which also resolved two artifacts of the stall (a doc comment
> orphaned in `constants.ts` above a function that had not moved; the stale
> staff-CSV comment stranded over `DeltaChip`).

- [x] Create `cards/shared/**` from the table above. → Done `8703694583`: useMoney, Visual, CardStates, Kpi, DeltaChip, buckets, RankedList, Legend, useCardData, constants (incl. `largestRemainderPcts`, whose comment already lived there).
- [x] Create `utils/analyticsCardCsv.ts`. → Done `a9c0fdf3b7`.
- [x] Verify. → typecheck + 16/16.
- [x] **Commit Milestone:** → `a9c0fdf3b7` + `8703694583`.

### Phase 2.2: Seven chart-free cards

- [x] Extract `StaffCard`, `DiscountsCard`, `RefundsCard`, `TopItemsCard`, `LowStockCard`, `WaitstaffCard`, `VoidsCard` into `cards/`, preserving exact prop shapes. → Done `90399c28cb`, including the two exceptions verbatim (Refunds `{q, compare}`, LowStock `{q, title, expanded}`). `ExportCsvButton`'s implementation moved to `cards/shared/` (the cards need it; importing up would cycle through the dispatcher) with the re-export kept at the constraint-2 path.
- [x] Verify. → typecheck + 16/16 + 106/106.
- [x] **Commit Milestone:** → `90399c28cb`.

### Phase 2.3: Nine chart-bearing shells — **waits on Agent 3 Phase 3.1**

- [x] Gate checked: `refactor(analytics-charts):` = `89b739728d` in the log before work started.
- [x] Extract the nine shells, replacing each inline `ReactEChartsCore` block with its `charts/` module. → Done `d3f551ff44`; the file ends at **91 lines** (dispatcher + props interface + re-export), well under ≤300.
- [x] `CategoryCard`: tab strip stayed in `cards/CategoryCard.tsx`; only the pie moved. → The four REP-06a tests pass unchanged.
- [x] Repoint `AnalyticsCardContent.tsx` type import at `utils/dateRangePresets.ts`. → Done in `d3f551ff44`; the remaining three shim consumers were repointed and the shim deleted in the agents-1 close `c05133d757`.
- [x] Verify line count → 91 ≤ 300 ✓. (From 1,529 at repair-time via `a9c0fdf3b7` −315, `8703694583` −255, `90399c28cb` −268, `d3f551ff44` −612 net.)
- [x] Verify: typecheck, content 16/16, screen 106/106. → All green; whole-ui re-run at close.
- [x] **Commit Milestone:** → `d3f551ff44` (`refactor(analytics-kpi): complete the card split on the frozen chart modules`).

---

## 📏 Line-count expectation

1,529 → **≤ 300**. The arithmetic, so you can check it rather than trust it: ~450 lines of the seven chart-free cards, ~450 of the nine shells, ~250 of the 11 exporters, ~200 of shared primitives = ~1,350 out; the dispatcher, the props interface and the re-exports stay. If you land above 300, say so and name what remains — do not quietly edit the target.

> **CLOSED: 1,529 → 91 physical lines** (measured after `d3f551ff44`). The dispatcher, the props interface and the constraint-2 re-export are the whole file, as the arithmetic above promised.

---

## 🚦 Wait gates

- **Phase 2.1 and 2.2: start immediately.** They touch nothing Agent 3 owns.
- **Phase 2.3: blocked on Agent 3's Phase 3.1** (the `charts/**` commit). Agent 3 is the upstream of the only real dependency edge in this refactor.
- Agent 1 never blocks you. Agent 1 now owns `AnalyticsScreen.tsx` outright, and your file is not in its fence.
