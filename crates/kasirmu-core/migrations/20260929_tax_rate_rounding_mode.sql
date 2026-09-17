-- 20260929_tax_rate_rounding_mode.sql
--
-- E1-1 (owner ruling 2026-09-10: statutory rounding always wins over the
-- store preference, adopted as a per-rate column): `tax_rates.rounding_mode`
-- carries the statutory directive for THIS rate. '' = no statutory directive,
-- the store preference applies, and every existing row is unchanged - that
-- is the landed zero-behavior-change invariant. 'half_up' / 'truncate' are
-- the serde snake_case spellings of modules_tax::models::RoundingMode
-- (rename_all on the enum, mirrored by its wire_name()), so a value written
-- through core never needs a translation between storage and wire.
--
-- The file is dated 20260929 while the work is 09-10 on purpose (the
-- c3f5920cf precedent): 20260926_tax_rate_scoped_authoring.sql REBUILDS
-- tax_rates and its INSERT..SELECT enumerates the columns it copies, so a
-- column added under an earlier date would be applied and then silently
-- dropped by the rebuild. Registry order is canonical; this sorts after the
-- last tax_rates DDL writer.
--
-- A CHECK can ride a NEWLY ADDED column directly; SQLite only refuses to
-- ALTER a CHECK onto a column that already exists - the 20260928 rebuild
-- dance was for constraining document_kind, which already held data. Here
-- the pre-existing rows evaluate the CHECK against the DEFAULT '', which is
-- in the set, so the ALTER cannot fail on any data: no backfill, no rebuild.
-- No index either: the resolver reads the column off the winning rate row,
-- nothing looks rates up by rounding mode.

ALTER TABLE tax_rates
    ADD COLUMN rounding_mode TEXT NOT NULL DEFAULT ''
    CHECK (rounding_mode IN ('', 'half_up', 'truncate'));