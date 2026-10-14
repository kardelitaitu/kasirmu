# The table release confirmation is unreachable in the current fixture (round 192)

## What was attempted

Round 189's numbers put the tables screen at 2/17. The most valuable uncovered behaviour there
is the DESTRUCTIVE edge: releasing an OCCUPIED table, which the screen guards with two
confirmations (`TableManagementScreen.tsx:1048` release, `:1083` delete).

A spec was written for the release path. **It could not be made to pass, and the reason is a
finding rather than a selector to fix.**

## The finding

The release confirmation is gated on TWO conditions (`:1129`):

```ts
if (selected.status === 'occupied' && activeBill) {
  setShowReleaseConfirm(true);
} else {
  void statusAction(selected);   // releases on ONE click
}
```

`activeBill` comes from `getTableBill(t.name)`. Probing the seeded floor plan:

```
TILES=[... 5 x tables-table--occupied tables-table--circle, 1 x tables-table--available ...]
HAS_BILL=0
```

**Five tables are occupied and none carries a bill.** The `--has-bill` modifier the confirmation
depends on never appears, so on this fixture an occupied table releases on a single click and the
confirmation the spec targeted is unreachable.

## Why that is worth recording rather than working around

The spec was written to assert a SAFETY property — one click is not enough to release a table
with a live tab. With no seeded bill that property cannot be exercised, and a spec written to
pass anyway would have asserted the one-click path while claiming to test the guarded one.

**That is round 186's hazard in a worse form: not a wait on the wrong signal, but an assertion
on a branch the fixture cannot reach.**

Deleting the spec was the honest outcome. It is recoverable the day the fixture seeds a bill.

## Three selector errors on the way, all mine

| Invented | Actual |
|---|---|
| `.tables-action-btn` | the buttons live in `.tables-detail-actions` with no per-button class |
| any occupied tile | the confirmation needs an occupied tile WITH a bill (`:1129`) |
| `aria-checked` on the cash-kick switch (round 179) | the same guessing habit |

The habit is consistent and worth naming: **writing a selector from the shape it ought to have
instead of reading the markup.** Two of this session's largest time sinks were this.

## What would unblock it

Seeding a held cart against a seeded table in the dev-mock's tables fixture, so `getTableBill`
returns a bill for at least one occupied table. That is a fixture change with its own blast
radius — the floor-plan counts, the section badges and round 177's live probe all read the same
seed — so it belongs in a round that can verify those together, not bolted onto this one.

## Verified

| Item | Result |
|---|---|
| Probe | HAS_BILL=0 across 6 tiles, 5 occupied |
| Spec | removed, not left failing |
| Probe spec | removed |
| Tree | no source changed; git status shows only other lanes' known entries |