# The cash-preset chips write to a rail parameter nothing reads (round 120)

## The finding

`RestaurantPaymentsScreen.tsx:1099-1123` renders a **Cash Suggestion Presets** chip row. The
operator toggles chips and the screen persists the choice:

```ts
onClick={() => {
  const next = active ? activeCashPresets.filter(/* remove */) : [...activeCashPresets, preset];
  setActiveCashPresets(next);
  updateRailParams('cash', { presets: next });   // <- the only write
}}
```

The chip list is hardcoded at `:1102`:

```ts
['exact', '1000', '2000', '5000', '10000', '20000', '50000', '100000']
```

**Nothing reads `presets` back.** The till's quick-tender amounts come from a different
source entirely:

```ts
// PosScreen.tsx:1354-1364
const saved = localStorage.getItem('restaurant-tender-presets');   // nothing WRITES this
if (saved) { ... }
return defaultTenderPresets(activeCurrency);                        // the fallback wins
```

| Side | Location | Status |
|---|---|---|
| write | rail `parameters.presets` | happens |
| read | `localStorage['restaurant-tender-presets']` | **nothing writes this key** |
| read | rail `parameters.presets` | **does not exist** |
| show | `defaultTenderPresets(activeCurrency)` | what the cashier actually sees |

So the screen reports "All changes saved" and the chips light up, while the amounts on the
till are the currency default. An operator who deselects `100000` still gets it.

## How it was found

A live pass over the restaurant POS (Vite + Playwright, `owner` / PIN 1234, press `1` for
Restaurant POS, then the sidebar's `restaurant-sidebar-payments`). The Payments screen
rendered nine rail switches and the preset chips with "All changes saved".

The chip VALUES matched round 106's `defaultTenderPresets` ladder, which is why the
connection looked plausible. It is not a connection: `defaultTenderPresets` is the
**fallback** that shows when the localStorage key is absent, and it is always absent.

This is round 112's shape (`LocalApiSection`): a control that persists its value to a place
nothing reads. That one was a whole screen; this is one control inside a live screen, which
is the more dangerous form — the surface around it works, so nothing looks broken.

## What round 106 did and did not fix

Round 106 made the fallback currency-aware, so a USD store no longer gets
$5,000-$500,000 shortcuts. That fix is real and visible. It did **not** connect the
operator's own choice, because at the time `localStorage['restaurant-tender-presets']` was
believed to be provisioned externally — round 105 recorded that nothing in the repo writes
it, and round 106 treated the rail chips as a separate surface. They are the same setting.

## NOT fixed, and why

The honest repair is to have `PosScreen` read the rail parameter (via the rails it already
fetches at `:131`, as `PaymentModal:1392` does for `autoKick`) and drop the dead localStorage
read. That touches the money path on the till, and the two sides use DIFFERENT UNIT
CONVENTIONS:

* the chips store MAJOR units as strings (`'1000'`, plus the literal `'exact'`);
* `CashTenderPanel` wants `number[]` of MAJOR units and multiplies by `10^exp`;
* `defaultTenderPresets` returns numbers.

Deciding what `'exact'` means on that side, and whether the parameter is authoritative or a
filter over the default, is a product decision about what the cashier's buttons should be —
not a mechanical wiring fix. Making it without that decision risks changing what a cashier
can charge, on a path where round 106 already showed the consequences of guessing.

## Verified

| Item | Result |
|---|---|
| Payments screen | renders 9 rail switches, preset chips, "All changes saved" |
| Preset write | `updateRailParams('cash', { presets })` at `:1114` |
| Preset read | absent — `grep 'presets' ui/src/features/sales` finds no consumer |
| Course bar | absent live, correct: `courseFiringEnabled` unset resolves to `false` (round 105) |
| Tree | `ui/src` clean; scratch script deleted; Vite stopped |