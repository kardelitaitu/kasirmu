# The restaurant POS has no keyboard shortcuts, and the key space is nearly full (round 158)

## The gap

| Surface | Manifest | Parity-tested |
|---|---|---|
| retail POS | `features/retail/retailShortcuts.ts`, 16 bindings | `retailShortcutParity.test.tsx` |
| warehouse | `features/warehouse/warehouseShortcuts.ts` | its own suite |
| KDS board | `features/kds/hooks/useKdsKeyboardShortcuts.ts` | its own suite |
| **restaurant POS** | **none** | — |

`grep 'RESTAURANT_SHORTCUT|restaurantShortcut|restaurant-shortcut' ui/src` returns **zero hits**.
The restaurant workspace renders the same `PosScreen` as retail (registered for both `sales` and
`pos` routes, `features/sales/register.tsx:15-16`), so this is not a missing screen — the shared
screen declares **retail-scoped** bindings only.

What a restaurant operator *does* have: Escape (`AppShell.tsx:63`, and plain Escape is deliberately
skipped inside `restaurant-pos`, round 141), F10 for workspace settings (`:439`), and in-cart
↑/↓/+/-/Del/Enter navigation (`useCartKeyboardNav`). Everything else is pointer-driven.

## Why this earns a record rather than an implementation

The retail manifest documents how full the key space is: **F1–F12, `?`, `Ctrl+K`, `Ctrl+L`, `Esc`**,
with `F10` owned globally by AppShell across every workspace. A restaurant manifest therefore has
almost no free function keys, and the natural choices (`F1` pay, `F3` discount, `F6` history) all
collide with retail's.

The tree also records what a collision costs here. `PosScreen.tsx:91-95` removed a local settings
screen specifically because it *"would shadow the global shortcut"* — a collision this codebase has
already paid for and fixed once.

`retailShortcutParity.test.tsx` is the model to follow: it asserts what the help overlay displays
matches what is implemented, and that no key has two owners. A restaurant set would need the same,
plus a decision about which keys remain free.

## The open question, for whichever owner confirms the gap is real

Is the restaurant till supposed to be keyboard-driven at all? The actions a waiter takes during a
service — send to kitchen, course firing, pax, table number — are restaurant-only and have **no
retail binding to collide with**, so a *disjoint* set is feasible even though an overlapping one is
not. The question is whether to extend the retail manifest with a third scope (`restaurant`) or ship
a separate one; the parity test needs widening either way.

Not attempted this round, deliberately. This is a feature with a key-space decision behind it, and
the objective asks for careful work — a half-chosen key map would be worse than the gap.

## Verified

| Item | Result |
|---|---|
| shortcut survey | retail, warehouse, KDS each have a manifest; restaurant has none |
| `RESTAURANT_SHORTCUT`-style identifiers | 0 in `ui/src` |
| shared screen for both surfaces | `PosScreen` registered twice, both routes |
| restaurant's existing keys | Escape, F10, in-cart navigation |
| free function keys | none free; F1–F12 mostly retail's, F10 global |
| Tree | no source changed this round |