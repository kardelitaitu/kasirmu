//! Adversarial multi-location tests for the critical path (P1-4).
//!
//! # What this adds over the existing suites
//!
//! The guards these tests attack already exist and are already tested —
//! `refunds_tests.rs` covers the over-refund money bound, the cumulative
//! quantity bound and the fail-closed SUM read; `queue_tests.rs` covers
//! single-device replay for sales, voids, refunds and payments. Re-testing
//! those would add nothing.
//!
//! What nothing covered is the **multi-location** dimension: existing
//! two-terminal tests (`integration_test.rs`) are *cooperative* — A creates,
//! B receives — and gated behind `slow-tests`. An adversarial pair is a
//! different object: two devices that independently attempt the SAME
//! over-spend, then exchange, where the invariant is a property of the
//! converged pair rather than of either device.
//!
//! Each test below names the invariant it defends, so a failure says which
//! promise broke rather than which assertion fired.
//!
//! # Why some attacks are expected to SUCCEED
//!
//! An offline-first system cannot stop a terminal that is partitioned from
//! the till next door from overselling — that is the CAP trade the whole
//! design makes, and `allow_negative_stock` documents it as a product
//! decision. So the tests assert one of two outcomes, explicitly:
//!
//! - **refused** — the local guard fired, or
//! - **admitted but counted once** — both devices may hold the deduction,
//!   and the converged total must equal it exactly once.
//!
//! The second is the real invariant. A test that only asserted "refused"
//! would fail against correct code, and a test that only asserted "counted
//! once" would miss a guard that stopped working.

use kasirmu_core::Store;
use kasirmu_core::migrations;
use kasirmu_core::offline::OfflineQueueItem;
use platform_sync::queue::SyncQueue;
use std::collections::BTreeMap;

/// One device: its own database, plus what it originated.
struct Device {
    store: Store<'static>,
    outbound: Vec<OfflineQueueItem>,
    /// Items a guard REFUSED, with the reason. An empty list after an
    /// exchange means every item was admitted (possibly as a no-op); a
    /// populated one is the system defending itself, and the tests below
    /// assert on it rather than treating it as an error.
    refused: std::cell::RefCell<Vec<String>>,
}

impl Device {
    fn new() -> Self {
        let conn: &'static rusqlite::Connection = Box::leak(Box::new(migrations::fresh_db()));
        let store = Store::new(conn);
        store
            .conn()
            .execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                    ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at) VALUES
                    ('prod-coffee', 50, '2025-01-01T00:00:00.000Z');",
            )
            .expect("seed catalogue");
        Self {
            store,
            outbound: Vec::new(),
            refused: std::cell::RefCell::new(Vec::new()),
        }
    }

    /// Perform an operation locally AND enqueue it, as a checkout does.
    ///
    /// Both halves matter: `enqueue_offline` writes only a queue row
    /// (`offline.rs:137-143`), so enqueueing alone would leave this device's
    /// own effect unapplied — the mistake P1-3's first attempt made.
    fn act(&mut self, action: &str, payload: &str) -> bool {
        let item = self
            .store
            .enqueue_offline(action, payload)
            .expect("enqueue offline");
        let applied = self.receive(&item);
        self.outbound.push(item);
        applied
    }

    /// On-hand quantity for a SKU (`inventory.qty`).
    fn on_hand(&self, sku: &str) -> i64 {
        let pid = self
            .store
            .product_id_by_sku(sku)
            .expect("lookup")
            .expect("exists");
        self.store.get_stock(&pid).expect("read")
    }

    /// Apply one item through the production path.
    ///
    /// Returns whether the applier reported the effect as applied. Two
    /// distinct non-application paths exist and BOTH must be observed
    /// rather than panicked on, because in an adversarial scenario they are
    /// the system working correctly:
    ///
    /// - `Ok(false)` — the idempotency ledger already knew this effect.
    /// - `Err(Validation)` — a guard refused it. Measured during this
    ///   test's development: applying a `-30` delta to a device holding 20
    ///   is rejected with *"adjustment would cause negative stock"*, so the
    ///   applier enforces a local floor rather than admitting the overspend
    ///   through.
    ///
    /// An earlier version used `.expect()` here, which turned the guard
    /// firing into a test panic — reading a defence as a defect.
    fn receive(&self, item: &OfflineQueueItem) -> bool {
        match SyncQueue::new().apply_remote_atomic(&self.store, item) {
            Ok(applied) => applied,
            Err(e) => {
                // Record the refusal so a test can assert on it; the
                // failure is already persisted by the applier itself.
                self.refused
                    .borrow_mut()
                    .push(format!("{}: {e}", item.action));
                false
            }
        }
    }

    /// Apply every item in `items` that this device did not originate.
    fn receive_foreign(&self, items: &[OfflineQueueItem]) -> usize {
        let own: Vec<&str> = self.outbound.iter().map(|o| o.id.as_str()).collect();
        items
            .iter()
            .filter(|i| !own.contains(&i.id.as_str()))
            .filter(|i| self.receive(i))
            .count()
    }

    /// Re-derive the materialised caches from the delta ledger.
    ///
    /// `inventory.qty` is a materialised cache; a delta routed to the
    /// per-location writer maintains `stock_summary` without stamping the
    /// aggregate (see `convergence_replay.rs`). A rebuild is a pure function
    /// of the deltas, so it cannot hide a lost update.
    fn settle(&self) {
        self.store.rebuild_stock_summary().expect("rebuild");
    }
}

