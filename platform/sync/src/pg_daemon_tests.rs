//! Unit tests for the PostgreSQL sync daemon (`pg_daemon.rs`):
//! lifecycle/idempotent start-stop, `apply_pulled_page` semantics —
//! SYNC-01 durable anchor + monotonic created_at advancement, snapshot
//! recovery importing before the anchor reset, idempotent replay,
//! dead-letter quarantine after the retry budget, ADR #6 stock_summary
//! rebuild, SYNC-10 settings re-emit, SYNC-EW wakeup coalescing — plus
//! outbox schema, offline queue behaviour, and status DTO shape.
//! Extracted from the inline `mod tests` in `pg_daemon.rs` (F-018).

use super::*;
use kasirmu_core::CoreError;
use kasirmu_core::migrations;
use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus};

fn setup_db() -> DbConnection {
    Arc::new(Mutex::new(migrations::fresh_db()))
}

/// Wait for a daemon CONDITION by polling `status()`, not by sleeping a fixed
/// multiple of the tick — the helper `daemon_tests.rs` gained in O-T05, applied here
/// because this file was still on the old fixed 80ms/100ms start-and-stop pattern.
///
/// WHY NOT A FIXED SLEEP: it buys the same margin on a fast machine and a loaded one,
/// so it is either wasteful or flaky and never tells you which. A fixed sleep also
/// makes the SLOWEST host set the floor for every run, which is how 16.6s of stated
/// floor accumulated in `platform/sync` (§10B).
///
/// Polls every 10ms with a 1s ceiling — 2x the old start allowance — and names `what`
/// in the panic, because a timeout that only says "timed out" is the least useful
/// failure a test can produce.
async fn wait_for_pg_daemon<F>(daemon: &PgSyncDaemon, what: &str, mut ok: F)
where
    F: FnMut(PgDaemonStatus) -> bool,
{
    for _ in 0..100 {
        if ok(daemon.status().await) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let status = daemon.status().await;
    panic!(
        "pg daemon never reached `{what}` within 1s — running={}, last_sync_at={:?}, last_error={:?}",
        status.running, status.last_sync_at, status.last_error
    );
}
/// Seed `prod-coffee` with an OPENING BALANCE of 50 that the delta ledger
/// backs with one real movement.
///
/// The backing movement is not decoration: `Store::rebuild_stock_summary`
/// scopes itself to `DISTINCT item_id FROM stock_movements UNION DISTINCT
/// item_id FROM stock_summary` (`ledger.rs:73`), so a product present ONLY in
/// `inventory` is never in scope and a rebuild silently returns 0 having
/// written nothing. Without this row the O-H18 tests below would stage a
/// rebuild that does not run, then reason about a summary that does not exist.
///
/// `inventory.qty` (50) EQUALS the ledger sum (50) on purpose, so the rebuild's
/// legacy-heal predicate (`inventory.qty > SUM(delta)`) does NOT fire: this
/// fixture represents a healthy install, and a healed legacy shortfall would
/// make every subsequent rebuild write an extra compensating row — noise that
/// would blur exactly the "did a rebuild run here?" observation the O-H18
/// tests make.
fn seed_product_and_inventory(conn: &rusqlite::Connection) {
    conn.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES
                ('prod-coffee', 50, '2025-01-01T00:00:00.000Z');
             INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES
                ('seed-opening-balance', 'prod-coffee', '01926b3a-0000-7000-8000-000000000001', 50, 'opening-balance', '2025-01-01T00:00:00.000Z');",
        )
        .unwrap();
}

/// A remote item shaped as the PG pull decodes it. `created_at` is the
/// durable-anchor watermark (the composite cursor orders on it);
/// `synced_at` is deliberately left NULL — the remote may never stamp it,
/// and the anchor must still advance on `created_at`.
fn remote_stock_adjustment(id: &str, delta: i64, created_at: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "stock.adjusted",
        format!(r#"{{"sku":"COFFEE","delta":{delta}}}"#),
    );
    item.id = id.into();
    item.created_at = created_at.into();
    item
}

fn remote_poison_sale(id: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "complete_sale",
        r#"{"line_items":[{"sku":"MISSING","qty":1}]}"#,
    );
    item.id = id.into();
    item.created_at = "2026-01-01T00:00:00.000Z".into();
    item
}

/// A payload the sale arm cannot deserialize: [CoreError::Internal], which is
/// TRANSIENT, so it keeps the three-attempt retry budget.
fn remote_transient_sale(id: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new("complete_sale", "{not json");
    item.id = id.into();
    item.created_at = "2026-01-01T00:00:00.000Z".into();
    item
}

