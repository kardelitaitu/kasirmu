//! Stamp a pushed payload with the sender's causality metadata.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: stamping is additive and never destructive — a payload that is not a
JSON object is returned byte-for-byte unchanged rather than wrapped, because
rewrapping would change the wire shape the server already parses. The vector is
a single-entry one ({own terminal: counter}); that is a valid VersionVector and
is exactly what cross-terminal concurrency needs — terminal A sending {A:n}
against B's {B:m} is concurrent, while A's own later push {A:n+1} is ordered
after it.
next: wire the persisted counter so a restart does not rewind | perf: N/A
*/
//!
//! Without these two fields the server cannot compare a push against what it
//! already holds, and every item is skipped by the detector. The server treats
//! a missing vector as "peer predates vector support", which is safe but
//! blind.

use serde_json::Value;

use super::lamport::Counter;

/// Payload field carrying the sender's version vector. Must match
/// `oz_cloud_server::conflict_resolution::VECTOR_FIELD`.
pub const VECTOR_FIELD: &str = "_vector";

/// Payload field carrying the sending terminal's id. Must match
/// `oz_cloud_server::conflict_resolution::TERMINAL_FIELD`.
pub const TERMINAL_FIELD: &str = "_terminal";

/// Whether a payload already carries a vector.
pub fn is_stamped(payload: &str) -> bool {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|v| v.get(VECTOR_FIELD).cloned())
        .is_some()
}

/// Add `_vector` and `_terminal` to a payload, preserving every existing key.
///
/// Returns the input unchanged when it is not a JSON object — an array or a
/// bare string payload keeps its exact wire shape, and the server will simply
/// skip detection for it. Silently rewriting it into an object would be worse:
/// the server would parse a shape the producer never sent.
pub fn stamp_payload(payload: &str, terminal_id: &str, counter: Counter) -> String {
    let Ok(mut value) = serde_json::from_str::<Value>(payload) else {
        return payload.to_string();
    };

    let Some(object) = value.as_object_mut() else {
        return payload.to_string();
    };

    object.insert(
        TERMINAL_FIELD.to_string(),
        Value::String(terminal_id.to_string()),
    );
    object.insert(
        VECTOR_FIELD.to_string(),
        serde_json::json!({ terminal_id: counter }),
    );

    serde_json::to_string(&value).unwrap_or_else(|_| payload.to_string())
}

#[cfg(test)]
#[path = "push_stamp_tests.rs"]
mod tests;
