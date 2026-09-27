//! Session-scoped license & subscription command variants.
//!
//! Each is the gate-then-delegate twin of an unscoped command in [`super`]: it
//! resolves the session, applies the per-domain permission (F-017) where the
//! operation mutates a credential or a subscription, and calls straight through.
//!
//! Split out of `license.rs` on 2026-09-27. NOTE: this band deliberately
//! contains ZERO settings-key string literals, because
//! `settings_tests.rs::license_writer_literals_are_swept_from_license_rs_not_from_
//! `a_transcription` sweeps lowercase dotted literals out of `license.rs` and
//! requires at least five. Keep any code that names a `license.*` key in the
//! parent, or that floor stops being met.

use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::{
    AuthPingResult, LicenseStatusDto, PauseResumeDto, ServerLicenseStatusDto, check_license_status,
    get_hardware_fingerprint, get_license_status, get_machine_id, pause_subscription,
    renew_license, resume_subscription, test_auth_connection,
};

/// Session-scoped variant of [`get_machine_id`].
pub async fn get_machine_id_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<String, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    get_machine_id(ctx).await
}

/// Session-scoped variant of [`get_hardware_fingerprint`].
pub async fn get_hardware_fingerprint_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<String, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    get_hardware_fingerprint(ctx).await
}

/// Session-scoped variant of [`renew_license`].
pub async fn renew_license_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    new_key: String,
) -> Result<bool, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    renew_license(ctx, new_key).await
}

/// Session-scoped variant of [`check_license_status`].
pub async fn check_license_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<ServerLicenseStatusDto, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    check_license_status(ctx).await
}

/// Session-scoped variant of [`test_auth_connection`].
pub async fn test_auth_connection_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<AuthPingResult, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    test_auth_connection().await
}

/// Session-scoped variant of [`get_license_status`].
pub async fn get_license_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<LicenseStatusDto, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    get_license_status(ctx).await
}

/// Session-scoped variant of [`pause_subscription`].
pub async fn pause_subscription_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    pause_months: u8,
) -> Result<PauseResumeDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    pause_subscription(ctx, pause_months).await
}

/// Session-scoped variant of [`resume_subscription`].
pub async fn resume_subscription_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<PauseResumeDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    resume_subscription(ctx).await
}
