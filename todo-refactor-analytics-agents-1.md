# Orchestrator Agent 1: Analytics Query State, Date Range & Export Pipeline

<!-- Audit stamp: 2026-09-13 · Budak Korporat · status: REPAIRED against HEAD ce8666604 · every figure below was re-measured, not carried over. WHAT WAS WRONG IN THE PREVIOUS REVISION: (1) baseline "1,551 lines" -> 1,623 (`wc -l`); (2) the owned fence "Lines 1–350" described a hook-wiring region that does not exist — lines 1–158 are imports plus nine EXPORTED helpers consumed by two test files, and the component does not begin until 287; (3) "today, yesterday, last 7 days, this month" presets DO NOT EXIST anywhere in the feature — the real control is a `Granularity` selector (weekly/monthly/yearly/custom) over `customFrom`/`customTo`, and the range maths already lives in `analytics-data.ts`; (4) "CSV / PDF export" — there is no PDF, no `window.print`, no jspdf and no html2canvas in the feature (grep returns zero hits), and 11 of the 12 CSV exporters are in AnalyticsCardContent.tsx, which the previous revision assigned to Agent 2 while Agent 1 was told to own "export"; (5) `hooks/useAnalyticsData.ts` as specified would have duplicated three existing modules (`useAnalyticsQuery.ts` 173, `analytics-data.ts` 1,007, `analytics-cache.ts` 495); (6) the plan never mentioned the storage-key pin test, which FAILS the moment `oz-analytics-workspace-view` moves out of AnalyticsScreen.tsx. All six repaired below. -->

**Document:** `todo-refactor-analytics-agents-1.md`
**Role:** Orchestrator Agent 1 (Analytics Query State & Export Architect)
**Goal:** Move the module-level pure logic out of `AnalyticsScreen.tsx` into typed utilities, lift the screen's filter/zoom state into a hook, and give the heatmap CSV export a home outside the screen.

**Target File:** `ui/src/features/analytics/AnalyticsScreen.tsx` — **1,623 lines** (measured `wc -l`, HEAD `ce8666604`)
**Sibling Documents:**
- [`todo-refactor-analytics-agents-2.md`](./todo-refactor-analytics-agents-2.md) (Agent 2 — KPI Card Decomposition)
- [`todo-refactor-analytics-agents-3.md`](./todo-refactor-analytics-agents-3.md) (Agent 3 — Chart Extraction)

---

## 📐 Measured anatomy of the target file

Read this before editing. The line numbers are the real ones at `ce8666604`.

| Lines | Contents | Disposition |
|---|---|---|
| 1–46 | imports — React, `react-dom`, Fluent, 3 contexts, 3 shared hooks, 2 shared components, 4 analytics sibling modules, 1 CSS | stays, plus new hook/util imports |
| 47–72 | `WorkspaceView`, `Granularity`, `GRANULARITIES`, `monthCalendarGrid` re-export | → `utils/dateRangePresets.ts`, **re-exported** (see §Public API) |
| 74–79 | `ZOOM_MIN/MAX/STEP`, `WORKSPACE_VIEW_STORAGE_KEY` | → `hooks/useAnalyticsFilters.ts` (**pin update required**) |
| 82–96 | `SHORTCUTS` | stays (screen-local chrome) |
| 97–158 | `nextExpandedKey`, `smartScale`, `cardGranularity`, `cardRange`, `daysInCurrentMonth` | → `utils/dateRangePresets.ts`, **re-exported** |
| 160–232 | `exportHeatmapCsv` | → `utils/analyticsExport.ts` |
| 233–238 | `shortCacheLabel` | → `utils/analyticsExport.ts` |
| 239–284 | `AnalyticsCard` interface + `ANALYTICS_CARDS` registry | stays — this is the screen's card registry, not a util |
| 287–1623 | `export default function AnalyticsScreen()` (**1,336 lines**) | Phase 1.2 lifts state only; JSX shell is out of scope |

### Two facts that will save you time

- **There is no PDF path.** No `pdf`, no `window.print`, no `jspdf`, no `html2canvas` anywhere in `ui/src/features/analytics`. Do not build one. The only export is CSV, via `downloadCsv` from `@/utils/export-csv` — an existing shared util. Reuse it; do not write a second downloader.
- **There is no date-preset list.** `GRANULARITIES = ['weekly','monthly','yearly','custom']`. Range maths already exists in `analytics-data.ts` as `isoToday`, `isoDaysAgo`, `rangeForGranularity`, `heatmapGranularityForRange`, `yearlyHeatmapColumns`, `monthCalendarGrid`. Your job is to **move** the screen's five pure helpers next to that layer, not to invent presets.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(analytics-query): ...`
2. **Owned Path Fence (exclusive to Agent 1):**
   - `ui/src/features/analytics/AnalyticsScreen.tsx` — **you are the sole owner of this file.** The previous revision split it three ways (1–350 here, 500+ for Agent 3, forbidden for Agent 2), which left lines 350–500 unowned and gave two agents the same JSX tree. That is repaired: Agent 3 no longer edits this file at all.
   - `ui/src/features/analytics/hooks/useAnalyticsFilters.ts` (NEW)
   - `ui/src/features/analytics/utils/dateRangePresets.ts` (NEW)
   - `ui/src/features/analytics/utils/analyticsExport.ts` (NEW)
   - `ui/src/__tests__/AnalyticsScreen.test.tsx` (import repointing, Phase 1.3)
   - `ui/src/__tests__/storageKeyPins.test.ts` — **pin map lines only**, nothing else
