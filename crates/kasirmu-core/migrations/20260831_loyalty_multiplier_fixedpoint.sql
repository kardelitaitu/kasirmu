-- LOYALTY-01: store the tier earn multiplier as fixed-point millionths.
--
-- `earn_multiplier REAL` corrupted the owner's intent at WRITE time: the
-- tier editor sends a decimal, the column stored the nearest f64 (1.4 →
-- 1.3999999999999999111), and the points formula
-- `round(base/100 × multiplier)` then mis-rounded every exact .5 boundary
-- (a $22.50 sale at points_per_unit=1 with a 1.4× tier earned 31 points
-- where exact decimal gives 32 — 585 such bases ≤ 2M, always downward).
-- The repo's own precedent for untrusted decimal factors is fixed-point
-- integers (`tender_rate_millionths`, `rate_millionths`): 1.4 → 1_400_000.
--
-- Backfill: ROUND(old × 1_000_000) recovers the intended decimal for
-- every multiplier with ≤ 6 fractional digits (the f64 error is far below
-- half a millionth). The seeded tiers (1.0/1.25/1.5/2.0) are exact in
-- binary and convert losslessly.
--
-- No table rebuild: the FK from loyalty_accounts.tier_id stays untouched
-- because the table is never dropped. The validation triggers reference
-- the old column, so they are dropped first and recreated below against
-- the new one (same conditions, millionths semantics: `<= 0` still means
-- "not a positive multiplier").
--
-- Postgres: intentionally NOT touched. The cloud server has no loyalty
-- code path — `loyalty_tiers` in init.pg.sql is dormant schema surface,
-- and PG_INIT is a generated artifact (scripts/generate-pg-migration.py
-- maps it from the frozen init.sql). Editing it by hand would be undone
-- by the next regeneration, exactly like the drift already present from
-- every incremental migration since 20260813.

DROP TRIGGER IF EXISTS loyalty_tiers_validate_insert;
DROP TRIGGER IF EXISTS loyalty_tiers_validate_update;

ALTER TABLE loyalty_tiers ADD COLUMN earn_multiplier_millionths INTEGER NOT NULL DEFAULT 1000000;

UPDATE loyalty_tiers
   SET earn_multiplier_millionths = CAST(ROUND(earn_multiplier * 1000000) AS INTEGER);

ALTER TABLE loyalty_tiers DROP COLUMN earn_multiplier;

CREATE TRIGGER loyalty_tiers_validate_insert
BEFORE INSERT ON loyalty_tiers
WHEN trim(NEW.name) = ''
  OR NEW.min_points < 0
  OR NEW.points_per_unit <= 0
  OR NEW.earn_multiplier_millionths <= 0
  OR length(NEW.colour) <> 7
  OR substr(NEW.colour, 1, 1) <> '#'
  OR substr(NEW.colour, 2) GLOB '*[^0-9A-Fa-f]*'
BEGIN
    SELECT RAISE(ABORT, 'invalid loyalty tier configuration');
END;

CREATE TRIGGER loyalty_tiers_validate_update
BEFORE UPDATE OF name, min_points, points_per_unit, earn_multiplier_millionths, colour
ON loyalty_tiers
WHEN trim(NEW.name) = ''
  OR NEW.min_points < 0
  OR NEW.points_per_unit <= 0
  OR NEW.earn_multiplier_millionths <= 0
  OR length(NEW.colour) <> 7
  OR substr(NEW.colour, 1, 1) <> '#'
  OR substr(NEW.colour, 2) GLOB '*[^0-9A-Fa-f]*'
BEGIN
    SELECT RAISE(ABORT, 'invalid loyalty tier configuration');
END;
