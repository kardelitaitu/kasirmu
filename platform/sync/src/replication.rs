//! Replication — orchestrates push and pull sync cycles.
/*
last audited (date unknown) by DSH-Agent
crate: platform-sync (replication) | status: SAFE | lint: CLEAN
findings: clean — ReplicationResult counts struct only; orchestration lives in the engine and daemon. COR-33 FIXED (date unknown) — inline tests moved to sibling replication_tests.rs.
next: none | perf: N/A
*/
//!
//! A sync cycle consists of:
//!
//! 1. **Push** — send all pending local changes to the remote server
//! 2. **Pull** — fetch changes from the server that occurred since the
//!    last sync, and apply them locally

use serde::{Deserialize, Serialize};

/// Result of a full push+pull replication cycle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReplicationResult {
    /// Number of items successfully pushed to the server.
    pub pushed: usize,
    /// Number of items pulled from the server.
    pub pulled: usize,
}

#[cfg(test)]
#[path = "replication_tests.rs"]
mod tests;
