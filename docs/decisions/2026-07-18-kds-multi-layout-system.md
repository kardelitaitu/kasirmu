---
num: 17
area: kds
title: ADR #17: KDS Multi-Layout System — Switchable Kitchen Display Layouts with Per-User Preferences
status: Implemented (2026-07-26)
---
# ADR #17: KDS Multi-Layout System — Switchable Kitchen Display Layouts with Per-User Preferences

<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (1 observation) · O1: File Organisation (S6) omits KdsSettingsPanel.tsx which exists in ui/src/features/kds/; migration 038_user_preferences.sql is cited as the historical table origin (the feature adds no new migrations, per S2) · verified accurate: KdsLayoutKanban/Focus/Metro.tsx + KdsLayoutSwitcher.tsx + components/KdsTicketCard.tsx + hooks/useKdsPreferences.ts present; getUserPreferences/setUserPreferences in ui/src/api/settings.ts; getKdsQueue in ui/src/api/kds.ts; crates/oz-core/src/user_preferences.rs + 038_user_preferences.sql exist; Status "Implemented" matches on-disk code -->

**Status:** Implemented (2026-07-26)
**Date:** 2026-07-18
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** kds, kitchen-display, layout, ux, preference, workspace

---

## Context

The Kitchen Display System (KDS) is used by kitchen staff across diverse operational styles — fast-casual QSRs, fine-dining restaurants, ghost kitchens, and high-volume catering. Each environment has different visual priorities:

- **QSR / fast food**: Staff need a single urgency-sorted list — glance at the top to see what's overdue.
- **Fine dining / multi-course**: Chefs think in courses (appetiser → main → dessert), so the kanban column model maps naturally to their workflow.
- **Ghost kitchens / high-volume**: Staff monitor many orders simultaneously; a dense tile grid maximises screen real estate.

Previously, KDS had a single fixed kanban layout (Pending / Preparing / Ready columns). Power users had no way to adapt the display to their workflow, and switching between operational modes required a code change.

This ADR proposes a **multi-layout KDS** where each user can choose their preferred layout via a toolbar button, with settings persisted per user in the existing `user_preferences` table.

### Requirements

- **Three layout options**: Kanban (current), Focus (urgency-sorted single list), Metro (tile grid).
- **Per-user persistence**: Layout choice stored in `user_preferences` key-value table, keyed by `kds_layout`.
- **In-screen switcher**: A toolbar button in the KDS header opens a popover with layout thumbnails and toggle switches — no detour to the Settings page.
- **Display toggles**: Users can independently toggle visibility of order ID (`#123`) and table number on each ticket card.
- **32×32px minimum icon size** for layout thumbnails in the switcher, using inline SVG icons.
- **Backward-compatible**: Default layout is `kanban` — existing users see no change.
- **All three layouts share the same data source**: Fetch orders once in the shell, pass down as props.

---

## Decision

### 1. Architecture Overview

```
KdsScreen (shell)
  ├─ fetches orders (getKdsQueue)
  ├─ fetches user prefs (kds_layout, kds_show_order_id, kds_show_table_number)
  ├─ toolbar with layout switcher + display toggles
  └─ renders one of:
       ├─ KdsLayoutKanban   — 3-column
       ├─ KdsLayoutFocus    — urgency-sorted list
       └─ KdsLayoutMetro    — tile grid
```

The shell owns the `advanceStatus` callback, the error state, and the auto-refresh interval. Each layout component receives `orders`, `onAdvance`, `showOrderId`, `showTableNumber` as props and is responsible only for rendering.

### 2. Storage — User Preferences (Existing Table)

No new tables or migrations. The existing `user_preferences` table stores three keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `kds_layout` | string | `kanban` | One of `kanban`, `focus`, `metro` |
| `kds_show_order_id` | boolean | `true` | Show `#123` on ticket cards |
| `kds_show_table_number` | boolean | `true` | Show table number on ticket cards |

Read via `getUserPreferences(userId)` → `{ kds_layout: "kanban", ... }`.
Write via `setUserPreferences(userId, [{ pref_key: "kds_layout", pref_value: "metro" }])`.

### 3. Layout Components

#### 3a. `KdsLayoutKanban` (Current Design, Refactored)

```
┌──────────────┬──────────────────┬──────────────┐
│  🟡 Pending  │  🔵 Preparing    │  🟢 Ready     │
│       3      │        5         │       4       │
├──────────────┼──────────────────┼──────────────┤
│ [#102] [T3]  │ [#100] [T1]     │ [#97] [T2]   │
│ 12m 04s      │ 9m 32s          │ 4m 32s       │
│ 3 items      │ 5 items         │ 2 items      │
│ ───────────  │ ─────────────── │ ──────────── │
│ [#105] [T1]  │ [#101] [T4]     │ [#99] [T5]   │
│ 11m 01s      │ 7m 15s          │ 2m 10s       │
│ 2 items      │ 4 items         │ 1 item       │
└──────────────┴──────────────────┴──────────────┘
```

