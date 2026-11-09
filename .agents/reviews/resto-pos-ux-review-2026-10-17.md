# Restaurant POS — UX design review

**Reviewer:** DSH (this session) · **Date:** 2026-10-17 · **Branch:** `0.0.41`
**Scope:** the `restaurant-pos` operator surface — `features/restaurant/` (menu panel, cart sheet,
floating cart bar, sidebar, menu editor) and its CSS.
**Method:** static reading of markup + stylesheets, with every load-bearing number recomputed from
`theme/tokens.css` rather than quoted; 5 existing design-contract gates re-run; `file:line` for
every claim. **No live app was driven** — see §6.

---

## 1. Verdict

**This surface is in good shape, and that is the first finding.** It has been audited
exhaustively already: `todo-restaurant-pos-reliability.md` is **121 findings across 267 rounds**
(~460 KB), 23 dedicated test files cover it, and all five findings of the earlier
`resto-pos-ui-review.md` are **CLOSED**. The 2026-09 review was a *code* review that explicitly
excluded "the CSS beyond what affects layout".

So this pass examined what that history has **not** systematically covered: interaction design,
state legibility, and stylesheet consistency. The result is **1 medium-high, 5 medium, 4 low** —
no functional gaps, nothing that breaks a sale, and no finding that contradicts the existing
ledger. Most of the surface is deliberate and documented; the defects are in the seams between
files and in states nobody has looked at with fresh eyes.

**The single most useful structural observation is in §5:** the design-contract gates grade a
*hand-maintained list of stylesheets*, and three of the five restaurant sheets are not on it.

> [!NOTE] Resolution Update (2026-10-19 · Commit `1c63390db`):
> Findings **R1, R2, R3, R4, R5, R8, R9, and §5** have been resolved:
> - **R1**: Floating cart bar fallback corrected to `var(--z-sticky, 200)`.
> - **R2**: Category strip overflow right-edge fade mask added to `RestaurantMenu.css`.
> - **R3**: Dropped misleading `cursor: pointer` on decorative sheet handle.
> - **R4**: Added `:focus-visible` styles to all 5 menu editor interactive controls.
> - **R5**: Clamped editor card name to 2 lines with ellipsis matching selling card.
> - **R8**: Unified active status tab recipe with border and tint.
> - **R9**: Collapsed duplicate `padding-top` / `padding-left` on `.restaurant-card-body`.
> - **§5**: Added `RestaurantMenuEditorScreen.css`, `RestaurantCartSheet.css`, and `RestaurantSettingsScreens.css` to `focusVisibleCompliance.test.ts` (0 violations across 71 sheets).

---

## 2. What is genuinely good (so the findings below are read in proportion)

Not padding — these are the reasons the findings are narrow:

- **The selling card is exemplary.** Fixed height formula, 2-line name clamp with a
  `max-height` fallback for engines without `line-clamp`, an add-affordance strip that is
  `pointer-events: none` with the whole card as one button, and a `prefers-reduced-motion`
  block. The reasoning is written down at `RestaurantMenu.css:787-792`.
- **86'd (unavailable) items are triple-signalled** — colour, a "86" badge, *and* an SR-announced
  status — with a genuine dead-tap fix recorded (`:878-882`).
- **The cart sheet's z-index bug is already fixed and the fix is documented with hit-test
  evidence** (`RestaurantCartSheet.css:30-56`): it was `--z-modal + 1`, which put the sheet over
  the price-override dialog on tablet; it now sits at `--z-overlay`.
- **Theme-token discipline is real**: the only token-gate failures are in `kiosk`, not here.
- **Focus traps, Escape layering, and reduced-motion** are handled in every restaurant sheet I read.
- Category pills carry **colour + a 2px border + `aria-selected`** — meaning is not colour-only.

---

## 3. Findings

### R1 — The floating cart bar's z-index fallback is 10× wrong. **MEDIUM-HIGH**
`RestaurantFloatingCartBar.css:12` — `z-index: var(--z-sticky, 20);`
`tokens.css:411` — `--z-sticky: 200;` · the same file's comment at `:194` says *"(200)"*.

The fallback literal is **20** against a token of **200**. It only applies if the token fails to
resolve, so this is not a live bug — but it is a wrong number sitting where a reader looks for the
truth, in a file whose own comment documents a *measured* incident of this bar becoming
unreachable behind other chrome. If the token ever goes missing, the always-on cart bar drops
below the menu header and cards. **Fix:** `var(--z-sticky)`.

### R2 — Category strip signals overflow only via a 6px scrollbar. **MEDIUM**
`RestaurantMenu.css:662-693` — `overflow-x: auto`, `scrollbar-width: thin`, and a
`::-webkit-scrollbar { height: 6px }` rule. Pills are `flex-shrink: 0` (`:699`), so ~13
categories (a count the codebase itself cites — `RestaurantMenuEditorScreen.css:56-58`) overflow
1366×768, the documented minimum.

