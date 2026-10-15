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

> **Corrected 2026-10-14 (docs-auditor).** The `others | ≤3` row is false. Re-derived per
> file: `restaurant-modifier-groups-persist.spec.ts` has **9** `.first()` with **0** `.poll()`,
> and `restaurant-tables-live.spec.ts` has **8** with **0**. Both exceed the stated `≤3`, so the
> row cannot stand. (`grep -c '\.first()' ui/e2e/<spec>` / `grep -c '\.poll(' ui/e2e/<spec>`.)

The receipts spec was **one of three** with nine-or-more `.first()` and no polling — it did not
stand out on its own. Corrected 2026-10-14 (docs-auditor): the same shape is carried by
`restaurant-modifier-groups-persist.spec.ts` (**9** `.first()`, 0 `.poll()`) and
`restaurant-tables-live.spec.ts` (**8**, 0). A high `.first()` count with no polling is still the
shape that was failing, so the target was sound — the claim that receipts was unique was not.

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

**All four of the failures in rounds 196-198 were class selectors.** The first half holds. The
second half was wrong when written — corrected 2026-10-14 (docs-auditor):
`restaurant-receipt-preview-documents.spec.ts:40` **does** use a class selector
(`page.locator('.resto-receipt-paper')`) and asserts against it at `:41`/`:45`. So three of the
four kill-tested specs use testid addressing and the fourth uses a class, which is a weaker
distinction than the record claimed. The distinguishing factor is still not `.first()` itself —
it is addressing a shared class and then assuming the result was the element under test; the
receipts spec passes only because that class is not shared.

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

> last audited 14-10-26 by docs-auditor
