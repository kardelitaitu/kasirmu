//! Divergence suite for the two owners of the ADR-21 PushOutcome::Conflict policy.
//!
//! This suite documents a disagreement between two policy owners - apply_sync_outcomes
//! (the server copy always wins) and SyncQueue::apply_push_conflict (ADR-21 entity
//! dispatch) - for a wire contract with no in-repo producer, and chooses neither. Every
//! assertion message reads UNDECIDED: a green run here records what each owner currently
//! does, it does not endorse either one. The day someone picks a winner, this file is the
//! spec they change, not a wall of green.
//!
//! Both consumers get the SAME input pair: one local queue row (persisted, because both
//! paths mark it resolved by id) plus one server-supplied item. Each observation runs on
//! its own fresh database, so neither consumer can see the other's writes.
//!
//! ACTIVATION (rows 1-6): a server emitting outcome "conflict" for that action. No server
//! in this repository does - every non-test producer in apps/cloud-server/src/sync_store.rs
//! and platform/sync/src/pg_transport.rs constructs only Accepted or Rejected. The
//! divergence is latent until a foreign or older server emits the tag. See
//! docs/decisions/2026-07-20-sync-conflict-resolution-strategy.md, "Activation and
//! Ownership", appended in 1c6949975.

use super::*;
use kasirmu_core::migrations;
use kasirmu_core::sync_client::{PushOutcome, apply_sync_outcomes};
use rusqlite::Connection;

/// The prefix is private to kasirmu_core::sync_client; mirrored so the duplicate-id row fails
/// loudly if the two ever drift apart.
const DUPLICATE_ID_PREFIX: &str = "duplicate id:";

fn setup_store() -> Store<'static> {
    let conn: &'static Connection = Box::leak(Box::new(migrations::fresh_db()));
    Store::new(conn)
}

/// One ADR-21 dispatch class, expressed as the input pair both consumers receive.
struct Case {
    /// The queued action - this is what selects the resolver.
    action: &'static str,
    /// Payload on the local (client) side of the pair.
    local_payload: &'static str,
    /// Payload on the server side of the pair.
    remote_payload: &'static str,
    /// Fixed timestamps so the created_at-LWW rows are deterministic.
    local_created_at: &'static str,
    /// Server-side created_at.
    remote_created_at: &'static str,
    /// The tag apply_resolution writes into last_error for this class.
    c2_tag: &'static str,
    /// Whether the daemon path re-enqueues a merged winner for this class.
    c2_reenqueues: bool,
    /// Human-readable name used in assertion messages.
    label: &'static str,
}

/// What one consumer left behind, read back out of its own database.
struct Observed {
    /// SyncAttemptResult::synced - only the first consumer reports a count.
    reported_synced: usize,
    /// Status of the local row after the outcome was applied.
    local_status: OfflineQueueStatus,
    /// last_error on the local row - where each policy leaves its mark.
    local_error: String,
    /// Rows still pending: the re-enqueue question.
    pending: usize,
    /// The operator-visible conflict counter.
    conflict_count: i64,
}

const NEWER: &str = "2026-09-01T00:00:00.000Z";
const OLDER: &str = "2026-01-01T00:00:00.000Z";

