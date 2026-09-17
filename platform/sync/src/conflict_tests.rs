//! Unit tests for conflict resolution (`conflict.rs`): legacy
//! created-at LWW fallback, version LWW (ties, missing/negative/zero/
//! large versions, extra payload fields), sale status DAG ordering
//! (P3 completed-sale immutability, void/refund precedence), stock
//! CRDT merge edge cases (invalid payloads, retry/last_error/tenant
//! preservation), ADR-21 dispatch prefixes (setting.*, preference.*),
//! and the payload field extractors. Extracted from the inline
//! `mod tests` in `conflict.rs` (F-018).

use super::*;
use kasirmu_core::offline::OfflineQueueStatus;

fn make_item(created_at: &str, action: &str) -> OfflineQueueItem {
    OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: action.to_owned(),
        payload: "{}".to_owned(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at: created_at.to_owned(),
        synced_at: None,
        tenant_id: "default".into(),
        priority: kasirmu_core::offline::SyncPriority::Normal,
    }
}

fn make_item_with_version(
    created_at: &str,
    action: &str,
    version: i64,
    extra: &str,
) -> OfflineQueueItem {
    let payload = if extra.is_empty() {
        format!(r#"{{"version":{version}}}"#)
    } else {
        format!(r#"{{"version":{version},{extra}}}"#)
    };
    OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: action.to_owned(),
        payload,
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at: created_at.to_owned(),
        synced_at: None,
        tenant_id: "default".into(),
        priority: kasirmu_core::offline::SyncPriority::Normal,
    }
}

fn make_sale_item(created_at: &str, action: &str, status: &str, version: i64) -> OfflineQueueItem {
    make_item_with_version(
        created_at,
        action,
        version,
        &format!(r#""status":"{status}""#),
    )
}

fn make_stock_item(created_at: &str, action: &str, delta: i64, sku: &str) -> OfflineQueueItem {
    let payload = format!(r#"{{"sku":"{sku}","delta":{delta}}}"#);
    OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: action.to_owned(),
        payload,
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at: created_at.to_owned(),
        synced_at: None,
        tenant_id: "default".into(),
        priority: kasirmu_core::offline::SyncPriority::Normal,
    }
}

// ── Legacy LWW tests (unchanged) ─────────────────────────────

#[test]
fn lww_local_wins_when_newer() {
    let local = make_item("2025-06-01T12:00:00.000Z", "complete_sale");
    let remote = make_item("2025-06-01T10:00:00.000Z", "complete_sale");
    let resolved = resolve_lww(&local, &remote);
    assert_eq!(resolved.winner.id, local.id);
}

#[test]
fn lww_remote_wins_when_newer() {
    let local = make_item("2025-06-01T10:00:00.000Z", "complete_sale");
    let remote = make_item("2025-06-01T12:00:00.000Z", "complete_sale");
    let resolved = resolve_lww(&local, &remote);
    assert_eq!(resolved.winner.id, remote.id);
}

#[test]
fn lww_remote_wins_on_tie() {
    let local = make_item("2025-06-01T12:00:00.000Z", "complete_sale");
    let remote = make_item("2025-06-01T12:00:00.000Z", "complete_sale");
    let resolved = resolve_lww(&local, &remote);
    assert_eq!(resolved.winner.id, remote.id);
}

#[test]
fn lww_different_actions() {
    let local = make_item("2025-06-01T12:00:00.000Z", "create_product");
    let remote = make_item("2025-06-01T10:00:00.000Z", "delete_product");
    let resolved = resolve_lww(&local, &remote);
    assert_eq!(resolved.winner.action, "create_product");
}

#[test]
fn lww_empty_payload() {
    let mut local = make_item("2025-06-01T12:00:00.000Z", "test");
    let mut remote = make_item("2025-06-01T10:00:00.000Z", "test");
    local.payload = String::new();
    remote.payload = String::new();
    let resolved = resolve_lww(&local, &remote);
    assert!(resolved.winner.payload.is_empty());
}

// ── Version LWW tests ─────────────────────────────────────────

#[test]
fn version_lww_local_wins_higher_version() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 5, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 3, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "local should win with version 5 > 3"
    );
}

