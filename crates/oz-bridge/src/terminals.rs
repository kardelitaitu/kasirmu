//! Terminal management command bodies (Wave F) — the tauri-free half of
//! `apps/desktop-client/src/commands/terminals.rs`.
//!
//! Key items: the terminal / terminal-profile / device-binding commands, the
//! HMAC-SHA256 binding signer and verifier over the OS keyring, and the DTOs
//! both shells re-export.
//!
//! The ports are verbatim: permission-gate kind and ORDER, store-db lock
//! acquisition order and count, the subscription clock-rollback and tier-quota
//! gate placement inside `register_terminal_scoped`, every `tracing!` message
//! and every error variant (each `AppError` maps 1:1 onto its `BridgeError`
//! twin). Global-DB reads go through [`BridgeCtx::lock_global`]; store-scoped
//! reads keep the ORIGINAL split between `resolve_store` and
//! `db_manager.open_store` — the two are not interchangeable and each call site
//! kept whichever it had. `DEVICE_BINDING_KEYRING_NAME` stays a terminals-module
//! literal; the copy in `workspaces.rs` is a deliberate duplicate and is not
//! unified here.

use serde::{Deserialize, Serialize};

use hmac::{Hmac, Mac};
use sha2::Sha256;

use oz_core::{Store, Terminal, TerminalFeatureOverride, TerminalProfile};

use foundation::validate_not_empty;

use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
type HmacSha256 = Hmac<Sha256>;

/// Keyring name for the device binding HMAC secret.
pub const DEVICE_BINDING_KEYRING_NAME: &str = "oz-pos/device-binding-hmac-key";

/// Compute an HMAC-SHA256 signature for a device binding.
///
/// The signature covers `{terminal_id}:{bound_store_id}:{bound_instance_id}`
/// using a secret stored in the OS keyring. If no secret exists yet, one is
/// generated and stored.
fn sign_binding(
    keyring: &dyn oz_security::Keyring,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
) -> Result<String, BridgeError> {
    let secret = keyring
        .get_secret(DEVICE_BINDING_KEYRING_NAME)
        .map_err(|e| BridgeError::Internal(format!("keyring read failed: {e}")))?;

    let secret = match secret {
        Some(s) => s,
        None => {
            let new_secret = uuid::Uuid::now_v7().to_string();
            keyring
                .set_secret(DEVICE_BINDING_KEYRING_NAME, &new_secret)
                .map_err(|e| BridgeError::Internal(format!("keyring write failed: {e}")))?;
            new_secret
        }
    };

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| BridgeError::Internal(format!("HMAC init failed: {e}")))?;
    mac.update(terminal_id.as_bytes());
    mac.update(b":");
    mac.update(store_id.as_bytes());
    mac.update(b":");
    mac.update(instance_id.as_bytes());

    let result = mac.finalize();
    Ok(hex::encode(result.into_bytes()))
}

/// Verify a device binding HMAC signature.
fn verify_binding(
    keyring: &dyn oz_security::Keyring,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
    signature: &str,
) -> Result<bool, BridgeError> {
    let expected = sign_binding(keyring, terminal_id, store_id, instance_id)?;
    Ok(expected == signature)
}

// ── DTOs ──────────────────────────────────────────────────────────────

/// Terminal DTO for the front-end.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// ID of the associated device.
    pub device_id: String,
    /// Whether this is active.
    pub is_active: bool,
    /// Last Seen At.
    pub last_seen_at: Option<String>,
    /// Metadata.
    pub metadata: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<Terminal> for TerminalDto {
    fn from(t: Terminal) -> Self {
        Self {
            id: t.id,
            name: t.name,
            device_id: t.device_id,
            is_active: t.is_active,
            last_seen_at: t.last_seen_at,
            metadata: t.metadata,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

/// Arguments for registering a new terminal.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTerminalArgs {
    /// Display name.
    pub name: String,
    /// ID of the associated device.
    pub device_id: String,
    /// Terminal Secret.
    pub terminal_secret: Option<String>,
    /// Metadata.
    pub metadata: Option<String>,
}

/// Result of registering a new terminal.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTerminalResult {
    /// Unique identifier.
    pub id: String,
}

/// Arguments for updating a terminal.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTerminalArgs {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: Option<String>,
    /// ID of the associated device.
    pub device_id: Option<String>,
    /// Terminal Secret.
    pub terminal_secret: Option<String>,
    /// Whether this is active.
    pub is_active: Option<bool>,
    /// Metadata.
    pub metadata: Option<String>,
}

