-- 20261012_stock_summary_qty_nonnegative.sql
--
-- C10b under owner decision D11: the negative-stock backstop, enforced
-- CONDITIONALLY, where it actually belongs.
--
-- WHY NOT A CHECK. The obvious form - `CHECK (qty >= 0)` on `stock_summary`,
-- the constraint `adjust.rs` has always claimed was there - is WRONG, and
-- measurably so. `allow_negative_stock` is a shipped feature, not dead code:
-- `adjust.rs:208-225` writes a negative qty on purpose when the location's
-- binding opts in, `db/sales_lifecycle.rs:279-303` and
-- `products_stock_adjust/batch.rs:78-88` read the same flag to let the sale
-- through, `ui/features/inventory/LocationPicker.tsx:429` renders the badge,
-- and ADR 2026-07-18-multi-location-inventory.md:476 specifies it
-- ("lets this location go below zero when stock is insufficient"). An
-- unconditional CHECK does not merely add a backstop - it silently re-enables
-- the very Layer-1 guard the flag exists to opt out of, because the upsert at
-- adjust.rs:251 is the statement it refuses. That was confirmed by building
-- it: `negative_stock_event_fires_when_allow_negative_enabled` failed with
-- `Err(InsufficientStockAtLocation { requested_delta: -15, available_qty: 12 })`.
--
-- WHY NOT A BLANKET REPAIR EITHER. A negative row here is usually a real
-- oversell, not corruption, so zeroing it would destroy legitimate history.
-- Nothing in this file touches existing rows: a trigger fires on WRITES only,
-- so every negative already in a store survives this migration untouched.
--
-- WHAT THIS GUARANTEES, AND WHAT IT DOES NOT. It constrains the MATERIALISED
-- ROLLUP, not the ledger. `stock_movements` stays append-only and
-- unconstrained; nothing here stops the two tables drifting apart, and that
-- drift is exactly what the C12 variance report (bdaffa47) exists to
-- surface. Narrowly: a write to `stock_summary` cannot drive qty below zero
-- at a location whose binding has not opted in.
--
-- THE PREDICATE, AND THE ONE PLACE IT REFINES THE LITERAL WORDING. The
-- literal form - refuse whenever `NOT EXISTS (a binding with allow = 1)` -
-- is expressible, and was measured; but it also refuses a location that has
-- NO binding at all, which breaks `deactivate_inventory_location_with_
-- negative_stock_errors` (inventory_tests.rs:247 seeds -3 at a location made
-- by `create_inventory_location`, which writes no binding). That test is the
-- only pin on a shipped feature and may not be weakened. The predicate below
-- therefore refuses only when the location IS bound and none of its bindings
-- opts in:
--
--   qty < 0
--   AND EXISTS (a binding for this location)
--   AND NOT EXISTS (a binding for this location with allow_negative_stock = 1)
--
-- This is the honest reading of the flag rather than an approximation of an
-- inexpressible one: the flag is a per-BINDING opt-out, so a location with no
-- binding has no opt-out to violate, and Rust Layer 1 already refuses
-- negatives outright on that path (adjust.rs:216-224, where `allow_negative`
-- can only become true via a binding) - there is no race there for a backstop
-- to close. Both arms are pinned by tests in migrations_tests.rs.
--
-- TWO TRIGGERS, NOT ONE. `INSERT ... ON CONFLICT DO UPDATE` fires the UPDATE
-- trigger once the row exists - and that upsert is the shape BOTH writers use
-- (adjust.rs:251 and :378, db/products.rs:131). An INSERT-only arm would leave
-- every subsequent deduction unguarded.
--
-- Neither trigger changes the table, the index surface, or any existing row.

CREATE TRIGGER IF NOT EXISTS stock_summary_qty_nonnegative_insert
BEFORE INSERT ON stock_summary
FOR EACH ROW
WHEN NEW.qty < 0
 AND EXISTS (SELECT 1 FROM workspace_inventory_locations w
              WHERE w.location_id = NEW.location_id)
 AND NOT EXISTS (SELECT 1 FROM workspace_inventory_locations w
                  WHERE w.location_id = NEW.location_id
                    AND w.allow_negative_stock = 1)
BEGIN
    SELECT RAISE(ABORT, 'negative stock requires allow_negative_stock on the location binding');
END;

CREATE TRIGGER IF NOT EXISTS stock_summary_qty_nonnegative_update
BEFORE UPDATE ON stock_summary
FOR EACH ROW
WHEN NEW.qty < 0
 AND EXISTS (SELECT 1 FROM workspace_inventory_locations w
              WHERE w.location_id = NEW.location_id)
 AND NOT EXISTS (SELECT 1 FROM workspace_inventory_locations w
                  WHERE w.location_id = NEW.location_id
                    AND w.allow_negative_stock = 1)
BEGIN
    SELECT RAISE(ABORT, 'negative stock requires allow_negative_stock on the location binding');
END;