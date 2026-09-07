//! License Activation Tauri commands.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use chrono::{DateTime, Utc};
use oz_core::Settings;
use oz_core::crypto::{decrypt_api_key, encrypt_api_key};
use oz_core::license_verification::{
    ActivateLicenseRequest, RenewLicenseRequest, SignedSubscriptionPayload,
    activate_license as core_activate_license, check_license_status as core_check_license_status,
    pause_subscription as core_pause_subscription, renew_license as core_renew_license,
    resume_subscription as core_resume_subscription, store_subscription, verify_license_signature,
};
use oz_core::subscription::TenantSubscription;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

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
        let conn = state.db.lock().await;
        let raw = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        raw.as_ref().map(|v| {
            // Try decryption first (new format: base64 ciphertext).
            // If that fails, assume the value is legacy plaintext and
            // return it as-is. It will be encrypted on the next write.
            decrypt_api_key(v, &machine_id).unwrap_or_else(|e| {
                tracing::warn!(
                    "license.api_key decryption failed, treating as legacy plaintext: {e}"
                );
                v.clone()
            })
        })
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
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Encrypt the api_key before storing in Settings.
    // The key is derived from the persisted machine_id, binding the
    // ciphertext to this specific installation.
    let encrypted_api_key = encrypt_api_key(&resp.api_key, &machine_id_for_encryption)
        .map_err(|e| AppError::Internal(format!("failed to encrypt api_key: {e}")))?;

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
    let conn = state.db.lock().await;
    store_subscription(
        &conn,
        "default",
        &resp.signed_payload,
        &resp.signature,
        &resp.api_key,
    )
    .map_err(|e| AppError::Internal(format!("failed to persist subscription: {e}")))?;

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

