-- Scope KDS display-number counters per (day, store).
--
-- The counter was keyed by date only, so in a multi-store deployment two
-- stores' first tickets of the day collided (store B's first ticket got
-- #N where N = store A's count). Rebuild the table with a composite
-- (date, store_id) primary key. Legacy rows (no store identity) become
-- store_id = ''; their counts are preserved as the default-store counter.
--
-- The temp table is plain CREATE TABLE (not IF NOT EXISTS): it is an
-- implementation detail of the rebuild, not schema surface, and the
-- runner applies this migration exactly once (tracked by ID).

CREATE TABLE kds_daily_counters_new (
    date        TEXT NOT NULL,
    store_id    TEXT NOT NULL DEFAULT '',
    counter     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, store_id)
);

INSERT OR IGNORE INTO kds_daily_counters_new (date, store_id, counter)
    SELECT date, '', counter FROM kds_daily_counters;

DROP TABLE kds_daily_counters;
ALTER TABLE kds_daily_counters_new RENAME TO kds_daily_counters;
