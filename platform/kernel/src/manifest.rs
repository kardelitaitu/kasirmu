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
#[path = "manifest_tests.rs"]
mod tests;