A waiter sees a row of pills and no indication that more exist to the right. Partially mitigated —
the strip is an ARIA tablist with arrow-key nav (`MenuCategoryTabBar.tsx:37-53`) — but the
*visual* affordance is a hairline scrollbar that many users never notice, and on touch it is
hidden until scrolled. **Fix:** right-edge fade mask when `scrollWidth > clientWidth`.

### R3 — The cart sheet's "grabber" is a false affordance. **MEDIUM**
`RestaurantCartSheet.css:107-124` — the wrap has `cursor: pointer`; `:118-124` draws a 2.5rem
× 0.25rem grabber bar.
`RestaurantCartSheet.tsx:75-78` — it is a plain `<div aria-hidden="true">` with **no
handlers**. Grep for `onTouch|onPointer|onDrag|swipe` in that file returns nothing.

The comment calls it a *"Drag handle"* and the CSS makes it *look* draggable, but dragging or
tapping it does nothing. Dismissal is available via the backdrop or the close button, so nothing
is unauthorised — but on the tablet form factor this is the single most gesture-obvious element in
the cart, and it lies. **Fix:** wire drag-to-dismiss, or drop `cursor: pointer` and the comment
so it reads as the decorative rule it is.

### R4 — Five real controls in the menu editor have no `:focus-visible`. **MEDIUM**
All in `RestaurantMenuEditorScreen.css`, all genuine `<button>`s, **zero** focus styles:

| Selector | Lines | Note |
|---|---|---|
| `.restaurant-menu-editor-toggle-btn` | :481-497 | the on/off toggle |
| `.restaurant-menu-editor-preset-btn` | :915-942 | |
| `.restaurant-menu-editor-status-tab` | :341-361 | **filters the item list** |
| `.restaurant-menu-editor-search-clear` | :319-330 | |
| `.restaurant-menu-editor-btn-add-opt` | :1071-1086 | |

Sibling controls *in the same file* do define it (:543, :224, :728), so this is drift, not a
house style. The status tabs matter most — a keyboard user filtering to hidden items gets no
indication of where focus sits. **Fix:** apply the file's existing focus rule to each.

### R5 — The menu editor's card name is unclamped beside a `nowrap` price. **MEDIUM**
`RestaurantMenuEditorScreen.css:422-427` — `.restaurant-menu-editor-card-name` has **no**
`line-clamp`, `overflow`, or `text-overflow`; `:429-435` — the price is `white-space:
nowrap`.

The **selling** card clamps to 2 lines (`RestaurantMenu.css:994-1003`). So the same dish name is
bounded in the till and unbounded in the editor: a long Indonesian name wraps freely and stretches
the card. Indonesian strings run ~20–40% longer than English, so this is the likely case, not the
edge case. **Fix:** clamp to 2 lines with ellipsis, matching the selling card.

### R6 — Sub-44px buttons are only floored on coarse pointers. **MEDIUM**
The 44px floor is a catch-all — `components.css:1662-1668`, `@media (pointer: coarse)` — and
`touchTargetSizing.test.tsx:204-215` documents that a small `<button>` is deliberately *not* a
violation for this reason. The consequence is a gap the gate is designed not to see, on a
**fine-pointer** device:

| Control | Size | Site |
|---|---|---|
| `.restaurant-context-swatch` | 28px | `RestaurantMenu.css:1266-1268` |
| `.restaurant-menu-editor-preset-btn` | 28px | editor:915-920 |
| `-btn-icon-danger` / `-btn-icon-subtle` | 28px | editor:998-1004 |
| `.restaurant-menu-editor-color-swatch` | 24px | editor:739-741 |

On a tablet these are 44px and correct. On a **1366×768 touch-screen laptop driven by mouse** they
are 24–28px — below both the repo floor and WCAG 2.5.8. **Fix:** either accept and document the
fine-pointer carve-out in one place, or add a `@media (pointer: fine)` bump.

### R7 — Retry has no in-flight state. **LOW**
`RestaurantMenu.css:1168-1190` — `.restaurant-empty-retry` styles hover/focus only; rendered at
`MenuItemGrid.tsx:70-84` and `:97-108`. The parent swaps to a loading branch
(`MenuItemGrid.tsx:58-66`), so the exposure is narrow: "retry pressed, request still in flight".
**Fix:** disable + busy label while pending. *(Unverified: I did not trace whether
`handleGridRetry` sets `loading` synchronously.)*

### R8 — Three different "active" recipes inside one sheet. **LOW**
`RestaurantMenuEditorScreen.css`: `:357-361` tint only · `:145-149` tint + border ·
`:722-726` tint + border-width. In a glass theme where the active tint is a 5% alpha surface
(`RestaurantMenu.css:155-159`), the tint-only variant is the weakest signal and it is used on the
item-filter tabs — the control where knowing the current filter matters most. **Fix:** one recipe.

