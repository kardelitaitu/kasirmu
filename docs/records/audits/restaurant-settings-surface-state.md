# Restaurant settings surface: state as measured (2026-10-13)

## Why this record exists

Rounds 47 and 48 audited the restaurant settings surface for the F1/F4 class — a
control that promises something the app does not keep — and found nothing to fix.

That is a result worth recording, because without it the next reader repeats the
sweep. Rounds 24–48 of this objective found and fixed four of these in *other*
places (the EOD export's raw English, three receipt-agreement claims, the KDS board's
resetKey, three silently-dropped payment actions), so the class is real here too —
it is simply already clear on this surface, and for specific reasons worth naming.

## 1. Every key the screen writes has a reader (F1)

`RestaurantSettingsScreen` writes thirteen `restaurant.*` keys. Each was traced to at
least one production reader, measured by walking `ui/src` (excluding `__tests__` and
`dev-mock`) and matching each key:

| key | readers |
|---|---|
| restaurant.customer_name | 2 |
| restaurant.guest_count | 2 |
| restaurant.order_type_prompt | 1 |
| restaurant.save_tab | 3 |
| restaurant.course_firing | 2 |
| restaurant.auto_print_kitchen | 3 |
| restaurant.sound_chime | 1 |
| restaurant.interaction_sound | 1 (mirrored — see below) |
| restaurant.interaction_vibration | 1 (mirrored) |
| restaurant.print_bill_action | 2 |
| restaurant.table_transfer | 1 |
| restaurant.dispatch_on_tab_save | 1 |
| restaurant.split_bill_by_item | 1 |

`ui/src/__tests__/deadSettingsKey.test.ts` enforces exactly this, and its `DECLARED_DEAD`
list is EMPTY — the three keys that once sat in it (`auto_print_kitchen`,
`sound_chime`, `dispatch_on_tab_save`) were resolved by building the readers they asked
for, and each removal is commented with the round that did it.

## 2. The one non-obvious case, and why it is not dead

`restaurant.interaction_sound` / `_vibration` read as dead under a naive search: the
writer writes `restaurant.*`, and `utils/interaction.ts` reads `pos.*`. That is the
F6 mirror, and it is a real two-way write, not a naming coincidence —
`RestaurantSettingsScreen.tsx:230-243` writes localStorage from the DB value on the
LOAD path, closing the gap the save path already closed. Its comment names the reason
(a fresh device, or a cleared webview cache, keeps the default and ignores the saved
preference) and why the write is idempotent when the key was unset.

## 3. Toggle copy is complete and bilingual

Every toggle on the screen has a `label` AND a `description`. All 23
label/description keys referenced by the screen resolve in both `products.ftl` and
`settings.ftl` (en) and their `.id.ftl` counterparts — 0 missing in either locale.

## 4. A near-miss worth recording, because it looked like a defect

`restaurant.split_bill_by_item` is read at `PosScreen.tsx:1254` and its reader count is
 1. Auditing whether that single reader actually *consumes* the value nearly recorded a
false F4: every other mention of the name lives in the settings screen or the model.

It is consumed. `PosScreen:1608` puts it in `checkoutRow`
(`splitBillEnabled: splitBillEnabled ?? true`), which flows to `CartPanel:430` and on to
`CartActionBar:211`, where it gates the Split Bill button (`splitBillEnabled !== false`).
The finding was a blind spot in a name-only search, not a defect.

## What is NOT covered by this record

Behavioural correctness of each setting — this is a wiring and copy audit only. A toggle
that is read but mis-handled (the rail-toggle class pinned in the plan) is a different
defect and is tracked there.
