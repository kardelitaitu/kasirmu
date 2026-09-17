-- 20260910_memo_child_tenant_id.sql
--
-- Denormalize tenant_id onto the two Memo child tables so they can be
-- tenant-filtered by predicate (SQLite) and covered by RLS (Postgres), matching
-- the repo-wide child-table convention (sale_lines, bundle_items, refunds,
-- product_activity all carry a denormalized tenant_id for exactly this).
--
-- Without it, isolation for these tables rests entirely on every caller routing
-- through `memos` — and the `idx_memo_recipients_terminal` index added in
-- 20260909 exists precisely to answer "what is pending at this terminal"
-- WITHOUT joining memos, so a tenant-unfiltered read is not hypothetical. It
-- also makes the tables invisible to the PG generator's tenant-coverage
-- tracker (which keys on the presence of a tenant_id column), so the gap would
-- never surface as debt. Adding the column makes them appear in that tracker's
-- to-do list — the honest, visible state until memos are cloud-synced and
-- added to RLS_TABLES.
--
-- The desktop deployment is single-tenant (the 'default' sentinel), so this is
-- forward-looking correctness, not a live leak; the feature is unreleased and
-- the child tables are empty, so the backfill is a no-op in practice but is
-- written for idempotent re-runs against any DB that already has rows.

ALTER TABLE memo_revisions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE memo_recipients ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- Backfill from the owning memo (no-op while the tables are empty).
UPDATE memo_revisions
SET tenant_id = (SELECT m.tenant_id FROM memos m WHERE m.id = memo_revisions.memo_id)
WHERE tenant_id = 'default'
  AND EXISTS (SELECT 1 FROM memos m WHERE m.id = memo_revisions.memo_id);

UPDATE memo_recipients
SET tenant_id = (SELECT m.tenant_id FROM memos m WHERE m.id = memo_recipients.memo_id)
WHERE tenant_id = 'default'
  AND EXISTS (SELECT 1 FROM memos m WHERE m.id = memo_recipients.memo_id);

-- Tenant-scoped reads on the child tables (the direct-read path the terminal
-- index enables) now have a covering predicate.
CREATE INDEX IF NOT EXISTS idx_memo_revisions_tenant
    ON memo_revisions(tenant_id, memo_id);
CREATE INDEX IF NOT EXISTS idx_memo_recipients_tenant
    ON memo_recipients(tenant_id, memo_id);
