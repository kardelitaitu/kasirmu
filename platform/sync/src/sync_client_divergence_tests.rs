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

/// The caller owns the connection: `Store::new` only needs a borrow, so
/// this takes one instead of `Box::leak`ing a database per test to
/// manufacture a `'static` (O-T03).
fn setup_store(db: &Connection) -> Store<'_> {
    Store::new(db)
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
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
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
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
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

/// Dossier item 1 - the re-enqueue bound, now CLOSED (fixed 2026-10-04).
///
/// resolve_stock_crdt computes retry_count = max(local, remote)
/// (platform/sync/src/conflict.rs:167) and carries the local tenant_id. That
/// winner identity used to be discarded: apply_resolution re-enqueued through
/// Store::enqueue_offline, which persists action and payload only and builds a
/// fresh row (retry_count 0, tenant "default", a second uuid) - so a conflict
/// that kept conflicting reset to zero every cycle, forever, and a multi-store
/// delta re-enqueued under the wrong tenant. `apply_resolution` now calls
/// Store::enqueue_offline_preserving_item, which writes the winner's identity
/// verbatim. This test was the pin that failed when the winner was picked; it
/// now asserts the corrected behaviour.
#[test]
fn crdt_merge_reenqueue_preserves_retry_count_and_tenant() {
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
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
        requeued.retry_count, 4,
        "the computed max reaches the database: apply_resolution preserves the winner's identity"
    );
    assert_eq!(
        requeued.tenant_id, "store-a",
        "a store-a delta re-enqueues under store-a, not the default tenant"
    );
    // The id must be the one the RESOLVER minted inside apply_resolution, not a
    // fresh uuid from the enqueue helper. Re-resolving with the same inputs
    // yields the same merged payload; the only unstable part is the minted id,
    // so assert the requeued row is a *merge winner* by re-deriving it and
    // comparing everything but that id.
    let rederived = crate::conflict::resolve_conflict(&local, &remote).winner;
    assert_eq!(
        requeued.payload, rederived.payload,
        "the persisted row is the merged winner (same CRDT envelope)"
    );
    assert_eq!(
        requeued.origin_terminal_id, rederived.origin_terminal_id,
        "the winner's originating terminal is preserved, not re-stamped"
    );
    assert_ne!(
        requeued.id, row.id,
        "the requeued row is a NEW identity (the resolver's), not the consumed local row's"
    );
}

