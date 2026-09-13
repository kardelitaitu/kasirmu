-- 20260926_location_ticket_prefix.sql
--
-- W2-A ticket-prefix slice (D16 micro-design, todo-global-saas-3.md): a
-- per-location kitchen-ticket prefix on `locations`. '' means NO prefix —
-- and means NO inheritance either: the legal entity's statutory fiscal
-- prefix is deliberately NOT a fallback, because a fiscal re-registration
-- must never retitle kitchen tickets (D16 ruling).
--
-- # The partial unique index is tenant-keyed
--
-- `UNIQUE (tenant_id, ticket_prefix) WHERE ticket_prefix <> ''` — the same
-- cross-tenant coupling shape f4a763aca had to repair on tax_rates defaults,
-- prevented here instead of repaired: a UNIQUE (ticket_prefix) alone would
-- let tenant B's "A" refuse tenant A's "A" in the shared cloud database.
-- The WHERE clause keeps the all-empty reality of every current row out of
-- the index entirely, so the backfill is a no-op and the pre-migration
-- state (every row '') is index-legal.
--
-- v1 resolution is READ-TIME (the consumer/stamping slice owns the
-- freeze-on-ticket decision); this migration changes no code.

ALTER TABLE locations
    ADD COLUMN ticket_prefix TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX idx_locations_tenant_ticket_prefix
    ON locations (tenant_id, ticket_prefix)
    WHERE ticket_prefix <> '';
