# A USD store was offered a $10,000 quick-tender shortcut on a $7 sale (round 106)

## The defect

Round 105 pinned that `CashTenderPanel` treats `tenderPresets` as MAJOR units
(`denomMinor = amount * 10^exp`, `CashTenderPanel.tsx:87`) and recorded the consequence as a
product decision, on the assumption that a store could supply its own set.

**It cannot.** Nothing in the repository writes `restaurant-tender-presets` or
`retail-tender-presets` — not the app, not the ops scripts, and there is no settings field
(`quickTender`/`tenderPreset` appear only as props and locals). So the hardcoded fallback
is what EVERY store gets:

```ts
// three copies, in PosScreen.tsx:1363, RetailPosScreen.tsx:171, CashTenderPanel.tsx:84
[5000, 10000, 20000, 50000, 100000]   // MAJOR units
```

On an IDR till that is Rp 5.000 … Rp 100.000, which is right. On a USD till it is
**$5,000 … $100,000**, so a $7 sale offered a $10,000 cash shortcut. `MINOR_UNIT_EXPONENT`
(`types/domain.ts:278-281`) carries 17 currencies with explicit exponents, so a 2-exponent
store is a supported configuration, not a hypothetical.

## The fix

One currency-aware helper in `@/types/domain`, beside `minorUnitExponent`:

```ts
export const defaultTenderPresets = (currency: string): number[] =>
  minorUnitExponent(currency) === 0
    ? [5_000, 10_000, 20_000, 50_000, 100_000]   // IDR-shaped; byte-identical to what shipped
    : [5, 10, 20, 50, 100];                     // units and tens for every other exponent
```

All three call sites now use it — `CashTenderPanel` with `total.currency`, `PosScreen` with
`activeCurrency`, `RetailPosScreen` with `storeSettings.currency` — and replace the
duplicated literal with a call. The rung COUNT stays five, which is the row the panel was
built around.

`RetailPosScreen` needed the memo MOVED below its `storeSettings` declaration: the same
temporal-dead-zone problem `PosScreen.tsx:169-173` documents for its own restore effect.

## Two tests were pinning the bug

| Test | Pinned | Now |
|---|---|---|
| `PaymentModal.test.tsx:870` | `$ 10,000.00` on a `usd(700)` sale | `$ 10.00` |
| `CashTenderPanelQuickTender` (round 105's own case) | five buttons starting at `$5,000.00` | four, starting at `$10.00` |

Both were written against the broken ladder and are now correct. The second's count changes
because the $5 rung rounds up to the payable on a $7 sale and is correctly dropped — the
behaviour round 105's other cases already pin for IDR.

## Verified

| Gate | Result |
|---|---|
| `CashTenderPanelQuickTender` | 13 passed |
| `PaymentModal` | 40 passed |
| Full suite | 12,663 passed, 0 failed |
| `tsc` | 0 |

## Scope

The ladder's VALUES are a product choice. This fix makes the ladder suit the currency's
order of magnitude; it does not claim 5/10/20/50/100 is the right spread for every
business, and the consumer key remains read-only for a deployment that wants its own.
## Commit-subject correction (2026-10-13, same round)

The commit that added this file carries a MANGLED subject:

```
docs(audit): a USD till offered a ,000 shortcut on a  sale, and the fix
```

PowerShell interpolated `$10,000` and `$7` in the `-m` argument as variables and substituted
empty strings. The commit's CONTENT is correct; only its subject is wrong.

Per the repo's commit policy (`AGENTS.md` §7.3) an amend is not permitted on this shared
branch, so the correct subject is recorded here instead:

```
docs(audit): a USD till offered a 10,000-dollar shortcut on a 7-dollar sale, and the fix
```
When substituting a dollar amount into a commit subject on Windows, use a single-quoted
POWERSHELL here-string, or spell the amount out. A double-quoted `-m` with `$` in it is a
silent edit: the commit succeeds and the message loses the figure.