# The tables tab-conflict pair: seam confirmed, route not finished (round 279)

## What round 278's lesson implied

`tables-tab-conflict-banner` and `tables-tab-takeover-btn` were carried as blocked alongside their
cart-panel twins — "needs a second terminal" — and round 278 disproved that for the twins. The same
reasoning applies here, so this round tested it.

## What was established

**The seam is the same one, and it is the same hook.**

```tsx
// TableManagementScreen.tsx:1205
const conflictLease = getConflict(activeBill.id);
```

`getConflict` is `useTabLeases`, whose lease store is a module-level object and whose only external
write path is the `kasirmu:tabs:lease-acquired` DOM event. So the tables screen is reachable the
same way **provided an `activeBill` exists** — and that is where the route stands.

**The floor plan IS reachable after a till flow.** Measured: `TILES_WITH_SHEET=12` both with the
cart sheet open and after closing it, so `Shift+L` works in either state and the navigation is not
the obstacle.

**`activeBill` needs a held cart whose LABEL matches the selected table** —
`getTableBill` (`:152-157`) matches through `matchesTableBill`, so the bill and the tile are joined
on the label, not on an id the spec could invent.

## Where the route stalled

The spec dispatched an open bill at **table 1** and then looked for that tile. It failed to find
it — and the page snapshot showed the till, not the floor plan, which means the failure was in the
bill-creation step and not in the tile lookup.

**The likely cause is in the seed and was measured here:** table 1 is already `OCCUPIED`

```
LABELS=["6p|Table 1|OCCUPIED", "4p|Table 2|OCCUPIED", …, "6p|Table 6|AVAILABLE", …]
```

so a dispatch aimed at it lands on a table that already has state, and the seeded held carts are
not necessarily labelled the way the till would label a fresh one. **The next attempt should target
`Table 6` — the first `AVAILABLE` tile — and read the held cart back by label before selecting the
tile**, which is the read-back discipline round 278 used and this round's draft omitted at the
tile-selection step.

## A second measurement worth keeping

A tile's text is MULTI-LINE:

```
"6p\nTable 1\nOCCUPIED"
```

so `/^Table 1$/` matches nothing. The filter must be a substring on the name — a small trap that
cost this round one run, and the same class as round 269's selector that resolved without addressing
the intended element.

## Verified

| Item | Result |
|---|---|
| The tables banner uses the same `getConflict` | confirmed at `:1205` |
| The floor plan is reachable after a till flow | **TILES_WITH_SHEET=12** |
| Tile text shape | multi-line; an anchored filter matches nothing |
| The incomplete spec | removed — nothing unproven was committed |
| Source changed | none |
| New tests | zero |
| Probes | 3, all removed |

## The state of the two blockers round 276 named

| Blocker | State |
|---|---|
| the cart-panel conflict pair | **covered (278)** |
| the tables conflict pair | seam confirmed, route one step short |

**Neither turned out to need a second terminal**, which was the claim carried for four rounds. The
remaining work is a route, not a wall — and the next round starts from `Table 6`.

> last audited 15-10-26 by docs-auditor