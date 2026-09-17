-- 20260923_fiscal_numbering.sql
--
-- Regional configuration Slice 5 (todo-global-saas-2.md design, slice queue
-- #5): the fiscalization and statutory-numbering axes, owned by the legal
-- entity per the §H map (todo-global-saas-1.md:229 "Tax Configuration and
-- fiscalization: legal entity/location"). §K sequences them right after the
-- entity tax/fiscal settings (todo-global-saas-3.md:19).
--
-- Both axes were "nothing" in the design's inventory: `git grep -i fiscal`
-- returned zero hits and `sales.receipt_number` is just `sale.id`. This
-- migration adds the two multi-row-per-entity tables the design named and
-- NOTHING else:
--
--   * `fiscal_schemes` — one legal entity can carry several schemes (per
--     market or document regime); each scheme is a parameters BAG. The
--     parameters JSON deliberately carries no tax math: the adjacent P1 box
--     owns `tax_rates` scoping and "changes money math on every sale; this
--     one changes none" (the 20260919 migration's own precedent).
--   * `document_number_sequences` — ONE statutory series per entity per
--     document kind (UNIQUE guard): prefix + counter + optional period
--     reset + zero-padding. The counter only ever moves through the atomic
--     claim (see kasirmu_core::db::fiscal::claim_document_number) so statutory
--     numbering cannot race or gap.
--   * `sales.statutory_number` — nullable stamp written inside the sale
--     transaction when the selling entity has a configured sequence. NULL
--     for legacy sales and unconfigured deployments: today's behavior is
--     exactly preserved (receipt_number stays sale.id).
--
-- RLS: both tables carry `tenant_id` from birth (DEFAULT 'default' — the
-- same convention 20260907_add_location_tenant_id.sql set for desktop-only
-- tables) but stay OUT of RLS_TABLES: the generator's rule is "add a table
-- there only after its REST/sync write path demonstrably sets tenant_id",
-- and these tables' only write paths are desktop-local Store CRUD and the
-- checkout claim. The parent `legal_entities` is itself RLS_EXEMPT pending
-- the cloud-sync decision (see RLS_EXEMPT entries). Covering children while
-- the parent is uncovered would be incoherent. The entries in RLS_EXEMPT
-- record this; when the PG write paths land, covering both tables is a
-- list-move in the generator, not a migration.
--
-- No seed rows: an entity with no schemes/sequences is the normal §G
-- small-customer state, and an empty table needs no default.

CREATE TABLE IF NOT EXISTS fiscal_schemes (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id),
    scheme_code     TEXT NOT NULL,
    name            TEXT NOT NULL,
    parameters      TEXT NOT NULL DEFAULT '{}',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_fiscal_schemes_entity ON fiscal_schemes(legal_entity_id, is_active);

CREATE TABLE IF NOT EXISTS document_number_sequences (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id),
    document_kind   TEXT NOT NULL,
    prefix          TEXT NOT NULL DEFAULT '',
    current_value   INTEGER NOT NULL DEFAULT 0,
    reset_period    TEXT NOT NULL DEFAULT 'never',
    period_key      TEXT NOT NULL DEFAULT '',
    padding         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (legal_entity_id, document_kind)
);

ALTER TABLE sales ADD COLUMN statutory_number TEXT;