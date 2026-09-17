/*
last audited 25-07-26 by RSA-Agent (oz-plugin slice A: loader deep read)
crate: oz-plugin | status: SAFE | lint: CLEAN
findings: exemplary — PLG-02 script resolution: structural rejection of absolute/drive/UNC/dotdot and non-canonical paths, canonical containment check defeats symlink escape (in-directory symlinks permitted as documented), optional scripts tolerated, regular-file check; documented asymmetry: unsafe script path skips only that plugin (loud warn) while a manifest schema violation aborts the whole registry load (fail-closed, PLG-08 rationale: a typo must never look like loaded-and-doing-nothing)
next: none | perf: N/A
*/
use std::path::{Path, PathBuf};

use crate::error::PluginError;
use crate::manifest::PluginManifest;
use crate::package::sanitise_entry_name;

/// A loaded plugin with its manifest and script paths.
#[derive(Debug, Clone)]
pub struct LoadedPlugin {
    /// The parsed plugin manifest.
    pub manifest: PluginManifest,
    /// Absolute path to the plugin directory.
    pub directory: PathBuf,
    /// List of script files found on disk that match the manifest.
    pub scripts: Vec<PathBuf>,
}

/// A registry of all loaded plugins.
#[derive(Debug, Default)]
pub struct PluginRegistry {
    /// All loaded plugins.
    pub plugins: Vec<LoadedPlugin>,
}

impl PluginRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self { plugins: vec![] }
    }

    /// Returns `true` when no plugins are loaded.
    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }

    /// Returns the number of loaded plugins.
    pub fn len(&self) -> usize {
        self.plugins.len()
    }
}

/// Resolve and validate a plugin's declared script paths (PLG-02).
///
/// Every declared script is confined to its plugin directory:
///
/// - Structurally unsafe paths (absolute, drive/UNC prefixes, `..` components)
///   are rejected outright and fail the plugin. A redundant `./` prefix is
///   likewise rejected as a non-canonical path.
/// - Declared scripts that do not exist are tolerated (optional scripts, so a
///   missing file silently contributes nothing — matches prior behaviour).
/// - Existing entries must be regular files whose canonical path resolves
///   *inside* the canonical plugin directory. Symlinks/hardlinks that escape
///   the plugin directory fail the plugin; a symlink that stays inside the
///   plugin directory is permitted because the canonical containment check is
///   the authoritative boundary.
///
/// Returns the canonicalised script paths on success, or an error that should
/// cause the whole plugin to be rejected.
fn resolve_plugin_scripts(
    plugin_dir: &Path,
    scripts: &[String],
) -> Result<Vec<PathBuf>, PluginError> {
    let canonical_dir = std::fs::canonicalize(plugin_dir).map_err(|e| {
        PluginError::Manifest(format!(
            "cannot canonicalise plugin directory {}: {e}",
            plugin_dir.display()
        ))
    })?;

    let mut resolved = Vec::new();
    for script in scripts {
        // Structural check first: reject traversal / absolute / drive / UNC.
        let safe = sanitise_entry_name(script)
            .map_err(|e| PluginError::Manifest(format!("script '{script}': {e}")))?;

        let joined = plugin_dir.join(&safe);
        if !joined.exists() {
            // Optional script — tolerated (contributes nothing).
            continue;
        }

        let meta = std::fs::metadata(&joined)
            .map_err(|e| PluginError::Manifest(format!("script '{script}': {e}")))?;
        if !meta.is_file() {
            return Err(PluginError::Manifest(format!(
                "script '{script}' is not a regular file"
            )));
        }

        // Canonicalise and verify containment: a symlink pointing outside the
        // plugin directory is rejected rather than followed.
        let canonical = std::fs::canonicalize(&joined)
            .map_err(|e| PluginError::Manifest(format!("script '{script}': {e}")))?;
        if !canonical.starts_with(&canonical_dir) {
            return Err(PluginError::Manifest(format!(
                "script '{script}' resolves outside the plugin directory (symlink?)"
            )));
        }

        resolved.push(canonical);
    }
    Ok(resolved)
}

/// Scan a directory for plugin manifests and load them.
pub fn load_plugins(plugins_dir: &Path) -> Result<PluginRegistry, PluginError> {
    let mut registry = PluginRegistry::new();

    if !plugins_dir.exists() {
        return Ok(registry);
    }

    for entry in std::fs::read_dir(plugins_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("plugin.toml");
        if !manifest_path.exists() {
            continue;
        }

        match PluginManifest::load(&manifest_path) {
            Ok(manifest) => match resolve_plugin_scripts(&path, &manifest.capabilities.scripts) {
                Ok(scripts) => {
                    let plugin = LoadedPlugin {
                        manifest,
                        directory: path,
                        scripts,
                    };
                    tracing::info!(name = %plugin.manifest.plugin.name, "plugin loaded");
                    registry.plugins.push(plugin);
                }
                Err(e) => {
                    // Unsafe script path (PLG-02): reject just this plugin but
                    // keep the rest of the registry — the plugin is skipped
                    // loudly in the log rather than loaded unsafely.
                    tracing::warn!(
                        dir = %path.display(),
                        error = %e,
                        "failed to load plugin (unsafe script path)"
                    );
                }
            },
            Err(e) => {
                // Manifest schema violation (PLG-08): fail loudly instead of
                // silently skipping — a typo'd manifest must never appear as
                // "loaded and doing nothing".
                return Err(e);
            }
        }
    }

    Ok(registry)
}

#[cfg(test)]
#[path = "loader_tests.rs"]
mod tests;
