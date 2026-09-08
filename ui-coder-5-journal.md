# ui-coder-5 journal — analytics drag affordance + chart palette tokens

Branch: 0.0.37 · Date: 2026-09-08 · Status: COMPLETE (both commits landed, gates green)

## Missions delivered

### Mission A — drag affordance (docs/plans/notes.md:35) — SHA cfd12398

- `draggable={!isExpanded}` + `onDragStart` (Firefox `setData` comment kept
  byte-intact) moved from the card div to the header div
  (AnalyticsScreen.tsx ~1312-1338). `onDragEnd` moved with them (dragend
  fires on the drag SOURCE element, so it must live where dragstart does).
- `onDragOver` / `onDragLeave` / `onDrop` stay on the card — drop target is
  still the whole card (per mission).
- CSS (AnalyticsScreen.css): hover lift re-scoped from
  `.analytics-card:hover` to `.analytics-card-header:hover` (box-shadow +
  translateY(-2px) now on the header strip; card keeps its own transition
  so the dragging-opacity fade stays animated). Grip reveal likewise
  re-scoped to `.analytics-card-header:hover`. Grip keeps `cursor: grab`.

**Grip a11y decision — SMALLER CHANGE chosen:** the grip span stays
`aria-hidden` because a full keyboard-equivalent reorder path already
exists in the card options menu (Move up / down / top / bottom,
AnalyticsScreen.tsx ~1461-1475, disabled at first/last). Converting the
grip to a real button would have added a redundant, focusable second
handle. No new user-visible strings → no .ftl changes.

### Mission B — chart palette from theme tokens — SHA 59fab444

- `ui/src/utils/color.ts`: ONE change — the existing private `readCSSVar`
  (line ~194) is now `export`ed. Nothing else added.
- `AnalyticsCardContent.tsx`: `chartColor(varName, fallback)` resolves a
  token via `readCSSVar` with the legacy hex as fallback (empty computed
  value under jsdom ⇒ byte-identical test rendering). `PALETTE` is now
  `PALETTE_TOKENS` (readonly [token, fallback] pairs) resolved to a plain
  `string[]` at module load — tuples never leak into echarts options.

**Old → new mapping** (echarts canvas cannot resolve `var()`; resolved
from tokens.css `:root`/`[data-theme=light]`):

| Old hex | Role | Token | Fallback |
|---|---|---|---|
| `#4f46e5` | revenue/AOV trend, customers-new, PALETTE[0] | `--color-accent` | `#4f46e5` |
| `#3b82f6` | PALETTE[1] | `--color-accent-secondary` | `#3b82f6` |
| `#06b6d4` | PALETTE[2] + basket bars | `--color-info` | `#06b6d4` |
| `#22c55e` | PALETTE[3] + inventory line | `--color-success` | `#22c55e` |
| `#f59e0b` | PALETTE[4] + tables bar + occupancy line | `--color-warning` | `#f59e0b` |
| `#f97316` | PALETTE[5] | `--color-warning-pos` | `#f97316` |
| `#ef4444` | PALETTE[6] | `--color-danger` | `#ef4444` |
| `#8b5cf6` | PALETTE[7] | `--color-purple` | `#8b5cf6` |
| `#c7d2fe` | customers-returning segment/legend | `--color-accent-subtle` | `#c7d2fe` |
| `#94a3b8` | prev-period dashed overlay + `CHART_TEXT` axis labels | `--color-fg-muted` | `#94a3b8` (exact dark-theme match) |
| `#fff` | donut segment separator border | kept literal `DONUT_BORDER` | — |

`#fff` deliberately kept: the analytics surface is a FIXED light card
(AUT-1 screen-scoped `--analytics-*` tokens, AnalyticsScreen.css:16-56 —
not on `:root`, so `readCSSVar` cannot resolve them); no global token
expresses the white card surface. It was not in the mission's site list.

### Mission C — analytics-cache.ts `: any` / `as any` — NO CHANGE

Premise does not hold: a precise scan (`: any\b`, `as any\b`, `any[]`,
`<any>`, `Array<any>`) over the whole `ui/src/features/analytics/` dir
finds ZERO type-position `any`. The only hits are prose in comments
("any other shape…" analytics-cache.ts:456, "without any" in
analytics-data.ts:742). `TtlCache<unknown>` is already used for the
shared cache. The file is untouched and therefore not in commit 2.

## Deviations (declared)

1. `ui/src/__tests__/AnalyticsScreen.test.tsx` edited (outside the listed
   fence, not in any DO-NOT-TOUCH list): three drag-reorder tests fired
   `dragStart`/`dragEnd` on the card div; events now originate from the
   card's `.analytics-card-header`. Assertions untouched — reorder order,
   localStorage persistence, and layout-saved toast all still asserted.
2. `onDragEnd` moved with `onDragStart` (mission listed only
   draggable+onDragStart; dragend fires on the source element).
3. `analytics-cache.ts` NOT in commit 2 — nothing to fix (see Mission C).
4. Mid-flight fix per orchestrator heads-up: PALETTE tuples leaked into
   `color: string` fields (TS2322 at :939/:1115) — resolved via the
   `PALETTE_TOKENS.map(...)` → `string[]` before committing.

## Verification gate status

- `npx vitest run` (from ui/) AnalyticsScreen + AnalyticsCardContent +
  themeTokenCompliance + animationCompliance + color + analytics-cache:
  **6 files / 193 tests passed, exit 0**.
- `npm run typecheck`: **exit 0** (also re-run by the pre-commit gate on
  both commits).
- Pre-commit gates (10-step hook) green on both commits; i18n lint clean,
  bundle parity 0 missing keys on both.
- `git merge-base --is-ancestor` exit 0 for BOTH SHAs after commit
  (per the 2026-09-08 reset-warning protocol).
- Fence audit: cfd12398 = exactly 3 files; 59fab444 = exactly 2 files;
  `git status` on fence paths empty after both commits.

## Commit ledger

| SHA | Subject | Files |
|---|---|---|
| `cfd12398` | feat(ui): scope analytics drag to card header grip | AnalyticsScreen.tsx, AnalyticsScreen.css, __tests__/AnalyticsScreen.test.tsx |
| `59fab444` | refactor(ui): derive analytics chart palette from theme tokens | AnalyticsCardContent.tsx, utils/color.ts |

## Residual notes for the orchestrator

- Theme reactivity: palette constants resolve at module load (per mission:
  "module or component level"). A mid-session theme switch while the
  analytics page is already open updates DOM surfaces via CSS but chart
  canvases keep their load-time colours until the page remounts (matches
  the reports DashboardScreen status quo, which uses frozen hexes).
- The analytics surface is fixed-light (AUT-1) while the resolved tokens
  follow the global theme — under the dark theme, status colours are the
  brighter dark-theme variants (e.g. success #6FE884 vs light #2E9E3E).
  That is the intended token-driven behaviour; flag for design review.
- Old POS hardware: `:has()` was avoided; the lift uses plain
  descendant:hover — no selector-support risk in the Tauri webviews.