-- 20260913_memo_locations.sql
--
-- Phase 3: extend Location Memos to target MULTIPLE selected locations.
--
-- The first version scoped a Location Memo with a single nullable column
-- (`memos.location_id`): NULL ⇒ Organization Memo, one value ⇒ Location Memo.
-- Multi-targeting is not a schema widening — `location_id` cannot hold two
-- locations — so the column is replaced by a join table. Zero rows in
-- `memo_locations` for a memo ⇒ Organization Memo (the empty set IS the
-- organization-wide audience); one or more rows ⇒ Location Memo targeting
-- exactly those locations. There is one source of truth for targeting, so a
-- writer cannot desynchronize a legacy column from the join rows.
--
-- Everything downstream of publish already reads the audience from
-- `memo_recipients`, not from the memo's targeting — display, acknowledgement,
-- expiry and the per-tenant filters are location-agnostic (verified in
-- todo-global-saas-3.md before this migration was written). Only the fan-out
-- query and the scope derivation ever touched the column.
--
-- FK policy inherits the 20260911 decision (CUST-11: a parent referenced by
-- dependents must not be silently destroyed):
--   * memo_locations.memo_id     -> memos(id)      ON DELETE CASCADE  — a true
--     child table: targeting rows are meaningless without their memo.
--   * memo_locations.location_id -> locations(id)  ON DELETE RESTRICT — the
--     same guard 20260911 put on `memos.location_id`: a Location whose Memos
--     still target it cannot be deleted (the Memos are its audit trail), and
--     SET NULL would orphan the targeting row and risk the memo silently
--     displaying org-wide.
--
-- Mechanics mirror 20260911 (SQLite cannot DROP a column that participates in
-- a foreign key, so rebuild `memos`): `PRAGMA defer_foreign_keys` lets the
-- parent DROP + RENAME proceed while `memo_revisions`/`memo_recipients`
-- reference `memos`; the deferred check at COMMIT passes because every
-- referenced row is copied. Indexes belong to the table, so the rebuild
-- recreates the full set — minus `idx_memos_location`, whose column is gone.
-- The feature is unreleased and the tables are empty, so the data moves are
-- no-ops in practice but are written to preserve any rows a DB already has.

PRAGMA defer_foreign_keys = ON;

-- ── 1. The join table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memo_locations (
    memo_id      TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    -- Carried from the memo (same denormalization `memo_recipients` uses) so
    -- every targeting/delivery row can prove its tenant without a join.
    tenant_id    TEXT NOT NULL DEFAULT 'default',
    PRIMARY KEY (memo_id, location_id)
);

-- Serves the parent-delete scan the RESTRICT guard performs and any future
-- "which memos target this location" read.
CREATE INDEX idx_memo_locations_location ON memo_locations(location_id);
-- Tenant-scoped reads, mirroring idx_memo_recipients_tenant.
CREATE INDEX idx_memo_locations_tenant ON memo_locations(tenant_id, memo_id);

-- ── 2. Carry existing targeting into the join table ───────────────────
-- Every pre-migration Location Memo keeps exactly its one target row; an
-- Organization Memo (NULL location_id) gets none, which is precisely the new
-- representation of "organization-wide".
INSERT INTO memo_locations (memo_id, location_id, tenant_id)
SELECT id, location_id, tenant_id
FROM memos
WHERE location_id IS NOT NULL;

-- ── 3. Rebuild `memos` without the targeting column ───────────────────
CREATE TABLE memos_new (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    author_user_id  TEXT NOT NULL,
    -- Author's role snapshot at publish time, so a later role change cannot
    -- retroactively lock the author out of stopping their own memo or grant a
    -- demoted user authority over a memo they no longer outrank.
    author_role     TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','expired','stopped','archived')),
    duration        TEXT NOT NULL DEFAULT '24h'
                    CHECK (duration IN ('12h','24h','3d','7d','30d')),
    revision        INTEGER NOT NULL DEFAULT 1,
    published_at    TEXT,
    expires_at      TEXT,
    stopped_at      TEXT,
    stopped_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO memos_new (
    id, tenant_id, author_user_id, author_role, title, body,
    status, duration, revision, published_at, expires_at, stopped_at,
    stopped_by, created_at, updated_at
)
SELECT
    id, tenant_id, author_user_id, author_role, title, body,
    status, duration, revision, published_at, expires_at, stopped_at,
    stopped_by, created_at, updated_at
FROM memos;

DROP TABLE memos;
ALTER TABLE memos_new RENAME TO memos;

CREATE INDEX idx_memos_tenant_status ON memos(tenant_id, status);
CREATE INDEX idx_memos_expiry ON memos(expires_at) WHERE status = 'published';
