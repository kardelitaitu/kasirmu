# Orchestrator Agent 1: KDS Ticket State Machine & Input Peripherals

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
- [ ] Run `npm run test -- KdsScreen` in `ui/`.
  > The suite exists and is large: `ui/src/__tests__/KdsScreen.test.tsx` holds **56** `test`/`it`
  > cases (`grep -cE '^\s*(test|it)\(' ui/src/__tests__/KdsScreen.test.tsx`), plus
  > `KdsScreenSameOrders.test.ts` and two `KdsScreenFooter*` suites. **Not executed by this docs
  > audit** (that is a vitest run, out of scope here), so the box stays unticked: valid command,
  > unknown current result.

### Phase 1.1: Extract Keyboard Navigation & Audio Alert
- [ ] Extract keyboard shortcuts into `hooks/useBumpBar.ts`.
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
- [ ] Verify: `npm run typecheck`.
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
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(kds-state): decouple ticket lifecycle state machine into useKdsTickets"
  ```
