//! License Activation Tauri commands.
//!
//! Wave E / E3: the bodies now live in the headless `oz_bridge::license` module. Each
//! `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return so the registered IPC surface and the serialized error
//! shape never move; it borrows a `BridgeCtx` from `AppState`, calls the bridge, and
//! maps `BridgeError` back to `AppError` variant-for-variant. The five DTOs defined here
//! moved with the bodies and are re-exported so `use super::*` in `license_tests.rs`
//! still resolves them, and the three pure helpers that module calls directly stay as
//! local adapters over the bridge.

use tauri::State;

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
// The first two are also what the retained helper adapters below still take.
#[allow(unused_imports)]
use chrono::{DateTime, Utc};
#[allow(unused_imports)]
use oz_core::Settings;
#[allow(unused_imports)]
use oz_core::license_verification::{RenewLicenseRequest, store_subscription};

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::license::{
    AuthPingResult, LicenseStatusDto, LicenseVerificationStatus, PauseResumeDto,
    ServerLicenseStatusDto,
};

/// Activates a license key for the given email, phone, and machine ID.
///
/// `trial_vertical` is the optional segmented-trial vertical (C2.1): the
/// server only reads it for trial keys and mints a 14-day Plus / 14-day
/// Pro / 30-day Pro license per subscription-tiers.md §4. Paid keys ignore
/// it entirely, so omitting it is always safe.
///
/// `bundle_id` is the optional vertical-bundle id (C3.2): "restaurant_starter"
/// unlocks the kds workspace type at the Plus tier. The server honors it for
/// trial keys only, so omitting it is always safe.
///
/// `hardware_fingerprint` is the device-level fingerprint (SPEC-2026-TRIAL-
/// LOCK) — the "hw_" + SHA-256 of the hardware anchor, stable across
/// reinstalls. The server's one-trial-per-device lock keys on it; it falls
/// back to machine_id when omitted and never gates paid keys, so sending it
/// is always safe.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn activate_license(
    state: State<'_, AppState>,
    key: String,
    email: String,
    machine_id: String,
    phone: String,
    trial_vertical: Option<String>,
    bundle_id: Option<String>,
    hardware_fingerprint: Option<String>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::activate_license(
        &ctx,
        key,
        email,
        machine_id,
        phone,
        trial_vertical,
        bundle_id,
        hardware_fingerprint,
    )
    .await
    .map_err(Into::into)
}

/// Retrieves the unique hardware identifier for this installation.
#[tauri::command]
pub async fn get_machine_id(state: State<'_, AppState>) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_machine_id(&ctx)
        .await
        .map_err(Into::into)
}

/// Retrieves the device-level hardware fingerprint (SPEC-2026-TRIAL-LOCK).
///
/// The fingerprint is `hw_` + the full SHA-256 hex of the hardware anchor
/// (`get_system_uuid`), stable across app reinstalls — unlike `machine_id`
/// (the same digest truncated to 15 chars), the fingerprint is recomputed
/// from the anchor rather than read from a persisted per-installation
/// setting, so a wiped Settings table still yields the same value on the
/// same physical device. The license server's one-trial-per-device lock
/// keys on it: a reinstall under a fresh email cannot reset the trial clock.
/// The value is cached in Settings so the underlying process spawns
/// (wmic/reg) happen once per installation.
#[tauri::command]
pub async fn get_hardware_fingerprint(state: State<'_, AppState>) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_hardware_fingerprint(&ctx)
        .await
        .map_err(Into::into)
}

/// Renews an existing license subscription with a new license key.
///
/// Calls the server's `/api/v1/license/renew` endpoint with the
/// stored tenant_id, api_key, and the new key. On success, updates
/// both the Settings table and the tenant_subscription table with
/// the fresh signed_payload from the server.
#[tauri::command]
pub async fn renew_license(state: State<'_, AppState>, new_key: String) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::renew_license(&ctx, new_key)
        .await
        .map_err(Into::into)
}

