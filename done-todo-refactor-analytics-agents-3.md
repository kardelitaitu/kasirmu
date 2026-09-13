# Orchestrator Agent 3: Chart Extraction & Chart Theme

<!-- Audit stamp: 2026-09-13 · Budak Korporat · status: REPAIRED against HEAD ce8666604 · WHAT WAS WRONG IN THE PREVIOUS REVISION: (1) THE PREMISE. It told this agent to extract charts from "AnalyticsScreen.tsx (Lower JSX tree), Lines 500+" and to "reduce AnalyticsScreen to < 450 lines". The charts are not in AnalyticsScreen.tsx. That file contains exactly ONE chart render site — line 1507, `<AnalyticsHeatmap />`, which is already a separate 276-line component. All NINE other chart render sites are in AnalyticsCardContent.tsx (lines 721, 779, 851, 940, 1116, 1173, 1229, 1333, 1408). The < 450 target was therefore unreachable by construction. (2) "SVG, D3/Victory wrappers" — the stack is echarts 6 + echarts-for-react 3; there is no d3 and no victory in the repo, and recharts is present but unused by this feature. (3) `HourlySalesHeatmap.tsx` would have duplicated the existing `AnalyticsHeatmap.tsx`. (4) `CategoryDistributionChart.tsx` was in the owned fence but appeared in NO checklist phase — fenced and never scheduled. (5) The fence "Lines 500+" overlapped Agent 1's "Lines 1–350" while leaving 350–500 unowned. All five repaired: this agent no longer touches AnalyticsScreen.tsx at all, and owns the chart half of Agent 2's file instead. -->

**Document:** `done-todo-refactor-analytics-agents-3.md` (was `todo-refactor-analytics-agents-3.md`)
**Role:** Orchestrator Agent 3 (Data Visualization Architect)
**Goal:** Extract the nine inline echarts option-builders out of `AnalyticsCardContent.tsx` into isolated chart components, and move the chart colour/height infrastructure into a single theme module.

**Target File:** `ui/src/features/analytics/AnalyticsCardContent.tsx` — the nine chart-bearing card bodies (Agent 2 owns the shells; you own the charts inside them)
**Sibling Documents:**
- [`done-todo-refactor-analytics-agents-1.md`](./done-todo-refactor-analytics-agents-1.md) (Agent 1 — Query State, Date Range & Export)
- [`done-todo-refactor-analytics-agents-2.md`](./done-todo-refactor-analytics-agents-2.md) (Agent 2 — KPI Card Decomposition)

---

## 📐 Where the charts actually are

Nine `ReactEChartsCore` render sites, all inside `AnalyticsCardContent.tsx`. Each is a `useMemo` building an echarts `option` object, immediately followed by the render call.

| # | Source card (line) | Chart render | Chart type | New module |
|---|---|---|---|---|
| 1 | `RevenueCard` (674) | 721 | line + area, optional dashed compare series | `charts/RevenueTrendChart.tsx` |
| 2 | `AovCard` (729) | 779 | line + area | `charts/AovTrendChart.tsx` |
| 3 | `CustomersCard` (816) | 851 | bar/line mix | `charts/CustomerMixChart.tsx` |
| 4 | `PaymentsCard` (891) | 940 | pie / bar | `charts/PaymentMixChart.tsx` |
| 5 | `CategoryCard` (1040) | 1116 | pie, per-currency slices | `charts/CategoryDistributionChart.tsx` |
| 6 | `BasketCard` (1123) | 1173 | line + area | `charts/BasketTrendChart.tsx` |
| 7 | `InventoryCard` (1181) | 1229 | line + area | `charts/InventoryTrendChart.tsx` |
| 8 | `TablesCard` (1283) | 1333 | bar | `charts/TablesTrendChart.tsx` |
| 9 | `OccupancyCard` (1341) | 1408 | bar | `charts/OccupancyTrendChart.tsx` |

Plus `charts/chartTheme.ts`, holding: `chartColor` (96), `PALETTE_TOKENS` (107), `PALETTE` (119), `CHART_ACCENT` / `CHART_PREV` / `CHART_BASKET` / `CHART_INVENTORY` / `CHART_TABLES` (122–126), `CHART_ACCENT_SOFT` (128), `DONUT_BORDER` (132), `CHART_TEXT` (134), `CHART_HEIGHT` (162), `chartHeight` (175), and the `echarts.use([...])` registration (line 56) with its five imports (13–17).

### Two things not to do

- **Do not create `HourlySalesHeatmap.tsx`.** `AnalyticsHeatmap.tsx` (276 lines) already exists and already exports `AnalyticsHeatmap`. **Leave it where it is** — Agent 1 owns `AnalyticsScreen.tsx`, which imports it at line 27, so re-homing it would be a cross-fence edit for no functional gain.
- **Do not switch chart libraries.** `recharts` is in `ui/package.json` but unused by this feature; converting to it is a separate decision with a separate blast radius, not a refactor.

