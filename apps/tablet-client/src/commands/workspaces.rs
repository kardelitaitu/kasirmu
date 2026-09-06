//! Workspace listing and boot-resolution commands for the tablet client.
//!
//! Parity with the desktop client (audit-open-findings residual): the pre-session
//! workspace picker (`list_workspaces` / `list_workspace_screens`) only
//! accepts the short-lived picker ticket minted by `staff_login` and
//! resolves the caller's REAL user + role from the global identity
//! database — caller-supplied `role_id` / `user_id` are never trusted.

use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tauri::State;

use oz_core::db::Store;
use oz_core::db::workspaces::WorkspaceDto;
use platform_core::StoreDatabaseManager;

use crate::commands::picker_ticket;
use crate::commands::terminals::DEVICE_BINDING_KEYRING_NAME;
use crate::error::AppError;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Screen within a workspace as seen by the front-end.
#[derive(Debug, Serialize)]
pub struct WorkspaceScreenDto {
    /// Screen Key.
    pub screen_key: String,
    /// Display sort order.
    pub sort_order: i32,
}

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
    // 1. Verify the ticket — uniform denial for forged/expired/malformed.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let user_id = picker_ticket::verify_picker_ticket(&state.picker_ticket_secret, &ticket, now_ts)
        .ok_or_else(|| AppError::PermissionDenied("invalid or expired picker session".into()))?;

    // 2. Resolve the REAL user + role + assignment from the global identity
    //    DB. The ticket binds the user; the role is derived from the DB,
    //    never the claim. The assignment (ADR #35 D5 / spec 0048) is what
    //    constrains a scoped user's picker below — legacy users without an
    //    assignment row are not scope-restricted.
    let (real_role_id, real_user_id, assignment) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let user = store.get_user(&user_id)?.ok_or_else(|| {
            AppError::PermissionDenied("picker session user no longer exists".into())
        })?;
        if !user.is_active {
            return Err(AppError::PermissionDenied(
                "picker session user is inactive".into(),
            ));
        }
        let role = store
            .get_role(&user.role_id)?
            .ok_or_else(|| AppError::Internal(format!("role {} not found", user.role_id)))?;
        let assignment = store.assignment_for_user(&user.id)?;
        (role.id, user.id, assignment)
    };

    // 3. List instances in the requested store using the REAL role + user.
    //    `list_workspaces` applies the owner bypass, `user_location_access`
    //    (multi-store), explicit instance assignment, and role workspace types.
    let conn = state
        .db_manager
        .open_store(&store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspaces(&real_role_id, Some(&real_user_id), &store_id)?;
    drop(db);

    // 4. Scope-filter the listing through the user's assignment (ADR #35 D5
    //    / spec 0048): global assignments and legacy users (no assignment)
    //    pass everything; a scoped assignment keeps only instances whose
    //    store (branch) and workspace type are in scope — fail closed, so an
    //    out-of-scope store or workspace type lists nothing.
    Ok(match assignment {
        Some(assignment) => rows
            .into_iter()
            .filter(|d| assignment.matches_scope(Some(&store_id), Some(&d.type_key)))
            .collect(),
        None => rows,
    })
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
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    picker_ticket::verify_picker_ticket(&state.picker_ticket_secret, &ticket, now_ts)
        .ok_or_else(|| AppError::PermissionDenied("invalid or expired picker session".into()))?;
    let conn = state
        .db_manager
        .open_store(&store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspace_type_screens(&type_key)?;
    drop(db);
    Ok(rows
        .into_iter()
        .map(|r| WorkspaceScreenDto {
            screen_key: r.screen_key,
            sort_order: r.sort_order,
        })
        .collect())
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
        oz_security::default_keyring().ok()
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
    keyring: Option<&dyn oz_security::Keyring>,
) -> Result<BootResolution, AppError> {
    let primary_store = |conn: &rusqlite::Connection| -> Result<BootResolution, AppError> {
        let store = Store::new(conn);
        let primary = store
            .get_primary_store()?
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
