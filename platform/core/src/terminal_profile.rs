/*
last audited 25-07-26 by RSA-Agent (platform-core slice E: terminal_profile verified)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean typed kiosk-profile persistence (save/load/ensure-default); PC-1 INFO: filename interpolates terminal_id without sanitization (line 173) - same hardening note as manager.rs store paths; ids UUID-minted in normal flows
next: sanitize terminal ids (PC-1) | perf: N/A
*/
//! Per-terminal hardware profile — stores printer, scanner, scale, and
//! local preference configuration in per-terminal JSON files under
//! `terminal_profiles/`.
//!
//! ## File layout
//!
//! ```text
//! {app_data_dir}/terminal_profiles/
//!   ├── terminal-001.json
//!   ├── terminal-002.json
//!   └── unknown.json
//! ```
//!
//! ## Crash-safe writes (ADR #22)
//!
//! Every save uses write-to-temp-then-atomic-rename:
//! 1. Write to `<path>.tmp`
//! 2. Rename old → `<path>.bak` (best-effort backup)
//! 3. Rename `<path>.tmp` → `<path>` (atomic on most filesystems)
//! 4. Remove `<path>.bak` on success
//!
//! If the process crashes mid-write, either the original or the new
//! profile survives — never a partial write.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::PlatformError;

/// Per-terminal hardware and local-preference configuration stored in
/// `terminal_profiles/<id>.json`.
///
/// Missing fields in existing (pre-expansion) JSON files fall back to
/// serde defaults so old profiles are forward-compatible.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerminalProfile {
    /// Printer connection type: `"network"`, `"usb"`, `"serial"`, `"auto"`.
    #[serde(default = "default_printer_connection")]
    pub printer_connection: String,

    /// Printer device path or IP address.
    #[serde(default)]
    pub printer_device_path: String,

    /// Printer paper size: `"58"`, `"80"`, `"a4"`, `"letter"`.
    #[serde(default = "default_printer_paper_size")]
    pub printer_paper_size: String,

    /// Selected scanner device ID.
    #[serde(default)]
    pub scanner_device_id: String,

    /// Scanner input mode: `"auto"`, `"keyboard"`, `"serial"`.
    #[serde(default = "default_scanner_input_mode")]
    pub scanner_input_mode: String,

    // ── Scale (ADR #22 Phase 2) ──────────────────────────────
    /// Scale connection type: `"serial"`, `"usb"`, `"none"`.
    #[serde(default = "default_scale_connection")]
    pub scale_connection: String,

    /// Scale device path (e.g. `/dev/ttyUSB0`, `COM3`).
    #[serde(default)]
    pub scale_device_path: String,

    /// Scale baud rate (default 9600).
    #[serde(default = "default_scale_baud_rate")]
    pub scale_baud_rate: u32,

    /// Zero the scale automatically on boot.
    #[serde(default = "default_scale_zero_on_boot")]
    pub scale_zero_on_boot: bool,

    // ── Kitchen printer ───────────────────────────────────
    /// Kitchen printer connection type: `"network"`, `"usb"`, `"serial"`, `"disabled"`.
    #[serde(default = "default_kitchen_printer_connection")]
    pub kitchen_printer_connection: String,

    /// Kitchen printer device path or IP address.
    #[serde(default)]
    pub kitchen_printer_device_path: String,

    // ── Local preferences ────────────────────────────────────
    /// Sound volume percentage (0–100, default 80).
    #[serde(default = "default_sound_volume")]
    pub sound_volume: u32,

    /// Dark mode enabled.
    #[serde(default)]
    pub dark_mode: bool,

    /// Scale auto-zero after each transaction.
    #[serde(default = "default_scale_auto_zero")]
    pub scale_auto_zero: bool,

    // ── Schema version for forward-compatible evolution ──────────
    /// Schema version of this profile (incremented when fields are
    /// added, removed, or renamed). Starts at 1.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_printer_connection() -> String {
    "auto".into()
}

fn default_printer_paper_size() -> String {
    "80".into()
}

fn default_scanner_input_mode() -> String {
    "auto".into()
}

fn default_scale_connection() -> String {
    "none".into()
}

fn default_scale_baud_rate() -> u32 {
    9600
}

fn default_scale_zero_on_boot() -> bool {
    false
}

