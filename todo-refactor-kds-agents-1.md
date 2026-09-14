# Orchestrator Agent 1: KDS Ticket State Machine & Input Peripherals

> **SUPERSEDED 2026-09-14 by `todo-refactor-kds-agents-merged.md`, which carries every open box from this file plus the re-measured gate (`<= 700`, not `< 350`) and the three fence collisions this file could not see. Kept in place, not deleted and NOT renamed `done-`: the work it plans is unfinished, and a `done-` prefix on a superseded plan would be a false claim, not a tidy root.**

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 13 · all three fenced extraction targets were prescribed at paths that do not exist (there is no `utils/` dir under `features/kds/` at all, and the audio work they planned already landed in `hooks/useNewTicketSound.ts`), and the `bumpOrder`/`recallOrder`/`holdTicket` API trio is invented — 0 hits across `ui/src`, while `ui/src/api/kds.ts` really exposes `updateKdsStatusScoped` and friends; found by globbing `ui/src/features/kds/**`, grepping each named symbol, and re-measuring with `wc -l`. -->

**Document:** `todo-refactor-kds-agents-1.md`  
**Role:** Orchestrator Agent 1 (Kitchen Operations State Architect)  
**Goal:** Decompose ticket-refresh event handling, keyboard shortcut events, order status transitions, and new-ticket audio alerts from `KdsScreen.tsx` (1,193 lines) into headless custom hooks.

> ⚠️ **Baseline correction (audit 2026-09-14, measured):** `wc -l ui/src/features/kds/KdsScreen.tsx`
> = **1,193** (the read tool's `totalLines` agrees; a 1,194 figure seen elsewhere is
> split-on-newline method, not a different file). The document's 1,127 matched **no** revision of
> the file — it was already 1,193 at `1af143f23`, the commit that added this roadmap.
> Two mechanism words in the old Goal sentence were also wrong:
> **"websocket subscriptions"** — 0 `WebSocket` hits anywhere under `ui/src/features/kds/`. The
> board refreshes on a **Tauri event**: `listen<null>('kds:orders-changed', ...)` at
> `KdsScreen.tsx:257`, plus `useKdsOffline` (`ui/src/hooks/useKdsOffline.ts:251`, 608 ln). There is
> no client poll loop either — no `setInterval` in `KdsScreen.tsx` (the lone `setTimeout` at `:212`
> is the 3-second arrival highlight).
> **"bump bar"** — 0 hits in all of `ui/src`. What exists is a plain keyboard-shortcut effect,
> `KdsScreen.tsx:412-468`.

**Target File:** `ui/src/features/kds/KdsScreen.tsx`  
**Feature directory today:** `ui/src/features/kds/` = 33 files (15 `.tsx`, 10,865 lines).

