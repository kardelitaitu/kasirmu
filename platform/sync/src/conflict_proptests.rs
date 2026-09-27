//! Property-based tests for conflict resolution (`conflict.rs`).
//!
//! `conflict_tests.rs` samples specific cases — ties, missing versions,
//! the status DAG, invalid payloads. Those pin the *examples*; they cannot
//! say anything about the space the examples sit in, which is where a
//! multi-location sync engine actually lives: two terminals editing the
//! same sale, arriving in either order, with payloads neither author
//! anticipated.
//!
//! These properties close that gap for the three obligations ADR-21's
//! resolvers carry. Each was **measured before it was asserted** — one of
//! the four candidate properties does NOT hold, and the section that
//! records that is the most useful part of this file.
//!
//! # What is asserted
//!
//! 1. **Winner is drawn from the inputs, never invented.** True for the
//!    three LWW resolvers. False for the CRDT merge, which constructs a
//!    new item — so the property is scoped to the resolvers it describes
//!    rather than stated globally.
//! 2. **Sale status never regresses.** A completed sale cannot be reverted
//!    to pending by a stale remote item. This is the property the whole
//!    status-DAG exists for, and it is order-independent.
//! 3. **Resolution is symmetric in outcome rank.** Swapping the arguments
//!    can change *which* item wins (ties are remote-authoritative, so it
//!    must), but it cannot change the winning item's *rank* on the
//!    deciding axis.
//!
//! # What is NOT asserted, and why
//!
//! `resolve_stock_crdt` is **not idempotent** — it mints a fresh
//! `uuid::Uuid::now_v7()` per call, so resolving the same pair twice
//! yields two different winners. That is correct for a delta merge (each
//! merge is a new row carrying both deltas) and wrong to describe as
//! idempotent. `crdt_merge_preserves_two_distinct_deltas_rather_than_deduplicating`
//! pins the behaviour that actually holds.
//!
//! Wired from `conflict.rs` via
//! `#[cfg(test)] #[path = "conflict_proptests.rs"] mod proptests;`.

use super::*;
use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
use proptest::prelude::*;

/// The status ladder, in the order `conflict.rs` ranks it.
///
/// Duplicated deliberately rather than imported: `SALE_STATUS_ORDER` is
/// private to `conflict.rs`. If the two ever disagree, the sale-status
/// properties below fail — which is the signal wanted, since a silent
/// divergence would mean the tests were grading a ladder the code does
/// not walk.
const LADDER: &[&str] = &["active", "pending", "completed", "voided", "refunded"];

/// An ISO-8601-ish timestamp drawn from a small ordered set.
///
/// The set is small and lexicographically ordered on purpose: `created_at`
/// is compared as a STRING (`local.created_at > remote.created_at`), so
/// the only thing the resolver can distinguish is lexical order. Random
/// ISO strings would add entropy the comparison discards while making
/// ties vanishingly rare — and ties are exactly where the
/// remote-authoritative rule lives.
fn timestamps() -> impl Strategy<Value = String> {
    (0u8..6).prop_map(|n| format!("2026-09-{:02}T00:00:00Z", n + 1))
}

/// An arbitrary offline queue item for a given action.
///
/// `payload` is built by the caller's strategy so version- and
/// status-carrying items can be generated precisely.
fn item(action: String, payload: String, created_at: String) -> OfflineQueueItem {
    OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action,
        payload,
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at,
        synced_at: None,
        tenant_id: "default".into(),
        priority: SyncPriority::Normal,
        origin_terminal_id: None,
    }
}

