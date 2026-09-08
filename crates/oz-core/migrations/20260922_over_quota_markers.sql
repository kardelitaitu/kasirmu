-- 20260922_over_quota_markers.sql
--
-- §J remediation: persisted per-resource over-quota markers.
--
-- When a tenant is downgraded (or a paid plan lapses to Free), resources
-- already created above the new tier's quota must be surfaced to the owner
-- rather than silently deleted. `Store::assess_downgrade` already computes
-- the tenant-global assessment on demand, but a *persisted* marker lets other
-- surfaces (the owner-facing remediation view, and eventually per-location
-- dims the tenant-global report cannot see) read "this resource is over/at
-- quota" without recomputing, and keeps it correct across sessions.
--
-- `persist_over_quota_markers` is a full-refresh: it deletes every row for
-- the tenant and re-inserts one row per dimension that is over quota
-- (`current > limit`, severity 'over') or at the cap (`current == limit`,
-- severity 'at'). A marker that lies is worse than no marker, so the refresh
-- runs inside a single transaction (triggered after every create/archive/
-- delete that changes a quota dimension's count, and on every
-- `get_over_quota_report` read).
--
-- Per-location dims (KDS screens, warehouses-per-location) are intentionally
-- NOT in the tenant-global report; Slice B adds sibling markers for them. The
-- `resource_type` / `resource_id` columns are wide enough to carry both
-- tenant-global dimension markers (resource_id = tenant id) and per-resource
-- markers (resource_id = the specific resource).
--
-- RLS: this table carries tenant_id but has no audited PG write path yet, so
-- it is added to RLS_EXEMPT in scripts/generate-pg-migration.py (mirroring
-- topology_revisions / memo_revisions) rather than RLS_TABLES. Enabling RLS
-- is a separate policy decision the repo keeps out of schema.

CREATE TABLE IF NOT EXISTS over_quota_markers (
    id            INTEGER PRIMARY KEY,
    resource_id   TEXT    NOT NULL,
    resource_type TEXT    NOT NULL,
    dimension     TEXT    NOT NULL,
    severity      TEXT    NOT NULL CHECK (severity IN ('over', 'at')),
    "limit"       INTEGER,
    current       INTEGER NOT NULL,
    marked_at     TEXT    NOT NULL,
    tenant_id     TEXT    NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_over_quota_markers_tenant
    ON over_quota_markers(tenant_id);

CREATE INDEX IF NOT EXISTS idx_over_quota_markers_resource
    ON over_quota_markers(resource_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_over_quota_markers_dimension
    ON over_quota_markers(dimension, tenant_id);
