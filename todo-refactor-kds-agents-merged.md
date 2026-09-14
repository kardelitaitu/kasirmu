# Orchestrator Agent 1+2 merged: KDS Screen Decomposition (`KdsScreen.tsx`)

<!-- Merged 2026-09-14 by DSH (docs-auditor) from todo-refactor-kds-agents-1.md (96 ln, 8 open boxes), todo-refactor-kds-agents-2.md (119 ln, 8 open boxes) and todo-kds.md (1 ln, 0 boxes, a sequencing pointer). The three sources are LEFT IN PLACE - not deleted, not renamed done- - because the work they plan is unfinished; this file is the single owner of the lane until the user retires them. Every count and anchor below was re-measured today, not inherited from a source doc. -->

> **SUPERSEDES** `todo-refactor-kds-agents-1.md` + `todo-refactor-kds-agents-2.md` + `todo-kds.md` **as a plan of record**, and merges two lanes that fenced the same file against each other. What changed by merging: the gate is restated on measurement (`<= 700`, not `< 350`), three fence collisions are resolved, and every still-open box is carried with a disposition. **16 open boxes in, 16 carried rows out** (this file shows 18 boxes because the merge adds 2 of its own, both named in the reconciliation table at the bottom). Check that table before calling anything lost.

**Document:** `todo-refactor-kds-agents-merged.md`  
**Role:** single owner of the KDS decomposition lane (was Agent 1 - Ticket State Machine & Input Peripherals - plus Agent 2 - Order Ticket Cards & Station Timers).
**Goal:** reduce `ui/src/features/kds/KdsScreen.tsx` to a composition root by extracting what extraction can actually move - and stop there, with the number proven.

---

## Sizing (measured 2026-09-14)

- `ui/src/features/kds/KdsScreen.tsx` = **1,193 lines** (`wc -l`; the read tool agrees, and a split-on-newline count reads 1,194 - that +/-1 is method, not a second file). The old 1,127 matched **no** revision: the file was already 1,193 at `1af143f23`, the commit that added this roadmap.
- `return (` is at **`:697`**. So `:95-696` is hook and callback territory and `:697+` is the render tree - **the old Agent 2 fence line Lower JSX tree, Lines 400+ fenced that lane into Agent 1's territory.**
- Card markup is **already out**: it lives in `components/KdsTicketCard.tsx` (**574** ln, `React.memo`, added by `ae6d19ae7` 2026-07-09, grown by `67b2849dd` 2026-09-13). The grid is delegated to `KdsLayoutMasonry` (`:666`) and the completed view to `KdsCompletedView` (`:686`). Header and zone chips are **not** delegated.
- The SLA rule is a shipped hook, not a missing component: `hooks/useTicketSla.ts` (**196** ln, `d82a1aa1a`) - `SlaLevel` at `:6`, defaults `yellowAtSec: 300` / `redAtSec: 600` at `:17-20`, `urgent` at >=900 s at `:37`, consumed at `KdsTicketCard.tsx:175`, per-user overrides via `kdsCardColors.ts` + `KdsCardColorsContext.tsx`, thresholds flowing from `kdsSettingsModel.ts:19-32`.
- Board refresh is a **Tauri event**, not a websocket: `listen<null>('kds:orders-changed', ...)` at `:257` (0 `WebSocket` hits under `features/kds/`), plus `hooks/useKdsOffline.ts` (608 ln). No client poll loop - no `setInterval` in the file; the lone `setTimeout` at `:212` is the 3-second arrival highlight.
- Feature directory today: 33 files, 15 `.tsx`. The biggest neighbours are `KdsTicketCard.tsx` (574), `KdsHamburgerPanel.tsx`, `KdsCompletedView.tsx` (239), `KdsScreenFooter.tsx` (100), `ModifierBadge.tsx` (101), `KdsLayoutMasonry.tsx` (116) - and `KdsScreen.css` at **2,443** ln, twice the size of the screen it styles.

---

## Single-owner fence

One owner now, so the fence is one list. Everything below is this lane's to edit. `ui/src/features/restaurant/RestaurantMenu.tsx` is **not** in it (that is Agent 3's finished lane, and it does not live under `features/kds/`, despite what both source docs implied).

