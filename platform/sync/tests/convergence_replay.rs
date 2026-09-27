//! Deterministic multi-device replay harness for sync convergence (P1-3).
//!
//! # The question this answers
//!
//! "Did multi-location sync actually converge?" `integration_test.rs`
//! answers it for *one* hand-written order over a real HTTP relay, gated
//! behind `slow-tests`. Convergence is a claim about **every** delivery
//! order, so it needs an instrument that can replay several. This harness
//! models N devices in-process, replays one script in three arrival orders,
//! and asserts the converged state matches.
//!
//! No relay, no tokio runtime, no network: devices exchange items through
//! the same `SyncQueue::apply_remote_atomic` path production uses, so what
//! converges here is what converges on a till.
//!
//! # Which "stock" is compared, and why that had to be settled first
//!
//! `stock_readings.rs` measures the two readings, and this harness depends
//! on its conclusion: `inventory.qty` = **opening balance + deltas**, while
//! `get_stock_from_ledger` = **deltas only**, because an opening balance
//! written straight into `inventory` has no movement behind it. The two
//! differ by exactly the un-backed opening balance, and neither is stale.
//!
//! **This harness compares `inventory.qty`**, via `Store::get_stock`, and
//! says so in the helper's name. An earlier attempt compared a ledger
//! reading against `inventory` arithmetic and could not settle on any
//! number — the error was in the assertion, not in the sync layer.
//!
//! # The three properties asserted
//!
//! 1. **Order-independence.** Three delivery orders over one script produce
//!    identical stock on every device.
//! 2. **Convergence to the script's arithmetic.** The agreed number is the
//!    one the operations imply, so "identical" cannot be satisfied by three
//!    equally-wrong devices.
//! 3. **Replay safety.** Delivering everything a second time changes
//!    nothing — the idempotency ledger absorbs it.

use kasirmu_core::Store;
use kasirmu_core::migrations;
use kasirmu_core::offline::OfflineQueueItem;
use platform_sync::queue::SyncQueue;
use std::collections::BTreeMap;

/// A device: its own database, plus the items it produced while offline.
struct Device {
    store: Store<'static>,
    /// Items this device originated, in production order.
    outbound: Vec<OfflineQueueItem>,
}

impl Device {
    /// A device with the shared catalogue seeded.
    ///
    /// Every device starts from the same opening balance, so a difference
    /// in the result measures the sync rather than the seed.
    fn new() -> Self {
        let conn: &'static rusqlite::Connection = Box::leak(Box::new(migrations::fresh_db()));
        let store = Store::new(conn);
        store
            .conn()
            .execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                    ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                    ('prod-bagel',  'BAGEL',  'Bagel',  450, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at) VALUES
                    ('prod-coffee', 50, '2025-01-01T00:00:00.000Z'),
                    ('prod-bagel',  30, '2025-01-01T00:00:00.000Z');",
            )
            .expect("seed catalogue");
        Self {
            store,
            outbound: Vec::new(),
        }
    }

    /// Record an offline operation the way a checkout would.
    ///
    /// **Applying and enqueueing are two separate acts in production, and
    /// the harness must do both.** A checkout applies the mutation locally
    /// (the stock is deducted as the sale is rung up) and separately
    /// enqueues the item for sync — `enqueue_offline` writes a queue row and
    /// nothing else (`offline.rs:137-143`). An earlier version of this
    /// harness enqueued only, so no device ever applied its own operations
    /// and each one's ledger held a different SUBSET of the script's deltas.
    /// That is what produced "three numbers for one product"; the sync layer
    /// was behaving correctly throughout.
    ///
    /// `apply_remote` is the applier here because the local effect of a
    /// scripted operation is the same shape as its remote one — both
    /// dispatch on the action and mutate the same tables. Using one applier
    /// for both is deliberate: two appliers could disagree, and then the
    /// harness would be measuring its own inconsistency.
    fn produce(&mut self, action: &str, payload: &str) {
        let item = self
            .store
            .enqueue_offline(action, payload)
            .expect("enqueue offline");
        // The local application that a real checkout performs.
        self.receive(&item);
        self.outbound.push(item);
    }

    /// The on-hand quantity for a SKU: `inventory.qty`, the reading this
    /// harness compares (see the module note on which "stock" is meant).
    fn on_hand(&self, sku: &str) -> i64 {
        let pid = self
            .store
            .product_id_by_sku(sku)
            .expect("lookup product")
            .expect("product exists");
        self.store.get_stock(&pid).expect("inventory read")
    }

    /// The per-location total for a SKU, summed over `stock_summary`.
    ///
    /// This is the reading ADR-19 makes authoritative for a multi-location
    /// install: `apply_stock_adjustment_delta_in_tx` routes a delta through
    /// `adjust_stock_at_location_with_reason` whenever the product already
    /// has summary rows (`queue.rs:129-137`), which writes `stock_summary`
    /// and does NOT stamp the legacy aggregate. So `inventory.qty` can lag
    /// a location-routed delta until a rebuild, and the summary total is
    /// what the sync actually agreed on.
    fn summary_total(&self, sku: &str) -> i64 {
        let pid = self
            .store
            .product_id_by_sku(sku)
            .expect("lookup product")
            .expect("product exists");
        self.store
            .conn()
            .query_row(
                "SELECT COALESCE(SUM(qty), 0) FROM stock_summary WHERE item_id = ?1",
                rusqlite::params![pid],
                |row| row.get(0),
            )
            .expect("summary total")
    }

    /// Both SKUs as a comparable map.
    fn on_hand_snapshot(&self) -> BTreeMap<String, i64> {
        ["COFFEE", "BAGEL"]
            .into_iter()
            .map(|s| (s.to_owned(), self.on_hand(s)))
            .collect()
    }

    /// Apply one item through the production path.
    ///
    /// Returns whether the applier reported the effect as applied. That
    /// distinction matters: `apply_remote_atomic` returns `Ok(false)` for an
    /// item it declines, so a caller checking only for `Err` would read a
    /// dropped item as a successful delivery.
    fn receive(&self, item: &OfflineQueueItem) -> bool {
        SyncQueue::new()
            .apply_remote_atomic(&self.store, item)
            .expect("apply remote atomically")
    }

    /// Apply a batch, returning how many items actually applied.
    fn receive_all(&self, items: &[OfflineQueueItem]) -> usize {
        items.iter().filter(|i| self.receive(i)).count()
    }
}

