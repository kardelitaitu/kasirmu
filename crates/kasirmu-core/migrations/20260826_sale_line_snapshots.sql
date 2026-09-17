-- 20260826_sale_line_snapshots.sql
-- REP-05 (rewrite half): freeze product identity on sale lines.
--
-- sale_lines stored only the sku, so reports joined the MUTABLE
-- products table: renaming a product, moving it between categories,
-- or deleting it and reusing its sku silently relabelled historical
-- revenue. New rows snapshot product_id / product_name / category_id
-- at sale creation; reports read the snapshot first and fall back to
-- the join for legacy rows.
--
-- The backfill is best-effort: legacy rows are labelled from the
-- CURRENT products table (the same guess the join fallback makes —
-- freezing it now at least makes history stable from here on).

ALTER TABLE sale_lines ADD COLUMN product_id TEXT;
ALTER TABLE sale_lines ADD COLUMN product_name TEXT;
ALTER TABLE sale_lines ADD COLUMN category_id TEXT;

UPDATE sale_lines SET
    product_id   = (SELECT p.id          FROM products p WHERE p.sku = sale_lines.sku),
    product_name = (SELECT p.name        FROM products p WHERE p.sku = sale_lines.sku),
    category_id  = (SELECT p.category_id FROM products p WHERE p.sku = sale_lines.sku)
WHERE product_id IS NULL AND product_name IS NULL AND category_id IS NULL;
