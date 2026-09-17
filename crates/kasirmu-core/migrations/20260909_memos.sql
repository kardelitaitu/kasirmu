-- 20260909_memos.sql
--
-- Memo lifecycle (Phase 2 P1): Organization Memos (owner/admin, all
-- registered terminals) and Location Memos (owner/admin/manager, one
-- location), with author-chosen duration, immutable published revisions, and
-- per-terminal delivery/acknowledgement tracking.
--
-- The CHECK constraints mirror the `kasirmu_core::memo` domain enums so a bad
-- state can never be persisted even if a writer bypasses the store; the
-- store validates transitions before they reach here. `expires_at` is stored
-- denormalized (derived from published_at + duration by the domain model) so
-- the expiry sweep can use the partial index without recomputing per row.

CREATE TABLE IF NOT EXISTS memos (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    -- NULL => Organization Memo (all locations); set => Location Memo.
    location_id     TEXT REFERENCES locations(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_memos_tenant_status
    ON memos(tenant_id, status);

-- Expiry sweep scans only live memos by their deadline.
CREATE INDEX IF NOT EXISTS idx_memos_expiry
    ON memos(expires_at) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_memos_location
    ON memos(location_id);

-- Immutable published revisions: an edit after publish inserts a NEW row and
-- bumps memos.revision; prior revision rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS memo_revisions (
    id            TEXT PRIMARY KEY,
    memo_id       TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    revision      INTEGER NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    published_at  TEXT NOT NULL,
    published_by  TEXT NOT NULL,
    UNIQUE (memo_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_memo_revisions_memo
    ON memo_revisions(memo_id);

-- Per-terminal delivery + acknowledgement. Independent of the memo's own
-- lifecycle: a Published memo may still have Pending recipients (offline
-- terminals). user_id NULL => terminal-wide (any user at that terminal acks).
CREATE TABLE IF NOT EXISTS memo_recipients (
    id               TEXT PRIMARY KEY,
    memo_id          TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    terminal_id      TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    user_id          TEXT,
    delivery_status  TEXT NOT NULL DEFAULT 'pending'
                     CHECK (delivery_status IN ('pending','delivered','acknowledged')),
    delivered_at     TEXT,
    acknowledged_at  TEXT,
    acknowledged_by  TEXT,
    UNIQUE (memo_id, terminal_id)
);

CREATE INDEX IF NOT EXISTS idx_memo_recipients_memo
    ON memo_recipients(memo_id);

CREATE INDEX IF NOT EXISTS idx_memo_recipients_terminal
    ON memo_recipients(terminal_id, delivery_status);
