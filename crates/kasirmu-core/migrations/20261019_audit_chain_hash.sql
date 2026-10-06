-- 20261019_audit_chain_hash.sql
--
-- Audit log tamper detection via cryptographic chain-hashing (P1).
--
-- Adds `previous_hash` (nullable TEXT) and `hash` (NOT NULL TEXT DEFAULT '')
-- to the `audit_log` table.
--
-- Each new entry records the SHA-256 hash of its canonical fields chained
-- to the previous entry's hash. Existing entries are grandfathered with an
-- empty hash string.

ALTER TABLE audit_log ADD COLUMN previous_hash TEXT;
ALTER TABLE audit_log ADD COLUMN hash TEXT NOT NULL DEFAULT '';
