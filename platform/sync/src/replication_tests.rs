//! Unit tests for `ReplicationResult` — sibling test file per AGENTS.md
//! (tests must never live inside production `.rs` files; COR-33).
//!
//! Wired from `replication.rs` via `#[cfg(test)] #[path = "replication_tests.rs"]
//! mod tests;`.

use super::*;

#[test]
fn replication_result_default() {
    let result = ReplicationResult::default();
    assert_eq!(result.pushed, 0);
    assert_eq!(result.pulled, 0);
}

#[test]
fn replication_result_serde_roundtrip() {
    let result = ReplicationResult {
        pushed: 10,
        pulled: 3,
    };
    let json = serde_json::to_string(&result).unwrap();
    let back: ReplicationResult = serde_json::from_str(&json).unwrap();
    assert_eq!(back.pushed, 10);
    assert_eq!(back.pulled, 3);
}

#[test]
fn replication_result_serde_json_field_names() {
    let result = ReplicationResult {
        pushed: 5,
        pulled: 2,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["pushed"], 5);
    assert_eq!(json["pulled"], 2);
}

#[test]
fn replication_result_debug() {
    let result = ReplicationResult {
        pushed: 1,
        pulled: 2,
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("pushed: 1"));
    assert!(debug.contains("pulled: 2"));
}

#[test]
fn replication_result_clone() {
    let a = ReplicationResult {
        pushed: 7,
        pulled: 4,
    };
    let b = a.clone();
    assert_eq!(a.pushed, b.pushed);
    assert_eq!(a.pulled, b.pulled);
}