### R9 — `.restaurant-card-body` declares `padding` twice. **LOW**
`RestaurantMenu.css:976` sets the shorthand; `:977` and `:979` override top and left; the
explanatory comment at `:978` annotates the values that were already superseded. Not a bug today —
the longhands win by design — but it is edit-fragile: changing the shorthand's bottom or right
silently does nothing. **Fix:** collapse to one shorthand plus the two deliberate overrides.

### R10 — Card height has very little headroom at maximum size. **LOW (informational)**
`RestaurantMenu.css:793` `height`, `:976-979` body padding, `:998-1003` name clamp.
At `cardSize=4, fontSize=4` I recomputed the budget at the real **16px** root
(`reset.css:24` — the "14px root" mentioned in `restaurantCardHeight.test.ts` is hypothetical):

```
card height ...................... 180.0 px
 body padding-top ................  28.0
 body padding-bottom .............  22.0
 content box ..................... 130.0
 name  28px font x 1.5 x 2 lines ..  84.0
 price 14px x ~1.2 + 2 margin .....  18.8
 status chip ......................  18.0
 content total .................... 120.8  ->  ~9 px slack
```

So the card **does fit** — I am not reporting clipping. But with `overflow: hidden` and
`justify-content: center`, a 9px budget means any increase in line-height or chip padding clips
the name **equally from top and bottom**, which reads as a rendering bug rather than a layout
choice. Reported because the margin is thin, not because it is crossed.

---

## 4. Instrument provenance

Findings R2–R9 come from a delegated static stylesheet audit, **not** from me. I then
independently re-verified each load-bearing claim before including it, and that mattered:

- **R1 — verified by me** (token 200 at `tokens.css:411`; fallback 20; comment says 200).
- **R3 — verified by me** (no drag handlers exist; `cursor: pointer` present).
- **R4 — verified by me** (0 `:focus-visible` matches across all five selectors).
- **R6 — verified by me** (`@media (pointer: coarse)` catch-all at `components.css:1662`).
- **R10 — corrected.** The delegated figure was "~2px from clipping"; my recomputation says
  **~9px**. I have published my number, not theirs, and downgraded HIGH → LOW.

One delegated claim (*"the selling card is ~2px from clipping"*) was therefore **not** carried
forward as written. If a later reader cites this review, R10's arithmetic is the one to re-derive.

---

## 5. The structural finding: three restaurant sheets are outside every design gate

This is the reason R4 exists at all, and it is the item I would fix first.

`focusVisibleCompliance.test.ts:336` grades a **hand-maintained list** (`CSS_FILES`) of
stylesheets. That list contains `features/restaurant/RestaurantMenu.css` (`:337`) and
**not**:

- `features/restaurant/screens/RestaurantMenuEditorScreen.css`
- `features/restaurant/components/RestaurantCartSheet.css`
- `features/restaurant/screens/RestaurantSettingsScreens.css`

So the editor's five missing focus styles (R4) pass every gate in the repo, and the cart sheet's
false affordance (R3) is in a sheet nothing scans. This is the same shape as the defect I found
earlier today in the currency work: **the guard existed and the file was not on its list.** A gate
whose population is maintained by hand drifts from the tree it protects.

**Recommendation:** make the sheet list *derived* — glob `features/**/*.css` and require an
explicit, commented exemption per file — so adding a stylesheet opts it in by default rather than
silently leaving it ungraded.

---

## 6. Not verified in this pass

Stated so the next reader knows the edges:

1. **No live app was driven.** The desktop app is running without a debug port, so I could not
   hit-test or measure rendered pixels. Every dimension here is CSS/token **arithmetic**, and
   R10's 9px is the figure most sensitive to being checked against a real render.
2. **WCAG contrast ratios were not computed** — that is `colorContrastCompliance.test.ts`'s job
   and it passes, but I did not re-derive it.
3. **Whether R9's duplicated `padding` was intentional.**
4. **Whether `handleGridRetry` sets `loading` synchronously** (affects R7's real exposure).
5. **The tablet form factor specifically.** R6 is a *fine-pointer* gap by construction; on the
   actual tablet hardware the coarse floor applies and those controls are compliant.

---

## 7. If these are picked up

1. **§5's derived sheet list** — it retires R4 and prevents the next one. One test file.
2. **R1** — one character.
3. **R3** — decide: wire drag (feature) or drop the affordance (one line).
4. **R5, R7, R8, R9** — small, independent stylesheet fixes.
5. **R2, R6, R10** — judgement calls about the fine-pointer/desktop tier; worth an explicit
   decision rather than a drift.

**None of these block a sale, and none contradict the existing ledger.** The surface's real risk is
not in these findings — it is that a hand-maintained gate list lets this class of drift accumulate
silently, which is what §5 is about.
