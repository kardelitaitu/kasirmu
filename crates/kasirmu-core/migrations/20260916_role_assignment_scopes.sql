-- 20260916_role_assignment_scopes.sql
--
-- ADR #47 slice 1 (ruled 2026-09-07, all five recommendations adopted):
-- add the org/legal-entity/location scope axis to the existing assignments
-- model and backfill every existing row to `organization`.
--
-- Relationship to ADR #35 D5 (spec 0048): the pre-existing branch/workspace
-- dimensions stay exactly as they are — this migration only ADDS the
-- hierarchical scope columns the ADR names. `scope_type = 'organization'`
-- is the same meaning as ADR #47's org-wide assignment; `legal_entity` and
-- `location` rows are representable from this migration onward but no
-- caller creates them yet (fail-closed resolution arrives with the choke
-- point slice, and per-location assignment creation arrives with its own
-- IPC/UI slice).
--
-- Backfill rule (ADR #47 ruling 5): every existing assignment becomes
-- org-wide, preserving today's behavior bit-for-bit — no capability is
-- revoked by this migration. Legacy rows (spec 0048's `scope_mode =
-- 'global'`) and scoped rows alike resolve as organization-wide; the
-- narrowing happens only when per-location assignments are deliberately
-- created by a later slice.

ALTER TABLE assignments ADD COLUMN scope_type TEXT
    NOT NULL DEFAULT 'organization'
    CHECK (scope_type IN ('organization', 'legal_entity', 'location'));

-- The resource the scope names. NULL is valid only for `organization`
-- (the org-wide row has no single resource); legal_entity/location rows
-- must name their entity/location id. Enforced by CHECK + trigger rather
-- than a rebuild, mirroring the tender-currency migration's pattern for
-- adding invariants to a live table without rewriting it.
ALTER TABLE assignments ADD COLUMN scope_id TEXT;

CREATE TRIGGER IF NOT EXISTS trg_assignments_scope_id_pair
AFTER INSERT ON assignments
WHEN (NEW.scope_type = 'organization') != (NEW.scope_id IS NULL)
BEGIN
    SELECT RAISE(ABORT,
        'assignments: scope_id must be NULL exactly when scope_type is organization');
END;

CREATE TRIGGER IF NOT EXISTS trg_assignments_scope_id_pair_update
AFTER UPDATE OF scope_type, scope_id ON assignments
WHEN (NEW.scope_type = 'organization') != (NEW.scope_id IS NULL)
BEGIN
    SELECT RAISE(ABORT,
        'assignments: scope_id must be NULL exactly when scope_type is organization');
END;

CREATE INDEX IF NOT EXISTS idx_assignments_scope
    ON assignments (scope_type, scope_id);
