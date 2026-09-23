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

/// Resolve a conflict for stock movements using CRDT delta merge.
///
/// Stock movements are immutable delta rows — both deltas are valid and
/// should be applied. The merged winner carries both payloads combined.
///
/// **Used for:** `stock.adjusted`, `stock.movement`
pub fn resolve_stock_crdt(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    // CRDT merge: both deltas are valid. The merged payload carries both.
    let merged_payload = serde_json::json!({
        "local": serde_json::from_str::<Value>(&local.payload).unwrap_or(Value::Null),
        "remote": serde_json::from_str::<Value>(&remote.payload).unwrap_or(Value::Null),
        "merge_type": "crdt_delta"
    })
    .to_string();

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
