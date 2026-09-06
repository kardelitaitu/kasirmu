-- 20260915_topology_revisions.sql
--
-- ADR #46 §1: append-only revision history for the topology graph. Apply already
-- maintains a monotonic `revision` inside the graph envelope but overwrites the
-- previous one, so the system had a revision NUMBER and no revision HISTORY.
-- This table makes the number mean something.
--
-- Shaped after `memo_revisions` (20260909), the repo's existing immutable-revision
-- precedent: a new row per publish, prior rows never updated.

-- No foreign key on branch_id, deliberately. `topology_setting_key` accepts any
-- merchant-supplied string that is non-empty, <=200 chars, and free of control
-- characters or '/' (persistence.rs:87) — it is NOT validated against
-- `locations.id`, so an FK would reject legitimate graphs. It is also optional:
-- the unscoped legacy path (`save_topology` with branch_id: None) is live
-- production, so this table records that graph under '' rather than NULL.
--
-- '' and not NULL is load-bearing, not cosmetic: UNIQUE ignores NULLs in both
-- SQLite and Postgres, so a nullable branch_id would let the unscoped graph
-- store the same revision number twice and silently defeat the constraint that
-- keeps history consistent.
CREATE TABLE IF NOT EXISTS topology_revisions (
    id                  TEXT PRIMARY KEY,
    branch_id           TEXT NOT NULL DEFAULT '',
    revision            INTEGER NOT NULL,

    -- Author-chosen "what changed and why" (ADR #46 §6). Optional at the UI,
    -- empty by default; this column is the difference between a list of
    -- timestamps and an actual history.
    change_note         TEXT NOT NULL DEFAULT '',

    -- The full graph envelope, byte-identical to what was written to `settings`
    -- for this revision, so a revision is self-contained and needs no
    -- reconstruction. NULL means DEFLATED (ADR #46 §4): the record of who, when,
    -- and why is kept permanently, the restorable snapshot is not. Every read
    -- path that offers a restore must check this for NULL and say
    -- "record only — snapshot pruned" rather than offering a restore that fails.
    diagram             TEXT,

    -- Workspace-diff COUNTS, not workspace rows (ADR #46 §2). Apply already has
    -- these in hand at commands.rs:272-274. They let a history row explain
    -- itself — "this Apply archived 3 workspaces" — without duplicating another
    -- table's contents or growing without bound.
    workspace_creations INTEGER NOT NULL DEFAULT 0,
    workspace_updates   INTEGER NOT NULL DEFAULT 0,
    workspace_archives  INTEGER NOT NULL DEFAULT 0,
    node_count          INTEGER NOT NULL DEFAULT 0,
    wire_count          INTEGER NOT NULL DEFAULT 0,

    -- Stored per revision because the contract schema moves (ADR #45 took it
    -- 1 -> 2). A revision written under an older version may no longer validate;
    -- §7 shows it with its reason rather than migrating it forward.
    schema_version      INTEGER NOT NULL,

    -- Pinned revisions are exempt from both pruning and deflation (ADR #46 §4).
    -- This is what makes the table a DEPLOY history rather than a scratch pad:
    -- a known-good graph stays restorable however busy the branch gets after it.
    pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),

    published_at        TEXT NOT NULL,
    published_by        TEXT NOT NULL,
    -- Stamped by the write path; NOT yet added to RLS_TABLES in
    -- scripts/generate-pg-migration.py. That mirrors memo_revisions exactly —
    -- enabling RLS is a policy decision the repo keeps separate from schema, and
    -- the generator surfaces uncovered tenant_id tables as a visible comment
    -- rather than failing (ADR #46 §9).
    tenant_id           TEXT NOT NULL DEFAULT 'default',

    UNIQUE (branch_id, revision)
);

-- The browse query is "newest N for this branch"; the UNIQUE index already
-- serves it. This partial index serves the retention sweep, which only ever
-- considers unpinned rows and must not scan pinned ones at all.
CREATE INDEX IF NOT EXISTS idx_topology_revisions_unpinned
    ON topology_revisions(branch_id, revision) WHERE pinned = 0;