/// Dossier item 3 - the poison-item nesting, now CLOSED by a depth guard.
///
/// resolve_stock_crdt used to wrap whatever payload it was handed, so a second
/// conflict on a merged row nested the envelope: `{local: {local, remote,
/// merge_type}, ...}`. Depth one was consumable (queue.rs unwraps local and
/// remote when merge_type is crdt_delta); depth two was not, because the inner
/// local was itself an envelope with no sku/delta, and that deserialisation
/// failure - not a guard - was the only thing stopping a conflict loop. It was
/// silent.
///
/// The resolver now FLATTENS instead of nesting, and a self-merge is
/// IDEMPOTENT: merging a row with itself yields that row's facts once, never
/// twice. Two identical deltas are the same fact here - they only ever arise
/// from repeating one input, since two independent adjustments arrive on the
/// distinct local/remote sides. Applying the repeats would double-count
/// (adjust_stock is not idempotent by design). This pins both: the result is
/// exactly one level deep, and a self-merge does not multiply its deltas.
#[test]
fn re_merging_a_merged_envelope_stays_one_level_deep_and_idempotent() {
    let depth_one = crate::conflict::resolve_stock_crdt(
        &OfflineQueueItem::new("stock.adjusted", r#"{"sku":"COFFEE","delta":10}"#),
        &OfflineQueueItem::new("stock.adjusted", r#"{"sku":"COFFEE","delta":-3}"#),
    )
    .winner;

    // Depth one: the merge arm can read both sides.
    let v1: Value = serde_json::from_str(&depth_one.payload).unwrap();
    assert_eq!(v1["merge_type"], "crdt_delta");
    let as_delta = |v: &Value| -> StockAdjustmentPayload {
        serde_json::from_value(v.clone()).expect("every carried side is a leaf stock delta")
    };
    assert_eq!(as_delta(&v1["local"]).delta, 10);
    assert_eq!(as_delta(&v1["remote"]).delta, -3);
    assert!(
        v1.get("extra").is_none(),
        "an ordinary merge needs no extras"
    );

    // Depth two: the merged row conflicts again with ITSELF. It must NOT nest,
    // and it must NOT double its own facts.
    let depth_two = crate::conflict::resolve_stock_crdt(&depth_one, &depth_one)
        .winner
        .payload;
    let v2: Value = serde_json::from_str(&depth_two).unwrap();
    assert_eq!(v2["merge_type"], "crdt_delta", "still an envelope");
    assert_eq!(as_delta(&v2["local"]).delta, 10);
    assert_eq!(as_delta(&v2["remote"]).delta, -3);
    assert!(
        v2["local"].get("merge_type").is_none(),
        "a side is a leaf delta, never a nested envelope"
    );
    assert!(
        v2.get("extra").is_none(),
        "a self-merge is idempotent: the two facts are not repeated as extras"
    );
}

/// A merge of two DIFFERENT envelopes must still carry every distinct fact.
///
/// The idempotence above must not collapse genuinely different deltas. Merging
/// {+1} with {+2} yields both; merging that winner with {+3} yields all three,
/// with the surplus riding in `extra` because the envelope keeps only two
/// top-level sides.
#[test]
fn re_merging_distinct_envelopes_keeps_every_delta() {
    let merged = |a: &str, b: &str| {
        crate::conflict::resolve_stock_crdt(
            &OfflineQueueItem::new("stock.adjusted", a),
            &OfflineQueueItem::new("stock.adjusted", b),
        )
        .winner
    };

    let depth_one = merged(r#"{"sku":"SKU","delta":1}"#, r#"{"sku":"SKU","delta":2}"#);
    // Merge that winner with a THIRD, distinct delta.
    let depth_two = merged(&depth_one.payload, r#"{"sku":"SKU","delta":3}"#);
    let v2: Value = serde_json::from_str(&depth_two.payload).unwrap();

    let mut deltas: Vec<i64> = Vec::new();
    for key in ["local", "remote"] {
        deltas.push(
            serde_json::from_value::<StockAdjustmentPayload>(v2[key].clone())
                .unwrap()
                .delta,
        );
    }
    for extra in v2["extra"].as_array().into_iter().flatten() {
        deltas.push(
            serde_json::from_value::<StockAdjustmentPayload>(extra.clone())
                .unwrap()
                .delta,
        );
    }
    deltas.sort_unstable();
    assert_eq!(
        deltas,
        vec![1, 2, 3],
        "every distinct delta survives; the surplus rides in extra"
    );
}

/// Row 5 - the duplicate-id Rejected, the one row with a live producer.
///
/// This is NOT a conflict input: a real clash today arrives as
/// Rejected { reason: "duplicate id: ..." }. ALL FOUR appliers now share
/// is_duplicate_id_rejection and route it to synced:
///   * consumer 1, sync_client::apply_sync_outcomes (crates/kasirmu-core/src/sync_client.rs:101)
///   * the SQLite daemon, daemon::apply_push_results (platform/sync/src/daemon.rs:408)
///   * the PostgreSQL daemon, pg_daemon::apply_push_outcomes (platform/sync/src/pg_daemon.rs:760)
///   * the embedder, lib.rs::apply_push_outcomes (platform/sync/src/lib.rs:239)
///
/// The two gaps this note USED to record as open are now closed, and each is
/// pinned by a test rather than by reading:
///   * the PostgreSQL daemon's arm was added by C48 and is pinned by
///     pg_daemon_tests::pg_apply_push_outcomes_duplicate_id_replay_marks_synced
///     (and its negative twin ..._genuine_rejection_marks_failed);
///   * the SyncEngine arm was added in the same sweep and is pinned here plus
///     in lib_tests.rs:1627.
///
/// docs/decisions/2026-07-20-sync-conflict-resolution-strategy.md, "Activation
/// and Ownership" and its "Second parity gap" appendix, still describe both as
/// open; that text is now historical (a reader should trust the arms above).
#[test]
fn duplicate_id_rejection_is_synced_on_all_four_appliers() {
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
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
        "and not to the terminal failed state - all four appliers now share the predicate (pg_daemon.rs:760, lib.rs:239, daemon.rs:408)"
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
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
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
        kasirmu_core::sync_client::is_duplicate_id_rejection(&format!("{DUPLICATE_ID_PREFIX}abc")),
        "UNDECIDED: the mirrored prefix no longer matches DUPLICATE_ID_REJECTION_PREFIX - update this test and re-read the parity claim"
    );
    assert!(
        !kasirmu_core::sync_client::is_duplicate_id_rejection("duplicate: abc"),
        "UNDECIDED: the predicate is prefix-exact, so a near-miss reason still fails terminally"
    );
}