/// Checks the license status against the PocketBase license server.
///
/// Unlike [`get_license_status`] which reads locally-stored data, this
/// command calls the server's `/api/v1/license/status` endpoint to get
/// the authoritative current status (e.g. whether the license has been
/// revoked or downgraded since last activation).
///
/// The stored API key is decrypted and sent as a Bearer token for
/// authentication. Returns the server's response directly.
#[tauri::command]
pub async fn check_license_status(
    state: State<'_, AppState>,
) -> Result<ServerLicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::check_license_status(&ctx)
        .await
        .map_err(Into::into)
}

/// Ping the license server's `/api/health` endpoint to verify reachability.
///
/// Unlike [`check_license_status`], this probe needs NO stored license key —
/// so the login/lock-screen connection pill can report the auth server before
/// any license is activated. The endpoint is unauthenticated.
///
/// It answers two questions, not one. `ok` is reachability; `state` is health,
/// read from the payload the server sends even with a 503. Collapsing the two
/// is what used to make "up, database down" render identically to "no server".
#[tauri::command]
pub async fn test_auth_connection() -> Result<AuthPingResult, AppError> {
    oz_bridge::license::test_auth_connection()
        .await
        .map_err(Into::into)
}

/// Analyzes the local license state and returns a comprehensive status response.
#[tauri::command]
pub async fn get_license_status(state: State<'_, AppState>) -> Result<LicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_license_status(&ctx)
        .await
        .map_err(Into::into)
}

/// Pause the current subscription for 1–3 months.
///
/// Reads the stored API key, calls the license server's pause endpoint,
/// and returns the new paused status.
#[tauri::command]
pub async fn pause_subscription(
    state: State<'_, AppState>,
    pause_months: u8,
) -> Result<PauseResumeDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::pause_subscription(&ctx, pause_months)
        .await
        .map_err(Into::into)
}

/// Resume a paused subscription.
///
/// Reads the stored API key and calls the license server's resume endpoint.
#[tauri::command]
pub async fn resume_subscription(state: State<'_, AppState>) -> Result<PauseResumeDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::resume_subscription(&ctx)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_machine_id`].
#[tauri::command]
pub async fn get_machine_id_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_machine_id_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_hardware_fingerprint`].
#[tauri::command]
pub async fn get_hardware_fingerprint_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_hardware_fingerprint_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`renew_license`].
#[tauri::command]
pub async fn renew_license_scoped(
    session_token: String,
    state: State<'_, AppState>,
    new_key: String,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::renew_license_scoped(&ctx, &session_token, new_key)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`check_license_status`].
#[tauri::command]
pub async fn check_license_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ServerLicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::check_license_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`test_auth_connection`].
#[tauri::command]
pub async fn test_auth_connection_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<AuthPingResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::test_auth_connection_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_license_status`].
#[tauri::command]
pub async fn get_license_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::get_license_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`pause_subscription`].
#[tauri::command]
pub async fn pause_subscription_scoped(
    session_token: String,
    state: State<'_, AppState>,
    pause_months: u8,
) -> Result<PauseResumeDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::pause_subscription_scoped(&ctx, &session_token, pause_months)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`resume_subscription`].
#[tauri::command]
pub async fn resume_subscription_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PauseResumeDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::license::resume_subscription_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
// ── Adapters the sibling test module calls directly (bodies moved) ─────────────────

/// Per-installation 15-char machine ID generator (lives in
/// [`oz_bridge::license::generate_machine_id`]).
#[allow(dead_code)] // sibling license_tests.rs calls it directly
fn generate_machine_id() -> String {
    oz_bridge::license::generate_machine_id()
}

/// 64-char platform-stable hardware fingerprint (lives in
/// [`oz_bridge::license::generate_hardware_fingerprint`]).
#[allow(dead_code)] // sibling license_tests.rs calls it directly
fn generate_hardware_fingerprint() -> String {
    oz_bridge::license::generate_hardware_fingerprint()
}

/// Grace window end for one tier (lives in [`oz_bridge::license::grace_deadline_for`]).
#[allow(dead_code)] // subscription.rs documents this contract against it
fn grace_deadline_for(tier_key: &str, expires_at: DateTime<Utc>) -> DateTime<Utc> {
    oz_bridge::license::grace_deadline_for(tier_key, expires_at)
}