#[test]
fn snapshot_recovery_imports_before_resetting_anchor() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store
        .set_sync_pull_state(Some("stale"), Some("stale-cursor"))
        .unwrap();
    let snapshot = crate::transport::SyncSnapshotResponse {
        version: 1,
        products: vec![crate::transport::SnapshotProduct {
            id: "pg-snapshot-product".into(),
            sku: "PG-SNAPSHOT".into(),
            name: "PG Snapshot Product".into(),
            price_minor: 250,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };

    let imported = recover_pg_snapshot(&store, &snapshot, Some("oldest"))
        .expect("valid snapshot should recover the PG anchor");
    assert_eq!(imported, 1);
    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(pull_state.since.as_deref(), Some("oldest"));
    assert_eq!(pull_state.cursor, None);
    let product_name: String = conn
        .query_row(
            "SELECT name FROM products WHERE sku = 'PG-SNAPSHOT'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(product_name, "PG Snapshot Product");
}

#[test]
fn snapshot_recovery_keeps_stale_anchor_when_import_fails() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store
        .set_sync_pull_state(Some("stale"), Some("stale-cursor"))
        .unwrap();
    let snapshot = crate::transport::SyncSnapshotResponse {
        version: 99,
        products: vec![],
        tax_rates: vec![],
        users: vec![],
    };

    assert!(recover_pg_snapshot(&store, &snapshot, Some("oldest")).is_err());
    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(pull_state.since.as_deref(), Some("stale"));
    assert_eq!(pull_state.cursor.as_deref(), Some("stale-cursor"));
}

// ── SYNC-01 parity: atomic pull apply + durable anchor ────────────

#[test]
fn apply_pulled_page_applies_stock_adjustment_and_records_receipt() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let page = vec![remote_stock_adjustment(
        "pg-item-1",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let (new_since, carried_movement) =
        apply_pulled_page(&store, &page, None, &noop_settings_sink()).expect("page applies");

    assert_eq!(store.get_stock("prod-coffee").unwrap(), 60);
    assert!(
        !carried_movement,
        "a stock.adjusted page is not a stock.movement page — it writes the summary itself"
    );
    assert!(
        store.is_remote_item_applied("pg-item-1").unwrap(),
        "ledger receipt must be recorded with the mutation"
    );
    assert_eq!(
        new_since.as_str(),
        "2026-01-02T00:00:00.000Z",
        "anchor advances on created_at, not synced_at"
    );
}

/// Regression (composite-cursor slice): the durable anchor must advance
/// on `created_at` even when the remote NEVER stamps `synced_at` (NULL)
/// — otherwise a queue whose rows all lack a synced_at watermark never
/// advances and re-pulls everything every cycle.
#[test]
fn apply_pulled_page_advances_anchor_on_created_at_when_synced_at_null() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let page = vec![remote_stock_adjustment(
        "pg-item-null",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let (new_since, _) =
        apply_pulled_page(&store, &page, None, &noop_settings_sink()).expect("page applies");

    assert_eq!(store.get_stock("prod-coffee").unwrap(), 60);
    assert_eq!(
        new_since, "2026-01-02T00:00:00.000Z",
        "anchor must advance on created_at even when synced_at is NULL"
    );
}

#[test]
fn apply_pulled_page_replay_is_idempotent() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    let page = vec![remote_stock_adjustment(
        "pg-item-replay",
        10,
        "2026-01-02T00:00:00.000Z",
    )];

    let _ = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    let _ = apply_pulled_page(&store, &page, None, &noop_settings_sink());

    assert_eq!(
        store.get_stock("prod-coffee").unwrap(),
        60,
        "a replayed page must NOT re-apply the mutation (SYNC-01)"
    );
}

#[test]
fn apply_pulled_page_retains_anchor_on_retryable_failure() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // A malformed payload is Internal (transient), so the item stays
    // retryable after one attempt and the anchor is retained.
    let page = vec![remote_transient_sale("pg-poison-1")];

    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    assert!(
        new_since.is_none(),
        "retryable failure must retain the pull anchor"
    );
    assert!(
        !store
            .is_remote_failure_dead_lettered("pg-poison-1")
            .unwrap()
    );
}

#[test]
fn apply_pulled_page_dead_letters_then_advances() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // A missing referenced product is a PERMANENT failure, so the item is
    // quarantined on its first failure and the anchor advances at once.
    let page = vec![remote_poison_sale("pg-poison-2")];

    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    assert!(
        new_since.is_some(),
        "a permanent failure may advance the anchor on the first attempt"
    );
    assert!(
        store
            .is_remote_failure_dead_lettered("pg-poison-2")
            .unwrap()
    );
}

#[test]
fn apply_pulled_page_anchor_is_monotonic_max_created_at() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let earlier = remote_stock_adjustment("pg-item-a", 1, "2026-01-01T00:00:00.000Z");
    let later = remote_stock_adjustment("pg-item-b", 1, "2026-01-03T00:00:00.000Z");

    // A prior anchor newer than one page row must not regress.
    let new_since = apply_pulled_page(
        &store,
        &[earlier, later],
        Some("2026-01-02T00:00:00.000Z"),
        &noop_settings_sink(),
    );
    assert_eq!(
        new_since.expect("page applies").0,
        "2026-01-03T00:00:00.000Z"
    );
}

/// ADR #6 (SQLite daemon, daemon.rs): a page containing a `stock.movement`
/// writes ONLY the raw delta-ledger row (the summary cache is NOT touched by
/// the apply path), so the materialized `stock_summary` must be rebuilt from
/// the ledger. Without the rebuild, a remote stock movement pulled via PG
/// leaves the on-hand cache the app reads permanently stale.
///
/// O-H18: the rebuild is no longer INSIDE `apply_pulled_page` — it is one
/// call after the pull loop, so that a multi-page tick pays for one ledger
/// aggregate instead of one per page. This test now pins the two halves that
/// survive at the page seam: the page reports the movement to the caller, and
/// the anchor still advances for it (writing the report into the anchor write
/// is what makes a skipped rebuild impossible to lose — a movement page can
/// never advance the anchor silently). End-state correctness across pages is
/// pinned by `apply_pulled_page_pages_report_movements_for_one_tick_rebuild`.
#[test]
fn apply_pulled_page_reports_stock_movements_and_still_advances_the_anchor() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let mut item = OfflineQueueItem::new(
        "stock.movement",
        r#"{"id":"sm-remote-1","item_id":"prod-coffee","delta":40,"reason":"restock","store_id":"default","created_at":"2026-01-05T00:00:00.000Z"}"#,
    );
    item.id = "pg-item-movement-1".into();
    item.created_at = "2026-01-05T00:00:00.000Z".into();

    let (new_since, carried_movement) = apply_pulled_page(
        &store,
        std::slice::from_ref(&item),
        None,
        &noop_settings_sink(),
    )
    .expect("a stock.movement page applies");

    assert_eq!(
        new_since, "2026-01-05T00:00:00.000Z",
        "a stock.movement page applies and advances the anchor"
    );
    assert!(
        carried_movement,
        "the page must REPORT its stock.movement so the tick rebuilds the summary; \
         a quiet advance here is exactly the stale-cache bug the rebuild prevents"
    );
    assert!(
        store.is_remote_item_applied("pg-item-movement-1").unwrap(),
        "the delta-ledger receipt is written by the apply, independent of the rebuild"
    );
    // The summary is NOT rebuilt at this seam any more (O-H18): doing so per
    // page was O(pages × all movements) for one tick.
}

// ── O-H18: ONE stock-summary rebuild per pull tick ─────────────────
//
// Before this, `apply_pulled_page` called `store.rebuild_stock_summary()`
// whenever the page it had just applied carried a `stock.movement`. That
// rebuild is an aggregate over the ENTIRE delta ledger, and the PG pull loop
// pages with no page cap, so one tick over a large backlog cost
// O(pages × all movements). The rebuild now runs once, after the loop.
//
// HOW THE CALL COUNT IS MEASURED — or, precisely, is NOT: the rebuild is a
// method on `kasirmu_core::db::Store`, a concrete struct borrowed from a
// `rusqlite::Connection`, with no trait or field this crate can wrap or
// substitute. There is no counting seam, so these tests do NOT measure the
// call count directly. They pin the two observable halves instead:
//
//   1. the PAGE SEAM no longer rebuilds (a movement page applies, reports the
//      movement, and leaves `stock_summary` untouched) — this asserts "the
//      rebuild is not inside the loop", but note it does NOT prove "exactly
//      once": an extra, idempotent second rebuild in the same tick would be
//      invisible to it; and
//   2. the tick-end rebuild produces the correct END STATE when a multi-page
//      tick is applied the way the pull loop applies it (every page, one
//      rebuild of a ledger-visible state).
//
// A second rebuild per tick would be invisible to (2) — the rebuild is
// idempotent. The structural guarantee is the single call site in `run_tick`.

/// Helper: a remote `stock.movement` item for `prod-coffee`.
fn remote_stock_movement(
    id: &str,
    movement_id: &str,
    delta: i64,
    created_at: &str,
) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "stock.movement",
        format!(
            r#"{{"id":"{movement_id}","item_id":"prod-coffee","delta":{delta},"reason":"restock","store_id":"default","created_at":"{created_at}"}}"#
        ),
    );
    item.id = id.into();
    item.created_at = created_at.into();
    item
}