#[test]
fn version_lww_remote_wins_higher_version() {
    let local = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 2, "");
    let remote = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 7, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "remote should win with version 7 > 2"
    );
}

#[test]
fn version_lww_remote_wins_on_tie() {
    let local = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 4, "");
    let remote = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 4, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "remote should win on version tie (server-authoritative)"
    );
}

#[test]
fn version_lww_local_has_version_remote_missing() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 3, "");
    let remote = make_item("2025-06-01T12:00:00.000Z", "product.update");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "local should win when remote lacks version"
    );
}

#[test]
fn version_lww_remote_has_version_local_missing() {
    let local = make_item("2025-06-01T10:00:00.000Z", "product.update");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 3, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "remote should win when local lacks version"
    );
}

#[test]
fn version_lww_both_missing_falls_back_to_created_at() {
    let local = make_item("2025-06-01T12:00:00.000Z", "product.update");
    let remote = make_item("2025-06-01T10:00:00.000Z", "product.update");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "should fall back to created_at when both lack version"
    );
}

#[test]
fn version_lww_applied_to_category_action() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "category.update", 2, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "category.update", 5, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(resolved.winner.id, remote.id);
}

#[test]
fn version_lww_applied_to_tax_action() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "tax.update", 1, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "tax.update", 1, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(resolved.winner.id, remote.id, "tie → remote wins");
}

// ── Sale LWW tests ────────────────────────────────────────────

#[test]
fn sale_lww_completed_wins_over_pending() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "pending", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "completed sale should win over pending (even though local is newer)"
    );
}

#[test]
fn sale_lww_voided_wins_over_completed() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "void_sale", "voided", 3);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "void_sale", "completed", 2);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "voided should win over completed (status DAG)"
    );
}

#[test]
fn sale_lww_refunded_is_highest() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "refund_sale", "refunded", 5);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "refund_sale", "voided", 4);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "refunded should win over voided"
    );
}

#[test]
fn sale_lww_same_status_falls_back_to_version() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 10);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "completed", 8);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "same status → higher version (10 > 8) should win"
    );
}

#[test]
fn sale_lww_same_status_same_version_remote_wins() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "completed", 7);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 7);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "same status + same version → remote wins (server-authoritative)"
    );
}

#[test]
fn sale_lww_active_cannot_override_completed() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "active", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 5);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "active cannot override completed (status DAG)"
    );
}

#[test]
fn sale_lww_unknown_status_ranked_zero() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "unknown", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "active", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "unknown status (rank 0) should lose to active (rank 1)"
    );
}

#[test]
fn sale_lww_both_unknown_falls_back_to_version() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "weird", 9);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "strange", 5);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "both unknown (rank 0) → higher version (9 > 5) wins"
    );
}

// ── Stock CRDT merge tests ────────────────────────────────────

#[test]
fn stock_crdt_merged_payload_contains_both_deltas() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 10, "COFFEE");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", -3, "COFFEE");
    let resolved = resolve_stock_crdt(&local, &remote);

    // Winner is a new merged item with both deltas.
    let winner_payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(winner_payload["local"]["delta"], 10);
    assert_eq!(winner_payload["remote"]["delta"], -3);
    assert_eq!(winner_payload["merge_type"], "crdt_delta");
    assert_eq!(resolved.winner.action, "stock.adjusted");
}

#[test]
fn stock_crdt_preserves_local_and_remote_references() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 5, "BAGEL");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", -2, "BAGEL");
    let resolved = resolve_stock_crdt(&local, &remote);

    assert!(resolved.local.is_some());
    assert!(resolved.remote.is_some());
    assert_eq!(resolved.local.unwrap().id, local.id);
    assert_eq!(resolved.remote.unwrap().id, remote.id);
}

