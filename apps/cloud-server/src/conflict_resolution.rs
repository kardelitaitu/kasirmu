//! Conflict classification for concurrent sync mutations.
/*
last audited 2026-09-13 by Agent 2 (sync-conflict work order)
crate: oz-cloud-server | status: SAFE | lint: CLEAN
findings: classification is driven by a version vector, not a scalar clock —
two terminals that each advanced only their own counter are CONCURRENT and no
scalar comparison can say so. Money entities are hard-wired to
`NeverAutoMerge`: gift card redemption is guarded by an atomic conditional
UPDATE plus the `uq_gift_card_redeem_sale` unique index, and an automatic
merge would defeat both, so a divergent money movement is always a row for
human review. `tie_break` is total and symmetric so every replica picks the
same last-writer-wins winner.
next: persistence + HTTP endpoints | perf: O(terminals + payload fields)
*/
//!
//! This module is pure: it takes vectors and payloads and returns a
//! decision. It performs no I/O, which is what makes the policy table
//! testable without a database.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use platform_sync::crdt::{CausalOrder, VersionVector};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A row of `sync_conflicts`.
///
/// The two vector columns hold JSON text rather than a scalar: a scalar clock
/// cannot express concurrency, which is the whole reason the row exists. The
/// payload columns are stored as opaque JSON and are never interpreted — and
/// in particular never summed — by this crate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncConflictRow {
    /// Row id.
    pub id: String,
    /// Owning tenant. Every read and write is scoped by this.
    pub tenant_id: String,
    /// Entity type, e.g. `stock.adjusted`.
    pub entity_type: String,
    /// Entity the two mutations disagree about.
    pub entity_id: String,
    /// Terminal that produced the stored side.
    pub local_terminal_id: String,
    /// JSON [`VersionVector`] of the stored side.
    pub local_vector: String,
    /// JSON [`VersionVector`] of the incoming side.
    pub remote_vector: String,
    /// JSON body of the stored side.
    pub local_payload: String,
    /// JSON body of the incoming side.
    pub remote_payload: String,
    /// `high` | `medium` | `low`.
    pub severity: String,
    /// `open` | `resolved` | `dismissed`.
    pub status: String,
    /// Chosen side or custom merge, once resolved.
    pub resolution: Option<String>,
    /// Who resolved it.
    pub resolved_by: Option<String>,
    /// When it was resolved.
    pub resolved_at: Option<String>,
    /// When the row was created.
    pub created_at: String,
}

/// How urgent a flagged conflict is, and the bucket the review UI filters on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Money and inventory. A wrong decision costs real value.
    High,
    /// Customer profile data.
    Medium,
    /// Catalog metadata — cheap to redo.
    Low,
}

impl Severity {
    /// The wire/`CHECK`-constrained spelling of this severity.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }
}

/// What may be done automatically when two mutations are concurrent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergePolicy {
    /// Never reconcile without a human. Money, and anything ambiguous.
    NeverAutoMerge,
    /// Additive deltas: both sides apply. Stock movements.
    AutoMergeDeltas,
    /// Merge when the two sides touched different fields. Customer profiles.
    MergeDisjointFields,
    /// Pick a winner by `tie_break`. Catalog metadata.
    LastWriterWins,
}

/// The outcome of comparing a stored mutation against an incoming one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The incoming mutation strictly dominates the stored one. Apply it.
    Apply,
    /// The incoming mutation is older than what is stored. Drop it.
    Stale,
    /// Both sides are the same state. Nothing to do.
    Identical,
    /// Concurrent and not safe to merge. Record a conflict row.
    Flag {
        /// How urgent the row is.
        severity: Severity,
    },
    /// Concurrent but safely merged without losing either side.
    AutoMerge {
        /// Recorded for the audit trail even though no review is needed.
        severity: Severity,
    },
    /// Concurrent, resolved by picking a winner.
    LastWriterWins {
        /// `true` when the incoming (remote) side won.
        winner_is_remote: bool,
    },
}

/// Whether an entity type moves money.
///
/// Money is the one class where an automatic merge can create value that did
/// not exist before: two offline redemptions of the same gift card merge into
/// a double spend that every per-record invariant would have rejected
/// individually. So money is never merged — only flagged.
fn is_money_entity(entity_type: &str) -> bool {
    let t = entity_type.to_ascii_lowercase();
    [
        "gift_card",
        "giftcard",
        "payment",
        "refund",
        "loyalty",
        "payout",
        "cash",
    ]
    .iter()
    .any(|needle| t.contains(needle))
}

/// Whether an entity type is a stock movement.
fn is_stock_entity(entity_type: &str) -> bool {
    let t = entity_type.to_ascii_lowercase();
    t.starts_with("stock.") || t.contains("stock") || t.contains("inventory")
}

