//! Conflict Resolution — strategies for resolving conflicts between local
//! and remote versions of the same data.
/*
last audited 25-07-26 by RSA-Agent (platform-sync slice C: conflict deep read)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary ADR-21 entity dispatch — sale status DAG rank prevents a stale remote item from reverting a completed sale to pending (the critical POS property); version LWW with documented missing-field fallbacks and remote-authoritative ties; CRDT merge preserves both deltas under a fresh UUID; unknown status ranks 0 (fail-safe lowest); settings dispatched to version LWW consistent with SYNC-10; tests cover tie/missing/fallback matrices
next: none | perf: N/A
*/
//!
//! ADR-21 defines entity-type dispatch:
//!
//! | Action prefix           | Strategy                | Key field   |
//! |-------------------------|-------------------------|-------------|
//! | `product.*`, `category.*`, `tax.*`, `user.*`, `staff.*` | Version LWW | `version`   |
//! | `sale.*`, `complete_sale`, `void_sale`, `refund_sale`   | Sale LWW    | `status`    |
//! | `stock.*`               | CRDT merge              | —           |
//! | `*` (fallback)          | Created-at LWW          | `created_at`|

use kasirmu_core::offline::OfflineQueueItem;
use serde_json::Value;

use crate::queue::ResolvedItem;

// ── Payload field extractors ─────────────────────────────────────────

/// Extract an i64 `version` field from a JSON payload.
/// Returns `None` if the field is missing or not a valid integer.
fn extract_version(payload: &str) -> Option<i64> {
    let v: Value = serde_json::from_str(payload).ok()?;
    v.get("version")?.as_i64()
}

/// Extract a string `status` field from a JSON payload.
/// Returns `None` if the field is missing or not a string.
fn extract_status(payload: &str) -> Option<String> {
    let v: Value = serde_json::from_str(payload).ok()?;
    v.get("status")?.as_str().map(String::from)
}

/// Priority order of sale statuses (higher index = more advanced).
const SALE_STATUS_ORDER: &[&str] = &["active", "pending", "completed", "voided", "refunded"];

fn sale_status_rank(status: &str) -> usize {
    SALE_STATUS_ORDER
        .iter()
        .position(|&s| s == status)
        .unwrap_or(0)
}

// ── Legacy resolver (unchanged) ──────────────────────────────────────

