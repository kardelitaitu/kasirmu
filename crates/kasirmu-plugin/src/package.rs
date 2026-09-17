/*
last audited 25-07-26 by RSA-Agent (kasirmu-plugin slice A: package verified)
crate: kasirmu-plugin | status: SAFE | lint: CLEAN
findings: clean — PLG-01 entry-name sanitization (rejects absolute, drive/UNC prefixes, empty/dot/dotdot components), PLG-06 zip-bomb defenses (entry count 512, per-entry compressed 8 MiB and uncompressed 16 MiB caps, 64 MiB total, 100x compression-ratio cap)
next: none | perf: N/A
*/
//! `.kasirpkg` archive reader.
//!
//! An `.kasirpkg` file is a zip archive containing:
//!
//! - `manifest.json` — required, validates against module manifest schema
//! - `*.lua` files — Lua scripts
//! - `*.sql` files — SQLite migration scripts
//!
//! # Example
//!
//! ```no_run
//! # use kasirmu_plugin::package::KasirpkArchive;
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let archive = KasirpkArchive::open("path/to/plugin.kasirpkg")?;
//! let manifest = archive.manifest();
//! let scripts = archive.scripts();
//! # Ok(())
//! # }

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::PluginError;

/// Maximum number of entries allowed in an `.kasirpkg` archive (PLG-06).
const MAX_ARCHIVE_ENTRIES: usize = 512;
/// Maximum compressed size of a single entry, in bytes (PLG-06).
const MAX_ENTRY_COMPRESSED_SIZE: u64 = 8 * 1024 * 1024; // 8 MiB
/// Maximum uncompressed size of a single entry, in bytes (PLG-06).
const MAX_ENTRY_UNCOMPRESSED_SIZE: u64 = 16 * 1024 * 1024; // 16 MiB
/// Maximum total uncompressed size across all entries, in bytes (PLG-06).
const MAX_TOTAL_UNCOMPRESSED_SIZE: u64 = 64 * 1024 * 1024; // 64 MiB
/// Maximum acceptable compression ratio (uncompressed ÷ compressed) —
/// defends against zip-bomb archives (PLG-06).
const MAX_COMPRESSION_RATIO: u64 = 100;

/// Validate an archive entry name and return its forward-slash normalised form.
///
/// Rejects absolute paths, Windows drive/UNC prefixes, empty or `.` components,
/// and any `..` component so an untrusted archive can never write outside the
/// destination directory during extraction (PLG-01).
pub(crate) fn sanitise_entry_name(name: &str) -> Result<String, PluginError> {
    let normalised = name.replace('\\', "/");
    // Check UNC before the single-slash absolute check: `//server/share/...`
    // must be reported as a UNC path, not just an absolute one.
    if normalised.starts_with("//") {
        return Err(PluginError::Archive(format!(
            "entry name '{name}' is a UNC path — rejected"
        )));
    }
    if normalised.starts_with('/') {
        return Err(PluginError::Archive(format!(
            "entry name '{name}' is an absolute path — rejected"
        )));
    }
    // Windows drive prefix, e.g. `C:` or `C:/...`.
    if normalised.len() >= 2 && normalised.as_bytes()[1] == b':' {
        return Err(PluginError::Archive(format!(
            "entry name '{name}' contains a drive prefix — rejected"
        )));
    }
    for component in normalised.split('/') {
        match component {
            "" | "." => {
                return Err(PluginError::Archive(format!(
                    "entry name '{name}' contains an empty or '.' component — rejected"
                )));
            }
            ".." => {
                return Err(PluginError::Archive(format!(
                    "entry name '{name}' contains a '..' component — rejected"
                )));
            }
            _ => {}
        }
    }
    Ok(normalised)
}

/// The recognised entry types inside an `.kasirpkg` archive.
#[derive(Debug, Clone, PartialEq)]
pub enum KasirpkEntry {
    /// The parsed `manifest.json` value.
    Manifest(Value),
    /// A Lua script — filename stored as canonical path inside archive.
    Script(String),
    /// A SQL migration script.
    Migration(String),
    /// Any other file not recognised as script or migration.
    Other(String),
}

impl KasirpkEntry {
    /// The filename (last component) of this entry.
    pub fn filename(&self) -> &str {
        match self {
            KasirpkEntry::Manifest(_) => "manifest.json",
            KasirpkEntry::Script(name) | KasirpkEntry::Migration(name) | KasirpkEntry::Other(name) => name,
        }
    }

    /// Returns `true` if this entry is a Lua script.
    pub fn is_script(&self) -> bool {
        matches!(self, KasirpkEntry::Script(_))
    }

    /// Returns `true` if this entry is a migration.
    pub fn is_migration(&self) -> bool {
        matches!(self, KasirpkEntry::Migration(_))
    }
}

/// An opened `.kasirpkg` archive.
#[derive(Debug, Clone)]
pub struct KasirpkArchive {
    path: PathBuf,
    parsed_manifest: Option<Value>,
    entries: Vec<(String, KasirpkEntry)>,
    entry_contents: HashMap<String, Vec<u8>>,
}

