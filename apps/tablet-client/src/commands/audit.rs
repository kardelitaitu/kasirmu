//! Audit log commands.
//!
//! The live read surface is `list_audit_log_scoped`, which exposes the
//! append-only audit log entries stored in SQLite via
//! `oz_core::db::Store::list_audit_entries`. Every scoped body
//! lives in the headless `kasirmu_bridge::audit` module (ADR #49 Slice 1): each
//! `#[command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return, so the registered IPC surface and the
//! serialized error shape are unchanged - it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to
//! `AppError` variant-for-variant at `commands/authz.rs`. The DTOs and args
//! structs crossed the boundary with the bodies and are re-exported here, so
//! `use super::*;` in `audit_tests.rs` keeps resolving them and no field
//! list is duplicated across two crates.
//!
//! One command used to sit here unhomed: the unscoped `list_audit_log`, the
//! only audit fn with no bridge equivalent, which is why it was never ported
//! rather than why it stayed. It is retired (T37, 2026-09-16), and the reason
//! it could go without losing a test is the useful part: it was registered in
//! **neither** shell and named by no production UI file - only by a
//! `ui/src/dev-mock` key, which stays as an alias seed for the scoped name -
//! so the tier-gate panic it pinned was already covered twice through the
//! scoped door, once at Premium and once at Free.
//!
//! Gate order runs inside the bridge, in the same order as before: resolve
//! the scope, enforce the Premium+ audit tier, then `audit:view` /
//! `audit:export` through the domain's own gate pair, and only then read or
//! write. Each shim adds a **fourth move** in front of that - see
//! [`require_audit_tier`] for why the tablet gates its own tier twice.

use tauri::{State, command};

use oz_core::availability::UsageCounts;
use oz_core::db::Store;
use oz_core::entitlements::build_entitlements;
use oz_core::subscription::SubscriptionTier;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::audit::{
    AuditEntryDto, AuditExportDto, AuditLogPageDto, AuditReviewStatusDto, ExportAuditLogArgs,
    ExportSecurityEventsArgs, ListAuditLogArgs, ListAuditLogScopedArgs,
    ListSecurityEventsScopedArgs, MarkAuditReviewedArgs, ReviewCheckpointDto,
};

// -- Deprecated, non-scoped read (no bridge equivalent) ---------------

/// Tier gate for every tenant-facing audit-log surface (AUD-01/04/09,
/// todo-global-saas-2.md P1 "audit baseline").
///
/// The adopted decision (todo-global-saas-1.md "Decisions to preserve",
/// published on the pricing page): **Audit Log is Premium+** - Free/Plus/Pro
/// sessions get [`AppError::PermissionDenied`] before any audit row is read,
/// reviewed, or exported, no matter which roles they hold. Reads the SAME
/// fail-closed entitlement read model the caps command projects from: a
/// missing/tampered/unreadable subscription row projects Free here too (lock
/// the gate rather than error open - section B).
///
/// # Why the shims call this *and* the bridge still gates
///
/// Tablet passes `debug_upgrade: false` to `build_entitlements`; the bridge's
/// private copy passes `true` (`crates/kasirmu-bridge/src/audit.rs:273`), which
/// promotes an Active `Free` row to `Premium` under `cfg!(debug_assertions)`
/// (`crates/kasirmu-core/src/entitlements.rs:96-108`, whose own doc records
/// "Tablet never calls this"). **The bridge's `true` can only widen the gate,
/// never narrow it, so running this stricter `false` check first makes the
/// composite `min(both)` equal to the tablet's current gate exactly** - which
/// is why a shim gates twice instead of trusting the body it delegates to.
/// The case that holds this true is
/// `audit_tests::the_gate_denies_a_free_tier_session_without_panicking`,
/// which runs in a debug build where the bridge's promotion is live.
///
/// # Why this is `async` and awaits the lock
///
/// It was a plain `fn` doing `state.db.blocking_lock()`. `state.db` is a
/// `tokio::sync::Mutex`, and in tokio 1.49 `blocking_lock` is
/// `future::block_on(self.lock())`, which panics whenever the thread is
/// driving async tasks - every thread that polls a Tauri command. Keep it
/// `async`; reintroducing `blocking_lock()` reintroduces the panic.
async fn require_audit_tier(state: &AppState) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let ent = build_entitlements(&store, UsageCounts::default(), false);
    drop(db);
    match ent.tier {
        SubscriptionTier::Premium | SubscriptionTier::Enterprise => Ok(()),
        other => Err(AppError::PermissionDenied(format!(
            "audit log requires the Premium plan or above (current tier: {})",
            other.name()
        ))),
    }
}

