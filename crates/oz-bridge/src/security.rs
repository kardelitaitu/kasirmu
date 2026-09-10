//! Security command bodies (Wave B / B3) — the tauri-free half of
//! `apps/desktop-client/src/commands/security.rs`.
//!
//! Key functions: the thread-isolated keyring pipeline ([`with_keyring`],
//! kept on `std::thread::spawn` so the platform Secret Service backends'
//! private runtimes are never nested inside an async runtime), the two
//! context-free command bodies ([`get_key_rotation_info`],
//! [`rotate_encryption_key`] — they take no state and no session, exactly as
//! the shell defined them), the pure status/rotation steps, and the
//! session-scoped variants, each consuming a [`BridgeCtx`] for the F-017
//! `security:manage` gate.
//!
//! Gate order and error paths are verbatim ports of the command bodies.
//! Keyring failures land on [`BridgeError::Internal`] because the shell's
//! `From<SecurityError> for AppError` produces exactly that variant and text,
//! so the shim's variant-for-variant remap keeps the wire shape unchanged.

use serde::Serialize;

use oz_core::permissions;
use oz_security::Keyring;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Key name used for the primary encryption key in the OS keyring.
pub const ENCRYPTION_KEY_NAME: &str = "oz-pos/encryption-key";

/// Response for the key rotation status query.
#[derive(Debug, Serialize)]
pub struct KeyRotationStatus {
    /// Whether a key has been created/rotated at least once.
    pub has_key: bool,
    /// ISO 8601 timestamp of when the current key was created.
    /// `None` if no key exists or timestamp is missing.
    pub created_at: Option<String>,
    /// Number of days since the key was created.
    /// `None` if the key age is unknown.
    pub age_days: Option<i64>,
}

/// Map a keyring failure to the wire shape the shell produced.
///
/// The desktop shell's `From<SecurityError> for AppError` lands on
/// `AppError::Internal(e.to_string())`; this local mirror keeps the exact
/// same variant and message text across the shim's remap.
fn keyring_error(e: oz_security::SecurityError) -> BridgeError {
    BridgeError::Internal(e.to_string())
}

/// Build the platform default keyring with the shell's error text.
fn default_keyring() -> Result<Box<dyn Keyring>, BridgeError> {
    oz_security::default_keyring()
        .map_err(|e| BridgeError::Internal(format!("keyring unavailable: {e}")))
}

/// Run a keyring operation outside the Tokio runtime context.
///
/// The Linux Secret Service implementation owns a private Tokio runtime and
/// calls `block_on` for its synchronous [`Keyring`] methods. Running the
/// complete operation on a dedicated OS thread prevents that private runtime
/// from being nested inside Tauri's runtime (including `spawn_blocking`, whose
/// threads still belong to the Tokio runtime).
///
/// `E` stays generic so the shell's `AppError`-typed test adapter and the
/// bridge's own `BridgeError` bodies share one implementation
/// (`AppError: From<BridgeError>` via the authz seam).
///
/// # Errors
///
/// Returns the caller's error type: the mapped `create`/`operation` failure,
/// or the worker-stop error when the one-shot receiver is dropped.
pub async fn with_keyring<T, E, C, F>(create: C, operation: F) -> Result<T, E>
where
    T: Send + 'static,
    E: From<BridgeError> + Send + 'static,
    C: FnOnce() -> Result<Box<dyn Keyring>, E> + Send + 'static,
    F: FnOnce(&dyn Keyring) -> Result<T, E> + Send + 'static,
{
    let (sender, receiver) = tokio::sync::oneshot::channel();

    std::thread::spawn(move || {
        let result = (|| {
            let keyring = create()?;
            operation(keyring.as_ref())
        })();

        // The command may be cancelled while the keyring operation is still
        // running; in that case there is no receiver left to notify.
        let _ = sender.send(result);
    });

    receiver.await.map_err(|_| {
        E::from(BridgeError::Internal(
            "keyring worker stopped unexpectedly".into(),
        ))
    })?
}

/// Read the rotation status off an open keyring (pure, synchronous).
///
/// # Errors
///
/// Returns the keyring failure mapped through the shell's wire shape.
pub fn key_rotation_status(keyring: &dyn Keyring) -> Result<KeyRotationStatus, BridgeError> {
    let created_at: Option<String> = keyring
        .key_created_at(ENCRYPTION_KEY_NAME)
        .map_err(keyring_error)?;

    let age_days = created_at.as_ref().and_then(|ts| {
        let created = chrono::DateTime::parse_from_rfc3339(ts).ok()?;
        let now = chrono::Utc::now();
        let duration = now.signed_duration_since(created);
        Some(duration.num_days())
    });

    Ok(KeyRotationStatus {
        has_key: keyring
            .get_secret(ENCRYPTION_KEY_NAME)
            .map_err(keyring_error)?
            .is_some(),
        created_at,
        age_days,
    })
}

/// Rotate the encryption key on an open keyring (pure, synchronous).
fn rotate_key(keyring: &dyn Keyring) -> Result<oz_security::RotationInfo, BridgeError> {
    let info = keyring
        .rotate_key(ENCRYPTION_KEY_NAME)
        .map_err(keyring_error)?;

    tracing::info!(
        key_name = %info.key_name,
        created_at = %info.created_at,
        "encryption key rotated successfully"
    );

    Ok(info)
}

/// Get the current key rotation status (key age, creation timestamp).
///
/// Returns the status without exposing the key material itself. Takes no
/// context: the shell command was session-free by design and stays that way.
pub async fn get_key_rotation_info() -> Result<KeyRotationStatus, BridgeError> {
    with_keyring(default_keyring, key_rotation_status).await
}

/// Rotate (re-generate) the encryption key.
///
/// Generates a new random 256-bit AES key, archives the previous key,
/// and stores the creation timestamp. Returns the
/// [`oz_security::RotationInfo`] with the new key's metadata. Takes no
/// context, exactly as the shell command.
pub async fn rotate_encryption_key() -> Result<oz_security::RotationInfo, BridgeError> {
    with_keyring(default_keyring, rotate_key).await
}

/// Session-scoped variant of [`get_key_rotation_info`].
///
/// Gate order mirrors the command body: resolve the session, then enforce
/// `security:manage` scope-aware against the global identity DB.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token and
/// [`BridgeError::PermissionDenied`] without `security:manage`.
pub async fn get_key_rotation_info_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<KeyRotationStatus, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // F-017: key age/state is crypto-compliance data — explicit permission.
    ctx.require_session_permission(&session, permissions::SECURITY_MANAGE)
        .await?;
    get_key_rotation_info().await
}

/// Session-scoped variant of [`rotate_encryption_key`].
///
/// Gate order mirrors the command body: resolve the session, then enforce
/// `security:manage` scope-aware against the global identity DB.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token and
/// [`BridgeError::PermissionDenied`] without `security:manage`.
pub async fn rotate_encryption_key_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<oz_security::RotationInfo, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // F-017: rotating the at-rest key invalidates every archived key —
    // crypto administration — sensitive key, explicit permission.
    ctx.require_session_permission(&session, permissions::SECURITY_MANAGE)
        .await?;
    rotate_encryption_key().await
}