/// Result of updating a terminal.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTerminalResult {
    /// Unique identifier.
    pub id: String,
}

// ── Read Commands ────────────────────────────────────────────────────

/// List terminals from the store resolved from a session token. ADR #7.
pub async fn list_terminals_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<TerminalDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let result = run_list_terminals(&db);
    drop(db);
    result
}

/// List every terminal held by `conn` as DTOs — the read half of
/// [`list_terminals_scoped`].
pub fn run_list_terminals(conn: &rusqlite::Connection) -> Result<Vec<TerminalDto>, BridgeError> {
    let store = Store::new(conn);
    let terminals = store.list_terminals()?;
    let dtos: Vec<TerminalDto> = terminals.into_iter().map(TerminalDto::from).collect();
    Ok(dtos)
}

/// Get a terminal from the store resolved from a session token. ADR #7.
pub async fn get_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<Option<TerminalDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    validate_not_empty("id", &id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let terminal = store.get_terminal(&id)?;
    drop(db);

    Ok(terminal.map(TerminalDto::from))
}

/// Ping a terminal in the store resolved from a session token. ADR #7.
pub async fn ping_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    validate_not_empty("id", &id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.ping_terminal(&id)?;
    drop(db);

    tracing::debug!(id, "terminal pinged (scoped)");
    Ok(())
}

/// List terminal overrides from the store resolved from a session token. ADR #7.
pub async fn list_terminal_overrides_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
) -> Result<Vec<TerminalFeatureOverride>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let overrides = store.list_terminal_overrides(&terminal_id)?;
    drop(db);

    Ok(overrides)
}

/// List terminal profiles from the store resolved from a session token. ADR #7.
pub async fn list_terminal_profiles_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<TerminalProfileDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let profiles = store.list_terminal_profiles()?;
    drop(db);
    Ok(profiles.into_iter().map(TerminalProfileDto::from).collect())
}

/// Get a terminal profile from the store resolved from a session token. ADR #7.
pub async fn get_terminal_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
) -> Result<Option<TerminalProfileDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let profile = store.get_terminal_profile(&terminal_id)?;
    drop(db);

    Ok(profile.map(TerminalProfileDto::from))
}

/// Get device binding from the store resolved from a session token. ADR #7.
pub async fn get_device_binding_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
) -> Result<DeviceBindingDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::TERMINALS_READ)
        .await?;
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let binding = store.get_terminal_binding(&terminal_id)?;
    drop(db);

    build_device_binding_dto(&terminal_id, binding)
}

fn build_device_binding_dto(
    terminal_id: &str,
    binding: Option<(String, String, String)>,
) -> Result<DeviceBindingDto, BridgeError> {
    match binding {
        None => Ok(DeviceBindingDto {
            bounded: false,
            bound_store_id: None,
            bound_instance_id: None,
            signature_valid: false,
        }),
        Some((store_id, instance_id, signature)) => {
            let keyring = oz_security::default_keyring()
                .map_err(|e| BridgeError::Internal(format!("keyring unavailable: {e}")))?;
            let valid = verify_binding(
                keyring.as_ref(),
                terminal_id,
                &store_id,
                &instance_id,
                &signature,
            )
            .unwrap_or(false);

            Ok(DeviceBindingDto {
                bounded: true,
                bound_store_id: Some(store_id),
                bound_instance_id: Some(instance_id),
                signature_valid: valid,
            })
        }
    }
}

// ── Write Commands ───────────────────────────────────────────────────

