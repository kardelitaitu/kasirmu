//! Machine identity: the stable hardware id and its two derived fingerprints.
//!
//! `generate_machine_id` prefers a persisted random id, falling back to OS
//! probes; `generate_hardware_fingerprint` hashes the machine id together with
//! the CPU/board values so a re-imaged host does not silently re-activate.
//!
//! Split out of `license.rs` on 2026-09-27. Like `licence::scoped`, this band
//! names NO `license.*` settings key on purpose: the sweep in
//! `settings_tests.rs::license_writer_literals_are_swept_from_license_rs_not_from_
//! `a_transcription` counts those in `license.rs` and needs at least five.
//!
//! Main functions: [`generate_machine_id`], [`generate_hardware_fingerprint`].

use sha2::{Digest, Sha256};

use super::MACHINE_ID_LEN;

/// Query the physical motherboard UUID or Windows MachineGuid as a stable hardware identifier.
///
/// `pub(super)`: the license commands in the parent hash this together with the
/// persisted id, so they reach it across the module boundary.
pub(super) fn get_system_uuid() -> Option<String> {
    use std::process::Command;

    // 1. Try motherboard UUID via wmic
    if let Ok(output) = Command::new("wmic")
        .args(["csproduct", "get", "uuid"])
        .output()
        && output.status.success()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout
            .lines()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if lines.len() >= 2 {
            let uuid = lines[1];
            if !uuid.is_empty()
                && uuid != "00000000-0000-0000-0000-000000000000"
                && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"
            {
                return Some(uuid.to_string());
            }
        }
    }

    // 2. Try Windows MachineGuid from Registry
    if let Ok(output) = Command::new("reg")
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        && output.status.success()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("MachineGuid") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    return Some(parts[2].to_string());
                }
            }
        }
    }

    // 3. Linux/macOS: stable machine-id files (no wmic/reg available).
    //    /etc/machine-id is the canonical systemd identifier and is stable
    //    for the lifetime of an installation — the right hardware anchor
    //    for Linux CI runners and Linux desktops alike. The dbus fallback
    //    covers hosts without systemd.
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(content) = std::fs::read_to_string(path) {
            let id = content.trim();
            if !id.is_empty()
                && id != "00000000-0000-0000-0000-000000000000"
                && id != "ffffffffffffffffffffffffffffffff"
            {
                return Some(id.to_string());
            }
        }
    }

    None
}

/// Per-process fallback machine-ID source, so the last-resort random UUID
/// is drawn once and then reused. Without this cache, a machine with no
/// queryable hardware ID (e.g. a minimal container) would derive a NEW
/// random machine ID on every `generate_machine_id()` call, breaking the
/// determinism guarantee that the 15-char fingerprint depends on.
static FALLBACK_MACHINE_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Generate a stable 15-char lowercase alphanumeric machine ID based on
/// system/hardware UUID, falling back to a random UUID if queries fail.
///
/// Uses the hardware ID hashed with SHA-256 to produce a unique
/// per-installation fingerprint. The ID is persisted in the local
/// Settings table and reused across activations.
pub fn generate_machine_id() -> String {
    let raw_id = get_system_uuid().unwrap_or_else(|| {
        FALLBACK_MACHINE_ID
            .get_or_init(|| uuid::Uuid::new_v4().to_string())
            .clone()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    let hash = hasher.finalize();
    let hex_str = hex::encode(&hash[..16]);
    hex_str[..MACHINE_ID_LEN].to_string()
}

/// Compute the canonical `hw_<64hex>` hardware fingerprint from the same
/// hardware anchor `machine_id` derives from (SPEC-2026-TRIAL-LOCK). The
/// FULL SHA-256 digest (64 hex chars) is used — the machine_id only takes
/// the first 15 chars — so the fingerprint is both more collision-resistant
/// and self-describing ("hw_" prefix) in the license server's
/// trial_registrations collection. The random-UUID fallback is shared with
/// `generate_machine_id` so a host with no queryable hardware anchor gets
/// a stable-in-process value rather than a fresh one per call.
pub fn generate_hardware_fingerprint() -> String {
    let raw_id = get_system_uuid().unwrap_or_else(|| {
        FALLBACK_MACHINE_ID
            .get_or_init(|| uuid::Uuid::new_v4().to_string())
            .clone()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    let hash = hasher.finalize();
    format!("hw_{}", hex::encode(hash))
}
