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
//! envelope and never increments `revision`, so no row is expected.//!
//! Ported verbatim from
//! `apps/desktop-client/src/commands/topology/revisions.rs` (Wave E step d-pre)
//! as the fourth leaf of the `oz_bridge::topology` mirror, so that persistence
//! can resolve its `use super::revisions::*` device line after its own move.
//! The two listing-limit constants stay crate-private: nothing outside this
//! file names them, so widening them would only enlarge the bridge surface.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

use crate::error::BridgeError;

use super::semantics::topology_validation;

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
pub struct TopologyRevisionContext<'a> {
    /// Author-chosen "what changed and why". Empty string when not supplied —
    /// the field is optional at the UI so that an Apply is never blocked on a
    /// merchant writing a note.
    pub change_note: &'a str,
    /// The session user performing the Apply (`session.user_id`).
    pub published_by: &'a str,
    /// Count of workspace instances this Apply created.
    pub workspace_creations: usize,
    /// Count of workspace instances this Apply updated.
    pub workspace_updates: usize,
    /// Count of workspace instances this Apply archived.
    pub workspace_archives: usize,
}

/// Longest accepted Apply change note, in characters (ADR #46 §6).
///
/// Counted in `char`s, not bytes: a note is merchant-facing free text and will
/// contain non-ASCII, and a byte limit would let the same sentence pass in
/// English and fail in Thai.
pub const TOPOLOGY_CHANGE_NOTE_MAX_CHARS: usize = 500;

/// Validate and normalise a merchant-supplied change note (ADR #46 §6).
///
/// Returns the trimmed note, or `""` when none was given — the field is
/// optional, and an Apply is never blocked on a merchant writing a comment.
///
/// Over-length is REJECTED rather than truncated. Truncation would silently
/// destroy the reason a deploy happened, which is the entire point of the
/// field, and would do so asymmetrically: the merchant's own note would read
/// differently from the one history kept. Rejecting is cheap here because this
/// runs at the top of the command, before the recovery journal or the store
/// transaction, so a too-long note costs a retry rather than a deploy.
pub fn normalize_topology_change_note(raw: Option<&str>) -> Result<String, BridgeError> {
    let note = raw.unwrap_or("").trim();
    let chars = note.chars().count();
    if chars > TOPOLOGY_CHANGE_NOTE_MAX_CHARS {
        return Err(topology_validation(
            "topology-change-note-too-long",
            None,
            None,
            None,
            format!(
                "change note must be {TOPOLOGY_CHANGE_NOTE_MAX_CHARS} characters or fewer (got {chars})"
            ),
        ).into());
    }
    Ok(note.to_owned())
}

// ── Reading history back ───────────────────────────────────────

/// Default and ceiling for a history listing. The ceiling exists because the
/// payload is built from an unbounded merchant-facing parameter; the browser
/// paginates by walking backwards through revision numbers, so it never needs
/// more than a screenful at once.
pub(crate) const TOPOLOGY_REVISION_LIST_DEFAULT_LIMIT: u32 = 50;
pub(crate) const TOPOLOGY_REVISION_LIST_MAX_LIMIT: u32 = 200;

/// Clamp a caller-supplied limit into the accepted range.
pub fn normalize_topology_revision_limit(raw: Option<u32>) -> u32 {
    raw.unwrap_or(TOPOLOGY_REVISION_LIST_DEFAULT_LIMIT)
        .clamp(1, TOPOLOGY_REVISION_LIST_MAX_LIMIT)
}

/// One row of revision history, metadata only.
///
/// The envelope is deliberately absent: 200 rows of ~5 KB diagram is a
/// megabyte-scale payload for a panel that renders one line per revision.
/// `restorable` tells the browser whether asking for the graph can succeed.
#[derive(Debug, Serialize)]
// camelCase, matching the 93 other tauri DTOs in commands/ — and matching
// `TopologyRevisionGraphResult`, which the browser consumes alongside this
// one. Two shapes in one feature is how drift starts.
#[serde(rename_all = "camelCase")]
pub struct TopologyRevisionSummary {
    /// Envelope revision this row records.
    pub revision: i64,
    /// Merchant-authored "what changed and why"; empty when not given.
    pub change_note: String,
    /// ISO-8601 commit time of the Apply.
    pub published_at: String,
    /// Session user who Applied it.
    pub published_by: String,
    /// Exempt from pruning and deflation (ADR #46 §4).
    pub pinned: bool,
    /// Graph size at Apply time.
    pub node_count: i64,
    /// Graph size at Apply time.
    pub wire_count: i64,
    /// Workspace instances the Apply created.
    pub workspace_creations: i64,
    /// Workspace instances the Apply updated.
    pub workspace_updates: i64,
    /// Workspace instances the Apply archived.
    pub workspace_archives: i64,
    /// Contract axis the revision was authored under (ADR #46 §7).
    pub contract_schema_version: i64,
    /// False once the retention sweep has deflated the snapshot (ADR #46 §4).
    /// The record survives; the graph does not. The browser MUST render
    /// "record only — snapshot pruned" rather than offer a restore it cannot
    /// fulfil, which is the one user-visible consequence of choosing to
    /// deflate instead of delete.
    pub restorable: bool,
}

