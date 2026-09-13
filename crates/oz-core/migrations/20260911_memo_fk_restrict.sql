-- 20260911_memo_fk_restrict.sql
--
-- Fix a data-loss bug in the Memo schema (20260909): two foreign keys used
-- `ON DELETE CASCADE` where the repo's established policy is to BLOCK a parent
-- delete rather than silently destroy dependents.
--
--   * memos.location_id        -> locations(id)  ON DELETE CASCADE  (was)
--   * memo_recipients.terminal_id -> terminals(id) ON DELETE CASCADE (was)
--
-- Deleting a Location therefore destroyed its Location Memos together with
-- their `memo_revisions` rows (the immutable audit trail that exists precisely
-- so "prior revisions are never mutated") and their `memo_recipients` rows (the
-- delivery/acknowledgement record). Deleting a terminal erased its delivery
-- history. Both contradict this feature's own promise that "stopped and expired
-- Memos remain archived for 30 days before deletion or anonymization" — a
-- Location or terminal delete bypassed the retention window entirely, and
-- because the erased rows ARE the record, nothing testified the Memo existed.
--
-- This is not a style preference. The repo already has a named, tested policy
-- for exactly this: CUST-11
-- (`delete_customer_scoped_is_blocked_by_loyalty_and_sales_references`) — a
-- parent referenced by dependents must NOT be silently deleted; the FK guard
-- (foreign_keys = ON, set on every connection path) rejects the delete. The
-- customer precedent uses a plain `REFERENCES` (NO ACTION). Of the nine FKs
-- pointing at locations/store_profiles, eight detach (SET NULL) or block
-- (NO ACTION); memos.location_id was the lone CASCADE.
--
-- Chosen remedy: RESTRICT (explicit, self-documenting; behaves like NO ACTION
-- under immediate FK enforcement). It is the only option that cannot lose data
-- by accident — SET NULL would orphan a Location Memo and risk it silently
-- displaying org-wide. Deleting a Location/terminal that still has Memos now
-- fails with a clear FK error, consistent with the existing "primary location
-- cannot be deleted" blocking guard in the same delete path.
--
-- The genuine `memo_id -> memos(id) ON DELETE CASCADE` edges (memo_revisions,
-- memo_recipients) are LEFT UNCHANGED: those are true child tables that must
-- go with their memo.
--
-- Mechanics mirror 20260831_per_tenant_unique_rebuild: SQLite cannot alter a
-- column's FK in place, so rebuild the table. `PRAGMA defer_foreign_keys`
-- (settable inside the runner's transaction, unlike foreign_keys) lets each
-- parent DROP + RENAME proceed while memo_revisions/memo_recipients reference
-- memos; the deferred check at COMMIT passes because every referenced row is
-- copied. Indexes belong to the table, so each rebuild recreates its full set.
-- The feature is unreleased and the tables are empty, so the copy is a no-op in
-- practice but is written to preserve any rows in a DB that already has them.

PRAGMA defer_foreign_keys = ON;

-- ── memos: location_id CASCADE -> RESTRICT ─────────────────────────────
CREATE TABLE memos_new (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    -- NULL => Organization Memo (all locations); set => Location Memo.
    -- RESTRICT: a Location that still has Memos cannot be deleted (they are
    -- its audit trail); see the header.
    location_id     TEXT REFERENCES locations(id) ON DELETE RESTRICT,
    author_user_id  TEXT NOT NULL,
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
    id, tenant_id, location_id, author_user_id, author_role, title, body,
    status, duration, revision, published_at, expires_at, stopped_at,
    stopped_by, created_at, updated_at
)
SELECT
    id, tenant_id, location_id, author_user_id, author_role, title, body,
    status, duration, revision, published_at, expires_at, stopped_at,
    stopped_by, created_at, updated_at
FROM memos;

DROP TABLE memos;
ALTER TABLE memos_new RENAME TO memos;

CREATE INDEX idx_memos_tenant_status ON memos(tenant_id, status);
CREATE INDEX idx_memos_expiry ON memos(expires_at) WHERE status = 'published';
CREATE INDEX idx_memos_location ON memos(location_id);

-- ── memo_recipients: terminal_id CASCADE -> RESTRICT ───────────────────
-- (memo_id -> memos stays CASCADE: a recipient row is meaningless without its
-- memo. tenant_id carried forward from 20260910.)
CREATE TABLE memo_recipients_new (
    id               TEXT PRIMARY KEY,
    memo_id          TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    terminal_id      TEXT NOT NULL REFERENCES terminals(id) ON DELETE RESTRICT,
    user_id          TEXT,
    delivery_status  TEXT NOT NULL DEFAULT 'pending'
                     CHECK (delivery_status IN ('pending','delivered','acknowledged')),
    delivered_at     TEXT,
    acknowledged_at  TEXT,
    acknowledged_by  TEXT,
    tenant_id        TEXT NOT NULL DEFAULT 'default',
    UNIQUE (memo_id, terminal_id)
);

INSERT INTO memo_recipients_new (
    id, memo_id, terminal_id, user_id, delivery_status, delivered_at,
    acknowledged_at, acknowledged_by, tenant_id
)
SELECT
    id, memo_id, terminal_id, user_id, delivery_status, delivered_at,
    acknowledged_at, acknowledged_by, tenant_id
FROM memo_recipients;

DROP TABLE memo_recipients;
ALTER TABLE memo_recipients_new RENAME TO memo_recipients;

CREATE INDEX idx_memo_recipients_memo ON memo_recipients(memo_id);
CREATE INDEX idx_memo_recipients_terminal ON memo_recipients(terminal_id, delivery_status);
CREATE INDEX idx_memo_recipients_tenant ON memo_recipients(tenant_id, memo_id);
