-- First-run provisioning record (ADR #56 §2.1) — one row per terminal, whose
-- presence IS the 'this device is set up' fact.
--
-- WHY A ROW AND NOT THREE BOOLEANS
--   First-run state was three independently-read booleans (setup.completed,
--   the wizard dismissal key, and the owner-existing check). A failed read
--   could forge a verdict, which is why boot-retry.ts exists: a lost IPC
--   response had to be retried because reading it wrongly skipped the wizard.
--   A row cannot be forged the same way — an unreadable DB yields NO ROW, and
--   no row means 'unprovisioned'. The retry becomes an ordinary idempotent
--   re-read, and 'setup done but nothing provisioned' (the state the wizard's
--   Skip button reaches today) becomes unrepresentable rather than guarded.
--
-- KEYED PER TERMINAL, not one row per install (ADR #56 §5 Q4). The gate is
-- EXISTS(SELECT 1 FROM provisioning WHERE terminal_id = ?) — an indexed local
-- lookup, never a network call. A singleton row would force a whole-store DB
-- to answer a per-device question, which is wrong for a tablet that can be
-- replaced independently of the store.
--
-- home_region IS RESIDENCY, NOT MARKET. ADR #59 §2.2 and
-- 20260919_regional_configuration.sql:13-19 state that the market anchor is
-- legal_entities.country_code (ISO-3166 alpha-2) and residency is where the
-- data is STORED; the two must not collapse into one column. A tenant resident
-- in 'global' may trade in Indonesia, and the column that says so is
-- country_code, not this one. This column MIRRORS the licence server's
-- authoritative tenants.region (ADR #59 §Q5) and is written only from a
-- server response — a cache for offline display, never the source of truth.
--
-- NO MONEY COLUMNS AND NO FLOATS.

CREATE TABLE IF NOT EXISTS provisioning (
    -- Matches terminals.device_id (20260813_init.sql:929, UNIQUE), NOT the
    -- terminals.id surrogate: a replaced tablet keeps its id but changes its
    -- device, and a re-provisioned device must land on its own row.
    terminal_id    TEXT PRIMARY KEY,
    -- The LICENCE SERVER's tenant id, written only by a 'linked' install.
    -- NULL for 'local'. Deliberately not the local literal 'default': the two
    -- are different namespaces (ADR #56 §2.1) and comparing them is the bug
    -- that section exists to prevent.
    tenant_id      TEXT,
    -- The locations row this terminal belongs to. NOTE the target is
    -- `locations`, not `store_profiles`: 20260906_rename_store_to_location.sql:14
    -- renames that table, and this migration runs after it, so a reference to
    -- the old name is a table that no longer exists. ADR #56 §2.6 removes the
    -- seeded 'Default Store' placeholder, so on a fresh install this is a row
    -- provision_device created rather than one the migration shipped.
    location_id    TEXT REFERENCES locations(id),
    owner_user_id  TEXT REFERENCES users(id),
    -- TerminalCredential.terminal_id: the credential this device authenticates
    -- to sync with.
    device_id      TEXT,
    -- Which tier of ADR #56 §2.4 was used. 'local' needs no network and is the
    -- DEFAULT, not a fallback: the target deployment includes merchants with
    -- unreliable connectivity. 'linked' adds the identity step.
    mode           TEXT NOT NULL CHECK (mode IN ('local', 'linked')),
    -- Residency mirror; see the header. 'global' initially (ADR #59 §Q6),
    -- where 'global' means 'no residency commitment yet' and is NOT a country.
    home_region    TEXT NOT NULL DEFAULT 'global',
    provisioned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- A linked install must name its tenant and device; a local one must not
    -- pretend to. Enforced here rather than in Rust so a row written by any
    -- future path (sync, downgrade, a repair script) cannot be incoherent.
    CHECK (mode = 'local' OR (tenant_id IS NOT NULL AND device_id IS NOT NULL))
);

-- The one read the shell makes on every boot, and the idempotency guard
-- provision_device hits before writing anything.
CREATE INDEX IF NOT EXISTS idx_provisioning_tenant ON provisioning (tenant_id);