fn default_sound_volume() -> u32 {
    80
}

fn default_kitchen_printer_connection() -> String {
    "disabled".into()
}

fn default_schema_version() -> u32 {
    1
}

fn default_scale_auto_zero() -> bool {
    true
}

impl Default for TerminalProfile {
    fn default() -> Self {
        Self {
            printer_connection: default_printer_connection(),
            printer_device_path: String::new(),
            printer_paper_size: default_printer_paper_size(),
            scanner_device_id: String::new(),
            scanner_input_mode: default_scanner_input_mode(),
            scale_connection: default_scale_connection(),
            scale_device_path: String::new(),
            scale_baud_rate: default_scale_baud_rate(),
            scale_zero_on_boot: default_scale_zero_on_boot(),
            kitchen_printer_connection: default_kitchen_printer_connection(),
            kitchen_printer_device_path: String::new(),
            schema_version: default_schema_version(),
            sound_volume: default_sound_volume(),
            dark_mode: false,
            scale_auto_zero: default_scale_auto_zero(),
        }
    }
}

impl TerminalProfile {
    /// Build the filesystem path for a terminal's profile.
    ///
    /// Returns `<base_dir>/terminal_profiles/<terminal_id>.json`.
    pub fn profile_path(base_dir: &Path, terminal_id: &str) -> PathBuf {
        base_dir
            .join("terminal_profiles")
            .join(format!("{terminal_id}.json"))
    }

    /// Load a profile from disk. Returns `Ok(Some(profile))` if the file
    /// exists, `Ok(None)` if the file is missing (caller should use
    /// defaults), or `Err` on read/parse failure.
    pub fn load(path: &Path) -> Result<Option<Self>, PlatformError> {
        match fs::read_to_string(path) {
            Ok(json) => {
                let profile: TerminalProfile = serde_json::from_str(&json).map_err(|e| {
                    PlatformError::Internal(format!(
                        "failed to parse terminal profile {}: {e}",
                        path.display()
                    ))
                })?;
                Ok(Some(profile))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PlatformError::Internal(format!(
                "failed to read terminal profile {}: {e}",
                path.display()
            ))),
        }
    }

    /// Save a profile to disk using three-phase commit for crash safety.
    ///
    /// 1. Write to `<path>.tmp`
    /// 2. Rename `<path>` → `<path>.bak` (if exists)
    /// 3. Rename `<path>.tmp` → `<path>`
    /// 4. Remove `<path>.bak`
    pub fn save(&self, path: &Path) -> Result<(), PlatformError> {
        let tmp_path = path.with_extension("tmp");
        let bak_path = path.with_extension("bak");

        // Ensure parent directory exists.
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                PlatformError::Internal(format!(
                    "failed to create terminal profile dir {}: {e}",
                    parent.display()
                ))
            })?;
        }

        // Phase 1: Write to temp file.
        let json = serde_json::to_string_pretty(self).map_err(|e| {
            PlatformError::Internal(format!("failed to serialize terminal profile: {e}"))
        })?;
        fs::write(&tmp_path, &json).map_err(|e| {
            PlatformError::Internal(format!(
                "failed to write terminal profile tmp {}: {e}",
                tmp_path.display()
            ))
        })?;

        // Phase 2: Rename existing → backup (best-effort).
        if path.exists() {
            let _ = fs::rename(path, &bak_path);
        }

        // Phase 3: Rename temp → final.
        fs::rename(&tmp_path, path).map_err(|e| {
            let _ = fs::rename(&bak_path, path);
            PlatformError::Internal(format!(
                "failed to commit terminal profile {}: {e}",
                path.display()
            ))
        })?;

        // Phase 4: Clean up backup.
        let _ = fs::remove_file(&bak_path);

        Ok(())
    }

    /// Create a default profile and save it to disk if no profile exists
    /// for the given terminal. Returns `true` if a new profile was created.
    pub fn ensure_default(base_dir: &Path, terminal_id: &str) -> Result<bool, PlatformError> {
        let path = Self::profile_path(base_dir, terminal_id);
        if path.exists() {
            return Ok(false);
        }
        let profile = TerminalProfile::default();
        profile.save(&path)?;
        Ok(true)
    }
}

#[cfg(test)]
#[path = "terminal_profile_tests.rs"]
mod tests;