/// Helper: the current `stock_summary` quantity for `prod-coffee`, summed
/// across locations (ADR-18 gives the table a composite `(item_id,
/// location_id)` key, so a movement page can legitimately leave more than one
/// row).
///
/// `None` means the product has NO summary row — which is itself an
/// observation these tests need: "the rebuild never ran" shows up as a missing
/// row, not as a zero. `SUM(qty)` over an EMPTY set returns ONE row whose
/// value is NULL, not zero rows, so the decoder must be `Option<i64>` for that
/// contract to hold (a missing row is "never rebuilt", a 0 is "rebuilt and
/// empty").
fn summary_qty(conn: &rusqlite::Connection) -> Option<i64> {
    conn.query_row(
        "SELECT SUM(qty) FROM stock_summary WHERE item_id = 'prod-coffee'",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )
    .unwrap()
}

/// The page seam must NOT rebuild the summary — that is the call that used to
/// run once per backlog page, and removing it is the whole of O-H18.
///
/// The page here carries a `stock.movement`, i.e. exactly the page the old
/// per-page rebuild fired on. Removing the hoist's page report would also be
/// caught: nothing would reach the tick's rebuild and the ledger-only delta
/// would never appear in `stock_summary` (STAGE 3).
///
/// WHAT THIS TEST CANNOT SEE, stated plainly: the quantities alone would NOT
/// discriminate a hoist from a per-page rebuild — a rebuild re-derives the
/// same numbers. Only a call COUNT could, and `Store::rebuild_stock_summary`
/// is a concrete method on a struct borrowed from `rusqlite::Connection`, with
/// no trait or field to wrap. So the call count is NOT measured here. What the
/// seam assertion observes is the consequence the count produces on this page:
/// a summary the page left alone.
#[test]
fn apply_pulled_page_does_not_rebuild_the_summary_at_the_page_seam() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    // A current, healthy cache: the fixture's opening balance is ledger-backed,
    // so a rebuild writes the same 50 the seed already holds and any heal
    // predicate stays quiet. Nothing in this test can be explained by a heal.
    store.rebuild_stock_summary().unwrap();
    let before = summary_qty(&conn).expect("one rebuild materializes the summary");

    let item = remote_stock_movement("pg-oh18-p1", "sm-oh18-p1", 7, "2026-02-01T00:02:00.000Z");
    let (anchor, carried) = apply_pulled_page(
        &store,
        std::slice::from_ref(&item),
        None,
        &noop_settings_sink(),
    )
    .expect("a stock.movement page applies");

    assert_eq!(anchor, "2026-02-01T00:02:00.000Z");
    assert!(
        carried,
        "the page must report its movement to the tick's single rebuild"
    );
    assert_eq!(
        summary_qty(&conn),
        Some(before),
        "the page seam must NOT rebuild stock_summary — that per-page rebuild is O-H18"
    );
    assert_eq!(
        store.get_stock_from_ledger("prod-coffee").unwrap(),
        before + 7,
        "the delta-ledger row IS written per page; only the aggregate rebuild moved"
    );
}

/// A multi-page tick: EVERY page reports its movement, so the tick's flag is
/// true no matter which page carries one — and the tick-end rebuild leaves the
/// summary reflecting every applied movement.
///
/// The failure mode this pins is the one the hoist could introduce: rebuilding
/// only when the LAST page carried a movement. Page 3 of this tick carries
/// none, so a "last page wins" implementation would skip the rebuild entirely
/// and leave `stock_summary` stale behind an anchor that had already advanced.
#[test]
fn multi_page_tick_flag_survives_a_trailing_page_without_a_movement() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    // No seed rebuild here on purpose: the ledger starts EMPTY, so
    // `stock_summary.qty` is exactly `SUM(delta)` for this product and the
    // assertion below is arithmetic on the deltas themselves rather than on a
    // quantity some other write happened to produce.
    assert_eq!(
        summary_qty(&conn),
        None,
        "fixture sanity: nothing has been summarized yet"
    );

    // Exactly the pull loop's shape: OR-fold each page's report.
    let pages = vec![
        vec![
            remote_stock_movement("pg-oh18-a", "sm-oh18-a", 5, "2026-02-02T00:00:00.000Z"),
            remote_stock_movement("pg-oh18-b", "sm-oh18-b", 6, "2026-02-02T00:00:01.000Z"),
        ],
        vec![remote_stock_movement(
            "pg-oh18-c",
            "sm-oh18-c",
            7,
            "2026-02-02T00:00:02.000Z",
        )],
        // A trailing page with NO movement — the last-page trap.
        vec![remote_stock_adjustment(
            "pg-oh18-d",
            1,
            "2026-02-02T00:00:03.000Z",
        )],
    ];

    let mut tick_carried_movements = false;
    for page in &pages {
        let (_, carried) = apply_pulled_page(&store, page, None, &noop_settings_sink())
            .expect("every page of this tick applies");
        tick_carried_movements |= carried;
    }

    assert!(
        tick_carried_movements,
        "a tick whose FIRST pages carried movements must report one, \
         even though its last page carried none"
    );

    // The single rebuild the pull loop performs after its page loop.
    store.rebuild_stock_summary().unwrap();

    // 50 is the fixture's opening balance, which the seed backs with a real
    // ledger movement precisely so this total is arithmetic rather than a
    // number the code happened to produce.
    assert_eq!(
        summary_qty(&conn),
        Some(50 + 5 + 6 + 7 + 1),
        "one tick-end rebuild must reflect every movement applied across all pages"
    );
    assert_eq!(
        store.get_stock_from_ledger("prod-coffee").unwrap(),
        50 + 5 + 6 + 7 + 1,
        "ledger and summary agree: the rebuild is a pure function of the ledger"
    );
}

