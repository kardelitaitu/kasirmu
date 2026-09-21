use super::*;

/// Off Android there is no APK and no JVM, so the helper must report "no
/// fingerprint" rather than failing — that `None` is what makes the server
/// classify the device as `unknown` (ADR #57 §2.2) instead of `mismatch`.
///
/// This is the ONLY assertion available for the desktop path, and it is worth
/// pinning: turning this into an error, or into a placeholder string, would
/// either block licence checks or manufacture a fingerprint no pin can match.
#[cfg(not(target_os = "android"))]
#[test]
fn no_fingerprint_is_reported_off_android() {
    assert_eq!(
        apk_signing_fingerprint(),
        None,
        "a desktop shell has no APK, so the field must be omitted entirely"
    );
}

/// The helper must never panic, on any platform. A panic inside the licence
/// status lane would take down the command that the merchant’s Settings screen
/// and the sync daemon both depend on.
#[test]
fn the_helper_never_panics() {
    let _ = apk_signing_fingerprint();
}
