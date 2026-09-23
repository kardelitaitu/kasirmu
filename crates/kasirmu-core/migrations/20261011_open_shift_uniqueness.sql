-- 20261011_open_shift_uniqueness.sql
--
-- COR-27, closed at the DATABASE level (C18 P1.3 follow-through).
--
-- WHY. `Store::open_shift` has been atomic since 4518a2b8: the duplicate check
-- and the INSERT share one `BEGIN IMMEDIATE` transaction, so two opens through
-- that function serialize instead of both reading an empty count. That closes
-- the function's race but NOT the invariant: `shifts` is a plain table, and any
-- writer that does not go through `open_shift` — a future command, a migration,
-- a repair script, a console session — can still put a second row with
-- status='open' next to the first. A second open shift for one user is a
-- reconciliation defect: two drawers' worth of opening float, one of which no
-- close will ever account for. The guard therefore belongs to the schema, not
-- to one function in one crate.
--
-- WHY PARTIAL. The constraint is on OPEN shifts only. A user accumulates one
-- closed shift per day forever; a table-wide UNIQUE(user_id) would refuse the
-- second day's shift. `WHERE status = 'open'` makes the index hold at most one
-- row per user, and closed rows leave it entirely — which is also why this
-- index costs nothing on the close path (a row leaves the index when
-- status flips) and nothing on the history reads (they scan closed rows).
--
-- PRECEDENT, and the one place this differs. `inventory_shifts` has carried
-- exactly this guard since the init schema:
--   CREATE UNIQUE INDEX idx_inv_shifts_active_per_user_location
--       ON inventory_shifts(user_id, location_id) WHERE status = 'active';
-- (20260813_init.sql:1134-1135). It is keyed by (user, location) because a
-- stock shift is per-location; a cash shift is per-user across the whole
-- terminal estate, which is what `open_shift` enforces and what this index
-- mirrors. Also mirrored: the partial-unique shape of
-- `idx_sync_applied_items_effect_key` (20261007) and
-- `idx_locations_tenant_ticket_prefix` (20260926).
--
-- CAN THIS BRICK AN EXISTING STORE? No, and the reason is a closed set, not
-- optimism. Every writer of `shifts` in the tree, measured rather than
-- assumed (`grep -rn "INTO shifts\|UPDATE shifts" --include='*.rs' .`):
--   * `open_shift` (crates/kasirmu-core/src/db/shifts.rs) — the only INSERT
--     into a live path, and it refuses a second open since 4518a2b8;
--   * `close_shift` (same file) — UPDATE to status='closed';
--   * test fixtures only (shifts_tests.rs, db/analytics_tests.rs,
--     apps/mobile-tauri and kasirmu-bridge analytics_tests).
-- No sync/pull path carries `shifts` (grep over kasirmu-core/src/sync_pull.rs,
-- sync_client.rs and platform/sync/src: no match), so nothing imports a second
-- open shift from a peer, and the table is local-only.
-- A store that predates 4518a2b8 COULD hold two open shifts for one user, and
-- on such a store this CREATE would fail and block startup. That is why the
-- pre-existing duplicates are reconciled FIRST, deterministically, below: the
-- creation then cannot fail on any database that reaches it. The reconciliation
-- is data-preserving — no row is deleted, and no money moves.
--
-- ORDER OF THE TWO STATEMENTS IS LOAD-BEARING. The reconciliation must see the
-- final schema, not the schema as of this migration, so the stale-shift test
-- cannot live in the migration itself; it is pinned instead by
-- `open_shift_uniqueness_index_bites_and_reconciles` in migrations_tests.rs,
-- which runs the FULL registry first, plants the duplicate, and then re-applies
-- this file's statements — the same replay the drift path performs on a real
-- database whose migration file was edited. (The alternative — putting the
-- reconciliation in a separate, later migration — was declined: the two halves
-- would be independently applicable, and the index without its reconciliation
-- is exactly the startup-bricking shape this file exists to prevent.)
--
-- NO NEW TABLE, NO MONEY COLUMN, NO FLOAT. The registry's TABLE pin is
-- unchanged; the INDEX pin moves by exactly one (188 -> 189).

-- 1. Reconcile pre-existing duplicates, deterministically.
--    Survivor: the most recently opened row (opened_at DESC, id DESC as the
--    tiebreak so the choice is total and reproducible). Every other open shift
--    for that user is closed rather than deleted, stamped as auto-reconciled
--    with a zero closing balance and its counted cash marked unavailable: the
--    row keeps its opening float, its sales window and its audit trail, and no
--    figure is invented. NULL closing/expected/difference is the schema's own
--    'never counted' signal (see the column comments in 20260813_init.sql),
--    which is the truthful state here — nobody counted these drawers.
UPDATE shifts
   SET status = 'closed',
       closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       closing_balance_minor = NULL,
       expected_cash_minor = NULL,
       cash_difference_minor = NULL,
       notes = CASE WHEN notes = '' THEN 'auto-closed: duplicate open shift (COR-27 reconciliation)'
                    ELSE notes || ' | auto-closed: duplicate open shift (COR-27 reconciliation)' END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status = 'open'
   AND EXISTS (
       SELECT 1 FROM shifts newer
        WHERE newer.user_id = shifts.user_id
          AND newer.status = 'open'
          AND (newer.opened_at, newer.id) > (shifts.opened_at, shifts.id)
   );

-- 2. The guard itself. Partial, so closed shifts are outside it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_open_per_user
    ON shifts(user_id)
    WHERE status = 'open';
