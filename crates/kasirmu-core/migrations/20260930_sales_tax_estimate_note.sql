-- 20260930_sales_tax_estimate_note.sql
--
-- F2-4 (T1 dossier D64 slice 4): `sales.tax_estimate_note` carries the
-- per-sale audit stamp core writes when the cart's tax is computed against a
-- non-fresh estimate (the F2 renderer-level cache). The stamp is the audit
-- trail — client claim + core-verified delta — so a sale can always answer
-- "was this tax computed live?" without re-deriving it. NULLABLE by design:
-- legacy rows are unstamped (they were computed live under the old path),
-- and a missing stamp must never read as a claim. No backfill, no default —
-- the absence IS the answer.
--
-- ORDERING RULE (binding, proven live by E1-1 / ad167c44b): never date a
-- migration before the LAST DDL WRITER of the touched table — a rebuild
-- migration's INSERT..SELECT enumerates its columns and silently ERASES
-- anything added under an earlier date. The last sales-table DDL writer is
-- 20260923_fiscal_numbering.sql (statutory_number); no rebuild of sales
-- exists in the registry, so 20260930 sorts safely after it and after the
-- registry tail (20260929). A FUTURE rebuild of sales must carry
-- tax_estimate_note through both its column lists; the migrations_tests pin
-- enforces exactly that.

ALTER TABLE sales
    ADD COLUMN tax_estimate_note TEXT;
