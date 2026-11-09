# The split arithmetic is exact for every total it can actually receive — and I measured
# where that stops being true (round 301)

## What this round went after

Rounds 294-300 worked the tables/held-cart path. This round moved to the other half of a
restaurant service — checkout — and specifically the **split-tender arithmetic**, because money
rounding is where a silent error costs real rupiah.

`distributeEvenly` (`payment/splitDistribution.ts`) is the pure function behind Split Evenly:
integer minor units in, decimal literals out, residual on the LAST row only.

## It is genuinely well built, and the doc says why

The module header records the float bug it exists to prevent — *4,450,001 divided by 2 became
2,225,001 + 2,225,002 = 4,450,003, one unit MORE than the sale* — and the test file carries the
right kind of evidence: a **property sweep** over totals 1-401 x counts 1-7 x exponents {0,2},
asserting `sumLiterals(lits) === total` exactly, plus literals read back from a live browser pass.

That is the correct way to pin money arithmetic, and it survived inspection unchanged.

## The measurement, and what it found

The sweep starts at `total = 1`. **It never tests a negative total**, so I probed that domain
directly rather than assuming it was covered:

```
total=-1 count=2 -> ['-1','-2']  summed = -3   (expected -1)
total=-100 count=3 -> ['-34','-34','-35'] summed = -103
```

The function is **not total-preserving for negative totals**. `Math.floor` rounds negatives toward
-infinity and `%` keeps the dividend's sign, so the residual is *subtracted* from the last row
instead of added. The error is a whole `count` minor units.

⚠️ **And my first reading of the probe was wrong.** The initial run reported mismatches for
*every* negative case at exponent 2, including ones that were actually correct — because my re-sum
helper lost the minus sign on the fractional part. I fixed the helper and re-measured before
concluding anything. The numbers above are from the corrected run. This is the third round where
a probe's own setup was the first thing to doubt, and it is worth stating every time.

## Then I checked reachability, which is what decides whether this matters

A wrong result nothing can produce is not a defect. Both routes are closed:

| Route | Why it cannot go negative |
|---|---|
| the sale total | `useTenderMath.ts:96` clamps: `base - discount >= 0n ? base - discount : 0n` |
| cashier-typed split amounts | `useTenderMath.ts:170`: `if (parsed < 0) return 0n` |

And `distributeEvenly` has exactly **two** production callers, both in `PaymentModal`
(`:1148`, `:1166`), both fed by the clamped total.

**So this is a latent property, not a live defect** — and saying so is the point. Reporting it as
a money bug would have been wrong.

## What was actually changed, and why not the arithmetic

The arithmetic is **unchanged**. Two additions:

1. **The domain is named in the module doc**, with the measurement, the formula, and both
   reachability arguments — so the next reader does not have to re-derive any of it.
2. **A pinning case** asserts the limit *with its size* (`sum === total - count`) rather than
   merely "not equal", so if the arithmetic is ever fixed the number changes and says so.

Changing money arithmetic that no caller can exercise would be the riskier edit, and it would
have removed a fact worth keeping.

## Kill-tested: the pin is real, and the fix is known-good

Fixing the negatives (`Math.trunc` + `remainder = total - base * count`) was injected to check the
pin discriminates:

```
Tests  1 failed | 9 passed (10)
```

The pinning case reds; the nine positive cases — including the whole sweep — still pass. **That
does two jobs at once**: it proves the pin is not a tautology, and it verifies the replacement
arithmetic is correct for the positive domain, so whoever needs it has a tested fix rather than a
sketch. Restored; `git diff` on the function shows only comments.

## Verified

| Item | Result |
|---|---|
| `splitDistribution` suite | **10 passed** (was 9 — the pinning case added) |
| Kill-test (sign-correct arithmetic injected) | **1 failed / 9 passed** — the pin discriminates |
| Payment / money suites | **387 passed, 24 files, 0 failed** |
| `npm run typecheck` | exit 0 |
| eslint | 0 |
| Source behaviour changed | **none** — comments and a test only |
| Commit | `d838f6cb0` |

## The method note

This is the second round in a row to produce a documented limit rather than a defect (round 300
audited the guards and cleared them). Both are worth keeping, and both are the same discipline: the
question is not *"is this code correct"* but **"which inputs can reach it, and is it correct on
those"**. A property test with a sweep is excellent — and its sweep had a lower bound that hid a
whole half of the domain. The bound was not wrong; it was simply never stated, and the first thing
to check about any exhaustive-looking test is where it starts and stops.

> last audited 15-10-26 by docs-auditor