- Identical visual result to the current `KdsScreen.tsx`.
- `showOrderId` toggles the `#123` label; `showTableNumber` shows/hides `[T3]`.
- Column scrolls independently.

#### 3b. `KdsLayoutFocus` (Urgency-Sorted Single List)

```
┌───────────────────────────────────────────────┐
│  ALL │ Pending 3 │ Preparing 5 │ Ready 4      │
├───────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓  #104  OVERDUE  [T3]     17m 32s          ▓ │
│ ▓  2× Burger Classic, Fries, Coke           ▓ │
│ ▓  ! No onions                              ▓ │
│ ▓           [▶ START PREP]                   ▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ┌───────────────────────────────────────────┐ │
│ │  #103  ⚠ [T1]          12m 04s           │ │
│ │  1× Caesar Salad, 3× wings               │ │
│ │           [▶ START PREP]                  │ │
│ └───────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────┐ │
│ │  #102  [T4]             8m 12s           │ │
│ │  4× Steak med-rare                       │ │
│ │         tap to advance ›                  │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

- Orders sorted by SLA urgency (red → yellow → green), then by received_at (oldest first).
- Status filter pills at the top to narrow the view.
- Explicit action buttons (`▶ START PREP`, `✓ READY`) for status advancement.

#### 3c. `KdsLayoutMetro` (Tile Grid)

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ██ #104 ██   │ │#102          │ │#100          │
│ ██ 17m ██    │ │12m 🟡       │ │9m 🔵        │
│ ██ OVERDUE ██│ │[T3]         │ │[T1]         │
│ 2× Burger    │ │Burger×2     │ │Salad×3      │
│ Fries, Shake │ │Fries, Coke  │ │Wings×6      │
│ [▶ PREP] [✕]│ │[▶ PREP]     │ │[▶ PREP]     │
└──────────────┘ └──────────────┘ └──────────────┘
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ │#101          │ │#99           │ │#97           │
│ │7m 🔵        │ │4m 🟢        │ │1m 🟢 ✅     │
│ │[T4]         │ │[T5]         │ │[T2]         │
│ │Steak×3      │ │Pasta×2      │ │Kids meal    │
│ │Mash, Asp.   │ │Garlic bread │ │Juice×2      │
│ │[▶ PREP]     │ │[✓ SERVE]    │ │[✓ SERVE]    │
└──────────────┘ └──────────────┘ └──────────────┘
```

- Responsive grid (3 cols on 1920px, 2 cols on 1280px, 1 col on <800px).
- Each tile auto-sizes via CSS `grid` with `minmax(320px, 1fr)`.
- Overdue tiles (red SLA) have a full red background with white text.
- Explicit action buttons per tile.
- Color is the only status indicator — no column grouping.

### 4. Layout Switcher UI

A button in the KDS toolbar (32×32px minimum):

```
┌─────────────────────────────────────────────────┐
│  ◉ Kitchen Display   12 orders    [Grid ▼] [⚙] │
└─────────────────────────────────────────────────┘
                                   │
                      ┌────────────┴────────────┐
                      │  Layout                  │
                      │  ┌───┐ ┌───┐ ┌───┐     │
                      │  │ K │ │ F │ │ M │     │← 32px SVG icons
                      │  └───┘ └───┘ └───┘     │
                      │  Kanban  Focus  Metro   │
                      │                          │
                      │  Display                  │
                      │  ☑ Order ID              │
                      │  ☑ Table Number          │
                      └──────────────────────────┘
```

- Clicks anywhere outside the popover close it.
- Selection saves immediately via `setUserPreferences` — no "Save" button needed.
- The popover uses the existing `SettingsPopup` or a custom portal-based dropdown.

#### Layout Icons

Each layout gets a distinctive 32×32px inline SVG:

| Layout | Icon Concept | SVG Description |
|--------|-------------|-----------------|
| Kanban | Three stacked rectangles | Three vertical panels side by side |
| Focus | One tall rectangle with horizontal line | Single column with divider lines |
| Metro | Three-square grid | 2×2 grid with three filled cells |

All icons use `viewBox="0 0 32 32"`, `strokeWidth="1.5"`, and inherit current color.

### 5. Data Flow

```
KdsScreen mount
  ├─ getKdsQueue(userId)        → orders[]
  ├─ getUserPreferences(userId) → { kds_layout, kds_show_order_id, kds_show_table_number }
  │
  ├─ render toolbar with current layout + toggle states
  ├─ render <KdsLayoutX orders={...} onAdvance={...} showOrderId showTableNumber />
  │
  └─ on layout/toggle change:
       └─ setUserPreferences(userId, [{ pref_key: kds_layout, pref_value: "metro" }])
           └─ local state updates immediately (optimistic UI)
```

### 6. File Organisation

