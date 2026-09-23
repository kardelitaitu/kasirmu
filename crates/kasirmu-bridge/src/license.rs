//! License activation and status command bodies (Wave E / E3) - the tauri-free half
//! of apps/desktop-tauri/src/commands/license.rs.
//!
//! Key functions: the activation, renewal, pause and resume round-trips to the license
//! server, the locally-derived verdict, the server-authoritative status probe, the
//! unauthenticated health probe, the machine-id / hardware-fingerprint generators, and
//! the session-scoped counterpart of every command.
//!
//! Gate order, Settings keys, error strings, log messages and the cfg(debug_assertions)
//! verdict branches are verbatim ports of the command bodies; AppError becomes
//! BridgeError variant-for-variant. Every read or write of the global database goes
//! through BridgeCtx::lock_global - the same single connection the shell locked through
//! state.db. The five session-validating scoped variants keep validating the token and
//! nothing more; the three F-017 scoped gates keep the scope-aware
//! require_permission_for_session check through
//! BridgeCtx::require_session_permission, in the same order (resolve, gate, call).
//! get_system_uuid is ported unchanged: same process invocations, same argument vectors,
//! same Linux/macOS machine-id file fallback, same per-process fallback cache.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use chrono::{DateTime, Utc};
use kasirmu_core::Settings;
use kasirmu_core::crypto::{decrypt_api_key, encrypt_api_key};
use kasirmu_core::license_verification::{
    ActivateLicenseRequest, RenewLicenseRequest, SignedSubscriptionPayload,
    activate_license as core_activate_license, apply_crl_to_cache, apply_license_verdict_to_cache,
    check_license_status as core_check_license_status, fetch_license_crl,
    pause_subscription as core_pause_subscription, renew_license as core_renew_license,
    resume_subscription as core_resume_subscription, store_subscription, verify_crl_signature,
    verify_license_signature,
};
use kasirmu_core::permissions;
use kasirmu_core::subscription::{SubscriptionTier, TenantSubscription};
use platform_core::settings::keys;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// PocketBase requires IDs to be exactly 15 lowercase alphanumeric chars.
const MACHINE_ID_LEN: usize = 15;

/// Represents the front-end state of a license.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseVerificationStatus {
    /// License is active and within the expiry window.
    Valid,
    /// License is past expiry and past the grace period limit.
    Expired,
    /// License is past expiry but remains active within the 14-day grace window.
    GracePeriod,
    /// Signature verification failed, indicating possible tampering or corruption.
    InvalidSignature,
    /// System clock tampering detected via ledger timestamps.
    ClockTampered,
    /// No license has been activated for this installation.
    Missing,
}