const CASES: &[Case] = &[
    // ACTIVATION: a server emitting the conflict tag for stock.*. The only class
    // where the two owners do different WORK, not just write different tags.
    Case {
        action: "stock.adjusted",
        local_payload: r#"{"sku":"COFFEE","delta":10}"#,
        remote_payload: r#"{"sku":"COFFEE","delta":-3}"#,
        local_created_at: NEWER,
        remote_created_at: OLDER,
        c2_tag: "crdt merge",
        c2_reenqueues: true,
        label: "stock.* (CRDT delta merge)",
    },
    // ACTIVATION: a server emitting the conflict tag for sale.*. The status DAG
    // picks the LOCAL row (completed outranks pending); consumer 1 picks the
    // server copy unconditionally - the stale-remote-reverts-a-completed-sale
    // hazard the DAG exists to prevent.
    Case {
        action: "sale.completed",
        local_payload: r#"{"status":"completed","line_items":[]}"#,
        remote_payload: r#"{"status":"pending","line_items":[]}"#,
        local_created_at: OLDER,
        remote_created_at: NEWER,
        c2_tag: "local won",
        c2_reenqueues: false,
        label: "sale.* (status DAG rank)",
    },
    // ACTIVATION: a server emitting the conflict tag for a version-LWW prefix.
    // Row state AGREES (local row synced, nothing re-enqueued); only the tag and
    // the payload the server ends up holding differ. A test that asserted row
    // state alone would report agreement here where there is a policy difference.
    Case {
        action: "product.updated",
        local_payload: r#"{"sku":"COFFEE","version":7}"#,
        remote_payload: r#"{"sku":"COFFEE","version":3}"#,
        local_created_at: OLDER,
        remote_created_at: NEWER,
        c2_tag: "local won",
        c2_reenqueues: false,
        label: "version-LWW prefix, local version higher",
    },
    // Same class, opposite direction: the two owners pick the SAME side and still
    // write different tags.
    Case {
        action: "product.updated",
        local_payload: r#"{"sku":"COFFEE","version":3}"#,
        remote_payload: r#"{"sku":"COFFEE","version":7}"#,
        local_created_at: NEWER,
        remote_created_at: OLDER,
        c2_tag: "remote won",
        c2_reenqueues: false,
        label: "version-LWW prefix, remote version higher",
    },
    // ACTIVATION: a server emitting the conflict tag for an action no ADR-21
    // prefix matches - the star fallback.
    Case {
        action: "loyalty.redeemed",
        local_payload: r#"{"points":50}"#,
        remote_payload: r#"{"points":20}"#,
        local_created_at: NEWER,
        remote_created_at: OLDER,
        c2_tag: "local won",
        c2_reenqueues: false,
        label: "star fallback (created_at LWW), local newer",
    },
    Case {
        action: "loyalty.redeemed",
        local_payload: r#"{"points":50}"#,
        remote_payload: r#"{"points":20}"#,
        local_created_at: OLDER,
        remote_created_at: NEWER,
        c2_tag: "remote won",
        c2_reenqueues: false,
        label: "star fallback (created_at LWW), remote newer",
    },
];

/// The server side of the pair. A real conflict arrives as a queue-shaped item,
/// so this is the same struct the transport deserialises.
fn server_item(c: &Case) -> OfflineQueueItem {
    OfflineQueueItem {
        created_at: c.remote_created_at.to_string(),
        ..OfflineQueueItem::new(c.action, c.remote_payload)
    }
}

/// Persist the local side and return it carrying the case's fixed timestamp. The
/// timestamp matters only to the resolvers, which read the struct, not the row.
fn enqueue_local(store: &Store<'_>, c: &Case) -> OfflineQueueItem {
    let item = store.enqueue_offline(c.action, c.local_payload).unwrap();
    OfflineQueueItem {
        created_at: c.local_created_at.to_string(),
        ..item
    }
}

fn observe(store: &Store<'_>, local: &OfflineQueueItem) -> Observed {
    let row = store
        .list_all_offline()
        .unwrap()
        .into_iter()
        .find(|i| i.id == local.id)
        .expect("the local row must still exist after either consumer runs");
    let summary = store.offline_queue_status_summary().unwrap();
    Observed {
        reported_synced: 0,
        local_status: row.status,
        local_error: row.last_error.unwrap_or_default(),
        pending: store.list_pending_offline().unwrap().len(),
        conflict_count: summary.conflict_count,
    }
}

/// Consumer 1 - the manual / tablet push path, kasirmu_core::sync_client::apply_sync_outcomes.
fn run_consumer_one(c: &Case) -> Observed {
    let store = setup_store();
    let local = enqueue_local(&store, c);
    let result = apply_sync_outcomes(
        &store,
        std::slice::from_ref(&local),
        &[PushOutcome::Conflict(server_item(c))],
    )
    .unwrap();
    let mut observed = observe(&store, &local);
    observed.reported_synced = result.synced;
    assert_eq!(
        result.failed, 0,
        "UNDECIDED: consumer 1 never counts a conflict as a failure for {}",
        c.label
    );
    observed
}

/// Consumer 2 - the daemon path, SyncQueue::apply_push_conflict into resolve_conflict.
fn run_consumer_two(c: &Case) -> Observed {
    let store = setup_store();
    let local = enqueue_local(&store, c);
    SyncQueue::new()
        .apply_push_conflict(&store, &local, &server_item(c))
        .unwrap();
    observe(&store, &local)
}

