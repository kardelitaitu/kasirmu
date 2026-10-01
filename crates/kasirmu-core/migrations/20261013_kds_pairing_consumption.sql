-- KDS pairing token single-use consumption.
--
-- Why: `validate_pairing_token` verified a hash and an expiry but mutated
-- nothing, so a valid enrollment code stayed replayable for its entire TTL.
-- Anyone who observed or guessed the code could enroll repeatedly, and a
-- leaked QR still worked minutes later. Consumption is the missing half of
-- the pairing contract: a code is now redeemable exactly once.
--
-- Nullable, and NULL means "not yet redeemed" — existing rows keep working
-- (they were issued under the old, replayable contract and expire on their
-- own), so this is forward-only with no backfill.
--
-- `consumed_by_device` records which device redeemed it, so an operator can
-- tell a used code from a never-issued one instead of seeing both as a
-- mismatch.

ALTER TABLE kds_devices ADD COLUMN consumed_at TEXT;
ALTER TABLE kds_devices ADD COLUMN consumed_by_device TEXT;

-- The redemption path filters on the unconsumed rows for a device id, which
-- is already the primary key, so no new index is warranted.