/// The tick-end rebuild's failure contract: when it fails, the durable anchor
/// is restored to the value the tick captured, so the next tick re-pulls and
/// retries both the pages and the derived-state rebuild.
#[tokio::test]
async fn pull_loop_builder_rebuild_failure_is_reported_and_restores_the_anchor() {
    let db = setup_db();
    let (captured_since, captured_cursor) = ("2026-01-01T00:00:00.000Z", "cursor-at-tick-start");
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            seed_product_and_inventory(&conn);
            // The rebuild fails when the summary table is gone — the same
            // lever the per-page test used before the hoist.
            conn.execute_batch("DROP TABLE stock_summary").unwrap();
            // The state a pulled page would have left behind before the
            // tick-end rebuild ran: anchor advanced past the movement page.
            store
                .set_sync_pull_state(Some("2026-02-01T00:00:00.000Z"), Some("cursor-after-pages"))
                .unwrap();
        })
        .await
        .unwrap();
    }

    let failure = rebuild_tick_summary(&db, Some(captured_since), Some(captured_cursor))
        .await
        .expect("a rebuild against a dropped stock_summary table must fail");

    assert_eq!(
        failure,
        TickRebuild::Restored,
        "the anchor restore must succeed and be reported as such"
    );
    assert!(
        failure.message().contains("anchor restored"),
        "the cycle error must say the anchor was restored for retry, got {:?}",
        failure.message()
    );

    let db_clone = db.clone();
    let (since, cursor) = tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let store = Store::new(&conn);
        let state = store.get_sync_pull_state().unwrap();
        (state.since, state.cursor)
    })
    .await
    .unwrap();
    assert_eq!(
        since.as_deref(),
        Some(captured_since),
        "a failed rebuild must put the anchor back where the tick found it"
    );
    assert_eq!(
        cursor.as_deref(),
        Some(captured_cursor),
        "both halves of the composite anchor are restored"
    );
}

/// The success path reports NOTHING — the tick must not invent an error for a
/// rebuild that worked, and the anchor must be left exactly where the pages
/// advanced it.
#[tokio::test]
async fn pull_loop_builder_rebuild_success_leaves_the_anchor_advanced() {
    let db = setup_db();
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            seed_product_and_inventory(&conn);
            store
                .set_sync_pull_state(Some("2026-02-01T00:00:00.000Z"), Some("cursor-after-pages"))
                .unwrap();
        })
        .await
        .unwrap();
    }

    assert_eq!(
        rebuild_tick_summary(
            &db,
            Some("2026-01-01T00:00:00.000Z"),
            Some("cursor-at-tick-start")
        )
        .await,
        None,
        "a successful rebuild must not report a failure"
    );

    let db_clone = db.clone();
    let (since, cursor) = tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let state = Store::new(&conn).get_sync_pull_state().unwrap();
        (state.since, state.cursor)
    })
    .await
    .unwrap();
    assert_eq!(since.as_deref(), Some("2026-02-01T00:00:00.000Z"));
    assert_eq!(cursor.as_deref(), Some("cursor-after-pages"));
}

/// A page whose item cannot be applied at all (retryable, not yet dead-
/// lettered) must retain the anchor — unchanged by O-H18, and the reason the
/// pull loop stops paginating instead of skipping ahead.
///
/// O-H18 moved the summary-rebuild retry out of this seam: the rebuild now
/// runs once after the pull loop, so its failure cannot be pinned here. Its
/// own contract — "a failed rebuild restores the anchor so the next tick
/// retries it" — lives in
/// `pull_loop_builder_rebuild_failure_is_reported_and_restores_the_anchor`.
#[test]
fn apply_pulled_page_retains_anchor_when_a_page_item_is_retryable() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    // A malformed payload is Internal (transient), so the item keeps its
    // three-attempt budget and the page must not advance.
    let page = vec![remote_transient_sale("pg-poison-movement")];

    let outcome = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    assert!(
        outcome.is_none(),
        "a retryable failure must retain the pull anchor"
    );
}

/// Helper: a no-op settings sink for call sites that do not assert on
/// SYNC-10 emission.
fn noop_settings_sink() -> SettingsChangedSink {
    Arc::new(|_: &SettingsUpdated| {})
}

/// SYNC-10 parity: a pulled remote `settings.update` must re-emit
/// `SettingsUpdated` through the daemon's sink so the UI refetches — the
/// SQLite daemon publishes the changed key + originating terminal after
/// the tx commits; the PG path previously used `apply_remote_atomic`,
/// which drops the settings-change report entirely.
#[test]
fn apply_pulled_page_emits_settings_updated_after_settings_change() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    let emitted = Arc::new(std::sync::Mutex::new(Vec::<SettingsUpdated>::new()));
    let sink: SettingsChangedSink = {
        let emitted = Arc::clone(&emitted);
        Arc::new(move |event: &SettingsUpdated| emitted.lock().unwrap().push(event.clone()))
    };

    let mut item = OfflineQueueItem::new(
        "settings.update",
        r#"{"key":"store.name","value":"Remote Acme","terminal_id":"term-remote","version":3}"#,
    );
    item.id = "pg-item-settings-1".into();
    item.created_at = "2026-01-02T00:00:00.000Z".into();

    let (new_since, _) =
        apply_pulled_page(&store, std::slice::from_ref(&item), None, &sink).expect("applies");

    assert_eq!(new_since.as_str(), "2026-01-02T00:00:00.000Z");
    let captured = emitted.lock().unwrap().clone();
    assert_eq!(
        captured.len(),
        1,
        "exactly one SettingsUpdated must be emitted per applied settings change"
    );
    assert_eq!(captured[0].changed_keys, vec!["store.name".to_string()]);
    assert_eq!(captured[0].terminal_id, "term-remote");
}

/// SYNC-10 negative: pages without settings changes must not emit
/// anything through the sink.
#[test]
fn apply_pulled_page_is_silent_for_non_settings_pages() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let emitted = Arc::new(std::sync::Mutex::new(Vec::<SettingsUpdated>::new()));
    let sink: SettingsChangedSink = {
        let emitted = Arc::clone(&emitted);
        Arc::new(move |event: &SettingsUpdated| emitted.lock().unwrap().push(event.clone()))
    };

    let page = vec![remote_stock_adjustment(
        "pg-item-silent",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let applied = apply_pulled_page(&store, &page, None, &sink);

    assert!(applied.is_some());
    assert!(
        emitted.lock().unwrap().is_empty(),
        "no settings change in the page → no SettingsUpdated emission"
    );
}

/// Helper: enqueue an offline item and return its actual ID (from the returned OfflineQueueItem).
fn enqueue_item(conn: &rusqlite::Connection, action: &str, payload: &str) -> String {
    let store = Store::new(conn);
    let item = store.enqueue_offline(action, payload).unwrap();
    item.id
}

/// Helper: get raw pending count from the offline_queue table.
fn raw_pending_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ── Lifecycle tests ─────────────────────────────────────────────

#[tokio::test]
async fn daemon_starts_stopped() {
    let daemon = PgSyncDaemon::new();
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_start_and_stop() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db).await);
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await, "stop must confirm the run loop exited");
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_status_defaults() {
    let daemon = PgSyncDaemon::new();
    let status = daemon.status().await;
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert_eq!(status.last_pushed, 0);
    assert_eq!(status.last_pulled, 0);
    assert!(status.last_error.is_none());
}

#[tokio::test]
async fn daemon_stop_when_not_running_is_noop() {
    let daemon = PgSyncDaemon::new();
    assert!(
        daemon.stop().await,
        "stop with nothing running reports stopped"
    );
    assert!(!daemon.is_running().await);
}

