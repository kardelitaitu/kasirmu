# Orchestrator Agent 2: Order Ticket Cards & Station Timers

> **SUPERSEDED 2026-09-14 by `todo-refactor-kds-agents-merged.md`, which carries every open box from this file plus the re-measured gate (`<= 700`, not `< 350`) and the three fence collisions this file could not see. Kept in place, not deleted and NOT renamed `done-`: the work it plans is unfinished, and a `done-` prefix on a superseded plan would be a false claim, not a tidy root.**

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence listed `components/KdsTicketCard.tsx` as NEW when it has existed since `ae6d19ae7` (2026-07-09, five weeks before this roadmap was written) and is today the largest file in the feature at 574 lines, so Phase 2.1's headline extraction was already long done — while the timer/threshold work this doc assigns to a future `KdsTimerBadge.tsx` already lives in `hooks/useTicketSla.ts`, a path the fence never mentions; found by globbing `ui/src/features/kds/**` and dating each file with `git log --diff-filter=A`. -->

**Document:** `todo-refactor-kds-agents-2.md`  
**Role:** Orchestrator Agent 2 (Kitchen Display Presentation Architect)  
**Goal:** Extract order card rendering, course grouping indicators, target preparation time color codes, and line-item modifier lists from `KdsScreen.tsx` into modular presentation components.

> ⚠️ **Baseline correction (audit 2026-09-14, measured):** `wc -l ui/src/features/kds/KdsScreen.tsx`
> = **1,193** (a 1,194 figure seen elsewhere is split-on-newline method, not a different file).
> The 1,127 this doc quoted matched no revision — the file was already 1,193 at `1af143f23`, the
> commit that added this roadmap. **The presentation split this plan assumes has not happened:**
> `KdsScreen.tsx` is still 1,193 lines and still renders its own header (`:715-935`), tabs (`:856`)
> and zone chips (`:939`) inline — the ticket grid is the one part already delegated, to
> `KdsLayoutMasonry` (`:666`) — so `KdsScreen.tsx` remains the monolith.