/// Resolve a conflict using Last-Write-Wins (LWW) by `created_at`.
///
/// Compares the `created_at` timestamps of the local and remote items.
/// The item with the later timestamp wins. If timestamps are equal, the
/// remote item wins (server-authoritative).
///
/// This is the **fallback** resolver for unknown action types (ADR-21 §1).
pub fn resolve_lww(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let winner = if local.created_at > remote.created_at {
        local.clone()
    } else {
        // Remote wins on tie (server-authoritative).
        remote.clone()
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}

// ── ADR-21 resolvers ────────────────────────────────────────────────

/// Resolve a conflict using Version LWW for reference data.
///
/// Extracts the `version` field from each item's JSON payload and compares
/// as integers. The item with the higher version wins. On tie, the remote
/// item wins (server-authoritative).
///
/// If either payload lacks a `version` field, falls back to `created_at` LWW.
///
/// **Used for:** `product.*`, `category.*`, `tax.*`, `user.*`, `staff.*`
pub fn resolve_version_lww(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let local_ver = extract_version(&local.payload);
    let remote_ver = extract_version(&remote.payload);

    let winner = match (local_ver, remote_ver) {
        (Some(lv), Some(rv)) if lv > rv => local.clone(),
        (Some(_), Some(_)) => remote.clone(), // remote wins on tie or lower
        (Some(_), None) => local.clone(),     // local has version, remote doesn't
        (None, Some(_)) => remote.clone(),    // remote has version, local doesn't
        (None, None) => {
            // Neither has version — fall back to created_at LWW
            if local.created_at > remote.created_at {
                local.clone()
            } else {
                remote.clone()
            }
        }
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}

/// Resolve a conflict for sale items using status DAG ordering.
///
/// Sale statuses follow a legal transition graph:
/// `active → pending → completed → voided → refunded`
///
/// The item with the **most advanced** status wins — not the most recent
/// timestamp. This prevents a completed sale from being reverted to
/// "pending" by a stale remote item.
///
/// If both items have the same status rank, falls back to version LWW.
///
/// **Used for:** `sale.*`, `complete_sale`, `void_sale`, `refund_sale`
pub fn resolve_sale_lww(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let local_status = extract_status(&local.payload).unwrap_or_default();
    let remote_status = extract_status(&remote.payload).unwrap_or_default();

    let local_rank = sale_status_rank(&local_status);
    let remote_rank = sale_status_rank(&remote_status);

    let winner = if local_rank > remote_rank {
        local.clone()
    } else if remote_rank > local_rank {
        remote.clone()
    } else {
        // Same status rank — fall back to version LWW.
        // Call the version resolver directly on the items.
        return resolve_version_lww(local, remote);
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}

/// Flatten one payload into the ordered list of leaf stock deltas it carries.
///
/// A plain delta (or any value that is not a `crdt_delta` envelope) yields a
/// one-element list containing itself. An envelope yields its `local` followed
/// by its `remote`, and — so a re-merge of an already-flattened envelope never
/// drops a delta — also `local_extra` / `remote_extra` when present. The
/// returned flag says whether a flattening actually happened, which is what the
/// caller logs.
///
/// Recursion is bounded: the envelope form this function produces is exactly
/// one level deep, so a decoded envelope contributes leaf deltas, never another
/// envelope.
fn flatten_stock_deltas(payload: &str) -> (Vec<Value>, bool) {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        // Unparseable: hand it through verbatim; the applier reports it.
        return (vec![Value::Null], false);
    };

    let is_envelope = value.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta");
    if !is_envelope {
        return (vec![value], false);
    }

    let mut deltas = Vec::with_capacity(4);
    for key in ["local", "remote", "local_extra", "remote_extra"] {
        if let Some(side) = value.get(key) {
            // A side that is itself still an envelope (should not happen once
            // this guard is in place, but old rows exist) is flattened here too,
            // so the result is always leaf deltas.
            if side.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta") {
                let nested = serde_json::to_string(side).unwrap_or_default();
                let (mut inner, _) = flatten_stock_deltas(&nested);
                deltas.append(&mut inner);
            } else {
                deltas.push(side.clone());
            }
        }
    }
    (deltas, true)
}

/// Resolve a conflict for stock movements using CRDT delta merge.
///
/// Stock movements are immutable delta rows — both deltas are valid and
/// should be applied. The merged winner carries both payloads combined.
///
/// **Used for:** `stock.adjusted`, `stock.movement`
///
/// # Refusing to nest (the depth guard)
///
/// A merged winner is itself a queue row, so a later conflict on it arrives
/// here with a side that is ALREADY an envelope. Wrapping it again produced
/// `{local: {local, remote, merge_type}, ...}`, and the appliers read only one
/// level (`payload.get("local")`), so the inner envelope failed to deserialize
/// as a stock delta. That failure — not a guard — was the only thing stopping a
/// conflict loop, and it was silent.
///
/// This function now refuses to nest. Every leaf delta on both sides is
/// FLATTENED into one level: the first two become the envelope's `local` and
/// `remote` (the keys the four `queue.rs` consumers already read), and any
/// further deltas are carried in an `extra` array that those consumers also
/// apply. When both sides are envelopes the four sub-deltas therefore survive as
/// `local`, `remote` and two `extra` entries — no delta is dropped, and the
/// result is never more than one level deep.
///
/// A side that is neither a valid envelope nor a valid delta is passed through
/// as-is: this function must not invent a payload, and the applier's own error
/// message is the authority on a malformed one.
pub fn resolve_stock_crdt(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    // CRDT merge: every leaf delta on both sides is valid and must survive.
    let (mut deltas, local_flattened) = flatten_stock_deltas(&local.payload);
    let (remote_deltas, remote_flattened) = flatten_stock_deltas(&remote.payload);
    deltas.extend(remote_deltas);

    // The envelope shape is fixed by its four consumers in `queue.rs`: they read
    // `local` and `remote`. Keep those two keys for the first two deltas and
    // carry any remaining ones in `extra`, so an already-flattened re-merge
    // loses nothing while every existing reader keeps working unchanged.
    let mut env = serde_json::Map::new();
    let mut extras: Vec<Value> = Vec::new();
    for (i, delta) in deltas.into_iter().enumerate() {
        match i {
            0 => env.insert("local".to_string(), delta),
            1 => env.insert("remote".to_string(), delta),
            _ => {
                extras.push(delta);
                continue;
            }
        };
    }
    if !extras.is_empty() {
        env.insert("extra".to_string(), Value::Array(extras));
    }
    env.insert("merge_type".to_string(), Value::String("crdt_delta".into()));

    // A nested envelope is a defect the old code tolerated by accident; record
    // it once per flattening so the repair is visible in a log rather than
    // silent. Never the payload contents — these are merchant stock deltas.
    if local_flattened || remote_flattened {
        tracing::warn!(
            local_flattened,
            remote_flattened,
            "crdt: a merged stock envelope was flattened instead of re-nested (depth guard)"
        );
    }

    let merged_payload = Value::Object(env).to_string();

    let winner = OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: local.action.clone(),
        payload: merged_payload,
        status: local.status,
        retry_count: local.retry_count.max(remote.retry_count),
        last_error: local
            .last_error
            .clone()
            .or_else(|| remote.last_error.clone()),
        created_at: local.created_at.clone(),
        synced_at: None,
        tenant_id: local.tenant_id.clone(),
        priority: local.priority,
        // The merged item is the local mutation, so it keeps the local
        // origin; C3 reads it to recognise a terminal's own push.
        origin_terminal_id: local.origin_terminal_id.clone(),
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}

// ── Dispatch ─────────────────────────────────────────────────────────

/// Resolve a conflict between a local and remote offline queue item.
///
/// Dispatches to the appropriate strategy based on the action prefix
/// (ADR-21 §1 — Entity-Type Dispatch).
///
/// | Action prefix | Strategy | Behaviour |
/// |---|---|---|
/// | `product.*`, `category.*`, `tax.*`, `user.*`, `staff.*` | Version LWW | Higher `version` wins |
/// | `sale.*`, `complete_sale`, `void_sale`, `refund_sale` | Sale LWW | Higher `status` rank wins |
/// | `stock.*` | CRDT merge | Both deltas preserved |
/// | `*` (fallback) | Created-at LWW | Later `created_at` wins |
pub fn resolve_conflict(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let action = local.action.as_str();

    if action.starts_with("sale.")
        || action == "complete_sale"
        || action == "void_sale"
        || action == "refund_sale"
    {
        resolve_sale_lww(local, remote)
    } else if action.starts_with("stock.") {
        resolve_stock_crdt(local, remote)
    } else if action.starts_with("product.")
        || action.starts_with("category.")
        || action.starts_with("tax.")
        || action.starts_with("user.")
        || action.starts_with("staff.")
        || action.starts_with("setting.")
        || action.starts_with("settings.")
        || action.starts_with("preference.")
    {
        resolve_version_lww(local, remote)
    } else {
        // Fallback: original LWW by created_at.
        resolve_lww(local, remote)
    }
}

#[cfg(test)]
#[path = "conflict_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "conflict_proptests.rs"]
mod proptests;
