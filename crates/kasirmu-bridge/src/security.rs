//! Security command bodies (Wave B / B3) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/security.rs`.
//!
//! Key functions: the thread-isolated keyring pipeline ([`with_keyring`](crate::security::with_keyring),
//! kept on `std::thread::spawn` so the platform Secret Service backends'
//! private runtimes are never nested inside an async runtime), the two
//! context-free command bodies ([`get_key_rotation_info`](crate::security::get_key_rotation_info),
//! [`rotate_encryption_key`](crate::security::rotate_encryption_key) — they take no state and no session, exactly as
//! the shell defined them), the pure status/rotation steps, and the
//! session-scoped variants, each consuming a [`BridgeCtx`](crate::ctx::BridgeCtx) for the F-017
//! `security:manage` gate.
//!
//! Gate order and error paths are verbatim ports of the command bodies.
//! Keyring failures land on [`BridgeError::Internal`](crate::error::BridgeError::Internal) because the shell's
//! `From<SecurityError> for AppError` produces exactly that variant and text,
//! so the shim's variant-for-variant remap keeps the wire shape unchanged.

use serde::Serialize;

use kasirmu_core::permissions;
use kasirmu_security::Keyring;
use kasirmu_security::install_key::InstallKeyResolution;

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
fn keyring_error(e: kasirmu_security::SecurityError) -> BridgeError {
    BridgeError::Internal(e.to_string())
}