/// Retrieves the unique hardware identifier for this installation.
#[tauri::command]
pub async fn get_machine_id(state: State<'_, AppState>) -> Result<String, AppError> {
    let conn = state.db.lock().await;
    // Return the persisted machine ID if one already exists.
    if let Some(existing) = Settings::get(&conn, "machine_id")?
        && !existing.is_empty()
    {
        return Ok(existing);
    }
    // Generate a new one and persist it.
    let id = generate_machine_id();
    Settings::set_batch(&conn, &[("machine_id".to_string(), id.clone())])?;
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
#[tauri::command]
pub async fn get_hardware_fingerprint(state: State<'_, AppState>) -> Result<String, AppError> {
    let conn = state.db.lock().await;
    // Return the persisted fingerprint if one already exists.
    if let Some(existing) = Settings::get(&conn, "hardware_fingerprint")?
        && !existing.is_empty()
    {
        return Ok(existing);
    }
    // Generate a new one and persist it.
    let fp = generate_hardware_fingerprint();
    Settings::set_batch(&conn, &[("hardware_fingerprint".to_string(), fp.clone())])?;
    Ok(fp)
}

/// Renews an existing license subscription with a new license key.
///
/// Calls the server's `/api/v1/license/renew` endpoint with the
/// stored tenant_id, api_key, and the new key. On success, updates
/// both the Settings table and the tenant_subscription table with
/// the fresh signed_payload from the server.
#[tauri::command]
pub async fn renew_license(state: State<'_, AppState>, new_key: String) -> Result<bool, AppError> {
    if new_key.trim().is_empty() {
        return Err(AppError::Invalid("new license key is required".into()));
    }

    // Read tenant_id and api_key from Settings.
    let (tenant_id, api_key_encrypted, machine_id) = {
        let conn = state.db.lock().await;
        let tid = Settings::get(&conn, "license.tenant_id")?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Invalid("No license activated. Activate first.".into()))?;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, "machine_id")?.unwrap_or_default();
        (tid, api_key_enc, mid)
    };

    let api_key = match api_key_encrypted {
        Some(ref v) => decrypt_api_key(v, &machine_id).unwrap_or_else(|e| {
            tracing::warn!("license.api_key decryption failed, treating as legacy plaintext: {e}");
            v.clone()
        }),
        None => {
            return Err(AppError::Invalid(
                "No license activated. Activate first.".into(),
            ));
        }
    };

    let req = RenewLicenseRequest {
        tenant_id,
        api_key: api_key.clone(),
        key: new_key,
    };

    let resp = core_renew_license(&req)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Persist the renewed subscription to both stores.
    let conn = state.db.lock().await;

    // tenant_subscription (quota enforcement)
    store_subscription(
        &conn,
        "default",
        &resp.signed_payload,
        &resp.signature,
        &api_key,
    )
    .map_err(|e| AppError::Internal(format!("failed to persist renewed subscription: {e}")))?;

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
fn generate_machine_id() -> String {
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
fn generate_hardware_fingerprint() -> String {
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
/// Mirrors `oz_core::LicenseStatusResponse` but lives in this crate
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
    /// When the subscription expires (RFC 3339).
    pub expires_at: Option<String>,
    /// When the grace period ends (RFC 3339).
    pub grace_until: Option<String>,
    /// Tier location quota. The license-server wire is now `max_locations`
    /// (1g done); this IPC DTO keeps the historical `max_stores` name
    /// because the settings UI consumes it — renaming it is a UI slice,
    /// not part of the license-server wire contract.
    pub max_stores: i64,
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
    let (api_key_encrypted, machine_id) = {
        let conn = state.db.lock().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, "machine_id")?.unwrap_or_default();
        (api_key_enc, mid)
    };

    let api_key = match api_key_encrypted {
        Some(ref v) => decrypt_api_key(v, &machine_id).unwrap_or_else(|e| {
            tracing::warn!("license.api_key decryption failed, treating as legacy plaintext: {e}");
            v.clone()
        }),
        None => {
            return Err(AppError::Invalid(
                "No license activated. Activate first.".into(),
            ));
        }
    };

    let resp = core_check_license_status(&api_key)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let max_stores = resp.effective_max_locations();

    Ok(ServerLicenseStatusDto {
        tenant_id: resp.tenant_id,
        status: resp.status,
        tier: resp.tier,
        active: resp.active,
        expires_at: resp.expires_at,
        grace_until: resp.grace_until,
        max_stores,
    })
}

/// Data transfer object for the auth-server reachability probe.
///
/// Mirrors the shape the sync probe returns so the UI can render both
/// connection pills uniformly.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPingResult {
    /// Whether the auth server responded successfully.
    pub ok: bool,
    /// Status text (e.g. "Connected", "Connection refused", ...).
    pub status: String,
    /// Round-trip latency in milliseconds, if the ping succeeded.
    pub latency_ms: Option<u64>,
}

/// Ping the license server's `/api/health` endpoint to verify reachability.
///
/// Unlike [`check_license_status`], this probe needs NO stored license key —
/// it answers only "is the auth server reachable?" so the login/lock-screen
/// connection pill can show green before any license is activated. The
/// endpoint is unauthenticated (the license server's health route returns
/// `{"status":"ok"}` without credentials).
#[tauri::command]
pub async fn test_auth_connection() -> Result<AuthPingResult, AppError> {
    let result = oz_core::license_verification::ping_license_server().await;
    Ok(AuthPingResult {
        ok: result.ok,
        status: result.status,
        latency_ms: result.latency_ms,
    })
}

