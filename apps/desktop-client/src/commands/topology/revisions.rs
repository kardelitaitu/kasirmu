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

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::error::AppError;

/// Tenant default, following the per-command-module convention in
/// `commands/memo.rs:33` and `commands/legal_entities.rs:17`.
///
/// `topology_revisions.tenant_id` is stamped but the table is deliberately NOT
/// in `RLS_TABLES` yet — exactly where `memo_revisions` sits. Enabling RLS is a
/// policy decision the repo keeps separate from schema (ADR #46 §9).
const DEFAULT_TENANT_ID: &str = "default";

/// Everything a revision row records beyond the graph itself (ADR #46 §2).
///
/// The workspace fields are COUNTS, not contents: Apply already has them in
/// hand at `commands.rs:272-274`, and they let a history row explain itself
/// ("this Apply archived 3 workspaces") without duplicating another table's
/// rows or growing without bound.
///
/// They are the REQUEST lengths. That is the same thing as what was applied,
/// because Apply is all-or-nothing: either the workspace transaction commits in
/// full and this row is written, or it is compensated and no row exists at all.
/// There is no state where a row describes a partially applied diff.
pub(crate) struct TopologyRevisionContext<'a> {
    /// Author-chosen "what changed and why". Empty string when not supplied —
    /// the field is optional at the UI so that an Apply is never blocked on a
    /// merchant writing a note.
    pub change_note: &'a str,
    /// The session user performing the Apply (`session.user_id`).
    pub published_by: &'a str,
    pub workspace_creations: usize,
    pub workspace_updates: usize,
    pub workspace_archives: usize,
}

/// How many revisions per branch stay restorable before deflation begins
/// (ADR #46 §4).
///
/// Deliberately a constant in one place rather than a setting. §4's argument is
/// that 20 is an informed guess: a busy branch Applies a few times a month, so
/// this is months of history, and deflation means changing the number later is
/// a sweep, not a migration. Promoting it to a merchant-facing setting before
/// evidence says it needs to be would be the "while we're here" kind of scope
/// Rule 3 excludes.
pub(crate) const TOPOLOGY_REVISION_RESTORABLE_KEEP: usize = 20;

/// Deflate revision snapshots older than the newest `keep_restorable` per
/// branch (ADR #46 §4).
///
/// # Deflate, do not delete
///
/// The only mutation is `diagram = NULL`. The row survives with its
/// who/when/why intact, which separates the two questions a day window
/// conflates: "what happened here?" is answered forever (a ~200-byte metadata
/// row), "can I restore this?" only for the recent window and anything pinned.
///
/// # Pinned rows are additive, not a substitution
///
/// Pinned rows are excluded from the ranking entirely, so pinning one does NOT
/// consume a slot from the `keep_restorable` budget. A branch with 20 unpinned
/// revisions plus 3 pinned keeps 23 restorable. A pin means "keep this one
/// too", which is the only reading consistent with §4's claim that pinning is
/// what makes the table a deploy history rather than a scratch pad.
///
/// # Idempotent and unlocked by design
///
/// The `diagram IS NOT NULL` guard makes a re-run a no-op, so no transaction
/// wraps the per-branch loop: a failure partway through leaves some branches
/// deflated and the next tick finishes the job. The cadence is 300s and the
/// work is a few hundred bytes per branch, which does not justify holding the
/// global write lock across all of it.
pub(crate) fn cleanup_old_topology_revisions(
    conn: &Connection,
    keep_restorable: usize,
) -> Result<usize, AppError> {
    // Only branches with something left to deflate are visited, so a steady
    // state costs one cheap indexed scan rather than a loop over every branch
    // that has ever Applied.
    let branches: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT branch_id FROM topology_revisions
             WHERE diagram IS NOT NULL AND pinned = 0",
        )?;
        stmt.query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?
    };

    let mut deflated = 0usize;
    for branch_id in branches {
        // The (keep+1)-th newest UNPINNED revision is the oldest one that must
        // survive; everything at or below it goes. `None` means the branch is
        // still inside its budget, which is the common case.
        let cutoff: Option<i64> = conn
            .query_row(
                "SELECT revision FROM topology_revisions
                 WHERE branch_id = ?1 AND pinned = 0
                 ORDER BY revision DESC
                 LIMIT 1 OFFSET ?2",
                params![branch_id, keep_restorable as i64],
                |r| r.get(0),
            )
            .optional()?;
        let Some(cutoff) = cutoff else { continue };

        deflated += conn.execute(
            "UPDATE topology_revisions
             SET diagram = NULL
             WHERE branch_id = ?1 AND pinned = 0 AND diagram IS NOT NULL AND revision <= ?2",
            params![branch_id, cutoff],
        )?;
    }
    Ok(deflated)
}