/// The table: five ADR-21 classes, both consumers, the same input pair.
#[test]
fn adr21_conflict_consumers_diverge_per_class() {
    for c in CASES {
        let one = run_consumer_one(c);
        let two = run_consumer_two(c);

        // WHERE THEY AGREE - the local row's status. Both owners mark it
        // resolved, which stores as synced. A test that stopped here would call
        // every row in the table a pass.
        assert_eq!(
            one.local_status,
            OfflineQueueStatus::Synced,
            "UNDECIDED: consumer 1 leaves the local row synced for {}",
            c.label
        );
        assert_eq!(
            two.local_status, one.local_status,
            "UNDECIDED: row state agrees for {} - the disagreement is in the tag and the payload, not the status",
            c.label
        );

        // WHERE THEY DISAGREE, ALWAYS - the tag each owner writes.
        assert!(
            one.local_error
                .starts_with("resolved: conflict (server item wins (action="),
            "UNDECIDED: consumer 1's marker for {} is pinned as current behaviour, not as intent - got {:?}",
            c.label,
            one.local_error
        );
        assert!(
            two.local_error
                .starts_with(&format!("resolved: conflict ({})", c.c2_tag)),
            "UNDECIDED: consumer 2 writes the resolver's winner tag for {} - expected {:?}, got {:?}",
            c.label,
            c.c2_tag,
            two.local_error
        );
        assert_ne!(
            one.local_error, two.local_error,
            "UNDECIDED: the two policy owners leave different marks for the same input pair ({})",
            c.label
        );

        // WHERE THEY DISAGREE, SOMETIMES - the re-enqueue. Only the CRDT arm
        // produces a merged winner, and only consumer 2 acts on it.
        assert_eq!(
            one.pending, 0,
            "UNDECIDED: consumer 1 re-enqueues nothing for any class ({}) - a merged delta pair is dropped, not combined",
            c.label
        );
        assert_eq!(
            two.pending,
            usize::from(c.c2_reenqueues),
            "UNDECIDED: consumer 2 re-enqueues the merged winner for stock.* and nothing else ({})",
            c.label
        );

        // THE OBSERVABILITY CLAIM - both owners write the same
        // last_error LIKE 'resolved: conflict%' shape, so the operator-facing
        // conflict_count cannot tell which policy ran.
        assert_eq!(
            one.conflict_count, two.conflict_count,
            "UNDECIDED: conflict_count is identical ({} vs {}) for {} even though the two paths did different things",
            one.conflict_count, two.conflict_count, c.label
        );
        assert_eq!(
            one.conflict_count, 1,
            "UNDECIDED: exactly one resolved-conflict row is counted per consumer for {}",
            c.label
        );
    }
}

/// The one row where the disagreement is not only a tag: stock.*.
#[test]
fn stock_conflict_loses_a_delta_on_one_path_only() {
    let c = &CASES[0];
    let one = run_consumer_one(c);
    let two = run_consumer_two(c);

    assert_eq!(
        one.pending, 0,
        "UNDECIDED: consumer 1 discards the local +10 delta for stock.* - ACTIVATION: a server emitting the conflict tag for stock.*"
    );
    assert_eq!(
        two.pending, 1,
        "UNDECIDED: consumer 2 re-enqueues both deltas for stock.* - ACTIVATION: the same missing server tag"
    );
    assert_eq!(
        one.reported_synced, 1,
        "UNDECIDED: consumer 1 counts the conflict it just resolved as synced, so a dropped delta is invisible in the sync result"
    );
    assert_eq!(
        two.local_error, "resolved: conflict (crdt merge)",
        "UNDECIDED: the merge tag is the only trace consumer 2 leaves that a merge happened at all"
    );
}

