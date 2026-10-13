# A settings toggle that dispatches nothing, and a red guard on HEAD (2026-10-12)

## The finding

Auditing whether every `restaurant.*` setting the settings screen writes has a
READER — the F1 class the project already knows about — surfaced one with none:

| Key | Readers |
|---|---|
| `restaurant.customer_name` | CartPanel, PosScreen |
| `restaurant.guest_count` | CartPanel, PosScreen |
| `restaurant.order_type_prompt` | PosScreen |
| `restaurant.save_tab` | CartActionBar, CartPanel, PosScreen |
| `restaurant.course_firing` | PosScreen, WorkspaceRestaurantPosSettings |
| `restaurant.auto_print_kitchen` | PaymentModal, PosScreen |
| `restaurant.sound_chime` | PosScreen |
| `restaurant.interaction_sound` / `_vibration` | via the `pos.*` mirror |
| `restaurant.print_bill_action` | PosScreen, TableManagementScreen |
| `restaurant.table_transfer` | TableManagementScreen |
| `restaurant.split_bill_by_item` | PosScreen |
| **`restaurant.dispatch_on_tab_save`** | **NONE** |

The toggle (products.ftl:120-121) promises:

> *"Kitchen Dispatch on Tab Save — Send newly added items to kitchen printer and
> KDS when saving or updating a tab"*

Nothing reads the key, so saving a tab dispatches nothing. The switch is
decorative.

## It was leaving CI red

`deadSettingsKey.test.ts` already detects exactly this, and it was **failing on
HEAD**:

```
AssertionError: expected [ 'restaurant.dispatch_on_tab_save' ] to deeply equal []
```

So the split-bill feature added the toggle without a consumer, and the guard has
been red since — which is the guard working as designed, not a flaky test.

## Declared, not wired — and why that is the right call

The file header already sets the policy for this situation:

> *"wiring these three means INVENTING the features they name … That is not a
> reliability repair and should not ride in on one, so the decision stays open and
> this file records it rather than guessing."*

Wiring `dispatch_on_tab_save` means deciding: which items count as "newly added"
on an UPDATE rather than a first save; whether an offline printer blocks the save;
whether a re-save reprints. Those are product decisions, and guessing at them would
ship half-defined behaviour behind a switch that currently does nothing **at all** —
worse, because the cashier would start receiving chits.

So the key is added to `DECLARED_DEAD` with what wiring it would need, which
restores CI green and keeps the debt visible. The pin is self-removing: the second
case in that file fails the moment the key gains a reader, so the entry cannot
outlive the condition it records.

## Method note

This was found by a mechanical sweep — every key written by the settings screen,
grepped across the tree excluding the writer — rather than by reading the screen.
The same sweep is worth re-running after any feature that adds settings: it is the
cheapest way to find this class, and it found the one key the existing guard was
pointing at.


## Resolved since (re-verified 2026-10-11, docs-auditor)

This record's finding and its remedy were both correct on 2026-10-12, and the debt it
recorded has since been PAID — so two present-tense claims above are now stale:

| Claim above | State at HEAD |
|---|---|
| the toggle dispatches nothing / the switch is decorative | **FIXED.** `PosScreen.tsx:1245` reads `restaurant.dispatch_on_tab_save` via `getSettingScoped` and drives `setDispatchOnTabSave`; the reader landed in `9377011c6` (kitchen order dispatch, line delta tracking, tab auto-firing). |
| it was leaving CI red / added to `DECLARED_DEAD` | **CLOSED.** `deadSettingsKey.test.ts`'s `DECLARED_DEAD` array is now **empty** — every entry was removed as its key gained a reader, which is exactly the self-removing pin this record relies on. `restaurant.auto_print_kitchen` and `restaurant.sound_chime` were revived the same way first (rounds 57/58), as that array's own comments record. |

The reasoning the record sets out is what the guard is FOR: it declined to invent the
feature behind a dead toggle, recorded the debt, and the pin failed the moment the real
reader arrived — forcing the entry's removal. Nothing in the record's method is retracted;
only its present-tense state is dated. The Fluent keys it names still exist at
`shared-ui/locales/products.ftl:120-121`, with the same promise text it quotes.

> last audited 14-10-26 by docs-auditor
