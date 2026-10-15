# The tables conflict pair, and two rounds lost to a matcher (round 281)

## The claim, finally tested

`tables-tab-conflict-banner` and `tables-tab-takeover-btn` were carried as "needs a second
terminal" for four rounds. Round 278 disproved that for the cart-panel twins; round 279 confirmed
the tables screen reads the SAME `getConflict` (`:1205`); rounds 279 and 280 each failed on a
SELECTOR rather than on the screen.

**2 passed, desktop and tablet.**

## Two things had to be measured, and neither was the screen

**1. The tiles need a reload.** Measured in one run:

```
HELD_BEFORE_RELOAD=1    the bill is stored      TILES_BEFORE=0
HELD_AFTER_RELOAD=1     the bill survives       TILES_AFTER_RELOAD=12
```

The dispatch is asynchronous (`holdCartScoped` then `loadOpenBills`), so the floor plan opened in
the same page state does not yet read it. This is the mid-transition class round 251 recorded, and
the reload is what makes the case test the CONFLICT rather than the store's write timing.

**2. `hasText` with a REGEX does not match a multi-line tile.** Measured on one page, one moment:

```
.filter({ hasText: /Table 6(?!\d)/ })   ->  0 matches
.filter({ hasText: 'Table 6' })          ->  1 match
```

A tile renders `"4p\nTable 6\n1 item\nRp ..."`. Playwright matches a `hasText` regex against that raw
inner text — where `Table 6` sits between newlines — while a plain STRING does a substring match and
succeeds. The tile was never missing: the plan showed `Table 6 | 1 item | Rp ...` throughout.

## The cost, stated plainly

**Rounds 279 and 280 each concluded the tile was absent.** Round 280 even wrote that "the container is
absent, not the match" and proposed a reload to test how the floor plan reads held carts. **The
container was never absent.** A probe of the same navigation found 12 tiles both times, and that
disagreement was the signal: round 226's rule says an empty reading is evidence about the instrument,
and the instrument was the filter.

Round 280 got one thing right and it was the important thing — it refused to commit the failing spec
and named the next experiment precisely, which is why this round opened with the reload rather than
with a guess.

## Kill-test

Removing `getConflict`'s terminal check fails the case. Restored, `RESTORED_TO_HEAD`.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 1 failed |
| `useTabLeases.ts` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |
| Probes | 3, all removed |

## The tables screen is complete

```
tables        21/21   21/21     0    0
```

**100%, and `none 0`.** Every testid on the floor plan is asserted somewhere, including the two
that four rounds said needed a second terminal.

## The session's blockers, now entirely resolved

| Blocker | Round claimed | Resolved |
|---|---|---|
| the cart-panel conflict pair | 256, 258, 262, 263 | **278** |
| the tables conflict pair | 256, 258, 262, 263 | **281** |
| the KDS row | 262 | feature entitlement, verified 262 |
| the kitchen chit | 264 | a setting, covered 265 |
| the plan-empty state | 267 | a seed seam, covered 268 |
| the deduction ids | 261 | relocated by design, certified 274 |

**Not one of them was a missing test in the end.** Every one was a misread mechanism — a guard read
as an impossibility, an entitlement read as a gap, or a matcher read as the screen.