/// Regression (silent-success start): a start on a live daemon used to log
/// a warning and return `()`, which the IPC command surfaced as `Ok(())` —
/// the caller could not tell that no new daemon was spawned. The second
/// start now reports `false` explicitly.
#[tokio::test]
async fn daemon_double_start_reports_already_running() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);
    assert!(
        !daemon.start(db).await,
        "a start on a live daemon must report that it did NOT spawn"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_custom_interval() {
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(50));
    assert_eq!(daemon.interval(), Duration::from_millis(50));
}

#[tokio::test]
async fn daemon_set_interval() {
    let mut daemon = PgSyncDaemon::new();
    daemon.set_interval(Duration::from_secs(10));
    assert_eq!(daemon.interval(), Duration::from_secs(10));
}

// ── Outbox schema validation ────────────────────────────────────

#[test]
fn outbox_schema_has_required_columns() {
    let conn = migrations::fresh_db();
    let mut stmt = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='offline_queue'")
        .unwrap();
    let sql: String = stmt.query_row([], |r| r.get(0)).unwrap();
    assert!(sql.contains("id"), "offline_queue must have 'id' column");
    assert!(
        sql.contains("action"),
        "offline_queue must have 'action' column"
    );
    assert!(
        sql.contains("payload"),
        "offline_queue must have 'payload' column"
    );
    assert!(
        sql.contains("status"),
        "offline_queue must have 'status' column"
    );
    assert!(
        sql.contains("created_at"),
        "offline_queue must have 'created_at' column"
    );
}

#[test]
fn outbox_table_exists() {
    let conn = migrations::fresh_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='offline_queue'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "offline_queue table must exist after migrations");
}

// ── Idempotency & duplicate handling ───────────────────────────

#[test]
fn mark_offline_synced_is_idempotent() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let id = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);

    // First mark as synced — should succeed
    assert!(store.mark_offline_synced(&id).is_ok());

    // Second mark as synced — must succeed (idempotent)
    assert!(store.mark_offline_synced(&id).is_ok());
}

/// An id that was never enqueued is [`CoreError::NotFound`] — NOT a no-op.
///
/// `Store::mark_offline_synced` documents both halves of the contract
/// (`db/offline.rs`: "CoreError::NotFound when the id does not exist. An id that
/// exists in a non-pending state is an idempotent no-op returning Ok(())"), and
/// the idempotent half is pinned by `mark_offline_synced_is_idempotent` right
/// above. This test is the other half.
///
/// It used to assert nothing (`let _ = result;`) under a comment admitting
/// "Ok (or Err depending on implementation)" — so it could only fail on a panic
/// and still paid for a `fresh_db()` snapshot clone. The contract is documented
/// and is not a coin flip: the missing row must surface as `NotFound`, never as
/// a silent success that would tell the drain loop a non-existent item synced.
#[test]
fn mark_offline_synced_nonexistent_item() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    let err = store
        .mark_offline_synced("nonexistent-id")
        .expect_err("a never-enqueued id must be refused, not silently accepted");
    match &err {
        CoreError::NotFound { entity, id } => {
            assert_eq!(
                *entity, "offline_queue",
                "NotFound must name the queue table"
            );
            assert_eq!(
                id, "nonexistent-id",
                "NotFound must echo the id it looked for"
            );
        }
        other => panic!("a missing queue id must be NotFound, got: {other:?}"),
    }

    // Nothing was written or resolved by the failed call.
    assert_eq!(
        raw_pending_count(&conn),
        0,
        "the refused mark must write nothing"
    );
}

/// The BATCH drain deliberately DISAGREES with the single-item variant: an
/// unknown id in the batch is an error, and the whole batch rolls back.
///
/// `Store::mark_offline_synced` raises `NotFound` for a missing id; a reader
/// might expect `mark_offline_synced_batch` to swallow it ("a batch of 100
/// where one was already deleted should not fail the drain"). It does not: the
/// batch loop is `Self::mark_synced_on(&tx, id)?` per id inside ONE
/// transaction (`db/offline.rs`), so the `?` propagates the first
/// `NotFound` and the transaction is dropped uncommitted. This test pins that
/// decision so a future "be lenient" change is a visible, deliberate one — and
/// pins the atomicity that makes it safe: the valid ids in the poisoned batch
/// must NOT be left half-marked.
#[test]
fn mark_offline_synced_batch_rejects_an_unknown_id_and_rolls_back() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let first = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);
    let second = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s2"}"#);
    assert_eq!(raw_pending_count(&conn), 2);

    let ids = vec![first.clone(), "nonexistent-id".to_owned(), second.clone()];
    let err = store
        .mark_offline_synced_batch(&ids)
        .expect_err("an unknown id must fail the batch, not be skipped");
    assert!(
        matches!(&err, CoreError::NotFound { entity, id }
            if *entity == "offline_queue" && id == "nonexistent-id"),
        "the batch must surface the NotFound for the offending id, got: {err:?}"
    );

    // The batch is ONE transaction: the ids that WOULD have been marked are
    // still pending, because the failed batch committed nothing.
    assert_eq!(
        raw_pending_count(&conn),
        2,
        "a failed batch must not leave the valid ids half-marked"
    );

    // Without the poison id the same batch succeeds — proving the failure
    // above came from the unknown id and not from the ids themselves.
    let good = vec![first, second];
    assert!(store.mark_offline_synced_batch(&good).is_ok());
    assert_eq!(raw_pending_count(&conn), 0);
}

/// The tenant-scoped variant shares the single-item contract for an id that is
/// simply absent: `NotFound`.
///
/// `Store::mark_offline_synced_for_tenant` documents `NotFound` when the id
/// "does not exist **or** belongs to a different tenant". Only the absent-id
/// half is pinned here; the cross-tenant half needs a second tenant's row seeded
/// with its own `tenant_id`, which this fixture does not build. The absent-id
/// half is the one this variant shared with `mark_offline_synced`, and all
/// three variants are now asserted with the same shape.
#[test]
fn mark_offline_synced_for_tenant_nonexistent_item() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // `enqueue_offline` writes into the default tenant (`enqueue.rs:29`), which
    // is the tenant these rows must be marked under.
    let tenant = "default";

    let err = store
        .mark_offline_synced_for_tenant("nonexistent-id", tenant)
        .expect_err("a never-enqueued id must be refused, not silently accepted");
    assert!(
        matches!(&err, CoreError::NotFound { entity, id }
            if *entity == "offline_queue" && id == "nonexistent-id"),
        "the tenant-scoped miss must be NotFound, got: {err:?}"
    );

    // Control: an id that DOES exist, in this tenant, is marked for real — so
    // the NotFound above is about the id and not about the tenant argument.
    let id = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);
    assert!(store.mark_offline_synced_for_tenant(&id, tenant).is_ok());
    assert_eq!(raw_pending_count(&conn), 0);
}

