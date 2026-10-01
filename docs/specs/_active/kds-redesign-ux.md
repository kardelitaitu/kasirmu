<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE on content, 1 structural finding FLAGGED and not auto-repaired · Audited on branch 0.0.40. Every existing artifact this Proposed spec says it reuses was located, which is the part that can rot while a proposal sits in `_active/`: the `kds:orders-changed` push model is emitted by `apps/mobile-tauri/src/commands/kds.rs`; `KdsTicketCard`, `KdsSettingsPanel`, `useKdsPreferences`, `useKdsOffline` and `createCooldownWrapper` each resolve in the KDS test suites; and the four commands the sync model calls — `updateKdsStatusScoped`, `updateKdsLineItemStatusScoped` and the `setUserPreferencesScoped` preference path — are live. The two genuinely NEW things the spec proposes are correctly absent, and their absence is the right result rather than a finding: `kds_audit_log` (the §10.5 hash-chained table) and the `appendKdsAuditEvents` command (§10.6) do not exist anywhere in `crates/`, `apps/` or `ui/src`, and `done_at` on `kds_line_items` does not exist either — all three are what Decision §8.1 and §10 are asking to build. A spec that cited them as existing would be the defect. · ⚠️ STRUCTURAL FINDING, reported and deliberately NOT renumbered: the sections are numbered out of order. The document runs `## 8. Decisions` (line 440), then `## 10. Audit logging` (line 458), then `## 9. Visual design tokens` (line 586) — §10 is physically interleaved between §8 and §9. I am not fixing this, and the reason is specific rather than caution for its own sake: §10 cross-references decisions by their position inside §8 (`Decision §8.5`, `§8.7`, and the `§8.3` auto-clear in §10.7), so those internal references are correct as written. Renumbering the two blocks would mean renumbering the decisions too, or leaving a set of §8.x references pointing at a differently-numbered section — and in a 600-line design document the blast radius of that is larger than the defect. The existing structural checkers do not flag ordering (they test wrapper labels, heading orphans and stale version headers, none of which apply), so this one is a human finding. It should be resolved by the spec owner when the proposal is next edited, not by an audit pass. · NOT re-measured: the CSS token table in §9 and the ASCII layout diagrams, which are design intent rather than code claims; a `kbd`-class check would be the css-verification skill's domain, not this one. · No stamp or footer existed on this file before this pass. -->

# KDS — Kitchen Display System Redesign

> **Status:** Proposed · **Area:** kitchen display, ordering · **Version:** 1.0 (KDS v2)

**Architecture rule:** the KDS workspace is a dedicated full-screen display for kitchen production tracking. It is independently evolvable from other workspace types. All state is synced across multiple KDS terminals via the existing Tauri event system (`kds:orders-changed`) so a kitchen with multiple displays sees the same live board.

**Backend rule:** reuse the existing `kds_orders` / `kds_line_items` domains. Per-item checkoff state and category-level progress are new fields on `kds_line_items` (a `done_at` timestamp) — no new tables needed. Multi-KDS sync uses the existing `kds:orders-changed` push model; no new polling or event transport.

---

## 1. Design goal

Replace the current 3-layout KDS (Kanban / Focus / Metro) with a **single production-focused view** that:

- Removes the layout switcher and mode confusion
- Groups items by course/category so the kitchen reads tickets at a glance
- Supports per-item checkoff so the team tracks what's plated and what's still cooking
- Shows completed orders in a separate tab for recall and audit
- Syncs across all KDS displays in the same store in real time

### 1.1 Multi-station workflow (primary use case)

A kitchen runs **multiple KDS screens at the same time**, one per station. Each cook interacts with the categories they own; nobody touches another station's categories. The same live board is visible on every screen, synced in real time.