impl KasirpkArchive {
    /// Open and parse an `.kasirpkg` archive from a file path.
    ///
    /// Reads the entire archive into memory, validates that `manifest.json`
    /// exists and is valid JSON, and classifies all entries by extension.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, PluginError> {
        let path = path.as_ref().to_path_buf();
        let file = std::fs::File::open(&path)?;
        let mut reader = std::io::BufReader::new(file);
        Self::from_reader(&mut reader, path)
    }

    /// Open an `.kasirpkg` archive from an in-memory byte buffer.
    ///
    /// Used primarily in tests and when loading from a network source.
    pub fn from_bytes(bytes: &[u8], name: impl Into<PathBuf>) -> Result<Self, PluginError> {
        let path: PathBuf = name.into();
        let mut reader = std::io::Cursor::new(bytes);
        Self::from_reader(&mut reader, path)
    }

    /// Shared constructor from any `Read + Seek` source.
    fn from_reader<R>(reader: &mut R, path: PathBuf) -> Result<Self, PluginError>
    where
        R: std::io::Read + std::io::Seek,
    {
        let mut archive =
            zip::ZipArchive::new(reader).map_err(|e| PluginError::Archive(e.to_string()))?;

        let mut parsed_manifest: Option<Value> = None;
        let mut entries: Vec<(String, KasirpkEntry)> = Vec::new();
        let mut entry_contents: HashMap<String, Vec<u8>> = HashMap::new();
        let mut manifest_found = false;
        let mut total_uncompressed: u64 = 0;

        for i in 0..archive.len() {
            if i >= MAX_ARCHIVE_ENTRIES {
                return Err(PluginError::Archive(format!(
                    "archive exceeds maximum entry count ({MAX_ARCHIVE_ENTRIES})"
                )));
            }

            let file = archive
                .by_index(i)
                .map_err(|e| PluginError::Archive(e.to_string()))?;

            // Skip directories
            if file.is_dir() {
                continue;
            }

            // Reject traversal / absolute / drive-prefixed entry names at parse
            // time so a malicious archive fails closed (PLG-01).
            let name = sanitise_entry_name(file.name())?;

            // Resource limits (PLG-06): compressed size, uncompressed size, and
            // compression ratio are all checked BEFORE buffering, so a zip-bomb
            // archive cannot exhaust memory or disk during decompression.
            if file.compressed_size() > MAX_ENTRY_COMPRESSED_SIZE {
                return Err(PluginError::Archive(format!(
                    "entry '{name}' exceeds maximum compressed size ({MAX_ENTRY_COMPRESSED_SIZE} bytes)"
                )));
            }
            if file.size() > MAX_ENTRY_UNCOMPRESSED_SIZE {
                return Err(PluginError::Archive(format!(
                    "entry '{name}' exceeds maximum uncompressed size ({MAX_ENTRY_UNCOMPRESSED_SIZE} bytes)"
                )));
            }
            if file.size() / file.compressed_size().max(1) > MAX_COMPRESSION_RATIO {
                return Err(PluginError::Archive(format!(
                    "entry '{name}' has an excessive compression ratio (possible zip bomb)"
                )));
            }

            // Read at most MAX_ENTRY_UNCOMPRESSED_SIZE + 1 bytes, then verify
            // the cap was not exceeded (defense in depth against a size mismatch
            // between the central-directory header and the actual stream).
            let mut data = Vec::new();
            file.take(MAX_ENTRY_UNCOMPRESSED_SIZE + 1)
                .read_to_end(&mut data)
                .map_err(|e| PluginError::Archive(e.to_string()))?;
            if data.len() as u64 > MAX_ENTRY_UNCOMPRESSED_SIZE {
                return Err(PluginError::Archive(format!(
                    "entry '{name}' exceeds maximum uncompressed size ({MAX_ENTRY_UNCOMPRESSED_SIZE} bytes)"
                )));
            }
            total_uncompressed = total_uncompressed
                .checked_add(data.len() as u64)
                .ok_or_else(|| PluginError::Archive("uncompressed size overflow".into()))?;
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
                return Err(PluginError::Archive(format!(
                    "archive total uncompressed size exceeds limit ({MAX_TOTAL_UNCOMPRESSED_SIZE} bytes)"
                )));
            }

            // Normalise path separators to forward-slash for consistent matching
            let normalised = name.replace('\\', "/");
            let filename = normalised
                .rsplit('/')
                .next()
                .unwrap_or(&normalised)
                .to_string();

            let entry = if filename == "manifest.json" {
                manifest_found = true;
                let value: Value = serde_json::from_slice(&data)
                    .map_err(|e| PluginError::Archive(format!("invalid manifest.json: {e}")))?;
                parsed_manifest = Some(value.clone());
                KasirpkEntry::Manifest(value)
            } else if filename.ends_with(".lua") {
                KasirpkEntry::Script(filename.clone())
            } else if filename.ends_with(".sql") {
                KasirpkEntry::Migration(filename.clone())
            } else {
                KasirpkEntry::Other(filename.clone())
            };

            entries.push((name.clone(), entry));
            entry_contents.insert(name, data);
        }

        if !manifest_found {
            return Err(PluginError::Archive(
                "missing manifest.json in .kasirpkg archive".into(),
            ));
        }

        Ok(Self {
            path,
            parsed_manifest,
            entries,
            entry_contents,
        })
    }

    /// The file path this archive was opened from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns a reference to the parsed `manifest.json`, if it was found.
    pub fn manifest(&self) -> Option<&Value> {
        self.parsed_manifest.as_ref()
    }

    /// Returns the names of all Lua script entries in the archive.
    pub fn scripts(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|(_, e)| match e {
                KasirpkEntry::Script(name) => Some(name.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Returns the names of all SQL migration entries in the archive.
    pub fn migrations(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|(_, e)| match e {
                KasirpkEntry::Migration(name) => Some(name.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Returns all entries in insertion order.
    pub fn entries(&self) -> &[(String, KasirpkEntry)] {
        &self.entries
    }

    /// The total number of entries in the archive.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns `true` if the archive is empty (no entries at all).
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Read the raw bytes of an entry by its filename (last path component).
    ///
    /// Returns `None` if no entry matches exactly.
    pub fn read_entry(&self, filename: &str) -> Option<&[u8]> {
        // Try exact match first
        if let Some(data) = self.entry_contents.get(filename) {
            return Some(data.as_slice());
        }
        // Fall back to matching on the last path component
        let normalised = filename.replace('\\', "/");
        let target = normalised
            .rsplit('/')
            .next()
            .unwrap_or(&normalised)
            .to_string();
        for (stored_name, data) in &self.entry_contents {
            let stored_normalised = stored_name.replace('\\', "/");
            let stored_file = stored_normalised
                .rsplit('/')
                .next()
                .unwrap_or(&stored_normalised);
            if stored_file == target {
                return Some(data.as_slice());
            }
        }
        None
    }

    /// Read the raw bytes of an entry by its exact path inside the archive.
    ///
    /// Unlike `read_entry`, this does not fall back to filename matching.
    pub fn read_entry_exact(&self, exact_path: &str) -> Option<&[u8]> {
        self.entry_contents.get(exact_path).map(Vec::as_slice)
    }

    /// Extract all entries from the archive into a destination directory.
    ///
    /// Creates the destination directory if it doesn't exist. Maintains the
    /// directory structure from inside the archive for paths with `/` or `\`.
    pub fn extract_to(&self, dest: impl AsRef<Path>) -> Result<(), PluginError> {
        let dest = dest.as_ref();
        std::fs::create_dir_all(dest)?;
        // Canonicalise the destination so every written file can be verified to
        // remain inside it (PLG-01). Entry names are already sanitised at parse
        // time; this containment check is defense in depth for any future code
        // path that constructs an `KasirpkArchive` with raw names.
        let canonical_dest = std::fs::canonicalize(dest)?;

        for (name, data) in &self.entry_contents {
            let safe_name = sanitise_entry_name(name)?;
            let target_path = canonical_dest.join(&safe_name);
            if !target_path.starts_with(&canonical_dest) {
                return Err(PluginError::Archive(format!(
                    "entry '{name}' resolves outside the destination directory — rejected"
                )));
            }
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&target_path, data)?;
        }

        Ok(())
    }

    /// Extract only the Lua scripts and SQL migrations (not other files) into
    /// subdirectories under `dest`.
    ///
    /// Creates `dest/scripts/` and `dest/migrations/` and writes the respective
    /// files there, flattening any directory structure.
    pub fn extract_scripts_and_migrations(
        &self,
        dest: impl AsRef<Path>,
    ) -> Result<(), PluginError> {
        let dest = dest.as_ref();

        let scripts_dir = dest.join("scripts");
        let migrations_dir = dest.join("migrations");

        for (_, entry) in &self.entries {
            match entry {
                KasirpkEntry::Script(name) => {
                    if let Some(data) = self.read_entry(name) {
                        let safe = sanitise_entry_name(name)?;
                        std::fs::create_dir_all(&scripts_dir)?;
                        std::fs::write(scripts_dir.join(safe), data)?;
                    }
                }
                KasirpkEntry::Migration(name) => {
                    if let Some(data) = self.read_entry(name) {
                        let safe = sanitise_entry_name(name)?;
                        std::fs::create_dir_all(&migrations_dir)?;
                        std::fs::write(migrations_dir.join(safe), data)?;
                    }
                }
                _ => {}
            }
        }

        Ok(())
    }

    /// Returns `true` if the archive contains any Lua script entries.
    pub fn has_scripts(&self) -> bool {
        self.entries.iter().any(|(_, e)| e.is_script())
    }

    /// Returns `true` if the archive contains any SQL migration entries.
    pub fn has_migrations(&self) -> bool {
        self.entries.iter().any(|(_, e)| e.is_migration())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "package_tests.rs"]
mod tests;