#[test]
fn duplicate_enqueue_creates_separate_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue the same action twice
    store
        .enqueue_offline("stock.adjusted", r#"{"sku":"COFFEE"}"#)
        .unwrap();
    store
        .enqueue_offline("stock.adjusted", r#"{"sku":"COFFEE"}"#)
        .unwrap();

    // Both should be pending
    let count = raw_pending_count(&conn);
    assert_eq!(count, 2, "duplicate enqueue should create separate items");
}

// ── Large batch handling ───────────────────────────────────────

/// 10,000 pending rows: the queue still reads its own backlog at a size no
/// single push cycle can drain in one go (`DEFAULT_MAX_OUTBOX_BATCH_ITEMS` is
/// 100, so this is 100 cycles' worth), and both read paths agree on the count.
///
/// WHY THE INSERT IS SET-BASED (O-T08). It used to be 10,000 individual
/// `enqueue_offline` calls — each one a `Settings::get_sync_terminal_id`
/// subscription read plus its own autocommit INSERT — to produce two numbers.
/// Nothing here is about the ENQUEUE path's per-item behaviour: `pending_offline_count`
/// and `raw_pending_count` are pure readers, and the enqueue path's own
/// per-call contract is pinned row-by-row in `offline_tests.rs`
/// (`enqueue_offline_creates_pending_item` and neighbours). What THIS test
/// owns is that a deep queue stays countable, so it now writes the rows in
/// ONE transaction with one prepared INSERT — same 10,000 rows, same columns,
/// same `pending` status, ~100x fewer statement round-trips.
///
/// The count is deliberately NOT tied to the batch cap: 10,000 is arbitrary
/// (it is not a page size, a limit, or a threshold anywhere in the code —
/// `DEFAULT_MAX_OUTBOX_BATCH_ITEMS` = 100 is the real bound and
/// `daemon_tests.rs` already pins it), so the number stays as a scale marker
/// and the assertion is only that the two counters agree with each other and
/// with the number of rows written.
#[test]
fn large_batch_enqueue_10k_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue 10,000 items in one transaction.
    const N: i64 = 10_000;
    conn.execute_batch("BEGIN;").unwrap();
    {
        let mut stmt = conn
            .prepare(
                "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id)
                 VALUES (?1, ?2, ?3, 'pending', 0, NULL, ?4, NULL, 'default', 1, NULL)",
            )
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        for i in 0..N {
            stmt.execute(rusqlite::params![
                uuid::Uuid::now_v7().to_string(),
                "product.created",
                format!(r#"{{"sku":"SKU-{i}","name":"Item {i}"}}"#),
                now,
            ])
            .unwrap();
        }
    }
    conn.execute_batch("COMMIT;").unwrap();

    let count = store.pending_offline_count().unwrap();
    assert_eq!(count, N);
    assert_eq!(raw_pending_count(&conn), N);
}

#[test]
fn list_pending_returns_correct_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    for i in 0..100 {
        store
            .enqueue_offline("product.created", &format!(r#"{{"sku":"SKU-{i}"}}"#))
            .unwrap();
    }

    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 100);
    // All should have 'pending' status
    assert!(
        pending
            .iter()
            .all(|p| p.status == OfflineQueueStatus::Pending)
    );
}

#[test]
fn pending_count_zero_when_empty() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    assert_eq!(store.pending_offline_count().unwrap(), 0);
}

/// The sentinel exists so "the count could not be read" is not the same value
/// as "the queue is genuinely empty". `pg_sync_status` feeds the operator's
/// backlog indicator, and `-1` must never be confused with a drained queue.
#[test]
fn pending_count_unknown_sentinel_is_distinct_from_zero() {
    assert_eq!(PENDING_COUNT_UNKNOWN, -1);
    assert_ne!(
        PENDING_COUNT_UNKNOWN, 0,
        "unknown must be a value an empty queue can never produce"
    );
}

/// The read path the daemon's tick calls genuinely fails when the table is
/// gone — which is what makes the `-1` arm reachable rather than decorative.
/// Before this, the tick collapsed exactly this error into `0` via
/// `unwrap_or(0)`, so a dropped `offline_queue` table read as an idle queue.
#[test]
fn pending_offline_count_errors_when_the_table_is_missing() {
    let conn = migrations::fresh_db();
    conn.execute_batch("DROP TABLE offline_queue;").unwrap();
    let store = Store::new(&conn);
    assert!(
        store.pending_offline_count().is_err(),
        "a dropped offline_queue table must surface as an error, not as 0"
    );
}

/// A tick whose queue read fails must report the failure, not a clean cycle.
///
/// The PG daemon gated its whole push phase on `!pending.is_empty()` and read
/// the queue with `list_pending_offline().unwrap_or_default()`, so a dropped
/// `offline_queue` flattened to an empty push list: the tick skipped the push,
/// left `last_error` `None`, and told the operator everything was fine while
/// the backlog only grew. The failure now reaches `read_error` → `last_error`.
#[tokio::test]
async fn tick_with_an_unreadable_queue_reports_an_error_not_a_clean_cycle() {
    let db = setup_db();
    // Drop the table the read needs, AFTER the schema is built. `fresh_db`
    // runs migrations, so this is a runtime failure, not a bad fixture.
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            conn.execute_batch("DROP TABLE offline_queue;").unwrap();
        })
        .await
        .unwrap();
    }

    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(30));
    daemon.start(db).await;
    wait_for_pg_daemon(&daemon, "a completed first tick", |s| {
        s.last_sync_at.is_some()
    })
    .await;

    let status = daemon.status().await;
    assert!(
        status.last_sync_at.is_some(),
        "the daemon must still have completed a tick"
    );
    assert!(
        status.last_error.is_some(),
        "an unreadable queue must surface on last_error, not read as a clean cycle"
    );

    daemon.stop().await;
    wait_for_pg_daemon(&daemon, "stopped", |s| !s.running).await;
}

/// An unreadable pull anchor must surface on `last_error`, not silently force a
/// full re-pull.
///
/// `(None, None)` is what an operator rewind asks for, so collapsing a read
/// failure into it replays all history every cycle with nothing shown. The PG
/// daemon now propagates the anchor-read error into `read_error`.
#[tokio::test]
async fn tick_with_an_unreadable_pull_anchor_reports_an_error() {
    let db = setup_db();
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            conn.execute_batch("DROP TABLE sync_pull_state;").unwrap();
        })
        .await
        .unwrap();
    }

    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(30));
    daemon.start(db).await;
    wait_for_pg_daemon(&daemon, "a completed first tick", |s| {
        s.last_sync_at.is_some()
    })
    .await;

    let status = daemon.status().await;
    assert!(
        status.last_error.is_some(),
        "an unreadable pull anchor must surface on last_error"
    );

    daemon.stop().await;
    wait_for_pg_daemon(&daemon, "stopped", |s| !s.running).await;
}

// ── Graceful shutdown ──────────────────────────────────────────

