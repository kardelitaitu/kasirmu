-- CUR-02: record tender-currency metadata on the sale when multi-currency
-- checkout is used. `base_currency` / `base_total_minor` record the original
-- sale currency and total (before conversion), and `tender_rate_millionths`
-- captures the fixed-point rate used. All three are NULL for single-currency
-- sales (the common case), so existing rows are unaffected.
ALTER TABLE sales ADD COLUMN base_currency TEXT;
ALTER TABLE sales ADD COLUMN base_total_minor INTEGER;
ALTER TABLE sales ADD COLUMN tender_rate_millionths INTEGER;