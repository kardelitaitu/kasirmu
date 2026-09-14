# Orchestrator Agent 3: Restaurant Menu, Course Grouping & Modifier Popups

**Document:** `todo-refactor-kds-agents-3.md`  
**Role:** Orchestrator Agent 3 (Menu & Modifier Experience Architect)  
**Goal:** Decompose `RestaurantMenu.tsx` (1,114 lines) from a monolithic menu grid into modular category tab bars, product tiles, modifier selection modals, and course assignment controllers.

> ⚠️ **Baseline correction (execution 2026-09-08):** the real starting file was **1,197 lines**, not 1,114 — the doc's count was stale at `20ab69c77`. Every number below is measured, not inherited.

**Target File:** `ui/src/features/restaurant/RestaurantMenu.tsx` (Baseline: 1,114 lines → **actual 1,197**)  
**Sibling Documents:**
- [`todo-refactor-kds-agents-1.md`](../../todo-refactor-kds-agents-1.md) (Agent 1 — KDS Ticket State Machine & Input Peripherals)
- [`todo-refactor-kds-agents-2.md`](../../todo-refactor-kds-agents-2.md) (Agent 2 — Order Ticket Cards & Station Timers)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(restaurant-menu): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/restaurant/RestaurantMenu.tsx`
   - `ui/src/features/restaurant/components/` (NEW directory)
     - `MenuCategoryTabBar.tsx`
     - `MenuItemGrid.tsx`
     - `MenuItemTile.tsx`
     - `ItemModifierModal.tsx`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `KdsScreen.tsx` or KDS hooks (Owned by Agent 1 & Agent 2). — honored: `ui/src/features/kds/**` untouched.
   - *Execution addendum (orchestrator authorization, 2026-09-08):* `ui/src/__tests__/screenExtraction.test.ts` added to the fence **scoped to the RestaurantMenu entry only**, for registering the extracted components. — honored: single 10-line `additionalTsx` insertion, no other entry touched.

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Run `npm run test -- RestaurantMenu` in `ui/`. — **green before any edit**: 49/49 `RestaurantMenu.test.tsx` + 5/5 `restaurantCardHeight.test.ts` (54 tests, 2 files).

### Phase 3.1: Extract Modifier Modal & Item Tiles
- [ ] Extract `<ItemModifierModal />` into `components/ItemModifierModal.tsx` (handles option groups, min/max selection, price delta). — **OUT OF SCOPE: there is no modifier modal in `RestaurantMenu.tsx`.** A content search for `modifier|Modifier|course|Course|monogram|86` across `ui/src/features/restaurant/` returns zero hits; the only `ItemModifierModal` in the repo is `ui/src/features/sales/components/ItemModifierModal.tsx`, which belongs to the sales feature (fenced for this work order). Inventing a modal wrapper around JSX that does not exist would violate the pure-refactor mandate, so no file was created.
- [x] Extract `<MenuItemTile />` into `components/MenuItemTile.tsx`. — the former `RestaurantCard` moved verbatim (long-press/click-suppression gestures, pin badge, price, `restaurant-card-status` 86'd/unavailable badge, plus/check/minus add-badge glyphs, `TOUCH_SLOP_PX`). Note: the card in this file has no picture/monogram rendering to extract — that part of the line's description has no referent.
- [ ] Extract the "course assignment controller" named in the Goal. — **OUT OF SCOPE: not inline JSX in this file.** Course assignment lives in `ui/src/features/sales/components/CourseSelectorBar.tsx` (fenced). Nothing to extract.
- [x] Verify: `npm run typecheck`. — zero errors from `features/restaurant/**`; the only two errors tree-wide were concurrent-session in-flight work in `features/workspaces/WorkspaceHome.tsx`, never touched.
- [x] **Commit Milestone:** — committed as `4c2633f98a` in the sanctioned shared-branch pathspec form, `refactor(restaurant-menu): extract MenuItemTile product card component`. (The bare `git commit -m ...` snippet above is forbidden by Git & Commit Policy §3 on this concurrent branch; the subject convention was kept.)

### Phase 3.2: Extract Category Bar & Reduce `RestaurantMenu.tsx`
- [x] Extract `<MenuCategoryTabBar />` and `<MenuItemGrid />`. — tab strip + the whole `CategoryIcon*` SVG family into `MenuCategoryTabBar.tsx`; loading/empty/grid branches + per-tile derivation (unavailable fold-in, colour fallback) into `MenuItemGrid.tsx`. **Three subtrees the plan never counted were also extracted** (required for the composition-root budget, same move-as-is discipline): `MenuItemContextMenu.tsx` (right-click/long-press overlay: pin, mark available/unavailable, colorize palette + its focus/roving/dismissal effects), `MenuPreferencesMenu.tsx` (hamburger popover: sort modes, size/font steppers, theme/lock/fullscreen + its keyboard contract), `MenuSearchBar.tsx` (search field + the two global shortcuts that target it).- [x] Reduce `RestaurantMenu.tsx` to a clean composition shell.
- [ ] Verify `RestaurantMenu.tsx` line count drops from 1,114 to < 300 lines. — **DEVIATION (accepted band):** 1,197 → **439** lines. Under the ≤450 stamped-acceptable band, not under 300. The remaining lines are not missed subtrees: they are root-owned shared state and its persistence (`pinned`/`colors`/`unavailable`/`popularityCounts` + the eight localStorage helpers, backend preference sync, user-switch rehydration), the `filtered` derivation, and `handleAddProduct` — every one consumed as props by two or more extracted children. Moving them further would mean inventing a store/hook abstraction this pure refactor forbids.
- [x] **Commit Milestone:** — committed as `d4118c9592` (same pathspec form), `refactor(restaurant-menu): modularize tabs, grid, overlays and reduce RestaurantMenu to composition root`.

---

## ✅ Execution stamp — 2026-09-08, branch `0.0.37`

| Item | Measured result |
|---|---|
| Baseline | `RestaurantMenu.tsx` **1,197 lines** at HEAD `20ab69c77` (doc's 1,114 was stale) |
| Final composition root | **439 lines** — target <300 ✗ / acceptable band <450 ✓ (deviation stamped in Phase 3.2) |
| New files (`components/`) | `MenuItemTile.tsx` 245 · `MenuCategoryTabBar.tsx` 141 · `MenuItemGrid.tsx` 76 · `MenuItemContextMenu.tsx` 214 · `MenuPreferencesMenu.tsx` 263 · `MenuSearchBar.tsx` 116 (module headers + prop docs included) |
| Commits | `4c2633f98a` (milestone 1: tile) · `d4118c9592` (milestone 2: tab bar, grid, overlays, shell) · `fa88a9296f` (this stamp) · `72563a9b50` (fix-forward, see below) |
| screenExtraction gate | The per-screen dead-class scan in `ui/src/__tests__/screenExtraction.test.ts` goes red the moment classNames leave the screen file — milestone commits 1–2 left the **RestaurantMenu** entry red (the brief's verification trio did not include this suite). Fixed forward in `72563a9b50` by registering all six `components/*.tsx` in the entry's `additionalTsx` (the pattern the staff extraction proved in `0ef0c413e6`), only the RestaurantMenu entry touched; its three checks then verified green. A remaining red in that file is the **WorkspaceHome** entry (`workspace-tools-grid` dead) — a concurrent workspaces refactor's in-flight state, not touched per fencing. |
| Tests | baseline **54/54** (`RestaurantMenu.test.tsx` + `restaurantCardHeight.test.ts`) → final **70/70** with `errorPolicyCompliance.test.ts` (+4) and `dynamicFluentFamilies.test.ts` (+8, exercises the `SORT_MODES` export which intentionally remains in `RestaurantMenu.tsx`) |
| ESLint | **0 errors** on `features/restaurant/RestaurantMenu.tsx` + `features/restaurant/components`; one warning (`react-refresh/only-export-components` on the pre-existing `SORT_MODES` export) present identically at baseline |
| Typecheck | **0 errors** contributed by `features/restaurant`; only foreign in-flight `features/workspaces` errors remain |
| CSS | `RestaurantMenu.css` **unchanged (834 lines, single root import)** — `restaurantCardHeight.test.ts` reads this exact path and pins `.restaurant-card`/`.restaurant-card-name` rule bodies, and moving rule blocks into sibling files reorders the cascade, risking the visual-change the pure refactor forbids. The "sibling css conventions" allowance was therefore exercised as: no move. |
| i18n | all `Localized`/`getString` sites moved with their JSX; **no new FTL keys**; pre-commit `verify-bundle-parity` passed on both commits (0 missing keys across 8 surfaces) |
| Untouched fences | `features/kds/**`, `dev-mock/**`, `locales/**`, contexts, api, `*.rs` — no writes, no `git add` leakage (new-file chain named only Agent 3 paths) |
