//! Unit tests for Android In-App Self-Updater commands.

use super::*;
use std::collections::HashMap;

#[test]
fn test_version_newer_comparison() {
    assert!(is_version_newer("0.0.41", "0.0.42"));
    assert!(is_version_newer("0.0.41", "0.1.0"));
    assert!(is_version_newer("0.0.41", "1.0.0"));
    assert!(is_version_newer("0.0.41", "v0.0.42"));
    assert!(!is_version_newer("0.0.41", "0.0.41"));
    assert!(!is_version_newer("0.0.41", "0.0.40"));
    assert!(!is_version_newer("0.0.41", "0.0.39"));
}

#[test]
fn test_select_platform_asset_exact_match() {
    let mut platforms = HashMap::new();
    platforms.insert(
        "android-arm64-v8a".to_string(),
        AndroidPlatformAsset {
            url: "https://example.com/arm64.apk".to_string(),
            sha256: "abc123arm64".to_string(),
            size_bytes: 50_000_000,
        },
    );
    platforms.insert(
        "android-universal".to_string(),
        AndroidPlatformAsset {
            url: "https://example.com/universal.apk".to_string(),
            sha256: "abc123universal".to_string(),
            size_bytes: 80_000_000,
        },
    );

    let (key, asset) = select_platform_asset(&platforms, "android-arm64-v8a").unwrap();
    assert_eq!(key, "android-arm64-v8a");
    assert_eq!(asset.url, "https://example.com/arm64.apk");
    assert_eq!(asset.size_bytes, 50_000_000);
}

#[test]
fn test_select_platform_asset_universal_fallback() {
    let mut platforms = HashMap::new();
    platforms.insert(
        "android-universal".to_string(),
        AndroidPlatformAsset {
            url: "https://example.com/universal.apk".to_string(),
            sha256: "abc123universal".to_string(),
            size_bytes: 80_000_000,
        },
    );

    let (key, asset) = select_platform_asset(&platforms, "android-x86_64").unwrap();
    assert_eq!(key, "android-universal");
    assert_eq!(asset.url, "https://example.com/universal.apk");
}

#[test]
fn test_select_platform_asset_missing() {
    let mut platforms = HashMap::new();
    platforms.insert(
        "android-armeabi-v7a".to_string(),
        AndroidPlatformAsset {
            url: "https://example.com/v7a.apk".to_string(),
            sha256: "abc123v7a".to_string(),
            size_bytes: 40_000_000,
        },
    );

    let result = select_platform_asset(&platforms, "android-arm64-v8a");
    assert!(result.is_none());
}

#[test]
fn test_detect_device_abi_is_valid() {
    let abi = detect_device_abi();
    assert!(!abi.is_empty());
    assert!(
        abi == "android-arm64-v8a"
            || abi == "android-armeabi-v7a"
            || abi == "android-universal"
    );
}

#[test]
fn test_get_updates_dir() {
    let base = Path::new("/data/data/mu.kasir.mobile/cache");
    let updates = get_updates_dir(base);
    assert_eq!(
        updates,
        PathBuf::from("/data/data/mu.kasir.mobile/cache/updates")
    );
}

#[test]
fn test_deserialize_manifest_json() {
    let json_data = r#"{
        "version": "0.0.42",
        "version_code": 42,
        "release_date": "2026-10-15T08:00:00Z",
        "min_supported_version": "0.0.1",
        "notes": "Bug fixes and performance improvements",
        "platforms": {
            "android-arm64-v8a": {
                "url": "https://github.com/kardelitaitu/kasirmu/releases/download/v0.0.42/kasirmu-arm64.apk",
                "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "size_bytes": 62450120
            }
        }
    }"#;

    let manifest: AndroidUpdateManifest = serde_json::from_str(json_data).unwrap();
    assert_eq!(manifest.version, "0.0.42");
    assert_eq!(manifest.version_code, Some(42));
    assert_eq!(manifest.platforms.len(), 1);
    let asset = manifest.platforms.get("android-arm64-v8a").unwrap();
    assert_eq!(asset.size_bytes, 62450120);
}
