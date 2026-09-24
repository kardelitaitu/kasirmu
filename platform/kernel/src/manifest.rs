/*
last audited 25-07-26 by RSA-Agent (platform-kernel slice B: manifest verified)
crate: platform-kernel | status: SAFE | lint: CLEAN
findings: clean manifest parsing/validation mirroring the formal JSON Schema (kebab-case id, semver, dependency and permission declarations); unwraps test-only (line 206+ verified)
next: none | perf: N/A
*/
//! Module manifest — JSON metadata file for every module.
//!
//! The manifest defines a module's identity, version, dependencies,
//! and required permissions. It is used by tooling for scaffolding,
//! documentation generation, and dependency analysis.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::KernelError;

/// Module manifest metadata.
///
/// Every module in kasir.mu must have a `manifest.json` at its root.
/// This struct mirrors the formal JSON Schema at
/// `docs/specs/module-manifest.schema.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleManifest {
    /// Stable unique identifier (kebab-case, e.g. `"sales"`).
    pub id: String,

    /// Human-readable display name (e.g. `"Sales"`).
    pub name: String,

    /// Semantic version string (e.g. `"1.0.0"`).
    pub version: String,

    /// Human-readable description of what this module provides.
    #[serde(default)]
    pub description: String,

    /// Module author name or organization.
    #[serde(default)]
    pub author: String,

    /// Module IDs that this module depends on.
    #[serde(default)]
    pub dependencies: Vec<String>,

    /// Permission strings required by this module (e.g. `["sales:void"]`).
    #[serde(default)]
    pub permissions: Vec<String>,

    /// Optional database namespace prefix (e.g. `"plugin_<id>_"`).
    #[serde(default)]
    pub database_namespace: String,
}

impl ModuleManifest {
    /// Parse a `ModuleManifest` from a JSON string.
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::ManifestParseError`] if the JSON is invalid
    /// or a required field is missing.
    pub fn from_json(json: &str) -> Result<Self, KernelError> {
        serde_json::from_str::<ModuleManifest>(json).map_err(|e| KernelError::ManifestParseError {
            module: "<unknown>".into(),
            message: e.to_string(),
        })
    }

    /// Load a manifest from a `manifest.json` file on disk.
    ///
    /// Reads the file, parses it, and calls [`validate()`](Self::validate).
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::ManifestParseError`] if the file cannot be
    /// read, parsed, or validated.
    pub fn load_from_file(path: &Path) -> Result<Self, KernelError> {
        let content =
            std::fs::read_to_string(path).map_err(|e| KernelError::ManifestParseError {
                module: path.to_string_lossy().into(),
                message: format!("failed to read manifest file: {e}"),
            })?;
        let manifest = Self::from_json(&content)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Serialize this manifest to a pretty-printed JSON string.
    pub fn to_json_pretty(&self) -> Result<String, KernelError> {
        serde_json::to_string_pretty(self)
            .map_err(|e| KernelError::Internal(format!("failed to serialize manifest: {e}")))
    }

    /// Validate that all required fields are present and well-formed,
    /// following the rules in `docs/specs/module-manifest.schema.json`.
    ///
    /// Returns `Ok(())` if the manifest is valid, or a descriptive error.
    pub fn validate(&self) -> Result<(), KernelError> {
        // ── id must be non-empty and kebab-case ───────────────────
        if self.id.is_empty() {
            return Err(KernelError::ManifestParseError {
                module: self.id.clone(),
                message: "manifest id must not be empty".into(),
            });
        }
        if !self.id.as_bytes()[0].is_ascii_lowercase()
            || !self
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(KernelError::ManifestParseError {
                module: self.id.clone(),
                message: format!(
                    "manifest id must be kebab-case (lowercase, digits, hyphens only), got '{id}'",
                    id = self.id
                ),
            });
        }

        // ── name must be non-empty ────────────────────────────────
        if self.name.is_empty() {
            return Err(KernelError::ManifestParseError {
                module: self.id.clone(),
                message: "manifest name must not be empty".into(),
            });
        }

        // ── version must be non-empty and valid SemVer ─────────────
        if self.version.is_empty() {
            return Err(KernelError::ManifestParseError {
                module: self.id.clone(),
                message: "manifest version must not be empty".into(),
            });
        }
        let parts: Vec<&str> = self.version.split('.').collect();
        if parts.len() != 3 || parts.iter().any(|p| p.parse::<u64>().is_err()) {
            return Err(KernelError::ManifestParseError {
                module: self.id.clone(),
                message: format!(
                    "invalid version '{}': expected semver format (X.Y.Z)",
                    self.version
                ),
            });
        }

        // ── dependencies must be unique ───────────────────────────
        {
            let mut seen = std::collections::HashSet::new();
            for dep in &self.dependencies {
                if !seen.insert(dep) {
                    return Err(KernelError::ManifestParseError {
                        module: self.id.clone(),
                        message: format!("duplicate dependency '{dep}' in manifest"),
                    });
                }
            }
        }

        // ── permissions must be unique and follow domain:action ────
        {
            let mut seen = std::collections::HashSet::new();
            for perm in &self.permissions {
                if !seen.insert(perm) {
                    return Err(KernelError::ManifestParseError {
                        module: self.id.clone(),
                        message: format!("duplicate permission '{perm}' in manifest"),
                    });
                }
                // Validate domain:action format.
                let colon_count = perm.chars().filter(|&c| c == ':').count();
                if colon_count != 1 {
                    return Err(KernelError::ManifestParseError {
                        module: self.id.clone(),
                        message: format!(
                            "invalid permission '{perm}': expected <domain>:<action> format"
                        ),
                    });
                }
                let parts: Vec<&str> = perm.split(':').collect();
                if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
                    return Err(KernelError::ManifestParseError {
                        module: self.id.clone(),
                        message: format!(
                            "invalid permission '{perm}': domain and action must be non-empty"
                        ),
                    });
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
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
}
