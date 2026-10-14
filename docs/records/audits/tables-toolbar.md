# The tables toolbar and the verb its state decides (round 219)

## Why this round

The tables screen sat at 7 of 17. Rounds 193-196 covered its destructive edges (release,
delete, move, merge) and round 177 drove the floor plan live; what was left is the TOOLBAR and
the detail-panel actions.

## What the spec pins — 6 passed, both projects

| Case | Asserts |
|---|---|
| the legend toggle | the key starts hidden, the toggle reveals it, and a second press hides it — a toggle, not a one-way reveal |
| arrange mode | a plain tap opens the table detail; in arrange mode **the same tap does not** |
| the assign button | a table WITH a tab reads "Resume Tab / Order"; a FREE one reads "Select for Order" |

The second is the substantive one. `openDetail` is guarded by `if (arrangeMode) return;`
(`:919`, `:928`) so an operator moving furniture does not open a table every time they start a
drag. A regression there makes rearranging the room unusable, and nothing tested it.

**Kill-tested**: dropping that guard fails the arrange case. Restored byte-identical.

The third asserts a **pair**, which is what makes it bind. Checking only the billed table's label
would pass on a control hard-coded to say "Resume"; checking only the free one would pass on a
control hard-coded to say "Select". The state is what decides the verb, so both states are read.

**Kill-tested**: flattening the label to one string fails it. Restored byte-identical.

## Verified

| Item | Result |
|---|---|
| New spec | 6 passed (3 cases x desktop/tablet) |
| Kill-tests | 2, both failing the intended case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## Note on the setup

The spec seeds one open bill through `addInitScript`, the mechanism round 193 established, so
the billed-table half of the label pair is reachable. `Table 1` is the seeded label and
`matchesTableBill` binds it to the floor plan's first tile.

## Tables coverage, five rounds on

| Surface | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan live | 177 |
| release confirmation | 193 |
| delete guard | 194 |
| move a tab | 195 |
| legend, arrange mode, assign label | **219** |

Still uncovered there: `tables-print-bill-btn`, `tables-edit-table-btn`, the section badges and
the tab-conflict banner — the last of which needs a second terminal, the constraint round 216
recorded for its cart-side twin.