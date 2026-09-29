//! Operator grant store for plugin permissions (C2 / D7).
//!
//! # Why this exists
//!
//! A plugin's `required_permissions` list is **self-declared**: the plugin
//! author writes it in `plugin.toml`, and before this module the loader only
//! checked that each entry was a *recognised* permission name
//! (`PluginManager::ALLOWED_PERMISSIONS`). Nothing ever asked whether the
//! operator running the store wanted that plugin to have `cart:write`. A
//! plugin that shipped `required_permissions = ["cart:write"]` received the
//! discount bindings with no human in the loop.
//!
//! This module turns that self-declaration into an explicit operator approval
//! recorded beside the plugins, so a permission the operator did not grant
//! **rejects the plugin** rather than silently arming it.
//!
//! # What this does NOT do, stated plainly
//!
//! **This is not a security boundary against an attacker who can write the
//! plugins directory.** `plugin-grants.json` sits in that same directory, so
//! anyone able to add a plugin is able to add a grant for it. What this buys is
//! (a) an explicit approval step for the honest case, (b) an audit trail of
//! what was approved and when, and (c) a fail-closed default — a plugin whose
//! grant was never recorded cannot run at all. Tamper *resistance* needs
//! signature verification over a key the attacker does not hold, which is a
//! separate piece of work and is deliberately not attempted here.
//!
//! # Format
//!
//! ```json
//! { "schema_version": 1, "grants": { "example-discount": ["cart:read", "cart:write"] } }
//! ```
//!
//! An absent file means "no grants recorded", which makes every plugin with a
//! non-empty `required_permissions` unloadable. That is the intended
//! fail-closed default: an operator upgrading into this change must record a
//! grant to keep a plugin running.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::PluginError;
use crate::manifest::{Permission, permission_from_str};

/// File name of the operator grant store, resolved inside the plugins dir.
pub const GRANTS_FILE_NAME: &str = "plugin-grants.json";

/// The schema version this module understands.
///
/// Pinned and rejected-on-mismatch rather than ignored: a future format that
/// dropped a field would otherwise be read as "nothing granted", which is a
/// silent downgrade of every approval on the machine.
const SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// [`SUPPORTED_SCHEMA_VERSION`] for callers outside this module.
///
/// Exposed so an error message (the manager's ungranted-permission refusal) can
/// print the schema version to write without duplicating the literal and
/// letting the two drift.
pub const SUPPORTED_SCHEMA_VERSION_PUBLIC: u32 = SUPPORTED_SCHEMA_VERSION;

/// Raw on-disk shape. Deserialised first, then validated into [`PluginGrants`].
///
/// `deny_unknown_fields` is deliberate: a typo in a top-level key (say
/// `"grant"` for `"grants"`) would otherwise parse as a well-formed document
/// with no approvals, silently disabling the gate instead of failing loudly.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantsFile {
    schema_version: u32,
    grants: HashMap<String, Vec<String>>,
}

/// Operator-approved permissions, keyed by plugin id.
#[derive(Debug, Default, Clone)]
pub struct PluginGrants {
    /// Approved permission set per plugin id. A plugin absent from this map has
    /// no approvals, which is *not* the same as "may do nothing declared" — it
    /// means it is unloadable if it declares anything.
    grants: HashMap<String, Vec<Permission>>,
}

impl PluginGrants {
    /// An empty grant set — the state when no grant file has been written.
    pub fn empty() -> Self {
        Self {
            grants: HashMap::new(),
        }
    }

    /// Returns `true` when no plugin has any approved permission.
    pub fn is_empty(&self) -> bool {
        self.grants.is_empty()
    }

    /// Approved permissions for `plugin_id`, or an empty slice.
    ///
    /// An unknown id returns an empty slice rather than an error: the caller's
    /// next step is [`ungranted`], which reports the whole declared set as
    /// missing, and that is the actionable message.
    pub fn granted_for(&self, plugin_id: &str) -> &[Permission] {
        self.grants
            .get(plugin_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// Path of the grant file inside `plugins_dir`.
    pub fn path_in(plugins_dir: &Path) -> PathBuf {
        plugins_dir.join(GRANTS_FILE_NAME)
    }
}

/// Declared permissions that the operator has not approved, order-independent.
///
/// This is the gate's decision function. It is a pure function over two slices
/// so it can be tested without a filesystem, and so the manager cannot
/// accidentally compare *counts* instead of *sets* — granting a superset that
/// omits one declared permission must still be refused.
pub fn ungranted(declared: &[Permission], granted: &[Permission]) -> Vec<Permission> {
    declared
        .iter()
        .filter(|p| !granted.contains(p))
        .cloned()
        .collect()
}

/// Load the operator grant store from `plugins_dir`.
///
/// * Absent file -> [`PluginGrants::empty`] (not an error; the fail-closed
///   behaviour comes from the manager, which then refuses every plugin that
///   declares a permission).
/// * Malformed JSON, a wrong `schema_version`, an unknown permission name, or
///   an unknown top-level field -> `Err(PluginError::Manifest)` naming the file
///   and the offending value, because a typo must never read as "no grants".
pub fn load(plugins_dir: &Path) -> Result<PluginGrants, PluginError> {
    let path = PluginGrants::path_in(plugins_dir);

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PluginGrants::empty());
        }
        Err(e) => {
            return Err(PluginError::Manifest(format!(
                "cannot read plugin grants file {}: {e}",
                path.display()
            )));
        }
    };

    let file: GrantsFile = serde_json::from_str(&content).map_err(|e| {
        PluginError::Manifest(format!(
            "invalid plugin grants file {}: {e}. Expected \
             {{ \"schema_version\": {SUPPORTED_SCHEMA_VERSION}, \"grants\": \
             {{ \"<plugin-id>\": [\"cart:read\"] }} }}",
            path.display()
        ))
    })?;

    if file.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(PluginError::Manifest(format!(
            "plugin grants file {} declares schema_version {}, but this build \
             understands {SUPPORTED_SCHEMA_VERSION}",
            path.display(),
            file.schema_version
        )));
    }

    let mut grants = HashMap::with_capacity(file.grants.len());
    for (plugin_id, names) in file.grants {
        let mut perms = Vec::with_capacity(names.len());
        for name in &names {
            match permission_from_str(name) {
                Some(p) => perms.push(p),
                None => {
                    return Err(PluginError::Manifest(format!(
                        "plugin grants file {} grants unknown permission {name:?} to \
                         plugin {plugin_id:?}. Known permissions: {}",
                        path.display(),
                        crate::manifest::ALL_PERMISSION_NAMES.join(", ")
                    )));
                }
            }
        }
        grants.insert(plugin_id, perms);
    }

    Ok(PluginGrants { grants })
}

#[cfg(test)]
#[path = "grants_tests.rs"]
mod tests;
