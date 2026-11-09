-- 20261024_refunds_analytics_index.sql
-- Expression index for the revenue report refund CTEs (revenue.rs daily/weekly/monthly).
--
-- The three report CTEs filter `DATE(refunds.created_at, ?3) BETWEEN ?1 AND ?2`
-- and group by (currency, bucket). `refunds` shipped with exactly ONE index —
-- idx_refunds_sale_id — so before this every revenue report, for any date
-- range, read the whole refunds table. Same expression-index shape as
-- 20260814_analytics_index.sql does for sales.
--
-- `currency` leads because it is the CTE's GROUP BY prefix and a constant per
-- output row (the FULL OUTER JOIN joins on (date, currency)): leading on it
-- lets SQLite use it as the equality key and walk ONE ordered range of a
-- covering index instead of a full table scan plus a temp B-tree. Column order
-- therefore mirrors the query's GROUP BY — (currency, bucket) — not the
-- reverse; the reverse order does not produce this plan (measured 2026-10-24).

CREATE INDEX IF NOT EXISTS idx_refunds_currency_created_date
    ON refunds(currency, date(created_at));

-- The shift-close / drawer reconciliation queries (db/shifts.rs) filter
-- `processed_by = ?1 AND created_at >= ?2 AND created_at <= ?3` on a BARE
-- created_at, so they need a plain column index leading on processed_by; the
-- date() expression index above cannot serve a bare range.
CREATE INDEX IF NOT EXISTS idx_refunds_processed_by_created_at
    ON refunds(processed_by, created_at);
