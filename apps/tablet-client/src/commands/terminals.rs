//! Terminal management Tauri commands.
//!
//! CRUD operations for registered POS terminals. Each POS device
//! registers itself with a unique name and device identifier.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{State, command};

use oz_core::{Store, Terminal, TerminalFeatureOverride};

use foundation::validate_not_empty;

use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::error::AppError;
use crate::state::AppState;
use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;
use oz_core::permissions;

type HmacSha256 = Hmac<Sha256>;

/// Keyring name for the device binding HMAC secret (parity with the
/// desktop client's `DEVICE_BINDING_KEYRING_NAME`).
pub const DEVICE_BINDING_KEYRING_NAME: &str = "oz-pos/device-binding-hmac-key";

/// Compute an HMAC-SHA256 signature for a device binding.
///
/// The signature covers `{terminal_id}:{bound_store_id}:{bound_instance_id}`
/// using a secret stored in the OS keyring. If no secret exists yet, one is
/// generated and stored. Parity with the desktop client's `sign_binding`.
fn sign_binding(
    keyring: &dyn kasirmu_security::Keyring,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
) -> Result<String, AppError> {
    let secret = keyring
        .get_secret(DEVICE_BINDING_KEYRING_NAME)
        .map_err(|e| AppError::Internal(format!("keyring read failed: {e}")))?;

    let secret = match secret {
        Some(s) => s,
        None => {
            let new_secret = uuid::Uuid::now_v7().to_string();
            keyring
                .set_secret(DEVICE_BINDING_KEYRING_NAME, &new_secret)
                .map_err(|e| AppError::Internal(format!("keyring write failed: {e}")))?;
            new_secret
        }
    };

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| AppError::Internal(format!("HMAC init failed: {e}")))?;
    mac.update(terminal_id.as_bytes());
    mac.update(b":");
    mac.update(store_id.as_bytes());
    mac.update(b":");
    mac.update(instance_id.as_bytes());

    let result = mac.finalize();
    Ok(hex::encode(result.into_bytes()))
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

// ── Device binding ────────────────────────────────────────────────────
//
// Parity with the desktop client (audit-open-findings residual): a tablet can be
// bound to a store+instance so `resolve_boot_store` auto-boots into it.
// The binding signature is an HMAC-SHA256 over
// `{terminal_id}:{bound_store_id}:{bound_instance_id}` keyed by a secret
// stored in the OS keyring — a tampered binding (DB row edited without the
// keyring secret) fails verification and falls back to the primary store.

/// Arguments for setting a terminal's device binding.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDeviceBindingArgs {
    /// ID of the terminal to bind.
    pub terminal_id: String,
    /// ID of the associated bound store.
    pub bound_store_id: String,
    /// ID of the associated bound instance.
    pub bound_instance_id: String,
}

/// Set a device binding with the caller resolved from a session token.
///
/// ADR #7 variant: the session token binds the caller instead of a
/// client-supplied `user_id`. The binding row still lives in the GLOBAL
/// identity DB where the tablet's `resolve_boot_store` reads it.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn set_device_binding_scoped(
    session_token: String,
    args: SetDeviceBindingArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    // Acquire the (non-Send) keyring only after the lock so no `.await`
    // point holds it — Tauri requires command futures to be Send.
    let keyring = kasirmu_security::default_keyring()
        .map_err(|e| AppError::Internal(format!("keyring unavailable: {e}")))?;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::TERMINALS_EDIT,
    )?;
    run_set_device_binding(&db, keyring.as_ref(), &args)?;
    drop(db);

    tracing::info!(
        terminal_id = %args.terminal_id,
        store_id = %args.bound_store_id,
        instance_id = %args.bound_instance_id,
        "device binding set (tablet, scoped)"
    );
    Ok(())
}