**Target File:** `ui/src/features/kds/KdsScreen.tsx` (Render Tree)  
**Sibling Documents:**
- [`todo-refactor-kds-agents-1.md`](./todo-refactor-kds-agents-1.md) (Agent 1 — KDS Ticket State Machine & Input Peripherals) — still live at the root.
- `done-todo-refactor-kds-agents-3.md` (Agent 3 — Restaurant Menu, Course Grouping & Modifier Popups) — **finished and archived**.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(kds-ui): ...`
   > This prefix IS in use — 2 commits (`cb3254878`, `32d9f68b8`, both 2026-09-13), though both
   > moved the settings *model*, not ticket-card presentation.
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/kds/components/KdsTicketCard.tsx` — **NOT new: it already exists at 574
     lines**, added by `ae6d19ae7` (2026-07-09) and grown since (`67b2849dd`, 2026-09-13, put course
     grouping and modifier badges inside it). It is `React.memo`'d and is the largest file in the
     feature. Fence it as **edit**, not **NEW**; it is also shared with Agent 1, whose cards
     consume `useTicketSla` at `KdsTicketCard.tsx:175`.
   - `ui/src/features/kds/components/KdsTicketLineItem.tsx` (NEW — still does not exist; line items
     are rendered inline inside `KdsTicketCard.tsx`, groups mapped at `:378`, badges at `:439`)
   - `ui/src/features/kds/components/KdsTimerBadge.tsx` (NEW — still does not exist; see the Phase
     2.1 note: the green/yellow/red behaviour it was meant to formalize already exists as the
     hook `hooks/useTicketSla.ts`, so a badge component would be a *view* over shipped logic, not
     the logic itself.)
   - `ui/src/features/kds/components/KdsHeaderToolbar.tsx` (NEW — still does not exist; the header
     is inline at `KdsScreen.tsx:715-935`, with the zone-chip filter row below it at `:937-966`)
   - Lower JSX tree in `ui/src/features/kds/KdsScreen.tsx` (**corrected: Lines 697+, not 400+** —
     the component's `return (` is at `:697`; `:400-696` is hook and callback code owned by Agent 1,
     so the old boundary fenced Agent 2 into Agent 1's territory.)
   - **Additions this audit makes, because the fence omits files that already carry Agent 2's
     subject matter:** `KdsLayoutMasonry.tsx` (116 ln, the ticket grid), `KdsCompletedView.tsx`
     (239 ln), `KdsScreenFooter.tsx` (100 ln), `components/ModifierBadge.tsx` (101 ln),
     `kdsCardColors.ts` (72 ln) and `KdsCardColorsContext.tsx` (103 ln) — the card-colour surfaces.
     Any Agent 2 work overlaps these and must say so.
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit state hooks or keyboard listeners (owned by Agent 1) — today that means
     `KdsScreen.tsx:95-696` and `hooks/useKdsPreferences.ts` / `hooks/useActionCooldown.ts`.
   - DO NOT edit `ui/src/features/restaurant/RestaurantMenu.tsx` (owned by Agent 3 — **corrected**:
     the old line named a bare `RestaurantMenu.tsx`, which does not exist under `features/kds/`).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [x] Inspect ticket rendering CSS and ARIA roles in `KdsScreen.tsx`.
  > **Done by this audit.** Card markup is no longer in `KdsScreen.tsx` at all — it lives in
  > `components/KdsTicketCard.tsx`. `KdsScreen.tsx` carries `role="region"` +
  > `aria-label=kds-screen-aria` (`:704`), an `aria-live="polite"` arrival announcement (`:708-714`);
  > `role="tablist"` twice — Open/Completed tabs (`:856`) and zone chips (`:939`, roving tabindex
  > handled at `:492`). Styles are in `KdsScreen.css` (2,443 ln, `.kds-header` / `.kds-tabs` /
  > `.kds-zone-chip` families).

### Phase 2.1: Extract Ticket Cards & Line Items
- [ ] Extract `<KdsTicketLineItem />` into `components/KdsTicketLineItem.tsx` (handles strike-through, modifier notes, course tag).
  > Still open, and **corrected on two specifics**: (a) there is **no strike-through** in the
  > feature — 0 `line-through` hits under `ui/src/features/kds/`; a completed line is signalled by
  > status, not decoration. (b) the course tag + modifier list already exist, but inside
  > `KdsTicketCard.tsx`: `groupByCourse` at `:112`, groups rendered at `:378`, `ModifierBadge` at
  > `:439` (landed in `67b2849dd`, 2026-09-13). So this bullet is a *relocation* of shipped code,
  > not a new capability.
- [ ] Extract `<KdsTimerBadge />` into `components/KdsTimerBadge.tsx` (green → yellow → red preparation thresholds).
  > **Wrong-by-omission, now corrected:** the thresholds are **already implemented** in
  > `hooks/useTicketSla.ts` (196 ln, added by `d82a1aa1a`) — `SlaLevel = 'green' | 'yellow' |
  > 'red'` (`:6`), defaults `yellowAtSec: 300` / `redAtSec: 600` (`:17-20`), `urgent` at ≥900 s
  > (`:37`), and per-user overrides via `kdsCardColors.ts` + `KdsCardColorsContext.tsx`. It is
  > consumed at `KdsTicketCard.tsx:175` (`const { level, urgent, display } = useTicketSla(…)`) and
  > the thresholds flow from `kdsSettingsModel.ts:19-32`. What is missing is only the badge
  > *component* wrapper — so the risk here is duplicating logic, not writing it.
- [x] Extract `<KdsTicketCard />` into `components/KdsTicketCard.tsx`.
  > **Already complete and predating this roadmap** — 574 ln, memoized, `git log
  > --diff-filter=A` → `ae6d19ae7`, 2026-07-09. It has its own suites (`KdsTicketCard.test.tsx`
  > with 14 cases, plus 5 sibling test files for course label, duration format, grouping and
  > next-action). Nothing left in this bullet to do.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-ui): extract KdsTicketCard, line items, and timer badges"
  ```
  > Narrowed by this audit: `KdsTicketCard` is already extracted, so the remaining work is the
  > line item and the badge view.

### Phase 2.2: Extract KDS Header Toolbar & Screen Reduction
- [ ] Extract `<KdsHeaderToolbar />` (station filter, sound toggle, device status, shift button).
  > **Corrected contents — the old list was wrong in two ways.** There is **no recall modal
  > trigger** on this screen: recall (and `StationSelectorModal`) belongs to `ExpoScreen.tsx`
  > (`recallCandidates` at `:120`, recall button at `:432-521`; `grep -c 'ecall'
  > KdsScreen.tsx` = **0**). And there is no volume control — only an on/off **sound toggle**
  > (`settings.soundEnabled`, wired `KdsScreen.tsx:912` → `KdsHamburgerPanel.tsx:471-474`), and it
  > lives in the hamburger panel, not the header. What the header really holds, in
  > `KdsScreen.tsx:715-935`: Open/Completed tabs (`:856`), view
  > filter, `KdsDeviceStatusIndicator`, shift start/stop (`:887-900`).
- [ ] Reduce `KdsScreen.tsx` to orchestrating the header toolbar, ticket grid, and confirm modal.
  > Corrected: this screen has a **confirm** modal (`:137-141`, rendered `:1159-1169`), not a recall
  > modal. Not started — the grid is already delegated to `KdsLayoutMasonry` (`:666`) and the
  > completed view to `KdsCompletedView` (`:686`), but the header is not.
- [ ] Verify `KdsScreen.tsx` line count drops from 1,193 to < 350 lines.
  > **Unmet:** still 1,193 (measured at HEAD and already 1,193 at `1af143f23`). The screen has
  > not shrunk at all since this roadmap was written.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-ui): consolidate KdsHeaderToolbar and reduce KdsScreen to composition root"
  ```
