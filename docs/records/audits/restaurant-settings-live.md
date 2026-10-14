# The restaurant settings screen, driven live: all thirteen toggles work (round 136)

## What was driven

Vite + Playwright, `owner` / PIN 1234, press `1`, sidebar -> Settings. The screen renders all
thirteen toggles with the right state, and the live pass exercised the two-key interaction
pair that round 105's F6 named.

| Toggle | Live state |
|---|---|
| Customer Name, Guest Count, Order Type Selection, Save Tab, Pre-Checkout Bill, Table Move, Kitchen Dispatch, Split Bill | on |
| Course Firing | **off** — matches its documented default (`restaurantSettingsModel.ts:60`) |
| Auto-Print Kitchen Ticket | off |
| Order Sound Notifications, Sound Feedback, Haptic Vibration | on |

## F6 verified closed, in one browser context

F6 was *"interaction prefs are stored twice and only the local copy is honoured"*. The screen
owns `restaurant.interaction_sound` / `_vibration` and mirrors them to
`pos.interaction_sound` / `_vibration`, which is what `utils/interaction.ts` reads. The mirror
runs on BOTH paths — load (`:242-243`) and save (`:358-359`, deliberately after the `await`
per P3/F5) — so a fresh device picks up the DB value.

Measured, toggling Sound Feedback OFF and Saving, then clearing only the runtime mirror and
reloading **in the same context**:

| Step | mock store `oz-dev-mock:settings` | runtime mirror | switch |
|---|---|---|---|
| after Save | `false` | `false` | — |
| after reload | `false` | `false` | `false` |

So the save persists, the load path restores the SAVED value rather than a default, and the
toggle reads it back. The write-through does what its comment says.

## The false alarm I nearly recorded

Three intermediate runs appeared to show the opposite: toggling Sound Feedback off left
`pos.interaction_sound` at `true`, and a later run reported `LS_AFTER_LOAD=true` with the switch
on — as if the mirror restored a default instead of the saved value.

Both readings were **my harness**. Each `chromium.launch()` gets a fresh browser context, so
localStorage never carried between my runs:

* the "save did not update the mirror" run had fired its `Save` click through a
  `.catch(() => {})` fallback that could swallow a miss — the corrected run clicked the real
  button and the mirror updated;
* `MOCK_RAW=null` and the `true` reading came from a context that had never seen the save at
  all. The mock's persisted map lives in localStorage (`MOCK_SETTINGS_KEY =
  'oz-dev-mock:settings'`, `settings.ts:97`), which is exactly what a fresh context discards.

The check that settled it: run the whole sequence — save, clear, reload, re-open — **inside one
context**. That is the same lesson as round 129's `PosScreen` hash and round 134's tax grep:
verify the instrument before believing a surprising result.

## The rest of the screen's keys

Checked every one of the thirteen for a reader outside the settings surface:

| Key | Read by |
|---|---|
| `customer_name`, `guest_count`, `order_type_prompt`, `save_tab`, `course_firing`, `auto_print_kitchen`, `sound_chime`, `print_bill_action`, `dispatch_on_tab_save`, `split_bill_by_item` | `PosScreen` (some also `TableManagementScreen`, `WorkspaceRestaurantPosSettings`) |
| `interaction_sound`, `interaction_vibration` | **no direct reader** — correct: the runtime reads the `pos.*` mirror, which is the F6 design and verified above |
| `table_transfer` | `TableManagementScreen` |

No key on this screen is dead. The two with no reader are precisely the two that are mirrored.

## Verified

| Item | Result |
|---|---|
| All 13 toggles render | yes, with live state |
| F6 write-through | save + load both mirror; survives a reload |
| 13 keys with a consumer | 13 (11 direct, 2 via the mirror) |
| Tree | clean but for another lane's file; scratch script deleted; Vite stopped |