3. **Forbidden Paths:**
   - `AnalyticsCardContent.tsx`, `cards/**`, `utils/analyticsCardCsv.ts` (Agent 2)
   - `charts/**`, `AnalyticsHeatmap.tsx` (Agent 3)
4. **Note on Agent 2's dependency on you:** `AnalyticsCardContent.tsx` imports `Granularity` and `WorkspaceView` **from your file**. You are the upstream of that edge. See constraint §2 — the re-export is mandatory, and dropping it is a breaking change for a file you may not edit.
4. **Directory convention:** analytics is currently flat, but `features/kds/hooks/`, `features/retail/hooks/` and `features/sales/utils/` already exist. The `hooks/` + `utils/` split is therefore consistent with the repo, not an invention — just be aware you are introducing it to this feature.

---

## ⚠️ Hard constraints — these gates will fail if you skip them

### 1. The storage-key pin test fails on the first move

`ui/src/__tests__/storageKeyPins.test.ts:73-74` pins two keys to this file and **asserts the pinned module really declares the literal**:

```
'oz-analytics-workspace-view': 'features/analytics/AnalyticsScreen.tsx',
'oz-analytics-zoom':           'features/analytics/AnalyticsScreen.tsx',
```

`oz-analytics-workspace-view` is declared at line 79 and `oz-analytics-zoom` is read at 379 / written at 463. The moment either literal leaves this file, the third assertion (`attributes each key to a module that really declares it`) fails. Update both pin entries **in the same commit** as the move, naming the new file:

```
'oz-analytics-workspace-view': 'features/analytics/hooks/useAnalyticsFilters.ts',
'oz-analytics-zoom':           'features/analytics/hooks/useAnalyticsFilters.ts',
```

### 2. Nine symbols are public API of this module

`ui/src/__tests__/AnalyticsScreen.test.tsx:263` imports seven of them and `dynamicFluentFamilies.test.ts:19` imports one more:

```
AnalyticsScreen (default), nextExpandedKey, daysInCurrentMonth, monthCalendarGrid,
smartScale, cardGranularity, cardRange          → AnalyticsScreen.test.tsx
GRANULARITIES                                    → dynamicFluentFamilies.test.ts
```

`register.tsx` also does `lazy(() => import('./AnalyticsScreen'))`, so **the default export must survive**.

There is a fourth consumer that the previous revision missed entirely, and it is the one that makes the shim load-bearing rather than cosmetic: **`AnalyticsCardContent.tsx:54`** does

```ts
import type { Granularity, WorkspaceView } from './AnalyticsScreen';
```

That file belongs to Agent 2, which is forbidden from editing it. If Phase 1.1 moves those two types without re-exporting them, **Agent 2's file stops compiling** and the failure lands in someone else's working tree. Re-export `Granularity` and `WorkspaceView` from `AnalyticsScreen.tsx` for as long as Agent 2 needs them, and only drop the shim once Agent 2's import is repointed — which is why Phase 1.3 is sequenced last, not merged into Phase 1.1.

Phase 1.1 must therefore leave a re-export block in `AnalyticsScreen.tsx` for the moved symbols. Repointing the two test files is Phase 1.3, deliberately separate so the move commit stays reviewable and your siblings' test runs stay green in between.

### 3. The i18n and bundle-parity gates read staged files

`AnalyticsScreen.tsx` is under `features/`, so gate 4 (`verify-bundle-parity.py --staged-only`) scans it. Moving a `<Localized id>` site into `utils/` moves it **out of** the gated set — if a key's only reference leaves `features/`, the FTL orphan lint (gate 10) can flag it. Keep `Localized` usage in components; move only pure logic.

---

## 📋 Task Checklist

### Phase 1.0: Baseline audit