#[test]
fn stock_crdt_winner_has_new_id() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 1, "TEA");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "TEA");
    let resolved = resolve_stock_crdt(&local, &remote);

    assert_ne!(resolved.winner.id, local.id);
    assert_ne!(resolved.winner.id, remote.id);
    assert!(!resolved.winner.id.is_empty());
}

#[test]
fn stock_crdt_handles_invalid_payload_gracefully() {
    let mut local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 1, "MILK");
    let mut remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "MILK");
    local.payload = "not-json".into();
    remote.payload = "also-not-json".into();
    let resolved = resolve_stock_crdt(&local, &remote);

    // Should not panic — uses null for unparseable payloads.
    let winner_payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(winner_payload["local"], Value::Null);
    assert_eq!(winner_payload["remote"], Value::Null);
}

// ── Resolve conflict dispatch tests ───────────────────────────

#[test]
fn dispatch_uses_version_lww_for_product() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 5, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 3, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "product.* should use version LWW"
    );
}

#[test]
fn dispatch_uses_version_lww_for_category() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "category.update", 2, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "category.update", 5, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "category.* should use version LWW"
    );
}

#[test]
fn dispatch_uses_version_lww_for_tax() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "tax.update", 1, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "tax.update", 1, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "tax.* should use version LWW"
    );
}

#[test]
fn dispatch_uses_version_lww_for_user() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "user.update", 3, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "user.update", 1, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "user.* should use version LWW"
    );
}

#[test]
fn dispatch_uses_version_lww_for_staff() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "staff.update", 2, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "staff.update", 4, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "staff.* should use version LWW"
    );
}

#[test]
fn dispatch_uses_sale_lww_for_complete_sale() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "pending", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 5);
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "complete_sale should use sale LWW (completed > pending)"
    );
}

#[test]
fn dispatch_uses_sale_lww_for_void_sale() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "void_sale", "voided", 3);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "void_sale", "completed", 2);
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "void_sale should use sale LWW (voided > completed)"
    );
}

#[test]
fn dispatch_uses_sale_lww_for_refund_sale() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "refund_sale", "active", 1);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "refund_sale", "refunded", 5);
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "refund_sale should use sale LWW"
    );
}

#[test]
fn dispatch_uses_sale_lww_for_sale_prefix() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "sale.hold", "pending", 1);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "sale.hold", "completed", 5);
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "sale.* should use sale LWW (completed > pending)"
    );
}

#[test]
fn dispatch_uses_stock_crdt_for_stock_adjusted() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 10, "COFFEE");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", -3, "COFFEE");
    let resolved = resolve_conflict(&local, &remote);

    let payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(
        payload["merge_type"], "crdt_delta",
        "stock.* should use CRDT merge"
    );
}

#[test]
fn dispatch_uses_stock_crdt_for_stock_movement() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.movement", 5, "BAGEL");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.movement", -1, "BAGEL");
    let resolved = resolve_conflict(&local, &remote);

    let payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(
        payload["merge_type"], "crdt_delta",
        "stock.movement should use CRDT merge"
    );
}

#[test]
fn dispatch_fallback_to_lww_for_unknown_action() {
    let local = make_item("2025-06-01T12:00:00.000Z", "unknown.action");
    let remote = make_item("2025-06-01T10:00:00.000Z", "unknown.action");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "unknown action should fall back to created_at LWW"
    );
}

#[test]
fn dispatch_fallback_remote_wins_on_tie() {
    let local = make_item("2025-06-01T12:00:00.000Z", "mystery.op");
    let remote = make_item("2025-06-01T12:00:00.000Z", "mystery.op");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "unknown action tie → remote wins (server-authoritative)"
    );
}

// ── Edge cases ───────────────────────────────────────────────

#[test]
fn resolved_item_preserves_both_items() {
    let local = make_item("2025-06-01T10:00:00.000Z", "update");
    let remote = make_item("2025-06-01T12:00:00.000Z", "update");
    let resolved = resolve_lww(&local, &remote);
    assert!(resolved.local.is_some());
    assert!(resolved.remote.is_some());
    assert_eq!(resolved.local.unwrap().id, local.id);
    assert_eq!(resolved.remote.unwrap().id, remote.id);
}

