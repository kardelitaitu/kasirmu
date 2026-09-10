//! Security commands — key rotation, key age, and related PCI-DSS
//! compliance operations.
//!
//! These commands expose the [`oz_security::Keyring`] trait to the
//! front-end so users can rotate encryption keys and monitor key age
//! from the Settings page.
//!
//! Wave B / B3: the bodies live in the headless `oz_bridge::security`
//! module — including the `std::thread::spawn` keyring isolation, which must
//! never be nested inside an async runtime. The two session-free commands
//! stay context-free (they take no `State` at all, exactly as before); the
//! scoped variants borrow a `BridgeCtx` for the F-017 `security:manage`
//! gate and map `BridgeError` back to `AppError` variant-for-variant. The
//! `AppError`-typed pipeline helpers below are retained for the sibling
//! test module, which drives the thread-isolated path with an in-memory
//! keyring through the same generic the bridge owns.

use oz_security::{Keyring, RotationInfo};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::security::{ENCRYPTION_KEY_NAME, KeyRotationStatus};

// ── Keyring pipeline adapters (test-compat) ────────────────────────────

/// Run a keyring operation outside the Tokio runtime context.
///
/// Thin adapter over `oz_bridge::security::with_keyring`: the name, generic
/// shape and `Result<_, AppError>` semantics are unchanged so the sibling
/// test module keeps exercising the thread-isolated pipeline; the thread
/// isolation itself now lives in the bridge.
#[allow(dead_code)] // retained by the Wave-B B3 extraction contract for sibling tests
async fn with_keyring<T, C, F>(create: C, operation: F) -> Result<T, AppError>
where
    T: Send + 'static,
    C: FnOnce() -> Result<Box<dyn Keyring>, AppError> + Send + 'static,
    F: FnOnce(&dyn Keyring) -> Result<T, AppError> + Send + 'static,
{
    oz_bridge::security::with_keyring(create, operation).await
}

/// Build the key-rotation status from a caller-supplied keyring factory.
///
/// Thin adapter over the bridge pipeline: unchanged name and shape for the
/// sibling test module; the status logic itself lives in
/// `oz_bridge::security::key_rotation_status`.
#[allow(dead_code)] // retained by the Wave-B B3 extraction contract for sibling tests
async fn key_rotation_info_with<C>(create: C) -> Result<KeyRotationStatus, AppError>
where
    C: FnOnce() -> Result<Box<dyn Keyring>, AppError> + Send + 'static,
{
    with_keyring(create, |keyring| {
        oz_bridge::security::key_rotation_status(keyring).map_err(AppError::from)
    })
    .await
}

/// Read the key-rotation status off an open keyring.
///
/// Thin adapter over `oz_bridge::security::key_rotation_status`: unchanged
/// name, parameter list and `Result<_, AppError>` type for the sibling test
/// module.
#[allow(dead_code)] // retained by the Wave-B B3 extraction contract for sibling tests
fn key_rotation_status(keyring: &dyn Keyring) -> Result<KeyRotationStatus, AppError> {
    oz_bridge::security::key_rotation_status(keyring).map_err(AppError::from)
}

// ── Commands ───────────────────────────────────────────────────────────

/// Get the current key rotation status (key age, creation timestamp).
///
/// Returns the status without exposing the key material itself.
#[tauri::command]
pub async fn get_key_rotation_info() -> Result<KeyRotationStatus, AppError> {
    oz_bridge::security::get_key_rotation_info()
        .await
        .map_err(Into::into)
}

/// Rotate (re-generate) the encryption key.
///
/// Generates a new random 256-bit AES key, archives the previous key,
/// and stores the creation timestamp. Returns the [`RotationInfo`] with
/// the new key's metadata.
#[tauri::command]
pub async fn rotate_encryption_key() -> Result<RotationInfo, AppError> {
    oz_bridge::security::rotate_encryption_key()
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_key_rotation_info`].
#[tauri::command]
pub async fn get_key_rotation_info_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<KeyRotationStatus, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::security::get_key_rotation_info_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`rotate_encryption_key`].
#[tauri::command]
pub async fn rotate_encryption_key_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RotationInfo, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::security::rotate_encryption_key_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