/// Build the platform default keyring with the shell's error text.
fn default_keyring() -> Result<Box<dyn Keyring>, BridgeError> {
    kasirmu_security::default_keyring()
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
fn rotate_key(keyring: &dyn Keyring) -> Result<kasirmu_security::RotationInfo, BridgeError> {
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
/// [`kasirmu_security::RotationInfo`] with the new key's metadata. Takes no
/// context, exactly as the shell command.
pub async fn rotate_encryption_key() -> Result<kasirmu_security::RotationInfo, BridgeError> {
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
) -> Result<kasirmu_security::RotationInfo, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // F-017: rotating the at-rest key invalidates every archived key —
    // crypto administration — sensitive key, explicit permission.
    ctx.require_session_permission(&session, permissions::SECURITY_MANAGE)
        .await?;
    rotate_encryption_key().await
}

/// Install the per-install at-rest key for this process (C1 slice S2b-2b).
///
/// Reads the keychain entry `oz-pos/at-rest-key.v1` (or generates it, once, on a
/// durable keyring) and hands the secret to `kasirmu_crypto::set_install_key`, so
/// every at-rest derivation in this process uses it. Call this **before the first
/// credential is decrypted**; see the ordering note below.
///
/// # Synchronous on purpose
///
/// This is a boot-path call and Tauri's `.setup()` closure is synchronous, so
/// there is no async context to await in and none to nest a keyring backend's
/// private runtime inside. It therefore does the same thing
/// [`with_keyring`] does — run the keyring
/// operation on a dedicated OS thread — but by spawning and joining directly
/// rather than through a oneshot channel. Calling `block_on` from the setup
/// closure would be the alternative and is deliberately avoided: it would enter
/// the runtime the Linux Secret Service backend must stay out of.
///
/// # This never fails boot, deliberately
///
/// A missing or unusable keychain is not an error here, because the whole feature
/// is opt-in: with no key installed the six at-rest families derive exactly as
/// they did before the seam existed (hazard H2). Every outcome is reported as a
/// plain [`InstallKeyOutcome`] so the boot path can log it, and none of them is
/// fatal. Making any of them fatal would stop a machine that worked yesterday
/// from starting today.
///
/// # The H3 refusal is why this returns an outcome rather than a bool
///
/// `resolve_install_key` refuses to generate a key on a non-durable keyring (the
/// in-memory fallback, which starts empty every boot). That refusal must be
/// visible and distinct from "the keychain had nothing and we made one", because
/// they mean opposite things to an operator.
///
/// # Ordering rule (do not move this call later)
///
/// The key must be installed **before the first decrypt of a portable credential**,
/// or that read uses the legacy derivation and, on an install that already has
/// keyed rows, returns a decryption failure for data that is intact. Installing it
/// late is therefore worse than not installing it at all. The desktop shell calls
/// this in its `setup` closure ahead of `AppState::new`.
pub fn install_at_rest_key() -> InstallKeyOutcome {
    use kasirmu_security::install_key::InstallKeySource as SecSource;

    // The worker's result type. `InstallKeyOutcome` is not `Send`-constrained by
    // anything but is a plain enum, so it crosses the join boundary fine.
    let worker = std::thread::spawn(
        || -> Result<(InstallKeyResolution, Option<[u8; 32]>), String> {
            let keyring = kasirmu_security::default_keyring().map_err(|e| e.to_string())?;
            resolve_at_rest_keys(keyring.as_ref())
        },
    );

    // A panicked worker must not take the boot path down with it: the whole
    // point of this function is that no keychain outcome is fatal.
    let resolved = match worker.join() {
        Ok(result) => result,
        Err(_) => Err("the keychain worker thread panicked".to_string()),
    };

    let (current, previous) = match resolved {
        Ok(pair) => pair,
        Err(reason) => return InstallKeyOutcome::Unavailable(reason),
    };

    // Install the parked key FIRST, so both slots are populated before any decrypt
    // runs. It is a READ candidate only — `portable_key` never consults it — so a
    // write still always uses the current key.
    if let Some(secret) = previous {
        let installed_now = kasirmu_crypto::set_previous_install_key(secret);
        tracing::warn!(
            installed_now,
            "at-rest key rotation in flight: the outgoing key is parked and installed as a read \
             candidate; rows under it stay readable until `oz rekey` completes and retires it"
        );
    }

    match current {
        InstallKeyResolution::Ready { secret, source } => {
            // `set_install_key` returning false means another boot path already
            // installed this key — the documented non-failure (see its doc).
            let installed_now = kasirmu_crypto::set_install_key(secret);
            InstallKeyOutcome::Ready {
                installed_now,
                source: match source {
                    SecSource::Loaded => InstallKeySource::Loaded,
                    SecSource::Generated => InstallKeySource::Generated,
                    // `InstallKeySource` is `#[non_exhaustive]` upstream, so a new
                    // arm must not break this build. Treat an unknown origin as
                    // `Generated`: that is the arm telling an operator the key did
                    // not pre-exist, which is the more cautious reading.
                    _ => InstallKeySource::Generated,
                },
            }
        }
        InstallKeyResolution::RefusedNonDurableKeyring => {
            InstallKeyOutcome::RefusedNonDurableKeyring
        }
    }
}

/// Resolve BOTH at-rest keys from `keyring`: the current one, and the OUTGOING key
/// parked by an in-flight rotation if there is one (C1 slice S2c).
///
/// Split out from [`install_at_rest_key`] so the resolution is testable without
/// touching the process-global key slots: installing one in the unit-test binary
/// would change the derivation for every sibling case, which is why the crypto
/// crate's own tests drive the injectable cores instead.
///
/// A malformed entry in either slot is an error, not a `None`: the parked key may
/// be the only thing that reads rows the sweep has not reached.
fn resolve_at_rest_keys(
    keyring: &dyn Keyring,
) -> Result<(InstallKeyResolution, Option<[u8; 32]>), String> {
    let current =
        kasirmu_security::install_key::resolve_install_key(keyring).map_err(|e| e.to_string())?;
    let previous = kasirmu_security::install_key::resolve_previous_install_key(keyring)
        .map_err(|e| e.to_string())?;
    Ok((current, previous))
}

/// How [`install_at_rest_key`] resolved, for the caller to log.
///
/// A plain data type rather than a `Result`, because **no arm is a failure the
/// caller should propagate**: each one leaves the process on a well-defined
/// derivation, and the operator-facing decision is what to log, not whether to
/// abort.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallKeyOutcome {
    /// A key is installed. `installed_now` is false when a previous boot path
    /// had already installed it (not an error).
    Ready {
        /// Whether this call performed the install.
        installed_now: bool,
        /// Whether the key was read from the keychain or freshly generated.
        source: InstallKeySource,
    },
    /// No key was generated because the keyring is not durable (hazard H3).
    /// The process stays on the previous derivation.
    RefusedNonDurableKeyring,
    /// The keychain could not be read or written. The process stays on the
    /// previous derivation. Carries the reason for the log, never key material.
    Unavailable(String),
}

/// Whether a per-install at-rest key was loaded or generated.
///
/// Mirrors `kasirmu_security::InstallKeySource` so a caller of this bridge
/// function does not have to import the security crate, and so the mapping is
/// exhaustive here (where the source enum is non-exhaustive upstream).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKeySource {
    /// The keychain already held a usable key.
    Loaded,
    /// No entry existed and a fresh key was generated and stored.
    Generated,
}

#[cfg(test)]
#[path = "security_tests.rs"]
mod tests;
