//! Topology revision history (ADR #46).
//!
//! Apply already maintained a monotonic `revision` inside the graph envelope,
//! but it overwrote the previous envelope — a revision NUMBER with no revision
//! HISTORY. This module turns the number into rows.
//!
//! # Why the history has no gaps
//!
//! Apply is the only production write path that bumps `revision`. The plain
//! `save_topology` command is `#[cfg(test)]` (`commands.rs:142`), deliberately,
//! so that no second production write path is exposed over IPC. Every revision
//! number the envelope counter produces therefore gets exactly one row here.
//!
//! # Why the INSERT belongs in Apply's transaction
//!
//! `insert_topology_revision` is called with the SAME `Transaction` that writes
//! the envelope (ADR #46 §3). Anywhere else admits two failures:
//!
//! - **Before the workspace transaction** — a compensated Apply leaves a row
//!   for a deploy that never happened, and its `revision` then collides with
//!   the real one.
//! - **After `commit()`** — a crash in that window loses the row for an Apply
//!   that DID happen, which is worse: the history looks complete.
//!
//! The envelope write, the runtime-plan write, the request ledger, and the
//! recovery-journal clear already share one `IMMEDIATE` transaction
//! (`persistence.rs:265-272`, which documents a fixed lost-update TOCTOU). This
//! insert joins them, so history and current state commit or roll back
//! together.
//!
//! The cross-database recovery path needs no handling here. When it finds the
//! desired diagram already present it only clears the journal — and the row was
//! committed with that diagram. When it compensates, it restores the previous
//! envelope and never increments `revision`, so no row is expected.
//!
//! Wave E (step d-pre): the bodies moved to
//! `kasirmu_bridge::topology::revisions`; this module is the re-export shim. It has
//! no imports of its own: the `use super::semantics::topology_validation` line
//! was a private import feeding this file bodies, so it moved with them, and
//! the two listing-limit constants are not exported because they are not
//! referenced outside the bridge module.

use rusqlite::Connection;

use crate::error::AppError;

pub use kasirmu_bridge::topology::revisions::*;

// Four adapters below. The moved fns answer to the same names through the
// glob above, but three desktop command bodies and one mounted test consume
// their results in positions where the From<BridgeError> seam cannot apply
// (a tail expression, or a matches! over the error value), so the desktop
// keeps an AppError-typed item of its own here. An explicitly declared item
// shadows a glob-imported one, which is what makes this legal rather than
// ambiguous. Visibility is unchanged from before the move.

/// Adapter over ['kasirmu_bridge::topology::revisions::normalize_topology_change_note'].
#[allow(dead_code)]
pub(crate) fn normalize_topology_change_note(raw: Option<&str>) -> Result<String, AppError> {
    kasirmu_bridge::topology::revisions::normalize_topology_change_note(raw).map_err(Into::into)
}

/// Adapter over ['kasirmu_bridge::topology::revisions::list_topology_revision_summaries'].
#[allow(dead_code)]
pub(crate) fn list_topology_revision_summaries(
    conn: &Connection,
    branch_id: &str,
    limit: u32,
) -> Result<Vec<TopologyRevisionSummary>, AppError> {
    kasirmu_bridge::topology::revisions::list_topology_revision_summaries(conn, branch_id, limit)
        .map_err(Into::into)
}

/// Adapter over ['kasirmu_bridge::topology::revisions::set_topology_revision_pinned'].
#[allow(dead_code)]
pub(crate) fn set_topology_revision_pinned(
    conn: &Connection,
    branch_id: &str,
    revision: i64,
    pinned: bool,
) -> Result<TopologyRevisionPinResult, AppError> {
    kasirmu_bridge::topology::revisions::set_topology_revision_pinned(
        conn, branch_id, revision, pinned,
    )
    .map_err(Into::into)
}

/// Adapter over ['kasirmu_bridge::topology::revisions::audit_topology_apply'].
#[allow(dead_code)]
pub(crate) fn audit_topology_apply(
    store_conn: &Connection,
    branch_id: &str,
    revision: u64,
    node_count: usize,
    wire_count: usize,
    ctx: &TopologyRevisionContext<'_>,
) -> Result<(), AppError> {
    kasirmu_bridge::topology::revisions::audit_topology_apply(
        store_conn, branch_id, revision, node_count, wire_count, ctx,
    )
    .map_err(Into::into)
}
