# TODO — Analytics JSX-shell split (agents-4): AnalyticsScreen.tsx

<!-- Audit stamp: 2026-09-13 · DSH · status: OPENED against the live file.
Measured with (Get-Content).Count and per-region greps at commit
411e6dccfb — premises below are line numbers in the CURRENT file, not
reconstructions. This order exists because agents-1 named it as the real
next step and its target was missed while it was open; slice 1 of this
order retired that miss (1,409 -> 1,170 ln, now under the <=1,200 goal). -->

## Source

- Parent order: [`done-todo-refactor-analytics-agents-1.md`](./done-todo-refactor-analytics-agents-1.md)
  (:145 follow-up stamp — do not restate its phases here).
- Target file: `ui/src/features/analytics/AnalyticsScreen.tsx` — **1,170 ln**
  at this order's opening (component `:110`, main `return (` at `:553`,
  component end `:1170`); 1,139 after slice 2.
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

## Done — slice 2 (`d5e3aba339`): command palette shell

- [x] `components/CommandPalette.tsx` — the hook (`useCommandPalette`) already owned state and keys; the component is the thinnest possible presentation seam, generic in the item shape (the union stays the screen's). Screen: 1,170 → **1,139 ln**.
- [x] Ratchet sweep: confirmed zero `title=` in the palette (measured, as predicted) — baseline untouched; the suite's two reds stay restaurant-only.

## Done — slice 3a (`86e4dc5670`): the card grid — decided, then moved

- [x] Plan pass done against `useCardLayout.ts` read fully: the chosen
  seam is a **children-slot `components/AnalyticsCardFrame.tsx`**, not a
  context/reducer migration. The frame owns chrome (shell classes, header
  drag wiring, info/expand/menu buttons, portaled menu + its keyboard-nav
  loop) and reports intent; card DATA (heatmap's 11 query variables, the
  content dispatcher) renders into the slot from the screen — the wide
  drill the order feared never crosses the seam. State stays where its
  other drivers (keydown effect, palette) already are.
- [x] Drag trap handled as predicted: jsdom drag tests passed untouched
  (106/106), `dataTransfer` handling verbatim including the Firefox
  comment. Three drifts caught in the pre-commit verbatim audit (info
  button is `descKey` not `titleKey`; `onDragLeave` ≠ `onDragEnd` —
  leave clears only the marker; menu-expand lacks the header's
  compact-mode side effect) — recorded so nobody "simplifies" them back.
- [x] Screen: 1,139 → **994 ln**. Ratchet moved 8→5 + frame 3, sum 82.

## Done — slice 3b (`a070d2ab72`): the toolbar rows

- [x] `components/AnalyticsToolbar.tsx` — pure layout; every composed side
  effect (workspace-switch reset cascade, `customTouched`, the three
  toasts, collapse-all's expanded-card restore) stayed screen-composed
  behind one callback each, as measured. Zoom cluster crosses as a
  slot; `ZoomControls`' wiring never re-threads. (One pre-existing
  indentation damage in the From-input handler was NOT copied; named in
  the commit.)
- [x] Ratchet moved by measured delta: screen 5→1 (scroll-top stays),
  toolbar +4, sum pinned 82.

**Order status: COMPLETE.** `AnalyticsScreen.tsx` 1,409 → **864 ln**
across six slices; every extraction verbatim; 106 screen tests never
touched. What remains of the analytics trilogy's ambition (further
component counts, CSS split) was never in THIS order's boxes.

## Rules inherited from the parent order

- Measure before writing any number into this file; every count above was
  taken from the live file at the stamped commit.
- Bodies move verbatim. A "while I'm here" change is a second commit with
  its own reason.
- One line of pathspec per commit; new files via the sanctioned chain.
- Gates per slice: typecheck (ignore the devmock lane's live-file TS6133
  set), AnalyticsScreen.test, touched compliance suites, eslint 0 errors.