#[test]
fn resolved_item_debug() {
    let local = make_item("2025-06-01T10:00:00.000Z", "update");
    let remote = make_item("2025-06-01T12:00:00.000Z", "update");
    let resolved = resolve_lww(&local, &remote);
    let debug = format!("{resolved:?}");
    assert!(debug.contains(&local.id));
    assert!(debug.contains(&remote.id));
}

#[test]
fn version_lww_preserves_extra_payload_fields() {
    let local = make_item_with_version(
        "2025-06-01T10:00:00.000Z",
        "product.update",
        3,
        r#""name":"Coffee","price":15000"#,
    );
    let remote = make_item_with_version(
        "2025-06-01T12:00:00.000Z",
        "product.update",
        1,
        r#""name":"Tea","price":10000"#,
    );
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(resolved.winner.id, local.id);

    // Winner payload should still contain the extra fields.
    let payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(payload["name"], "Coffee");
    assert_eq!(payload["price"], 15000);
}

#[test]
fn extract_version_from_valid_payload() {
    assert_eq!(extract_version(r#"{"version":5}"#), Some(5));
    assert_eq!(extract_version(r#"{"version":0}"#), Some(0));
    assert_eq!(extract_version(r#"{"version":-1}"#), Some(-1));
}

#[test]
fn extract_version_from_invalid_payload() {
    assert_eq!(extract_version("not-json"), None);
    assert_eq!(extract_version(r#"{"no_version":1}"#), None);
    assert_eq!(extract_version(r#"{"version":"abc"}"#), None);
    assert_eq!(extract_version(""), None);
}

#[test]
fn extract_status_from_valid_payload() {
    assert_eq!(
        extract_status(r#"{"status":"completed"}"#),
        Some("completed".into())
    );
    assert_eq!(
        extract_status(r#"{"status":"pending"}"#),
        Some("pending".into())
    );
}

#[test]
fn extract_status_from_invalid_payload() {
    assert_eq!(extract_status("not-json"), None);
    assert_eq!(extract_status(r#"{"no_status":true}"#), None);
    assert_eq!(extract_status(r#"{"status":123}"#), None);
}

#[test]
fn sale_status_rank_ordering() {
    assert_eq!(sale_status_rank("active"), 0);
    assert_eq!(sale_status_rank("pending"), 1);
    assert_eq!(sale_status_rank("completed"), 2);
    assert_eq!(sale_status_rank("voided"), 3);
    assert_eq!(sale_status_rank("refunded"), 4);
    assert_eq!(sale_status_rank("unknown"), 0);
}

#[test]
fn p3_completed_sale_immutable_over_active_mutation() {
    let completed_sale =
        make_sale_item("2026-07-24T10:00:00.000Z", "complete_sale", "completed", 1);
    let active_mutation = make_sale_item("2026-07-24T12:00:00.000Z", "sale.update", "active", 2);

    let resolved = resolve_conflict(&completed_sale, &active_mutation);
    assert_eq!(
        resolved.winner.id, completed_sale.id,
        "Completed sale must stand immutable over non-terminal active edit"
    );
}

#[test]
fn p3_void_sale_wins_over_completed_sale() {
    let completed_sale =
        make_sale_item("2026-07-24T10:00:00.000Z", "complete_sale", "completed", 1);
    let void_sale = make_sale_item("2026-07-24T10:05:00.000Z", "void_sale", "voided", 1);

    let resolved = resolve_conflict(&completed_sale, &void_sale);
    assert_eq!(
        resolved.winner.id, void_sale.id,
        "Voided status (rank 3) must take precedence over completed status (rank 2)"
    );
}

#[test]
fn p3_refund_sale_wins_over_completed_sale() {
    let completed_sale =
        make_sale_item("2026-07-24T10:00:00.000Z", "complete_sale", "completed", 1);
    let refund_sale = make_sale_item("2026-07-24T10:10:00.000Z", "refund_sale", "refunded", 1);

    let resolved = resolve_conflict(&completed_sale, &refund_sale);
    assert_eq!(
        resolved.winner.id, refund_sale.id,
        "Refunded status (rank 4) must take precedence over completed status (rank 2)"
    );
}

#[test]
fn p3_settings_dispatch_version_lww() {
    let local_setting = make_item_with_version(
        "2026-07-24T10:00:00.000Z",
        "settings.update",
        5,
        r#""store_name":"OZ Store Main""#,
    );
    let remote_setting = make_item_with_version(
        "2026-07-24T12:00:00.000Z",
        "settings.update",
        3,
        r#""store_name":"OZ Store Stale""#,
    );

    let resolved = resolve_conflict(&local_setting, &remote_setting);
    assert_eq!(
        resolved.winner.id, local_setting.id,
        "Settings conflict must use Version LWW (v5 > v3)"
    );
}

#[test]
fn p3_stock_crdt_delta_merge_preserves_both() {
    let local_stock = make_stock_item("2026-07-24T10:00:00.000Z", "stock.adjusted", -5, "SKU-100");
    let remote_stock = make_stock_item("2026-07-24T10:01:00.000Z", "stock.adjusted", -2, "SKU-100");

    let resolved = resolve_conflict(&local_stock, &remote_stock);
    let winner_payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(winner_payload["merge_type"], "crdt_delta");
    assert_eq!(winner_payload["local"]["delta"], -5);
    assert_eq!(winner_payload["remote"]["delta"], -2);
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────

// ── setting.* and preference.* dispatch ──────────────────────────

#[test]
fn dispatch_uses_version_lww_for_setting_prefix() {
    let local = make_item_with_version(
        "2025-06-01T10:00:00.000Z",
        "setting.update",
        5,
        r#""store_name":"OZ Main""#,
    );
    let remote = make_item_with_version(
        "2025-06-01T12:00:00.000Z",
        "setting.update",
        3,
        r#""store_name":"OZ Stale""#,
    );
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "setting.* should use version LWW (v5 > v3)"
    );
}

#[test]
fn dispatch_uses_version_lww_for_preference_prefix() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "preference.update", 2, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "preference.update", 4, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "preference.* should use version LWW (v4 > v2)"
    );
}

#[test]
fn dispatch_uses_version_lww_for_user_prefix() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "user.create", 1, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "user.create", 3, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "user.* should use version LWW (v3 > v1)"
    );
}

#[test]
fn dispatch_uses_version_lww_for_staff_prefix() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "staff.update", 7, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "staff.update", 2, "");
    let resolved = resolve_conflict(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "staff.* should use version LWW (v7 > v2)"
    );
}

// ── Negative and zero version numbers ────────────────────────────

#[test]
fn version_lww_negative_version() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", -1, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 0, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "version 0 > -1, remote should win"
    );
}

#[test]
fn version_lww_zero_vs_zero_remote_wins() {
    let local = make_item_with_version("2025-06-01T12:00:00.000Z", "product.update", 0, "");
    let remote = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", 0, "");
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "version 0 == 0 tie → remote wins"
    );
}

// ── CRDT merge edge cases ────────────────────────────────────────

#[test]
fn stock_crdt_mixed_valid_invalid_payloads() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 10, "COFFEE");
    let mut remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", -3, "COFFEE");
    remote.payload = "not-json".into();
    let resolved = resolve_stock_crdt(&local, &remote);

    let winner_payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    // Local is valid JSON, remote is invalid → null.
    assert_eq!(winner_payload["local"]["delta"], 10);
    assert_eq!(winner_payload["remote"], Value::Null);
    assert_eq!(winner_payload["merge_type"], "crdt_delta");
}

#[test]
fn stock_crdt_preserves_retry_count_max() {
    let mut local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 5, "TEA");
    local.retry_count = 3;
    let mut remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "TEA");
    remote.retry_count = 7;
    let resolved = resolve_stock_crdt(&local, &remote);
    assert_eq!(
        resolved.winner.retry_count, 7,
        "winner should have max retry_count"
    );
}

#[test]
fn stock_crdt_preserves_last_error_from_either() {
    let mut local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 5, "MILK");
    local.last_error = Some("local error".into());
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "MILK");
    // remote has no last_error → local's is preserved.
    let resolved = resolve_stock_crdt(&local, &remote);
    assert_eq!(
        resolved.winner.last_error.as_deref(),
        Some("local error"),
        "winner should preserve local last_error when remote has none"
    );
}

#[test]
fn stock_crdt_prefers_local_last_error_when_both_present() {
    let mut local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 5, "MILK");
    local.last_error = Some("local error".into());
    let mut remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "MILK");
    remote.last_error = Some("remote error".into());
    let resolved = resolve_stock_crdt(&local, &remote);
    assert_eq!(
        resolved.winner.last_error.as_deref(),
        Some("local error"),
        "winner should prefer local last_error when both present"
    );
}

