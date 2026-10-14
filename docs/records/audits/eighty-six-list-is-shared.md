# The 86 list IS shared across terminals; the note said it was not (round 151)

## The finding

`RestaurantMenu.tsx:58-79` carried a storage-tiers comment whose `unavailable` entry was
**stale in the direction that matters** — it told a reader the restaurant's 86 list is
terminal-local and the gap is unresolved:

> *Tier 2 — localStorage only: `pinned`, `colors`, `unavailable`, `pop` … never sent to the
> server, so they do NOT follow the user across terminals. `unavailable` is the odd one out:
> it is an operational flag (86 an item), so a waiter marking an item unavailable on one
> terminal does not propagate to the others, which looks more like a gap than a choice.*
>
> *This split is recorded in code but is NOT backed by an ADR or product decision — treat it
> as unresolved rather than settled.*

**The sharing had since been built, in the same file, and the note was never updated.** The
code around it says the opposite:

| Evidence | Where |
|---|---|
| *"The remote is now authoritative; localStorage below becomes a write-through cache"* | `:270-278` |
| `unavailableSettingKey = restaurant.unavailable.<locationId>` | `:226` |
| the fetch effect rehydrates from it and flips `unavailableLoadedRef` | `:281-316` |
| the write effect pushes through `setSettingScoped`, gated on that ref | `:488-489` |
| *"86'd items from another terminal appear within seconds of refocusing"* | `:318-320` |

## Measured in the browser

Marking `Es Teh Manis` unavailable through the tile's context menu produced:

```
invoke: get_setting_scoped { key: restaurant.unavailable.store-1 }
invoke: set_setting_scoped { key: restaurant.unavailable.store-1, value: [] }
invoke: set_setting_scoped { key: restaurant.unavailable.store-1, value: ["LATTE"] }
SERVER_SETTING = restaurant.unavailable.store-1 = ["LATTE"]
```

Two localStorage keys are also written — `restaurant-staff-1-unavail` (per user) and
`restaurant-loc-store-1-unavail` (per location) — and one tile gained
`restaurant-card--disabled`. The early `[]` write is the gate working: it lands before the read
resolves, then the real value follows.

So **§F5 is closed by implementation** and the residual is latency (the visibility re-poll),
not scope.

## Why a stale comment is worth a round

This one is load-bearing: a reader deciding whether to build cross-terminal availability would
find an authoritative-looking note saying it is unimplemented and marked unresolved. The same
note is what round 150's own record quoted before this round corrected it.

It is also the second time in two rounds that **a node in the file was stale and the code
around it was right** — round 150's `MenuItemTile.tsx:14` named its pinning suites, and this
one named a tier the code had outgrown.

## Changed

The comment now records: `unavailable` is not Tier 2; the server key, the fetch and write
effects and the load gate; the visibility re-poll; and the measurement above. The Tier 2 list
is down to `pinned`, `colors`, `pop`, which genuinely never leave the device.

No behaviour changed — the diff is comments only.

## Verified

| Gate | Result |
|---|---|
| comment-only diff | 24 insertions, 12 deletions, all `//` |
| `RestaurantMenu.test.tsx` | 60 passed |
| Full UI suite | 12,670 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |
| other `M` files | 10 verified as line-ending artefacts, not content |