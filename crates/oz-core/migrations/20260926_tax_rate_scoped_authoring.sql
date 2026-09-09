-- 20260926_tax_rate_scoped_authoring.sql
--
-- Tax-separation P1, write-side slice A1. 20260921 added the scope columns
-- (`legal_entity_id`, `location_id`) and the validity window, and recorded two
-- things as owed HERE rather than skipped there:
--
--   1. a DB-level guard against a row setting BOTH scope columns, and
--   2. uniqueness of `is_default` that means something once scope exists.
--
-- This migration lands both. It changes no code: the writers still clear every
-- default row on the table (unscoped, `db/tax.rs:150`/`:193`), so behaviour
-- between this slice and the next is exactly what it was — which is the point
-- of ordering schema before code.
--
-- # The both-set guard: a CHECK, reached by rebuild
--
-- A row with BOTH `legal_entity_id` and `location_id` set is not a third,
-- narrower scope — the resolver (`db/tax.rs::resolve_tax_rate_for_location`,
-- Location -> Entity -> Global) would have to invent a precedence the design
-- never granted, and a row pulled from the hub in that state silently prices a
-- location under the wrong entity. `oz_core::db::tax::TaxRateScope` cannot
-- represent "both", but a type cannot stop a raw `INSERT`, a sync upsert, or a
-- future writer that does not route through it. The rule belongs in the schema.
--
-- It is a same-row rule, so a CHECK expresses it — no subquery, no other-row
-- reference. SQLite cannot attach a CHECK to an existing table by ALTER, so the
-- table is rebuilt, using the `20260831_per_tenant_unique_rebuild` mechanics:
-- `PRAGMA defer_foreign_keys`, which IS settable inside the runner's
-- transaction (unlike `foreign_keys`), so the child tables whose FKs name
-- `tax_rates(id)` tolerate the DROP + RENAME; every referenced row is copied, so
-- the deferred check at COMMIT passes.
--
-- Chosen over the RAISE-trigger alternative deliberately: a trigger needs a
-- hand-written plpgsql port per trigger in scripts/generate-pg-migration.py's
-- TRIGGER_MAP — and BOTH an INSERT arm and an UPDATE arm, because a SQLite
-- trigger fires on one or the other — whereas the rebuilt table DDL carries the
-- CHECK into the Postgres mirror with no new mapping and no second enforcement
-- path that could drift from the first. CHECK also covers what a trigger would
-- miss or need duplicated for: `INSERT ... ON CONFLICT DO UPDATE` still runs the
-- table CHECK, and that is precisely the shape of `sync_pull::upsert_tax_rates`.
--
-- # Default uniqueness becomes per-tier, and the legacy index is dropped
--
-- `idx_tax_rates_single_default` was `UNIQUE (is_default) WHERE is_default = 1`
-- — one default row for the WHOLE TABLE, across every tenant and every tier.
-- That was coherent while `is_default` meant "the application default rate" and
-- only one could exist. Once scope exists it is wrong twice over: it blocks a
-- tenant from having a global default AND an entity default AND a location
-- default (the whole shape the resolver walks), and it couples tenants to each
-- other in the shared cloud database — tenant B's default rate is refused
-- because tenant A already has one.
--
-- Indexes belong to the table, so the rebuild took it with it; it is
-- deliberately NOT recreated. Three partial unique indexes replace it, one per
-- tier, each keyed on `tenant_id` plus the tier's own column:
--
--   * tenant-global tier — both scope columns NULL, at most one default per
--     tenant;
--   * legal-entity tier  — entity set, location NULL, one default per entity;
--   * location tier      — location set (the CHECK then forces entity NULL),
--     one default per location.
--
-- Keying on `tenant_id` rather than on the scope column is load-bearing, not
-- decoration: a unique index over a NULL column enforces nothing, because
-- SQLite and Postgres both treat NULLs as DISTINCT in a unique index. The
-- tenant-global tier's natural key column is NULL on exactly the rows it must
-- police, so `ON tax_rates(legal_entity_id)` with that WHERE clause would be a
-- no-op that reads like a constraint. `tenant_id` is NOT NULL on every row, so
-- every index here has a real key. The same NULL-distinctness reason is why
-- `is_default` is confined to the WHERE clause rather than being the indexed
-- column, as the legacy index had it.
--
-- Nothing here can fail on data that passes today: each new index is strictly
-- looser than a table-wide one, no scoped row exists yet (no writer sets those
-- columns until the next slice), so every existing default row falls in the
-- single tenant-global group exactly as before.
--
-- Deliberately NOT this slice: the writers do not yet stop clearing defaults
-- table-wide (A2 — until then the unscoped clear is redundant, not broken, and
-- this ordering is what keeps A1 deployable on its own); no new column; no rate
-- column touched — `rate_bps` stays INTEGER basis points, no float.

PRAGMA defer_foreign_keys = ON;

-- ── rebuild tax_rates with the both-set CHECK ─────────────────────────
CREATE TABLE tax_rates_new (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    rate_bps        INTEGER NOT NULL CHECK (rate_bps >= 0),
    is_default      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    is_inclusive    INTEGER NOT NULL DEFAULT 0,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    is_active       INTEGER NOT NULL DEFAULT 1,
    legal_entity_id TEXT REFERENCES legal_entities(id) ON DELETE RESTRICT,
    location_id     TEXT REFERENCES locations(id) ON DELETE RESTRICT,
    effective_from  TEXT,
    effective_to    TEXT,
    -- One scope, never both: see the header. NULL means "not scoped at this
    -- tier", so (NULL, NULL) is the tenant-global row and stays legal.
    CHECK (legal_entity_id IS NULL OR location_id IS NULL)
);

INSERT INTO tax_rates_new (
    id, name, rate_bps, is_default, created_at, updated_at,
    is_inclusive, tenant_id, is_active,
    legal_entity_id, location_id, effective_from, effective_to
)
SELECT
    id, name, rate_bps, is_default, created_at, updated_at,
    is_inclusive, tenant_id, is_active,
    legal_entity_id, location_id, effective_from, effective_to
FROM tax_rates;

DROP TABLE tax_rates;

ALTER TABLE tax_rates_new RENAME TO tax_rates;

-- ── recreate the pre-existing index set (DROP took them with the table) ──
CREATE INDEX idx_tax_rates_active ON tax_rates(is_active);

CREATE INDEX idx_tax_rates_name ON tax_rates(name);

CREATE INDEX idx_tax_rates_tenant ON tax_rates(tenant_id);

CREATE INDEX idx_tax_rates_scope_location
    ON tax_rates(location_id)
    WHERE location_id IS NOT NULL;

CREATE INDEX idx_tax_rates_scope_entity
    ON tax_rates(legal_entity_id)
    WHERE legal_entity_id IS NOT NULL;

-- idx_tax_rates_single_default is intentionally NOT recreated — see the header.

-- ── per-tier default uniqueness ──────────────────────────────────────
CREATE UNIQUE INDEX idx_tax_rates_default_tenant_global
    ON tax_rates(tenant_id)
    WHERE is_default = 1
      AND legal_entity_id IS NULL
      AND location_id IS NULL;

CREATE UNIQUE INDEX idx_tax_rates_default_entity
    ON tax_rates(tenant_id, legal_entity_id)
    WHERE is_default = 1
      AND legal_entity_id IS NOT NULL
      AND location_id IS NULL;

CREATE UNIQUE INDEX idx_tax_rates_default_location
    ON tax_rates(tenant_id, location_id)
    WHERE is_default = 1
      AND location_id IS NOT NULL;