/// Data transfer object representing the current state of the local license.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatusDto {
    /// Whether the license is currently active and usable.
    pub is_active: bool,
    /// Categorized verification status of the license.
    pub status: LicenseVerificationStatus,
    /// The subscription tier (free, standard, pro, enterprise).
    /// Available immediately from local data — no network call required.
    pub tier: Option<String>,
    /// Raw JSON payload of the signed license, if available.
    pub payload: Option<String>,
    /// Human-readable message explaining the status or providing error details.
    pub message: Option<String>,
}

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
#[allow(clippy::too_many_arguments)]
pub async fn activate_license(
    ctx: &BridgeCtx<'_>,
    key: String,
    email: String,
    machine_id: String,
    phone: String,
    trial_vertical: Option<String>,
    bundle_id: Option<String>,
    hardware_fingerprint: Option<String>,
) -> Result<bool, BridgeError> {
    // H1 audit fix: read the previously-stored (now encrypted) api_key
    // so the server can authenticate the caller as the legitimate tenant
    // admin on re-activations. On first activation this returns None and a
    // new api_key is issued in the response which we encrypt before storing.
    //
    // The `machine_id` parameter is the persisted machine fingerprint
    // (the front-end calls get_machine_id before activate_license).
    // We use it as the encryption key material — this binds the
    // ciphertext to this specific installation's hardware.
    let stored_api_key: Option<String> = {
        let conn = ctx.lock_global().await;
        sealed_api_key(&conn, &machine_id)?
    };

    let phone_clone = phone.clone();
    let machine_id_for_encryption = machine_id.clone();

    let req = ActivateLicenseRequest {
        key,
        email,
        machine_id,
        phone,
        trial_vertical,
        bundle_id,
        hardware_fingerprint,
        api_key: stored_api_key,
    };

    let resp = core_activate_license(&req)
        .await
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    // Encrypt the api_key before storing in Settings.
    // The key is derived from the persisted machine_id, binding the
    // ciphertext to this specific installation.
    let encrypted_api_key = encrypt_api_key(&resp.api_key, &machine_id_for_encryption)
        .map_err(|e| BridgeError::Internal(format!("failed to encrypt api_key: {e}")))?;

    // ── Update tenant_subscription for quota enforcement ──────
    // The activate_license response includes a signed_payload with
    // tier, max_locations (1g wire name; the max_stores alias covers
    // pre-rename payloads), max_pos_instances, etc. We persist this to
    // the tenant_subscription table keyed as "default" (NOT the
    // server-assigned tenant_id from resp.tenant_id) so workspace
    // commands like create_workspace_instance_scoped pick it up via
    // TenantSubscription::load("default"). Without this write, the
    // quota system would remain stuck on the bootstrap Free tier
    // (seeded by migration 061) regardless of what tier the user
    // activated.
    //
    // This write comes BEFORE Settings::set_batch so a partial
    // failure here doesn't leave the system in an inconsistent state
    // where Settings reflect the new tier but tenant_subscription
    // still has the old Free tier.
    let conn = ctx.lock_global().await;
    // tenant_subscription carries quota facts only. The live key is sealed
    // into `license.api_key` below and nowhere else — passing it here would
    // write a second, cleartext copy for no reader.
    store_subscription(&conn, "default", &resp.signed_payload, &resp.signature)
        .map_err(|e| BridgeError::Internal(format!("failed to persist subscription: {e}")))?;

    // Store in settings table
    Settings::set_batch(
        &conn,
        &[
            ("license.payload".to_string(), resp.signed_payload),
            ("license.signature".to_string(), resp.signature),
            ("license.tenant_id".to_string(), resp.tenant_id),
            ("license.api_key".to_string(), encrypted_api_key),
            ("license.phone".to_string(), phone_clone),
        ],
    )?;

    Ok(true)
}

/// Reads and unseals the stored api_key: base64 ciphertext bound to the machine, or a legacy
/// plaintext value the next write upgrades.
///
/// One rule, one place: activation writes this row and the device link reads it, and a second
/// copy of "decrypt or fall back to plaintext" is exactly the kind of thing that drifts out of
/// agreement in the less-exercised copy.
fn sealed_api_key(conn: &Connection, machine_id: &str) -> Result<Option<String>, BridgeError> {
    let raw = Settings::get(conn, "license.api_key")?.filter(|s| !s.is_empty());
    Ok(raw.map(|value| {
        decrypt_api_key(&value, machine_id).unwrap_or_else(|e| {
            tracing::warn!("license.api_key decryption failed, treating as legacy plaintext: {e}");
            value
        })
    }))
}

/// The device's own licence credentials: `(api_key, machine_id)`.
///
/// Read from the encrypted Settings row exactly as activation stores it — derived from the
/// machine id, so the ciphertext is bound to this installation — which is why no caller and
/// no renderer ever has to hold the key.
///
/// # Errors
///
/// `BridgeError::Invalid` when the device has not been activated: linking binds an identity
/// to a tenant, and before activation there is no tenant to bind it to.
pub async fn stored_credentials(ctx: &BridgeCtx<'_>) -> Result<(String, String), BridgeError> {
    let machine_id = get_machine_id(ctx).await?;
    let api_key = {
        let conn = ctx.lock_global().await;
        sealed_api_key(&conn, &machine_id)?
    };
    match api_key {
        Some(key) if !key.is_empty() => Ok((key, machine_id)),
        _ => Err(BridgeError::Invalid(
            "this device is not activated yet".to_string(),
        )),
    }
}

