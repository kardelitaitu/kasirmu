-- PLANNED (stubs): payment gateway configuration + settlements ledger.
-- Both tables are tenant-scoped for cloud RLS parity.
--
-- 1. Payment gateways — per-store gateway credentials/configuration so the
--    PaymentProcessorRegistry can construct the right processor at runtime
--    without hard-coded env vars. One row per (tenant, gateway name).
CREATE TABLE IF NOT EXISTS payment_gateways (
    id           TEXT PRIMARY KEY,          -- UUID v7
    tenant_id    TEXT NOT NULL DEFAULT 'default',  -- RLS tenant scope
    name         TEXT NOT NULL,             -- 'stripe' | 'square' | 'midtrans' | 'paddle'
    is_active    INTEGER NOT NULL DEFAULT 1,
    config_json  TEXT NOT NULL DEFAULT '{}', -- gateway-specific keys (api key, sandbox flag, …)
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_payment_gateways_tenant
    ON payment_gateways(tenant_id, is_active);

-- 2. Payment settlements — reconciliation ledger: one row per settled
--    batch/deposit from a gateway, so the daily reconciliation job can
--    match expected vs actual funds.
CREATE TABLE IF NOT EXISTS payment_settlements (
    id           TEXT PRIMARY KEY,          -- UUID v7
    tenant_id    TEXT NOT NULL DEFAULT 'default',  -- RLS tenant scope
    gateway      TEXT NOT NULL,             -- 'stripe' | 'square' | 'midtrans' | 'paddle'
    batch_id     TEXT NOT NULL,             -- gateway settlement/batch reference
    settled_at   TEXT,                      -- ISO-8601 when the gateway settled
    expected_minor INTEGER NOT NULL DEFAULT 0, -- expected amount (minor units)
    actual_minor   INTEGER NOT NULL DEFAULT 0, -- actual deposited amount (minor units)
    currency     TEXT NOT NULL DEFAULT 'USD',
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'matched', 'discrepancy', 'reconciled')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_settlements_tenant
    ON payment_settlements(tenant_id, gateway, status);

CREATE INDEX IF NOT EXISTS idx_payment_settlements_batch
    ON payment_settlements(tenant_id, batch_id);
