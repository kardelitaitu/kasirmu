-- 20260904_kds_indexes.sql
-- Query-path indexes for the KDS board and the maintenance daemon.
--
-- 1. received_at: cleanup_old_kds_orders and replay_kds_orders_since both
--    range-scan received_at, and the kitchen queue orders by received_at.
-- 2. (status, received_at): the queue's WHERE status IN (...) plus its
--    received_at ordering, and status-filtered history lists.
--
-- Neither column was indexed since 20260813_init.sql, so both paths
-- degraded linearly with ticket-history depth (compounded while the
-- maintenance daemon silently no-op'ed retention).

CREATE INDEX IF NOT EXISTS idx_kds_orders_received_at
    ON kds_orders(received_at);

CREATE INDEX IF NOT EXISTS idx_kds_orders_status_received
    ON kds_orders(status, received_at);
