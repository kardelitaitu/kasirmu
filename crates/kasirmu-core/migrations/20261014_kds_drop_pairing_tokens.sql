-- KDS pairing tokens removed: they were a credential nobody verified.
--
-- HISTORY, because this reverses work done days earlier. `kds_devices` carried
-- `pairing_token_hash`/`pairing_expires_at` (20260820) and, briefly,
-- `consumed_at`/`consumed_by_device` (20261013). The intent was QR enrollment:
-- the POS minted a code, a KDS screen scanned it, and the token became that
-- screen's credential.
--
-- That design was superseded, not completed. The POS registers a KDS device
-- directly (`registerKdsDeviceScoped`); the shop's route and hierarchy live in
-- the topology editor (`kasirmu-core/src/topology.rs`); and a device's
-- `station_ids` selects which stations it displays. Nothing ever redeemed the
-- token — `validate_pairing_token` had no caller outside its own tests.
--
-- Keeping it was worse than merely dead: the UI generated 32 random bytes,
-- displayed them as a QR, and *looked* like a credential while nothing ever
-- checked it. A displayed-but-unverified secret invites the next reader to
-- assume it is verified. Deleting it is the honest state.
--
-- Postgres: regenerated from this migration (scripts/generate-pg-migration.py),
-- not hand-edited — `sync_terminals` keeps its own unrelated secret_hash.

ALTER TABLE kds_devices DROP COLUMN consumed_by_device;
ALTER TABLE kds_devices DROP COLUMN consumed_at;
ALTER TABLE kds_devices DROP COLUMN pairing_expires_at;
ALTER TABLE kds_devices DROP COLUMN pairing_token_hash;
