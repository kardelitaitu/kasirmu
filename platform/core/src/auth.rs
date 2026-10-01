//! Authentication primitives — PIN hashing and verification.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice B: auth deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — Argon2id with per-hash salts; malformed hashes AND the sync snapshot placeholder fail closed to Ok(false) (test-pinned, cross-referenced with kasirmu-core SNAPSHOT_PIN_HASH_PLACEHOLDER so imported operators cannot log in without a credential)
next: none | perf: Argon2 default params suit local PIN cadence
*/
//!
//! Uses the `argon2` crate for password hashing with Argon2id.
//! The default configuration provides reasonable security for a
//! local POS terminal PIN while keeping verification fast.

use crate::error::PlatformError;

/// Hash a PIN/password for storage.
///
/// Returns the PHC-formatted hash string (e.g.
/// `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`).
///
/// # Errors
///
/// Returns [`PlatformError::Internal`] if the argon2 library fails.
pub fn hash_pin(pin: &str) -> Result<String, PlatformError> {
    use argon2::{
        Argon2,
        password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
    };

    let salt = SaltString::generate(&mut OsRng);

    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| PlatformError::Internal(format!("argon2 hash failed: {e}")))?;

    Ok(hash.to_string())
}

/// Verify a PIN against a stored PHC-formatted hash.
///
/// Returns `true` if the PIN matches the hash, `false` otherwise.
///
/// Malformed or unrecognized hashes — including the snapshot-import
/// placeholder written by sync recovery — fail closed (`Ok(false)`), so an
/// operator imported without a credential is cleanly rejected at login
/// rather than surfacing an internal error.
pub fn verify_pin(pin: &str, hash: &str) -> Result<bool, PlatformError> {
    use argon2::{
        Argon2,
        password_hash::{PasswordHash, PasswordVerifier},
    };

    // An unparseable hash can never verify a PIN — treat it as a clean
    // mismatch instead of an internal error.
    let Ok(parsed) = PasswordHash::new(hash) else {
        return Ok(false);
    };

    let argon2 = Argon2::default();
    Ok(argon2.verify_password(pin.as_bytes(), &parsed).is_ok())
}

/// Result of a successful staff login.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LoginSession {
    /// The logged-in user's id.
    pub user_id: String,
    /// Display name shown on the UI.
    pub display_name: String,
    /// Role name (e.g. "owner", "manager", "staff").
    pub role_name: String,
    /// Role id.
    pub role_id: String,
    /// Permission keys granted by the user's role, verbatim from the role's
    /// permissions JSON (may include the `"*"` wildcard — see
    /// `crate::rbac::Role::permission_keys`). Carried on the session so
    /// UI gates can mirror the backend registry instead of role-name
    /// strings. `#[serde(default)]` keeps older persisted sessions and
    /// older clients parsing.
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