/// Analyzes the local license state and returns a comprehensive status response.
#[tauri::command]
pub async fn get_license_status(state: State<'_, AppState>) -> Result<LicenseStatusDto, AppError> {
    let conn = state.db.lock().await;

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

        if now < expires_at {
            Ok(LicenseStatusDto {
                is_active: true,
                status: LicenseVerificationStatus::Valid,
                tier: Some(payload.tier_key),
                payload: Some(p),
                message: None,
            })
        } else if now < grace_until {
            Ok(LicenseStatusDto {
                is_active: true,
                status: LicenseVerificationStatus::GracePeriod,
                tier: Some(payload.tier_key),
                payload: Some(p),
                message: Some(format!(
                    "License expired on {}. You are in the grace period until {}.",
                    expires_at.format("%Y-%m-%d"),
                    grace_until.format("%Y-%m-%d")
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
                        grace_until.format("%Y-%m-%d")
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
#[tauri::command]
pub async fn pause_subscription(
    state: State<'_, AppState>,
    pause_months: u8,
) -> Result<PauseResumeDto, AppError> {
    let api_key = {
        let conn = state.db.lock().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, "machine_id")?.unwrap_or_default();
        match api_key_enc {
            Some(ref v) => decrypt_api_key(v, &mid).unwrap_or_else(|e| {
                tracing::warn!(
                    "license.api_key decryption failed, treating as legacy plaintext: {e}"
                );
                v.clone()
            }),
            None => {
                return Err(AppError::Invalid(
                    "No license activated. Activate first.".into(),
                ));
            }
        }
    };

    let resp = core_pause_subscription(&api_key, pause_months)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

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
#[tauri::command]
pub async fn resume_subscription(state: State<'_, AppState>) -> Result<PauseResumeDto, AppError> {
    let api_key = {
        let conn = state.db.lock().await;
        let api_key_enc = Settings::get(&conn, "license.api_key")?.filter(|s| !s.is_empty());
        let mid = Settings::get(&conn, "machine_id")?.unwrap_or_default();
        match api_key_enc {
            Some(ref v) => decrypt_api_key(v, &mid).unwrap_or_else(|e| {
                tracing::warn!(
                    "license.api_key decryption failed, treating as legacy plaintext: {e}"
                );
                v.clone()
            }),
            None => {
                return Err(AppError::Invalid(
                    "No license activated. Activate first.".into(),
                ));
            }
        }
    };

    let resp = core_resume_subscription(&api_key)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

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
#[tauri::command]
pub async fn get_machine_id_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let _session = state.resolve_session(&session_token)?;
    get_machine_id(state).await
}

/// Session-scoped variant of [`get_hardware_fingerprint`].
#[tauri::command]
pub async fn get_hardware_fingerprint_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let _session = state.resolve_session(&session_token)?;
    get_hardware_fingerprint(state).await
}

/// Session-scoped variant of [`renew_license`].
#[tauri::command]
pub async fn renew_license_scoped(
    session_token: String,
    state: State<'_, AppState>,
    new_key: String,
) -> Result<bool, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    renew_license(state, new_key).await
}

/// Session-scoped variant of [`check_license_status`].
#[tauri::command]
pub async fn check_license_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ServerLicenseStatusDto, AppError> {
    let _session = state.resolve_session(&session_token)?;
    check_license_status(state).await
}

/// Session-scoped variant of [`test_auth_connection`].
#[tauri::command]
pub async fn test_auth_connection_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<AuthPingResult, AppError> {
    let _session = state.resolve_session(&session_token)?;
    test_auth_connection().await
}

/// Session-scoped variant of [`get_license_status`].
#[tauri::command]
pub async fn get_license_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LicenseStatusDto, AppError> {
    let _session = state.resolve_session(&session_token)?;
    get_license_status(state).await
}

/// Session-scoped variant of [`pause_subscription`].
#[tauri::command]
pub async fn pause_subscription_scoped(
    session_token: String,
    state: State<'_, AppState>,
    pause_months: u8,
) -> Result<PauseResumeDto, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    pause_subscription(state, pause_months).await
}

/// Session-scoped variant of [`resume_subscription`].
#[tauri::command]
pub async fn resume_subscription_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PauseResumeDto, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    resume_subscription(state).await
}

#[cfg(test)]
#[path = "license_tests.rs"]
mod tests;
