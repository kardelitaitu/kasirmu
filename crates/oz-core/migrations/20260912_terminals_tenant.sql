-- 20260912_terminals_tenant.sql
--
-- Add a `tenant_id` column to `terminals` so "each Terminal belongs to one
-- Organization" (canonical hierarchy, Phase 1 P0) becomes representable and
-- enforceable. Until now tenancy existed only transitively through a nullable
-- `bound_location_id → locations.tenant_id`, so an unbound terminal belonged
-- to no tenant at all and no CHECK/FK/RLS/test could pin Organization
-- ownership. This also unblocks the Memo Organization fan-out, which is
-- blocked at the schema layer for exactly this reason (see db/memos.rs).
--
-- Follows the 20260814_sale_lines_tenant.sql / 20260907 / 20260910 precedents:
-- NOT NULL DEFAULT 'default' preserves single-tenant store-DB semantics (the
-- desktop deployment is the 'default' sentinel by construction, and unbound
-- terminals — which Memo tests seed and expect to receive Organization
-- Memos — resolve to the default tenant instead of none).
--
-- Bound terminals are backfilled from their bound location's tenant so a
-- multi-tenant cloud database converges on the hierarchy's ownership rule;
-- unbound terminals keep the 'default' sentinel. RLS_TABLES inclusion is a
-- deliberate follow-up policy step once the cloud write path populates the
-- column explicitly (the generator's tenant-coverage tracker will now list
-- `terminals` as uncovered — the honest, visible state).

ALTER TABLE terminals ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- Backfill from the owning location (no-op while nothing is bound).
UPDATE terminals
SET tenant_id = (SELECT l.tenant_id FROM locations l WHERE l.id = terminals.bound_location_id)
WHERE tenant_id = 'default'
  AND bound_location_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM locations l WHERE l.id = terminals.bound_location_id);

-- Covering predicate for tenant-scoped terminal reads (fan-outs, listings).
CREATE INDEX IF NOT EXISTS idx_terminals_tenant
    ON terminals(tenant_id);
