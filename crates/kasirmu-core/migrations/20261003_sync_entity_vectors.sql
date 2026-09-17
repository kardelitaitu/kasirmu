-- 20261003_sync_entity_vectors.sql
--
-- Server-side version vector per synced entity — the state a push is compared
-- against to decide whether it is causally ordered or concurrent.
--
-- Why this table has to exist: concurrency is a property of a PAIR of
-- mutations, not of one. A pushed item carries its own vector, but "is it
-- concurrent with what we already have?" cannot be answered without
-- remembering what we already have. `sync_conflicts` records the outcome of
-- that comparison; this table is the input to it.
--
-- Contract the columns encode:
--   * `vector` is a JSON-serialised `crdt::VersionVector`, not a scalar
--     counter. Two terminals that each advanced only their own counter are
--     CONCURRENT, and no scalar can express that — storing one here would
--     silently downgrade every genuine conflict into an ordered update.
--   * The PRIMARY KEY is (tenant_id, entity_type, entity_id), so there is
--     exactly one vector per entity per tenant and the write path is a single
--     upsert with no read-modify-write race. A surrogate id would allow two
--     rows for the same entity, and then "the stored vector" would be
--     ambiguous.
--   * Scoped by tenant_id in the key itself, not merely in an index: the
--     lookup is always tenant-scoped by construction, so a missing WHERE
--     clause cannot leak another tenant's state.
--   * No FOREIGN KEY anywhere — this table references an entity by type and
--     id only, and the referenced rows live in whichever table that type
--     names. An FK is not expressible and would be wrong.
--
-- Deliberately NOT carrying a payload: this table answers "what have we
-- seen", not "what was seen". The bodies live in `offline_queue` and, once a
-- conflict is flagged, in `sync_conflicts`.
--
-- RLS: joins RLS_TABLES in scripts/generate-pg-migration.py. Every write path
-- stamps tenant_id from the authenticated token's own claims, so the policy
-- WITH CHECK cannot strand a legitimate write.
-- Date-ordered after the registry tail (20261002); it creates a new table and
-- touches no column of any existing one, so it is order-independent by
-- construction.

CREATE TABLE IF NOT EXISTS sync_entity_vectors (
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    vector      TEXT NOT NULL,
    -- Last body seen for this entity. Kept so the field-wise merge policy can
    -- tell whether two concurrent customer edits touched the same fields;
    -- without it every such comparison would have to be answered "overlap"
    -- and every profile conflict would need a human. Not a payload store of
    -- record: `offline_queue` remains that.
    last_payload TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, entity_type, entity_id)
);