#[test]
fn stock_crdt_preserves_tenant_id() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.adjusted", 5, "SUGAR");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.adjusted", 2, "SUGAR");
    let resolved = resolve_stock_crdt(&local, &remote);
    assert_eq!(
        resolved.winner.tenant_id, "default",
        "winner should preserve tenant_id"
    );
}

// ── Sale LWW with missing/empty status ───────────────────────────

#[test]
fn sale_lww_missing_status_falls_back_to_version() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "complete_sale", 5, "");
    let remote = make_item_with_version("2025-06-01T12:00:00.000Z", "complete_sale", 3, "");
    let resolved = resolve_sale_lww(&local, &remote);
    // Both have no status → rank 0 for both → falls back to version LWW.
    assert_eq!(
        resolved.winner.id, local.id,
        "missing status on both → version LWW (v5 > v3)"
    );
}

#[test]
fn sale_lww_empty_status_ranked_zero() {
    let mut local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "completed", 1);
    // Override payload to have empty status string.
    local.payload = r#"{"status":""}"#.into();
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "active", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "empty status (rank 0) loses to active (rank 1)"
    );
}

// ── Sale status rank ordering completeness ────────────────────────

#[test]
fn sale_status_rank_refunded_over_voided() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "refund_sale", "refunded", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "void_sale", "voided", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "refunded (rank 4) > voided (rank 3)"
    );
}