**Sibling Documents:**
- [`todo-refactor-kds-agents-2.md`](./todo-refactor-kds-agents-2.md) (Agent 2 — Order Ticket Cards & Station Timers) — still live at the root.
- `done-todo-refactor-kds-agents-3.md` (Agent 3 — Restaurant Menu, Course Grouping & Modifier Popups) — **finished and archived**; its target, `ui/src/features/restaurant/RestaurantMenu.tsx` (438 ln), is already decomposed.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(kds-state): ...`
   > Measured 2026-09-14: `git log --format=%s | grep -c 'refactor(kds-state)'` = **0** — this lane
   > has never landed a commit under its declared prefix (`refactor(kds-ui)`, Agent 2's prefix, has 2).
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/features/kds/hooks/useKdsTickets.ts` (NEW — **still does not exist**, so this slice is unstarted)
   - `ui/src/features/kds/hooks/useBumpBar.ts` (NEW — **still does not exist**; the shortcuts remain inline at `KdsScreen.tsx:412-468`)
   - `ui/src/features/kds/utils/kdsAudioAlerts.ts` (**path invalid**: there is no `utils/` directory under `features/kds/` — only `components/` and `hooks/`. The audio work this bullet planned **already exists** as `ui/src/features/kds/hooks/useNewTicketSound.ts` (81 ln, added by `4a963e359`, 2026-07-20), consumed at `KdsScreen.tsx:159` and backed by `ui/src/frontend/shared/useSound.ts` (130 ln, used at `KdsScreen.tsx:160`/`:167`). Re-fence to `hooks/` if further audio work is wanted.)
   - Hook declaration block in `ui/src/features/kds/KdsScreen.tsx` (**corrected: Lines 95–696, not 1–350.** The component opens with `export default function KdsScreen()` at `:89` and its `return (` is at `:697`, so everything through `:696` is hook/state/effect code; a fence stopping at 350 leaves more than half of it unowned.)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `ui/src/features/restaurant/RestaurantMenu.tsx` (owned by Agent 3 — **corrected**: the old line named it as if it lived under `features/kds/`, where it does not exist).
   - DO NOT edit card presentation JSX (owned by Agent 2) — today that means `ui/src/features/kds/components/KdsTicketCard.tsx` (574 ln).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [x] Run `npm run test -- KdsScreen` in `ui/`. <!-- TICKED 2026-09-15 by the acceptance lane: ran exactly this command from ui/ -> "Test Files  4 passed (4)", "Tests  88 passed (88)", exit code 0. Measured at bd1a8a4e32; the kds + __tests__ surface is byte-identical to c8ea8bbe4. Full rollup in "Acceptance runs (2026-09-15, HEAD c8ea8bbe4)" below. The "not executed / unknown current result" note under this box is superseded by that run and is kept verbatim as a record. -->
  > The suite exists and is large: `ui/src/__tests__/KdsScreen.test.tsx` holds **56** `test`/`it`
  > cases (`grep -cE '^\s*(test|it)\(' ui/src/__tests__/KdsScreen.test.tsx`), plus
  > `KdsScreenSameOrders.test.ts` and two `KdsScreenFooter*` suites. **Not executed by this docs
  > audit** (that is a vitest run, out of scope here), so the box stays unticked: valid command,
  > unknown current result.

### Phase 1.1: Extract Keyboard Navigation & Audio Alert
- [x] Extract keyboard shortcuts into `hooks/useBumpBar.ts`. <!-- TICKED 2026-09-15 by the relocation lane (c965baddb): the target now EXISTS at `ui/src/features/kds/hooks/useKdsKeyboardShortcuts.ts`, 129 ln. It previously sat at the FEATURE ROOT as `useKdsShortcuts.ts` -- a name-and-location disagreement, not unstarted work. The shape this box guessed was wrong: 'bump bar' matches 0 code and 0 i18n strings, and that concern is `hooks/useNewTicketSound.ts` (81 ln), already closed at :68 below. Box wording unchanged; the exported symbol is still `useKdsShortcuts`, so the identifier survives by design while the old PATH has 0 references tree-wide. -->
  > **Corrected key list — the old one named keys the screen does not handle.**
  > `KdsScreen.tsx:412-468` binds digits `1`–`9` (`:434`), `ArrowDown` (`:440`), `ArrowUp` (`:447`),
  > `' '` Space to advance (`:454`) and `Escape` (`:462`). It does **not** bind `Enter` (0 hits in
  > the file) and has **no "Recall"** key — recall is a different screen (`ExpoScreen.tsx`,
  > `recallCandidates` at `:120`). The "bump bar" framing matches no code, string or i18n key.
  > Adjacent handlers a new hook would have to decide about: `handleZoneTablistKeyDown` (`:492`,
  > ARIA roving tabindex on the zone chips) and `handleFilterPanelKeyDown` (`:570`).
- [x] Extract sound synthesizers / buzzer audio triggers to a dedicated module.
  > **Done — but not at the fenced path, and it is a chime, not a synthesizer.**
  > `hooks/useNewTicketSound.ts` detects unseen order IDs and plays a debounced chime (5 s window
  > with a trailing catch-up), gated by `settings.soundEnabled`. Evidence: `useNewTicketSound.ts:5`
  > (`DEBOUNCE_MS = 5000`), `:29` (signature), wired at `KdsScreen.tsx:159`.