/// Dossier item 1 - the missing re-enqueue bound, pinned as CURRENT BEHAVIOUR.
///
/// resolve_stock_crdt computes retry_count = max(local, remote)
/// (platform/sync/src/conflict.rs:167) and carries the local tenant_id, but
/// apply_resolution re-enqueues through Store::enqueue_offline
/// (platform/sync/src/queue.rs:331), which persists action and payload only and
/// builds a fresh row: retry_count 0, tenant "default", and a second new uuid
/// replacing the one the resolver made. A conflict that keeps conflicting
/// therefore resets to zero every cycle, forever, and a multi-store delta
/// re-enqueues under the wrong tenant.
#[test]
fn crdt_merge_reenqueue_discards_retry_count_and_tenant() {
    let store = setup_store();
    let row = store
        .enqueue_offline_with_tenant(CASES[0].action, CASES[0].local_payload, "store-a")
        .unwrap();
    // Drive the retry count up through the real failure path, so the input item
    // is a row the queue could actually have produced.
    for _ in 0..4 {
        store.mark_offline_failed(&row.id, "transient").unwrap();
    }
    let local = store
        .list_all_offline()
        .unwrap()
        .into_iter()
        .find(|i| i.id == row.id)
        .unwrap();
    assert_eq!(local.retry_count, 4, "precondition: a real retried row");
    assert_eq!(
        local.tenant_id, "store-a",
        "precondition: a real scoped row"
    );
    let remote = server_item(&CASES[0]);

    // The resolver does compute the ceiling and does keep the tenant...
    let winner = crate::conflict::resolve_conflict(&local, &remote).winner;
    assert_eq!(
        winner.retry_count, 4,
        "UNDECIDED: resolve_stock_crdt takes max(local, remote) retry_count - conflict.rs:167"
    );
    assert_eq!(
        winner.tenant_id, "store-a",
        "UNDECIDED: the merged winner carries the local tenant"
    );

    // ...and the persistence step throws both away.
    SyncQueue::new()
        .apply_push_conflict(&store, &local, &remote)
        .unwrap();
    let requeued = store.list_pending_offline().unwrap();
    assert_eq!(
        requeued.len(),
        1,
        "the merged winner is the one pending row"
    );
    let requeued = &requeued[0];

    assert_eq!(
        requeued.retry_count, 0,
        "UNDECIDED: the computed max never reaches the database - queue.rs:331 persists action and payload only. This is the missing ceiling, pinned not endorsed"
    );
    assert_eq!(
        requeued.tenant_id, "default",
        "UNDECIDED: a store-a delta re-enqueues under tenant default - same missing persistence, same line"
    );
    assert_ne!(
        requeued.id, winner.id,
        "UNDECIDED: a second fresh uuid replaces the id the resolver built"
    );
}

