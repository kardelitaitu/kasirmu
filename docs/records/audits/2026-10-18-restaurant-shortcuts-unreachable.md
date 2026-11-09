# The restaurant shortcut manifest had no renderer — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 93 · status: 2 findings fixed,
     1 gap closed · branch: 0.0.41 · commits: `0f9c09096`, `a4b37b0da' -->

<!- - Scope: a full `ui` vitest run as a health baseline, then the restaurant POS
     discoverability surface. -->

## Finding 1 — five working keys, zero documentation

`restaurantShortcuts.ts` declares five bindings (Shift+K/P/B/T/L) and BOTH locale bundles
carry a string for every `labelId`. Grepping `restaurant-shortcut-` across `ui/src`
returned exactly three things: the manifest, `sales.ftl`, `sales.id.ftl`. **No renderer.**

So a waiter had no way to learn the keys. They worked — each is correctly wired through
`PosScreen.tsx:1716-1730` to a self-guarding handler, with a documented
`saleViewVisible` guard — and the only description of them was unreachable. That is dead
documentation, which is worse than none because it keeps the gap reading as closed.

**The retail till never had this gap**, and that is what made it findable: it renders
`RETAIL_HELP_SHORTCUTS` through `RetailModals.tsx:731`, reached by the `?` binding. The
manifest/overlay split is the shape copied here.

**Fixed** with `RestaurantShortcutsHelp.tsx`, rendered inline in the sidebar behind a toggle
row. The panel reads the labels FROM the manifest, so the help text cannot disagree with what
the keys do — the same rule `restaurantShortcutParity.test.ts` enforces for the handler map.

Two decisions recorded because both were avoidable mistakes:

- **Not a modal.** It renders in the sidebar's own scroll column, inheriting that panel's focus
  trap and Escape handling. A nested dialog would have fought it for both.
- **Inline, not a `?` route.** `?` is owned by retail (`retailShortcuts.ts:51`) and the parity
  test asserts the restaurant manifest claims no key retail owns. Taking `?` would have broken a
  collision guard that is already green.

## Finding 2 — a CSS contract test caught an invented token

The panel's stylesheet initially used `--font-family-mono`, `--font-size-xs`,
`--font-size-sm` and `--font-size-md`. Only `--font-family-mono` was wrong on its face:
`tokens.css` defines `--font-mono`. The `--font-size-*` spellings looked fine and are used
elsewhere in `RestaurantMenu.css`, but grepping for their definitions found **none anywhere in
`ui/src`** — they are undefined custom properties that compute to nothing, pre-existing drift
in that sheet (4 sites) rather than something this round introduced.

Corrected my block to `--font-mono` / `--text-xs` / `--text-sm` / `--text-md` and verified
all 15 tokens against `tokens.css` before committing.

**Correction 2026-10-18 (round 95): the `--font-size-*` claim above was WRONG.** This record
first asserted that four `--font-size-*` spellings in `RestaurantMenu.css` were undefined
custom properties. Round 95 re-checked with `grep '\-\-font\-size'` and there is no such
token anywhere in `ui/src`: the six hits are all the SINGLE name `--font-size`, a
runtime-injected property set from React (`RestaurantMenu.tsx:683`, the menu size control)
and read as `var(--font-size, 0)` (`RestaurantMenu.css:702, 793, 990, 1013`). That is a
legitimate live control with a deliberate `0` fallback, not drift.

The original claim came from my own regex matching `--font-size-xs` as a SUBSTRING of
`var(--font-size, 0) * 1px`-style expressions — the same class of detector error this
campaign keeps paying for, and the reason the sweep numbers in this file are stated with
their detector's validation rather than alone. Nothing in the tree needed fixing.

`themeTokenCompliance.test.ts` then caught the panel's `line-height: 1` — the frozen
line-height-literal guard working exactly as designed. Rather than restate the count from 2 to
3 quietly (a wildcard would have hidden a future third site), the restatement names the reason:
the close button is a single glyph in a box with no flex row, the identical justification the
2026-09-29 entry gives for the two existing sites in the same sheet.

## A third guard this feature tripped, and why that is the system working

`screenExtraction.test.ts`'s dead-class walk graded all seven new CSS classes as
unreachable. They are reachable — but the sidebar renders only the wrapper
`restaurant-shortcuts-help`; the six inner names are spelled in the CHILD
`RestaurantShortcutsHelp.tsx`, which was not in the entry's `additionalTsx` list. The
classes were live and the walker simply never opened the file that names them.

Fixed by citing the child, not by prefix-excusing the names: a `dynamicClassPrefixes`
entry would excuse the whole family, including a member that later becomes genuinely dead.
Kill-tested — removing the cite restores `Dead classes: …` exactly.

Three separate structural guards fired on this round's work (the line-height freeze, the
theme-token contract, the dead-class walk) and every one of them was correct to fire or
correctly satisfied by a named exemption. That is the pattern worth keeping.

## Verification

- **Full suite: 811 files, 12,869 passed, 0 failed** (3 skipped, 3 todo).
- `npx vitest run src/__tests__/RestaurantSidebar.logic.test.tsx` — 34/34.
- `themeTokenCompliance.test.ts` 53/53; `restaurantShortcutParity.test.ts` green.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors (113 pre-existing
  `react-refresh` warnings); `npm run lint:i18n` clean.
- **Kill tests, two.** Inert toggle: 3 cases fail. `labelId` -> action id: the panel renders
  `send-kitchen` / `print-bill` verbatim and the translated-label case fails on
  `Send to kitchen` — the exact failure mode its comment names. Both files restored
  byte-identical.

## The standing lesson

A full-suite baseline is not overhead. This round found five failures, THREE of which this
campaign's own earlier commits caused, and a fourth that had been passing for the wrong reason.
A fix verified only against its own test file is not verified.

> last audited 18-10-26 by autonomous-goal-round-93
