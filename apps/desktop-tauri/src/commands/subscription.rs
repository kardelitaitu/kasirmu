//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Exposes the tenant subscription's quotas and feature flags — straight
//! from `SubscriptionTier` in kasirmu-core — plus the tenant's current usage
//! counts (stores, staff, terminals). The UI uses this single read to
//! render tier gates: analytics/loyalty locks, QRIS gate, second-store
//! gate, terminal-limit banner, and the approaching-limit banners.
//!
//! Fail-closed (todo-global-saas-1.md §B): the payload always carries a
//! lifecycle `state`; a missing/tampered/unreadable subscription yields
//! Free entitlements + `unavailable` instead of an IPC error, because the
//! UI's error path renders gates open.
//!
//! Wave E (E4): every command body moved to `kasirmu_bridge::subscription` and
//! this file is the tauri shim layer. The private `load_*` / `push_dim_row`
//! helpers below stay as `AppError` adapters because the mounted test file
//! exercises the production path and matches on `AppError` variants.

use tauri::State;

use kasirmu_core::availability::FeatureVerdict;
use kasirmu_core::downgrade::{OverQuotaMarker, OverQuotaReport, QuotaDimension};
use kasirmu_core::subscription::SubscriptionTier;

use platform_core::StoreDatabaseManager;

use crate::error::AppError;
use crate::state::AppState;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use kasirmu_core::db::Store;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use kasirmu_core::downgrade::OverQuotaSeverity;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use kasirmu_core::permissions;

pub use kasirmu_bridge::subscription::SubscriptionCapabilitiesDto;

/// Read the tenant's subscription capabilities and current usage.
///
/// Like [`crate::commands::license::get_license_status`], this is a local
/// read — no network call — so the gates render immediately from the
/// bootstrap/activated subscription row.
#[tauri::command]
pub async fn get_subscription_capabilities(
    state: State<'_, AppState>,
) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::subscription::get_subscription_capabilities(&ctx)
        .await
        .map_err(Into::into)
}

/// Explain WHY a feature is (un)available for the session user — the
/// diagnostics surface behind support's "why can't I use X" question
/// (todo-global-saas-3.md, feature-flag observability).
///
/// Gated on `settings:read`: the verdict is a diagnostics read, but it
/// echoes quota numbers and permission keys, so it is not staff-ephemeral
/// data. Reads only the local signed subscription row and the global
/// identity DB — no network round-trip — so it is honest offline, where
/// "why" questions are most often asked.
#[tauri::command]
pub async fn explain_feature_availability_scoped(
    session_token: String,
    feature: String,
    state: State<'_, AppState>,
) -> Result<FeatureVerdict, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::subscription::explain_feature_availability_scoped(
        &ctx,
        &session_token,
        &feature,
    )
    .await
    .map_err(Into::into)
}

/// The tenant-level over-quota assessment for the owner-facing
/// remediation view (todo-global-saas-2.md §J downgrade item): which
/// resources exceed the effective tier's quota and by how much.
///
/// Read-only, no mutation — the view offers archive-or-upgrade actions
/// that live in their own features; this command only reports. Fails
/// closed exactly like the caps command: an unreadable row projects the
/// Free tier's quotas, which is the honest answer for a lapsed
/// subscription. Gated `settings:read` — a diagnostics read that echoes
/// quota numbers, like the verdict command.
#[tauri::command]
pub async fn get_over_quota_report(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OverQuotaReport, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::subscription::get_over_quota_report(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// The `_scoped` twin of [`get_over_quota_report`] (todo-global-saas-3.md
/// L142 recorded the surface as lacking one and failing
/// `verify-scoped-coverage.sh`). Same report, same `settings:read` gate,
/// and the scope is the authenticated session: an unknown `session_token`
/// fails closed via `resolve_session`. The dimensions the report assesses
/// are tenant ceilings (locations, registers, warehouses, staff, products)
/// rather than per-store ones — the reasoning that keeps the topology
/// commands in the scoped-coverage allowlist's category 2 — so there is
/// deliberately no store connection to resolve here, exactly like
/// `list_permission_keys_scoped` scopes the session without a store.
#[tauri::command]
pub async fn get_over_quota_report_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OverQuotaReport, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::subscription::get_over_quota_report_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── AppError adapters over the moved production bodies ──────────────

/// Adapter over [`kasirmu_bridge::subscription::load_capabilities`].
#[allow(dead_code)] // sibling *_tests.rs is its only caller
fn load_capabilities(db: &rusqlite::Connection) -> Result<SubscriptionCapabilitiesDto, AppError> {
    kasirmu_bridge::subscription::load_capabilities(db).map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::subscription::load_feature_verdict`].
#[allow(dead_code)] // sibling *_tests.rs is its only caller
fn load_feature_verdict(
    db: &rusqlite::Connection,
    user_id: &str,
    feature_key: &str,
    branch: &str,
    workspace: &str,
) -> Result<FeatureVerdict, AppError> {
    kasirmu_bridge::subscription::load_feature_verdict(db, user_id, feature_key, branch, workspace)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::subscription::load_over_quota_report`].
#[allow(dead_code)] // sibling *_tests.rs is its only caller
fn load_over_quota_report(
    db: &rusqlite::Connection,
) -> Result<(OverQuotaReport, SubscriptionTier), AppError> {
    kasirmu_bridge::subscription::load_over_quota_report(db).map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::subscription::per_location_over_quota_rows`].
#[allow(dead_code)] // sibling *_tests.rs is its only caller
fn per_location_over_quota_rows(
    locations: &[(String, String)],
    manager: &StoreDatabaseManager,
    tier: &SubscriptionTier,
) -> Result<Vec<OverQuotaMarker>, AppError> {
    kasirmu_bridge::subscription::per_location_over_quota_rows(locations, manager, tier)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::subscription::push_dim_row`].
#[allow(clippy::too_many_arguments)]
#[allow(dead_code)] // sibling *_tests.rs is its only caller
fn push_dim_row(
    rows: &mut Vec<OverQuotaMarker>,
    now: &str,
    store_id: &str,
    resource_type: &str,
    dimension: QuotaDimension,
    limit: Option<i64>,
    current: i64,
    suspended: i64,
) {
    kasirmu_bridge::subscription::push_dim_row(
        rows,
        now,
        store_id,
        resource_type,
        dimension,
        limit,
        current,
        suspended,
    );
}