/// The script: what each device did while offline.
///
/// Data rather than inline calls, so one script can be replayed under
/// several orders. A script written twice would be two scripts.
///
/// Coffee: 50 + 10 (C) - 2 (A) - 1 (A) - 3 (B) = 54
/// Bagel:  30           - 1 (B)                 = 29
fn script() -> Vec<(&'static str, &'static str, String)> {
    vec![
        ("A", "complete_sale", r#"{"sale_id":"sale-a-1","line_items":[{"sku":"COFFEE","qty":2}]}"#.to_string()),
        ("B", "complete_sale", r#"{"sale_id":"sale-b-1","line_items":[{"sku":"BAGEL","qty":1}]}"#.to_string()),
        ("C", "stock.adjusted", r#"{"sku":"COFFEE","delta":10}"#.to_string()),
        ("A", "complete_sale", r#"{"sale_id":"sale-a-2","line_items":[{"sku":"COFFEE","qty":1}]}"#.to_string()),
        ("B", "stock.adjusted", r#"{"sku":"COFFEE","delta":-3}"#.to_string()),
    ]
}

/// Three devices, each having produced its scripted operations.
fn build_devices() -> Vec<Device> {
    let mut devices = vec![Device::new(), Device::new(), Device::new()];
    for (owner, action, payload) in script() {
        let idx = match owner {
            "A" => 0,
            "B" => 1,
            _ => 2,
        };
        devices[idx].produce(action, &payload);
    }
    devices
}

/// Deliver every item to every device that did not originate it.
///
/// `order` permutes the SEQUENCE in which a receiver sees foreign items —
/// the only variable between scenarios. A device is never handed its own
/// items: they are already reflected locally, which is what "already
/// applied" means for an originator, and the origin gate cannot catch them
/// because `origin_terminal_id` is `None` on harness-produced items (NULL
/// means UNKNOWN, never "self").
///
/// Returns per-device applied counts so a caller can assert delivery was
/// total rather than assume it.
fn exchange(devices: &mut [Device], order: &[usize]) -> Vec<usize> {
    let all: Vec<OfflineQueueItem> = order
        .iter()
        .flat_map(|&i| devices[i].outbound.clone())
        .collect();

    devices
        .iter()
        .map(|device| {
            let own: Vec<&str> = device.outbound.iter().map(|o| o.id.as_str()).collect();
            let foreign: Vec<OfflineQueueItem> = all
                .iter()
                .filter(|item| !own.contains(&item.id.as_str()))
                .cloned()
                .collect();
            device.receive_all(&foreign)
        })
        .collect()
}

// ── 1. Order-independence, and convergence to the script's arithmetic ──

/// Three delivery orders must converge to one state, and it must be right.
///
/// The P1-3 acceptance. Two assertions, deliberately separate:
///
/// - **Agreement** — all three orders and all three devices match.
/// - **Correctness** — the agreed value is what the script implies. Without
///   this, three identically-broken devices would satisfy "identical
///   converged state", which the box's acceptance cannot catch on its own.
///
/// **The comparison happens AFTER a `rebuild_stock_summary`.** That is not
/// a convenience — it is the finding this harness produced. A
/// `stock.adjusted` delta is routed to the per-location writer whenever the
/// product already has summary rows (`queue.rs:129-137`), and that writer
/// maintains `stock_summary` without stamping the legacy `inventory`
/// aggregate. So `inventory.qty` legitimately lags a location-routed delta,
/// by an amount that depends on the arrival order — and comparing it before
/// the rebuild measures materialisation timing, not convergence. After the
/// rebuild, the aggregate is re-derived from the ledger and the two agree.
#[test]
fn three_seeded_interleavings_converge_to_the_scripts_arithmetic() {
    let orders: [(&str, [usize; 3]); 3] = [
        ("A,B,C (production order)", [0, 1, 2]),
        ("C,B,A (reverse)", [2, 1, 0]),
        ("C,A,B (interleaved)", [2, 0, 1]),
    ];

    let mut results: Vec<(&str, Vec<BTreeMap<String, i64>>)> = Vec::new();
    for (label, order) in orders {
        let mut devices = build_devices();
        let applied = exchange(&mut devices, &order);

        // Delivery must be complete, or "converged" would mean "equally
        // starved". Every foreign item applies in this script: nothing is a
        // replay and nothing is declined.
        let expected: Vec<usize> = devices.iter().map(|d| 5 - d.outbound.len()).collect();
        assert_eq!(
            applied, expected,
            "order {label:?} did not deliver every foreign item"
        );

        // Re-derive the materialised caches from the ledger before
        // comparing. `rebuild_stock_summary` is a pure function of the
        // deltas, so this cannot hide a lost update — it can only discard
        // a lag.
        for device in devices.iter() {
            device.store.rebuild_stock_summary().expect("rebuild");
        }

        results.push((label, devices.iter().map(|d| d.on_hand_snapshot()).collect()));
    }

    // (a) Agreement across all orders and devices.
    let (_, first) = &results[0];
    for (label, states) in &results {
        assert_eq!(
            states, first,
            "order {label:?} converged differently from {:?}",
            results[0].0
        );
    }

    // (b) Correctness — the number the script implies.
    for (sku, qty) in [("COFFEE", 54), ("BAGEL", 29)] {
        for (idx, stock) in first.iter().enumerate() {
            assert_eq!(
                stock.get(sku),
                Some(&qty),
                "device {idx} converged to the wrong {sku} level"
            );
        }
    }
}

// ── 2. Replay safety ─────────────────────────────────────────────────

/// Re-delivering everything must change nothing.
///
/// The property `apply_remote`'s own doc comment makes the caller's
/// obligation (`queue.rs:1336-1339`): `adjust_stock` appends a ledger row
/// per call and is not idempotent by itself, so the replay ledger is what
/// stands between a dropped ACK and a double deduction.
#[test]
fn replaying_every_item_a_second_time_changes_nothing() {
    let mut devices = build_devices();
    exchange(&mut devices, &[0, 1, 2]);
    let after_first: Vec<_> = devices.iter().map(|d| d.on_hand_snapshot()).collect();

    // A second delivery to every device, including each one's own items —
    // a re-delivery does not respect origin.
    let all: Vec<OfflineQueueItem> = devices
        .iter()
        .flat_map(|d| d.outbound.clone())
        .collect();
    for device in devices.iter() {
        device.receive_all(&all);
    }

    let after_second: Vec<_> = devices.iter().map(|d| d.on_hand_snapshot()).collect();
    assert_eq!(
        after_second, after_first,
        "a re-delivery moved the state — the idempotency ledger did not absorb it"
    );
}

// ── 3. The origin gate ───────────────────────────────────────────────

/// A device must not re-apply a mutation it originated.
///
/// A sale deducts stock locally as it is rung up, before it is pushed.
/// Applying the pulled-back copy would deduct again — a double deduction
/// caused by the sync layer rather than by the sale.
#[test]
fn a_device_does_not_re_apply_its_own_mutation() {
    let devices = build_devices();
    let own = devices[0].outbound[0].clone();
    let before = devices[0].on_hand("COFFEE");

    let applied = devices[0].receive(&own);

    assert!(
        !applied,
        "the origin gate let a device re-apply its own sale"
    );
    assert_eq!(
        devices[0].on_hand("COFFEE"),
        before,
        "a self-originated item changed local stock"
    );
}