/// Build an RFC-4180 CSV row from the given fields (quotes embedded quotes).
///
/// Thin adapter over `kasirmu_bridge::audit::csv_row`: the name, parameter list
/// and return type are unchanged so the sibling test module keeps calling it,
/// while the export bodies use the bridge's copy.
#[allow(dead_code)] // retained for the sibling test module's CSV contract cases
fn csv_row(fields: &[&str]) -> String {
    kasirmu_bridge::audit::csv_row(fields)
}

// -- Store-scoped audit log (AUD-01/AUD-02/AUD-03) --------------------

/// Fetch audit log entries scoped to the session's store (AUD-01).
///
/// Resolves the store and authenticated user from the session token,
/// enforces `audit:view` plus the Premium+ audit tier, and reads the session
/// store's audit table - so a multi-store deployment cannot disclose another
/// store's events. Filtering and keyset pagination run server-side in the
/// bridge (AUD-02/AUD-03).
#[command]
pub async fn list_audit_log_scoped(
    session_token: String,
    args: ListAuditLogScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    // Fourth move: this shell's strict tier gate, ahead of the bridge's own
    // (wider) copy. See require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::list_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Read the ORGANIZATION-level security trail - logins, logouts and staff
/// account changes - from the GLOBAL identity database; see
/// `kasirmu_bridge::audit::list_security_events_scoped` for why this reads a
/// different database than its sibling and why that is not a cross-store
/// leak. Gates unchanged: Premium+ tier, then `audit:view`.
#[command]
pub async fn list_security_events_scoped(
    session_token: String,
    args: ListSecurityEventsScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    // Fourth move: see require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::list_security_events_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Fetch the session store's latest review checkpoint + unreviewed count
/// (AUD-04).
#[command]
pub async fn get_audit_review_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<AuditReviewStatusDto, AppError> {
    // Fourth move: see require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::get_audit_review_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Persist a server-side review checkpoint for the session's store (AUD-04).
///
/// Writes the checkpoint row and an `audit.review` audit event in one
/// transaction inside the bridge, so the review action is durable, shared
/// across managers, and itself auditable.
#[command]
pub async fn mark_audit_reviewed_scoped(
    session_token: String,
    args: MarkAuditReviewedArgs,
    state: State<'_, AppState>,
) -> Result<ReviewCheckpointDto, AppError> {
    // Fourth move: see require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::mark_audit_reviewed_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// -- Export (AUD-09) ---------------------------------------------------

/// Export the session store's audit log to CSV (AUD-09).
///
/// Enforces `audit:export`, reads the full matching set (bounded by
/// `MAX_AUDIT_EXPORT_ROWS`) from the store DB, and records an `audit.export`
/// event on the same store connection so the handoff itself is auditable.
#[command]
pub async fn export_audit_log_scoped(
    session_token: String,
    args: ExportAuditLogArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    // Fourth move: see require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::export_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Export the ORGANIZATION-level security trail to CSV (owner ruling D61-7,
/// D84) - the AUD-09 export narrowed to the SECURITY_ACTIONS allowlist with
/// an exact-actor filter and day-range filters. Reads the GLOBAL identity
/// database, like [`list_security_events_scoped`]. Gate order per D84: tier
/// (Premium+) FIRST, then `audit:export` (Owner/Manager/Admin; Auditor has
/// no export permission).
#[command]
pub async fn export_security_events_scoped(
    session_token: String,
    args: ExportSecurityEventsArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    // Fourth move: see require_audit_tier.
    require_audit_tier(&state).await?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::export_security_events_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
