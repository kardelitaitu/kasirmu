//! Which stock reading is authoritative for a convergence assertion?
//!
//! # Why this file exists
//!
//! A multi-device replay harness (P1-3) was abandoned on 2026-09-27 because
//! three readings of "the stock level" disagreed on a single device:
//!
//! ```text
//! Store::get_stock              (inventory.qty)        -> 57
//! Store::get_stock_from_ledger  (SUM stock_movements)  ->  7
//! ```
//!
//! Asserting convergence requires knowing which number is the claim. The
//! crate documents the answer — `ledger.rs:10-11` says "the delta ledger is
//! authoritative once healed", `ledger.rs:49-53` calls `inventory` a
//! "sum-of-all-locations approximation" — but a doc comment is not evidence,
//! and this is the exact question that stopped the harness. So it is
//! measured here instead.
//!
//! # What is established
//!
//! 1. `get_stock_from_ledger` returns `SUM(stock_movements.delta)` — the
//!    **deltas only**. An opening balance written straight into `inventory`
//!    with no movement behind it is NOT part of that sum.
//! 2. So the two readings legitimately differ by exactly the un-backed
//!    opening balance, and which one is "right" depends on the question:
//!    the ledger answers "how much have the deltas moved", `inventory`
//!    answers "how much stock is on hand".
//! 3. `rebuild_stock_summary_for` is what closes that gap — it writes ONE
//!    compensating `legacy-backfill` movement per shortfall, which is why
//!    the doc calls the ledger authoritative *once healed*.
//!
//! The operational consequence, and the reason this is a test rather than a
//! note: **a convergence assertion must state which quantity it means.** The
//! abandoned harness asserted `inventory` arithmetic against a ledger
//! reading, which is why it produced three numbers for one product. The
//! error was in the assertion, not in the sync layer.

use kasirmu_core::Store;
use kasirmu_core::migrations;
use platform_sync::queue::SyncQueue;

/// Fresh database with one product and an opening balance of 50.
///
/// The opening balance is written the way the seed writes it: an `inventory`
/// row with no movement behind it. That is deliberate — it is the legacy
/// shape `rebuild_stock_summary_for` exists to heal, and reproducing it is
/// what makes the readings diverge.
/// The caller owns the connection: `Store::new` only needs a borrow, so
/// this takes one instead of `Box::leak`ing a database per test to
/// manufacture a `'static` (O-T03).
fn fresh_store(db: &rusqlite::Connection) -> Store<'_> {
    let store = Store::new(db);
    store
        .conn()
        .execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES
                ('prod-coffee', 50, '2025-01-01T00:00:00.000Z');",
        )
        .expect("seed product and opening balance");
    store
}

/// Apply a `stock.adjusted` delta through the production sync path.
fn apply_adjustment(store: &Store<'_>, delta: i64) {
    let payload = format!(r#"{{"sku":"COFFEE","delta":{delta}}}"#);
    let item = store
        .enqueue_offline("stock.adjusted", &payload)
        .expect("enqueue");
    SyncQueue::new()
        .apply_remote_atomic(store, &item)
        .expect("apply adjustment");
}

/// The two readings, named so a failure says which one moved.
fn readings(store: &Store<'_>) -> (i64, i64) {
    let agg = store.get_stock("prod-coffee").expect("inventory read");
    let ledger = store
        .get_stock_from_ledger("prod-coffee")
        .expect("ledger read");
    (agg, ledger)
}

/// An adjustment is visible in the ledger as a raw delta.
///
/// The ledger sums `stock_movements.delta` and nothing else, so a `+10` on a
/// product whose opening balance lives in `inventory` reads `10` — not `60`.
/// Measured, not assumed: the first version of this test asserted `60` and
/// was wrong, because it credited the ledger with an opening balance no
/// movement accounts for.
#[test]
fn an_adjustment_is_visible_in_the_ledger_as_a_raw_delta() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);

    apply_adjustment(&store, 10);
    let (_, ledger) = readings(&store);
    assert_eq!(ledger, 10, "the ledger holds the delta, not the balance");

    apply_adjustment(&store, -4);
    let (_, ledger) = readings(&store);
    assert_eq!(ledger, 6, "10 - 4, still deltas only");
}

