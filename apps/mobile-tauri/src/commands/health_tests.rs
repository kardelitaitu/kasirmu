use super::*;

#[tokio::test]
async fn ping_returns_pong() {
    assert_eq!(ping().await.unwrap(), "pong");
}

#[tokio::test]
async fn version_has_populated_fields() {
    let v = version().await.unwrap();
    assert!(!v.name.is_empty());
    assert!(!v.version.is_empty());
    assert!(!v.target.is_empty());
}

// ── VersionInfo struct tests ─────────────────────────────────────

#[test]
fn version_info_debug() {
    let v = VersionInfo {
        name: "test-app",
        version: "1.0.0",
        rust_version: "1.80",
        target: "x86_64-linux",
    };
    let debug = format!("{v:?}");
    assert!(debug.contains("test-app"));
    assert!(debug.contains("1.0.0"));
    assert!(debug.contains("x86_64-linux"));
}

#[test]
fn version_info_serde_json() {
    let v = VersionInfo {
        name: "test-app",
        version: "1.0.0",
        rust_version: "1.80",
        target: "x86_64-linux",
    };
    let json = serde_json::to_value(&v).unwrap();
    assert_eq!(json["name"], "test-app");
    assert_eq!(json["version"], "1.0.0");
    assert_eq!(json["target"], "x86_64-linux");
}

#[test]
fn version_info_field_access() {
    let v = VersionInfo {
        name: "kasirmu-mobile",
        version: "0.0.28",
        rust_version: "1.80",
        target: "aarch64-android",
    };
    assert_eq!(v.name, "kasirmu-mobile");
    assert_eq!(v.version, "0.0.28");
    assert_eq!(v.rust_version, "1.80");
    assert_eq!(v.target, "aarch64-android");
}
// ── Build fingerprint (ADR #57 §2.1) ─────────────────────────────

/// Off Android the read must answer `None`, not an error: the server classifies
/// an absent fingerprint as `unknown` (§2.2), which is never a mismatch, so a
/// platform with no APK must not look like a broken client.
#[cfg(not(target_os = "android"))]
#[tokio::test]
async fn build_fingerprint_is_absent_off_android() {
    assert_eq!(
        get_build_fingerprint().await.unwrap(),
        None,
        "a desktop/host build has no APK signing certificate"
    );
}

/// The command must never panic, on any platform. Its `spawn_blocking` join is
/// the only failure mode it can surface, and a panic there would take down the
/// diagnostic surface rather than report absence.
#[tokio::test]
async fn build_fingerprint_never_panics() {
    let _ = get_build_fingerprint().await;
}