- `ui/src/features/kds/KdsScreen.tsx` (1,193 ln) - whole file, both halves.
- `ui/src/features/kds/hooks/useKdsKeyboardShortcuts.ts` (NEW; replaces the invented `useBumpBar.ts`).
- `ui/src/features/kds/hooks/useKdsTickets.ts` (NEW - still does not exist, so that slice is unstarted).
- `ui/src/features/kds/components/KdsNoticeBanners.tsx` and `KdsHeaderToolbar.tsx` (NEW).
- Existing files here are **edit**, never NEW: `components/KdsTicketCard.tsx` (574 ln), `KdsLayoutMasonry.tsx`, `KdsCompletedView.tsx`, `KdsScreenFooter.tsx`, `components/ModifierBadge.tsx`, `hooks/useKdsPreferences.ts` (212 ln), `hooks/useActionCooldown.ts` (64 ln), `hooks/useNewTicketSound.ts` (81 ln), `kdsCardColors.ts`, `KdsCardColorsContext.tsx`, `KdsScreen.css`.
- **Commit prefixes, measured:** `refactor(kds-state): ...` has **0** commits ever (`git log --format=%s | grep -c refactor` then filter the prefix) - Agent 1's lane never shipped under its own declared prefix. `refactor(kds-ui): ...` has **2** (`cb3254878`, `32d9f68b8`, both 2026-09-13), and both moved the settings *model*, not ticket-card presentation. Pick one per commit. Use the pathspec form (AGENTS.md 3): `git commit -m refactor(kds-ui): ... -- path/one path/two`; a bare commit in this checkout consumes whatever another agent staged.

### Collisions the merge had to resolve (both docs fenced the same lines)

1. **Status transitions `:1018` and `:1058`.** `updateKdsStatusScoped` / `nextKdsStatus` calls sit at `:226`, `:293`, `:298`, `:321`, `:322`, **`:1018`**, **`:1058`** - the last two inside the render tree Agent 2 owned while the logic was Agent 1's. Neither doc could touch them without the other objecting. Now one owner: they move with slice 3 or stay, no coordination note needed.
2. **`handleZoneTablistKeyDown` `:492-533`, `handleFilterPanelKeyDown` `:570`, `handleFilterBtnKeyDown` `:598`.** Agent 1's lines (keydown handlers, inside `:95-696`) serving Agent 2's UI (the zone-chip roving tabindex at `:939`, the filter dropdown in the header at `:733`/`:771`). Split across two fences; joined here.
3. **`KdsTicketCard.tsx` was claimed by both.** Agent 2 fenced it as its primary NEW file, though it has existed since `ae6d19ae7`; Agent 1's cards consume `useTicketSla` *inside* it (`KdsTicketCard.tsx:175`). One owner, so the shared file is simply shared.

---

## The gate, stated honestly

- [ ] **RESTATED 2026-09-14: the docs' `< 350` is UNREACHABLE; the accepted target is `<= 700`.** The whole lawful harvest of 1,193 is: notice banners `:968-1098` **-117**, header + zone chips `:715-935` + `:937-966` **-233**, ticket lifecycle **-100**, keyboard `:412-469` **-40**, confirm modal `:137-141` (rendered `:1159-1169`) **-28**. Sum: **-518**, so `1,193 - 518 = 675`, and the honest floor band is **~650-700** because every extraction also buys call-site and import lines. Reaching 350 would require deleting the render tree, not extracting from it.
- Both source docs' boxes about this stay **unticked** - agents-2 `:113` is carried below as RESTATED, not as done.
- This number is also **UNENFORCED**: `grep -c max-lines ui/eslint.config.js` = 0, and the 70 rows of `scripts/gates.json` contain no size gate (`grep -c id: scripts/gates.json` = 70). `AGENTS.md` section 2 scopes the under-1,000 / preferably-under-600 rule to production `.rs` files. No CI run has ever failed on a `.tsx` line count, so never cite one as a CI failure.

## ORDER (each slice is independently revertible - that property is the reason never to combine slices)

