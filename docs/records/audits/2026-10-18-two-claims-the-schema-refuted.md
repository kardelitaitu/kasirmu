# Two wrong claims caught by reading the schema before the UI — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 141 · status: 2 real defects
     fixed, both preceded by claims of mine that the schema contradicted · branch:
     0.0.41 · commit: `eb113b5e1` -->

<!- - Scope: restaurant POS / purchasing, per the active goal. Opened from round 140's
     carry-forward list: gift_cards, memos, loyalty, purchase_orders, suppliers,
     stock_transfers, receipt_formats. -->

## The carry-forward list was wrong twice, and the schema said so

Round 140 handed over a list of creates that "mint a UUID with no dedupe". Working it
properly meant checking the schema **first**, and the schema contradicted the list twice.

**Claim 1 — "a duplicate PO is the worst one yet: two POs for the same goods, doubling
expected stock receipt."** `purchase_orders.po_number TEXT NOT NULL` carries
`idx_purchase_orders_po_number` (`20260813_init.sql`). A duplicate PO **is refused**, so
no stock is double-expected. The claim was wrong when I wrote it; I checked the migration
before writing any test, which is why it cost no test cycle.

**Claim 2 — "`suppliers` has no UNIQUE constraint."** It does: `idx_suppliers_code ON
suppliers(code)`. So suppliers is also the refusal class, not the duplicate class.

I then enumerated **every** unique index in the schema rather than sampling, which is what
makes the conclusion usable instead of another guess:

```
idx_inv_shifts_active_per_user_location · idx_inventory_locations_name_unique
payments(idempotency_key) · purchase_orders(po_number) · idx_setting_updated_unique_version
idx_stock_thresholds_global · idx_store_profiles_primary · suppliers(code)
idx_tax_rates_single_default · users(email) · users(national_id) · users(national_id_hash)
idx_ws_inv_locations_one_primary_per_instance · uq_loyalty_earn_sale
uq_loyalty_redeem_sale · product_variants(barcode) · products(barcode)
```

And a later check across every non-init migration confirmed there is **no unique constraint
on the `customers` table itself** — only a `customer_id TEXT UNIQUE` FK *reference* on
another table. That makes `customers` the one genuinely unguarded create in the tree, which
is precisely what round 140 fixed. **The carry-forward list is now closed**: everything else
on it is refused by a unique index.

## What the fix actually was, given both are refusal-class

Neither defect is a duplicate row. Both are the **round 136/137 shape**: the second create
IS SENT, the server refuses it, and the rejection lands in the same `catch` that reports
genuine failures — so the operator sees "Save failed" for a supplier or PO that **was
created**. Measured on both: shape 3 gives `expected 2 to be 1`, meaning two IPC round
trips fire and only the second is rejected.

The important measurement is the one that separates this from the duplicate-storage class:
`calls = 2`, not 1. The button's `loading={saving}` does **not** prevent the second call
under a same-task double tap, and the handler had no guard of its own — only `saving`
state, which React commits on its next render, after the second dispatch.

## Evidence

- **Red -> green:** `expected 2 to be 1` on both `SuppliersScreen` and
  `PurchaseOrderForm` before the guards; 35/35 across both files after.
- **Kill-tests:** each guard removed individually -> red; each restored and confirmed
  **byte-identical** against a backup.
- **Schema evidence:** every unique index enumerated above, not sampled; the
  `customers`-has-no-unique check run across every non-init migration.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — baseline),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,921 passed** (up 2, the new cases). The
  2 failures are the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Why this round reads as two corrections

Both findings came with a wrong claim attached, and both were caught by the same discipline:
**read the schema before writing the test.** The claims cost nothing because I checked
before asserting them in code. That is the difference between this round and round 138,
where two suspicions went all the way to measurement before being refuted.

## Carried forward

The same-task double-tap filter now has a complete answer for the creates it can reach:
`customers` (no constraint — fixed round 140), `cash_payouts` (no constraint — fixed round
139), and everything else refused by a unique index where the **UI now suppresses the second
call** rather than reporting the refusal as a failure. The remaining unexamined surface is
not the create path at all: `MemosScreen` and `StockTransfersScreen` carry **no `saving`
state at all**, so their submits are unguarded in a different way, and neither was opened
this round.

> last audited 18-10-26 by docs-auditor
