//! Audit log commands.
//!
//! `list_audit_log` exposes the append-only audit log entries
//! stored in SQLite via `oz_core::db::Store::list_audit_entries`.

use serde::{Deserialize, Serialize};
use tauri::State;

use oz_core::availability::UsageCounts;
use oz_core::db::Store;
use oz_core::entitlements::build_entitlements;
use oz_core::permissions;
use oz_core::subscription::SubscriptionTier;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

/// A single audit log entry sent to the front-end.
#[derive(Debug, Serialize)]
pub struct AuditEntryDto {
    /// Unique identifier.
    pub id: String,
    /// ID of the user who performed the action.
    pub user_id: String,
    /// Action.
    pub action: String,
    /// Target Type.
    pub target_type: Option<String>,
    /// ID of the entity acted upon (sale, product, shift, etc.), if any.
    pub target_id: Option<String>,
    /// Free-form context or metadata describing the action (e.g., void
    /// reason, adjustment amount, error summary).
    pub details: String,
    /// Result of the action — typically `"success"` or `"failure"`
    /// followed by an error summary when relevant.
    pub outcome: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

impl From<oz_core::AuditEntry> for AuditEntryDto {
    /// Converts a core [`oz_core::AuditEntry`] into a front-end [`AuditEntryDto`].
    fn from(e: oz_core::AuditEntry) -> Self {
        Self {
            id: e.id,
            user_id: e.user_id,
            action: e.action,
            target_type: e.target_type,
            target_id: e.target_id,
            details: e.details,
            outcome: e.outcome,
            created_at: e.created_at,
        }
    }
}

/// Arguments for paginating the audit log query.
#[derive(Debug, Deserialize)]
pub struct ListAuditLogArgs {
    /// Maximum number of entries to return (default: 100).
    #[serde(default = "default_limit")]
    pub limit: i64,
    /// Number of entries to skip for pagination (default: 0).
    #[serde(default)]
    pub offset: i64,
}

/// Default `limit` value for [`ListAuditLogArgs`].
fn default_limit() -> i64 {
    100
}

/// Default `limit` for the store-scoped args (unsigned page size).
fn default_limit_u64() -> u64 {
    100
}

// ── Store-scoped audit log (AUD-01/AUD-02/AUD-03) ───────────────

/// Server-filtered, keyset-paginated page of audit entries (AUD-02/AUD-03).
#[derive(Debug, Serialize)]
pub struct AuditLogPageDto {
    /// Entries on this page (most recent first).
    pub items: Vec<AuditEntryDto>,
    /// Total matching rows across all pages.
    pub total: u64,
    /// Whether another page follows the cursor.
    pub has_more: bool,
}

/// Arguments for the store-scoped audit log query.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAuditLogScopedArgs {
    /// Maximum entries per page (clamped to `[1, 200]` server-side).
    #[serde(default = "default_limit_u64")]
    pub limit: u64,
    /// Optional outcome filter (`success` | `failure` | anything).
    pub outcome: Option<String>,
    /// Optional free-text query over action/target/user.
    pub query: Option<String>,
    /// Keyset cursor: fetch entries strictly older than `(created_at, id)`.
    pub before_created_at: Option<String>,
    /// Keyset tie-breaker: `audit_log.id` of the newest entry covered.
    pub before_id: Option<String>,
}

/// Fetch audit log entries scoped to the session's store (AUD-01).
///
/// Resolves the store and authenticated user from the session token,
/// enforces `audit:view`, and reads the session store's audit table — so a
/// multi-store deployment cannot disclose another store's events. Filtering
/// and pagination run server-side with a stable `(created_at, id)` cursor
/// (AUD-02/AUD-03).
#[tauri::command]
pub async fn list_audit_log_scoped(
    session_token: String,
    args: ListAuditLogScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_audit_tier(&state).await?;
    require_audit_permission(&state, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let (items, total, has_more) = store.list_audit_entries_filtered(
        args.outcome.as_deref(),
        args.query.as_deref(),
        args.before_created_at.as_deref(),
        args.before_id.as_deref(),
        args.limit,
    )?;
    Ok(AuditLogPageDto {
        items: items.into_iter().map(AuditEntryDto::from).collect(),
        total,
        has_more,
    })
}

/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// audit events are read from the store-scoped connection after this check
/// succeeds. Mirror of `require_customer_permission` in customers.rs.
async fn require_audit_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, user_id, permission)
}