/// Read history newest-first for one branch. `branch_id` is `""` for the
/// unscoped legacy graph, matching the write path.
pub fn list_topology_revision_summaries(
    conn: &Connection,
    branch_id: &str,
    limit: u32,
) -> Result<Vec<TopologyRevisionSummary>, BridgeError> {
    let mut stmt = conn.prepare(
        "SELECT revision, change_note, published_at, published_by, pinned,
                node_count, wire_count, workspace_creations, workspace_updates,
                workspace_archives, contract_schema_version,
                (diagram IS NOT NULL) AS restorable
         FROM topology_revisions
         WHERE branch_id = ?1
         ORDER BY revision DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![branch_id, limit as i64], |r| {
        Ok(TopologyRevisionSummary {
            revision: r.get(0)?,
            change_note: r.get(1)?,
            published_at: r.get(2)?,
            published_by: r.get(3)?,
            pinned: r.get::<_, i64>(4)? != 0,
            node_count: r.get(5)?,
            wire_count: r.get(6)?,
            workspace_creations: r.get(7)?,
            workspace_updates: r.get(8)?,
            workspace_archives: r.get(9)?,
            contract_schema_version: r.get(10)?,
            restorable: r.get::<_, i64>(11)? != 0,
        })
    })?;
    rows.collect::<Result<_, _>>().map_err(Into::into)
}

/// The three answers a request for one revision's graph can get.
///
/// `NotFound` and `Deflated` MUST stay distinct. Collapsing them would make a
/// pruned deploy read as "never happened", silently rewriting history at the
/// moment a merchant is trying to reconstruct an incident — the exact thing
/// §4's deflate-instead-of-delete decision exists to prevent.
#[derive(Debug)]
pub enum TopologyRevisionLookup {
    /// No row for this `(branch_id, revision)`.
    NotFound,
    /// Recorded, but the retention sweep dropped the snapshot (ADR #46 §4).
    Deflated {
        /// The note survives deflation — that is the point of keeping the row.
        change_note: String,
        /// ISO-8601 commit time.
        published_at: String,
        /// Session user who Applied it.
        published_by: String,
    },
    /// Recorded, with a restorable envelope.
    Restorable {
        /// Merchant-authored "what changed and why".
        change_note: String,
        /// ISO-8601 commit time.
        published_at: String,
        /// Session user who Applied it.
        published_by: String,
        /// Contract axis it was authored under, for §7's "why can't this
        /// validate?" message.
        contract_schema_version: i64,
        /// The stored envelope, byte-identical to what `settings` held.
        envelope: String,
    },
}

/// Fetch one revision, preserving the distinction between "absent" and
/// "present but pruned".
///
/// Named `_row` rather than sharing the command's name: `commands.rs`
/// glob-imports this module, and a local definition shadows a glob import —
/// so an identically-named command would have resolved its own data call back
/// to itself rather than here.
pub fn load_topology_revision_row(
    conn: &Connection,
    branch_id: &str,
    revision: i64,
) -> Result<TopologyRevisionLookup, BridgeError> {
    // `diagram` is read as Option<String>; the row's existence is probed
    // separately, so a deflated row is not mistaken for a missing one.
    let row: Option<(Option<String>, String, String, String, i64)> = conn
        .query_row(
            "SELECT diagram, change_note, published_at, published_by,
                    contract_schema_version
             FROM topology_revisions
             WHERE branch_id = ?1 AND revision = ?2",
            params![branch_id, revision],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;

    let Some((diagram, change_note, published_at, published_by, contract_version)) = row else {
        return Ok(TopologyRevisionLookup::NotFound);
    };
    match diagram {
        Some(envelope) => Ok(TopologyRevisionLookup::Restorable {
            change_note,
            published_at,
            published_by,
            contract_schema_version: contract_version,
            envelope,
        }),
        None => Ok(TopologyRevisionLookup::Deflated {
            change_note,
            published_at,
            published_by,
        }),
    }
}

/// How many revisions per branch stay restorable before deflation begins
/// How many revisions per branch stay restorable before deflation begins
/// (ADR #46 §4).
///
/// Deliberately a constant in one place rather than a setting. §4's argument is
/// that 20 is an informed guess: a busy branch Applies a few times a month, so
/// this is months of history, and deflation means changing the number later is
/// a sweep, not a migration. Promoting it to a merchant-facing setting before
/// evidence says it needs to be would be the "while we're here" kind of scope
/// Rule 3 excludes.
pub const TOPOLOGY_REVISION_RESTORABLE_KEEP: usize = 20;

/// Outcome of a pin/unpin request (ADR #46 §4).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyRevisionPinResult {
    /// `"updated"` | `"not-found"`.
    pub status: &'static str,
    /// The revision the request named, echoed for keyed rendering.
    pub revision: i64,
    /// The state the row is now in.
    pub pinned: bool,
    /// False when the snapshot was ALREADY deflated. Pinning preserves the
    /// record; it cannot resurrect a graph the sweep dropped. The UI must not
    /// promise a restore just because the pin succeeded.
    pub restorable: bool,
    /// True when unpinning leaves this row outside the retention budget, so
    /// the next sweep will deflate it. Without this the UI says "unpinned"
    /// and the row silently loses its snapshot minutes later.
    pub pruned_by_next_sweep: bool,
}