- [x] Verify: `npm run typecheck`. <!-- TICKED 2026-09-15 by the acceptance lane: ONE `npm run typecheck` (tsc --noEmit) from ui/ at bd1a8a4e32 (= c8ea8bbe4 for this surface) -> no diagnostics, exit code 0. Per the lane owner's ruling this single run also satisfies agents-1:94 and agents-2:93; see "Acceptance runs (2026-09-15, HEAD c8ea8bbe4)". -->
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-state): extract keyboard navigation and audio alerts"
  ```
  > Subject adjusted to drop the invented "bump bar" noun; the prefix is unchanged.

### Phase 1.2: Extract KDS Ticket Lifecycle State Machine
- [ ] Extract ticket fetching, the `kds:orders-changed` listener and status updates into `hooks/useKdsTickets.ts`.
  > **Corrected API names — the old `bumpOrder` / `recallOrder` / `holdTicket` trio does not exist**
  > (0 hits across `ui/src`). The real wrappers, in `ui/src/api/kds.ts`:
  > `listKdsOrders:59` · `listKdsOrdersScoped:63` · `getKdsQueueScoped:71` ·
  > `updateKdsStatusScoped:79` · `getKdsOrderLinesScoped:125` ·
  > `updateKdsLineItemStatusScoped:129` · `updateKdsOrderItemsScoped` · `ackKdsOrderScoped:200`.
  > There is **no hold/park command at all**, and no per-bump history command (stamped as a
  > limitation in `ExpoScreen.tsx:25-32`). In `KdsScreen.tsx` the transitions go through
  > `nextKdsStatus` (`kdsStatus.ts`) and `updateKdsStatusScoped` at `:226`, `:298`, `:1018`, `:1058`.
  > Sibling behaviour already extracted and reusable: `hooks/useKdsPreferences.ts` (212 ln),
  > `hooks/useActionCooldown.ts` (64 ln), `kdsAutoAccept.ts` (`isAutoAckEligible`), and the
  > `sameOrders` diff helper exported at `KdsScreen.tsx:42`.
- [ ] Wire hook into `KdsScreen.tsx`.
- [x] Verify: `npm run typecheck`. <!-- TICKED 2026-09-15 by the acceptance lane: the same single `npm run typecheck` run at bd1a8a4e32 -> exit code 0, no diagnostics; one run, three identically-worded boxes (this one, agents-1:73, agents-2:93) per the lane owner's ruling. The box's own text names only that command and asks for nothing further. -->
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-state): decouple ticket lifecycle state machine into useKdsTickets"
  ```

---

## Acceptance runs (2026-09-15, HEAD c8ea8bbe4)

> **Fence was clean, so these numbers are attributable.** `git status --porcelain -- ui/src/features/kds
> ui/src/__tests__` printed **nothing** before the runs and again after them — no kds file was dirty, so
> nothing below is measured off a half-written file.
> **Revision actually measured at:** `bd1a8a4e32` (branch `0.0.39`, tip at run time). The `c8ea8bbe4` named
> in the heading is its parent, the one commit between them (`bd1a8a4e3`) is docs-only,
> `git diff --stat c8ea8bbe4 HEAD -- ui/src/features/kds ui/src/__tests__` is **empty**, and
> `ui/src/features/kds/KdsScreen.tsx` is the same blob at both
> (`a8d669e1fae4e51c8f33b4301c29005399b590c8`). The heading therefore cites the SHA the lane was told
> to cite without misdating the measurement.

### Run 1 — `npm run test -- KdsScreen`  (from `ui/`) — exit code 0

```text
 Test Files  4 passed (4)
      Tests  88 passed (88)
   Duration  4.65s (transform 1.02s, setup 827ms, import 1.12s, tests 3.71s, environment 1.95s)
```

The rollup is 4 files, exactly the suite surface `:53-57` predicts, and the case counts add up to it:
`KdsScreen.test.tsx` 1,361 ln / 57 cases (the 1,361 cited in the plans is **correct**);
`KdsScreenSameOrders.test.ts` 188 ln / 24; `KdsScreenFooter.test.tsx` 46 ln / 2;
`KdsScreenFooterFormatClock.test.ts` 43 ln / 5. 57+24+2+5 = **88**, so no file in the `KdsScreen*` family
was skipped and none outside it was pulled in. **Satisfies `:52` (ticked).**

### Run 2 — `npm run typecheck`  (`tsc --noEmit`, from `ui/`) — exit code 0