/// Retrieves the unique hardware identifier for this installation.
pub async fn get_machine_id(ctx: &BridgeCtx<'_>) -> Result<String, BridgeError> {
    let conn = ctx.lock_global().await;
    // Return the persisted machine ID if one already exists.
    if let Some(existing) = Settings::get(&conn, keys::MACHINE_ID)?
        && !existing.is_empty()
    {
        return Ok(existing);
    }
    // Generate a new one and persist it.
    let id = generate_machine_id();
    Settings::set_batch(&conn, &[(keys::MACHINE_ID.to_string(), id.clone())])?;
    Ok(id)
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
pub async fn get_hardware_fingerprint(ctx: &BridgeCtx<'_>) -> Result<String, BridgeError> {
    let conn = ctx.lock_global().await;
    // Return the persisted fingerprint if one already exists.
    if let Some(existing) = Settings::get(&conn, keys::HARDWARE_FINGERPRINT)?
        && !existing.is_empty()
    {
        return Ok(existing);
    }
    // Generate a new one and persist it.
    let fp = generate_hardware_fingerprint();
    Settings::set_batch(
        &conn,
        &[(keys::HARDWARE_FINGERPRINT.to_string(), fp.clone())],
    )?;
    Ok(fp)
}

/// Renews an existing license subscription with a new license key.
///
/// Calls the server's `/api/v1/license/renew` endpoint with the
/// stored tenant_id, api_key, and the new key. On success, updates
/// both the Settings table and the tenant_subscription table with
/// the fresh signed_payload from the server.
pub async fn renew_license(ctx: &BridgeCtx<'_>, new_key: String) -> Result<bool, BridgeError> {
    if new_key.trim().is_empty() {
        return Err(BridgeError::Invalid("new license key is required".into()));
    }

    // Read tenant_id and api_key from Settings.
    let (tenant_id, api_key_encrypted, machine_id) = {
        let conn = ctx.lock_global().await;
        let tid = Settings::get(&conn, "license.tenant_id")?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| BridgeError::Invalid("No license activated. Activate first.".into()))?;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, keys::MACHINE_ID)?.unwrap_or_default();
        (tid, api_key_enc, mid)
    };

    let api_key = match api_key_encrypted {
        Some(ref v) => decrypt_api_key(v, &machine_id).unwrap_or_else(|e| {
            tracing::warn!("license.api_key decryption failed, treating as legacy plaintext: {e}");
            v.clone()
        }),
        None => {
            return Err(BridgeError::Invalid(
                "No license activated. Activate first.".into(),
            ));
        }
    };

    let req = RenewLicenseRequest {
        tenant_id,
        api_key: api_key.clone(),
        key: new_key,
        // ADR #57 §2.5: already loaded above (it is the api-key KDF factor), so
        // sending it costs nothing and lets the server refuse the renewal to
        // THIS device rather than to every terminal the tenant owns.
        machine_id,
    };

    let resp = core_renew_license(&req)
        .await
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    // Persist the renewed subscription to both stores.
    let conn = ctx.lock_global().await;

    // tenant_subscription (quota enforcement) — no key argument, same rule as
    // the activate lane: `api_key` above exists to call the server, not to be
    // copied into a second table in the clear.
    store_subscription(&conn, "default", &resp.signed_payload, &resp.signature).map_err(|e| {
        BridgeError::Internal(format!("failed to persist renewed subscription: {e}"))
    })?;

    // Settings (license status checks)
    // Parse the tenant_id from the renewed payload so Settings stays
    // in sync — if the server issued the renewal for a different
    // tenant (edge case like merged accounts), the stored tenant_id
    // is now correct for subsequent renew/status calls.
    let renewed_tenant_id: Option<String> =
        serde_json::from_str::<serde_json::Value>(&resp.signed_payload)
            .ok()
            .and_then(|v| v.get("tenant_id")?.as_str().map(String::from));

    let mut settings_entries = vec![
        ("license.payload".to_string(), resp.signed_payload),
        ("license.signature".to_string(), resp.signature),
    ];
    if let Some(tid) = renewed_tenant_id {
        settings_entries.push(("license.tenant_id".to_string(), tid));
    }

    Settings::set_batch(&conn, &settings_entries)?;

    Ok(true)
}

