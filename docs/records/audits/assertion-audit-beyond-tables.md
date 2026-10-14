# The surviving-assertion audit extended past the table screen — and came back clean (round 199)

## Why this round

Rounds 196-198 found **four** assertions I had written that survived removing the behaviour they
claimed to test. All four were on the TABLE screen, and all four used `.first()` or `hasText`
filters against a tile class. The obvious question was whether the same habits had produced the
same defect in my other specs.

## What the audit measured

A scan of my eight spec files for the failure SHAPES (`.first()`, `.count()`, `hasText`, and how
many used `.poll()`):

| Spec | first | count | hasText | poll |
|---|---|---|---|---|
| `restaurant-receipt-preview-documents` | 9 | 0 | 0 | 0 |
| `restaurant-menu-editor-category` | 1 | 0 | 0 | 0 |
| `restaurant-settings-cards` | 1 | 1 | 0 | 2 |
| `restaurant-add-custom-rail` | 1 | 0 | 0 | 0 |
| others | ≤3 | - | - | ≥2 |

The receipts spec stood out — **nine `.first()` and not one poll**. A high `.first()` count with
no polling is exactly the shape that was failing, so it was the first target.

## The results: four kill-tests, four correct failures

| Spec | Mutation | Result |
|---|---|---|
| receipts preview | make the kitchen branch unreachable | **failed correctly** |
| menu editor category | disable the duplicate-name rule | **failed correctly** |
| add custom rail | disable the duplicate-code check | **failed correctly** |
| settings cards | rename the persisted key | **failed correctly** |

Every file restored byte-identical to HEAD after its kill.

## What that means, stated carefully

It does **not** mean the other specs are free of the defect — four kill-tests is a sample, not a
proof, and the count itself is a weak signal: `.first()` is harmless when the locator is already
unique, which it is when a testid identifies exactly one element.

What it does establish is the useful distinction the table round was missing:

| Shape | Risky when |
|---|---|
| `.first()` on a testid selector | safe — the testid is unique by construction |
| `.first()` on a CLASS selector | risky — several tiles share the class, so `.first()` resolves to whichever comes first in the DOM |
| `hasText` on a class selector | risky — substring collisions (`Table 1` / `Table 12`) |
| `.poll()` | the tell that an assertion waits for a CHANGE rather than reading a state |

**All four of the failures in rounds 196-198 were class selectors. None of the four passing
kill-tests here uses one.** The distinguishing factor was never `.first()` itself — it was
addressing a shared class and then assuming the result was the element under test.

## Verified

| Item | Result |
|---|---|
| Kill-tests run | 4, all failed correctly |
| Source files | all restored, byte-identical to HEAD |
| Tree | no source changed this round |

## The rule this leaves

**A class selector plus `.first()` is an assertion about whichever element happens to be first.**
When the thing under test is one of several sharing a class, address it by testid, by index
captured before the action, or by a unique attribute — and prefer `.poll()` when the claim is
that something CHANGED.