-- 20260901_gift_card_redeem_idempotency.sql
--
-- Add a partial unique index on gift_card_transactions(gift_card_id, sale_id)
-- for redeem transactions, closing the check-then-act idempotency gap (COR-15).
-- The loyalty earn/redeem tables have the same pattern (uq_loyalty_earn_sale,
-- uq_loyalty_redeem_sale) — this mirrors that design.

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_redeem_sale
    ON gift_card_transactions(gift_card_id, sale_id)
    WHERE txn_type = 'redeem' AND sale_id IS NOT NULL;
