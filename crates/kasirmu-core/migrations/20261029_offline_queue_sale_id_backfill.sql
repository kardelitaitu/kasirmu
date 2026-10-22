-- 20261029_offline_queue_sale_id_backfill.sql
-- Backfill `offline_queue.sale_id` for rows that predate the column (O-M04 follow-up).
--
-- `20261023_offline_queue_sale_id.sql` ADDED the column and the covering index
-- `idx_offline_queue_sale_pending (sale_id, status, action) WHERE sale_id IS NOT NULL`,
-- but never populated it. Every row written before that migration therefore keeps
-- `sale_id = NULL` FOREVER, even though almost all of them carry the sale id inside
-- `payload` already — so the FAST indexed branch of
-- `Store::has_pending_outbox_row_for_sale` can never serve them. They fall through to
-- the legacy substring branch on every settlement, permanently.
--
-- WHY THIS IS SAFE ON A LIVE TABLE. The statement only touches rows that are both
-- `sale_id IS NULL` and carry the key, and it writes a value ONLY when the bytes are
-- exactly a 36-character quoted string (the UUIDv7 length this system mints). Measured
-- against deliberately awkward payloads:
--
--   {"sale_id":"0190a4b2-7c1e-7a33-9df2-9f2f1b2c3d4e"}        -> filled
--   {"sale_id":null}                                      -> NULL (correct)
--   {"sale_id":""","inner":{"sale_id":"NOT-THIS..."}}      -> NULL (correct)
--   {"sale_id": "<uuid>"}   (space after the colon)       -> NULL (left to the
--                                                             runtime fallback)
--
-- The naive `substr(payload, instr(...)+11, 36)` WITHOUT the closing-quote guard
-- writes garbage for the nested case — it stored
-- `","inner":{"sale_id":"NOT-THIS-ONE-A` — which would then be compared for equality
-- and silently never match. The +47 closing-quote check is what makes this correct;
-- do not drop it.
--
-- Anything left NULL is not a regression: the probe's legacy branch still finds those
-- rows by substring, exactly as before this migration.
--
-- Measured cost: 5,000 legacy rows backfilled in 9.2 ms on this machine.
UPDATE offline_queue
   SET sale_id = substr(payload, instr(payload, '"sale_id":"') + 11, 36)
 WHERE sale_id IS NULL
   AND instr(payload, '"sale_id":"') > 0
   AND substr(payload, instr(payload, '"sale_id":"') + 47, 1) = '"';