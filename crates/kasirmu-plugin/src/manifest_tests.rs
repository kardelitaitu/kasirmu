use super::*;

#[test]
fn load_valid_manifest() {
    let toml = r#"
[plugin]
name = "test-plugin"
version = "1.0.0"
description = "A test plugin"

[capabilities]
scripts = ["test.lua"]

[permissions]
allow_network = false
allow_filesystem = false
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert_eq!(manifest.plugin.name, "test-plugin");
    assert_eq!(manifest.capabilities.scripts, vec!["test.lua"]);
    assert!(!manifest.permissions.allow_network);
}

#[test]
fn load_invalid_manifest_fails() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, "not: valid: toml").unwrap();
    assert!(PluginManifest::load(&path).is_err());
}

// ── Deserialization edge cases ───────────────────────────────────

#[test]
fn minimal_manifest_only_name_and_version() {
    let toml = "[plugin]\nname = \"minimal\"\nversion = \"0.1.0\"\n";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert_eq!(manifest.plugin.name, "minimal");
    assert_eq!(manifest.plugin.version, "0.1.0");
    assert!(manifest.plugin.description.is_none());
    assert!(manifest.plugin.author.is_none());
    assert!(manifest.plugin.license.is_none());
    assert!(manifest.capabilities.scripts.is_empty());
    assert!(manifest.capabilities.drivers.is_empty());
    assert!(manifest.capabilities.hooks.is_empty());
    assert!(!manifest.permissions.allow_network);
    assert!(!manifest.permissions.allow_filesystem);
    assert!(!manifest.permissions.allow_http);
}

#[test]
fn manifest_with_all_optional_fields() {
    let toml = r#"
[plugin]
name = "full"
version = "2.0.0"
description = "Fully featured plugin"
author = "Alice"
license = "MIT"

[capabilities]
scripts = ["a.lua", "b.lua"]
drivers = ["printer.so"]
hooks = ["on_sale", "on_refund"]

[permissions]
allow_network = true
allow_filesystem = true
allow_http = false
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert_eq!(manifest.plugin.name, "full");
    assert_eq!(manifest.plugin.version, "2.0.0");
    assert_eq!(
        manifest.plugin.description.as_deref(),
        Some("Fully featured plugin")
    );
    assert_eq!(manifest.plugin.author.as_deref(), Some("Alice"));
    assert_eq!(manifest.plugin.license.as_deref(), Some("MIT"));
    assert_eq!(manifest.capabilities.scripts.len(), 2);
    assert_eq!(manifest.capabilities.drivers.len(), 1);
    assert_eq!(manifest.capabilities.hooks.len(), 2);
    assert!(manifest.permissions.allow_network);
    assert!(manifest.permissions.allow_filesystem);
    assert!(!manifest.permissions.allow_http);
}

#[test]
fn manifest_all_permissions_true() {
    let toml = r#"
[plugin]
name = "networked"
version = "1.0.0"

[permissions]
allow_network = true
allow_filesystem = true
allow_http = true
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert!(manifest.permissions.allow_network);
    assert!(manifest.permissions.allow_filesystem);
    assert!(manifest.permissions.allow_http);
}

#[test]
fn manifest_capabilities_default_to_empty() {
    let toml = "[plugin]\nname = \"no-caps\"\nversion = \"1.0.0\"\n";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert!(manifest.capabilities.scripts.is_empty());
    assert!(manifest.capabilities.drivers.is_empty());
    assert!(manifest.capabilities.hooks.is_empty());
}

#[test]
fn manifest_permissions_default_to_false() {
    let toml = "[plugin]\nname = \"safe\"\nversion = \"1.0.0\"\n";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    assert!(!manifest.permissions.allow_network);
    assert!(!manifest.permissions.allow_filesystem);
    assert!(!manifest.permissions.allow_http);
}

// ── Struct Debug tests ───────────────────────────────────────────

#[test]
fn plugin_meta_debug() {
    let meta = PluginMeta {
        name: "test".into(),
        version: "1.0.0".into(),
        description: Some("desc".into()),
        author: None,
        license: Some("MIT".into()),
    };
    let debug = format!("{meta:?}");
    assert!(debug.contains("test"));
    assert!(debug.contains("desc"));
    assert!(debug.contains("MIT"));
}

#[test]
fn plugin_capabilities_debug() {
    let caps = PluginCapabilities {
        scripts: vec!["s1.lua".into()],
        drivers: vec!["d1.so".into()],
        hooks: vec![],
    };
    let debug = format!("{caps:?}");
    assert!(debug.contains("s1.lua"));
    assert!(debug.contains("d1.so"));
}

#[test]
fn plugin_permissions_debug() {
    let perms = PluginPermissions {
        allow_network: true,
        allow_filesystem: false,
        allow_http: true,
        required_permissions: vec![Permission::CartRead],
    };
    let debug = format!("{perms:?}");
    assert!(debug.contains("true"));
    assert!(debug.contains("CartRead"));
}