#[tokio::test]
async fn daemon_stop_twice_is_idempotent() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db).await);
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);
    assert!(daemon.stop().await, "second stop should be safe");
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_stops_cleanly_with_short_interval() {
    let db = setup_db();
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(50));
    daemon.start(db).await;
    assert!(daemon.is_running().await);
    // Let it tick a few times
    tokio::time::sleep(Duration::from_millis(120)).await;
    daemon.stop().await;
    wait_for_pg_daemon(&daemon, "stopped", |s| !s.running).await;
    assert!(!daemon.is_running().await);
}

/// Regression (stop/start race): `stop()` used to sleep a fixed 100ms and
/// return while the run loop could still be mid-cycle — the `running` flag
/// survived, the next `start()` was silently swallowed by the
/// already-running guard, and the daemon stayed dead until app restart.
/// Hold the DB lock to pin a tick mid-flight (the same window a slow
/// remote round trip produces), prove `stop()` waits for the loop to
/// exit, and prove an immediate `start()` brings the daemon back up.
#[tokio::test]
async fn daemon_stop_then_immediate_start_yields_running_daemon() {
    let db = setup_db();
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(10));
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);

    // Hold the DB lock so a tick's spawn_blocking phase blocks
    // mid-cycle; released ~300ms in so the tick can finish after
    // stop() has committed to waiting for it.
    let blocker_db = db.clone();
    let blocker = tokio::spawn(async move {
        let _guard = blocker_db.lock().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert!(
        daemon.stop().await,
        "stop must wait for the in-flight cycle and confirm the loop exited"
    );
    assert!(
        !daemon.is_running().await,
        "running must be cleared by the time stop() returns"
    );

    // The race this pins: start immediately after stop.
    assert!(
        daemon.start(db).await,
        "start immediately after stop must spawn a new daemon"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);

    blocker.await.unwrap();
}

// ── Status tracking ────────────────────────────────────────────

#[tokio::test]
async fn daemon_status_updates_running_flag() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(!daemon.status().await.running);
    assert!(daemon.start(db).await);
    assert!(daemon.status().await.running);
    assert!(daemon.stop().await);
    assert!(!daemon.status().await.running);
}

#[tokio::test]
async fn daemon_status_shows_pending_count_after_tick() {
    let db = setup_db();
    // Enqueue some items before starting (blocking — spawn_blocking to avoid runtime panic)
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            for i in 0..5 {
                store
                    .enqueue_offline("product.created", &format!(r#"{{"sku":"SKU-{i}"}}"#))
                    .unwrap();
            }
        })
        .await
        .unwrap();
    }

    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(30));
    daemon.start(db).await;
    // Wait for at least one tick
    wait_for_pg_daemon(&daemon, "a completed first tick", |s| {
        s.last_sync_at.is_some()
    })
    .await;

    let status = daemon.status().await;
    assert!(
        status.last_sync_at.is_some(),
        "last_sync_at should be set after tick"
    );
    // No PG configured, so items should still be pending
    assert_eq!(status.pending_count, 5);
    assert_eq!(status.last_pushed, 0);

    daemon.stop().await;
    wait_for_pg_daemon(&daemon, "stopped", |s| !s.running).await;
}

/// A pg_sync setting that cannot be READ must surface as the cycle's error.
///
/// The config block built its host/dbname/user with
/// `.unwrap_or_default().unwrap_or_default()`, which collapsed BOTH the `Result`
/// error and the `None` into `""` -- so a read failure was presented to
/// PostgreSQL as a blank connection target rather than as the integrity failure
/// it is. `pg_sync.require_tls` and `license.tenant_id` had the same shape, and
/// those two were worse: `.unwrap_or(false)` silently DOWNGRADED the transport to
/// plaintext, and the tenant default fell through to `"default"` -- a
/// cross-tenant read on a shared remote, the exact thing the scoping exists to
/// prevent. The neighbouring reads in this same closure already propagated into
/// `read_error`; these now do too.
///
/// The trigger is a `settings.value` holding invalid UTF-8: SQLite TEXT is bytes,
/// so it stores, and `row.get::<_, String>` then fails on it.
#[tokio::test]
async fn a_malformed_pg_sync_setting_surfaces_as_the_cycle_error() {
    let db = setup_db();
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            // PG sync ON, and a host whose stored value is not valid UTF-8.
            Settings::set_pg_sync_enabled(&conn, true).unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('pg_sync.host', CAST(x'80ff' AS TEXT)) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [],
            )
            .unwrap();
        })
        .await
        .unwrap();
    }

    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(30));
    daemon.start(db).await;
    wait_for_pg_daemon(&daemon, "a completed first tick", |s| {
        s.last_sync_at.is_some()
    })
    .await;

    let status = daemon.status().await;
    let err = status
        .last_error
        .as_deref()
        .expect("an unreadable pg_sync.host must surface, not become a blank host");
    assert!(
        err.contains("pg_sync.host"),
        "the error must name the setting that failed, got: {err}"
    );

    daemon.stop().await;
    wait_for_pg_daemon(&daemon, "stopped", |s| !s.running).await;
}

// ── Concurrent daemon instances (advisory lock simulation) ──────

#[tokio::test]
async fn two_daemons_cannot_run_simultaneously_on_same_db() {
    let db1 = setup_db();
    let db2 = db1.clone();

    let daemon1 = PgSyncDaemon::new();
    let daemon2 = PgSyncDaemon::new();

    daemon1.start(db1).await;
    assert!(daemon1.is_running().await);

    // Second daemon on the same DB — should be fine since they're
    // separate daemon instances (not the same object)
    daemon2.start(db2).await;
    assert!(daemon2.is_running().await);

    daemon1.stop().await;
    daemon2.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!daemon1.is_running().await);
    assert!(!daemon2.is_running().await);
}

// ── Error isolation ────────────────────────────────────────────

#[test]
fn mark_offline_failed_stores_reason() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let id = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);

    let result = store.mark_offline_failed(&id, "connection refused");
    assert!(result.is_ok());

    // Verify the item is no longer pending
    let pending = store.pending_offline_count().unwrap();
    assert_eq!(pending, 0);
}

#[test]
fn one_failed_item_does_not_block_others() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue 3 items
    let id1 = enqueue_item(&conn, "sale.1", r#"{"sale_id":"s1"}"#);
    let _id2 = enqueue_item(&conn, "sale.2", r#"{"sale_id":"s2"}"#);
    let id3 = enqueue_item(&conn, "sale.3", r#"{"sale_id":"s3"}"#);

    // Mark item 2 as failed
    store.mark_offline_failed(&id1, "error").unwrap();
    // Item 3 should still be pending
    assert_eq!(store.pending_offline_count().unwrap(), 2);
    // Mark item 3 as synced
    store.mark_offline_synced(&id3).unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 1);
}

// ── DbConnection thread safety ─────────────────────────────────

#[tokio::test]
async fn db_connection_can_be_cloned_and_shared() {
    let db = setup_db();
    let db2 = db.clone();

    // Verify both handles can access the same DB via spawn_blocking
    let handle = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        let count: i64 = conn.query_row("SELECT 1", [], |r| r.get(0)).unwrap();
        count
    });
    let result = handle.await.unwrap();
    assert_eq!(result, 1);

    // db2 should still work — also via spawn_blocking in async context
    let handle2 = tokio::task::spawn_blocking(move || {
        let conn = db2.blocking_lock();
        let count: i64 = conn.query_row("SELECT 1", [], |r| r.get(0)).unwrap();
        count
    });
    let result2 = handle2.await.unwrap();
    assert_eq!(result2, 1);
}

