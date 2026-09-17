//! Audit command bodies (Wave E / E5) — the tauri-free half of
//! `apps/desktop-client/src/commands/audit.rs`.
//!
//! Key functions: the store-scoped audit reads ([`list_audit_log_scoped`],
//! [`get_audit_review_status_scoped`]), the organization-level security trail
//! read ([`list_security_events_scoped`]), the review-checkpoint write
//! ([`mark_audit_reviewed_scoped`]) and the two CSV exports
//! ([`export_audit_log_scoped`], [`export_security_events_scoped`]).
//!
//! Gate order is a verbatim port of the shell: resolve the scope, enforce the
//! Premium+ audit tier, then `audit:view` / `audit:export` — the domain's own
//! non-scope-aware gate pair, kept as local helpers rather than swapped for a
//! `BridgeCtx` method — and only then read or write.

use serde::{Deserialize, Serialize};

use kasirmu_core::availability::UsageCounts;
use kasirmu_core::db::Store;
use kasirmu_core::entitlements::build_entitlements;
use kasirmu_core::permissions;
use kasirmu_core::subscription::SubscriptionTier;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

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

impl From<kasirmu_core::AuditEntry> for AuditEntryDto {
    /// Converts a core [`kasirmu_core::AuditEntry`] into a front-end [`AuditEntryDto`].
    fn from(e: kasirmu_core::AuditEntry) -> Self {
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
pub async fn list_audit_log_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ListAuditLogScopedArgs,
) -> Result<AuditLogPageDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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

/// Arguments for the organization-level security-events query.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSecurityEventsScopedArgs {
    /// Maximum entries per page (clamped to `[1, 200]` server-side).
    #[serde(default = "default_limit_u64")]
    pub limit: u64,
    /// Optional outcome filter (`success` | `failure`).
    pub outcome: Option<String>,
    /// Optional free-text query over action/target/user.
    pub query: Option<String>,
    /// Keyset cursor: fetch entries strictly older than `(created_at, id)`,
    /// matching the general audit page exactly.
    pub before_created_at: Option<String>,
    /// Keyset cursor tie-breaker.
    pub before_id: Option<String>,
}