#[test]
fn sale_status_rank_completed_over_pending() {
    let local = make_sale_item("2025-06-01T12:00:00.000Z", "complete_sale", "pending", 1);
    let remote = make_sale_item("2025-06-01T10:00:00.000Z", "complete_sale", "completed", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "completed (rank 2) > pending (rank 1)"
    );
}

#[test]
fn sale_status_rank_pending_over_active() {
    let local = make_sale_item("2025-06-01T10:00:00.000Z", "sale.update", "active", 1);
    let remote = make_sale_item("2025-06-01T12:00:00.000Z", "sale.update", "pending", 1);
    let resolved = resolve_sale_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, remote.id,
        "pending (rank 1) > active (rank 0)"
    );
}

// ── CRDT merge action preservation ────────────────────────────────

#[test]
fn stock_crdt_preserves_action() {
    let local = make_stock_item("2025-06-01T10:00:00.000Z", "stock.movement", 5, "WHEAT");
    let remote = make_stock_item("2025-06-01T12:00:00.000Z", "stock.movement", -1, "WHEAT");
    let resolved = resolve_stock_crdt(&local, &remote);
    assert_eq!(resolved.winner.action, "stock.movement");
}

// ── Version LWW with very large versions ─────────────────────────

#[test]
fn version_lww_large_version_numbers() {
    let local = make_item_with_version("2025-06-01T10:00:00.000Z", "product.update", i64::MAX, "");
    let remote = make_item_with_version(
        "2025-06-01T12:00:00.000Z",
        "product.update",
        i64::MAX - 1,
        "",
    );
    let resolved = resolve_version_lww(&local, &remote);
    assert_eq!(
        resolved.winner.id, local.id,
        "i64::MAX > i64::MAX - 1, local should win"
    );
}
