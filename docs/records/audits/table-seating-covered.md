# Seating the party, and where the reservation card actually comes from (round 241)

## What the spec pins — 4 passed, both projects

The other half of round 240's workflow: the reservation card, and Seat Guests.

| Case | Asserts |
|---|---|
| the card | the guest name is non-empty and the seating action is offered |
| seating | the action reports itself, and **the detail panel closes** |

The guest assertion is `not.toBeEmpty()` rather than `toBeVisible()` on purpose: a card that
rendered with a blank name is exactly the failure an operator would hit at the door, and
`toBeVisible()` passes on it.

**Kill-tested**: suppressing the success toast fails the seating case. Restored byte-identical.

## The three wrong models of this fixture

This took four probes and each one corrected a different assumption. Recorded because the
sequence is more instructive than any single answer:

| I assumed | The truth |
|---|---|
| the floor plan is a localStorage slice | it is a module-level literal (`floorplan.ts:63`, `tablesSnapshot()`); seeding `oz-dev-mock:tables` did nothing |
| a `reserved` STATUS renders the card | the card comes from `getTableReservation` (`:160-179`), which reads the table's **held cart** and requires a label containing `Res:` |
| any held-cart row is accepted | `loadMockHeldCarts` filters through `isMockHeldCart` (`sales.ts:210-218`), which requires `created_at` and two nullable string fields — a row missing them is **dropped silently** |

The second is the substantive correction: **status and the reservation card are separate facts.**
The mock seeds `table-10` as `reserved` with no cart, so the tile looks reserved and the card is
absent — which is why the first two attempts failed on a *visible* element rather than a wrong one.

The third is round 216's silent-filter lesson in another domain: `readSlice` validates, and a
malformed seed disappears without an error. The seed is now the exact shape
`handleConfirmReservation` writes (`:720-721`), so the test exercises the real parser.

## Why the label is not a shortcut

The seeded label is `Table 10 · Res: Siti (19:30) [4p]`, and `getTableReservation` parses the
guest, the time and the party size back **out of that string**. Seeding the label therefore runs
the production parser, including `matchesTableBill`'s `\btable\s+10\b` word-boundary rule
(`tableLabel.ts:81-107`) — the one that exists so `Table 2` cannot match `Table 20`.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed on the toast |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Tables coverage, the workflow now end to end

| Step | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan, release, delete, move, merge | 177, 193-195 |
| toolbar, arrange, assign | 219 |
| edit form + prefill | 220 |
| Print Bill | 221 |
| **reserve** | **240** |
| **seat** | **241** |

Reserve → card → seat is now covered at both ends. What remains on that screen is the section
badges and the tab-conflict banner (which needs a second terminal — the round-216 constraint,
unchanged for six rounds).