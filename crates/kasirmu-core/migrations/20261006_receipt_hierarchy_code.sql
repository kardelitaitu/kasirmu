-- Receipt hierarchy code — per-entity index ids and the continuous receipt
-- counter. Design and decisions: docs/plans/receipt-hierarchy-code.md
-- (agreed 2026-09-18).
--
--   {loc:02X}-{term:02X}-{YYMMDD}-{staff:02X}-{seq:06}
--   01-02-260918-01-000123                         (22 chars)
--
-- WHY A CURSOR TABLE AND NOT MAX(index_id) + 1
--   An index id is an immutable badge, not "the Nth location". If location
--   02 were deleted and the next location reissued 02, every historic
--   receipt whose code says 02 would silently start resolving to a
--   different store — and with a tax number on the receipt that is
--   falsification, not a cosmetic bug. `entity_index_cursors.next_value`
--   only ever increments, so even a row deleted without a tombstone cannot
--   hand its index to the next entity.
--
--   0xFF (255) is the ceiling: two hex digits is all the format can
--   express. The allocator refuses at 0xFF rather than wrapping — a wrap
--   would reissue live codes.
--
-- No money columns and no floats.

ALTER TABLE locations ADD COLUMN index_id INTEGER;
ALTER TABLE terminals ADD COLUMN index_id INTEGER;
ALTER TABLE users ADD COLUMN index_id INTEGER;

-- Partial on purpose: NULL means "not yet allocated", and every
-- pre-existing row is NULL until the backfill runs, so an unfiltered
-- UNIQUE would collapse all of them into one conflicting group.
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_tenant_index_id
    ON locations (tenant_id, index_id) WHERE index_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_tenant_index_id
    ON terminals (tenant_id, index_id) WHERE index_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_index_id
    ON users (tenant_id, index_id) WHERE index_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS entity_index_cursors (
    tenant_id    TEXT NOT NULL DEFAULT 'default',
    entity_kind  TEXT NOT NULL
                 CHECK (entity_kind IN ('location', 'terminal', 'user')),
    next_value   INTEGER NOT NULL DEFAULT 1,   -- monotonic; never decremented, never reset
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, entity_kind)
);

-- What index_id 02 *was*, after the row is gone — the only record of a
-- retired badge, and what makes a historic code resolvable. Retained
-- forever; this table is append-only.
CREATE TABLE IF NOT EXISTS entity_index_tombstones (
    tenant_id    TEXT NOT NULL DEFAULT 'default',
    entity_kind  TEXT NOT NULL
                 CHECK (entity_kind IN ('location', 'terminal', 'user')),
    index_id     INTEGER NOT NULL,
    entity_id    TEXT NOT NULL,
    label        TEXT NOT NULL DEFAULT '',      -- name at retirement, display only
    retired_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, entity_kind, index_id)
);

-- ── Sale side ────────────────────────────────────────────────────────────
-- `sales` carried no terminal at all (20260813_init.sql:599-622) and the
-- terminal is what segment 2 of the code needs.
ALTER TABLE sales ADD COLUMN terminal_id TEXT;
ALTER TABLE sales ADD COLUMN display_code TEXT;

-- e-Faktur (plan §4.3.1). The NSFP is assigned by DJP when the e-Faktur is
-- uploaded and approved — i.e. AFTER the sale — so it is NULL until then
-- and the 17-digit number prints only once it exists. A faktur pengganti
-- keeps the NSFP and increments kode status (00 -> 01 -> 02); it does not
-- get a new number.
ALTER TABLE sales ADD COLUMN faktur_pajak_nsfp TEXT;
ALTER TABLE sales ADD COLUMN faktur_pajak_kode_transaksi TEXT NOT NULL DEFAULT '01';
ALTER TABLE sales ADD COLUMN faktur_pajak_status TEXT NOT NULL DEFAULT '00';

-- Continuous per (terminal, fiscal year). Keyed on the terminal alone
-- because the series is continuous: a terminal re-bound to another
-- location must carry on counting rather than restart. No collision
-- results — the location segment of the code still differs, so
-- 01-02-...-000123 and 03-02-...-000124 are distinct strings.
CREATE TABLE IF NOT EXISTS receipt_number_counters (
    -- tenant_id is part of the key, not decoration: a terminal index is
    -- unique PER TENANT, so in the shared cloud database tenant A's
    -- terminal 01 and tenant B's terminal 01 would otherwise share one
    -- counter row and interleave their sequences.
    tenant_id     TEXT NOT NULL DEFAULT 'default',
    terminal_idx  TEXT NOT NULL,   -- 2 hex digits, the terminal's index id
    fiscal_year   TEXT NOT NULL,   -- 'YYYY', store-local; assumed calendar year
    counter       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, terminal_idx, fiscal_year)
);

-- Backstop: the code must be unique — but only WITHIN a tenant. Two
-- tenants legitimately both issue 01-02-260918-01-000123, because the
-- index ids are per-tenant by design; a receipt code is only ever read
-- inside its own tenant. Partial so today's all-NULL column sits outside
-- the index instead of colliding on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_display_code
    ON sales (tenant_id, display_code) WHERE display_code IS NOT NULL;