/// The revision at which deflation begins for one branch, or `None` when the
/// branch is inside its budget.
///
/// Extracted so the sweep and the pin result ask the SAME question. If they
/// each re-derived the rule, a future change to one would let the UI promise
/// retention the sweep then took back.
fn unpinned_cutoff_revision(
    conn: &Connection,
    branch_id: &str,
    keep_restorable: usize,
) -> Result<Option<i64>, BridgeError> {
    Ok(conn
        .query_row(
            "SELECT revision FROM topology_revisions
             WHERE branch_id = ?1 AND pinned = 0
             ORDER BY revision DESC
             LIMIT 1 OFFSET ?2",
            params![branch_id, keep_restorable as i64],
            |r| r.get(0),
        )
        .optional()?)
}

/// Pin or unpin one revision (ADR #46 §4).
///
/// # Why this exists at all
///
/// §4 makes a pin what turns a revision table into a DEPLOY history: "a
/// known-good graph stays restorable however busy the branch gets after it."
/// Until this had a caller, `pinned` could only ever be 0 — the exemption
/// logic was real and tested, but nothing in production could reach it, so the
/// protection was inert.
///
/// # Pinning a deflated row succeeds
///
/// Marking the record is a legitimate thing to want, and the result reports
/// `restorable: false`. Refusing would imply the snapshot could come back.
///
/// # The budget is recomputed, not assumed
///
/// Pins are additive (§4), so removing one re-ranks the branch and can push a
/// DIFFERENT, older row out of the window. `pruned_by_next_sweep` answers only
/// about the row named here.
pub fn set_topology_revision_pinned(
    conn: &Connection,
    branch_id: &str,
    revision: i64,
    pinned: bool,
) -> Result<TopologyRevisionPinResult, BridgeError> {
    let changed = conn.execute(
        "UPDATE topology_revisions SET pinned = ?1
         WHERE branch_id = ?2 AND revision = ?3",
        params![pinned as i64, branch_id, revision],
    )?;
    if changed == 0 {
        return Ok(TopologyRevisionPinResult {
            status: "not-found",
            revision,
            pinned,
            restorable: false,
            pruned_by_next_sweep: false,
        });
    }

    let restorable: bool = conn.query_row(
        "SELECT (diagram IS NOT NULL) FROM topology_revisions
         WHERE branch_id = ?1 AND revision = ?2",
        params![branch_id, revision],
        |r| r.get::<_, i64>(0).map(|v| v != 0),
    )?;

    // Predict what the PRODUCTION sweep will do, so this must use the
    // production budget rather than the parameter the tests pass to
    // `cleanup_old_topology_revisions`.
    //
    // A row being PINNED is exempt from deflation by definition (§4), so it
    // can never be pruned — asking the cutoff question anyway reported a
    // successful pin as "this will be deleted", which is the opposite of what
    // a pin is for. Caught by a_pin_protects_a_row_the_sweep_would_otherwise_deflate.
    let pruned_by_next_sweep = !pinned
        && matches!(
            unpinned_cutoff_revision(conn, branch_id, TOPOLOGY_REVISION_RESTORABLE_KEEP)?,
            Some(cutoff) if revision <= cutoff
        );

    Ok(TopologyRevisionPinResult {
        status: "updated",
        revision,
        pinned,
        restorable,
        pruned_by_next_sweep,
    })
}

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
pub fn cleanup_old_topology_revisions(
    conn: &Connection,
    keep_restorable: usize,
) -> Result<usize, BridgeError> {
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
        let Some(cutoff) = unpinned_cutoff_revision(conn, &branch_id, keep_restorable)? else {
            continue;
        };

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
pub fn audit_topology_apply(
    store_conn: &Connection,
    branch_id: &str,
    revision: u64,
    node_count: usize,
    wire_count: usize,
    ctx: &TopologyRevisionContext<'_>,
) -> Result<(), BridgeError> {
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
pub fn insert_topology_revision(
    tx: &Transaction<'_>,
    branch_id: &str,
    revision: u64,
    envelope: &str,
    node_count: usize,
    wire_count: usize,
    ctx: &TopologyRevisionContext<'_>,
) -> Result<(), BridgeError> {
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

#[cfg(test)]
#[path = "topology_revision_tests.rs"]
mod topology_revision_tests;
