//! Workspace listing and boot-resolution commands for the tablet client.
//!
//! Parity with the desktop client (audit-open-findings residual): the pre-session
//! workspace picker (`list_workspaces` / `list_workspace_screens`) only
//! accepts the short-lived picker ticket minted by `staff_login` and
//! resolves the caller's REAL user + role from the global identity
//! database — caller-supplied `role_id` / `user_id` are never trusted.

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tauri::State;

use oz_core::db::Store;
use oz_core::db::workspaces::WorkspaceDto;
use platform_core::StoreDatabaseManager;

use crate::commands::terminals::DEVICE_BINDING_KEYRING_NAME;
use crate::error::AppError;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

// ADR #49: `WorkspaceScreenDto` is the bridge's, re-exported rather than
// restated. The two definitions were byte-identical — same two fields, same doc
// comments, and **no `rename_all` on either**, so the wire stays snake_case and
// the renderer sees no change at all. Keeping a second copy here is the
// duplication ADR #49 exists to end.
pub use oz_bridge::workspaces::WorkspaceScreenDto;

/// List workspace instances for the pre-session workspace picker.
///
/// Parity with the desktop client: the caller presents the short-lived
/// picker ticket minted by `staff_login` (audit-open-findings residual); the REAL
/// user is resolved from the global identity database and the REAL role
/// is used for the listing. The requested store is opened through
/// `StoreDatabaseManager` so this read cannot accidentally query the
/// global identity database or another store's connection.
#[tauri::command]
pub async fn list_workspaces(
    state: State<'_, AppState>,
    ticket: String,
    store_id: String,
) -> Result<Vec<WorkspaceDto>, AppError> {
    // ADR #49: the body is the bridge's, and this delegation is a pure identity.
    // `oz_bridge::workspaces::list_workspaces` verifies the same ticket against
    // `ctx.picker_ticket_secret`, locks the global db through `ctx.lock_global()`
    // (the same `state.db` — see `AppState::bridge_ctx`), opens the store through
    // `ctx.db_manager` and drops the guard in the same order, and carries the
    // same error strings through the `From<BridgeError> for AppError` seam.
    //
    // Ledger-neutral, measured rather than assumed: this door resolves no
    // session (it presents a picker TICKET, which matches none of the sweep's
    // markers), so `run_sweep`'s `gated` leg is false with or without an
    // `oz_bridge::` call, and the ledger's own entry for it —
    // `("workspaces::list_workspaces", "no_session_resolution")` — stays true.
    // The ratchet is green before and after.
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspaces(&ctx, ticket, store_id)
        .await
        .map_err(Into::into)
}

/// List screens (nav items) for a workspace type during boot/workspace
/// selection. The store ID is explicit so the read is routed to the correct
/// store database.
///
/// Parity with the desktop client: the picker ticket (audit-open-findings residual)
/// proves the caller completed a real login before this bootstrap read can
/// touch any store database.
#[tauri::command]
pub async fn list_workspace_screens(
    state: State<'_, AppState>,
    ticket: String,
    type_key: String,
    store_id: String,
) -> Result<Vec<WorkspaceScreenDto>, AppError> {
    // ADR #49: pure identity, as for `list_workspaces` — the bridge verifies the
    // same ticket against `ctx.picker_ticket_secret`, opens the store through
    // `ctx.db_manager` and drops the guard in the same order, and returns the
    // same `WorkspaceScreenDto` (now the re-export above, so the wire is
    // unchanged). Ledger-neutral for the same measured reason: this door
    // presents a picker ticket and resolves no session, so the sweep's `gated`
    // leg cannot turn true, and the ledger's own entry —
    // `("workspaces::list_workspace_screens", "no_session_resolution")` — holds.
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspace_screens(&ctx, ticket, type_key, store_id)
        .await
        .map_err(Into::into)
}

/// DTO returned by `resolve_boot_store`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootResolution {
    /// Whether this is bound.
    pub is_bound: bool,
    /// ID of the associated store.
    pub store_id: String,
    /// ID of the associated instance.
    pub instance_id: Option<String>,
}

/// Verify a device-binding HMAC signature using constant-time comparison.
///
/// Uses `mac.verify_slice()` which internally uses `subtle::ConstantTimeEq`
/// to prevent timing side-channel attacks (parity with the desktop client).
fn verify_binding_hmac(
    secret: &str,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
    hex_signature: &str,
) -> bool {
    let expected_bytes = match hex::decode(hex_signature) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(terminal_id.as_bytes());
    mac.update(b":");
    mac.update(store_id.as_bytes());
    mac.update(b":");
    mac.update(instance_id.as_bytes());
    mac.verify_slice(&expected_bytes).is_ok()
}

