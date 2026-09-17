use super::*;

#[test]
fn key_unavailable_display() {
    let err = SecurityError::KeyUnavailable("kek-1234".into());
    assert_eq!(err.to_string(), "key unavailable: kek-1234");
}

#[test]
fn decryption_failed_display() {
    let err = SecurityError::DecryptionFailed;
    assert_eq!(
        err.to_string(),
        "decryption failed: ciphertext is corrupt or has been tampered with"
    );
}

#[test]
fn key_generation_failed_display() {
    let err = SecurityError::KeyGenerationFailed("entropy source exhausted".into());
    assert_eq!(
        err.to_string(),
        "key generation failed: entropy source exhausted"
    );
}

#[test]
fn permission_denied_display() {
    let err = SecurityError::PermissionDenied("admin access required".into());
    assert_eq!(err.to_string(), "permission denied: admin access required");
}

#[test]
fn debug_output() {
    let err = SecurityError::KeyUnavailable("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn implements_std_error() {
    let err = SecurityError::DecryptionFailed;
    let _: &dyn std::error::Error = &err;
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<SecurityError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", SecurityError::KeyUnavailable("x".into()));
    let b = format!("{:?}", SecurityError::DecryptionFailed);
    assert_ne!(a, b);
}

// ── Boundary / invariant tests for SecurityError ──────────────────

/// `DecryptionFailed` Display must mention both "decrypt" and
/// "corrupt or tampered" — these keywords are part of the
/// contract that log scrapers and incident-response runbooks
/// search for. Tests that rely on regex like /(decrypt|corrupt|tamper)/
/// depend on this stability.
#[test]
fn decryption_failed_display_contains_security_keywords() {
    let msg = SecurityError::DecryptionFailed.to_string();
    assert!(msg.contains("decryption"), "missing 'decryption': {msg}");
    assert!(msg.contains("corrupt"), "missing 'corrupt': {msg}");
    assert!(msg.contains("tampered"), "missing 'tampered': {msg}");
}

/// `#[non_exhaustive]` on the enum means downstream consumers
/// cannot pattern-match exhaustively outside the crate. Pins
/// the boundary so external callers MUST use a wildcard arm.
/// (Inside the crate, exhaustive match works.)
#[test]
fn internal_exhaustive_match_returns_canonical_labels() {
    let label = |e: &SecurityError| -> &'static str {
        match e {
            SecurityError::KeyUnavailable(_) => "key-unavailable",
            SecurityError::DecryptionFailed => "decryption-failed",
            SecurityError::PermissionDenied(_) => "permission-denied",
            SecurityError::KeyGenerationFailed(_) => "key-generation-failed",
        }
    };
    assert_eq!(
        label(&SecurityError::KeyUnavailable("x".into())),
        "key-unavailable"
    );
    assert_eq!(label(&SecurityError::DecryptionFailed), "decryption-failed");
    assert_eq!(
        label(&SecurityError::PermissionDenied("x".into())),
        "permission-denied"
    );
    assert_eq!(
        label(&SecurityError::KeyGenerationFailed("x".into())),
        "key-generation-failed"
    );
}

/// `std::error::Error::source()` for `SecurityError` must return
/// `None` for every variant — none of them wraps an inner cause.
/// This pins the contract for `anyhow` consumers that walk the
/// `Error::source()` chain.
#[test]
fn error_source_returns_none_for_all_variants() {
    use std::error::Error as _;
    let variants: Vec<SecurityError> = vec![
        SecurityError::KeyUnavailable("k".into()),
        SecurityError::DecryptionFailed,
        SecurityError::PermissionDenied("p".into()),
        SecurityError::KeyGenerationFailed("g".into()),
    ];
    for v in &variants {
        assert!(v.source().is_none(), "source() must be None for {v:?}");
    }
}

/// Display output is stable across re-construction: two errors
/// with the same variant and inner reason produce byte-identical
/// `Display` strings. Pins the contract that log scrapers,
/// incident-response dedup, and audit-log matching can rely on
/// Display as a stable fingerprint for a given (variant, reason)
/// pair — Display IS the equality contract since SecurityError
/// does not derive PartialEq.
#[test]
fn display_is_stable_for_equal_content() {
    let a = format!("{}", SecurityError::KeyUnavailable("x".into()));
    let b = format!("{}", SecurityError::KeyUnavailable("x".into()));
    assert_eq!(a, b);
    assert_eq!(
        a, "key unavailable: x",
        "Display contract pinned for KeyUnavailable"
    );

    let c = format!(
        "{}",
        SecurityError::PermissionDenied("admin required".into())
    );
    let d = format!(
        "{}",
        SecurityError::PermissionDenied("admin required".into())
    );
    assert_eq!(c, d);
    assert_eq!(c, "permission denied: admin required");
}

/// `Display` of `KeyUnavailable` and `KeyGenerationFailed` must
/// wrap the inner reason verbatim (no truncation, no redaction).
/// Critical for PCI-DSS audit logging — losing the reason text
/// can hide the real cause from the incident reviewer.
#[test]
fn display_passes_inner_reason_verbatim() {
    for (variant, msg) in [
        (
            SecurityError::KeyUnavailable("KEK-missing-for-store-42".into()),
            "key unavailable: KEK-missing-for-store-42",
        ),
        (
            SecurityError::KeyGenerationFailed("entropy source exhausted".into()),
            "key generation failed: entropy source exhausted",
        ),
        (
            SecurityError::PermissionDenied("admin access required".into()),
            "permission denied: admin access required",
        ),
    ] {
        assert_eq!(variant.to_string(), msg);
    }
}
