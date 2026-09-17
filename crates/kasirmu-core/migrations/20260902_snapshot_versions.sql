-- 20260902_snapshot_versions.sql
--
-- Per-tenant reference-data version counter (ADR #43 D2).
--
-- The snapshot cache revalidates on every TTL-expired read by comparing a
-- version stamp. Before this migration the stamp was computed by a 3-table
-- COUNT + MAX(updated_at) query on every cache miss. This table replaces
-- that with a single PK read: every product / tax_rate / user write bumps
-- `version` in the SAME transaction, and the snapshot handler reads the
-- counter instead of re-scanning the reference tables.
--
-- A tenant with no row here has never had a reference-data write through
-- the cloud API; the snapshot handler treats that as version 0 and the
-- first write (which inserts the row) makes the next revalidation see the
-- change.

CREATE TABLE IF NOT EXISTS snapshot_versions (
    tenant_id  TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