/// Read the ORGANIZATION-level security trail — logins, logouts and staff
/// account changes — from the GLOBAL identity database
/// (todo-global-saas-2.md P1 "audit baseline").
///
/// # Why this reads a different database than its sibling
///
/// `list_audit_log_scoped` reads the session store's file, which is right for
/// sales/stock/product events. Security events cannot live there: identity is
/// a global record in this design (ADR #4 / ADR #7 — the store-scoped files
/// contain no `users` rows), so `staff_login` and the staff-management
/// commands all write the global DB. A store-scoped read would find nothing.
///
/// # Scope isolation, and why this is not a cross-store leak
///
/// The obvious objection — can one store's admin read another store's staff
/// auth trail? — does not bite, because there is no per-store partition of
/// this data to leak across. Every row concerns the global `users` table,
/// which the staff list already exposes in full to any session holding
/// `staff:read`, and a login happens BEFORE a store is even selected, so an
/// auth event carries no store attribution to withhold. This command
/// discloses nothing the same session cannot already read; it makes an
/// existing global dataset queryable, which is the point.
///
/// The gates are the audit surface's own and unchanged: Premium+ tier
/// (`require_audit_tier`, fail-closed on an unreadable subscription row) plus
/// `audit:view` resolved for the caller. A session that cannot open the audit
/// screen cannot open this one either.
///
/// Results are restricted server-side to the security action set, so an
/// ordinary business-audit row never appears here; the restriction is on this
/// surface, not a hiding rule — security rows remain on the general page.
pub async fn list_security_events_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ListSecurityEventsScopedArgs,
) -> Result<AuditLogPageDto, BridgeError> {
    // resolve_scope (not resolve_session) so this command fails on a session
    // whose store cannot be opened exactly as its sibling does; the store
    // connection itself is not read — only the caller's identity is needed.
    let (session, _store_conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let (items, total, has_more) = store.list_security_events(
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
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    permission: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    ctx.require_permission_for_user(&store, user_id, permission)
}

/// Tier gate for every tenant-facing audit-log read surface (AUD-01/04/09,
/// todo-global-saas-2.md P1 "audit baseline").
///
/// The adopted decision (todo-global-saas-1.md "Decisions to preserve",
/// published on the pricing page): **Audit Log is Premium+** — which
/// subsumes the Free rule "no tenant-facing audit logs and no audit-log
/// retention entitlement": Free/Plus/Pro sessions get
/// [`BridgeError::PermissionDenied`] before any audit row is read, reviewed,
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
async fn require_audit_tier(ctx: &BridgeCtx<'_>) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let ent = build_entitlements(&store, UsageCounts::default(), true);
    drop(db);
    match ent.tier {
        SubscriptionTier::Premium | SubscriptionTier::Enterprise => Ok(()),
        other => Err(BridgeError::PermissionDenied(format!(
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

impl From<kasirmu_core::AuditReviewCheckpoint> for ReviewCheckpointDto {
    fn from(cp: kasirmu_core::AuditReviewCheckpoint) -> Self {
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
pub async fn get_audit_review_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<AuditReviewStatusDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
pub async fn mark_audit_reviewed_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: MarkAuditReviewedArgs,
) -> Result<ReviewCheckpointDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let cp = kasirmu_core::AuditReviewCheckpoint {
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
pub fn csv_row(fields: &[&str]) -> String {
    let escaped: Vec<String> = fields
        .iter()
        .map(|f| format!("\"{}\"", f.replace('\"', "\"\"")))
        .collect();
    escaped.join(",")
}

/// Build the full AUD-09 export CSV (BOM + header + newest-first rows)
/// from audit entries. Shared by the full-log export and the
/// security-event export so the columns, BOM and RFC-4180 quoting can
/// never drift apart.
fn audit_csv(entries: &[kasirmu_core::AuditEntry]) -> String {
    let mut csv = String::with_capacity(entries.len() * 160 + 256);
    csv.push('\u{FEFF}'); // UTF-8 BOM for spreadsheet compatibility
    csv.push_str("id,created_at,user_id,action,target_type,target_id,outcome,details\n");
    for e in entries {
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
    csv
}

/// Export the session store's audit log to CSV (AUD-09).
///
/// Resolves the store and authenticated user from the session token,
/// enforces `audit:export`, and reads the full matching set (bounded by
/// `MAX_AUDIT_EXPORT_ROWS`) from the store DB. Records an `audit.export`
/// event capturing the filter scope, requesting user, and row count so the
/// handoff itself is auditable.
pub async fn export_audit_log_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ExportAuditLogArgs,
) -> Result<AuditExportDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_EXPORT).await?;
    // Read + export-event write happen on the SAME store connection (matching
    // every other scoped audit mutation, e.g. mark_audit_reviewed_scoped), so
    // the export action is visible in the store-scoped audit log. The guard
    // never crosses an await, keeping the command future Send.
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let entries =
        store.list_audit_entries_export(args.outcome.as_deref(), args.query.as_deref())?;
    let csv = audit_csv(&entries);

    // The export action itself becomes an audit event (AUD-09 handoff scope),
    // persisted to the store DB so it appears in the same audit log being
    // exported.
    let details = format!(
        "{{\"outcome\":{},\"query\":{},\"row_count\":{}}}",
        serde_json::to_string(&args.outcome).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&args.query).unwrap_or_else(|_| "null".into()),
        entries.len(),
    );
    store.log_audit(&kasirmu_core::AuditEntry::new(
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

// ── Security-event export (owner ruling D61-7 / D84) ────────────────

/// Arguments for the security-event CSV export (owner ruling D61-7, D84).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSecurityEventsArgs {
    /// Optional EXACT actor filter: a staff `user_id`, or `"system"` for
    /// the unknown-account security failures (D84 ruling 2 — no fuzzy
    /// matching; usernames quoted inside `details` are not an actor).
    pub actor: Option<String>,
    /// Inclusive range start, `"YYYY-MM-DD"` — normalized at this layer
    /// into a fixed-width ISO lower bound before the core read.
    pub date_from: Option<String>,
    /// Exclusive range end, `"YYYY-MM-DD"` — normalized to midnight of
    /// the FOLLOWING day so the whole end day is included (D84 ruling 3).
    pub date_to: Option<String>,
}

/// Normalize a `"YYYY-MM-DD"` day into the fixed-width ISO instant the
/// core audit WHERE builder compares against. `end_of_day` produces the
/// EXCLUSIVE upper bound: midnight of the following day. The comparison
/// stays a plain fixed-width string compare inside SQLite (D84 ruling 3).
fn normalize_day_bound(day: &str, end_of_day: bool) -> Result<String, BridgeError> {
    let parsed = chrono::NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d").map_err(|_| {
        BridgeError::Invalid(format!("invalid date filter {day:?}: expected YYYY-MM-DD"))
    })?;
    let bound = if end_of_day {
        parsed
            .succ_opt()
            .ok_or_else(|| BridgeError::Invalid(format!("date out of range: {day:?}")))?
    } else {
        parsed
    };
    Ok(format!("{}T00:00:00.000Z", bound.format("%Y-%m-%d")))
}

/// Export the ORGANIZATION-level security trail to CSV (owner ruling
/// D61-7, D84): the AUD-09 export narrowed to the SECURITY_ACTIONS
/// allowlist, with an exact-actor filter and a day-range filter.
///
/// Reads the GLOBAL identity database — the same one
/// [`list_security_events_scoped`] reads — because security events
/// cannot live in store-scoped files (identity is global; logins happen
/// before a store is chosen). Gate order per D84: tier (Premium+)
/// FIRST, then `audit:export` (Owner/Manager/Admin; Auditor has no
/// export permission).
///
/// The handoff itself is auditable: a `system.export` row lands in the
/// session store's audit log exactly as AUD-09's does, so the general
/// audit page records who exported what. It is deliberately NOT in
/// SECURITY_ACTIONS, so it never re-enters this export.
pub async fn export_security_events_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ExportSecurityEventsArgs,
) -> Result<AuditExportDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_audit_tier(ctx).await?;
    require_audit_permission(ctx, &session.user_id, permissions::AUDIT_EXPORT).await?;

    // D84 ruling 3: normalize the day filters into fixed-width ISO
    // bounds at this layer; from = inclusive midnight, to = EXCLUSIVE
    // (day + 1) so the whole end day is included.
    let created_after = match args.date_from.as_deref() {
        Some(d) => Some(normalize_day_bound(d, false)?),
        None => None,
    };
    let created_before = match args.date_to.as_deref() {
        Some(d) => Some(normalize_day_bound(d, true)?),
        None => None,
    };
    // D84 ruling 2: EXACT user_id; "system" resolves through the core
    // SYSTEM_ACTOR constant (currently the same string, but the mapping
    // is the contract, not the coincidence).
    let actor = match args.actor.as_deref() {
        Some(a) if a == kasirmu_core::db::audit_security::SYSTEM_ACTOR => {
            Some(kasirmu_core::db::audit_security::SYSTEM_ACTOR.to_string())
        }
        other => other.map(str::to_string),
    };

    // Read the GLOBAL identity DB (see list_security_events_scoped's doc):
    // a store-scoped read would find no security rows at all.
    let entries = {
        let db = ctx.lock_global().await;
        Store::new(&db).list_audit_entries_export_filtered(
            Some(kasirmu_core::db::audit_security::SECURITY_ACTIONS),
            actor.as_deref(),
            created_after,
            created_before,
            None,
            None,
        )?
    };
    let csv = audit_csv(&entries);

    // AUD-09-style self-audit row, written to the session store's audit
    // log so the general audit page records the handoff.
    let details = serde_json::json!({
        "actions": "security",
        "actor": args.actor,
        "date_from": args.date_from,
        "date_to": args.date_to,
        "row_count": entries.len(),
    })
    .to_string();
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        Store::new(&db).log_audit(&kasirmu_core::AuditEntry::new(
            session.user_id.clone(),
            "system.export",
            Some("audit"),
            None::<String>,
            Some(details),
            "success",
        ))?;
    }

    Ok(AuditExportDto {
        csv,
        row_count: entries.len() as u64,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        requested_by: session.user_id,
    })
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod audit_tests;

#[cfg(test)]
#[path = "audit_security_events_tests.rs"]
mod audit_security_events_tests;
