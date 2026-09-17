-- 20261001_sale_idempotency.sql
--
-- Tenant-scoped idempotency guard for POST /api/v1/sales.
--
-- The sales request body carries no payment method and no client reference,
-- so the Idempotency-Key header is the only carrier for a retry signal. This
-- table binds a client-supplied key to the sale that key created, so a replay
-- resolves to the ORIGINAL sale instead of writing a second one.
--
-- Contract the columns encode:
--   * The key is opaque. Nothing parses, normalises or hashes it; matching is
--     exact equality only, and the server never mints a key itself.
--   * Absent, empty and whitespace-only are all UNGUARDED. Those rows store
--     NULL, and NULL is distinct in a SQL unique index in both engines, so it
--     never matches: unbounded unguarded sales per tenant stay legal, and a
--     blank key can never collapse into a synthetic value such as an empty
--     string or a ':0' suffix form.
--   * Scoped by (tenant_id, key), never by key alone. This is the shared
--     multi-tenant Postgres surface, so tenant A must neither resolve nor
--     block tenant B's key. idx_payments_idempotency_key on payments is the
--     tenant-blind precedent this index deliberately does NOT reuse.
--   * Request content is never a deduplication input. Two identical baskets
--     thirty seconds apart on one terminal are two legal sales while their
--     keys differ or are absent, which is why no index here covers any
--     amount, sku or timestamp.
--
-- Why a UNIQUE index rather than a table PRIMARY KEY: a PRIMARY KEY would
-- imply NOT NULL on key in Postgres (SQLite tolerates NULL in a rowid-table
-- PK, Postgres does not), and NULL is exactly the value the unguarded path
-- must store. No FOREIGN KEY on sale_id: the winning claim is inserted before
-- the sale it guards exists, so an FK would reject the claim itself.
--
-- RLS: joins RLS_TABLES in scripts/generate-pg-migration.py, not RLS_EXEMPT.
-- Both write paths stamp tenant_id from the authenticated token's own claims
-- on every INSERT, so the policy WITH CHECK cannot strand a legitimate write.
-- Date-ordered after the registry tail (20260930); it touches no column of any
-- existing table, so it is order-independent by construction.

CREATE TABLE IF NOT EXISTS sale_idempotency (
    tenant_id  TEXT NOT NULL DEFAULT 'default',
    key        TEXT,
    sale_id    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_idempotency_tenant_key
    ON sale_idempotency(tenant_id, key);

CREATE INDEX IF NOT EXISTS idx_sale_idempotency_sale
    ON sale_idempotency(sale_id);