/// Write the operator-facing audit record for a SUCCESSFUL Apply (ADR #46 §6).
///
/// # Why audit at all, when the revision row already exists
///
/// The revision row is the durable history; this is the one the audit screen
/// shows, and topology Apply wrote no audit record whatsoever before §6. Both
/// are kept because they answer different audiences and live in different
/// databases: `audit_log` is PER-STORE (`resolve_scope` -> `open_store`,
/// `state.rs:601`) and the audit screen reads the store its viewer is scoped
/// to, while `topology_revisions` is in the GLOBAL database keyed by branch.
/// Writing here means an operator looking at a branch's audit log finds its
/// topology changes without knowing the revision table exists.
///
/// # Redaction: what `SENSITIVE_DETAIL_KEYS` does and does not do
///
/// `log_audit` sanitises `details` by matching KEY NAMES case-insensitively
/// against a fixed list (`db/audit.rs:16-37`), which includes `pin`, `token`,
/// `secret`, and `password`. None of the keys below collide, so nothing here is
/// redacted — worth stating because topology has PIN-pad hardware nodes and a
/// key literally named `pin` would be silently blanked.
///
/// The corollary is the real limit: matching is by key, never by VALUE. A
/// merchant who types "reset the back register's password to hunter2" into the
/// change note has that stored verbatim, because `change_note` is not a
/// sensitive key name. §6 accepts that — the note exists so history is
/// readable, and it is written by staff who can already see the things they
/// describe. Truncation to `MAX_DETAIL_LEN` still applies.
pub(crate) fn audit_topology_apply(
    store_conn: &Connection,
    branch_id: &str,
    revision: u64,
    node_count: usize,
    wire_count: usize,
    ctx: &TopologyRevisionContext<'_>,
) -> Result<(), AppError> {
    let details = serde_json::json!({
        "branch_id": branch_id,
        "revision": revision,
        "change_note": ctx.change_note,
        "nodes": node_count,
        "wires": wire_count,
        "workspace_creations": ctx.workspace_creations,
        "workspace_updates": ctx.workspace_updates,
        "workspace_archives": ctx.workspace_archives,
    });
    oz_core::Store::new(store_conn).log_audit(&oz_core::AuditEntry::new(
        ctx.published_by,
        "topology.apply",
        Some("topology"),
        // target_id is the branch, so the audit screen's entity filter can
        // find every change to one branch's graph. `""` is the unscoped
        // legacy graph, matching the revision row's own convention.
        Some(branch_id),
        Some(details.to_string()),
        "success",
    ))?;
    Ok(())
}

/// Insert one immutable revision row, inside the caller's transaction.
///
/// `branch_id` is `""` for the unscoped legacy graph, NOT null — `UNIQUE`
/// ignores NULLs in both SQLite and Postgres, so a nullable branch would let
/// the unscoped graph store one revision number twice (migration header
/// explains the constraint this protects).
///
/// Rows are inserted unpinned; pinning is a Phase 2 UI action. Nothing here
/// ever UPDATEs `diagram`, `change_note`, or `revision` — prior revisions are
/// immutable, and the only permitted mutation is deflation by the retention
/// sweep (ADR #46 §4), which lives beside the sweep itself.
pub(crate) fn insert_topology_revision(
    tx: &Transaction<'_>,
    branch_id: &str,
    revision: u64,
    envelope: &str,
    node_count: usize,
    wire_count: usize,
    ctx: &TopologyRevisionContext<'_>,
) -> Result<(), AppError> {
    let published_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    tx.execute(
        "INSERT INTO topology_revisions
            (id, branch_id, tenant_id, revision, change_note, diagram,
             workspace_creations, workspace_updates, workspace_archives,
             node_count, wire_count, contract_schema_version,
             pinned, published_at, published_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                 ?7, ?8, ?9,
                 ?10, ?11, ?12,
                 0, ?13, ?14)",
        params![
            uuid::Uuid::now_v7().to_string(),
            branch_id,
            DEFAULT_TENANT_ID,
            revision as i64,
            ctx.change_note,
            envelope,
            ctx.workspace_creations as i64,
            ctx.workspace_updates as i64,
            ctx.workspace_archives as i64,
            node_count as i64,
            wire_count as i64,
            // The CONTRACT axis, not the envelope axis — model.rs:273-285 is
            // explicit that the two must never be conflated, and ADR #46 §7's
            // "can this still be restored?" question is answered by this one.
            oz_core::topology::TOPOLOGY_CONTRACT_SCHEMA_VERSION as i64,
            published_at,
            ctx.published_by,
        ],
    )?;
    Ok(())
}
