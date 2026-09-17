-- 20261002_sync_conflicts.sql
--
-- Durable record of sync mutations that diverged concurrently and could not
-- be merged automatically, so a manager can review them instead of the merge
-- silently discarding one side.
--
-- Contract the columns encode:
--   * `local_vector` / `remote_vector` are JSON-serialised version vectors
--     (crate platform-sync, `crdt::VersionVector`). A single scalar clock
--     would be wrong here: two terminals that each advanced only their own
--     counter are CONCURRENT, and no scalar comparison can say so. The vector
--     is the whole reason this row exists, so it is stored in full rather
--     than reduced to a number.
--   * `local_payload` / `remote_payload` are the untouched JSON bodies. This
--     table never interprets them, and in particular never sums them: gift
--     card redemption and other money movements are deliberately NOT additive
--     and are recorded for human review instead.
--   * `severity` is CHECK-constrained to the three levels the review UI
--     filters on, so a typo cannot create a fourth, unreachable bucket.
--     high  = money and inventory;  medium = customer profile;  low = catalog.
--   * `status` starts at 'open'. `resolution`, `resolved_by` and
--     `resolved_at` stay NULL until a manager resolves the row; a resolved row
--     without all three would be an audit gap, so they are written together.
--   * Scoped by tenant_id on every index. This is the shared multi-tenant
--     Postgres surface: tenant A must never see tenant B's conflicts, so no
--     index here is tenant-blind.
--
-- No money column exists in this table by design — payloads are opaque JSON
-- and every monetary amount inside them is already in `*_minor` integer form.
-- The migration column-type lint therefore has no float to reject.
--
-- RLS: joins RLS_TABLES in scripts/generate-pg-migration.py. Every write path
-- stamps tenant_id from the authenticated token's own claims, so the policy
-- WITH CHECK cannot strand a legitimate write.
-- Date-ordered after the registry tail (20261001); it creates a new table and
-- touches no column of any existing one, so it is order-independent by
-- construction.

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL DEFAULT 'default',
    entity_type       TEXT NOT NULL,
    entity_id         TEXT NOT NULL,
    local_terminal_id TEXT NOT NULL,
    local_vector      TEXT NOT NULL,
    remote_vector     TEXT NOT NULL,
    local_payload     TEXT NOT NULL,
    remote_payload    TEXT NOT NULL,
    severity          TEXT NOT NULL
                      CHECK (severity IN ('high', 'medium', 'low')),
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'dismissed')),
    resolution        TEXT,
    resolved_by       TEXT,
    resolved_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant_status
    ON sync_conflicts(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant_severity
    ON sync_conflicts(tenant_id, severity);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity
    ON sync_conflicts(tenant_id, entity_type, entity_id);
