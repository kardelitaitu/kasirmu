-- 20261007_sync_origin_and_effect_key.sql
--
-- Sync origin and per-effect receipts (checklist C3, slice S1 — schema only).
--
-- THE DEFECT THIS SCHEMA EXISTS TO CLOSE. A terminal re-applies its own pushed
-- \`complete_sale\` when the item comes back around, and the second application
-- deducts stock a second time. Nothing in the current schema can tell "this
-- mutation originated here" from "this mutation arrived from elsewhere":
-- \`offline_queue\` carries no origin column, and \`sync_applied_items\` records
-- DELIVERY (item_id was applied) rather than EFFECT (the deduction it caused).
--
-- WHY \`origin_terminal_id\` IS A REAL COLUMN AND NOT A PAYLOAD FIELD. The
-- payload \`_terminal\` key is stamped only by the HTTP daemon push path, so a
-- tablet — exactly the shell where the local database and the queue are one —
-- would never carry it and would stay broken. The payload is also the CRDT
-- field, so writing an identity into it changes merge semantics. The column is
-- nullable because the row's own producer is the only writer that can fill it
-- honestly, and a pre-existing row genuinely has no recorded origin.
--
-- NO BACKFILL, ON PURPOSE. Guessing an origin for existing rows would make the
-- dedup path suppress a legitimate deduction for whatever row it guessed
-- wrongly — silent stock loss, the opposite of the bug being fixed. A NULL
-- origin therefore means "unknown", and the future reader must treat it as
-- "not proven self-originated" rather than as "not self-originated".
--
-- WHY \`effect_key\` IS PER-EFFECT AND NOT PER-ITEM. item_id proves an item was
-- delivered once; it says nothing about the effect that delivery had. A retry
-- that produces a second deduction is a second EFFECT and must be visible as
-- one, so the receipt is keyed by the effect and uniqueness is enforced on it.
--
-- The UNIQUE index is PARTIAL. Every row written before this migration has
-- \`effect_key\` NULL, and a full unique index would let the FIRST NULL pass and
-- collide every one after it — the existing ledger would refuse to grow. NULL
-- means "no effect recorded", which is not an effect to deduplicate.
--
-- \`ADD COLUMN\` has no \`IF NOT EXISTS\` in SQLite, so the two columns stand on
-- the drift path's tolerance for statements whose effect is provably already
-- present (the \`pragma_table_info\` fallback in platform-core's runner), the
-- same ground \`20261009_staff_trash\` and \`20261010_role_trash\` stand on, while
-- the index is guarded outright. Date 20261007 is the slice's id, not a
-- registry position: this entry is appended after the registry tail (20261010)
-- and touches no column any other migration reads, so it is order-independent.

ALTER TABLE offline_queue ADD COLUMN origin_terminal_id TEXT;
ALTER TABLE sync_applied_items ADD COLUMN effect_key TEXT;

-- Partial so the pre-existing NULL rows cannot collide with each other; only a
-- real, recorded effect is constrained to appear once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_applied_items_effect_key
    ON sync_applied_items(effect_key)
    WHERE effect_key IS NOT NULL;