/// Register a new terminal.
///
/// **Deprecated for multi-store (ADR #7):** Use `register_terminal_scoped`.
pub async fn register_terminal(
    ctx: &BridgeCtx<'_>,
    user_id: String,
    args: RegisterTerminalArgs,
) -> Result<RegisterTerminalResult, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("device_id", &args.device_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let mut terminal = Terminal::new(args.name, args.device_id);
    if let Some(secret) = args.terminal_secret {
        terminal = terminal.with_secret(secret);
    }
    if let Some(meta) = args.metadata {
        terminal = terminal.with_metadata(meta);
    }

    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    ctx.require_permission_for_user(&store, &user_id, oz_core::permissions::TERMINALS_REGISTER)?;
    store.create_terminal(&terminal)?;
    drop(db);

    // Multi-terminal: multiple terminals may be registered to the same store_id.
    // Each terminal gets a unique `id` (UUID) and is identified by its `device_id`
    // (hostname). At startup, AppState looks up the terminal by device_id to set
    // the session's `terminal_id`. Binding to a store is a separate step.
    tracing::info!(id = %terminal.id, name = %terminal.name, "terminal registered");
    Ok(RegisterTerminalResult { id: terminal.id })
}

/// Register a terminal in the store resolved from a session token. ADR #7.
pub async fn register_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: RegisterTerminalArgs,
) -> Result<RegisterTerminalResult, BridgeError> {
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("device_id", &args.device_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_REGISTER)
        .await?;

    let sub = {
        let global_db = ctx.lock_global().await;
        oz_core::TenantSubscription::validate_clock_rollback(&global_db)?;
        oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let mut terminal = Terminal::new(args.name, args.device_id);
    if let Some(secret) = args.terminal_secret {
        terminal = terminal.with_secret(secret);
    }
    if let Some(meta) = args.metadata {
        terminal = terminal.with_metadata(meta);
    }

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.enforce_terminal_quota(
        &Entitlements::from_subscription(&sub, UsageCounts::default()).tier,
    )?;
    store.create_terminal(&terminal)?;
    drop(db);

    tracing::info!(id = %terminal.id, name = %terminal.name, "terminal registered (scoped)");
    Ok(RegisterTerminalResult { id: terminal.id })
}

/// Update a terminal in the store resolved from a session token. ADR #7.
pub async fn update_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: UpdateTerminalArgs,
) -> Result<UpdateTerminalResult, BridgeError> {
    validate_not_empty("id", &args.id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let mut terminal = store
        .get_terminal(&args.id)?
        .ok_or_else(|| BridgeError::Invalid(format!("terminal '{}' not found", args.id)))?;

    if let Some(name) = args.name {
        validate_not_empty("name", &name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
        terminal.name = name;
    }
    if let Some(device_id) = args.device_id {
        validate_not_empty("device_id", &device_id)
            .map_err(|e| BridgeError::Invalid(e.to_string()))?;
        terminal.device_id = device_id;
    }
    if let Some(secret) = args.terminal_secret {
        terminal.terminal_secret = Some(secret);
    }
    if let Some(active) = args.is_active {
        terminal.is_active = active;
    }
    if let Some(meta) = args.metadata {
        terminal.metadata = Some(meta);
    }

    store.update_terminal(&terminal)?;
    drop(db);

    tracing::info!(id = %terminal.id, "terminal updated (scoped)");
    Ok(UpdateTerminalResult { id: terminal.id })
}

/// Delete a terminal in the store resolved from a session token. ADR #7.
pub async fn delete_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    validate_not_empty("id", &id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_DELETE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_terminal(&id)?;
    drop(db);

    tracing::info!(id, "terminal deleted (scoped)");
    Ok(())
}

/// Set a terminal override in the store resolved from a session token. ADR #7.
pub async fn set_terminal_override_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
    feature: String,
    enabled: bool,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("feature", &feature).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.set_terminal_override(&terminal_id, &feature, enabled)?;
    drop(db);

    tracing::info!(
        terminal_id,
        feature,
        enabled,
        "terminal feature override set (scoped)"
    );
    Ok(())
}

/// Delete a terminal override in the store resolved from a session token. ADR #7.
pub async fn delete_terminal_override_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
    feature: String,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("feature", &feature).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_terminal_override(&terminal_id, &feature)?;
    drop(db);

    tracing::info!(
        terminal_id,
        feature,
        "terminal feature override deleted (scoped)"
    );
    Ok(())
}