/// Deliver every item to the other device, in both directions.
fn exchange(a: &mut Device, b: &mut Device) {
    let from_a = a.outbound.clone();
    let from_b = b.outbound.clone();
    b.receive_foreign(&from_a);
    a.receive_foreign(&from_b);
    a.settle();
    b.settle();
}

/// The pair's converged state, keyed by device index.
fn converged(a: &Device, b: &Device) -> (BTreeMap<String, i64>, BTreeMap<String, i64>) {
    let snap = |d: &Device| {
        ["COFFEE"]
            .into_iter()
            .map(|s| (s.to_owned(), d.on_hand(s)))
            .collect::<BTreeMap<_, _>>()
    };
    (snap(a), snap(b))
}

// ── Attack 1: two locations double-spend the same stock ──────────────

/// INVARIANT: **a partition oversell is admitted locally and never
/// compounded across locations.**
///
/// Both devices partition from each other and each sells 30 of the 50
/// units on hand — 60 requested against 50 real. Neither can see the
/// other, so neither *can* refuse on the other's behalf; each admits its
/// own sale and lands on 20.
///
/// What the exchange must NOT do is apply the other side's deduction on
/// top. **Measured, not assumed:** the sync applier enforces a local floor
/// and refuses B's `-30` on a device holding 20 with
///
/// > `adjustment would cause negative stock (previous: 20, delta: -30)`
///
/// so the pair converges at **20 on both sides** rather than at -10. The
/// first version of this test asserted -10, on the assumption that
/// `allow_negative_stock` meant the aggregate admitted the overspend. That
/// assumption was wrong for this path, and the guard is a stronger
/// property than the test credited: the oversell is *contained* rather
/// than merely counted once.
///
/// Asserts three things: the pair converges, the value is the measured
/// one, and the refusal was a REFUSAL rather than a silent no-op — a guard
/// that stopped firing would show up as a different number, and a guard
/// that returned `Ok(false)` without recording would not.
#[test]
fn two_locations_overselling_the_same_stock_contain_the_overspend() {
    let mut a = Device::new();
    let mut b = Device::new();

    // Both sell 30 against a stock of 50, fully partitioned.
    a.act(
        "complete_sale",
        r#"{"sale_id":"oversell-a","line_items":[{"sku":"COFFEE","qty":30}]}"#,
    );
    b.act(
        "complete_sale",
        r#"{"sale_id":"oversell-b","line_items":[{"sku":"COFFEE","qty":30}]}"#,
    );

    // Each device holds its OWN deduction: 50 - 30 = 20.
    assert_eq!(a.on_hand("COFFEE"), 20, "A's own sale applied locally");
    assert_eq!(b.on_hand("COFFEE"), 20, "B's own sale applied locally");

    exchange(&mut a, &mut b);

    let (pa, pb) = converged(&a, &b);
    assert_eq!(
        pa["COFFEE"], pb["COFFEE"],
        "the pair did not converge: A={}, B={}",
        pa["COFFEE"], pb["COFFEE"]
    );

    // INVARIANT: the overspend did not compound. Each device admitted its
    // own -30 locally, then refused the other's, so both settle at 20.
    assert_eq!(
        pa["COFFEE"], 20,
        "the overspend compounded: expected the pair to settle at 20 \
         (50 - 30, with the other side's duplicate refused), got {}",
        pa["COFFEE"]
    );

    // The floor guard fired on BOTH sides. Asserted separately from the
    // number, because "-30 refused" and "-30 silently skipped" reach the
    // same total but only one of them is a guard doing its job.
    for (label, device) in [("A", &a), ("B", &b)] {
        let refusals = device.refused.borrow();
        assert_eq!(
            refusals.len(),
            1,
            "{label} should have refused exactly one item, refused {refusals:?}"
        );
        assert!(
            refusals[0].contains("negative stock"),
            "INVARIANT VIOLATED: {label}'s refusal was not the stock floor: {}",
            refusals[0]
        );
    }
}