/// The opening balance is invisible to the ledger until something heals it.
///
/// This is the mechanism `rebuild_stock_summary_for` exists for, and the
/// reason the abandoned harness's readings disagreed. The two quantities
/// answer different questions:
///
/// - `inventory.qty` — how much stock is on hand (opening balance included)
/// - `SUM(stock_movements.delta)` — how much the deltas have moved
///
/// They coincide only when every unit on hand has a movement behind it,
/// which is exactly the state a rebuild creates.
#[test]
fn the_ledger_excludes_an_unbacked_opening_balance() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);

    let (agg_before, ledger_before) = readings(&store);
    assert_eq!(agg_before, 50, "opening balance lives in inventory");
    assert_eq!(
        ledger_before, 50,
        "with NO movements the ledger read falls back to inventory \
         (ledger.rs:31-34), so the two agree by fallback rather than by sum"
    );

    // The moment the ledger has any row, the fallback stops applying and
    // the two quantities separate by the un-backed opening balance.
    //
    // MEASURED: `adjust_stock` maintains BOTH stores. `inventory.qty`
    // follows the deltas (50 -> 30), so it is NOT a stale cache — the
    // earlier reading of this file wrongly assumed it was. What differs is
    // the SCOPE of the sum, not its freshness: `inventory` carries the
    // opening balance, `SUM(stock_movements.delta)` cannot, because no
    // movement accounts for an opening balance.
    apply_adjustment(&store, -20);
    let (agg_mid, ledger_mid) = readings(&store);
    assert_eq!(
        ledger_mid, -20,
        "deltas only: the opening 50 is not a delta"
    );
    assert_eq!(agg_mid, 30, "the aggregate DOES follow: 50 - 20");
    assert_eq!(
        agg_mid - ledger_mid,
        50,
        "the gap between the readings is exactly the un-backed opening balance"
    );

    // Healing writes the compensating movement, which puts the opening
    // balance INTO the ledger and makes the two agree.
    let rebuilt = store.rebuild_stock_summary().expect("rebuild");
    assert!(rebuilt > 0, "the rebuild should have touched this product");

    let (agg_after, ledger_after) = readings(&store);
    assert_eq!(
        ledger_after, 30,
        "after healing the ledger sums to the true balance: 50 - 20"
    );
    assert_eq!(
        agg_after, ledger_after,
        "and the legacy aggregate agrees with the authoritative ledger"
    );
}

/// A convergence assertion must name which quantity it means.
///
/// Stated as a test so the reasoning is executable. The abandoned harness
/// mixed the two — it compared `inventory` arithmetic against a ledger
/// reading and produced "three numbers for one product". Both numbers below
/// are correct; they sum over different populations, and an assertion that
/// does not say which one it means cannot be satisfied by any
/// implementation.
#[test]
fn the_two_readings_answer_different_questions_and_both_are_correct() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    apply_adjustment(&store, 10);
    apply_adjustment(&store, -3);

    let (agg, ledger) = readings(&store);

    // `inventory.qty` answers "how much is on hand": 50 + 10 - 3.
    assert_eq!(agg, 57, "aggregate = opening balance + deltas");
    // The ledger answers "what have the deltas done": 10 - 3.
    assert_eq!(ledger, 7, "ledger = deltas only");
    assert_eq!(agg - ledger, 50, "the gap is the opening balance");

    // After a rebuild, ONE number answers both, and that is the state a
    // convergence assertion should compare in — or it should compare the
    // ledger directly and say so.
    store.rebuild_stock_summary().expect("rebuild");
    let (agg_after, ledger_after) = readings(&store);
    assert_eq!(agg_after, ledger_after, "healed: the two agree");
    assert_eq!(ledger_after, 57, "50 + 10 - 3");
}