```
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  JUICE STATION screen       │   │  GRILL STATION screen       │
│                             │   │                             │
│  #12 · John Smith    14:32  │   │  #12 · John Smith    14:32  │
│  🥗 Appetizers    2/3 ✓     │   │  🥗 Appetizers    2/3 ✓     │
│  🥩 Mains        1/2 ✓      │   │  🥩 Mains        1/2 ✓      │
│  🍹 Drinks    ✓ 2/2 ← taps  │   │  🍹 Drinks        2/2 ✓     │
│  (juice guy taps Drinks)    │   │  (steak guy taps Mains)     │
│                             │   │                             │
│         [Pause]             │   │         [Pause]             │
└─────────────────────────────┘   └─────────────────────────────┘
         ▲                                    ▲
         │        ┌──────────────────┐        │
         └────────┤  shared state    ├────────┘
                  │  (kds:orders-    │
                  │   changed push)  │
                  └──────────────────┘
```

**Workflow:**
1. **Juice guy** taps the **Drinks** category header on their screen → all drink items check off → every screen shows `✓ 2/2`.
2. **Grill guy** taps the **Mains** category header on their screen → all mains check off → every screen updates.
3. When **all categories on the order are fully checked off**, the **Mark Completed** button becomes enabled. The **waiter** (or any staff member) taps it to move the order to the Completed tab.

This is why **category-level checkoff is the primary interaction** — a single large tap completes an entire station's workload on that order, and the rest of the kitchen sees it instantly.

---

## 2. Screen layout

