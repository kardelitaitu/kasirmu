-- 20260919_regional_configuration.sql
--
-- Regional configuration Slice 1 (todo-global-saas-2.md §"Regional
-- configuration — design"): the schema half of the market anchor.
--
-- §H scopes regional facts across Organization -> Legal Entity -> Location and
-- §K sequences the rollout as "organization region and legal-entity tax/fiscal
-- settings, then location overrides". The Legal Entity level had NO regional
-- columns at all, and the Location level was missing exactly one axis
-- (`locale`), so the inheritance chain had nothing to read at two of its three
-- scopes. This migration adds those columns and nothing else:
--
--   * `legal_entities.country_code` is the MARKET anchor (ISO-3166 alpha-2)
--     that fiscalization, numbering and local-payment settings key off in
--     later slices. It is deliberately NOT named `region` and it is NOT data
--     residency: residency is where the data is STORED (an organization-level
--     deployment decision, todo-global-saas-3.md §K, still
--     decided-not-implemented per docs/security/data-residency-and-retention.md),
--     market is how it is TRADED. The two must not collapse into one column.
--   * `legal_entities.{locale,timezone,currency}` are the entity-level
--     defaults a Location beneath it inherits.
--   * `locations.locale` is the location override for the one axis the
--     location row did not carry (`currency` and `timezone` already exist
--     there).
--
-- '' means "not set at this scope, inherit from the scope above" — the same
-- convention `legal_entities.legal_name` / `tax_id` already use, so no NULL
-- sentinel is invented and no existing writer has to change. The resolver in
-- `oz_core::regional` is what turns that convention into an effective value;
-- nothing reads these columns through any other path.
--
-- No new table, so no RLS decision is owed here (the RLS_TABLES / RLS_EXEMPT
-- gate in scripts/generate-pg-migration.py fires only for tenant_id-bearing
-- tables). No index either: every read is by primary key through the
-- already-indexed join `idx_locations_legal_entity`.
--
-- Deliberately absent: any tax column. The adjacent P1 box "Separate business
-- tax configuration from application defaults" owns `tax_rates` scoping and
-- changes money math on every sale; this one changes none. Sharing a migration
-- between the two would make a locale change block a tax review.

ALTER TABLE legal_entities
    ADD COLUMN country_code TEXT NOT NULL DEFAULT '';

ALTER TABLE legal_entities
    ADD COLUMN locale TEXT NOT NULL DEFAULT '';

ALTER TABLE legal_entities
    ADD COLUMN timezone TEXT NOT NULL DEFAULT '';

ALTER TABLE legal_entities
    ADD COLUMN currency TEXT NOT NULL DEFAULT '';

ALTER TABLE locations
    ADD COLUMN locale TEXT NOT NULL DEFAULT '';
