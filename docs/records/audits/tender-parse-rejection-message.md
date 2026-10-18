# The parser refused `1,234` correctly — and told the cashier the wrong reason

**Round 41 · 2026-10-11 · POS tender input · misleading rejection message**

Fresh axis: money parsing at the input boundary, where a rounding or grouping bug would
be a data-integrity defect.

## The parser is sound

Every documented example of `parseMoneyInput` checks out — five IDR forms, five USD forms,
and both documented rejections (`50.5` IDR, `50.123` USD). `parseBalanceInput` simply
delegates to it, so there is one parser rather than two that could diverge.

Probing **undocumented** edge cases found one surprising result:

```
PROBE "1,234" USD -> null
PROBE "1.234" USD -> null
```

**That is deliberate and correct.** `types/domain.ts:430` reads
`(exp === 0 || multiCommaGroup)`: for a currency with decimal places, a SINGLE comma group
is not treated as a thousands separator, because `1,234` is genuinely ambiguous — 1.234
dollars in European notation or 1,234 dollars in English. Refusing rather than guessing is
the right call for money, and the condition shows it was reasoned about.

## The defect is what the cashier is TOLD

`useTenderMath` coerces an unparseable tender to `0n` in three places (`:108`, `:153`,
`:171`). That is right for the arithmetic — `sufficient` is false and Complete stays
disabled. But `CashTenderPanel.tsx:157` then rendered `payment-insufficient` = *"Insufficient
amount"*, which names the wrong problem:

```
AssertionError: an ambiguous amount was reported as merely insufficient:
  expected 'Insufficient amount' not to match /insufficient/i
```

A cashier who typed `1,234` has not tendered too little; they have typed something the
parser cannot read. "Insufficient" sends them to retype a **larger** number into a field
that will refuse it again for the same reason.

## The fix, scoped honestly

**This is a message defect, not a money defect.** No wrong sale was ever possible: the
arithmetic was already correct and Complete was already blocked. What was wrong was the
explanation, and the record says so rather than borrowing severity from the money path.

A `tenderedUnparseable` flag is derived in `useTenderMath`, threaded through the modal, and
used to choose the message. A new string in both bundles:

```
payment-tender-unreadable = Check the amount - use the store's usual thousands and decimal separators
```

A **control case** asserts a readable-but-short tender still says "insufficient", so the fix
narrows the message rather than replacing it.

## Verification

| Check | Result |
|---|---|
| message branch reverted (kill-test) | unparseable case -> **red**; control stays green |
| documented parser examples | all 12 correct, both rejections correct |
| `PaymentModalSaleFlow.test.tsx` | **69 passed** (2 new) |
| tender sweep (6 files) | **150 passed** |
| ESLint / typecheck / `lint:i18n` | clean |

Typecheck caught two leftover probe files. That is now **four rounds running** that `tsc`
surfaced something `vitest` accepted — here, scratch files that would have been committed.

## Method notes

- **A correct rejection can still be a defect in what it says.** The parser was right to
  refuse an ambiguous amount; the UI was wrong to explain it as a shortfall. Reading the
  parser and the message together is what separated them — each is defensible alone.
- **Probe the undefined behaviour, not the documented behaviour.** The documented examples
  all passed; the finding came from cases the doc block does not mention.
- Two earlier hypotheses this round were negatives (no parser divergence, no lost update in
  the dual write). Recording them took three lines each and stops the next reader re-running
  the same checks.

> last audited 16-10-26 by docs-auditor