// ── Terminal Profile Commands ──────────────────────────────────────

/// Terminal profile DTO for the front-end.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfileDto {
    /// ID of the associated terminal.
    pub terminal_id: String,
    /// Profile Type.
    pub profile_type: String,
    /// Locked Screen.
    pub locked_screen: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<TerminalProfile> for TerminalProfileDto {
    fn from(p: TerminalProfile) -> Self {
        Self {
            terminal_id: p.terminal_id,
            profile_type: p.profile_type,
            locked_screen: p.locked_screen,
            updated_at: p.updated_at,
        }
    }
}

/// Arguments for `set_terminal_profile`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTerminalProfileArgs {
    /// ID of the associated terminal.
    pub terminal_id: String,
    /// Profile Type.
    pub profile_type: String,
    /// Locked Screen.
    pub locked_screen: Option<String>,
}

/// Set a terminal profile in the store resolved from a session token. ADR #7.
pub async fn set_terminal_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetTerminalProfileArgs,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &args.terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("profile_type", &args.profile_type)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.set_terminal_profile(
        &args.terminal_id,
        &args.profile_type,
        args.locked_screen.as_deref(),
    )?;
    drop(db);

    tracing::info!(
        terminal_id = %args.terminal_id,
        profile_type = %args.profile_type,
        "terminal profile set (scoped)"
    );
    Ok(())
}

/// Delete a terminal profile in the store resolved from a session token. ADR #7.
pub async fn delete_terminal_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_terminal_profile(&terminal_id)?;
    drop(db);

    tracing::info!(terminal_id, "terminal profile deleted (scoped)");
    Ok(())
}

// ── Device Binding Commands ────────────────────────────────────────

/// Arguments for setting a device binding.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDeviceBindingArgs {
    /// ID of the associated terminal.
    pub terminal_id: String,
    /// ID of the associated bound store.
    pub bound_store_id: String,
    /// ID of the associated bound instance.
    pub bound_instance_id: String,
}

/// Set a device binding in the store resolved from a session token. ADR #7.
pub async fn set_device_binding_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetDeviceBindingArgs,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &args.terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("bound_store_id", &args.bound_store_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("bound_instance_id", &args.bound_instance_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;

    let signature = {
        let keyring = oz_security::default_keyring()
            .map_err(|e| BridgeError::Internal(format!("keyring unavailable: {e}")))?;
        sign_binding(
            keyring.as_ref(),
            &args.terminal_id,
            &args.bound_store_id,
            &args.bound_instance_id,
        )?
    };

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.update_terminal_binding(
        &args.terminal_id,
        &args.bound_store_id,
        &args.bound_instance_id,
        &signature,
    )?;
    drop(db);

    tracing::info!(
        terminal_id = %args.terminal_id,
        store_id = %args.bound_store_id,
        instance_id = %args.bound_instance_id,
        "device binding set (scoped)"
    );
    Ok(())
}

/// DTO for device binding info.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceBindingDto {
    /// Bounded.
    pub bounded: bool,
    /// ID of the associated bound store.
    pub bound_store_id: Option<String>,
    /// ID of the associated bound instance.
    pub bound_instance_id: Option<String>,
    /// Signature Valid.
    pub signature_valid: bool,
}

/// Clear a device binding in the store resolved from a session token. ADR #7.
pub async fn clear_device_binding_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: String,
) -> Result<(), BridgeError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::TERMINALS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.clear_terminal_binding(&terminal_id)?;
    drop(db);

    tracing::info!(terminal_id, "device binding cleared (scoped)");
    Ok(())
}
