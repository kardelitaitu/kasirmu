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
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_correct_pin() {
        let pin = "1234";
        let hash = hash_pin(pin).unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_pin(pin, &hash).unwrap());
    }

    #[test]
    fn verify_wrong_pin_returns_false() {
        let hash = hash_pin("1234").unwrap();
        assert!(!verify_pin("5678", &hash).unwrap());
    }

    #[test]
    fn verify_empty_pin() {
        let hash = hash_pin("").unwrap();
        assert!(verify_pin("", &hash).unwrap());
        assert!(!verify_pin(" ", &hash).unwrap());
    }

    #[test]
    fn hash_is_deterministic_with_different_salts() {
        let h1 = hash_pin("0000").unwrap();
        let h2 = hash_pin("0000").unwrap();
        assert_ne!(h1, h2);
        assert!(verify_pin("0000", &h1).unwrap());
        assert!(verify_pin("0000", &h2).unwrap());
    }

    #[test]
    fn verify_invalid_hash_format_fails_closed() {
        // Malformed hashes must fail closed (Ok(false)), never an internal error.
        assert!(!verify_pin("1234", "not-a-valid-hash").unwrap());
    }

    #[test]
    fn verify_snapshot_placeholder_hash_fails_closed() {
        // The sync-import placeholder (kasirmu-core SNAPSHOT_PIN_HASH_PLACEHOLDER)
        // must not verify against any PIN and must not surface an internal error.
        assert!(!verify_pin("1234", "!snapshot-no-credential!").unwrap());
        assert!(!verify_pin("", "!snapshot-no-credential!").unwrap());
    }

    #[test]
    fn login_session_serde_roundtrip() {
        let session = LoginSession {
            user_id: "u1".into(),
            display_name: "Alice".into(),
            role_name: "staff".into(),
            role_id: "role-staff".into(),
            permissions: vec!["sales:process".into(), "analytics:view".into()],
        };
        let json = serde_json::to_string(&session).unwrap();
        let back: LoginSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_id, "u1");
        assert_eq!(back.display_name, "Alice");
        assert_eq!(back.role_name, "staff");
        assert_eq!(back.role_id, "role-staff");
        // The granted keys ride the wire verbatim — the UI mirrors the
        // backend registry from them.
        assert_eq!(back.permissions, vec!["sales:process", "analytics:view"]);
    }

    #[test]
    fn login_session_missing_permissions_defaults_empty() {
        // Older payloads (and older clients) have no `permissions` field;
        // serde default keeps them parsing instead of failing the session.
        let json = r##"{"user_id":"u1","display_name":"Alice","role_name":"staff","role_id":"role-staff"}"##;
        let back: LoginSession = serde_json::from_str(json).unwrap();
        assert!(back.permissions.is_empty());
    }

    #[test]
    fn login_session_debug() {
        let session = LoginSession {
            user_id: "u1".into(),
            display_name: "Alice".into(),
            role_name: "manager".into(),
            role_id: "role-manager".into(),
            permissions: vec![],
        };
        let debug = format!("{session:?}");
        assert!(debug.contains("u1"));
        assert!(debug.contains("Alice"));
        assert!(debug.contains("manager"));
    }

    #[test]
    fn login_session_clone_eq() {
        let s1 = LoginSession {
            user_id: "u1".into(),
            display_name: "Bob".into(),
            role_name: "owner".into(),
            role_id: "role-owner".into(),
            permissions: vec!["*".into()],
        };
        let s2 = s1.clone();
        assert_eq!(s1.user_id, s2.user_id);
        assert_eq!(s1.display_name, s2.display_name);
        assert_eq!(s1.role_name, s2.role_name);
        assert_eq!(s1.role_id, s2.role_id);
    }

    #[test]
    fn login_session_json_field_names() {
        let session = LoginSession {
            user_id: "u1".into(),
            display_name: "Alice".into(),
            role_name: "staff".into(),
            role_id: "role-staff".into(),
            permissions: vec!["sales:view".into()],
        };
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(json["user_id"], "u1");
        assert_eq!(json["display_name"], "Alice");
        assert_eq!(json["role_name"], "staff");
        assert_eq!(json["role_id"], "role-staff");
        assert_eq!(json["permissions"], serde_json::json!(["sales:view"]));
    }
}
