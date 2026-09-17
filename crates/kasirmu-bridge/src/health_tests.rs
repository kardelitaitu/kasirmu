//! Unit tests for the health command surface.
//!
//! Relocated from `apps/desktop-client/src/commands/health_tests.rs`
//! (Wave F); `version`'s per-crate identity strings are supplied at the
//! call site exactly as the desktop shim threads them (see `super`'s doc).

use super::*;

#[tokio::test]
async fn ping_returns_pong() {
    assert_eq!(ping().await.unwrap(), "pong");
}

#[tokio::test]
async fn version_has_populated_fields() {
    let v = version(
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        env!("CARGO_PKG_RUST_VERSION"),
        option_env!("TARGET").unwrap_or("unknown"),
    )
    .await
    .unwrap();
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
        name: "kasirmu-app",
        version: "0.0.28",
        rust_version: "1.80",
        target: "wasm32",
    };
    assert_eq!(v.name, "kasirmu-app");
    assert_eq!(v.version, "0.0.28");
    assert_eq!(v.rust_version, "1.80");
    assert_eq!(v.target, "wasm32");
}