No diagnostics emitted; command completed clean.

**Three boxes, one run.** This single `npm run typecheck` at this one revision satisfies the three
identically-worded boxes `agents-1:73`, `agents-1:94` and `agents-2:93`, because each box's OWN text is
exactly `Verify: npm run typecheck` and asks for nothing further (no extra assertion, no named file).
This is the lane owner's ruling, applied here: one measurement recorded three times, **not** three
pieces of work — which is why each of the three ticks cites this same block.

### Boxes this run did NOT tick (findings, not work)
`:60`, `:81` and `:93` are, per the census, **already done in substance** — and they are **not this
lane's to close**, because each names a path with no file behind it. Measured, not inferred:
- **`:60`** *Extract keyboard shortcuts into `hooks/useBumpBar.ts`* — the keyboard work shipped **under a
  different name and in a different directory**: `ui/src/features/kds/useKdsShortcuts.ts` (129 ln) sits
  at the feature **root**, is imported at `KdsScreen.tsx:11` and called at `:324`. `hooks/useBumpBar.ts`
  does not exist, and neither does the merged plan's spelling `hooks/useKdsKeyboardShortcuts.ts`
  (`ls ui/src/features/kds/hooks/` → `useActionCooldown.ts`, `useKdsPreferences.ts`,
  `useNewTicketSound.ts`, `useTicketSla.ts`). Ticking would certify a path that is not there; leaving
  it silent denies work that is. **This is an alias problem, and it is the plan owner's call.**
- **`:81`** *Extract ticket fetching, the `kds:orders-changed` listener and status updates into
  `hooks/useKdsTickets.ts`* — that target file has **0 files behind it**, and no `listen(…)`, `listen<…>`
  or `unlisten` call remains anywhere in `KdsScreen.tsx` (grep = 0 hits), so the subscription is already
  out of the screen. Whether that satisfies a box whose fenced target does not exist is the same
  owner-side question as `:60`.
- **`:93`** *Wire hook into `KdsScreen.tsx`* — one hook IS wired (`useKdsShortcuts` at `:11`/`:324`);
  `useKdsTickets` is not, because it was never written.

None of the three is ticked by this lane. The commands I was sent to run say nothing about whether
they were, and a green suite is not evidence about a path that does not exist.
- `:95` **Commit Milestone** — SUPERSEDED (merged plan carries the commit form; see its PREFIX RULING).

### Corrections (2026-09-15, measured) — the stale lines above stay verbatim as records
1. **`:9` prints a 1,193-line baseline as the working number; the file is 680 lines today — a −513
   drift.** `wc -l ui/src/features/kds/KdsScreen.tsx` = **680** at `bd1a8a4e32`. The same figure is
   repeated as "measured" at `:11-14` (audit 2026-09-14). It was true then and is not now: the file's
   own history reads 1,193 ln at `cb3254878` (09-13) → 1,192 (`4af8e1237`) → 1,119 → 1,000 → 979 → 898
   → 842 → 807 → 774 → 729 → 695 (`de165c118`, 09-14) → **680** (`02dd03278`, 09-15).
2. **`todo-refactor-kds-agents-merged.md:151` names a target that does not exist.** It says the keyboard
   slice goes into `hooks/useKdsKeyboardShortcuts.ts`. `ls
   ui/src/features/kds/hooks/useKdsKeyboardShortcuts.ts` → *No such file or directory*; `hooks/` holds
   exactly `useActionCooldown.ts`, `useKdsPreferences.ts`, `useNewTicketSound.ts`, `useTicketSla.ts`.
   The shipped file is **`ui/src/features/kds/useKdsShortcuts.ts`, 129 ln, at the feature root — not
   under `hooks/`**. The only occurrence of the string `useKdsKeyboardShortcuts` anywhere in `ui/src` is
   a prose comment at `components/KdsHeaderLeft.tsx:21`. `merged` is outside this fence and is being
   written by another lane right now, so it is reported here, not edited.

> Recorded 2026-09-15 by the test/acceptance lane (time-boxed to the four commands named in the brief).
> Nothing outside `todo-refactor-kds-agents-1.md` and `todo-refactor-kds-agents-2.md` was edited; no test
> or source file was touched.