### Chart helpers you can import, not move

`alignPrevBuckets`, `alignPrevHourly`, `periodDelta`, `seriesDelta`, `turnDelta`, `previousRange` are already shared exports of `analytics-data.ts` (imported at lines 27–40). Import them directly from there. Do not re-implement them and do not relocate them.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-charts): ...`
2. **Owned Path Fence (exclusive to Agent 3):**
   - `ui/src/features/analytics/charts/**` (NEW) — the nine chart modules + `chartTheme.ts`
   - The nine chart bodies inside `AnalyticsCardContent.tsx` — **coordinate, do not collide:** see the interface freeze below. Agent 2 owns that file's shells; you own the option-builders. In practice Agent 2 performs the mechanical edit, against the contract you publish.
3. **Forbidden Paths:**
   - `AnalyticsScreen.tsx`, `hooks/**`, `utils/**` (Agent 1). **You do not edit `AnalyticsScreen.tsx`.** The previous revision gave you its lower JSX tree; that is withdrawn.
   - `AnalyticsHeatmap.tsx` — leave it alone (see above)
   - `cards/**`, `utils/analyticsCardCsv.ts` (Agent 2)

---

## 🧊 Interface freeze — the one ordering edge in this refactor

You are **upstream of Agent 2's Phase 2.3**. Agent 2 cannot extract the nine chart-bearing shells until your modules exist, because the shells import them. So Phase 3.1 below is a small, fast, *signature-only-plus-theme* commit that must land first.

The frozen contract, by example. Every chart takes the data the card already loaded plus the card's formatters — never the query object, because the card owns data loading:

```ts
// charts/RevenueTrendChart.tsx
import { type Bucket } from '../analytics-data';

export interface RevenueTrendChartProps {
  data: Bucket[];
  prev: Bucket[] | null;
  compare: boolean;
  expanded?: boolean | undefined;
  /** Minor-unit formatter, from the card's useMoney(). */
  fmt: (minor: number) => string;
  /** Fluent lookup, so the series names stay translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}
```

The chart renders **only** the `ReactEChartsCore` element and computes its own height from `chartHeight(<key>, expanded)`. The card keeps the surrounding `<div className="analytics-card-chart" role="img" aria-label={title}>` wrapper, so accessibility stays with the shell.

Card call site after Phase 2.3 (Agent 2 writes this):

```tsx
<div className="analytics-card-chart" role="img" aria-label={title}>
  <RevenueTrendChart
    data={data} prev={prev} compare={compare ?? false} expanded={expanded}
    fmt={fmt} getString={l10n.getString}
  />
</div>
```

**Phase 3.1 must publish the full nine-row signature table** (module, prop names, types, source line) into your journal and into this document, before Agent 2 starts. Agent 2's shells are written against that table; if you change a signature afterwards, you must announce it.

`CategoryCard` is the exception to preserve: the per-currency **tab strip stays in the shell** (four tests in `AnalyticsCardContent.test.tsx` pin it — `describe('CategoryCard — per-currency pie tabs (REP-06a)')`). `CategoryDistributionChart` receives only the rows for the selected currency.

---

## ⚠️ Hard constraints

### 1. The palette must stay runtime-resolved

`chartColor` (96) exists because echarts paints to **canvas**, where a CSS `var(--color-accent)` string never resolves. `readCSSVar` from `@/utils/color` resolves it to a concrete value first. When you move `chartColor` into `chartTheme.ts`, keep the resolution and the fallback pair intact, and keep `PALETTE` as a module-level `const` — if it is recomputed per render, the theme stops responding to a runtime theme switch, which is the bug the comment at line 89 was written about.

### 2. `echarts.use([...])` must run exactly once

The registration at line 56 is a side effect. Move it to `charts/chartTheme.ts` and have each chart module import the theme; do not re-register inside nine modules.

### 3. i18n gate

The option-builders call `l10n.getString` for series names (`analytics-card-revenue`, `analytics-card-prev`, …). Charts live under `features/`, so gate 4 scans them. Keep every `getString` call, with the same key ids, in the moved code — a dropped key trips the bundle-parity gate, and if it was the key's only reference, the FTL orphan lint (gate 10) too.

---

## 📋 Task Checklist

### Phase 3.0: Baseline audit

- [x] `npm run typecheck` → clean (only the devmock lane's live file, unrelated).
- [x] `AnalyticsCardContent.test.tsx` → **16 tests** confirmed.
- [x] `AnalyticsScreen.test.tsx` → **106 tests** confirmed.
- [x] Nine render sites confirmed in the content file; `AnalyticsScreen.tsx` has zero `ReactEChartsCore`.
- [x] Stack confirmed echarts-only: `d3`/`victory` → **0 matches** in `ui/package.json`. The previous revision stays wrong, correctly stamped so.

### Phase 3.1: Chart theme + frozen signatures — **blocking, do this first**

- [x] Create `charts/chartTheme.ts`. → Landed `89b739728d` — with a provenance note: the untracked orphan draft the stalled analytics lane left at 06:35 (never wired, imported by nothing) was adopted after byte-equivalence verification against the inline infrastructure; the commit message carries the attribution.
- [x] Create the nine chart modules, option objects verbatim. → Done `89b739728d` (479 insertions). Two amendments were required while wiring Phase 2.3, both structural, neither visual: `getString` args narrowed to `Record<string, string>` (every real call site passes strings; the narrowing lets `cards/shared/useGetString` adapt Fluent's overload pair with a stable identity), and `CustomerMixChart`'s interim `splitLoaded` guard-prop was dropped — dead at the only render site.
- [x] Publish the nine-row signature table. → Below.

**Published signature table (as shipped):**

| Module | Props (beyond `expanded?: boolean`) | Source builder |
|---|---|---|
| `RevenueTrendChart` | `data: Bucket[]`, `prev: Bucket[]`, `compare: boolean`, `fmt`, `getString` | `RevenueCard` |
| `AovTrendChart` | `buckets: Bucket[]`, `prevBuckets: Bucket[]`, `compare`, `fmt`, `getString` | `AovCard` |
| `CustomerMixChart` | `newCount: number`, `returningCount: number`, `getString` | `CustomersCard` |
| `PaymentMixChart` | `segs: PaymentSeg[]`, `pcts: number[]`, `getString` (exports `PaymentSeg`; the seg derivation stays in the shell for the Legend) | `PaymentsCard` |
| `CategoryDistributionChart` | `names: string[]`, `pcts: number[]` — no `getString`, builder never localized | `CategoryCard` (tabs stay in shell) |
| `BasketTrendChart` | `data`, `prev`, `compare`, `getString` | `BasketCard` |
| `InventoryTrendChart` | `data`, `prev`, `compare`, `getString` | `InventoryCard` |
| `TablesTrendChart` | `data`, `prev`, `compare`, `getString` (minutes tooltip lives here) | `TablesCard` |
| `OccupancyTrendChart` | `hourly`, `prevHourly`, `compare`, `getString` (`alignPrevHourly` moved with the curve) | `OccupancyCard` |

- [x] Verify typecheck with both paths coexisting. → Clean.
- [x] **Commit Milestone:** → `89b739728d`.

### Phase 3.2: Hand off and verify the swap

- [x] Announcement: Phase 3.1 landed; signatures frozen before shell work began (one agent executed both roles this time; the ordering was still honoured commit-first, and the amendments above are the announced deltas).
- [x] Agent 2 performed the swap in `cards/**`. → `d3f551ff44`.
- [x] Joint verify: content 16/16 + screen 106/106 + typecheck. → All green; whole-ui 9,568 passed at close.
- [x] `grep -c 'ReactEChartsCore'` in the content file → **0** after Agent 2's commit.
- [x] No chart-side defects found during the swap ⇒ no separate fixup commit, as the phase predicted.

---

## 📏 Line-count expectation — restated

The previous target was "`AnalyticsScreen.tsx` from 1,551 to < 450". Both numbers were wrong: the file is 1,623 lines and contains no charts, so your work cannot move it at all. **Agent 3 does not change `AnalyticsScreen.tsx`'s line count.** Agent 1 owns that file and has its own restated target there.

What your work does move: **~450 lines out of `AnalyticsCardContent.tsx`** (nine option-builders plus the chart infrastructure), which is the larger part of that file's journey from 1,529 to Agent 2's ≤ 300 target. Your own modules should land at roughly 40–120 lines each — if one runs longer, it is probably still carrying shell logic that belongs to Agent 2.

> **CLOSED.** The nine modules landed at 34–57 lines each (theme 93); the content file's journey finished at **91** with `d3f551ff44`. `AnalyticsScreen.tsx` was never touched by this order, exactly as restated.

---

## 🚦 Wait gates

- **Phase 3.1: start immediately.** It is additive and touches nothing owned by a sibling.
- **Agent 2's Phase 2.3 waits on you.** That is the only hard ordering edge in the analytics refactor.
- **You never wait on Agent 1**, and Agent 1 never waits on you: the heatmap you might have owned already lives in its own file, and Agent 1's screen work does not reach into the cards.
