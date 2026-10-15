# The tables tab-conflict route: the regex was not the bug (round 280)

## What the round started from

Round 279 established the seam (`getConflict` at `:1205`) and named the two steps: target
`Table 6` (the first AVAILABLE tile, since `Table 1` is OCCUPIED in the seed) and read the held cart
back by label. It also recorded a trap: a tile's text is MULTI-LINE (`"6p\nTable 6\nAVAILABLE"`), so
an anchored `/^Table 6$/` matches nothing.

## The label, measured

A dispatch at table 6 stores exactly the tile's text:

```json
{"id":"held-mock-87544cc1-...","label":"Table 6",...}
```

So round 279's plan was right: **the label IS the join key**, and `matchesTableBill` joins on it.

## Two things were wrong, one of which was assumed

The first was a genuine authoring bug. `new RegExp('Table ' + TABLE + '\\b')` written into the
source file produces `\b` — a **literal backslash and `b`**, not a word boundary. Replaced with a
negative lookahead, `Table 6(?!\d)`, which is what the trap actually needs: not matching
`Table 10` when looking for `Table 6`.

**The second is the one worth recording: the regex was never the bug.** After fixing it the case
still failed with the same shape — `.tables-table` not found. The container is absent, not the
match.

## The evidence, and the contradiction

| Run | State |
|---|---|
| probe, no dispatch | `TILES=12` |
| probe, WITH dispatch then `Shift+L` | `TILES=12`, `HAS_TABLES=true` |
| the spec, same sequence | `.tables-table` **element(s) not found** |

**Two runs of the same navigation disagree**, and the probe is the one that sees tiles. That is
round 226's rule: **an empty reading is evidence about the instrument.** The failing measurement
is the spec, not the screen.

What differs between them is everything that happens BETWEEN the dispatch and the tile lookup:
the `heldBillId` `localStorage` read and a `page.evaluate`, both performed against a page the
dispatch may have re-rendered underneath them.

This is the class round 251 recorded: **a mid-transition measurement.** The dispatch is
asynchronous (`holdCartScoped` then `loadOpenBills`), so the store is still landing while the spec
reads it.

## Verified

| Item | Result |
|---|---|
| The held label | measured `"Table 6"` — the join key round 279 predicted |
| The `\b` bug | real, fixed with a negative lookahead |
| The remaining failure | `.tables-table` absent; a probe of the same navigation finds 12 |
| The incomplete spec | removed — nothing unproven was committed |
| Source changed | none |
| New tests | zero |
| Probes | 3, all removed |

## The next round's first step, precisely

Split the route into two stable halves instead of one chain. The till half — dispatch a bill at
`Table 6` — is proven. The floor-plan half is proven to render those tiles. **What is unproven is
the join: that the tables screen's `openBills` read sees the cart the till just wrote.**

So the next step is to reload after the dispatch (`page.reload()`), which re-reads the store the
same way a fresh session would, and only then press `Shift+L`. If the tiles appear after a reload,
the cause was a mid-flight read and the case is two waits away from passing; if they do not, the
cause is in how the floor plan reads held carts, and THAT is a real finding about the screen.