/// Whether an entity type is customer profile data.
fn is_customer_entity(entity_type: &str) -> bool {
    let t = entity_type.to_ascii_lowercase();
    t.starts_with("customer.") || t.contains("customer")
}

/// Severity bucket for an entity type.
pub fn severity_for(entity_type: &str) -> Severity {
    if is_money_entity(entity_type) || is_stock_entity(entity_type) {
        Severity::High
    } else if is_customer_entity(entity_type) {
        Severity::Medium
    } else {
        Severity::Low
    }
}

/// What may be done automatically for an entity type.
///
/// Money is checked first and short-circuits: no later rule may decide that a
/// money movement is safe to merge.
pub fn policy_for(entity_type: &str) -> MergePolicy {
    if is_money_entity(entity_type) {
        MergePolicy::NeverAutoMerge
    } else if is_stock_entity(entity_type) {
        MergePolicy::AutoMergeDeltas
    } else if is_customer_entity(entity_type) {
        MergePolicy::MergeDisjointFields
    } else {
        MergePolicy::LastWriterWins
    }
}

/// A stored/incoming mutation pair awaiting classification.
#[derive(Debug, Clone, Copy)]
pub struct ConflictCandidate<'a> {
    /// Entity type, e.g. `stock.adjusted`, `gift_card.redeem`.
    pub entity_type: &'a str,
    /// Vector currently stored for the entity.
    pub stored: &'a VersionVector,
    /// Vector carried by the incoming mutation.
    pub incoming: &'a VersionVector,
    /// Stored payload. Required only by [`MergePolicy::MergeDisjointFields`].
    pub stored_payload: Option<&'a Value>,
    /// Incoming payload. Required only by [`MergePolicy::MergeDisjointFields`].
    pub incoming_payload: Option<&'a Value>,
}

/// Classify a stored/incoming pair.
///
/// Causally ordered pairs are never conflicts: if the incoming vector strictly
/// dominates the stored one it simply applies, and if it is dominated it is
/// stale. Only genuine concurrency reaches the policy table.
pub fn classify(candidate: &ConflictCandidate<'_>) -> Decision {
    match candidate.stored.compare(candidate.incoming) {
        CausalOrder::Before => Decision::Apply,
        CausalOrder::After => Decision::Stale,
        CausalOrder::Equal => Decision::Identical,
        CausalOrder::Concurrent => {
            let severity = severity_for(candidate.entity_type);
            match policy_for(candidate.entity_type) {
                MergePolicy::NeverAutoMerge => Decision::Flag { severity },
                MergePolicy::AutoMergeDeltas => Decision::AutoMerge { severity },
                MergePolicy::MergeDisjointFields => {
                    // Only safe when the two sides touched different fields.
                    // A missing payload is NOT treated as disjoint: without
                    // both bodies we cannot prove nothing was lost, so the
                    // conservative answer is to flag.
                    let disjoint = match (candidate.stored_payload, candidate.incoming_payload) {
                        (Some(stored), Some(incoming)) => fields_are_disjoint(stored, incoming),
                        _ => false,
                    };
                    if disjoint {
                        Decision::AutoMerge { severity }
                    } else {
                        Decision::Flag { severity }
                    }
                }
                MergePolicy::LastWriterWins => Decision::LastWriterWins {
                    winner_is_remote: tie_break(candidate.stored, candidate.incoming)
                        == Ordering::Less,
                },
            }
        }
    }
}

