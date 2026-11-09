# A hypothesis I had to downscale, and an assertion that was vacuous

**Round 38 · 2026-10-11 · restaurant POS · credit settings load failure**

Closing round 37's two honestly-unresolved sites in `StockShortfallDialog`.

## Both turned out correct, and my grep was wrong again

Round 37 flagged `:272` and `:386` as possibly-unreported. Read in context, both report:

- **`:272`** — `console.warn` is followed at `:273` by
  `setError(requiredLocalized(l10n, 'pos-toast-auth-required'))`, and the comment at
  `:265-271` says so explicitly (*"Reported to the CASHIER, not just the console"*).
- **`:386`** — `console.error` comes *after* `setError(msg)` at `:385`; `error` renders at
  `:593-594` in a `role="alert"` div.

The enumeration used a ±6-line window and did not look for `setError`. Widened to ±10 and
including `setError`, the class shrank from 6 sites to **2** — neither of which round 37 had
claimed. **Third round running** that a window-based grep produced false positives; the
pattern finds candidates, reading decides.

## The hypothesis I had to downscale

`PaymentModal:379` — a failed `getCreditSettingsScoped` leaves `creditSettings` null, and
every credit guard is written on the settings being PRESENT:

```ts
creditSettings?.enabled === false                                   // :1218
creditSettings && creditSettings.maxLimitMinor > 0 && …             // :1219
method === 'credit' && creditSettings?.enabled === false            // :2464
method === 'credit' && creditSettings && …                          // :2471
```

So the ceiling check and both warnings are skipped. My first reading was *"the credit
ceiling silently fails open — a money-risk hole"*.

**Then I checked whether the ceiling is enforced anywhere else, and it is.**
`crates/kasirmu-core/src/db/sales_checkout.rs` re-checks it, and I ran the tests:

```
test db::sales::sales_checkout::tests::credit_checkout_rejects_when_credit_facility_is_disabled ... ok
test db::sales::sales_checkout::tests::credit_checkout_enforces_max_credit_limit_ceiling     ... ok
test result: ok. 2 passed; 0 failed
```

So **no bad sale can be recorded**, and the defect is smaller than I first claimed: the
cashier can select credit, sees no ceiling hint, and only meets the refusal at settle — the
readable-error path the frontend warnings exist to pre-empt. Real, worth fixing, and not a
money hole. The record says so rather than overstating it.

**Fixed** with a `creditSettingsFailed` flag set in the catch, and a distinct notice when
credit is selected. A new string in both bundles:

```
payment-credit-settings-unavailable = Credit settings could not be loaded - the store's
                                      credit limit could not be checked.
```

## The assertion that was vacuous

My first version asserted `/credit/i` over `document.body.textContent`. **It passed on the
bug** — the tender radio is always labelled "Credit", so the regex matched regardless of
whether any warning rendered. Tightened to read `.payment-credit-warning` specifically:

```
a failed credit-settings read left the credit tender UNWARNED: expected '' to match /credit/i
```

That is the round-22 lesson recurring: a failing-first test that is green is evidence about
the assertion before it is evidence about the code.

## Verification

| Check | Result |
|---|---|
| warning disabled (kill-test) | -> **red**, `UNWARNED` |
| backend ceiling tests (re-run) | **2 passed** — the ceiling IS enforced |
| `PaymentModalSaleFlow.test.tsx` | **66 passed** (1 new) |
| credit + payment sweep (4 files) | **97 passed** |
| ESLint / typecheck / `lint:i18n` | clean (after escaping an apostrophe ESLint caught) |

## Still open

`PaymentModal:1465` (cash drawer auto-kick) is the last site in the class. It is genuinely
non-blocking and the cashier sees the physical result — the drawer either opens or it does
not — so silence is defensible; `pos-toast-drawer-unconfirmed` exists if it ever needs one.
Recorded as a judgement call, not left unexamined.

## Method notes

- **Check the whole system before sizing a finding.** "The frontend skips the ceiling" was
  true and "the ceiling is unenforced" was false; the backend catches it. Reading only the
  layer where the defect was found would have produced a severity claim I could not support.
- **A widened grep window changes the candidate list.** The same pattern at ±6 and at ±10
  lines (plus `setError`) went from 6 candidates to 2. Treat any window-based enumeration as
  a starting point.
- Assert on the element a fix creates, not on text that is present either way.

> last audited 16-10-26 by docs-auditor