/// Query the physical motherboard UUID or Windows MachineGuid as a stable hardware identifier.
fn get_system_uuid() -> Option<String> {
    use std::process::Command;

    // 1. Try motherboard UUID via wmic
    if let Ok(output) = Command::new("wmic")
        .args(["csproduct", "get", "uuid"])
        .output()
        && output.status.success()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout
            .lines()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if lines.len() >= 2 {
            let uuid = lines[1];
            if !uuid.is_empty()
                && uuid != "00000000-0000-0000-0000-000000000000"
                && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"
            {
                return Some(uuid.to_string());
            }
        }
    }

    // 2. Try Windows MachineGuid from Registry
    if let Ok(output) = Command::new("reg")
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        && output.status.success()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("MachineGuid") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    return Some(parts[2].to_string());
                }
            }
        }
    }

    // 3. Linux/macOS: stable machine-id files (no wmic/reg available).
    //    /etc/machine-id is the canonical systemd identifier and is stable
    //    for the lifetime of an installation — the right hardware anchor
    //    for Linux CI runners and Linux desktops alike. The dbus fallback
    //    covers hosts without systemd.
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(content) = std::fs::read_to_string(path) {
            let id = content.trim();
            if !id.is_empty()
                && id != "00000000-0000-0000-0000-000000000000"
                && id != "ffffffffffffffffffffffffffffffff"
            {
                return Some(id.to_string());
            }
        }
    }

    None
}