// ── PLG-08 schema validation ───────────────────────────────────────

#[test]
fn unknown_permission_is_rejected() {
    let toml = r#"
[plugin]
name = "test-plugin"
version = "1.0.0"

[permissions]
required_permissions = ["cart:read", "super:admin"]
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(err.to_string().contains("super:admin"));
    assert!(err.to_string().contains("unknown permission"));
}

#[test]
fn invalid_plugin_name_format_is_rejected() {
    for bad in ["UPPERCASE", "with space", "with/slash", "has.dot", ""] {
        let toml = format!(
            "[plugin]\nname = \"{bad}\"\nversion = \"1.0.0\"\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plugin.toml");
        std::fs::write(&path, toml).unwrap();
        let err = PluginManifest::load(&path).unwrap_err();
        assert!(
            err.to_string().contains("plugin name"),
            "expected name rejection for {bad:?}, got: {err}"
        );
    }
}

#[test]
fn overlong_plugin_name_is_rejected() {
    let long = "a".repeat(65);
    let toml = format!(
        "[plugin]\nname = \"{long}\"\nversion = \"1.0.0\"\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
    );
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    assert!(PluginManifest::load(&path).is_err());
}

#[test]
fn valid_kebab_case_name_is_accepted() {
    for good in ["my-plugin", "a", "plugin-0", "example-discount"] {
        let toml = format!(
            "[plugin]\nname = \"{good}\"\nversion = \"1.0.0\"\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plugin.toml");
        std::fs::write(&path, toml).unwrap();
        PluginManifest::load(&path)
            .unwrap_or_else(|e| panic!("expected {good:?} accepted, got: {e}"));
    }
}

#[test]
fn invalid_semver_is_rejected() {
    for bad in ["1.0", "v1.0.0", "1.0.0.0", "abc", "1.0.0-", ""] {
        let toml = format!(
            "[plugin]\nname = \"my-plugin\"\nversion = \"{bad}\"\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plugin.toml");
        std::fs::write(&path, toml).unwrap();
        let err = PluginManifest::load(&path).unwrap_err();
        assert!(
            err.to_string().contains("invalid version"),
            "expected version rejection for {bad:?}, got: {err}"
        );
    }
}

#[test]
fn valid_semver_with_prerelease_is_accepted() {
    for good in ["1.0.0", "0.1.0", "1.2.3-beta.1", "2.0.0+build.5"] {
        let toml = format!(
            "[plugin]\nname = \"my-plugin\"\nversion = \"{good}\"\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plugin.toml");
        std::fs::write(&path, toml).unwrap();
        PluginManifest::load(&path)
            .unwrap_or_else(|e| panic!("expected {good:?} accepted, got: {e}"));
    }
}

#[test]
fn invalid_hook_name_is_rejected() {
    let toml = r#"
[plugin]
name = "my-plugin"
version = "1.0.0"

[capabilities]
hooks = ["bad hook name!"]

[permissions]
required_permissions = ["cart:read"]
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(err.to_string().contains("invalid hook name"));
}

// ── PLG-08 tail: unknown-field (typo) rejection ──────────────────

#[test]
fn typo_in_permission_field_name_is_rejected() {
    let toml = r#"
[plugin]
name = "test-plugin"
version = "1.0.0"

[permissions]
required_permissionss = ["cart:read"]
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(
        err.to_string().contains("required_permissionss"),
        "expected the unknown field named in the error, got: {err}"
    );
}

#[test]
fn typo_in_plugin_meta_field_name_is_rejected() {
    let toml = r#"
[plugin]
name = "test-plugin"
versoin = "1.0.0"
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(
        err.to_string().contains("versoin"),
        "expected the unknown field named in the error, got: {err}"
    );
}

#[test]
fn typo_in_capabilities_field_name_is_rejected() {
    let toml = r#"
[plugin]
name = "test-plugin"
version = "1.0.0"

[capabilities]
scritps = ["main.lua"]
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(
        err.to_string().contains("scritps"),
        "expected the unknown field named in the error, got: {err}"
    );
}

#[test]
fn typo_in_permissions_boolean_field_is_rejected() {
    let toml = r#"
[plugin]
name = "test-plugin"
version = "1.0.0"

[permissions]
allow_netwrk = false
"#;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let err = PluginManifest::load(&path).unwrap_err();
    assert!(
        err.to_string().contains("allow_netwrk"),
        "expected the unknown field named in the error, got: {err}"
    );
}

#[test]
fn manifest_debug_output() {
    let toml = "[plugin]\nname = \"debug-manifest\"\nversion = \"1.0.0\"\n";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plugin.toml");
    std::fs::write(&path, toml).unwrap();
    let manifest = PluginManifest::load(&path).unwrap();
    let debug = format!("{manifest:?}");
    assert!(debug.contains("debug-manifest"));
}