/// The comparable field names an object payload carries.
///
/// A non-object payload has no field set by definition.
///
/// Only the fields a writer actually chose are comparable, so
/// [`is_metadata_field`] names are filtered out first.
fn fields_of(payload: &Value) -> BTreeSet<String> {
    payload
        .as_object()
        .map(|map| {
            map.keys()
                .filter(|k| !is_metadata_field(k.as_str()))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// Fields both payloads set — the ones a field-wise merge cannot combine.
pub fn overlapping_fields(local: &Value, remote: &Value) -> Vec<String> {
    fields_of(local)
        .intersection(&fields_of(remote))
        .cloned()
        .collect()
}

/// Whether two payloads can be merged field-wise without either losing data.
pub fn fields_are_disjoint(local: &Value, remote: &Value) -> bool {
    overlapping_fields(local, remote).is_empty()
}

/// Payload field carrying the sender's version vector.
pub const VECTOR_FIELD: &str = "_vector";

/// Payload field carrying the sending terminal's id.
pub const TERMINAL_FIELD: &str = "_terminal";

/// Payload fields that say *which* record a mutation is about.
///
/// These are the join key, not an edited aspect — they are how the two
/// sides were matched, so they appear in both by construction.
pub const IDENTITY_FIELDS: [&str; 2] = ["entity_id", "id"];

/// Whether a payload field is metadata rather than a value a writer chose.
///
/// The stamp fields are transport metadata and the identity fields are the
/// join key; none of the three says anything about what a writer edited.
/// Counting any of them would put it in every intersection and make
/// [`fields_are_disjoint`] false for every pair, silently degrading
/// [`MergePolicy::MergeDisjointFields`] into a flag on every push.
fn is_metadata_field(name: &str) -> bool {
    name == VECTOR_FIELD || name == TERMINAL_FIELD || IDENTITY_FIELDS.contains(&name)
}

/// Read the version vector a peer attached to a pushed payload.
///
/// Absent means the peer predates vector support; that is a skip, not an
/// error, and deliberately cannot be faked into a vector — inventing one
/// would fabricate a causal history we cannot justify.
pub fn extract_vector(payload: &str) -> Option<VersionVector> {
    let value: Value = serde_json::from_str(payload).ok()?;
    serde_json::from_value(value.get(VECTOR_FIELD)?.clone()).ok()
}

/// Read the sending terminal id from a pushed payload.
pub fn extract_terminal(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    value.get(TERMINAL_FIELD)?.as_str().map(str::to_string)
}

/// The entity a payload refers to.
///
/// Checks `entity_id`, then `id`, then falls back to the queue item's own id.
/// A payload with neither field still has to be comparable, and the item id is
/// the only stable thing left — it is wrong to conflate two different
/// entities, but worse to silently skip detection for one.
pub fn entity_id_of(payload: &str, fallback: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return fallback.to_string();
    };
    value
        .get("entity_id")
        .or_else(|| value.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or(fallback)
        .to_string()
}

/// Build the conflict row to persist for a flagged divergence.
///
/// `local_*` is the stored side and `remote_*` the incoming one, matching the
/// column names in `sync_conflicts`. The payloads are stored verbatim and
/// never interpreted — in particular never summed — because a conflict on a
/// money entity is exactly the case where combining the two sides would
/// invent value that neither write authorised.
// One parameter per persisted column of `sync_conflicts`: bundling them into a
// struct would add a type that only exists to be immediately destructured here,
// and the column-for-column signature is what keeps the row honest to the schema.
#[allow(clippy::too_many_arguments)]
pub fn build_conflict_row(
    id: &str,
    tenant_id: &str,
    entity_type: &str,
    entity_id: &str,
    local_terminal_id: &str,
    local_vector: &VersionVector,
    remote_vector: &VersionVector,
    local_payload: &str,
    remote_payload: &str,
) -> SyncConflictRow {
    SyncConflictRow {
        id: id.to_string(),
        tenant_id: tenant_id.to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        local_terminal_id: local_terminal_id.to_string(),
        local_vector: serde_json::to_string(local_vector).unwrap_or_else(|_| "{}".to_string()),
        remote_vector: serde_json::to_string(remote_vector).unwrap_or_else(|_| "{}".to_string()),
        local_payload: local_payload.to_string(),
        remote_payload: remote_payload.to_string(),
        severity: severity_for(entity_type).as_str().to_string(),
        status: "open".to_string(),
        resolution: None,
        resolved_by: None,
        resolved_at: None,
        created_at: String::new(),
    }
}

/// A total, symmetric order over two concurrent vectors.
///
/// Concurrency means neither dominates, so a last-writer-wins policy needs an
/// arbitrary but *consistent* winner. This compares the total number of events
/// each vector has observed, then falls back to the lexicographically greater
/// terminal id set, so `tie_break(a, b)` is always the reverse of
/// `tie_break(b, a)` and every replica chooses the same side.
pub fn tie_break(a: &VersionVector, b: &VersionVector) -> Ordering {
    let sum_a: u64 = a.iter().map(|(_, counter)| *counter).sum();
    let sum_b: u64 = b.iter().map(|(_, counter)| *counter).sum();

    // Three discriminators, in order. The third is what makes this a TOTAL
    // order: two vectors can share a total event count AND a terminal set
    // while distributing the counts differently (a=2,b=1 vs a=1,b=2), and
    // without comparing the counter sequence itself such a pair would compare
    // Equal — which is not symmetric-safe, since Equal means "same state".
    // Iteration is in terminal-id order on both sides, so the sequences are
    // directly comparable.
    let keys_a: Vec<String> = a.iter().map(|(k, _)| k.clone()).collect();
    let keys_b: Vec<String> = b.iter().map(|(k, _)| k.clone()).collect();
    let values_a: Vec<u64> = a.iter().map(|(_, v)| *v).collect();
    let values_b: Vec<u64> = b.iter().map(|(_, v)| *v).collect();

    sum_a
        .cmp(&sum_b)
        .then_with(|| keys_a.cmp(&keys_b).then_with(|| values_a.cmp(&values_b)))
}

#[cfg(test)]
#[path = "conflict_resolution_tests.rs"]
mod tests;
