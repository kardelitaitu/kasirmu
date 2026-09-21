-- 20261008_provisioning_legacy_backfill.sql
--
-- ADR #56 §2.1 replaced three independently-read booleans with one row whose
-- PRESENCE is "this device is set up". 20261007_provisioning.sql created that
-- table with NO backfill, so every device the PRE-#56 wizard set up has no row:
-- `get_first_run_state` returns `Unprovisioned` (kasirmu-bridge/src/setup.rs:238-249),
-- the boot gate pins `hasCompletedSetup = false`, and an ALREADY-SET-UP device is
-- re-routed into onboarding on every boot. This migration closes that gap.
--
-- THE LEGACY SIGNAL, and why it is readable from SQL alone.
--   The pre-#56 gate was
--     Settings::get(keys::SHOW_SETUP_WIZARD).map(|v| v == "false").unwrap_or(false)
--   (the retired `kasirmu_bridge::setup::get_setup_status`, measured at 6341ea4c7^),
--   and the `store.show_setup_wizard` key was written by exactly two commands,
--   both retired with that gate: `complete_setup` step 7 and
--   `dismiss_setup_wizard`. So `value = 'false'` for that key is a LEGACY-ONLY
--   fact, and the two directions it could be wrong are both closed by measurement:
--     * `provision_device` deliberately does NOT write it (db/provisioning.rs:596),
--       and no migration seeds any `settings` row (`grep -n "INTO settings"
--       crates/kasirmu-core/migrations/*.sql` -> no matches), so a fresh ADR-#56
--       install never has the key and this migration is INERT there.
--     * `kasirmu-cli db init` writes `store.setup_complete` — a DIFFERENT key —
--       and never this one (crates/kasirmu-cli/src/commands/db.rs:33).
--   Absent, or present with any other value, therefore means "not set up under the
--   legacy scheme": no row is written and the flow runs. That is the fail-closed
--   direction the ADR's own §Q4 requires ("If it is not resolvable, the shell must
--   fall to `Unprovisioned` rather than guess").
--
-- WHY THE ROW IS KEYED ON terminals.device_id, AND THE RESIDUAL THIS LEAVES.
--   `provisioning.terminal_id` matches `terminals.device_id`, and the shell reads
--   the gate with the machine's HOSTNAME (`get_device_id` -> COMPUTERNAME/HOSTNAME,
--   crates/kasirmu-bridge/src/health.rs:76-80). SQL cannot read that hostname. The
--   one SQL-readable mapping to the same string is `terminals.device_id`, written
--   by the legacy auto-register (`kasirmu-bridge/src/features.rs`,
--   `device_hostname()`) and by the operator's Register-terminal form. So the
--   backfill inserts one row per ALREADY REGISTERED terminal, and only when the
--   legacy key proves the wizard ran.
--   RESIDUAL, stated rather than papered over: a legacy install that never
--   registered a terminal row (MultiTerminal never enabled and no operator
--   registration) has no SQL-readable hostname at all, so it stays
--   `Unprovisioned` and its device reaches the provisioning flow once. It cannot
--   be repaired here without inventing a `terminal_id`, and a wrong row marks a
--   genuinely-new device as provisioned — the strictly worse failure.
--
-- MODE IS 'local'. The legacy install had no licence-server tenant, and `local`
--   is ADR #56 §2.4's DEFAULT rather than a fallback. `tenant_id` stays NULL: the
--   local literal `'default'` is a DIFFERENT namespace (ADR #56 §2.1) and
--   comparing them is the bug that section exists to prevent.
-- owner_user_id IS LEFT NULL DELIBERATELY. The legacy wizard's owner is a `users`
--   row carrying no marker SQL can prove identifies THE owner; selecting one by
--   role would be a guess about identity. The shell's routing reads `has_users`
--   (never this column), so NULL costs nothing and claims nothing.
-- location_id IS CARRIED from the terminal's own binding when it still RESOLVES
--   to a `locations` row, so a bound terminal lands on the location it was already
--   bound to. The correlated subquery yields NULL rather than a dangling id: the
--   column is a FOREIGN KEY and the runner may have `foreign_keys` ON, so a stale
--   `bound_location_id` must not abort the whole migration.
--
-- NO NEW TABLE AND NO NEW INDEX, so the registry's table/index count pins in
-- `migrations_tests.rs` are unchanged. NO MONEY COLUMNS AND NO FLOATS.

INSERT OR IGNORE INTO provisioning (
    terminal_id, tenant_id, location_id, owner_user_id, device_id, mode, home_region
)
SELECT t.device_id,
       NULL,
       (SELECT l.id FROM locations l WHERE l.id = t.bound_location_id),
       NULL,
       NULL,
       'local',
       'global'
FROM terminals t
WHERE t.device_id IS NOT NULL
  AND t.device_id <> ''
  AND EXISTS (
      SELECT 1 FROM settings s
      WHERE s.key = 'store.show_setup_wizard' AND s.value = 'false'
  );
