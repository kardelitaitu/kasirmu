//! Unit tests for `manifest`.
//!
//! Moved out of `manifest.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `manifest.rs` with:
//!   `#[cfg(test)] #[path = "manifest_tests.rs"] mod tests;`

use super::*;

#[test]
fn parse_valid_manifest() {
    let json = r#"{
        "id": "sales",
        "name": "Sales",
        "version": "1.0.0",
        "author": "kasir.mu Team",
        "dependencies": ["inventory"],
        "permissions": ["sales:void"],
        "description": "Core sales module"
    }"#;

    let manifest = ModuleManifest::from_json(json).unwrap();
    assert_eq!(manifest.id, "sales");
    assert_eq!(manifest.name, "Sales");
    assert_eq!(manifest.version, "1.0.0");
    assert_eq!(manifest.author, "kasir.mu Team");
    assert_eq!(manifest.dependencies, vec!["inventory"]);
    assert_eq!(manifest.permissions, vec!["sales:void"]);
    assert_eq!(manifest.description, "Core sales module");
    assert!(manifest.database_namespace.is_empty());
}

#[test]
fn parse_minimal_manifest() {
    let json = r#"{
        "id": "inventory",
        "name": "Inventory",
        "version": "1.0.0"
    }"#;

    let manifest = ModuleManifest::from_json(json).unwrap();
    assert_eq!(manifest.id, "inventory");
    assert!(manifest.author.is_empty());
    assert!(manifest.database_namespace.is_empty());
    assert!(manifest.dependencies.is_empty());
    assert!(manifest.permissions.is_empty());
    assert!(manifest.description.is_empty());
}

#[test]
fn parse_invalid_json() {
    let result = ModuleManifest::from_json("{invalid}");
    assert!(result.is_err());
    match result.unwrap_err() {
        KernelError::ManifestParseError { .. } => {} // expected
        other => panic!("expected ManifestParseError, got {other:?}"),
    }
}

#[test]
fn to_json_pretty_roundtrip() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test Module".into(),
        version: "1.2.3".into(),
        description: "A test".into(),
        author: "Author".into(),
        dependencies: vec!["core".into()],
        permissions: vec!["test:read".into()],
        capabilities: vec![],
        database_namespace: String::new(),
    };

    let json = manifest.to_json_pretty().unwrap();
    let parsed = ModuleManifest::from_json(&json).unwrap();
    assert_eq!(parsed.id, manifest.id);
    assert_eq!(parsed.name, manifest.name);
    assert_eq!(parsed.version, manifest.version);
    assert_eq!(parsed.author, manifest.author);
    assert_eq!(parsed.dependencies, manifest.dependencies);
    assert_eq!(parsed.permissions, manifest.permissions);
}

#[test]
fn validate_valid_manifest() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_ok());
}

#[test]
fn validate_empty_id() {
    let manifest = ModuleManifest {
        id: "".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_empty_name() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_invalid_version() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "abc".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_empty_version() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_version_too_many_parts() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn serde_roundtrip_with_defaults() {
    let json = r#"{"id":"x","name":"X","version":"1.0.0"}"#;
    let manifest = ModuleManifest::from_json(json).unwrap();
    assert!(manifest.author.is_empty());
    assert!(manifest.database_namespace.is_empty());
    assert!(manifest.dependencies.is_empty());
    assert!(manifest.permissions.is_empty());
}

#[test]
fn debug_output() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test Module".into(),
        version: "1.0.0".into(),
        description: "desc".into(),
        author: "author".into(),
        dependencies: vec!["core".into()],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    let debug = format!("{manifest:?}");
    assert!(debug.contains("test"));
    assert!(debug.contains("Test Module"));
    assert!(debug.contains("1.0.0"));
}

#[test]
fn validate_version_non_numeric_part() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.x.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_version_pre_release_rejected() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0-alpha".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_id_must_be_kebab_case() {
    let manifest = ModuleManifest {
        id: "SalesModule".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    let err = manifest.validate().unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("kebab-case"),
        "expected kebab-case error, got: {msg}"
    );
}

#[test]
fn validate_id_with_underscore_rejected() {
    let manifest = ModuleManifest {
        id: "my_module".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_duplicate_dependencies_rejected() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec!["a".into(), "a".into()],
        permissions: vec![],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_duplicate_permissions_rejected() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec!["sales:void".into(), "sales:void".into()],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn validate_permission_must_have_domain_action() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec!["invalidformat".into()],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    let err = manifest.validate().unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("domain"),
        "expected domain:action error, got: {msg}"
    );
}

#[test]
fn validate_permission_empty_domain_rejected() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.0.0".into(),
        description: String::new(),
        author: String::new(),
        dependencies: vec![],
        permissions: vec![":action".into()],
        capabilities: vec![],
        database_namespace: String::new(),
    };
    assert!(manifest.validate().is_err());
}

#[test]
fn load_from_file_valid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manifest.json");
    std::fs::write(&path, r#"{"id":"test","name":"Test","version":"1.0.0"}"#).unwrap();

    let manifest = ModuleManifest::load_from_file(&path).unwrap();
    assert_eq!(manifest.id, "test");
    assert_eq!(manifest.version, "1.0.0");
}

#[test]
fn load_from_file_not_found() {
    let result = ModuleManifest::load_from_file(Path::new("/nonexistent/manifest.json"));
    assert!(result.is_err());
    match result.unwrap_err() {
        KernelError::ManifestParseError { .. } => {} // expected
        other => panic!("expected ManifestParseError, got {other:?}"),
    }
}

#[test]
fn load_from_file_invalid_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manifest.json");
    std::fs::write(&path, "{invalid}").unwrap();

    let result = ModuleManifest::load_from_file(&path);
    assert!(result.is_err());
}

#[test]
fn load_from_file_invalid_semver() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manifest.json");
    std::fs::write(&path, r#"{"id":"test","name":"Test","version":"bad"}"#).unwrap();

    let result = ModuleManifest::load_from_file(&path);
    assert!(result.is_err());
}

#[test]
fn clone_equality() {
    let manifest = ModuleManifest {
        id: "test".into(),
        name: "Test".into(),
        version: "1.2.3".into(),
        description: "desc".into(),
        author: "author".into(),
        dependencies: vec!["a".into()],
        permissions: vec!["p:q".into()],
        capabilities: vec![],
        database_namespace: "plugin_test_".into(),
    };
    let cloned = manifest.clone();
    assert_eq!(manifest.id, cloned.id);
    assert_eq!(manifest.name, cloned.name);
    assert_eq!(manifest.version, cloned.version);
    assert_eq!(manifest.description, cloned.description);
    assert_eq!(manifest.author, cloned.author);
    assert_eq!(manifest.dependencies, cloned.dependencies);
    assert_eq!(manifest.permissions, cloned.permissions);
    assert_eq!(manifest.database_namespace, cloned.database_namespace);
}
