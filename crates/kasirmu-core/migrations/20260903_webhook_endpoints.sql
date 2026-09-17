-- 20260903_webhook_endpoints.sql
--
-- Registry for outbound webhook endpoints (cloud surface only; the
-- desktop local API does not deliver webhooks).
--
-- Delivery reuses the transactional `outbox` table (ADR #43 D7): the
-- sync-push handler fans accepted queue items out to every active
-- endpoint whose `events` list matches the item's action, enqueuing one
-- `webhook` outbox entry per (item, endpoint) pair. The outbox drainer
-- POSTs each entry with an HMAC-SHA256 signature header, retrying with
-- exponential backoff and dead-lettering after `max_attempts`.
--
-- Design:
-- - `events` is a JSON array of queue actions ("complete_sale",
--   "stock.adjusted", …) or ["*"] for everything.
-- - `secret` is a per-endpoint hex key used only for payload signing;
--   it is returned once at registration and never listed in plaintext.
-- - `tenant_id` scopes endpoints per cloud tenant (mirrors the
--   offline_queue tenancy model).

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    url         TEXT NOT NULL,
    secret      TEXT NOT NULL,
    events      TEXT NOT NULL DEFAULT '["*"]',
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_tenant
    ON webhook_endpoints(tenant_id, active);
