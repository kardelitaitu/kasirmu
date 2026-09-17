/*
last audited 25-07-26 by RSA-Agent (oz-plugin slice A: manifest deep read)
crate: oz-plugin | status: SAFE | lint: CLEAN
findings: exemplary — PLG-08 deny_unknown_fields on every manifest section (typos fail loudly); typed kebab-case Permission enum with fail-closed permission_from_str; kebab-case name charset/length validation; strict SemVer version check
next: none | perf: N/A
*/
use serde::Deserialize;
use std::path::Path;

use crate::error::PluginError;

/// A plugin manifest (`plugin.toml`).
///
/// `deny_unknown_fields` (PLG-08 tail): a typo'd field name — e.g.
/// `required_permissionss` or `cappabilities` — must fail loudly at load
/// instead of being silently dropped and changing the manifest author's
/// intent without anyone noticing.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    /// Plugin metadata (name, version, etc.).
    pub plugin: PluginMeta,
    /// Declared plugin capabilities.
    #[serde(default)]
    pub capabilities: PluginCapabilities,
    /// Sandbox permission settings.
    #[serde(default)]
    pub permissions: PluginPermissions,
}

/// Metadata section of a plugin manifest.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginMeta {
    /// Plugin name (must be unique).
    pub name: String,
    /// Plugin version (semver string).
    pub version: String,
    /// Optional human-readable description.
    pub description: Option<String>,
    /// Optional plugin author.
    pub author: Option<String>,
    /// Optional license identifier.
    pub license: Option<String>,
}

/// Declared capabilities of a plugin.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginCapabilities {
    /// Script files to load into the Lua sandbox.
    #[serde(default)]
    pub scripts: Vec<String>,
    /// Native driver modules to load.
    #[serde(default)]
    pub drivers: Vec<String>,
    /// Hook names this plugin registers.
    #[serde(default)]
    pub hooks: Vec<String>,
}

/// A typed permission that a plugin can declare.
///
/// See [`PluginPermissions::required_permissions`] for the full list of
/// allowed values. Each permission governs access to a specific POS domain.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    /// Read cart contents and prices.
    CartRead,
    /// Modify cart totals (apply discounts).
    CartWrite,
    /// Read tax rates and configuration.
    TaxRead,
    /// Read inventory stock levels.
    InventoryRead,
    /// Write inventory stock levels (adjust stock).
    InventoryWrite,
    /// Read reporting/analytics data.
    ReportingRead,
    /// Access system time (non-sensitive).
    SystemTime,
    /// Write log entries.
    LogWrite,
}

impl std::fmt::Display for Permission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CartRead => write!(f, "cart:read"),
            Self::CartWrite => write!(f, "cart:write"),
            Self::TaxRead => write!(f, "tax:read"),
            Self::InventoryRead => write!(f, "inventory:read"),
            Self::InventoryWrite => write!(f, "inventory:write"),
            Self::ReportingRead => write!(f, "reporting:read"),
            Self::SystemTime => write!(f, "system:time"),
            Self::LogWrite => write!(f, "log:write"),
        }
    }
}

/// Sanity-check that a string value is a known permission name.
/// Returns `None` for unrecognised values. Callers must treat `None` as a
/// hard rejection (PLG-08): the manifest deserialiser errors out with the
/// unknown value so intent is never silently changed.
pub fn permission_from_str(s: &str) -> Option<Permission> {
    match s {
        "cart:read" => Some(Permission::CartRead),
        "cart:write" => Some(Permission::CartWrite),
        "tax:read" => Some(Permission::TaxRead),
        "inventory:read" => Some(Permission::InventoryRead),
        "inventory:write" => Some(Permission::InventoryWrite),
        "reporting:read" => Some(Permission::ReportingRead),
        "system:time" => Some(Permission::SystemTime),
        "log:write" => Some(Permission::LogWrite),
        _ => None,
    }
}

/// All recognised permission names, used for actionable error diagnostics.
pub const ALL_PERMISSION_NAMES: &[&str] = &[
    "cart:read",
    "cart:write",
    "tax:read",
    "inventory:read",
    "inventory:write",
    "reporting:read",
    "system:time",
    "log:write",
];

