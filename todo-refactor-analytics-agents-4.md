# TODO — Analytics JSX-shell split (agents-4): AnalyticsScreen.tsx

<!-- Audit stamp: 2026-09-13 · DSH · status: OPENED against the live file.
Measured with (Get-Content).Count and per-region greps at commit
411e6dccfb — premises below are line numbers in the CURRENT file, not
reconstructions. This order exists because agents-1 named it as the real
next step and its target was missed while it was open; slice 1 of this
order retired that miss (1,409 -> 1,170 ln, now under the <=1,200 goal). -->

## Source

- Parent order: [`todo-refactor-analytics-agents-1.md`](./todo-refactor-analytics-agents-1.md)
  (:145 follow-up stamp — do not restate its phases here).
- Target file: `ui/src/features/analytics/AnalyticsScreen.tsx` — **1,170 ln**
  (component `:110`, main `return (` at `:553`, component end `:1170`).
- Regression net: `ui/src/__tests__/AnalyticsScreen.test.tsx` (106 tests —
  passed untouched through slice 1's four extractions), plus
  `nativeTooltipCompliance` (ratchet moves with moved `title=` attrs —
  slice 1 moved 7: screen 15→8, ZoomControls 4, CacheMetricsPanel 3,
  total pinned 82), bundle-parity pre-commit (features/** is scanned —
  every extracted file keeps its `Localized`/`getString` sites).
- NOT registered in `screenExtraction.test.ts` (measured: zero mentions of
  `AnalyticsScreen` there) — so no `additionalTsx` obligation; do not
  invent one. If a later registration adds it, that test's registry is
  the place, exactly as PaymentModal's children had to be.

## Done — slice 1 (`411e6dccfb`): near-zero-coupling renderings

- [x] `components/SessionRecoveryBanner.tsx` — one nav prop.
- [x] `components/NoWorkspacePrompt.tsx` — one nav prop.
- [x] `components/ZoomControls.tsx` — zoom cluster + shortcuts popover;
  refs/open-booleans stayed screen-owned (the outside-click effect at
  `:374` and the Escape branches own them); `SHORTCUTS` moved with its
  measured sole consumer.
- [x] `components/CacheMetricsPanel.tsx` — chip + metrics table verbatim.
- [x] Screen ≤ 1,200: **1,170**. agents-1's miss retired (its stamp
  updated; its text not rewritten).

## Open — slice 2: command palette surface (~45 ln JSX, `:1124–1168`)

- [ ] `components/CommandPalette.tsx` — state already lives in
  `useCommandPalette` (paletteOpen/Query/Index, inputRef, filteredItemsRef,
  runItemRef); the screen's `paletteItems` memo (`~:420–495`) is data.
  Props: the hook bundle + items + the two refs. Low coupling, real win:
  it also makes the palette testable without mounting the whole screen.
- [ ] Ratchet sweep: palette has zero `title=` attrs (measured) — expect
  no baseline movement; confirm, don't assume.

## Open — slice 3: the coupled core (grid `:845–~1110` + toolbar rows
`:589–772`) — LAST, and only with its own plan pass

- [ ] `AnalyticsCardGrid` / `AnalyticsToolbar` split: the grid closes over
  ~12 screen values per card (orderedCards, cardId, cardGranularity,
  cardWindow, expandedKey, allCollapsed, collapsedCards, dragId, overId,
  menuCardId, session-scoped query helpers, handlers). A props-drill
  this wide is a design decision, not a mechanical move — decide
  (context object vs reducer + dispatch vs render props) AFTER reading
  `useCardLayout.ts` fully, so state ownership moves with the JSX
  instead of being threaded through it.
- [ ] Known trap for this slice: `dragstart` handlers set
  `dataTransfer` — jsdom tests (`fireEvent.dragStart`) must keep passing;
  run the 106-test suite per step, not per slice.

## Rules inherited from the parent order

- Measure before writing any number into this file; every count above was
  taken from the live file at the stamped commit.
- Bodies move verbatim. A "while I'm here" change is a second commit with
  its own reason.
- One line of pathspec per commit; new files via the sanctioned chain.
- Gates per slice: typecheck (ignore the devmock lane's live-file TS6133
  set), AnalyticsScreen.test, touched compliance suites, eslint 0 errors.