/// Shared binding write behind `set_device_binding_scoped` (extracted for testing). The unscoped
/// `set_device_binding` this used to serve was retired on 2026-09-16 (T7-4): it took a
/// caller-named `user_id`, was registered in neither shell, and no production UI code named it.
fn run_set_device_binding(
    conn: &rusqlite::Connection,
    keyring: &dyn kasirmu_security::Keyring,
    args: &SetDeviceBindingArgs,
) -> Result<(), AppError> {
    validate_not_empty("terminal_id", &args.terminal_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("bound_store_id", &args.bound_store_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("bound_instance_id", &args.bound_instance_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    let signature = sign_binding(
        keyring,
        &args.terminal_id,
        &args.bound_store_id,
        &args.bound_instance_id,
    )?;

    let store = Store::new(conn);
    store.update_terminal_binding(
        &args.terminal_id,
        &args.bound_store_id,
        &args.bound_instance_id,
        &signature,
    )?;
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────

fn run_list_terminals(conn: &rusqlite::Connection) -> Result<Vec<TerminalDto>, AppError> {
    let store = Store::new(conn);
    let terminals = store.list_terminals()?;
    let dtos: Vec<TerminalDto> = terminals.into_iter().map(TerminalDto::from).collect();
    Ok(dtos)
}

/// List all registered terminals resolved from a session token. ADR #7.
///
/// F-017 parity: the gate now matches `oz_bridge::terminals::list_terminals_scoped`,
/// which this shell's command mirrors. The tablet's copy of this surface never
/// picked the per-domain check up, so any authenticated session on a tablet —
/// including a cashier with no terminals role — could enumerate every terminal
/// in the store with its device id and metadata. It sat on this shell's own
/// registration ledger the whole time.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_terminals_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // Checked before the store connection is locked: no await inside that lock.
    require_permission_for_session(&state, &session, permissions::TERMINALS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_list_terminals(&db)
}

/// Get a single terminal by id resolved from a session token. ADR #7.
///
/// F-017 parity, as for `list_terminals_scoped`. The bridge validates the id
/// after the gate; this shell has always validated first, which differs only in
/// which error a caller with both a bad id and no permission sees.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<TerminalDto>, AppError> {
    validate_not_empty("id", &id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::TERMINALS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let terminal = store.get_terminal(&id)?;
    drop(db);

    Ok(terminal.map(TerminalDto::from))
}

/// Register a new terminal resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn register_terminal_scoped(
    session_token: String,
    args: RegisterTerminalArgs,
    state: State<'_, AppState>,
) -> Result<RegisterTerminalResult, AppError> {
    validate_not_empty("name", &args.name).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("device_id", &args.device_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    let mut terminal = Terminal::new(args.name, args.device_id);
    if let Some(secret) = args.terminal_secret {
        terminal = terminal.with_secret(secret);
    }
    if let Some(meta) = args.metadata {
        terminal = terminal.with_metadata(meta);
    }

    let sub = {
        let global_db = state.db.lock().await;
        oz_core::TenantSubscription::validate_clock_rollback(&global_db)?;
        oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::register_terminal_scoped`, and
    // the settings T4-1 fix in shape: this command used to take
    // `user_id: String` and check `require_permission_for_user(&store, &user_id,
    // …)`. The shared wrapper (`ui/src/api/terminals.ts:55`) sends only
    // `{ sessionToken, args }`, so Tauri rejected the call before the body ran —
    // "missing required key user_id" — and the actor the caller could name was
    // anyway a forgeable input. The session now supplies both.
    require_permission_for_session(&state, &session, permissions::TERMINALS_REGISTER).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.enforce_terminal_quota(
        &Entitlements::from_subscription(&sub, UsageCounts::default()).tier,
    )?;
    store.create_terminal(&terminal)?;
    drop(db);

    tracing::info!(id = %terminal.id, name = %terminal.name, "terminal registered");
    Ok(RegisterTerminalResult { id: terminal.id })
}

/// Update an existing terminal resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_terminal_scoped(
    session_token: String,
    args: UpdateTerminalArgs,
    state: State<'_, AppState>,
) -> Result<UpdateTerminalResult, AppError> {
    validate_not_empty("id", &args.id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::update_terminal_scoped`, and the
    // T4-1 shape again: `user_id: String` was a required argument the wrapper at
    // `ui/src/api/terminals.ts:63` never sends, so the call was rejected before
    // its body ran. Gating on the session also moves the check ahead of the
    // store lock, which is why a not-found id now reports the permission result
    // first when the caller lacks `terminals:edit`.
    require_permission_for_session(&state, &session, permissions::TERMINALS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);

    let mut terminal = store
        .get_terminal(&args.id)?
        .ok_or_else(|| AppError::Invalid(format!("terminal '{}' not found", args.id)))?;

    if let Some(name) = args.name {
        validate_not_empty("name", &name).map_err(|e| AppError::Invalid(e.to_string()))?;
        terminal.name = name;
    }
    if let Some(device_id) = args.device_id {
        validate_not_empty("device_id", &device_id)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
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

    tracing::info!(id = %terminal.id, "terminal updated");
    Ok(UpdateTerminalResult { id: terminal.id })
}

/// Update a terminal's last_seen_at timestamp (heartbeat) resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn ping_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("id", &id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::ping_terminal_scoped`: a ping
    // touches the device, so it is gated at the read tier the bridge chose.
    require_permission_for_session(&state, &session, permissions::TERMINALS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.ping_terminal(&id)?;
    drop(db);

    tracing::debug!(id, "terminal pinged");
    Ok(())
}

/// Delete a terminal by id resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("id", &id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::delete_terminal_scoped`. This is
    // the most destructive command on the surface, and it carried both halves of
    // the settings T4-1 defect at once: `user_id: String` was required while
    // `ui/src/api/terminals.ts:79` sends only `{ sessionToken, id }`, so the
    // delete never reached its body on a tablet; and the actor whose permission
    // was checked was whichever user id the caller chose to name.
    require_permission_for_session(&state, &session, permissions::TERMINALS_DELETE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_terminal(&id)?;
    drop(db);

    tracing::info!(id, "terminal deleted");
    Ok(())
}

/// List all feature overrides for a terminal resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_terminal_overrides_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalFeatureOverride>, AppError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::list_terminal_overrides_scoped`.
    require_permission_for_session(&state, &session, permissions::TERMINALS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let overrides = store.list_terminal_overrides(&terminal_id)?;
    drop(db);

    Ok(overrides)
}

/// Set (upsert) a feature override for a terminal resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn set_terminal_override_scoped(
    session_token: String,
    terminal_id: String,
    feature: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("feature", &feature).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::set_terminal_override_scoped`;
    // `ui/src/api/terminals.ts` sends `{ sessionToken, terminalId, feature,
    // enabled }`, so the dropped `user_id` was never supplied and the write was
    // rejected before it ran.
    require_permission_for_session(&state, &session, permissions::TERMINALS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.set_terminal_override(&terminal_id, &feature, enabled)?;
    drop(db);

    tracing::info!(
        terminal_id,
        feature,
        enabled,
        "terminal feature override set"
    );
    Ok(())
}

/// Delete a single feature override for a terminal resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_terminal_override_scoped(
    session_token: String,
    terminal_id: String,
    feature: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("terminal_id", &terminal_id)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("feature", &feature).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017 parity with `oz_bridge::terminals::delete_terminal_override_scoped`.
    require_permission_for_session(&state, &session, permissions::TERMINALS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_terminal_override(&terminal_id, &feature)?;
    drop(db);

    tracing::info!(terminal_id, feature, "terminal feature override deleted");
    Ok(())
}

#[cfg(test)]
#[path = "terminals_tests.rs"]
mod tests;