/// Deserialize a single permission or a list of permissions from TOML.
/// Supports both single-string and array-of-strings forms.
fn deserialize_permissions<'de, D>(deserializer: D) -> Result<Vec<Permission>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;

    // Try array first, then single string.
    struct PermVisitor;

    impl PermVisitor {
        fn unknown<E: de::Error>(v: &str) -> E {
            de::Error::custom(format!(
                "unknown permission '{v}' — recognised permissions: {}",
                ALL_PERMISSION_NAMES.join(", ")
            ))
        }
    }

    impl<'de> de::Visitor<'de> for PermVisitor {
        type Value = Vec<Permission>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a permission string or array of permission strings")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<Vec<Permission>, E> {
            permission_from_str(v)
                .map(|p| vec![p])
                .ok_or_else(|| Self::unknown(v))
        }

        fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<Permission>, A::Error> {
            let mut perms = Vec::new();
            while let Some(val) = seq.next_element::<String>()? {
                match permission_from_str(&val) {
                    Some(p) => perms.push(p),
                    None => return Err(Self::unknown(&val)),
                }
            }
            Ok(perms)
        }
    }

    deserializer.deserialize_any(PermVisitor)
}

/// Sandbox permissions for a plugin.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginPermissions {
    /// Whether the plugin may make network requests.
    #[serde(default)]
    pub allow_network: bool,
    /// Whether the plugin may access the filesystem.
    #[serde(default)]
    pub allow_filesystem: bool,
    /// Whether the plugin may send HTTP requests.
    #[serde(default)]
    pub allow_http: bool,
    /// Declared permissions this plugin needs (e.g., `["cart:read", "cart:write"]`).
    /// Deserialisation fails with an actionable error if any permission is
    /// not recognised (PLG-08) — unknown intent is never silently dropped.
    #[serde(default, deserialize_with = "deserialize_permissions")]
    pub required_permissions: Vec<Permission>,
}

impl PluginManifest {
    /// Load a manifest from a `plugin.toml` file, validating the schema
    /// (PLG-08): plugin ID format, strict SemVer, and hook-name shape.
    pub fn load(path: &Path) -> Result<Self, PluginError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| PluginError::Manifest(format!("cannot read {path:?}: {e}")))?;
        let manifest: Self = toml::from_str(&content)
            .map_err(|e| PluginError::Manifest(format!("invalid manifest {path:?}: {e}")))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Validate the manifest against the documented plugin schema (PLG-08).
    ///
    /// Checks plugin ID format (kebab-case, 1–64 chars), strict SemVer, and
    /// hook-name shape. Unknown permissions are already rejected during
    /// deserialisation with an actionable diagnostic.
    pub fn validate(&self) -> Result<(), PluginError> {
        let name = &self.plugin.name;

        // Plugin ID: lowercase letters/digits/hyphens, must start with a
        // lowercase letter or digit, max 64 chars (kebab-case convention).
        let valid_id = !name.is_empty()
            && name.len() <= 64
            && name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !valid_id {
            return Err(PluginError::Manifest(format!(
                "plugin name '{name}' is invalid — use lowercase letters, digits \
                 and hyphens (kebab-case, max 64 chars)"
            )));
        }

        // Version: strict SemVer (e.g. `1.0.0`, `1.2.3-beta.1`).
        semver::Version::parse(&self.plugin.version).map_err(|e| {
            PluginError::Manifest(format!(
                "plugin '{name}' has invalid version '{}': {e}",
                self.plugin.version
            ))
        })?;

        // Hook names: non-empty, safe identifier characters.
        for hook in &self.capabilities.hooks {
            let valid_hook = !hook.is_empty()
                && hook.len() <= 128
                && hook.chars().all(|c| {
                    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
                });
            if !valid_hook {
                return Err(PluginError::Manifest(format!(
                    "plugin '{name}' declares invalid hook name '{hook}' — use lowercase \
                     letters, digits, dots, underscores or hyphens"
                )));
            }
        }

        Ok(())
    }
}

#[cfg(test)]
#[path = "manifest_tests.rs"]
mod tests;