/// Dossier item 3 - the poison-item nesting, pinned cheaply.
///
/// resolve_stock_crdt wraps whatever payload it is handed, so a second conflict
/// on a merged row nests the envelope. Depth one is consumable (queue.rs
/// unwraps local and remote when merge_type is crdt_delta); depth two is not,
/// because the inner local is itself an envelope and has no sku/delta. That
/// deserialisation failure is the only thing stopping the loop today - there is
/// no depth guard and no warning anywhere.
#[test]
fn nested_crdt_envelope_fails_to_deserialize_at_depth_two() {
    let depth_one = crate::conflict::resolve_stock_crdt(
        &OfflineQueueItem::new("stock.adjusted", r#"{"sku":"COFFEE","delta":10}"#),
        &OfflineQueueItem::new("stock.adjusted", r#"{"sku":"COFFEE","delta":-3}"#),
    )
    .winner;

    // Depth one: the merge arm can still read both sides.
    let v1: Value = serde_json::from_str(&depth_one.payload).unwrap();
    assert_eq!(v1["merge_type"], "crdt_delta");
    let side: StockAdjustmentPayload = serde_json::from_value(v1["local"].clone()).unwrap();
    assert_eq!(side.delta, 10, "UNDECIDED: depth one is consumable");

    // Depth two: the merged row conflicts again, so it is handed back in.
    let depth_two = crate::conflict::resolve_stock_crdt(&depth_one, &depth_one)
        .winner
        .payload;
    let v2: Value = serde_json::from_str(&depth_two).unwrap();
    assert_eq!(
        v2["merge_type"], "crdt_delta",
        "UNDECIDED: the envelope nests silently, with no depth guard and no warning - the resolver wraps whatever payload it is handed"
    );
    let inner: Result<(), serde_json::Error> =
        serde_json::from_value::<StockAdjustmentPayload>(v2["local"].clone()).map(|_| ());
    assert!(
        inner.is_err(),
        "UNDECIDED: a depth-two payload fails to deserialize as StockAdjustmentPayload, and that failure is the only thing that stops the loop - got {:?}",
        inner
    );
}

/// Row 5 - the duplicate-id Rejected, the one row with a live producer.
///
/// This is NOT a conflict input: a real clash today arrives as
/// Rejected { reason: "duplicate id: ..." }. Consumer 1 and the SQLite daemon
/// (platform/sync/src/daemon.rs:208) share is_duplicate_id_rejection and both
/// route it to synced. The PostgreSQL daemon (platform/sync/src/pg_daemon.rs:323)
/// has no duplicate-id arm and routes the same reason to mark_offline_failed.
/// That is a KNOWN PARITY GAP, not a fix, and it stays a code-reading claim: the
/// arm is inline in run_once's spawn_blocking closure behind a real PgTransport,
/// so pinning it would need a live PostgreSQL connection. It is recorded in
/// docs/decisions/2026-07-20-sync-conflict-resolution-strategy.md, "Activation
/// and Ownership" (appended in 1c6949975), which names it as the only divergence
/// in the dossier with a plausible non-foreign trigger.
///
/// A SECOND such consumer was found 09-16-26 and appended to that same ADR
/// section: platform/sync/src/lib.rs:561, the SyncEngine run_sync_cycle push
/// loop, has no duplicate-id arm either — SyncQueue::mark_failed
/// (platform/sync/src/queue.rs:268) is a bare delegate to
/// store.mark_offline_failed, so the prefix is never consulted on that path and
/// the row lands Failed rather than Synced. It has no in-repo production caller
/// (lib_tests.rs and tests/integration_test.rs only), so its blast radius is an
/// embedder rather than a shipped path.
#[test]
fn duplicate_id_rejection_is_synced_here_and_recorded_as_a_parity_gap_there() {
    let store = setup_store();
    let local = enqueue_local(&store, &CASES[0]);
    let reason = format!("{}{}", DUPLICATE_ID_PREFIX, local.id);

    let result = apply_sync_outcomes(
        &store,
        std::slice::from_ref(&local),
        &[PushOutcome::Rejected {
            reason: reason.clone(),
        }],
    )
    .unwrap();

    assert!(
        kasirmu_core::sync_client::is_duplicate_id_rejection(&reason),
        "UNDECIDED: the predicate consumer 1 and the SQLite daemon share"
    );
    assert_eq!(
        result.synced, 1,
        "UNDECIDED: consumer 1 routes a duplicate-id replay to synced"
    );
    assert_eq!(
        result.failed, 0,
        "UNDECIDED: and not to the terminal failed state - pg_daemon.rs:323 does the opposite, see the ADR section named above"
    );
    let row = store
        .list_all_offline()
        .unwrap()
        .into_iter()
        .find(|i| i.id == local.id)
        .unwrap();
    assert_eq!(
        row.status,
        OfflineQueueStatus::Synced,
        "UNDECIDED: row state for the duplicate-id row under consumer 1"
    );

    // A genuine rejection still fails, and fails terminally - the guard above is
    // narrow, not a blanket "never fail".
    let store = setup_store();
    let other = enqueue_local(&store, &CASES[0]);
    let result = apply_sync_outcomes(
        &store,
        &[other],
        &[PushOutcome::Rejected {
            reason: "invalid payload: unknown sku".into(),
        }],
    )
    .unwrap();
    assert_eq!(
        result.synced, 0,
        "UNDECIDED: a real rejection is not synced"
    );
    assert_eq!(
        result.failed, 1,
        "UNDECIDED: a non-duplicate rejection is still a failure on this path"
    );
}

#[test]
fn duplicate_id_prefix_has_not_drifted() {
    assert!(
        kasirmu_core::sync_client::is_duplicate_id_rejection(&format!(
            "{}abc",
            DUPLICATE_ID_PREFIX
        )),
        "UNDECIDED: the mirrored prefix no longer matches DUPLICATE_ID_REJECTION_PREFIX - update this test and re-read the parity claim"
    );
    assert!(
        !kasirmu_core::sync_client::is_duplicate_id_rejection("duplicate: abc"),
        "UNDECIDED: the predicate is prefix-exact, so a near-miss reason still fails terminally"
    );
}
