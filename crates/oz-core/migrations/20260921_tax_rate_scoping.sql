-- 20260921_tax_rate_scoping.sql
--
-- Tax-separation P1, first slice (todo-global-saas-2.md, "Separate business
-- tax configuration from application defaults"). `tax_rates` carried exactly
-- one fact about applicability — `is_default` — which makes a tax rule an
-- APPLICATION default: one row answers for every location, every legal entity
-- and every date. A tenant with a Jakarta rate and a Bali rate, or a rate that
-- changed on 2026-01-01, cannot be modelled at all, and the only workaround is
-- to edit the single row and silently re-price history.
--
-- This migration adds the two missing axes and nothing else:
--
--   * SCOPE — `location_id` and `legal_entity_id`. Both nullable, and the
--     meaning of NULL is the whole design: a row with NEITHER set is the
--     tenant-global row, i.e. exactly what every existing row is today, so
--     this migration changes the answer for no existing tenant. A row with
--     `legal_entity_id` set applies to every location under that entity; a row
--     with `location_id` set applies to that location and outranks the entity
--     row above it. Setting BOTH is not a third, narrower scope — it is an
--     ambiguous row, and the two columns are one-or-the-other-or-neither.
--     That invariant is enforced in the type that reads it
--     (`oz_core::db::tax::TaxRateScope`, which cannot represent "both"), NOT
--     by a DB trigger: SQLite cannot add a CHECK by ALTER, and a RAISE trigger
--     here would need a hand-written plpgsql port in
--     scripts/generate-pg-migration.py's TRIGGER_MAP — the same file the
--     audit-retention slice just changed. The write-side slice that can
--     actually author a scoped row is where a DB-level guard belongs, and it
--     is recorded as owed there rather than quietly skipped here.
--   * VALIDITY WINDOW — `effective_from` / `effective_to`, both nullable.
--     `effective_from` NULL = no lower bound; `effective_to` NULL = does not
--     expire. `effective_to` is EXCLUSIVE: a rate ending 2026-01-01 stops
--     applying ON that day, so two consecutive periods cannot both match and
--     the resolver never has to break a tie between an expiring row and its
--     successor. Values are business dates, `YYYY-MM-DD`, NOT RFC3339
--     timestamps — a tax period starts on a day, and mixing the two shapes in
--     one column would make the comparison lexicographic and wrong. Shape is
--     validated where the window is read; a row whose dates do not parse is
--     SKIPPED, never trusted, because a malformed expiry is exactly the data
--     that must not decide a money question.
--
-- No new table, so no RLS decision is owed (the RLS_TABLES / RLS_EXEMPT gate
-- in scripts/generate-pg-migration.py fires only for tenant_id-bearing new
-- tables). No rate column is touched: `rate_bps` stays INTEGER basis points
-- and no float enters this table, per the currency rule.
--
-- Two indexes, both partial: the resolver's query is "rows scoped to THIS
-- location, THIS entity, or nothing", and a full index on a column that is
-- NULL for every existing row would index a constant. Partial keeps them tiny
-- today and correct when scoping is used.
--
-- Deliberately NOT this slice: no writer sets these columns yet (the write-side
-- IPC is the next slice), the sale computation path is not rewired through the
-- new resolver, and `platform/sync`'s `SnapshotTaxRate` /
-- `crates/oz-core/src/sync_pull.rs::upsert_tax_rates` still carry an explicit
-- column list WITHOUT the four new ones. That last point is a live hazard for
-- the next slice, not a cosmetic gap: a scoped row pulled from the hub would
-- land with NULL scope and therefore read as tenant-global at the branch —
-- a Jakarta rate silently applied everywhere. Sync must carry the scope (and
-- the window) before any scoped row is allowed to exist.

ALTER TABLE tax_rates
    ADD COLUMN legal_entity_id TEXT
    REFERENCES legal_entities(id) ON DELETE RESTRICT;

ALTER TABLE tax_rates
    ADD COLUMN location_id TEXT
    REFERENCES locations(id) ON DELETE RESTRICT;

ALTER TABLE tax_rates
    ADD COLUMN effective_from TEXT;

ALTER TABLE tax_rates
    ADD COLUMN effective_to TEXT;

CREATE INDEX IF NOT EXISTS idx_tax_rates_scope_location
    ON tax_rates(location_id)
    WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tax_rates_scope_entity
    ON tax_rates(legal_entity_id)
    WHERE legal_entity_id IS NOT NULL;