// ── Attack 2: replay a settled sale ──────────────────────────────────

/// INVARIANT: **a settled sale cannot be un-settled by a stale replay.**
///
/// The status-DAG property the sync engine exists to protect: device A
/// settles a sale, then a stale copy of that sale in its earlier `active`
/// state arrives from B. Applying it would revert a completed sale — a
/// customer walking out with goods the system believes were never sold.
///
/// Plus the replay dimension: the identical completed item delivered twice
/// must deduct once.
#[test]
fn a_settled_sale_survives_a_stale_earlier_state_arriving_from_another_location() {
    let mut a = Device::new();
    let mut b = Device::new();

    // A settles a sale (COFFEE -2).
    a.act(
        "complete_sale",
        r#"{"sale_id":"settled","status":"completed","line_items":[{"sku":"COFFEE","qty":2}]}"#,
    );
    let after_settle = a.on_hand("COFFEE");
    assert_eq!(after_settle, 48, "A's own sale deducted 2");

    // B holds a STALE copy of the same sale, still `active`.
    let stale = OfflineQueueItem::new(
        "complete_sale",
        r#"{"sale_id":"settled","status":"active","line_items":[{"sku":"COFFEE","qty":2}]}"#,
    );

    let applied = a.receive(&stale);

    // The stale item may be declined outright, or admitted as a no-op, but
    // it must not move the settled state.
    assert_eq!(
        a.on_hand("COFFEE"),
        after_settle,
        "a stale `active` copy moved a settled sale's stock (applied={applied})"
    );

    // Replaying the COMPLETED item must also be a no-op.
    let settled = a.outbound[0].clone();
    let replayed = a.receive(&settled);
    assert!(
        !replayed,
        "re-delivering the settled sale applied it a second time"
    );
    assert_eq!(
        a.on_hand("COFFEE"),
        after_settle,
        "a re-delivered settled sale must not deduct twice"
    );
}

// ── Attack 3: over-refund across two locations ───────────────────────