- [ ] `cd ui && npm run typecheck` — must be green before you start. If it is red, record which file is red and do not fix it; it belongs to another workstream.
- [ ] `cd ui && npm run test -- src/__tests__/AnalyticsScreen.test.tsx` (106 tests)
- [ ] `cd ui && npm run test -- src/__tests__/storageKeyPins.test.ts`
- [ ] Record the three results in your journal. Note: `npm run test -- Analytics` also works but matches **six** files (`AnalyticsScreen`, `AnalyticsCardContent`, `analytics-cache`, `analytics-data`, `analyticsTimezoneAnchor`, `useAnalyticsQuery`) — prefer the explicit path.

### Phase 1.1: Extract pure helpers, types and export utils

- [x] Create `utils/dateRangePresets.ts`. → Done `1cade9e55e`. All nine symbols moved verbatim; `monthCalendarGrid` re-exported from `analytics-data` as specified.
- [x] Create `utils/analyticsExport.ts`. → Done `1cade9e55e`: `exportHeatmapCsv` + `shortCacheLabel`, still on the shared `downloadCsv`.
- [x] Leave a re-export block in `AnalyticsScreen.tsx` (constraint §2). → Done at the time; the `Granularity`/`WorkspaceView` half was **dropped in `c05133d757`** once the last consumer repointed, per its own self-expiring comment.
- [x] Verify: typecheck + `AnalyticsScreen.test.tsx`. → 106/106.
- [x] **Commit Milestone:** → `1cade9e55e` (subject matches exactly).

### Phase 1.2: Lift filter, zoom and view state

- [x] Create `hooks/useAnalyticsFilters.ts`. → Done `8d03585f3c`: storage key, `workspaceView` initialiser, granularity/custom-range state, `storeTz`, the zoom triple + handlers.
- [x] Update `storageKeyPins.test.ts` in the same commit (constraint §1). → Done: the pin now names `features/analytics/hooks/useAnalyticsFilters.ts:33`.
- [x] Do **not** move `expandedKey`, `showScrollTop`, `showShortcuts`, `menuCardId`, `dragId`, `overId` or any `useRef` — those are view chrome, not filter state, and moving them buys nothing. → Honoured: none moved.
- [x] Verify: `npm run typecheck`, storageKeyPins, screen suite. → All green at commit; re-verified at close.
- [x] **Commit Milestone:** → `8d03585f3c`.

### Phase 1.3: Repoint consumers, drop the shim

- [x] Update `AnalyticsScreen.test.tsx` and `dynamicFluentFamilies.test.ts` to import from the new modules. → Done `00a18777f9` (both lines confirmed against `utils/dateRangePresets` at close).
- [x] Do not drop the re-export yet; drop it once Agent 2's commit lands and only the intended import remains. → Landed exactly as planned: after `d3f551ff44`, the remaining `useCardLayout.ts:2` import is the `AnalyticsCard` registry type, which lives in the screen on purpose; `c05133d757` repointed `analytics-data`/`AnalyticsHeatmap` and deleted the shim with its self-expiring comment.
- [x] Verify. → Full analytics set green at each commit; whole-ui re-verified at close (9,568 passed; the 5 failures pre-existing in other lanes).
- [x] **Commit Milestone:** → `00a18777f9` + close-out `c05133d757`.

---

## 📏 Line-count expectation — restated, not the old number

The previous revision promised `< 450 lines`. That is not reachable from this scope, and pretending otherwise would leave a permanently red checkbox. 1,336 of the file's 1,623 lines are a **single component** whose bulk is JSX markup, five popovers, a card menu, drag-and-drop handlers and a scroll-progress listener — not query logic. Extracting range maths and filter state cannot touch it.

Honest target for this work order: **≤ 1,200 lines**, being ~190 lines of module-level logic and ~100 lines of state out.

If a smaller screen is genuinely wanted, the next step is a **separate** work order to split the JSX shell (`AnalyticsToolbar`, `AnalyticsCardGrid`, `AnalyticsPopovers`) — roughly 700 lines of markup. That is a different job with a different blast radius, and it should not be smuggled into this one.

> **CLOSED HONEST — TARGET MISSED, AS PREDICTED.** Final measurement `c05133d757`: **1,409 physical lines** ((Get-Content).Count), against ≤1,200. The three phases moved exactly the 214 lines they owned (module logic + filter state); the ~200-line gap is precisely the JSX markup bulk this order named as its out-of-scope remainder. The target is not being edited retroactively — the miss is the report, and the JSX-shell order above is the real next step.

---

## 🚦 Wait gates

- You do **not** wait on Agent 2 or Agent 3. Your three new files and your screen edits touch nothing they own.
- Agent 3 does **not** wait on you either: the heatmap already lives in its own file (`AnalyticsHeatmap.tsx`, 276 lines) and your Phase 1.1 moves `exportHeatmapCsv` without changing its signature.
- The one ordering constraint in the whole analytics refactor runs **Agent 3 → Agent 2**, not through you. See the interface freeze in `todo-refactor-analytics-agents-3.md`.
