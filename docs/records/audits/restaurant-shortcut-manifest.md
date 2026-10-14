# The restaurant POS gains a keyboard shortcut manifest, and the tree stops it twice (round 158)

## The gap, measured before the fix

Every shortcut system in the shell, surveyed:

| Surface | Manifest | Parity-tested |
|---|---|---|
| retail POS | `features/retail/retailShortcuts.ts`, 16 bindings | `retailShortcutParity.test.tsx` |
| warehouse | `features/warehouse/warehouseShortcuts.ts` | its own suite |
| KDS board | `features/kds/hooks/useKdsKeyboardShortcuts.ts` | its own suite |
| **restaurant POS** | **none** | — |

`grep 'RESTAURANT_SHORTCUT' ui/src` → zero. The restaurant workspace renders the shared
`PosScreen` (registered for both `sales` and `pos`), which declares **retail-scoped** bindings
only. A waiter running a service had no key path to any restaurant-only action.

## What landed

| File | What |
|---|---|
| `features/restaurant/restaurantShortcuts.ts` | the manifest, 5 bindings |
| `features/restaurant/hooks/useRestaurantShortcuts.ts` | the binding hook, editable-guarded |
| `__tests__/restaurantShortcutParity.test.ts` | 4 cases, all kill-tested |
| `shared-ui/locales/sales{,.id}.ftl` | the 10 label keys both bundles require |

Keys are `Shift+K` send-to-kitchen, `Shift+P` print-bill, `Shift+B` split-bill, `Shift+T`
save-tab, `Shift+L` open-tables — **chosen disjoint from retail's F1-F12, `?`, Ctrl+K, Ctrl+L,
Esc and AppShell's global F10**, and every action is restaurant-only, so there is nothing to
shadow.

## The gates stopped this twice, and both stops were right

1. **`verify-bundle-parity` refused the source commit** — the manifest named five
   `restaurant-shortcut-*` ids that neither FTL bundle had. The fix was to add them, in both
   languages, before the source could land. This is the gate doing exactly its job: a
   manifest declaring a label with no translation is a missing string, not a new feature.
2. **`commit-msg` rejected `i18n(restaurant):`** — not in the accepted list. My error;
   re-landed as `feat(restaurant):`.

## The parity test, and a bug it caught in my own matcher

Modelled on retail's, which exists because retail's three separate key maps drifted into the
F11 contradiction. Three structural claims:

| Claim | Kills on |
|---|---|
| no key bound twice (a duplicate is dead — the loop returns at the first match) | duplicate `Shift+T` → **failed** |
| no key retail or AppShell already owns | `F11` → **failed** — and it found F11 is retail's Quick Return even though retail marks it global |
| every advertised action is implemented | `course-firing` → **failed** |

The fourth case caught a **real bug in `matchesRestaurantShortcut` on its first run**: I compared
`e.key.toUpperCase()` against the whole label `'Shift+K'`, which never equals `'K'`, so every
chord silently never matched. The `matchKey` field existed for this and I had not used it. Fixed
by splitting the `Shift+` prefix before the comparison.

## Verified

| Gate | Result |
|---|---|
| Parity test | **4 passed** |
| Kill-test 1 (duplicate key) | **failed** as intended |
| Kill-test 2 (retail collision) | **failed** as intended |
| Kill-test 3 (unwired action) | **failed** as intended |
| `verify-bundle-parity` | 0 missing keys |
| FTL orphan lint | OK |
| `tsc` / `eslint` (my files) | 0 / 0 |
| Full UI suite | 12,678 passed |