/// Per-process fallback machine-ID source, so the last-resort random UUID
/// is drawn once and then reused. Without this cache, a machine with no
/// queryable hardware ID (e.g. a minimal container) would derive a NEW
/// random machine ID on every `generate_machine_id()` call, breaking the
/// determinism guarantee that the 15-char fingerprint depends on.
static FALLBACK_MACHINE_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Generate a stable 15-char lowercase alphanumeric machine ID based on
/// system/hardware UUID, falling back to a random UUID if queries fail.
///
/// Uses the hardware ID hashed with SHA-256 to produce a unique
/// per-installation fingerprint. The ID is persisted in the local
/// Settings table and reused across activations.
pub fn generate_machine_id() -> String {
    let raw_id = get_system_uuid().unwrap_or_else(|| {
        FALLBACK_MACHINE_ID
            .get_or_init(|| uuid::Uuid::new_v4().to_string())
            .clone()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    let hash = hasher.finalize();
    let hex_str = hex::encode(&hash[..16]);
    hex_str[..MACHINE_ID_LEN].to_string()
}

/// Compute the canonical `hw_<64hex>` hardware fingerprint from the same
/// hardware anchor `machine_id` derives from (SPEC-2026-TRIAL-LOCK). The
/// FULL SHA-256 digest (64 hex chars) is used — the machine_id only takes
/// the first 15 chars — so the fingerprint is both more collision-resistant
/// and self-describing ("hw_" prefix) in the license server's
/// trial_registrations collection. The random-UUID fallback is shared with
/// `generate_machine_id` so a host with no queryable hardware anchor gets
/// a stable-in-process value rather than a fresh one per call.
pub fn generate_hardware_fingerprint() -> String {
    let raw_id = get_system_uuid().unwrap_or_else(|| {
        FALLBACK_MACHINE_ID
            .get_or_init(|| uuid::Uuid::new_v4().to_string())
            .clone()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    let hash = hasher.finalize();
    format!("hw_{}", hex::encode(hash))
}

/// Data transfer object for server-authoritative license status.
/// Mirrors `kasirmu_core::LicenseStatusResponse` but lives in this crate
/// so Tauri can serialize it over IPC.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerLicenseStatusDto {
    /// The tenant ID.
    pub tenant_id: String,
    /// The subscription status.
    pub status: String,
    /// The tier key (free, pro, premium, enterprise).
    pub tier: String,
    /// Whether the subscription is active.
    pub active: bool,
    /// Whether **this device** has been revoked by a tenant admin
    /// (ADR #58 §2.4a.2). Server-authored; the session gate refuses when the
    /// cached verdict is set.
    pub device_revoked: bool,
    /// Whether the hardware fingerprint matched the registered machine record (ADR #58 §2.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware_verified: Option<bool>,
    /// When the subscription expires (RFC 3339).
    pub expires_at: Option<String>,
    /// When the grace period ends (RFC 3339).
    pub grace_until: Option<String>,
    /// Tier location quota. The license-server wire is now `max_locations`
    /// (1g done); this IPC DTO carried the historical `max_stores` name
    /// until the settings UI consumed it — renamed in the same lockstep
    /// commit as its UI consumer (the §B staged-migration completion).
    pub max_locations: i64,
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
pub async fn check_license_status(
    ctx: &BridgeCtx<'_>,
) -> Result<ServerLicenseStatusDto, BridgeError> {
    let (api_key_encrypted, machine_id, hardware_fingerprint, hardware_token) = {
        let conn = ctx.lock_global().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, keys::MACHINE_ID)?.unwrap_or_default();
        let hw_fp = match Settings::get(&conn, keys::HARDWARE_FINGERPRINT)? {
            Some(fp) if !fp.is_empty() => Some(fp),
            _ => {
                let fp = generate_hardware_fingerprint();
                let _ = Settings::set(&conn, keys::HARDWARE_FINGERPRINT, &fp);
                Some(fp)
            }
        };
        let hw_tok = Settings::get(&conn, keys::HARDWARE_TOKEN)?.filter(|s| !s.is_empty());
        (api_key_enc, mid, hw_fp, hw_tok)
    };

    let api_key = match api_key_encrypted {
        Some(ref v) => decrypt_api_key(v, &machine_id).unwrap_or_else(|e| {
            tracing::warn!("license.api_key decryption failed, treating as legacy plaintext: {e}");
            v.clone()
        }),
        None => {
            return Err(BridgeError::Invalid(
                "No license activated. Activate first.".into(),
            ));
        }
    };

    // ADR #57 §2.1: attach this installation’s APK signing-certificate
    // fingerprint when the platform can produce one. Android-only; every other
    // platform, and every failure inside the Android path, yields `None` —
    // which the server reads as `unknown`, never `mismatch` (§2.2), so a
    // device that cannot be fingerprinted is never refused a renewal for it.
    let build_fingerprint = crate::build_integrity::apk_signing_fingerprint();

    let resp = core_check_license_status(
        &api_key,
        &machine_id,
        build_fingerprint.as_deref(),
        hardware_fingerprint.as_deref(),
        hardware_token.as_deref(),
    )
    .await
    .map_err(|e| BridgeError::Internal(e.to_string()))?;

    // Refresh local capability cache upon successful license-server response,
    // and learn whether the tenant verdict is a revocation.
    //
    // The three local effects live in ONE core function so the daemon's
    // ride-along (ADR #58 option C) and this screen-driven path cannot drift
    // apart. The write-then-sweep ordering §2.5 depends on is that function's
    // contract, not this call site's.
    let tenant_revoked = {
        let conn = ctx.lock_global().await;
        apply_license_verdict_to_cache(&conn, &resp)
    };

    // §2.4a.2's per-device verdict drops live sessions too, for the same reason
    // the tenant sweep exists: refusing the NEXT session does not stop the one
    // already open on a stolen tablet.
    if resp.device_revoked || resp.hardware_verified == Some(false) {
        let dropped = crate::auth::invalidate_all_sessions(ctx);
        tracing::warn!(
            dropped,
            "device revoked or hardware mismatch — invalidated every live session (ADR #58 §2.4)"
        );
    }

    // ADR #58 §2.5: a REVOKED verdict invalidates every live session AT ONCE.
    //
    // Refusing only NEW sessions would leave the tenant selling until the
    // current session's TTL expired — up to 24 hours after an abuse verdict.
    // This is the chokepoint where the server's answer actually arrives, so it
    // is where the lock has to land.
    //
    // Order matters and is deliberate: the cache is written BEFORE this, so a
    // session created in the window between the two reads fails closed on the
    // cached verdict rather than slipping through. Sweeping first would leave a
    // gap where the row said `active` and the store was already empty.
    if tenant_revoked {
        let dropped = crate::auth::invalidate_all_sessions(ctx);
        tracing::warn!(
            dropped,
            "tenant revoked — invalidated every live session (ADR #58 §2.5)"
        );
    }

    // Opportunistically refresh CRL on status check (ADR #58 §2.1/§2.2)
    if let Ok(crl_resp) = fetch_license_crl(None).await
        && let Ok(crl_payload) = verify_crl_signature(&crl_resp.payload, &crl_resp.signature)
    {
        let conn = ctx.lock_global().await;
        // `Ok(true)` IS the revocation; `Ok(false)` and `Err` both mean nothing
        // was revoked, so they share the skip without a nested check.
        if let Ok(true) = apply_crl_to_cache(
            &conn,
            &crl_payload,
            Some(&resp.tenant_id),
            None,
            Some(&machine_id),
        ) {
            let dropped = crate::auth::invalidate_all_sessions(ctx);
            tracing::warn!(
                dropped,
                "CRL revocation detected — invalidated every live session (ADR #58 §2.1/§2.2)"
            );
        }
    }

    let max_locations = resp.effective_max_locations();

    Ok(ServerLicenseStatusDto {
        tenant_id: resp.tenant_id,
        status: resp.status,
        tier: resp.tier,
        active: resp.active,
        device_revoked: resp.device_revoked,
        hardware_verified: resp.hardware_verified,
        expires_at: resp.expires_at,
        grace_until: resp.grace_until,
        max_locations,
    })
}

/// Fetch, cryptographically verify, and apply the latest Certificate/Licence Revocation List (ADR #58 §2.1/§2.2).
///
/// Returns `true` if this tenant or device is revoked in the CRL.
pub async fn refresh_license_crl(ctx: &BridgeCtx<'_>) -> Result<bool, BridgeError> {
    let crl_resp = fetch_license_crl(None)
        .await
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    let crl_payload = verify_crl_signature(&crl_resp.payload, &crl_resp.signature)
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    let (tenant_id, machine_id) = {
        let conn = ctx.lock_global().await;
        let sub = TenantSubscription::load(&conn, "default")?;
        let mid = Settings::get(&conn, keys::MACHINE_ID)?.unwrap_or_default();
        (sub.map(|s| s.tenant_id), mid)
    };

    let is_revoked = {
        let conn = ctx.lock_global().await;
        apply_crl_to_cache(
            &conn,
            &crl_payload,
            tenant_id.as_deref(),
            None,
            Some(&machine_id),
        )
        .map_err(|e| BridgeError::Internal(e.to_string()))?
    };

    if is_revoked {
        let dropped = crate::auth::invalidate_all_sessions(ctx);
        tracing::warn!(
            dropped,
            "tenant or device revoked via CRL — invalidated all live sessions (ADR #58 §2.1/§2.2)"
        );
    }

    Ok(is_revoked)
}

/// Data transfer object for the auth-server reachability probe.
///
/// Mirrors the shape the sync probe returns so the UI can render both
/// connection pills uniformly.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPingResult {
    /// Whether the auth server responded with a 2xx.
    pub ok: bool,
    /// Status text (e.g. "Connected", "Connection refused", ...).
    pub status: String,
    /// Round-trip latency in milliseconds, if the ping succeeded.
    pub latency_ms: Option<u64>,
    /// Health state read from the server's own payload — see
    /// [`kasirmu_core::service_health::HealthState`]. This is not the same question
    /// as `ok`: a degraded server is answering, and saying what is broken.
    pub state: kasirmu_core::service_health::HealthState,
    /// The named cause when `state` is not `operational`.
    pub cause: Option<String>,
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
pub async fn test_auth_connection() -> Result<AuthPingResult, BridgeError> {
    let result = kasirmu_core::license_verification::ping_license_server().await;
    Ok(AuthPingResult {
        ok: result.ok,
        status: result.status,
        latency_ms: result.latency_ms,
        state: result.state,
        cause: result.cause,
    })
}

/// Grace deadline for the local license verdict: expires_at + the tier's
/// published offline-grace window (§B: 7/14/14/30/60 —
/// [`SubscriptionTier::offline_grace_days`]). Deliberately NOT derived
/// from the payload's `grace_until`, which servers before the per-tier
/// fix signed as a flat 14 days; this keeps the license-status verdict
/// aligned with `TenantSubscription::lifecycle_state()` (the
/// capabilities path) even for stale payloads. Unknown tier keys parse
/// as Free (7 days) — fail-closed, never over-credit.
pub fn grace_deadline_for(tier_key: &str, expires_at: DateTime<Utc>) -> DateTime<Utc> {
    expires_at + chrono::Duration::days(SubscriptionTier::from_db(tier_key).offline_grace_days())
}

/// Analyzes the local license state and returns a comprehensive status response.
pub async fn get_license_status(ctx: &BridgeCtx<'_>) -> Result<LicenseStatusDto, BridgeError> {
    let conn = ctx.lock_global().await;

    // ── Clock rollback check (H1 audit gap fix) ─────────────
    // validate_clock_rollback compares the max ledger timestamp
    // against Utc::now(). If the OS clock was rolled back, return
    // ClockTampered so the UI can display a warning before the user
    // makes sales that would have future timestamps.
    if let Err(e) = TenantSubscription::validate_clock_rollback(&conn) {
        return Ok(LicenseStatusDto {
            is_active: false,
            status: LicenseVerificationStatus::ClockTampered,
            tier: None,
            payload: None,
            message: Some(e.to_string()),
        });
    }

    let payload_str = Settings::get(&conn, "license.payload")?;
    let signature = Settings::get(&conn, "license.signature")?;

    if let (Some(p), Some(s)) = (payload_str, signature) {
        if let Err(e) = verify_license_signature(&p, &s) {
            return Ok(LicenseStatusDto {
                is_active: false,
                status: LicenseVerificationStatus::InvalidSignature,
                tier: None,
                payload: None,
                message: Some(format!("Invalid signature: {}", e)),
            });
        }

        // Parse payload
        let payload: SignedSubscriptionPayload = match serde_json::from_str(&p) {
            Ok(parsed) => parsed,
            Err(e) => {
                return Ok(LicenseStatusDto {
                    is_active: false,
                    status: LicenseVerificationStatus::InvalidSignature,
                    tier: None,
                    payload: None,
                    message: Some(format!("Failed to parse payload: {}", e)),
                });
            }
        };

        let now = Utc::now();

        let expires_at = DateTime::parse_from_rfc3339(&payload.expires_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);

        let grace_until = DateTime::parse_from_rfc3339(&payload.grace_until)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);

        // The grace verdict uses the published per-tier contract (§B,
        // `offline_grace_days`: 7/14/14/30/60) — the SAME table
        // `TenantSubscription::lifecycle_state()` applies on the
        // capabilities path — NOT the payload's grace_until, which
        // servers before the per-tier fix signed as a flat 14 days.
        // Keeping both desktop verdicts on the tier table makes them
        // agree even for stale payloads.
        let grace_deadline = grace_deadline_for(&payload.tier_key, expires_at);
        let _ = &grace_until; // display data only (see above)

        if now < expires_at {
            Ok(LicenseStatusDto {
                is_active: true,
                status: LicenseVerificationStatus::Valid,
                tier: Some(payload.tier_key),
                payload: Some(p),
                message: None,
            })
        } else if now < grace_deadline {
            Ok(LicenseStatusDto {
                is_active: true,
                status: LicenseVerificationStatus::GracePeriod,
                tier: Some(payload.tier_key),
                payload: Some(p),
                message: Some(format!(
                    "License expired on {}. You are in the grace period until {}.",
                    expires_at.format("%Y-%m-%d"),
                    grace_deadline.format("%Y-%m-%d")
                )),
            })
        } else {
            #[cfg(debug_assertions)]
            {
                tracing::debug!("License expired in debug mode — returning Valid with payload");
                Ok(LicenseStatusDto {
                    is_active: true,
                    status: LicenseVerificationStatus::Valid,
                    tier: Some(payload.tier_key),
                    payload: Some(p),
                    message: None,
                })
            }
            // ── PARKED ARM — unreachable by construction (owner ruling, 2026-09-20) ──
            // This release-only branch cannot be executed from this crate, and the
            // reason is structural rather than an oversight: reaching it needs a
            // payload whose signature VERIFIES, and `verify_license_signature` takes
            // no key parameter — it reads a build-time `include_str!` public key at
            // `kasirmu-core/src/license_verification.rs:36`, while the private half
            // is gitignored (`*.key`) and absent from this checkout. No fixture here
            // can mint a signature that verifies, so no seeded row reaches this arm.
            //
            // Ruled 2026-09-20 (`todo-owner-rulings.md` R1; box
            // `todo-open-debt-program.md:138`): leave it parked. Both alternatives
            // change the licence path itself — injecting a verification seam puts a
            // substitution point on the one code path whose job is to refuse forged
            // licences, and compiling a test key into the crate ships a private key
            // in the source tree — while the payoff is one branch of an expiry
            // ladder whose siblings are already covered. The forged-row refusal
            // stays pinned in both profiles at `auth_tests.rs:400-402`.
            #[cfg(not(debug_assertions))]
            {
                return Ok(LicenseStatusDto {
                    is_active: false,
                    status: LicenseVerificationStatus::Expired,
                    tier: Some(payload.tier_key),
                    payload: Some(p),
                    message: Some(format!(
                        "License expired on {}. Grace period ended on {}.",
                        expires_at.format("%Y-%m-%d"),
                        grace_deadline.format("%Y-%m-%d")
                    )),
                });
            }
        }
    } else {
        // ── No stored payload/signature ─────────────────────
        #[cfg(debug_assertions)]
        {
            tracing::debug!("No license payload found in debug mode — returning Valid (free tier)");
            Ok(LicenseStatusDto {
                is_active: true,
                status: LicenseVerificationStatus::Valid,
                tier: Some("free".to_string()),
                payload: None,
                message: None,
            })
        }
        #[cfg(not(debug_assertions))]
        {
            return Ok(LicenseStatusDto {
                is_active: false,
                status: LicenseVerificationStatus::Missing,
                tier: None,
                payload: None,
                message: Some("No license found. Please activate.".to_string()),
            });
        }
    }
}

/// Pause the current subscription for 1–3 months.
///
/// Reads the stored API key, calls the license server's pause endpoint,
/// and returns the new paused status.
pub async fn pause_subscription(
    ctx: &BridgeCtx<'_>,
    pause_months: u8,
) -> Result<PauseResumeDto, BridgeError> {
    let api_key = {
        let conn = ctx.lock_global().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, keys::MACHINE_ID)?.unwrap_or_default();
        match api_key_enc {
            Some(ref v) => decrypt_api_key(v, &mid).unwrap_or_else(|e| {
                tracing::warn!(
                    "license.api_key decryption failed, treating as legacy plaintext: {e}"
                );
                v.clone()
            }),
            None => {
                return Err(BridgeError::Invalid(
                    "No license activated. Activate first.".into(),
                ));
            }
        }
    };

    let resp = core_pause_subscription(&api_key, pause_months)
        .await
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    Ok(PauseResumeDto {
        status: resp.status,
        tier_key: resp.tier_key,
        paused_at: resp.paused_at,
        paused_until: resp.paused_until,
    })
}

/// Resume a paused subscription.
///
/// Reads the stored API key and calls the license server's resume endpoint.
pub async fn resume_subscription(ctx: &BridgeCtx<'_>) -> Result<PauseResumeDto, BridgeError> {
    let api_key = {
        let conn = ctx.lock_global().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, keys::MACHINE_ID)?.unwrap_or_default();
        match api_key_enc {
            Some(ref v) => decrypt_api_key(v, &mid).unwrap_or_else(|e| {
                tracing::warn!(
                    "license.api_key decryption failed, treating as legacy plaintext: {e}"
                );
                v.clone()
            }),
            None => {
                return Err(BridgeError::Invalid(
                    "No license activated. Activate first.".into(),
                ));
            }
        }
    };

    let resp = core_resume_subscription(&api_key)
        .await
        .map_err(|e| BridgeError::Internal(e.to_string()))?;

    Ok(PauseResumeDto {
        status: resp.status,
        tier_key: resp.tier_key,
        paused_at: resp.paused_at,
        paused_until: resp.paused_until,
    })
}

/// DTO for pause/resume subscription response.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseResumeDto {
    /// New subscription status ("paused" or "active").
    pub status: String,
    /// Tier key that was paused/resumed.
    pub tier_key: String,
    /// When the subscription was paused (only on pause response).
    pub paused_at: Option<String>,
    /// When the pause expires (only on pause response).
    pub paused_until: Option<String>,
}

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

#[cfg(test)]
#[path = "license_tests.rs"]
mod license_tests;