1. **Slice 1 - notice banners `:968-1098`** into `components/KdsNoticeBanners.tsx`. Largest single win (-117), shares no state with the rest, and the right place to prove the conversion-to-import rule below on a small surface.
2. **Slice 2 - keyboard `:412-469`** into `hooks/useKdsKeyboardShortcuts.ts`. (The docs cited `:412-468`; the listener registers at `:467` and the effect's cleanup `return` is at `:468` - re-derive before cutting.) Decide about the adjacent handlers in the same commit: `handleZoneTablistKeyDown` `:492-533`, `handleFilterPanelKeyDown` `:570`, `handleFilterBtnKeyDown` `:598`.
3. **Slice 3 - header + zone chips `:715-935` + `:937-966`** into `components/KdsHeaderToolbar.tsx`. This is where collisions 1 and 2 get settled.
4. **`useKdsTickets.ts` LAST, and only after slice 3.** It touches the fetch/listener/status core (`:226`, `:257`, `:293-322`, `:1018`, `:1058`) that every other slice's call sites read; doing it first re-anchors slices 1-3 onto lines that have not finished moving.

Real API surface for item 4, since the invented `bumpOrder` / `recallOrder` / `holdTicket` trio has **0** hits in `ui/src`: `ui/src/api/kds.ts` exposes `listKdsOrders:59`, `listKdsOrdersScoped:63`, `getKdsQueueScoped:71`, `updateKdsStatusScoped:79`, `getKdsOrderLinesScoped:125`, `updateKdsLineItemStatusScoped:129`, `updateKdsOrderItemsScoped`, `ackKdsOrderScoped:200`. There is **no hold/park command at all** and no per-bump history (the limitation is stamped at `ExpoScreen.tsx:25-32`); transitions go through `nextKdsStatus` (`kdsStatus.ts`). Reuse what is already extracted: `useKdsPreferences.ts` (212 ln), `useActionCooldown.ts` (64 ln), `kdsAutoAccept.ts` (`isAutoAckEligible`), and the `sameOrders` diff exported at `KdsScreen.tsx:42`.

---

## WARNING: eight KDS suites are self-declared shadows - green proves nothing for them

Eight suites re-declare the logic they claim to test, **import nothing from `KdsScreen.tsx`**, and total **86 cases** (`grep -cE '^ *(test|it)[(]' <file>` per suite, summed):

| suite | cases | its own declaration |
|---|---|---|
| `KdsBoardFiltered.test.ts` | 9 | `:4` - same logic as KdsScreen.tsx boardFiltered |
| `KdsDeselectOnFilter.test.ts` | 7 | `:4` - same deselect logic as KdsScreen.tsx useEffect |
| `KdsFilterDropdownNav.test.ts` | 13 | `:3` - the pure index arithmetic used by handleFilterPanelKeyDown |
| `KdsKeyboardNavigation.test.ts` | 16 | `:2` - the pure selection logic used by the keyboard handler |
| `KdsOrderFiltering.test.ts` | 9 | rebuilds the filter over `KdsOrder` fixtures locally |
| `KdsSettingsConversions.test.ts` | 16 | `:5` - same conversion as KdsScreen.tsx slaThresholds useMemo |
| `KdsThresholdClamp.test.ts` | 5 | `:4` - Rules (from KdsScreen.tsx) restated in the header |
| `KdsZoneExtraction.test.ts` | 11 | rebuilds zone extraction over local fixtures |

- Re-derive the list: `ls ui/src/__tests__/Kds*.test.ts | wc -l` and read each header. These eight are **self-declared** - the copy is announced in the file's own comment.
- **Consequence: `npm run test -- KdsScreen` going green after an extraction PROVES NOTHING for those 86 cases.** They would keep passing if `KdsScreen.tsx` were deleted, because they never import it.
- **The precedent is already in this repo, in writing.** `ui/src/__tests__/KdsStatusAdvance.test.ts:4-8`: *this suite used to declare its own STATUS_ORDER array and its own nextStatus() (same logic as advanceStatus in KdsScreen), so it tested a copy: **deleting the production progression left all nine tests green**, and the copy had already drifted in spirit from `KdsTicketCard.tsx`, which expressed the same rule a third way. Both now import from kdsStatus.ts, so these assertions are about the shipped code.* Same class, surfaced by `scripts/verify-test-shadow-copies.py`: `KdsPreferencesReadLocalPrefs.test.ts:6` (ten tests against a local copy) and `KdsSlaEscalationPipeline.test.ts:6` (a byte-identical copy of DEFAULTS).
- **RULE, binding on every slice: conversion-to-import happens in the SAME commit as the extraction.** When a slice moves logic out of `KdsScreen.tsx`, the shadow suites that copied that logic are rewritten in that commit to import the shipped module. Otherwise the suite stays green, the coverage was never real, and the extraction is unverified rather than safe.

## Two more mechanical requirements, same-commit as well

- Any new `.kds-*` markup must be registered in `ui/src/__tests__/screenExtraction.test.ts` `additionalTsx` (`:244-251`; the list today is `kds/KdsLayoutMasonry.tsx`, `kds/components/KdsTicketCard.tsx`, `kds/components/ModifierBadge.tsx`, `kds/KdsCompletedView.tsx`, `kds/KdsHamburgerPanel.tsx`, `kds/KdsScreenFooter.tsx`) **in the same commit as the extraction**, or the reachability assertion reports the moved classes as unreachable CSS and the suite goes red.
- `ui/src/__tests__/storageKeyPins.test.ts` owner strings move **atomically** with any storage-key relocation: `:49` `'kds-card-colors-v1'` -> `features/kds/KdsCardColorsContext.tsx`, `:56` `'oz-kds-expo-station-'` -> `features/kds/kdsStationPrefs.ts`, `:57` `'oz-kds-prefs-'` -> `features/kds/hooks/useKdsPreferences.ts`. Move a key without moving its pin and this suite is the thing that fails - in the same commit, which is the good kind of failure.

---

## Task Checklist - every box from the three sources, with its disposition

Dispositions: **OPEN** (real work), **ALREADY SHIPPED**, **DECISION NOT WORK**, **RENAMED**, **RESTATED**. Source is cited as file:line so nothing is taken on trust. Nothing that the sources left unticked is ticked here.

### Slice 0 - verification baseline (was agents-1 Phase 1.0)
- [ ] **OPEN** Run `npm run test -- KdsScreen` in `ui/`. *(agents-1:50)* The harness exists and is large: `KdsScreen.test.tsx` holds **56** cases (`grep -cE '^ *(test|it)[(]' ui/src/__tests__/KdsScreen.test.tsx`), plus `KdsScreenSameOrders.test.ts` and two `KdsScreenFooter*` suites. Box stays unticked because nobody in this lane has run it - valid command, unknown current result. Read it together with the WARNING above: 86 of the KDS cases are shadows and pass either way.

### Slice 2 - keyboard (was agents-1 Phase 1.1)
- [ ] **RENAMED** Extract keyboard shortcuts - *agents-1:58 named `hooks/useBumpBar.ts`; the target is `hooks/useKdsKeyboardShortcuts.ts`.* 'bump bar' matches **0 code and 0 i18n strings** (`grep -ri 'bump bar' ui/src | wc -l` = 0, and 0 under `ui/src/locales`). The real subject is the **KEY-07 document keydown listener at `KdsScreen.tsx:412-469`**, which binds digits `1`-`9` (`:434`), `ArrowDown` (`:440`), `ArrowUp` (`:447`), `' '` Space to advance (`:454`) and `Escape` (`:462`). It does **not** bind `Enter` (0 hits) and has **no Recall** key - recall belongs to `ExpoScreen.tsx` (`recallCandidates:120`, button `:432-521`; `grep -c ecall ui/src/features/kds/KdsScreen.tsx` = 0).
- [x] **ALREADY SHIPPED** Extract the new-ticket audio alert. *(agents-1:66, ticked there and left ticked)* Not at the fenced path and not a synthesizer: `utils/kdsAudioAlerts.ts` cannot exist because **there is no `utils/` directory** under `features/kds/` - only `components/` and `hooks/`. What shipped is `hooks/useNewTicketSound.ts` (81 ln): unseen order IDs, debounced chime (`DEBOUNCE_MS = 5000` at `:5`, signature `:29`), gated by `settings.soundEnabled`, wired at `KdsScreen.tsx:159`.
- [ ] **OPEN** Verify: `npm run typecheck`. *(agents-1:71)*
- [ ] **OPEN** Commit Milestone - `refactor(kds-state): extract keyboard navigation and audio alerts`. *(agents-1:72; that doc already narrowed the subject to drop the invented bump-bar noun, prefix unchanged.)* The audio half is shipped, so this box now describes the keyboard half only.

### Slice 4 - ticket lifecycle (was agents-1 Phase 1.2)
- [ ] **OPEN, sequenced LAST** Extract ticket fetching, the `kds:orders-changed` listener (`:257`) and status updates into `hooks/useKdsTickets.ts`. *(agents-1:79)*
- [ ] **OPEN** Wire hook into `KdsScreen.tsx`. *(agents-1:91)*
- [ ] **OPEN** Verify: `npm run typecheck`. *(agents-1:92)*
- [ ] **OPEN** Commit Milestone - `refactor(kds-state): decouple ticket lifecycle state machine into useKdsTickets`. *(agents-1:93)*

### Card presentation (was agents-2 Phases 2.0 and 2.1)
- [x] **DONE BY AUDIT** Inspect ticket CSS and ARIA roles in `KdsScreen.tsx`. *(agents-2:62, ticked there and left ticked)* Card markup is no longer in the screen at all; the screen carries `role=` region + `aria-label=kds-screen-aria` (`:704`), an `aria-live=polite` arrival announcement (`:708-714`), and two tablists - Open/Completed tabs (`:856`) and zone chips (`:939`, roving tabindex handled at `:492`). Styles live in `KdsScreen.css` (2,443 ln: the `.kds-header` / `.kds-tabs` / `.kds-zone-chip` families).
- [x] **ALREADY SHIPPED** Extract `<KdsTicketCard />` into `components/KdsTicketCard.tsx`. *(agents-2:86, ticked there and left ticked)* 574 ln, memoized, `ae6d19ae7` (2026-07-09), and it predates the roadmap. Its own suites: **14** cases in `KdsTicketCard.test.tsx` plus **47** across the five siblings (`KdsTicketCardCourseLabel`, `KdsTicketCardFmtDuration`, `KdsTicketCardGroupByCourse`, `KdsTicketCardItemDone`, `KdsTicketCardNextActionKey`). Nothing left in this box.
- [ ] **DECISION NOT WORK** Extract `<KdsTicketLineItem />` into `components/KdsTicketLineItem.tsx`. *(agents-2:71)* The sizing says it cold: this is **pure relocation of shipped code**, its **4 importers would be TEST files** (every consumer reachable today - `KdsTicketCard.test.tsx`, `KdsTicketCardGroupByCourse.test.ts`, `KdsTicketCardItemDone.test.ts`, `screenExtraction.test.ts` - is under `ui/src/__tests__/`; production reaches line items through the parent card), and the box's own premise is wrong twice. (a) There is **no strike-through** in the feature: 0 `line-through` hits under `ui/src/features/kds/` - a completed line is signalled by status, not decoration. (b) The course tag and the modifier list already exist, inside `KdsTicketCard.tsx`: `groupByCourse` at `:112`, groups rendered at `:378`, `ModifierBadge` at `:439`, landed in `67b2849dd` (2026-09-13). Re-open only with a behavioural reason, never a line-count reason.
- [ ] **DECISION NOT WORK** Extract `<KdsTimerBadge />` into `components/KdsTimerBadge.tsx`. *(agents-2:78)* It would be a **third copy of an SLA rule that already ships and already has 20+56 cases**: the rule is `hooks/useTicketSla.ts` (196 ln, `d82a1aa1a`) consumed at `KdsTicketCard.tsx:175`, and the coverage is the 56 cases in the three `KdsSla*.test.ts` suites (`KdsSlaComputeLevel` 18, `KdsSlaEscalationPipeline`, `KdsSlaFormatElapsed`) plus the 28 in the two clamp suites (`KdsThresholdClamp` 5, `KdsSlaThresholdClamp` 11) and `KdsZoomColumnClamp`. `KdsTimerBadge` currently matches **0 files** anywhere in `ui/src`. What is missing is only a *view* wrapper over shipped logic, so the risk is duplicating the rule, not writing it - and the KdsStatusAdvance precedent above is exactly what a third copy does.
- [ ] **OPEN** Verify: `npm run typecheck`. *(agents-2:91)*
- [ ] **OPEN, scope reduced by the two decisions above** Commit Milestone - `refactor(kds-ui): extract KdsTicketCard, line items, and timer badges`. *(agents-2:92)* agents-2:96 had already narrowed it to the line item and the badge view; this file marks both DECISION NOT WORK, so **this commit has no content until a box is re-opened with a behavioural reason.** Leave it unticked.

### Slice 3 - header toolbar and screen reduction (was agents-2 Phase 2.2)
- [ ] **OPEN** Extract `<KdsHeaderToolbar />`. *(agents-2:100, which listed station filter, sound toggle, device status, shift button)* Contents corrected by agents-2:101-108 and re-confirmed: the header at `:715-935` holds the Open/Completed tabs (`:856`), the view filter, `KdsDeviceStatusIndicator`, and shift start/stop (`:887-900`). There is **no recall modal trigger** on this screen and **no volume control** - only an on/off sound toggle (`settings.soundEnabled`, wired `:912` -> `KdsHamburgerPanel.tsx:471-474`), and it lives in the **hamburger panel, not the header**.
- [ ] **OPEN** Reduce `KdsScreen.tsx` to orchestrating the header toolbar, ticket grid, and confirm modal. *(agents-2:109)* Corrected there and still true: the screen has a **confirm** modal (`:137-141`, rendered `:1159-1169`), not a recall modal. The grid is already delegated to `KdsLayoutMasonry` (`:666`) and the completed view to `KdsCompletedView` (`:686`); only the header is not.
- [ ] **RESTATED** Verify `KdsScreen.tsx` line count drops from 1,193 to `< 350` lines. *(agents-2:113)* → **Unreachable as written; the accepted target is `<= 700`** with the arithmetic in the gate section. Unmet either way: still **1,193** at HEAD and already 1,193 at `1af143f23`, so this screen has not shrunk at all since the roadmap was written.
- [ ] **OPEN** Commit Milestone - `refactor(kds-ui): consolidate KdsHeaderToolbar and reduce KdsScreen to composition root`. *(agents-2:116)* This is the commit that closes slices 1 and 3.

### Sequencing inherited from the stub
- [ ] **OPEN (carried: it was the whole file)** `todo-kds.md` said only: *we do this after global-saas (now split into `todo-global-saas-1/2/3.md`) and tools are built and done*. The global-saas lane has since shipped its own waves and **nothing in this merged plan depends on it**, so the KDS lane is unblocked from slice 1. The box exists so the unblock is a recorded decision, not a silent overwrite of a sequencing constraint someone wrote down on purpose.

---

## Reconciliation (16 in, 16 out)

**The 16 open boxes in the two plan sources, by disposition:**

| disposition | rows | which |
|---|---|---|
| OPEN | **12** | agents-1 :50, :71, :72, :79, :91, :92, :93 (7) + agents-2 :91, :92, :100, :109, :116 (5) |
| RESTATED (still open, number changed) | **1** | agents-2 :113 (`< 350` -> `<= 700`) |
| RENAMED (still open, target changed) | **1** | agents-1 :58 (`useBumpBar` -> `useKdsKeyboardShortcuts`) |
| DECISION NOT WORK (left unticked, reason recorded) | **2** | agents-2 :71 (line item), agents-2 :78 (timer badge) |
| **total carried from the plan sources** | **16** | 12 + 1 + 1 + 2 |
| already ticked in the sources (left ticked, none added) | 3 | agents-1 :66 · agents-2 :62, :86 |

**Two boxes this merge ADDS, which no source had** (so the file's own open-box count is 18, not 16):

- The gate box in **The gate, stated honestly** (`<= 700` as an acceptance line with its arithmetic next to it) - agents-2:113 asked for a number, and this gives the lane something to be measured against that is not a fiction.
- The **sequencing** box carrying `todo-kds.md` - the stub had 0 boxes, so nothing was lost; this is a new decision record, and it is left unticked because it is the user's to close.

**Proof of the counts, run today against all four files:**

- Input count: `grep -cF '- [ ]' todo-refactor-kds-agents-1.md` = **8** · `grep -cF '- [ ]' todo-refactor-kds-agents-2.md` = **8** · `grep -cF '- [' todo-kds.md` = **0** → **16 open boxes in the sources**, and the 16 carried rows above name each one's source file and line. This file's own count is `grep -cF '- [ ]' todo-refactor-kds-agents-merged.md` = **18** = the 16 carried + the 2 added boxes named above.
- Ticked count: `grep -cF '- [x]' todo-refactor-kds-agents-1.md` = **1** (`:66`) · `todo-refactor-kds-agents-2.md` = **2** (`:62`, `:86`) · this file = **3**. Three ticked in, three ticked out, **none added by this merge** — the three inherited ticks are the two ALREADY SHIPPED extractions and the audit's own CSS/ARIA inspection.
- Nothing was merged *away*: each row keeps its original wording's substance and gains a disposition, the measurement behind it, and the file:line where it was born.

## Filed findings (unfixed - this file owns the area, so the finding lives here)

- **Filed, unfixed, 2026-09-14 (measured by a worker sizing the threshold-clamp conversion): the minutes clamp in the settings UI and the seconds clamp in the SLA hook are BOTH load-bearing and they DISAGREE.** The UI lets yellow reach 30 minutes and red reach 60 minutes (`KdsScreen.tsx:916` `Math.max(3, Math.min(v, red - 1, 30))`, `:921` `Math.max(4, Math.min(v, 60))`), while `clampSlaThresholds` (`hooks/useTicketSla.ts:59-60`) ceilings at `RED_URGENT - 60` = 840 s = 14 minutes yellow and 900 s = 15 minutes red. A cashier who drags red to 60 minutes actually gets 15 minutes of red onset, with no feedback that the value moved. No test in either family asserts the two agree, and no product decision is recorded about which clamp wins - so it is filed, not fixed: the resolution is a ruling (raise the hook ceiling, narrow the slider range, or surface the effective value), and each option changes what a kitchen sees on a late ticket.
  - Re-read this pass before filing it here, and it holds: `sed -n '913,922p' ui/src/features/kds/KdsScreen.tsx` gives the two minute-clamps; `sed -n '44,62p' ui/src/features/kds/hooks/useTicketSla.ts` gives `RED_URGENT = 900` and the seconds ceilings. **Why the disagreement survives a green run:** the suites that own these rules assert their own clamp only - `KdsThresholdClamp.test.ts` (5 cases, UI minutes) and `KdsSlaThresholdClamp.test.ts` (11 cases, hook seconds) - and nothing imports the pair to compare them. The smallest honest test is one that pins UI-minutes x 60 against the hook's output for the same setting, and it is NOT part of any extraction slice above: it is a ruling waiting for a decision, not a refactor.
  - Belongs to this file rather than either source because the sources disagreed about who owned it: the UI clamp sits in the render tree agents-2 fenced (`:715-935`) while the hook lives in `hooks/`, which agents-1 fenced as state. One owner now, one place for the finding.

## Notes for whoever picks this up

1. **Start at slice 1 and stop at the number, not at the wish.** `<= 700` is the target; `< 350` is retired as an acceptance number, not as an ambition - and neither was ever enforced by a build.
2. **The conversion-to-import rule is not ceremony.** `KdsStatusAdvance.test.ts:4-8` is this repo's own written proof of what a shadow suite costs: nine green tests while the production progression was deleted.
3. **Anchor drift is live in this file.** `:137`, `:226`, `:257`, `:293-322`, `:412-469`, `:492-533`, `:570`, `:598`, `:666`, `:686`, `:697`, `:715-935`, `:937-966`, `:968-1098`, `:1018`, `:1058`, `:1159-1169` are all into the **1,193**-line file. Re-derive every one with `grep -n` against the copy you are about to cut, in the same minute you cut it.
4. **Neighbour, not in this fence:** `ExpoScreen.tsx` (recall, station selector, per-user station key) is a different screen in the same directory and has its own shadow risk.

> last audited 2026-09-14 by DSH (docs-auditor) · merged from agents-1 + agents-2 + todo-kds.md · the three sources stay in place, undeleted and NOT renamed `done-`: the work they plan is unfinished.