/// Resolve the active store at boot time (before authentication).
///
/// Parity with the desktop client: when the device has a stored binding
/// (terminal row + HMAC signature made with the OS-keyring secret), the
/// tablet auto-boots into that store + instance. A missing/tampered
/// binding, an unknown device, or a bound instance that no longer exists
/// all fall back to the primary store profile — a boot can never fail
/// because of a stale binding.
#[tauri::command]
pub async fn resolve_boot_store(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<BootResolution, AppError> {
    let device_id = device_id
        .filter(|d| !d.is_empty())
        .or_else(|| {
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .ok()
        })
        .unwrap_or_default(); // A keyring failure must never break boot: without a keyring there is
    // no way to verify a binding, so resolution degrades to primary store.
    // The (non-Send) keyring is acquired only after the lock so no `.await`
    // point holds it — Tauri requires command futures to be Send.
    let db = state.db.lock().await;
    // Construct the OS keyring only when a binding may need verifying.
    // On Linux the keyring spawns its own tokio runtime (`Runtime::new`),
    // which panics when called from inside a runtime (e.g. `#[tokio::test]`
    // on CI where HOSTNAME is set); eagerly building it for every boot
    // would also waste a D-Bus connection on the common no-binding path.
    let binding_info = {
        let store = Store::new(&db);
        store
            .get_terminal_by_device_id(&device_id)?
            .and_then(|terminal| {
                let tid = terminal.id;
                store
                    .get_terminal_binding(&tid)
                    .ok()
                    .flatten()
                    .map(|(s, i, sig)| (tid, s, i, sig))
            })
    };
    let keyring = if binding_info.is_some() {
        kasirmu_security::default_keyring().ok()
    } else {
        None
    };
    drop(binding_info);
    let resolution =
        resolve_boot_store_core(&db, &state.db_manager, &device_id, keyring.as_deref())?;
    drop(db);
    Ok(resolution)
}

/// Core boot-resolution logic (extracted for testing).
///
/// `keyring` is `None` when the OS keyring is unavailable or when the
/// caller only wants the primary-store fallback; the binding path is only
/// reachable with a keyring present.
fn resolve_boot_store_core(
    conn: &rusqlite::Connection,
    db_manager: &StoreDatabaseManager,
    device_id: &str,
    keyring: Option<&dyn kasirmu_security::Keyring>,
) -> Result<BootResolution, AppError> {
    let primary_store = |conn: &rusqlite::Connection| -> Result<BootResolution, AppError> {
        let store = Store::new(conn);
        let primary = store
            .get_primary_location()?
            .ok_or_else(|| AppError::Internal("no primary store found".into()))?;
        tracing::info!(
            store_id = %primary.id,
            "tablet boot resolution: primary store"
        );
        Ok(BootResolution {
            is_bound: false,
            store_id: primary.id,
            instance_id: None,
        })
    };

    if device_id.is_empty() {
        return primary_store(conn);
    }
    let Some(keyring) = keyring else {
        return primary_store(conn);
    };

    let binding_info: Option<(String, String, String, String)> = {
        let store = Store::new(conn);
        store
            .get_terminal_by_device_id(device_id)?
            .and_then(|terminal| {
                let tid = terminal.id;
                store
                    .get_terminal_binding(&tid)
                    .ok()
                    .flatten()
                    .map(|(s, i, sig)| (tid, s, i, sig))
            })
    };

    if let Some((terminal_id, bound_store_id, bound_instance_id, signature)) = binding_info {
        let secret = keyring
            .get_secret(DEVICE_BINDING_KEYRING_NAME)
            .map_err(|e| AppError::Internal(format!("keyring read failed: {e}")))?;
        let signature_valid = match secret {
            Some(secret) => verify_binding_hmac(
                &secret,
                &terminal_id,
                &bound_store_id,
                &bound_instance_id,
                &signature,
            ),
            None => false,
        };

        if !signature_valid {
            tracing::warn!(
                terminal_id = %terminal_id,
                bound_store_id = %bound_store_id,
                "tablet device binding HMAC validation failed — falling back to primary store"
            );
        } else {
            let instance_exists = {
                db_manager
                    .open_store(&bound_store_id)
                    .ok()
                    .and_then(|db_arc| {
                        let db = db_arc.lock().ok()?;
                        let store = Store::new(&db);
                        store
                            .get_workspace_instance(&bound_instance_id, None)
                            .ok()
                            .map(|_| true)
                    })
                    .unwrap_or(false)
            };

            if !instance_exists {
                tracing::warn!(
                    terminal_id = %terminal_id,
                    bound_store_id = %bound_store_id,
                    bound_instance_id = %bound_instance_id,
                    "tablet bound instance not found or not active — falling back to primary store"
                );
            } else {
                tracing::info!(
                    terminal_id = %terminal_id,
                    store_id = %bound_store_id,
                    instance_id = %bound_instance_id,
                    "tablet device binding resolved — auto-booting into bound workspace"
                );
                return Ok(BootResolution {
                    is_bound: true,
                    store_id: bound_store_id,
                    instance_id: Some(bound_instance_id),
                });
            }
        }
    }

    primary_store(conn)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;
