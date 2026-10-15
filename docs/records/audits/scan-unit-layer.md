# Half the "missing" ids are unit-asserted, and the scan only read e2e (round 275)

## The question this round asked

Round 274 closed the instrument line. This round re-derived coverage and took the largest
remaining behavioural item — `add-custom-rail-card`, the only payments id with no e2e selector use.

**It turned out to be asserted by a unit test** (`RestaurantPaymentsScreen.test.tsx:823`,
`expect(...).toBeInTheDocument()`), which drove the obvious follow-up: how many more?

## Measured: 12 of 24

The scan's `covered` and `used` columns read `ui/e2e` **only**, while the report is titled
"restaurant coverage" — so a screen reads as having gaps a unit test already asserts.

```
screen        covered   used   unit  none
payments      20/32   20/32     7    5      <- 7 of its 12 "missing" are unit-asserted
receipts      12/15   12/15     1    2
settings      10/12   12/12?    1    1
editor        19/21   19/21     0    2
tables        19/21   19/21     2    0
CartPanel      7/10    7/10     1    2
```

**Not a small correction: half the remaining number.**

## What changed, and what did not

Two new columns, and the existing ones untouched:

| Column | Meaning |
|---|---|
| `covered` / `used` | **unchanged** — e2e reference / e2e selector use |
| `unit` | how many of that screen's missing ids a unit test asserts |
| `none` | how many NOTHING asserts anywhere — the number to act on |

Reported as a third and fourth column rather than folded into `used`, because **the two layers
answer different questions**: e2e proves a control works in a browser with the real shell; a unit
test proves the logic with the shell mocked. The e2e number stays comparable across rounds.

**Total ids nothing asserts: 12 of 24** — and that is the actionable remainder, not 24.

## The floor, and the mistake it caught immediately

The first floor summed `unit_asserted` across rows — ids that are **both** missing-from-e2e **and**
unit-asserted. **That is 12 on a healthy tree, and the floor fired on a healthy run.**

```
REFUSING TO REPORT: the unit measure found only 12 asserted ids.   ← healthy input
```

A guard that fails on healthy input is worse than none: it gets raised until it stops
complaining. Fixed to measure the **corpus** (533 distinct ids asserted across the unit suite) at a
floor of 100, and re-kill-tested: pointing `UNIT_DIR` at a path that does not exist refuses with
`found only 0 asserted ids` and exits 1.

## Verified

| Item | Result |
|---|---|
| The scan | exit 0, self-test passes, both floors hold |
| Kill: `UNIT_DIR` broken | refuses, exit 1 |
| Kill: floor on intersection instead of corpus | **fired on healthy input — reverted by design** |
| Full UI suite | 12,716 passed |

## What this makes of the screen reports

Every remaining "missing" id is now classified into one of four groups, each with a reason:

| Screen | `none` | Class |
|---|---|---|
| payments | 5 | Midtrans/Stripe field plumbing; the credential boundary and both checks are covered |
| receipts | 2 | static chrome — back button, header |
| settings | 1 | static chrome — back button |
| editor | 2 | static chrome — title, icon |
| tables | 0 | — (its 2 unit-asserted ids are the second-terminal pair) |
| CartPanel | 2 | `pos-cart-conflict-alert` + takeover — a second terminal, blocked by architecture |
| CartLineItem | 0 | — |

**Twelve ids across seven screens, and not one of them is an uncovered behaviour**: ten are chrome or
field plumbing, two need a second terminal, and the id that started the round is asserted by a unit
test.
That is the strongest statement this goal's objective has been reduced to, and it now says so with a
number the instrument can defend.