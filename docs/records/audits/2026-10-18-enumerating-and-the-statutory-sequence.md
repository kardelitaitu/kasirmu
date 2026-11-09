# Enumerating the schema, and a statutory sequence that advanced twice — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 148 - status: 1 real defect fixed
     (double e-Faktur issue, statutory numbering), 1 full schema enumeration - branch:
     0.0.41 - commit: e98f4e92d -->

<!-- Scope: sales / checkout receipt, per the active goal. Opened by doing the thing
     round 147 said was the fix for its own error: enumerate the schema instead of
     sampling it. -->

## The enumeration round 147 owed

Round 147 was wrong about categories because it grepped a hand-picked table list. This round
paid that debt: every `CREATE TABLE` in every SQLite migration was parsed, collecting both
**UNIQUE columns** and **CREATE UNIQUE INDEX** entries, because the second is what round 147
missed (`payments`, `gift_card_transactions`, `suppliers`, `shifts` and `loyalty_transactions`
all have no unique column and are protected by an index).

    131 tables · 98 with no unique column · 44 unique indexes

The 98 is not the finding - an index protects many of them. What the enumeration gave was an
**allow-list**: a create is only a duplicate-risk when its target table has neither a unique
column nor a unique index. Cross-referenced against the checker output, that left 24 POS-ish
candidates, most of which were already refuted by prior rounds. Two were not.

## The defect: an idempotency guard that cannot see its own transaction

`issue_tax_invoice_for_sale` has an idempotency check, and it is correct in isolation:

    // crates/kasirmu-core/src/db/fiscal.rs:572-587
    let existing = SELECT statutory_number FROM sales WHERE id = ?1 ...
    if let Some(n) = existing && !seq.prefix.is_empty() && n.starts_with(&seq.prefix) {
        return Ok(n);          // already invoiced
    }

The flaw is **what the guard reads**. `sales.statutory_number` is written by the *same
transaction* at the end (`claim_statutory_number_for_sale`). Two issues in one tick therefore
both read NULL, both fall through to the claim, and the claim is an atomic
`UPDATE document_number_sequences SET current_value = ... RETURNING current_value`
(fiscal.rs:438-455). The sequence advances **twice**.

So this is not the refused-replay class and not the duplicate-row class: the write is
idempotent *after commit* and unguarded *before* it, and the damage lands on a **legally
numbered series**. A gap or duplicate in a statutory invoice number is a compliance defect, not
a cosmetic one - which is the highest-consequence outcome this class has produced.

The receipt surface already *intended* the protection: `ReceiptPreview.tsx:249-257` cross-
disables Skip and Print on `issuingTaxInvoice` and renders the issue button with
`loading={issuingTaxInvoice}`. The markup says "one at a time"; the mechanism was state, which
commits after the second dispatch. Round 148 added the ref guard that makes the markup true.

## A wrong lead that cost nothing, and the process that made it cheap

`SalesHistoryScreen.handleIssueTaxInvoice` was the first target, on the reasoning that it was
the same handler. It was - but its test file had **no mock for `issueTaxInvoiceScoped` or
`getSaleStatutoryNumberScoped`**, so the handler threw on its first call and had never been
exercised by any test. Rather than add two mocks and drive the full history-detail chain, the
receipt surface was chosen instead: same defect, and `PaymentModalSaleFlow.test.tsx` already
had a complete settle-to-receipt flow plus an invoke harness. The edit to the history file was
reverted from `git show HEAD:` and confirmed byte-clean before moving on.

That is the round-142 lesson again - the cheap version of a wrong start is `git show HEAD:`
and a diff check, not more edits.

## Evidence

- **Red then green:** `expected 2 to be 1` before the guard; 72/72 in
  PaymentModalSaleFlow.test.tsx after.
- **Kill-test:** the guard check+set removed -> red; restored **byte-identical**.
- **Blast radius:** 7 PaymentModal suites run together = **205 passed, 1 skipped, 2 todo**. No
  regression from touching the shared modal.
- **Enumeration:** 131 tables / 98 without a unique column / 44 unique indexes, derived by
  parsing the migrations rather than grepping names.
- **Checker:** `--self-test` still 4/4; the fiscal finding is recorded in its docstring
  including the fact that the same defect still stands in `SalesHistoryScreen`.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings - baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS, `featureCommentPaths` PASS.
- **Full suite:** 812 passed | 2 failed files of 814; **12930 passed** (up 1). The 2 failures
  are the unchanged pre-existing cross-lane ones (nativeDialogCompliance,
  noiseDitherCompliance).

## Carried forward

Two things, one concrete and one not.

Concrete: **`SalesHistoryScreen.handleIssueTaxInvoice` still has the same defect.** The
receipt path is fixed; the history path is not, and it was left untouched because its harness
was missing the two mocks that make it reachable. It needs those mocks plus the same ref
guard, and it is a one-round job.

Not concrete but worth stating: the enumeration changed the *kind* of answer available. Before
this round, every lead was "does this backend refuse it?" answered one file at a time, and two
rounds were lost to wrong answers from sampling. The allow-list of unique columns + unique
indexes means the next sweep can be a cross-reference rather than a hunt.

> last audited 18-10-26 by docs-auditor