/// Tier gate for every tenant-facing audit-log read surface (AUD-01/04/09,
/// todo-global-saas-2.md P1 "audit baseline").
///
/// The adopted decision (todo-global-saas-1.md "Decisions to preserve",
/// published on the pricing page): **Audit Log is Premium+** — which
/// subsumes the Free rule "no tenant-facing audit logs and no audit-log
/// retention entitlement": Free/Plus/Pro sessions get
/// [`AppError::PermissionDenied`] before any audit row is read, reviewed,
/// or exported, no matter which roles they hold.
///
/// Reads the SAME fail-closed entitlement read model the caps command
/// projects from: a missing/tampered/unreadable subscription row projects
/// Free here too (lock the gate rather than error open — §B), and the
/// desktop dev Free→Premium upgrade applies in debug builds so dev
/// machines keep exercising the screen. Premium+ passes; the paid-tier
/// retention schedule (Plus 90d / Pro 180d) governs only the SWEEP, not
/// the read gate.
/// ## Why this is `async` and awaits the lock
///
/// It was a plain `fn` doing `state.db.blocking_lock()`. `state.db` is a
/// `tokio::sync::Mutex`, and in tokio 1.49 `blocking_lock` is
/// `future::block_on(self.lock())`, whose first act is
/// `context::try_enter_blocking_region().expect("Cannot block the current
/// thread from within a runtime...")`. There is NO uncontended fast path:
/// the check fails whenever the thread is driving async tasks — which is
/// every thread that polls a Tauri command. So each call site was a
/// guaranteed panic on first use, on a surface that had no Rust-layer test
/// and a dev-mock that answers the invoke in JavaScript, so E2E never
/// reached it either.
///
/// Keep it `async`. Reintroducing `blocking_lock()` to "avoid an await in a
/// hot path" reintroduces the panic.
async fn require_audit_tier(state: &AppState) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let ent = build_entitlements(&store, UsageCounts::default(), true);
    drop(db);
    match ent.tier {
        SubscriptionTier::Premium | SubscriptionTier::Enterprise => Ok(()),
        other => Err(AppError::PermissionDenied(format!(
            "audit log requires the Premium plan or above (current tier: {})",
            other.name()
        ))),
    }
}

// ── Review checkpoints (AUD-04) ───────────────────────────────────

/// A persisted server-side review checkpoint (AUD-04).
#[derive(Debug, Serialize)]
pub struct ReviewCheckpointDto {
    /// UUID v7 identifier.
    pub id: String,
    /// Tenant store the checkpoint belongs to.
    pub store_id: String,
    /// User who performed the review.
    pub reviewer_user_id: String,
    /// ISO-8601 timestamp of the review action.
    pub reviewed_at: String,
    /// High-water mark: newest `audit_log.created_at` covered.
    pub reviewed_through_created_at: String,
    /// Tie-breaker: `audit_log.id` of the newest covered entry.
    pub reviewed_through_id: String,
}

impl From<oz_core::AuditReviewCheckpoint> for ReviewCheckpointDto {
    fn from(cp: oz_core::AuditReviewCheckpoint) -> Self {
        Self {
            id: cp.id,
            store_id: cp.store_id,
            reviewer_user_id: cp.reviewer_user_id,
            reviewed_at: cp.reviewed_at,
            reviewed_through_created_at: cp.reviewed_through_created_at,
            reviewed_through_id: cp.reviewed_through_id,
        }
    }
}

/// Arguments for marking the audit log reviewed (AUD-04).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkAuditReviewedArgs {
    /// High-water mark: newest `audit_log.created_at` the reviewer has seen.
    pub reviewed_through_created_at: String,
    /// Tie-breaker: `audit_log.id` of that newest entry.
    pub reviewed_through_id: String,
}

/// Review status for the audit screen (AUD-04): the latest checkpoint and a
/// server-side unreviewed count computed over the full table — not just the
/// currently loaded page (AUD-02).
#[derive(Debug, Serialize)]
pub struct AuditReviewStatusDto {
    /// Latest checkpoint, or `None` when no review has been marked yet.
    pub checkpoint: Option<ReviewCheckpointDto>,
    /// Count of entries strictly newer than the checkpoint's high-water mark
    /// (all entries when no checkpoint exists).
    pub unreviewed_count: u64,
}

/// Fetch the session store's latest review checkpoint + unreviewed count
/// (AUD-04). Resolves the store from the session token and enforces
/// `audit:view` plus the Premium+ audit tier.
#[tauri::command]
pub async fn get_audit_review_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<AuditReviewStatusDto, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_audit_tier(&state).await?;
    require_audit_permission(&state, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let checkpoint = store.latest_review_checkpoint()?;
    let unreviewed_count = match &checkpoint {
        Some(cp) => store.count_audit_entries_after(&cp.reviewed_through_created_at)?,
        // No checkpoint yet — everything is unreviewed.
        None => store.count_audit_entries_after("1970-01-01T00:00:00.000Z")?,
    };
    Ok(AuditReviewStatusDto {
        checkpoint: checkpoint.map(ReviewCheckpointDto::from),
        unreviewed_count,
    })
}

