# I was wrong about categories, and right about stock counts — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 147 - status: 1 real defect fixed
     (double stock-count create), 1 self-correction of a round-146 claim - branch:
     0.0.41 - commit: 95665c82f -->

<!-- Scope: inventory / stock counts, per the active goal. Opened from round 146 two
     carry-forward leads, both checked against the backend before any test was written. -->

## Round 146 was wrong about categories, and this round is where it surfaced

Round 146 closed by naming two leads and asserting one of them: "categories have no unique
constraint on `name`, so a double create stores two menu categories."

That is false. `categories.name` is `TEXT NOT NULL UNIQUE` (20260813_init.sql),
`create_category` maps `ConstraintViolation` to `CoreError::Conflict`
(products_categories.rs:52-60), and there is a test named for exactly this --
`create_category_duplicate_name` (products_tests.rs:614), asserting the Conflict.

The claim was not careless; it was produced the same way round 138 and 141 were refuted:
by grepping a **hand-picked list of table names**. Categories were not on that list, so the
absence of a result was read as the absence of a constraint. Two rounds have now been spent
on exactly that failure mode. The correction is written into the checker docstring with the
wrong claim named, so it is not repeated a third time, and the general lesson is recorded
there: **enumerate the schema, do not sample it.**

## The defect: the count_number being unique is why the replay is not refused

The second lead was real. `StockCountForm.handleSubmit` sets `saving` and awaits with no ref
guard, and the backend is genuinely undeduplicating:

    // crates/kasirmu-bridge/src/inventory_counts.rs:300-311
    let mut count = StockCount {
        id: uuid::Uuid::now_v7().to_string(),
        count_number: String::new(),   // filled by the next statement
        ...
    };
    store.create_stock_count_with_next_number(&mut count)?;

The UI sends only `{countType, notes}` -- no id. The bridge mints the UUID and allocates
the number **atomically inside the INSERT** (`create_stock_count_with_next_number`, by
design, so concurrent terminals cannot both reserve the same number). `stock_counts` has no
UNIQUE constraint other than the id and `count_number`, and that is the trap:
**`count_number` is unique precisely because it is freshly allocated**, so two calls produce
`CNT-001` and `CNT-002` rather than conflicting. Two real draft stock counts, nobody asking
for either, and a count number skipped for no reason.

This is the same shape as the round-146 stock adjustment, and it is worth stating why it is
not obviously the same: an adjustment is a relative delta with nothing to replay against,
while a count LOOKS keyed by its number. It is not -- the key is generated per call, which
is the one case where a UNIQUE index guarantees the duplicate instead of preventing it.

## Why the existing test was not enough

`StockCountForm.test.tsx` already had `disables buttons while saving`, which asserts the
button is disabled after one click. That is the **sequential** shape: React has committed
`saving` by the time the assertion runs. It cannot see the double tap, for the reason every
previous round established. The new case sends both clicks in one `act()` batch and is red
at `expected 2 to be 1` against the existing guard-less code, with the reason the existing
case is insufficient written into the comment so it is not mistaken for coverage.

## Evidence

- **Red then green:** `expected 2 to be 1` before the guard; 11/11 in StockCountForm.test.tsx
  after.
- **Kill-test:** the guard check+set removed -> red; restored **byte-identical**.
- **Category refutation is backend-sourced**: the UNIQUE column, the ConstraintViolation ->
  Conflict mapping, and the test that pins it are each cited by file and line.
- **Checker:** `--self-test` still 4/4; the docstring now records the category correction and
  the stock-count fix; StockCountForm, InventoryAdjustmentScreen and RefundModal have all
  dropped off its output.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings - baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS, `featureCommentPaths` PASS.
- **Full suite:** 812 passed | 2 failed files of 814; **12929 passed** (up 1). The 2 failures
  are the unchanged pre-existing cross-lane ones (nativeDialogCompliance,
  noiseDitherCompliance).

## Carried forward

Both of round 146 leads are closed: categories refuted, stock counts fixed. The remaining
checker candidates that are neither refused-replay nor settings upsert are now few, and the
way to find the rest without sampling is the lesson this round was about: enumerate every
UNIQUE constraint in the schema once, and use that as the allow-list instead of guessing at
table names. The two left from round 146 list are
`RestaurantMenuEditorScreen.handleSaveCategory` and `CategoryManagementScreen.handleCreate`
-- both `createCategoryScoped`, both now known to be refused by the UNIQUE name, so both are
refuted without a test. What that leaves is the second half of the round-145 list that was
never worked: the audit and export paths (`AuditLogScreen.handleExport`,
`handleSecurityExport`) and the `createProductVariant` / `createBundle` pair, none of which
has had its backend read.

> last audited 18-10-26 by docs-auditor