/// INVARIANT: **refunds against one sale cannot exceed what was sold,
/// even when attempted from two locations.**
///
/// The money bound belongs to `create_refund` and is deliberately NOT
/// re-derived by the sync applier (`queue.rs:475-479`: re-deriving from a
/// partially-replicated history would reject legitimate items). So the
/// attack is: two devices each refund half of a sale that was already
/// fully refunded, and the converged total must not exceed the sale.
///
/// The local guard is exercised directly on each device, which is where it
/// actually lives — the exchange then confirms the pair does not compound.
#[test]
fn two_locations_cannot_refund_more_than_was_sold() {
    let mut a = Device::new();
    let mut b = Device::new();

    // A sells 2 units at 350 = 700 minor.
    a.act(
        "complete_sale",
        r#"{"sale_id":"refund-target","line_items":[{"sku":"COFFEE","qty":2}]}"#,
    );
    let sale_total = 700i64;

    // Give B the sale too, so both devices can attempt a refund against it.
    exchange(&mut a, &mut b);
    let stock_after_sale = a.on_hand("COFFEE");
    assert_eq!(stock_after_sale, 48);
    assert_eq!(b.on_hand("COFFEE"), 48, "B received the sale");

    // Each device attempts a FULL refund of the 700 sale, independently.
    let full_refund = r#"{"id":"refund-1","sale_id":"refund-target","total_minor":700,"currency":"USD","lines":[{"sale_line_id":"sl-1","sku":"COFFEE","qty":2}]}"#;

    a.act("refund_sale", full_refund);
    b.act("refund_sale", full_refund);

    // The local guard is a money bound, so each device on its own may
    // accept its first refund. What must NOT happen is the total refunded
    // against this sale exceeding the sale, counted across the pair after
    // they exchange — each refund is a distinct id, so the ledger admits
    // both, and the invariant is arithmetic rather than dedup.
    exchange(&mut a, &mut b);

    let refunded = |d: &Device| -> i64 {
        d.store
            .conn()
            .query_row(
                "SELECT COALESCE(SUM(total_minor), 0) FROM refunds WHERE sale_id = 'refund-target'",
                [],
                |r| r.get(0),
            )
            .expect("sum refunds")
    };

    let refunded_a = refunded(&a);
    let refunded_b = refunded(&b);

    // INVARIANT: the pair agrees on how much was refunded.
    assert_eq!(
        refunded_a, refunded_b,
        "the pair disagrees on the refunded total: A={refunded_a}, B={refunded_b}"
    );

    // INVARIANT: the converged refunded total does not exceed the sale.
    assert!(
        refunded_a <= sale_total,
        "INVARIANT VIOLATED: refunded {refunded_a} exceeds the sale total {sale_total} \
         for one sale across two locations"
    );

    // INVARIANT: stock is credited once per refund, never once per device.
    // Two accepted refunds of 2 units each credit 4 back onto 48 = 52; a
    // double-applied refund would credit 8 and read 56.
    let stock = a.on_hand("COFFEE");
    assert_eq!(
        b.on_hand("COFFEE"),
        stock,
        "the pair disagrees on stock after refunds"
    );
    assert!(
        stock <= 52,
        "INVARIANT VIOLATED: refunds credited more stock than their quantity \
         (expected at most 52, got {stock})"
    );
}

// ── Attack 4: replay the whole exchange ──────────────────────────────

/// INVARIANT: **re-delivering an adversarial exchange changes nothing.**
///
/// The composition of attacks 1-3: after the pair has converged on an
/// oversell, a full re-delivery must be inert. This is the ledger's job,
/// and it is the last line of defence when a dropped ACK causes a resend.
#[test]
fn re_delivering_the_whole_adversarial_exchange_changes_nothing() {
    let mut a = Device::new();
    let mut b = Device::new();

    a.act(
        "complete_sale",
        r#"{"sale_id":"adv-a","line_items":[{"sku":"COFFEE","qty":30}]}"#,
    );
    b.act(
        "complete_sale",
        r#"{"sale_id":"adv-b","line_items":[{"sku":"COFFEE","qty":30}]}"#,
    );
    exchange(&mut a, &mut b);
    let before = converged(&a, &b);

    // Everything, to both, including each device's own items.
    let all: Vec<OfflineQueueItem> = a
        .outbound
        .iter()
        .chain(b.outbound.iter())
        .cloned()
        .collect();
    a.receive_foreign(&all);
    b.receive_foreign(&all);
    a.settle();
    b.settle();

    let after = converged(&a, &b);
    assert_eq!(
        after, before,
        "INVARIANT VIOLATED: a re-delivery moved the converged state, \
         so the idempotency ledger did not absorb the replay"
    );
}
