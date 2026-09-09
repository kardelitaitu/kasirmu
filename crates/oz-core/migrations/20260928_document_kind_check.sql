-- 20260928_document_kind_check.sql
--
-- W5-B: `document_number_sequences.document_kind` was free TEXT. Only the
-- (legal_entity_id, document_kind) PAIR is UNIQUE, so a misspelled kind was
-- never rejected - it silently opened a PARALLEL statutory series whose
-- counter starts at zero, which is the exact failure statutory numbering
-- exists to prevent. The set is closed at both ends now: core parses the kind
-- into `DocumentKind` (a typed `Validation` rejection at the boundary), and
-- this CHECK makes the schema itself refuse a row core would not have written
-- - a future downsert/sync arm cannot walk around it.
--
-- Data audit BEFORE writing this CHECK, because the rebuild below would brick
-- a database holding a row outside the set: no migration or seed inserts into
-- this table (`git grep 'INSERT INTO document_number_sequences'` = 0 hits),
-- the only producer is `Store::upsert_document_number_sequence` and its IPC
-- wrapper, and every kind literal in the tree - core plus the desktop and
-- tablet command tests - is 'receipt' or 'invoice'. The CHECK is therefore
-- plain, with no legacy arm and no documented exception.
--
-- SQLite cannot attach a CHECK with ALTER TABLE, so the constraint arrives the
-- only way it can: build the replacement, copy, drop, rename - the same shape
-- as 20260926_tax_rate_scoped_authoring.sql. Column types are untouched (no
-- new column, so the column-type lint sees nothing) and there is no index to
-- recreate: the UNIQUE is inline in 20260923's DDL and no CREATE INDEX names
-- this table, so the rename carries the auto-index with it.
-- `defer_foreign_keys` keeps the swap from tripping references held by other
-- tables mid-transaction.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE document_number_sequences_new (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id),
    document_kind   TEXT NOT NULL CHECK (document_kind IN ('receipt', 'invoice')),
    prefix          TEXT NOT NULL DEFAULT '',
    current_value   INTEGER NOT NULL DEFAULT 0,
    reset_period    TEXT NOT NULL DEFAULT 'never',
    period_key      TEXT NOT NULL DEFAULT '',
    padding         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (legal_entity_id, document_kind)
);

INSERT INTO document_number_sequences_new
    (id, tenant_id, legal_entity_id, document_kind, prefix, current_value,
     reset_period, period_key, padding, created_at, updated_at)
    SELECT id, tenant_id, legal_entity_id, document_kind, prefix, current_value,
           reset_period, period_key, padding, created_at, updated_at
    FROM document_number_sequences;

DROP TABLE document_number_sequences;

ALTER TABLE document_number_sequences_new RENAME TO document_number_sequences;
