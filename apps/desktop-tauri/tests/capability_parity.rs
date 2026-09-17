//! Capability parity audit — verifies that the generated schema file
//! (`gen/schemas/capabilities.json`) matches the actual capability
//! declarations (`capabilities/*.json`) in both desktop and tablet clients.
//!
//! A mismatch means either:
//! 1. A capability was added/removed without regenerating schemas, or
//! 2. The generated schema was manually edited (which breaks Tauri's build).
//!
//! This test catches drift before it causes silent permission failures.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Extract permissions from a capabilities JSON file by capability identifier.
fn extract_permissions(json: &str) -> HashSet<String> {
    let parsed: serde_json::Value =
        serde_json::from_str(json).expect("capabilities JSON should be valid");
    let mut perms = HashSet::new();

    if let Some(obj) = parsed.as_object() {
        for (_key, cap) in obj {
            if let Some(perm_array) = cap.get("permissions").and_then(|p| p.as_array()) {
                for perm in perm_array {
                    if let Some(s) = perm.as_str() {
                        perms.insert(s.to_string());
                    }
                }
            }
        }
    }
    perms
}

/// Extract permissions from an individual capabilities/default.json file.
fn extract_permissions_from_file(json: &str) -> HashSet<String> {
    let parsed: serde_json::Value =
        serde_json::from_str(json).expect("capabilities JSON should be valid");
    let mut perms = HashSet::new();
    if let Some(arr) = parsed.get("permissions").and_then(|p| p.as_array()) {
        for perm in arr {
            if let Some(s) = perm.as_str() {
                perms.insert(s.to_string());
            }
        }
    }
    perms
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn desktop_gen_schema_matches_capabilities() {
    let gen_path = manifest_dir().join("gen/schemas/capabilities.json");
    let cap_path = manifest_dir().join("capabilities/default.json");

    let gen_json = fs::read_to_string(&gen_path)
        .unwrap_or_else(|e| panic!("failed to read gen schema at {:?}: {}", gen_path, e));
    let cap_json = fs::read_to_string(&cap_path)
        .unwrap_or_else(|e| panic!("failed to read capabilities at {:?}: {}", cap_path, e));

    let gen_perms = extract_permissions(&gen_json);
    let cap_perms = extract_permissions_from_file(&cap_json);

    let in_gen_not_cap: Vec<_> = gen_perms.difference(&cap_perms).collect();
    let in_cap_not_gen: Vec<_> = cap_perms.difference(&gen_perms).collect();

    assert!(
        in_gen_not_cap.is_empty(),
        "Desktop gen/schemas/capabilities.json has permissions not in capabilities/default.json: {:?}",
        in_gen_not_cap
    );
    assert!(
        in_cap_not_gen.is_empty(),
        "Desktop capabilities/default.json has permissions not in gen/schemas/capabilities.json: {:?}\n\
         Run `cargo tauri build` or regenerate schemas to fix.",
        in_cap_not_gen
    );
}

#[test]
fn tablet_gen_schema_matches_capabilities() {
    let gen_path = manifest_dir()
        .parent()
        .unwrap()
        .join("mobile-tauri/gen/schemas/capabilities.json");
    let cap_default = manifest_dir()
        .parent()
        .unwrap()
        .join("mobile-tauri/capabilities/default.json");
    let cap_mobile = manifest_dir()
        .parent()
        .unwrap()
        .join("mobile-tauri/capabilities/mobile.json");

    let gen_json = fs::read_to_string(&gen_path)
        .unwrap_or_else(|e| panic!("failed to read gen schema at {:?}: {}", gen_path, e));
    let default_json = fs::read_to_string(&cap_default)
        .unwrap_or_else(|e| panic!("failed to read capabilities at {:?}: {}", cap_default, e));
    let mobile_json = if cap_mobile.exists() {
        fs::read_to_string(&cap_mobile).unwrap_or_default()
    } else {
        String::new()
    };

    let gen_perms = extract_permissions(&gen_json);
    let default_perms = extract_permissions_from_file(&default_json);
    let mobile_perms: HashSet<String> = if !mobile_json.is_empty() {
        extract_permissions_from_file(&mobile_json)
    } else {
        HashSet::new()
    };
    let all_cap_perms: HashSet<_> = default_perms.union(&mobile_perms).cloned().collect();

    let in_gen_not_cap: Vec<_> = gen_perms.difference(&all_cap_perms).collect();
    let in_cap_not_gen: Vec<_> = all_cap_perms.difference(&gen_perms).collect();

    assert!(
        in_gen_not_cap.is_empty(),
        "Tablet gen/schemas/capabilities.json has permissions not in any capabilities/*.json: {:?}",
        in_gen_not_cap
    );
    assert!(
        in_cap_not_gen.is_empty(),
        "Tablet capabilities/*.json has permissions not in gen/schemas/capabilities.json: {:?}\n\
         Run `cargo tauri build` or regenerate schemas to fix.",
        in_cap_not_gen
    );
}

#[test]
fn desktop_and_tablet_share_core_permissions() {
    // Both clients should have the same minimum set of core permissions
    // for features shared between desktop and tablet.
    let desktop_cap = manifest_dir().join("capabilities/default.json");
    let tablet_cap = manifest_dir()
        .parent()
        .unwrap()
        .join("mobile-tauri/capabilities/default.json");

    let desktop_json = fs::read_to_string(&desktop_cap).unwrap();
    let tablet_json = fs::read_to_string(&tablet_cap).unwrap();

    let desktop_perms = extract_permissions_from_file(&desktop_json);
    let tablet_perms = extract_permissions_from_file(&tablet_json);

    // Core permissions that MUST be present in BOTH clients
    let required_core = ["core:default", "clipboard-manager:allow-write-text"];

    for perm in &required_core {
        assert!(
            desktop_perms.contains(*perm),
            "Desktop missing required core permission: {}",
            perm
        );
        assert!(
            tablet_perms.contains(*perm),
            "Tablet missing required core permission: {}",
            perm
        );
    }
}