```
ui/src/features/kds/
├── KdsScreen.tsx                  # Shell — fetch orders + prefs, render toolbar + layout
├── KdsScreen.css                  # Shell + toolbar styles
├── KdsLayoutKanban.tsx            # 3-column kanban
├── KdsLayoutKanban.css            # Kanban-specific styles
├── KdsLayoutFocus.tsx             # Urgency-sorted list
├── KdsLayoutFocus.css             # Focus-specific styles
├── KdsLayoutMetro.tsx             # Tile grid
├── KdsLayoutMetro.css             # Metro-specific styles
├── KdsLayoutSwitcher.tsx          # Popover with layout icons + display toggles
├── KdsLayoutSwitcher.css          # Switcher popover styles
├── components/
│   └── KdsTicketCard.tsx          # Shared ticket card (used by all layouts)
├── hooks/
│   ├── useTicketSla.ts            # Existing SLA hook
│   └── useKdsPreferences.ts      # Hook for reading/writing KDS user prefs
```

Each layout component imports the shared `KdsTicketCard` component, which accepts `showOrderId` and `showTableNumber` props.

---

## Options Considered

### Option A — Single Configurable Layout (Rejected)

Extend the current kanban with optional features (urgency sorting per column, density control) but keep one visual structure.

- **Pro**: Less code to maintain.
- **Con**: Cannot satisfy fundamentally different workflows (e.g., ghost kitchens need a grid, not columns).
- **Con**: Feature-creep in a single component — becomes a "god component" with too many conditional branches.

### Option B — Plugin System for Layouts (Rejected)

Allow third-party layout plugins registered at build time.

- **Pro**: Extensible for future layouts.
- **Con**: Over-engineered for the immediate need (3 layouts).
- **Con**: Plugin API surface area must be maintained and documented.
- **Con**: Harder to test — each plugin is its own build artifact.

### Option C — User Preferences Only, No Toolbar (Rejected)

Provide the layout switcher exclusively in the Settings page.

- **Pro**: Cleaner KDS header — no toolbar button.
- **Con**: Kitchen staff rarely navigate to Settings. They need in-context switching.
- **Con**: Layout experimentation is frictionless with a toolbar button; buried in Settings, nobody changes it.

### Option D — Multi-Layout Shell with Per-User Prefs + Toolbar (Chosen)

**This ADR.** A thin shell component that fetches orders and preferences, renders a toolbar, and delegates rendering to the selected layout component.

- **Pro**: Each layout is a focused, testable component with no cross-layout conditionals.
- **Pro**: Per-user persistence means every workstation shows the cook's preferred layout.
- **Pro**: In-screen toolbar means switching takes 1 tap — no settings detour.
- **Pro**: Existing `user_preferences` table requires zero backend changes.
- **Con**: Three layout components to maintain instead of one.
- **Con**: Any shared visual change must be replicated across layouts (mitigated by sharing `KdsTicketCard`).

---

## Consequences

### Positive

- **Three workflows, one screen**: QSR, fine-dining, and ghost-kitchen operators each get a purpose-built layout.
- **Per-user persistence**: Each cook's preferred layout follows them across shifts and devices.
- **Zero backend work**: Existing `user_preferences` table and API handle all storage.
- **In-context switching**: The toolbar popover lets staff experiment and settle on their preferred layout without leaving the screen.
- **Shared card component**: Visual consistency across layouts — SLA coloring, tap-to-advance, and sound alerts work identically.
- **Backward-compatible**: `kanban` is the default; existing installs see no change.

### Negative

- **Three layout components to maintain**: Any change to the shared interaction model (e.g., SLA thresholds, alert sounds) must work across all three. Mitigated by sharing `KdsTicketCard` and the `useTicketSla` hook.
- **CSS duplication**: Each layout has its own CSS file. Some base styles (ticket card, color tokens) are shared, but column/grid/list layout rules are layout-specific.
- **Testing surface grows**: Each layout needs its own test suite (render, interactions, edge cases).

### Mitigations

- **Thin layouts, fat shell**: The shell owns all data fetching, error handling, and the advance-to-next-state callback. Layouts are pure rendering — no data logic means less to test per layout.
- **Shared `KdsTicketCard`**: Ticket card rendering, SLA colors, pulse animation, and sound effects live in one file used by all three layouts.
- **CSS custom properties**: Shared tokens (`--kds-*` vars) remain in `KdsScreen.css`. Layout-specific files only add positioning rules.

---

## Related

- `ui/src/features/kds/KdsScreen.tsx` — Shell component (to be refactored)
- `ui/src/features/kds/KdsLayoutKanban.tsx` — Kanban layout (new)
- `ui/src/features/kds/KdsLayoutFocus.tsx` — Focus layout (new)
- `ui/src/features/kds/KdsLayoutMetro.tsx` — Metro layout (new)
- `ui/src/features/kds/KdsLayoutSwitcher.tsx` — Layout options popover (new)
- `ui/src/features/kds/components/KdsTicketCard.tsx` — Shared ticket card
- `ui/src/features/kds/hooks/useKdsPreferences.ts` — Preference hook (new)
- `ui/src/api/settings.ts` — API for `getUserPreferences` / `setUserPreferences`
- `crates/oz-core/src/user_preferences.rs` — Rust `UserPreferences` struct
- `crates/oz-core/migrations/038_user_preferences.sql` — User preferences table
- `docs/decisions/2026-07-18-kds-multi-layout-system.md` — This ADR

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

