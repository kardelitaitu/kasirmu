# A defect with two call sites, and the one that was left behind - 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 149 - status: 1 real defect fixed
     (the SECOND call site of the statutory-invoice double issue), plus the first coverage
     this screen ever had for that path - branch: 0.0.41 - commit: 39bdd10e8 -->

<!-- Scope: sales / sales history, per the active goal. Opened from round 148 own
     carry-forward, which named this exact handler as the un-fixed half. -->

## Why this round existed at all

Round 148 fixed the statutory double-issue on the receipt surface
(PaymentModal.handleIssueTaxInvoice) and its record finished by naming the other half:

    SalesHistoryScreen.handleIssueTaxInvoice still has the same defect. The receipt path
    is fixed; the history path is not, and it was left untouched because its harness was
    missing the two mocks that make it reachable.

It was a one-round job, and this is that round. Worth writing down because the general
pattern is now three rounds old: a defect found on one surface has to be checked on every
other surface that reaches the same write, and the only thing that makes that cheap is
saying so in the record rather than trusting a grep for the call name.

## The harness was missing, which is why the path was invisible

SalesHistoryScreen.test.tsx mocked @/api/sales with seven names and NOT the two this handler
calls: issueTaxInvoiceScoped and getSaleStatutoryNumberScoped. With no mock the vi.mock
factory returns undefined for them, so handleIssueTaxInvoice threw on its first line and no
test could reach the button behind it.

The result is a screen with 44 other cases and ZERO coverage of its statutory-invoice
surface -- the highest-consequence write on it, and the one writing to a legally numbered
series. That coverage gap is worth more than the guard it just earned, and it is the second
time this session that a missing mock hid a whole path (the first was
createCashPayoutScoped, recorded in the same file header at :31-37).

## The defect, and what the fix shares with round 148

Same handler shape, same backend, same consequence: setIssuingInvoice(true) then await with
no ref guard, so a real double tap reaches the write twice; and issue_tax_invoice_for_sale
is idempotent only AFTER commit, because its own guard reads a column the same transaction
sets. Two issues in one tick both fall through to claim_statutory_number_for_sale and the
statutory sequence advances twice.

The difference from round 148 is the button: ReceiptPreview cross-disables Skip and Print on
issuingTaxInvoice, while this screen renders the button with loading={issuingInvoice} only
(SalesHistoryScreen.tsx:1941). Same STATE mechanism underneath, so the fix is the same ref
guard -- but the receipt surface at least made its intent mutual-exclusion explicit in the
markup, and this one did not.

## Evidence

- Red then green: expected 2 to be 1 before the guard; 45/45 after.
- Kill-test: the guard check+set removed -> red; restored byte-identical from a backup.
- Gates: npm run lint PASS (0 errors, 113 warnings - one fewer than the 114 baseline,
  because an unused import in the file was fixed en route), npm run typecheck PASS,
  npm run lint:i18n PASS, featureCommentPaths PASS.
- Full suite: 812 passed | 2 failed files of 814; 12931 passed (up 1). The 2 failures are
  the unchanged pre-existing cross-lane ones (nativeDialogCompliance,
  noiseDitherCompliance).

## Carried forward

The statutory double-issue is now closed on both surfaces. What this round leaves behind is
the harness gap rather than the missing guard, and it suggests a cheap sweep this session
has not run: for each vi.mock factory, does the module export a name the factory omits? An
omitted export is not an error -- it is a silently unreachable path, and it has now hidden
two of them (createCashPayoutScoped, and these two invoice calls). That check is a script,
not a round, and it is the most valuable thing left to build.

> last audited 18-10-26 by docs-auditor
