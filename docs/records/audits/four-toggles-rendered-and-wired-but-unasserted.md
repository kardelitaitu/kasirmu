# Four toggles rendered and wired but asserted nowhere, and a count that said ten (round 290)

## What was counted

Round 288's method — find an interactive id no test names — widened from the seven screens
`restaurant-coverage.py` walks to every `data-testid` in the restaurant and sales features:
**143 literal ids**, each checked against the whole test corpus (unit AND e2e).

Nine are referenced nowhere. Four are the known glyphs and titles; four are section-card
`div`s whose inner `SettingRow` toggles ARE asserted; and one is a display span. **None of those
is debt.**

The fifth kind is the reason for this round — from the restaurant settings screen:

| toggle | specs | renders | tested |
|---|---|---|---|
| `setting-toggle-print-bill-action` | ✓ `restaurant.print_bill_action` | ✓ | ✗ |
| `setting-toggle-table-transfer` | ✓ `restaurant.table_transfer` | ✓ | ✗ |
| `setting-toggle-dispatch-on-tab-save` | ✓ `restaurant.dispatch_on_tab_save` | ✓ | ✗ |
| `setting-toggle-split-bill-by-item` | ✓ `restaurant.split_bill_by_item` | ✓ | ✗ |

Each has exactly **one** grep hit in the repo — its own declaration at
`RestaurantSettingsScreen.tsx:629,637,645,653`. Nothing else mentions them.

## Why the surrounding coverage did not close them

Two suites cover these keys and each stops one hop away, so the pair of them looked complete:

- `restaurantSettingsModel.test.ts` proves the KEYS and their defaults. `:103` asserts
  `fields.sort()` equals `Object.keys(DEFAULT_RESTAURANT_SETTINGS).sort()`, so all thirteen are
  pinned as correct — the model layer was never the problem.
- `restaurantToggleFailDirection.test.ts` proves the CONSUMERS read them fail-safe. Its
  `FAIL_SAFE` table names `dispatch_on_tab_save`, `print_bill_action` and `split_bill_by_item`
  explicitly and `restaurant.table_transfer` is read by `TableManagementScreen.tsx:209,212`.

Nothing crossed the CONTROL itself. `dispatch_on_tab_save` is the one that makes this worth
fixing: round 50 of the plan documents it as **deliberately implemented** in `PosScreen.tsx`
(commit `9377011c6`) after a period as a dead key, and it gated the Kitchen Display link on
table save. The control that turns it on had no assertion anywhere.

## The four were unasserted because the list stopped at ten

The render case named its toggles by hand. It asserted ten. The model, the type it feeds and the
source render **thirteen**. Four members were added to the three real places and the hand-written
list never learned — which is the same mechanism as the second finding below.

## Two tests, both derived so they cannot drift again

`RestaurantSettingsScreen.test.tsx`:

1. **`renders one toggle for EVERY setting the model declares`** — computes the toggle set from
   `RESTAURANT_SETTING_SPECS` and asserts each is on screen. A fourteenth cannot be added
   unasserted. Its kebab conversion is pinned against a known pair before being trusted, and the
   denominator (`>= 13`) stops the case going vacuous if the spec list ever empties.
2. **`writes the four formerly-unasserted toggles to their DB keys on Save`** — flips all four
   from their (true) defaults and asserts the payload, not `aria-checked`, so a broken
   `handleSave` cannot pass.

## The derivation found a real inconsistency

On its first run the derived case reported:

```
expected [ 'setting-toggle-order-type-prompt' ] to deeply equal []
```

`orderTypePrompt` does not kebab to its testid: the control is `setting-toggle-order-type`.
**Recorded as a named ALIAS in the derivation rather than "fixed" by renaming the testid** — the
id is referenced by an existing assertion, the DB key (`restaurant.order_type_prompt`) and the
field are both correct, and renaming a testid for cosmetics is a source change plus a test change
for no reliability gain. The alias map is pinned against a field that does NOT convert, so a second
irregular name cannot quietly join it.

## Second finding: the count in prose was wrong

`restaurantSettingsModel.ts:80` read *"The ten DB-backed toggles"* above a list of **thirteen**.
Corrected with the number spelled out and the reason, and with a pointer to the derived test that
now makes the array — not the sentence — the source for "how many". A count in prose is a reading
that expires the moment the list grows; the four missing toggles and this line are the same bug
measured at two layers.

## Kill-tested, both directions

| Regression | Result |
|---|---|
| Remove `testId` from the print-bill toggle | **3 failed** — render, derived, and save cases; derived reports `['setting-toggle-print-bill-action']` |
| `handleSave` writes a constant `'true'` for `dispatch_on_tab_save` | **1 failed** — `Expected "false", Received "true"`, names the key |
| Restored | `git diff` on `RestaurantSettingsScreen.tsx` **empty** — byte-identical to HEAD |

## ⚠️ And a correction to round 288's own claim

Round 288 committed `8a9356958` with **a typecheck error in it**. The new Stripe-select case read
`stripeRail!.parameters`, which is TS2532 under `strict` — `Array.find` returns `T | undefined`
and `expect(...).toBeTruthy()` does not narrow the static type.

Round 288's final table claims a green typecheck. **That claim was taken from a run made before
the test was written** and was never re-run after the commit. The suite passed, so the error was
invisible to the command round 288 did check; only `tsc --noEmit` sees it.

Fixed in this round by narrowing properly (`calls[0]?.[2] ?? []` plus `if (!stripeRail) return;`)
rather than by widening the type, and re-verified: `typecheck` exits 0.

The general lesson is the same one this plan has recorded five times, at a new site: **a gate that
was never re-run after the change is not evidence for the change.** Round 288 ran typecheck early,
made its edit, and reused the early result in the summary.

## Verified

| Item | Result |
|---|---|
| New derived render case | 1 passed |
| New four-toggle save case | 1 passed |
| Kill-test 1 (testid removed) | **3 failed**, then restored |
| Kill-test 2 (save writes constant) | **1 failed**, then restored |
| `RestaurantSettingsScreen` suite | **16 passed** |
| Restaurant/payment suites | **673 passed, 48 files, 0 failed** (was 671) |
| eslint on edited files | 0 |
| `npm run typecheck` | **exit 0** — round 288's latent TS2532 fixed |
| Source changed | 1 line: the stale "ten" comment |
| Model spec count | 13, unchanged |

## State of the objective

**Coverage**: the settings screen's toggle set is now derived from the model rather than hand-listed,
so a new toggle is asserted to exist and to persist the moment its spec is added. The nine
unreferenced ids are classified with reasons; none is debt.

**Reliability**: a settings outage or a broken `handleSave` now has a test on the wire for four
keys that gate table transfer, bill printing, kitchen dispatch on tab save, and split-by-item.

**Still not verified by e2e**: `run-e2e.mjs` requires a Docker backend and Docker Desktop is not
running on this machine, so no e2e run has been possible in this session. Every result above is
vitest-layer, which is the layer these two gaps lived in.

> last audited 15-10-26 by docs-auditor