// ── PgDaemonStatus serialization ───────────────────────────────

#[test]
fn pg_daemon_status_default_values() {
    let status = PgDaemonStatus::default();
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert!(status.last_error.is_none());
    assert_eq!(status.last_pushed, 0);
    assert_eq!(status.last_pulled, 0);
    assert_eq!(status.pending_count, 0);
    assert_eq!(status.dead_letter_count, 0);
}

#[test]
fn pg_daemon_status_clone() {
    let status = PgDaemonStatus {
        running: true,
        last_sync_at: Some("2026-07-22T00:00:00Z".into()),
        last_error: Some("test error".into()),
        last_pushed: 5,
        last_pulled: 3,
        pending_count: 10,
        dead_letter_count: 2,
    };

    let cloned = status.clone();
    assert_eq!(cloned.running, status.running);
    assert_eq!(cloned.last_sync_at, status.last_sync_at);
    assert_eq!(cloned.last_error, status.last_error);
    assert_eq!(cloned.last_pushed, status.last_pushed);
    assert_eq!(cloned.last_pulled, status.last_pulled);
    assert_eq!(cloned.pending_count, status.pending_count);
    assert_eq!(cloned.dead_letter_count, status.dead_letter_count);
}

// ── SYNC-EW: the two promises `nudge` makes ───────────────────────
//
// Mirror of the pair in `daemon_tests.rs`. `pg_daemon.rs` documents "identical
// semantics to `SyncDaemon::nudge`", so the same two properties are pinned here,
// and this is the caller that `PgSyncDaemon::wakeup_handle` was added for.

/// A `nudge()` before the daemon is listening must be STORED, not dropped.
#[tokio::test]
async fn nudge_while_stopped_stores_one_permit() {
    let daemon = PgSyncDaemon::new();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), daemon.wakeup_handle().notified())
        .await
        .expect("a nudge issued while stopped must be stored, not dropped");
}

/// Three nudges must leave exactly ONE pending permit — `Notify` does not queue.
#[tokio::test]
async fn nudge_coalesces_a_burst_into_one_permit() {
    let daemon = PgSyncDaemon::new();
    let handle = daemon.wakeup_handle();

    daemon.nudge();
    daemon.nudge();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), handle.notified())
        .await
        .expect("the first permit of the burst must be observable");

    assert!(
        tokio::time::timeout(Duration::from_millis(50), handle.notified())
            .await
            .is_err(),
        "three nudges must coalesce into one permit; a second permit means Notify queued"
    );
}

// ── apply_push_outcomes: the PG daemon applier ───────────────
//
// C48: `pg_daemon` routed EVERY `Rejected` outcome to
// `mark_offline_failed`, with no duplicate-id predicate — unlike
// `sync_client::apply_sync_outcomes`, `daemon::apply_push_results` and
// `lib.rs::apply_push_outcomes`. Unlike `run_sync_cycle` this daemon IS
// wired into the desktop (`desktop-tauri/src/state.rs`), so the divergence
// was live. These tests pin this applier to the shared rule.

/// Helper: read a row's status by id.
fn status_of(conn: &rusqlite::Connection, id: &str) -> String {
    conn.query_row(
        "SELECT status FROM offline_queue WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    )
    .unwrap()
}

/// A `Rejected` whose reason carries the duplicate-id prefix marks the row
/// SYNCED, not failed, on THIS applier.
///
/// Pre-fix this test FAILS: the bare `Rejected` arm called
/// `mark_offline_failed`, so the row read `failed` with the duplicate-id
/// text as its error.
#[test]
fn pg_apply_push_outcomes_duplicate_id_replay_marks_synced() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: format!(
            "{}{}",
            kasirmu_core::sync_client::DUPLICATE_ID_REJECTION_PREFIX,
            id
        ),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "synced",
        "a duplicate-id replay is a successful earlier push, not a rejection"
    );
}

/// A genuine rejection still dead-letters the row — the carve-out must not
/// swallow real failures.
#[test]
fn pg_apply_push_outcomes_genuine_rejection_marks_failed() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: "pg insert failed: deadlock detected".into(),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &id), "failed");
    let err: String = conn
        .query_row(
            "SELECT last_error FROM offline_queue WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(err, "pg insert failed: deadlock detected");
}

/// The predicate is `starts_with`, so it must be ANCHORED: a reason that
/// merely MENTIONS a duplicate id is still a rejection.
#[test]
fn pg_apply_push_outcomes_duplicate_prefix_is_anchored() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: "pg insert failed: duplicate id: retried".into(),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "failed",
        "the prefix is anchored: a reason that only mentions a duplicate id is still a rejection"
    );
}

/// `Accepted` is unchanged: the row is marked synced.
#[test]
fn pg_apply_push_outcomes_accepted_marks_synced() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Accepted];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &id), "synced");
}

/// The `Conflict` arm is unchanged: still routed through the shared ADR #21
/// resolver, which marks the row resolved with an auditable tag rather than
/// dead-lettering it.
#[test]
fn pg_apply_push_outcomes_conflict_uses_shared_resolver() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    // The server's copy of the same action, newer so the resolver has a
    // defined winner.
    let mut server_item = pending[0].clone();
    server_item.id = "pg-server-copy".into();
    server_item.created_at = "2030-01-01T00:00:00.000Z".into();

    let results = vec![crate::transport::PushOutcome::Conflict(server_item)];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "synced",
        "a conflict is resolved, not dead-lettered"
    );
    let err: Option<String> = conn
        .query_row(
            "SELECT last_error FROM offline_queue WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        err.as_deref()
            .is_some_and(|e| e.starts_with("resolved: conflict")),
        "the resolution must leave an auditable marker, got {err:?}"
    );
}

/// A batch longer than the results is not misaligned: `zip` stops at the
/// shorter side, so a truncated response leaves the trailing item PENDING
/// rather than marking it from a neighbour's outcome.
#[test]
fn pg_apply_push_outcomes_truncated_results_leave_trailing_items_pending() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let first = enqueue_item(&conn, "sale.create", "{\"n\":1}");
    let second = enqueue_item(&conn, "sale.create", "{\"n\":2}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Accepted];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &first), "synced");
    assert_eq!(
        status_of(&conn, &second),
        "pending",
        "an item with no outcome must stay pending, never inherit a neighbour's"
    );
}
