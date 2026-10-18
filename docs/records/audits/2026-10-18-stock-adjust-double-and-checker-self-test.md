# The money arm was a dead end; the stock arm was not - 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 146 - status: 1 real defect fixed
     (double stock adjustment), 1 checker hardened, 3 leads refuted by reading the
     backend - branch: 0.0.41 - commits: ffffc2ebc, 625c29e7c -->

<!-- Scope: inventory / stock adjustment, per the active goal. Opened from round 145
     ranked carry-forward list of three "no dedupe" leads. -->

## The three ranked leads: one real, two refuted

Round 145 ranked three candidates by consequence. Working them in that order, the backend
answered two of them before any test was written - which is the point of asking the
question first.

1. `handleConfirmVoid` -> `voidSaleScoped` - **REFUTED**. `void_sale` is a compare-and-set:
   `UPDATE sales SET status = 'voided' ... WHERE id = ?2 AND status = 'active'`, and
   `rows == 0` returns `CoreError::Conflict` (sales_lifecycle.rs:903-914). There is even a
   dedicated test, `void_sale_refuses_a_second_void_and_writes_no_extra_audit_row`
   (sales_tests.rs:792). The write is safe; only the UI error surface is exposed.

2. `GiftCardPayment.handleApply` / `IssueGiftCardModal.handleSubmit` - **REFUTED**.
   `redeem_gift_card` carries an **explicit idempotency** on `(card_id, sale_id)`, returning
   the existing transaction rather than double-deducting, with a fail-closed lookup
   (`QueryReturnedNoRows` means absence, every other error propagates) -
   gift_cards.rs:330-419. `issue_gift_card` inserts on a `card_number TEXT UNIQUE NOT NULL`
   column.

3. `InventoryAdjustmentScreen.handleSubmit` -> `adjustStockScoped` - **REAL**, and fixed.

## The defect: a relative delta with nothing to replay against

An inventory adjustment is a **relative delta**, and that is what makes it structurally
different from every refused-replay case:

    // crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs:259-271
    let movement_id = uuid::Uuid::now_v7().to_string();
    tx.execute("INSERT INTO stock_movements (id, item_id, location_id, delta, reason, ...)")
    ...
    let new_qty = current_qty + delta;    // no key to replay against

`new_qty = current_qty + delta` with a **fresh** movement id per call. A stock-transfer
*receive* is idempotent by difference (validated `received_qty >= previous_received_qty`,
crediting only the delta - stock_transfers.rs:654-661), and a stock-count *complete* is a
compare-and-set. An adjustment is neither: there is no natural key and no status
predicate, so two submissions credit the quantity twice.

Consequence: a silent stock gain or loss that only a physical count catches - and which
then feeds the **next** adjustment arithmetic, because `current_qty` has already moved. A
double-submitted +5 becomes +10, and the operator reason text ("received delivery") is
written twice on two movement rows, so the audit trail shows a plausible history rather
than an error.

## The checker was hardened rather than left as found

`scripts/check-reentry-guards.py` was missing what its round-201 predecessor has, so both
were added:

- **A `--self-test`** with four cases, including the one that matters most: a *ref-guarded*
  handler must NOT be reported even though it is otherwise identical. Round 145 shipped a
  fix with the check but not the set; a matcher that only looked for the check would have
  called that guarded. All four pass.
- **A refutation record in the docstring** naming every backend protection already found,
  with file and line. Round 145 list said "check the backend"; round 146 list says what the
  backend already does, so the next round does not re-derive twelve answers.

Report mode exits 0, `--strict` exits 1 (81 candidates remain), `--self-test` exits 0.

## A third self-inflicted error, caught by the tree own gate

Adding 14 lines to `InventoryAdjustmentScreen.tsx` pushed a **pre-existing** citation out of
range: a comment at :196 cited `:157`/`:163`, which my insert shifted to `:174`/`:185`.
`featureCommentPaths.test.ts` failed, exactly as it did in round 135. Re-pointed; the gate
is green. This is the third round in a row where that test caught my own drift, which is
the best argument for its existence.

## Evidence

- **Red then green:** `expected 2 to be 1` before the guard; 10/10 in
  InventoryAdjustmentScreen.test.tsx after.
- **Kill-test:** the guard check+set removed -> red; restored **byte-identical**.
- **Refutations** are backend-sourced with file and line (void_sale CAS and its dedicated
  test, redeem_gift_card idempotency and fail-closed lookup, gift_cards.card_number UNIQUE).
- **Checker:** `--self-test` 4/4 pass, report exits 0, `--strict` exits 1, and the
  round-139 state-closure checker still reports 0 candidates (no regression).
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings - baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS, `featureCommentPaths` PASS after the citation fix.
- **Full suite:** 812 passed | 2 failed files of 814; **12928 passed** (up 1). The 2
  failures are the unchanged pre-existing cross-lane ones (nativeDialogCompliance,
  noiseDitherCompliance).

## Carried forward

The three leads round 145 ranked are closed: one real, two refuted. The checker now records
why, so the search does not restart. The remaining candidates from its 81 are, with two
exceptions, either refused-replay or settings upserts - both already documented in its
docstring. The exceptions worth a round are the ones that are **neither**:

- `StockCountForm.handleSubmit` -> `createStockCount` - a stock count mints a fresh id like
  an adjustment does, and a duplicate count is a duplicate physical-count record;
- `RestaurantMenuEditorScreen.handleSaveCategory` -> `createCategoryScoped`, and
  `CategoryManagementScreen.handleCreate` -> `createCategoryScoped` - categories have no
  unique constraint on `name`, so a double create stores two menu categories.

Both need only the question the checker cannot answer: does the backend refuse it, or does
it add up?

> last audited 18-10-26 by docs-auditor