/// Persist a server-side review checkpoint for the session's store (AUD-04).
///
/// Writes the checkpoint row and an `audit.review` audit event in one
/// transaction, so the review action is durable, shared across managers,
/// and itself auditable. Enforces `audit:view` plus the Premium+ tier.
#[tauri::command]
pub async fn mark_audit_reviewed_scoped(
    session_token: String,
    args: MarkAuditReviewedArgs,
    state: State<'_, AppState>,
) -> Result<ReviewCheckpointDto, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_audit_tier(&state).await?;
    require_audit_permission(&state, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let cp = oz_core::AuditReviewCheckpoint {
        id: uuid::Uuid::now_v7().to_string(),
        store_id: session.store_id.clone(),
        reviewer_user_id: session.user_id.clone(),
        reviewed_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        reviewed_through_created_at: args.reviewed_through_created_at,
        reviewed_through_id: args.reviewed_through_id,
    };
    store.save_review_checkpoint(&cp)?;
    Ok(ReviewCheckpointDto::from(cp))
}

// ── Export (AUD-09) ──────────────────────────────────────────────────

/// Arguments for the server-side audit export (AUD-09).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAuditLogArgs {
    /// Optional outcome filter (`success` | `failure` | anything).
    pub outcome: Option<String>,
    /// Optional free-text query over action/target/user.
    pub query: Option<String>,
}

/// Result of a server-side audit export (AUD-09).
#[derive(Debug, Serialize)]
pub struct AuditExportDto {
    /// RFC-4180 CSV artifact (UTF-8 BOM + header + rows, newest first).
    pub csv: String,
    /// Number of rows exported.
    pub row_count: u64,
    /// ISO-8601 generation timestamp.
    pub generated_at: String,
    /// User who requested the export.
    pub requested_by: String,
}

/// Build an RFC-4180 CSV row from the given fields (quotes embedded quotes).
fn csv_row(fields: &[&str]) -> String {
    let escaped: Vec<String> = fields
        .iter()
        .map(|f| format!("\"{}\"", f.replace('\"', "\"\"")))
        .collect();
    escaped.join(",")
}

/// Export the session store's audit log to CSV (AUD-09).
///
/// Resolves the store and authenticated user from the session token,
/// enforces `audit:export`, and reads the full matching set (bounded by
/// `MAX_AUDIT_EXPORT_ROWS`) from the store DB. Records an `audit.export`
/// event capturing the filter scope, requesting user, and row count so the
/// handoff itself is auditable.
#[tauri::command]
pub async fn export_audit_log_scoped(
    session_token: String,
    args: ExportAuditLogArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_audit_tier(&state).await?;
    require_audit_permission(&state, &session.user_id, permissions::AUDIT_EXPORT).await?;
    // Read + export-event write happen on the SAME store connection (matching
    // every other scoped audit mutation, e.g. mark_audit_reviewed_scoped), so
    // the export action is visible in the store-scoped audit log. The guard
    // never crosses an await, keeping the command future Send.
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let entries =
        store.list_audit_entries_export(args.outcome.as_deref(), args.query.as_deref())?;

    let mut csv = String::with_capacity(entries.len() * 160 + 256);
    csv.push('\u{FEFF}'); // UTF-8 BOM for spreadsheet compatibility
    csv.push_str("id,created_at,user_id,action,target_type,target_id,outcome,details\n");
    for e in &entries {
        csv.push_str(&csv_row(&[
            &e.id,
            &e.created_at,
            &e.user_id,
            &e.action,
            e.target_type.as_deref().unwrap_or(""),
            e.target_id.as_deref().unwrap_or(""),
            &e.outcome,
            &e.details,
        ]));
        csv.push('\n');
    }

    // The export action itself becomes an audit event (AUD-09 handoff scope),
    // persisted to the store DB so it appears in the same audit log being
    // exported.
    let details = format!(
        "{{\"outcome\":{},\"query\":{},\"row_count\":{}}}",
        serde_json::to_string(&args.outcome).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&args.query).unwrap_or_else(|_| "null".into()),
        entries.len(),
    );
    store.log_audit(&oz_core::AuditEntry::new(
        session.user_id.clone(),
        "system.export",
        Some("audit"),
        None::<String>,
        Some(details),
        "success",
    ))?;

    Ok(AuditExportDto {
        csv,
        row_count: entries.len() as u64,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        requested_by: session.user_id,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