/// A payload carrying a `version`, sometimes alongside junk fields.
///
/// Returned as a `BoxedStrategy` rather than `impl Strategy` because it is
/// used twice in the same tuple below, and `impl Strategy` is not `Clone`.
/// Proptest offers no cheap way around that; boxing is the documented one.
fn versioned_payload() -> BoxedStrategy<String> {
    (any::<i64>(), any::<bool>())
        .prop_map(|(v, junk)| {
            if junk {
                format!(r#"{{"version":{v},"note":"ignored"}}"#)
            } else {
                format!(r#"{{"version":{v}}}"#)
            }
        })
        .boxed()
}

/// A payload carrying a `status`, drawn from the real ladder.
fn status_payload() -> BoxedStrategy<String> {
    prop::sample::select(LADDER.to_vec())
        .prop_map(|s| format!(r#"{{"status":"{s}"}}"#))
        .boxed()
}

/// A stock delta payload.
fn delta_payload() -> BoxedStrategy<String> {
    (any::<i32>(), any::<bool>())
        .prop_map(|(qty, junk)| {
            if junk {
                format!(r#"{{"qty":{qty},"reason":"adjust"}}"#)
            } else {
                format!(r#"{{"qty":{qty}}}"#)
            }
        })
        .boxed()
}

/// Build a pair of same-action items from two payload strategies.
fn pair(
    action: &'static str,
    payloads: BoxedStrategy<String>,
) -> impl Strategy<Value = (OfflineQueueItem, OfflineQueueItem)> {
    (payloads.clone(), payloads, timestamps(), timestamps()).prop_map(move |(lp, rp, lt, rt)| {
        (
            item(action.to_owned(), lp, lt),
            item(action.to_owned(), rp, rt),
        )
    })
}

/// The rank of an item if it is the winner, or `None` when the resolver
/// invented an item that matches neither input.
fn winner_rank(res: &ResolvedItem, w: &OfflineQueueItem) -> Option<usize> {
    if w.id == res.local.as_ref()?.id {
        return Some(0);
    }
    if w.id == res.remote.as_ref()?.id {
        return Some(1);
    }
    None
}

// ── 1. The LWW resolvers pick an input; they never invent one ────────

proptest! {
    /// `resolve_lww` returns one of the two items it was given.
    ///
    /// A resolver that fabricated a winner would silently discard a
    /// terminal's mutation — and with `sync_applied_items` keyed on the
    /// item id, a fabricated id would make the replay ledger miss.
    #[test]
    fn lww_winner_is_always_one_of_the_inputs(
        (local, remote) in pair("unknown.action", versioned_payload())
    ) {
        let res = resolve_lww(&local, &remote);
        prop_assert_eq!(res.local.as_ref().unwrap().id.as_str(), local.id.as_str());
        prop_assert_eq!(res.remote.as_ref().unwrap().id.as_str(), remote.id.as_str());
        let wid = res.winner.id.as_str();
        prop_assert!(
            wid == local.id.as_str() || wid == remote.id.as_str(),
            "winner {} is neither input", wid
        );
    }

    /// Version LWW never invents a winner either, for any payload shape.
    #[test]
    fn version_lww_winner_is_always_one_of_the_inputs(
        (local, remote) in pair("product.updated", versioned_payload())
    ) {
        let res = resolve_version_lww(&local, &remote);
        let wid = res.winner.id.as_str();
        prop_assert!(wid == local.id.as_str() || wid == remote.id.as_str());
        prop_assert!(winner_rank(&res, &res.winner).is_some());
    }
}

// ── 2. The property the sale DAG exists for ──────────────────────────

proptest! {
    /// **A completed sale is never reverted to pending by a stale remote.**
    ///
    /// This is the critical POS property and the reason `resolve_sale_lww`
    /// ranks by status instead of timestamp. A terminal that completed a
    /// sale and then receives an older "pending" row for the same sale
    /// must not un-complete it — that is a customer walking out with goods
    /// the system believes were never sold.
    ///
    /// Order-independent by construction: the assertion is on the winner's
    /// rank, not on which argument carried it.
    #[test]
    fn a_more_advanced_status_always_wins_over_a_less_advanced_one(
        low in 0usize..LADDER.len(),
        high in 0usize..LADDER.len(),
        lt in timestamps(),
        rt in timestamps(),
    ) {
        prop_assume!(low < high);
        let local = item("sale.updated".into(), format!(r#"{{"status":"{}"}}"#, LADDER[low]), lt);
        let remote = item("sale.updated".into(), format!(r#"{{"status":"{}"}}"#, LADDER[high]), rt);
        let res = resolve_sale_lww(&local, &remote);

        // The winner must carry the higher rank, whichever side held it.
        let winner_status = extract_status(&res.winner.payload).unwrap_or_default();
        prop_assert_eq!(
            sale_status_rank(&winner_status),
            high,
            "advanced status {} lost to {}", LADDER[high], LADDER[low]
        );
    }

    /// Swapping the arguments cannot change the winning status RANK.
    ///
    /// Ties are remote-authoritative, so `f(a,b)` and `f(b,a)` legitimately
    /// return different *items* when ranks are equal — but they can never
    /// disagree about how advanced the surviving state is. If they could,
    /// two terminals applying the same pair in different orders would
    /// converge on different sale states.
    #[test]
    fn sale_resolution_is_symmetric_in_outcome_rank(
        (local, remote) in pair("sale.updated", status_payload())
    ) {
        let forward = resolve_sale_lww(&local, &remote);
        let backward = resolve_sale_lww(&remote, &local);

        let f = sale_status_rank(&extract_status(&forward.winner.payload).unwrap_or_default());
        let b = sale_status_rank(&extract_status(&backward.winner.payload).unwrap_or_default());
        prop_assert_eq!(f, b, "order changed the surviving rank");
    }

    /// The same symmetry holds for version LWW on reference data.
    #[test]
    fn version_resolution_is_symmetric_in_outcome_version(
        (local, remote) in pair("product.updated", versioned_payload())
    ) {
        let forward = resolve_version_lww(&local, &remote);
        let backward = resolve_version_lww(&remote, &local);

        let f = extract_version(&forward.winner.payload);
        let b = extract_version(&backward.winner.payload);
        prop_assert_eq!(f, b, "order changed the surviving version");
    }
}

// ── 3. Dispatch routing is total and prefix-correct ──────────────────

proptest! {
    /// `resolve_conflict` never panics, for any action string at all.
    ///
    /// The dispatcher is the one entry point every queued action reaches,
    /// so a panic here is a panic in the sync daemon. Actions arriving
    /// from a newer client are exactly the inputs nobody enumerated.
    #[test]
    fn dispatch_never_panics_on_an_arbitrary_action(
        action in "[a-zA-Z_.\\-]{0,40}",
        (lp, rp) in (delta_payload(), delta_payload()),
        (lt, rt) in (timestamps(), timestamps()),
    ) {
        let local = item(action.clone(), lp, lt);
        let remote = item(action.clone(), rp, rt);
        let res = resolve_conflict(&local, &remote);
        prop_assert!(res.local.is_some());
        prop_assert!(res.remote.is_some());
        prop_assert!(!res.winner.id.is_empty());
    }

    /// A `sale.*` action routes to the sale resolver, not the fallback.
    ///
    /// Without this, a rename that dropped a prefix would silently demote
    /// money-moving resolution to created-at LWW — and the completed-sale
    /// property above would stop being enforced while its test still
    /// passed, because that test calls `resolve_sale_lww` directly.
    #[test]
    fn sale_prefix_routes_to_the_sale_resolver(
        low in 0usize..LADDER.len(),
        high in 0usize..LADDER.len(),
        lt in timestamps(),
        rt in timestamps(),
    ) {
        prop_assume!(low < high);
        // Local is the ADVANCED item but the OLDER timestamp: created-at
        // LWW would pick remote, status ranking must pick local.
        let local = item("sale.updated".into(), format!(r#"{{"status":"{}"}}"#, LADDER[high]), lt.clone());
        let remote = item("sale.updated".into(), format!(r#"{{"status":"{}"}}"#, LADDER[low]), rt);
        let res = resolve_conflict(&local, &remote);
        prop_assert_eq!(
            res.winner.id.as_str(),
            local.id.as_str(),
            "the dispatcher did not route sale.* to the status-DAG resolver"
        );
    }
}

// ── 4. The CRDT merge, stated as it actually behaves ─────────────────

proptest! {
    /// The stock CRDT merge **preserves both deltas** rather than picking one.
    ///
    /// This is what makes it safe for concurrent adjustments: discarding
    /// either side would lose a stock movement, which is a silent
    /// inventory error no later reconciliation can reconstruct.
    ///
    /// The assertion is on the VALUES, not merely on the keys existing.
    /// An earlier version of this test checked only that `local` and
    /// `remote` were present, and it survived a mutation that replaced the
    /// remote payload with `Value::Null` — the key was still there, so the
    /// test passed while the delta was gone. Comparing against the parsed
    /// inputs is what makes the property bite.
    #[test]
    fn crdt_merge_preserves_two_distinct_deltas_rather_than_deduplicating(
        (lp, rp) in (delta_payload(), delta_payload()),
        (lt, rt) in (timestamps(), timestamps()),
    ) {
        let local = item("stock.adjusted".into(), lp.clone(), lt);
        let remote = item("stock.adjusted".into(), rp.clone(), rt);
        let res = resolve_stock_crdt(&local, &remote);

        let merged: Value = serde_json::from_str(&res.winner.payload).expect("merged payload is JSON");

        // Each side must survive with its own CONTENT, not just its key.
        let want_local: Value = serde_json::from_str(&lp).expect("local payload is JSON");
        let want_remote: Value = serde_json::from_str(&rp).expect("remote payload is JSON");
        prop_assert_eq!(
            merged.get("local"),
            Some(&want_local),
            "the local delta's content was altered or dropped"
        );
        prop_assert_eq!(
            merged.get("remote"),
            Some(&want_remote),
            "the remote delta's content was altered or dropped"
        );
        prop_assert_eq!(merged.get("merge_type").and_then(|v| v.as_str()), Some("crdt_delta"));
    }

    /// A CRDT merge is **NOT idempotent**, and this pins that rather than
    /// hiding it.
    ///
    /// `resolve_stock_crdt` mints a fresh `Uuid::now_v7()` per call, so
    /// merging the same pair twice yields two different winner ids. That is
    /// correct for a delta merge — each merge IS a new row carrying both
    /// deltas — but it means the resolver must never be treated as a pure
    /// function of its inputs by a caller that dedupes on the result id.
    /// The property is asserted in the direction that holds: ids differ.
    #[test]
    fn crdt_merge_mints_a_fresh_winner_id_each_call(
        (lp, rp) in (delta_payload(), delta_payload()),
        (lt, rt) in (timestamps(), timestamps()),
    ) {
        let local = item("stock.adjusted".into(), lp, lt);
        let remote = item("stock.adjusted".into(), rp, rt);
        let first = resolve_stock_crdt(&local, &remote);
        let second = resolve_stock_crdt(&local, &remote);
        prop_assert_ne!(
            first.winner.id, second.winner.id,
            "if these ever match, the merge became idempotent and callers \
             deduping on the winner id would silently drop a delta"
        );
    }

    /// The merged item keeps the LOCAL origin, which the self-origin gate reads.
    ///
    /// C3's double-deduction guard compares `origin_terminal_id` to decide
    /// whether a push is a terminal's own mutation. A merge that lost or
    /// rewrote this field would either suppress a legitimate stock
    /// deduction (silent loss) or fail to suppress a duplicate (double
    /// deduction).
    #[test]
    fn crdt_merge_keeps_the_local_origin_terminal(
        (lp, rp) in (delta_payload(), delta_payload()),
        (lt, rt) in (timestamps(), timestamps()),
        origin in prop::option::of("[A-Za-z0-9\\-]{1,20}"),
    ) {
        let mut local = item("stock.adjusted".into(), lp, lt);
        let mut remote = item("stock.adjusted".into(), rp, rt);
        local.origin_terminal_id = origin.clone();
        // Deliberately different, so "kept local" is distinguishable from
        // "kept whichever was non-None".
        remote.origin_terminal_id = Some("other-terminal".into());

        let res = resolve_stock_crdt(&local, &remote);
        prop_assert_eq!(res.winner.origin_terminal_id, origin);
    }
}