The full KDS screen is a **3-section flex column**:

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOPMENU (flex: 0) — fixed height, always visible                    │
├──────────────────────────────────────────────────────────────────────┤
│  MAIN (flex: 1) — scrollable card grid / completed list              │
├──────────────────────────────────────────────────────────────────────┤
│  FOOTER (flex: 0) — thin status bar, transparent                     │
└──────────────────────────────────────────────────────────────────────┘
```

```
.kds-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.kds-topmenu { flex: 0 0 auto; }
.kds-main    { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
.kds-footer  { flex: 0 0 auto; }
```

### 2.1 Topmenu bar

```
┌──────────────────────────────────────────────────────────────────────┐
│  🍳 Kitchen Display  │  [Open · 12]  [Completed · 45]  │  [⚙]  ☰  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Title** — static "Kitchen Display" (localized as `kds-title`)
- **Open tab** — shows active order count, default selected
- **Completed tab** — shows completed order count
- **Settings gear** (`⚙`) — opens the existing KDS settings panel (sound, escalation thresholds, auto-acknowledge, density)
- **Hamburger menu** (`☰`) — opens the **card appearance configuration** panel (see §2.1a)
- **Online indicator** — green dot (connected) / red (offline), same as current `KdsDeviceStatusIndicator` but simplified

### 2.1a Hamburger menu — card colour configuration

The `☰` button opens a modal/panel (same pattern as the existing `KdsSettingsPanel` — portal + focus trap + close-on-escape) dedicated to **order card colour customization**.

**Controls:**

| Setting | Control | Default | Key |
|---------|---------|---------|-----|
| Dine-in header colour | Colour picker (swatch grid or hex input) | `--color-success-bg` (soft green) | `kds_color_dinein_header` |
| Takeaway header colour | Colour picker | `--color-bg-elevated` (grey) | `kds_color_takeaway_header` |
| Rush badge colour | Colour picker | `--color-danger` (red) | `kds_color_rush_badge` |
| Reset to defaults | Button | — | — |

- Each colour picker shows a **grid of 6–8 preset swatches** (soft green, amber, blue, slate, grey, warm grey, etc.) plus a **custom hex input** for precise values.
- The preview updates live as the user changes colours (the open order cards re-render with the new tint).
- **Reset to defaults** restores all four keys to their factory values.

**Persistence — survives restart:**

Colours are saved via the existing `setUserPreferencesScoped` server-side API, the same path `useKdsPreferences` uses for layout/zone settings. The backend stores them in the `user_preferences` table (key → value, scoped to the KDS terminal's store). On next load, `getUserPreferencesScoped` fetches them — they survive a full restart, a new browser tab, or switching to another terminal and back.

| Persistence layer | What it stores | Survives |
|---|---|---|
| `setUserPreferencesScoped` → database | Keys: `kds_color_dinein_header`, `kds_color_takeaway_header`, `kds_color_rush_badge` | Full restart, new terminal |
| `localStorage` cache (`oz-kds-prefs-<userId>`) | Same keys (instant restore on load) | Page reload, offline |

The same `useKdsPreferences` hook is extended to read/write these colour keys, so the colour values are available anywhere in the KDS component tree via `prefs.dineinHeaderColor`, `prefs.takeawayHeaderColor`, `prefs.rushBadgeColor`.

### 2.2 Main area — Open tab (card grid)

Cards flow in a responsive grid (auto-fill columns, min 320px each). Orders are sorted by **received_at** ascending (oldest first → fire priority).

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  Order card      │  │  Order card      │  │  Order card      │      │
│  │  (processing)    │  │  (paused)        │  │  (processing)    │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│  ┌─────────────────┐  ┌─────────────────┐                             │
│  │  Order card      │  │  Order card      │                             │
│  │  (processing)    │  │  (processing)    │                             │
│  └─────────────────┘  └─────────────────┘                             │
│                                                                      │
│  [empty state: "No open orders" when no orders]                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.3 Main area — Completed tab (list view)

Cards are in a single-column list, newest first (most recently completed at top). Each card shows summary: order number, table, customer, completion time, total items. A "Reopen" button returns the order to the Open tab at `paused` status.

Each completed card's time row shows the **completion timestamp and the elapsed prep duration** in one compact line:

```
#12 · John Smith     T5    10:33 · in 12 min 25s    [Reopen]
```

- `10:33` — the time the order was marked completed (`completed_at`, 24h `HH:MM`)
- `in 12 min 25s` — the elapsed duration from `received_at` → `completed_at`, formatted as `in M min S s` when ≥ 1 minute, `in S s` when under a minute
- The same elapsed-duration line appears on the open card once an item is checked off (shows `HH:MM · in M min S s` relative to the item's own `done_at` — see §3.2 item-row display)

### 2.4 Footer status bar

A **thin, transparent** bar at the bottom of the screen. It shows operational status info in a single line, items separated by ` | `.

```
┌──────────────────────────────────────────────────────────────────────┐
│  192.168.1.42 | 14 Aug 14:32 | Last synced: 2s ago | Connected     │
└──────────────────────────────────────────────────────────────────────┘
```

| Field | Content | Example |
|-------|---------|---------|
| Local IP | The KDS terminal's local network IP | `192.168.1.42` |
| Date + time | Current date + clock (24h) | `14 Aug 14:32` |
| Last synced | Seconds since last `kds:orders-changed` event | `Last synced: 2s ago` |
| Connection | "Connected" / "Offline" | `Connected` |

**Visual rules:**
- `opacity: 0.6` — semi-transparent so it doesn't compete with the order cards
- Text colour: `--color-fg-secondary` (muted)
- Font size: `var(--text-sm)` (small)
- `padding: 2px var(--space-4)` — minimal vertical padding, keeps it thin
- `pointer-events: none` — clicks pass through to the main area below (the footer is display-only, never interactive)
- The footer is always visible on every tab (Open / Completed) and never disappears

---

## 3. Order card anatomy

The card is a single `flex` column with **three sections**: `header`, `main`, `footer`. The `main` section scrolls when the category content overflows (the card itself has a fixed max-height and `overflow-y: auto`).

```
┌──────────────────────────────────┐
│           HEADER                 │  ← flex: 0 (fixed height)
├──────────────────────────────────┤
│           MAIN                   │  ← flex: 1 (scrollable)
│  ┌────────────────────────────┐  │
│  │  🥗 Appetizers    2/3 ✓   │  │  ← category group
│  │    ✓ 2× Calamari          │  │
│  │    ✓ 1× Bruschetta        │  │
│  │     1× Garlic Bread        │  │
│  │       *no garlic, extra*   │  │  ← item note (italic, low contrast)
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  🥩 Mains      1/2 ✓      │  │
│  │    ✓ 3× Steak A  14:41 9m │  │  ← checked row shows done time + elapsed
│  │     2× Spaghetti           │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  🍹 Drinks      0/2        │  │
│  │     4× Drink X              │  │
│  │     2× Drink Y              │  │
│  └────────────────────────────┘  │
│  Notes: "No onions on steak"     │  ← order-level notes (optional)
├──────────────────────────────────┤
│           FOOTER                 │  ← flex: 0 (fixed height)
│          [Pause]                 │  ← status action button
└──────────────────────────────────┘
```

### 3.1 Header section

```
┌──────────────────────────────────────────┐
│  #12 · T5 · John Smith         14:32  🔴 │  ← order # · table · customer · time · rush
└──────────────────────────────────────────┘
```

| Element | Content |
|---------|---------|
| Order number | `#` + `display_number` (e.g. `#12`) |
| Table number | `· T5` when present; hidden for takeaway |
| Customer name | `· John Smith` from the sale (when available) |
| Time | `received_at` formatted as `HH:MM` (24h) — static, not counting up |
| Rush badge | 🔴 `RUSH` (red) badge when `order.priority === true` |

**Header colour coding** — the header background signals the order service type at a glance. The two colours are **user-configurable** via the hamburger menu (§2.1a) and persist across restarts:

| Service type | Header background (default) | Configurable via |
|---|---|---|
| Dine-in (eat in restaurant) | `--color-success-bg` (soft green) | `kds_color_dinein_header` |
| Takeaway / take home | `--color-bg-elevated` (grey) | `kds_color_takeaway_header` |

The colour lets kitchen staff immediately see which orders are for tables (dine-in) vs. takeaway without reading the table number. It is applied to the header section only, not the whole card, so the card body stays neutral. The actual colour values come from the saved preferences at render time (see §2.1a), with the defaults above as fallback.

### 3.1a DOM / flex structure

```
<div class="kds-card">                    ← display:flex; flex-direction:column;
                                             height: 100%; min-height: 0;
                                             border-radius: 8px; overflow: hidden
  <header class="kds-card-header">        ← flex: 0 0 auto (fixed)
    <span class="kds-card-order-no">#12</span>
    <span class="kds-card-table">· T5</span>
    <span class="kds-card-customer">· John Smith</span>
    <span class="kds-card-time">14:32</span>
    <span class="kds-card-rush" hidden>RUSH</span>
  </header>

  <main class="kds-card-main">            ← flex: 1 1 auto; overflow-y: auto;
                                             min-height: 0 (scrollable)
    <section class="kds-category">        ← one per course group
      <button class="kds-category-header">  ← full-width tap target (station action)
        <span class="kds-category-name">🥗 Appetizers</span>
        <span class="kds-category-progress">2/3</span>
        <span class="kds-category-check">✓</span>
      </button>
      <div class="kds-item">
        <button class="kds-item-toggle">
          <span class="kds-item-check">✓</span>
          <span class="kds-item-qty">2×</span>
          <span class="kds-item-name">Calamari</span>
          <span class="kds-item-done-time">14:41 · 9m</span>  ← only when done
        </button>
        <p class="kds-item-note">no garlic, extra butter</p>   ← italic, low contrast,
                                                                  clamp 2 lines
      </div>
    </section>

    <p class="kds-card-notes">Notes: "No onions on steak"</p>  ← order-level, optional
  </main>

  <footer class="kds-card-footer">        ← flex: 0 0 auto (fixed)
    <button class="kds-card-status-btn">Pause</button>          ← §3.3
  </footer>
</div>
```

**Flex rules:**
- `.kds-card` — `flex: 1` within the grid cell, `flex-direction: column`, `min-height: 0`
- `.kds-card` — **`border-radius: 8px`** with `overflow: hidden`, so the header's colour tint and the footer button are clipped to the rounded corners (no square corners bleeding outside the card)
- `.kds-card-header` / `.kds-card-footer` — `flex: 0 0 auto`, so they never compress or scroll away
- `.kds-card-main` — `flex: 1 1 auto`, `overflow-y: auto`, `min-height: 0` so the categories scroll inside the card while header/footer stay pinned. This is what makes tall orders usable on small screens.

### 3.1b Interaction cooldown (anti-mis-tap)

**Every interactive element on the card enforces a 200 ms minimum interval between taps.** The KDS is a touchscreen in a busy kitchen — a double-tap or a finger that lands twice on the same spot must not toggle an item twice, fire the category check twice, or advance the status twice.

**Applies to all of these:**
- Category header tap (toggle whole category)
- Item row tap (toggle one item)
- Status button (Pause / Resume / Mark Completed)
- Note edit tap

**Mechanism:**
- Each interactive element is wrapped in the existing `createCooldownWrapper(action, 200)` helper (`useActionCooldown.ts`) — the same pattern the current `KdsTicketCard` uses for its advance handler.
- The wrapper ignores any invocation that arrives **less than 200 ms** after the previous one on that element.
- Cooldown is **per-element** (a category tap and an item tap on the same card are independent), and the cooldown state is stored in a ref so it survives re-renders.
- Rapid two-finger taps on *different* elements are both allowed (e.g. juice guy taps Drinks while grill guy taps Mains) — the guard is per-target, not per-card.

**Visual feedback:** the target's pressed state is driven by CSS `:active`, and the optimistic state change (checkmark appearing) already gives instant confirmation; no additional dimming is required during the cooldown window.

### 3.2 Main section — category groups

Each order's `kds_line_items` are grouped by `course` (the existing field). When a line item has no course, it falls into an "Other" category at the bottom.

**Category header** — one per course group, shows:
- A label (localized course name: "Appetizers", "Mains", "Desserts", "Beverages", "Other")
- A progress fraction `n/M` showing how many items are checked off
- A checkmark icon when all items in the category are done

**Item row** — one per line item:
- `✓` checkmark icon on the left (green when checked, grey outline when unchecked)
- `N×` quantity prefix
- `display_name` of the item
- **Item notes** (new) — up to **2 lines** of free-form note text, rendered in a **lower-contrast colour** (e.g. `--color-fg-tertiary`) and **italic**. Wraps and clamps at 2 lines with ellipsis overflow (`-webkit-line-clamp: 2`). Notes come from the sale's line-item notes and may be edited in-place by the kitchen (tap the note to edit). Long notes beyond 2 lines are truncated with `…`; tapping the note opens it full-width.
- **Done-time line** (new) — once an item is checked off, its row gains a small right-aligned caption: `HH:MM · in M min S s` (e.g. `14:41 · in 9m`), showing when it was marked done and how long it took since the order was received. This gives each station immediate feedback that their work on that item is on time or slipping.

**Interaction:**
- **Tap a category header** → toggles **all** items in that category (the primary, station-level action). If all items were unchecked, they become checked. If all were checked, they become unchecked. If mixed, they become all checked. A large tap target — this is how a station clears its whole workload on an order.
- **Tap an item row** → toggles just that item's done state (for partial work or corrections, e.g. a 4× line where only 3 are plated). A `done_at` timestamp is recorded on the `kds_line_item`; the checkmark animates in/out.
- **Category progress** updates immediately (optimistic local update); the change is broadcast via `kds:orders-changed` so other KDS terminals see the same state.
- **Order-level completion** only becomes available when every category is `n/n` (see §3.3) — that is the waiter's signal to close the order.

### 3.3 Status action button

A single button at the bottom of the card that reflects and advances the order's **production status**. The possible states:

| Order status | Button label | Tap action | Visible when |
|---|---|---|---|
| `processing` | `Pause` | Sets order to `paused` | Always |
| `paused` | `Resume` | Sets order to `processing` | Always |
| `ready` | `Mark Completed` | Shows confirmation dialog, then sets `completed` | **Only when all line items are checked off** (all categories 100% done) |

**Gating logic (waiter workflow):**

The `Mark Completed` action is the **waiter's action** — it closes the order. To prevent premature completion:

- The button shows `Mark Completed` **only when every line item on the order has a `done_at` timestamp** (all categories at `n/n`).
- When any item is still unchecked, the button shows a **disabled state** with the text `X items remaining` (e.g. `3 items remaining`) — this is informative, not actionable.
- A waiter can **force-complete** by tapping the disabled button → a confirmation dialog warns "2 items still unchecked — override?" and requires a confirm.

**Transition rules:**
- An order is created as `processing` (the initial status after the sale creates the KDS ticket)
- Kitchen can pause/resume freely
- Marking completed is terminal for the Open tab; the order can be **reopened** from the Completed tab (which sets status back to `paused`)

### 3.4 Urgency / SLA

The existing urgency coloring is preserved but simplified. The card border gets a subtle color tint:

- **< 5 min** — green (on track)
- **5–10 min** — amber (yellow threshold)
- **> 10 min** — red (red threshold)
- **> 15 min** — red background (urgent badge)

These thresholds are still configurable via the settings panel (existing `yellowThresholdMin` / `redThresholdMin`).

---

## 4. Completed tab

```
┌──────────────────────────────────────────────────────────────────────┐
│  #12 · John Smith     T5     completed 14:32  [Reopen]              │
│  🥗 3 items · 🥩 5 items · 🍹 2 items                               │
├──────────────────────────────────────────────────────────────────────┤
│  #8 · Jane Doe       T2     completed 14:28  [Reopen]               │
│  🥗 2 items · 🥩 1 item                                             │
└──────────────────────────────────────────────────────────────────────┘
```

- Sorted by `completed_at` descending (newest first)
- Shows summary: order number, table, customer, completion time
- Item category summary (category name + count)
- **Reopen** button per row — sets order status to `paused` and moves it back to the Open tab
- "Completed" tab badge counts the number of completed orders
- Auto-clear: completed orders older than 24 hours are hidden from the tab (but still in the database)

---

## 5. Multi-KDS sync

All KDS terminals in the same store see the same board. The sync model:

1. **Production status changes** (processing/paused/completed) — use the existing `updateKdsStatusScoped` Tauri command; the backend emits `kds:orders-changed` which all KDS screens listen to.
2. **Per-item checkoff** — when a line item is checked/unchecked, call a new Tauri command `updateKdsLineItemDone` (or extend the existing `updateKdsLineItemStatusScoped`) to persist the `done_at` timestamp. The backend emits `kds:orders-changed` after the update.
3. **Category-level checkoff** — same as item checkoff but applied to all items sharing that course; the frontend sends bulk updates and the backend emits a single event.
4. **Optimistic updates** — the tapping KDS applies the change immediately in local state before the round-trip completes. If the backend rejects (e.g. stale data), the next `kds:orders-changed` event corrects the state.
5. **Offline resilience** — the existing `useKdsOffline` hook handles queued mutations when the backend is unreachable; the queue applies on reconnect.

---

## 6. Empty states

| Scenario | Message |
|----------|---------|
| Open tab, no orders at all | "No orders yet" (large text, centered) |
| Open tab, all orders of a filtered zone completed | "No open orders for this zone" |
| Completed tab, nothing completed yet | "No completed orders yet" |
| Completed tab, all cleared after 24h expiry | same as above |

---

## 7. States summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORDER LIFECYCLE                              │
│                                                                     │
│    Sale ──→ KdsOrder.created (status='processing')                  │
│                  │                                                  │
│                  ▼                                                  │
│        ┌─────────────────┐                                          │
│        │   Processing    │ ◄── Pause ──┐                           │
│        └───────┬─────────┘             │                           │
│                │ Resume                │                            │
│                ▼                        │                            │
│        ┌─────────────────┐             │                            │
│        │    Paused       │ ──Resume ───┘                           │
│        └───────┬─────────┘                                          │
│                │ Mark Completed                                     │
│                ▼                                                    │
│        ┌─────────────────┐                                          │
│        │   Completed     │ ──Reopen ──→ Paused                     │
│        └─────────────────┘                                          │
│                                                                     │
│    Per-item: each line_item tracks done_at timestamp                │
│    Category: progress = (done_count / total_count) per course       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Decisions

1. **Done_at on line items.** ✅ **Agreed.** Reuse `item_status = 'ready'` for the kitchen "done" state, and add a nullable `done_at` timestamp column to `kds_line_items`. The `served` status stays for front-of-house marking.

2. **Category-level API.** ✅ **Decided: batched per-item updates.** The frontend sends individual `updateKdsLineItemStatusScoped` calls for each item in the category (grouped in one async batch). The batch is **atomic from the UI** — optimistic local update applies instantly, and the offline retry queue treats the batch as one unit. No new RPC command needed.

3. **Completed tab auto-clear.** ✅ **24 hours.** Completed orders older than 24h are hidden from the tab (still in the database). A future `kds.completed_history_days` setting can make this configurable.

4. **Pause reason.** ✅ **None.** Just `Pause` / `Resume` — no reason text. Keeps the kitchen fast.

5. **Force-complete scope.** ✅ **Every screen, with audit.** Any KDS screen can force-complete an order. Every action (item checkoff, category toggle, status change, force-complete) is **logged to the audit log** with the terminal ID and user who performed it.

6. **Partial-quantity lines.** ✅ **Decided: all-or-nothing for v1.** A single tap marks the whole line done. The kitchen can split a large line into multiple line items (e.g. `2× Steak` → `1× Steak` + `1× Steak`) if per-item tracking matters. Partial-quantity checkoff (`3/4 done`) is deferred to a future version.

7. **Force-complete is a bypass, never a fake checkoff.** ✅ **Decided.** Force-completing an order does **not** mark its unchecked items as done — the items stay unchecked and the order leaves the board. The audit log records one `force_complete` event with the remaining count (and per-category breakdown). This keeps item/production analytics truthful and makes skipping behaviour directly measurable (§10). Falsifying `done_at` on skipped items would pollute prep-time and per-item stats and make lazy behaviour invisible.

---

## 10. Audit logging

Every user-initiated state change on any KDS terminal is appended to a single **append-only, tamper-evident audit log**. The log is the source of truth for staff-behaviour analysis; order/item state is derived from it. This implements Decision §8.5 ("everything is logged, who clicked what").

### 10.1 Principles

- **Append-only & immutable** — no `UPDATE` / `DELETE` on the log, ever.
- **Fully attributed** — every event carries user, terminal, shift, session, and store context.
- **Tamper-evident** — rows are hash-chained; a gap in the monotonic sequence or a broken chain is a tampering signal.
- **Truthful** — `force_complete` records what actually happened (a bypass); it never fabricates item `done_at` values (Decision §8.7).
- **Event-sourced** — behaviour analysis reads the log; the KDS board is a projection of it.

### 10.2 Event envelope (shared by every event)

| Field | Type | Notes |
|---|---|---|
| `v` | int | Schema version (1) |
| `event_id` | ULID | Globally unique + time-sortable; survives DB restores |
| `event` | string | Event type (see §10.3) |
| `ts` | ISO-8601 UTC, ms | Wall clock at capture |
| `mono_ms` | int | Boot-relative monotonic ms — detects clock skew / backwards jumps |
| `actor.user_id` | string | Who (operator login) |
| `actor.username` | string | Display name |
| `actor.terminal_id` | string | Which physical KDS screen |
| `actor.terminal_role` | string | `kitchen` \| `juice` \| `grill` \| `waiter` (configurable) |
| `context.order_id` | string | Business order id |
| `context.order_display` | string | `#12` |
| `context.table` | string \| null | `T5`; null for takeaway |
| `context.service_type` | string | `dine_in` \| `takeaway` |
| `context.shift_id` | string | Active shift at capture (null outside shift) |
| `context.session_id` | string | Login session |
| `payload` | object | Event-specific (see §10.4) |

### 10.3 Capture surface

| Event | Payload highlights |
|---|---|
| `order_received` | Backend-emitted; no actor |
| `item_check` / `item_uncheck` | `item_id`, `course`, `qty` |
| `category_check` | `course`, `items_affected` (bulk fast-path, still attributed) |
| `pause` / `resume` | — |
| `mark_completed` | `remaining: 0` (the honest path) |
| `force_complete` | see §10.4 |
| `reopen` | — |
| `shift_start` / `shift_end` | terminal, user |
| `settings_change` | theme, colours, toggles — cheap "who clicked what" |

### 10.4 `force_complete` payload

```json
"payload": {
  "total_items": 12,
  "checked_before": 6,                          // legitimately done before the bypass
  "remaining": 6,                               // skipped by this action
  "remaining_by_category": { "Mains": 4, "Juice": 2 },  // skip-pattern analysis
  "elapsed_since_received_ms": 1482000,          // wait time at the moment of forcing
  "reason": null                                 // optional free-text (future modal)
}
```

`remaining_by_category` is what turns "lazy" into a **diagnosable pattern** — a terminal that always force-completes the same category is actionable; a flat count is not.

### 10.5 Storage schema (SQLite via rusqlite, single write transaction)

```sql
CREATE TABLE kds_audit_log (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic; a gap = tampering signal
  event_id      TEXT NOT NULL UNIQUE,               -- ULID
  event_type    TEXT NOT NULL,
  ts_utc_ms     INTEGER NOT NULL,
  mono_ms       INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  terminal_id   TEXT NOT NULL,
  terminal_role TEXT NOT NULL DEFAULT 'kitchen',
  shift_id      TEXT,
  order_id      TEXT,
  order_display TEXT,
  payload       TEXT NOT NULL,                      -- JSON; normalize hot fields if needed
  prev_hash     TEXT NOT NULL,                      -- sha256 of previous row's row_hash
  row_hash      TEXT NOT NULL                       -- sha256(canonical(row) + prev_hash)
);
CREATE INDEX idx_audit_event_ts ON kds_audit_log (event_type, ts_utc_ms);
CREATE INDEX idx_audit_user     ON kds_audit_log (user_id, event_type);
CREATE INDEX idx_audit_order    ON kds_audit_log (order_id, seq);
CREATE INDEX idx_audit_shift    ON kds_audit_log (shift_id, event_type);
```

- Insert = **one transaction** (project rule); WAL mode for concurrent terminals.
- `row_hash` = sha256 over the canonicalized row (sorted-key JSON) **plus** `prev_hash` → hash chain.
- All terminals write to the **same table** — it is also the multi-screen sync authority: the backend appends, screens replay.

### 10.6 Ingestion flow

```
tap on a KDS screen
  → event queued locally (rapid checkoffs batch ~50 events / 200 ms flush)
  → IPC to backend via a new Tauri command appendKdsAuditEvents
  → validated (actor, session, shift) → one transaction append
     (server assigns seq + hashes)
  → ack → UI confirms
```

Clients render optimistically; the backend is the source of truth. `seq` is server-assigned so no screen can forge ordering.

### 10.7 Retention

The **24 h auto-clear (§8.3) applies to the on-screen Completed list only** — the audit log is long-lived (it is the staff-behaviour dataset). Only display projections expire; `kds_audit_log` does not.

### 10.8 Analysis queries

```sql
-- force-complete rate per user, per shift
SELECT username, COUNT(*) FROM kds_audit_log
WHERE event_type = 'force_complete' AND shift_id = ?
GROUP BY user_id ORDER BY 2 DESC;

-- skip severity by terminal
SELECT terminal_id, AVG(remaining), SUM(remaining)
FROM kds_audit_log WHERE event_type = 'force_complete' GROUP BY terminal_id;

-- chain verification (tampering)
SELECT seq FROM kds_audit_log a
WHERE a.row_hash != sha256(canonical(a) || (SELECT row_hash FROM kds_audit_log WHERE seq = a.seq - 1));
```

---

## 9. Visual design tokens

| Token | Value | Usage |
|-------|-------|-------|
| Card background | `--color-bg-elevated` | Order card surface |
| Checkmark color | `--color-success` | Done item indicator |
| Category progress | `--color-fg-secondary` | Fraction text |
| Rush badge | `--color-danger` | Priority badge |
| SLA green | `--color-success` | < 5 min |
| SLA amber | `--color-warning` | 5–10 min |
| SLA red | `--color-danger` | 10–15 min |
| SLA urgent | `--color-danger-bg` | > 15 min |
| Card border radius | `8px` | Soft corners |
| Grid gap | `var(--space-4)` | Between cards |
| Font | `var(--font-sans)` | System font |

> last audited 29-09-26 by docs-auditor