//! Unit tests for `terminal_profile`.
//!
//! Moved out of `terminal_profile.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `terminal_profile.rs` with:
//!   `#[cfg(test)] #[path = "terminal_profile_tests.rs"] mod tests;`

use super::*;

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn default_profile_has_sensible_values() {
    let p = TerminalProfile::default();
    assert_eq!(p.printer_connection, "auto");
    assert_eq!(p.printer_device_path, "");
    assert_eq!(p.printer_paper_size, "80");
    assert_eq!(p.scanner_device_id, "");
    assert_eq!(p.scanner_input_mode, "auto");
    // Scale defaults
    assert_eq!(p.scale_connection, "none");
    assert_eq!(p.scale_device_path, "");
    assert_eq!(p.scale_baud_rate, 9600);
    assert!(!p.scale_zero_on_boot);
    // Kitchen printer defaults
    assert_eq!(p.kitchen_printer_connection, "disabled");
    assert_eq!(p.kitchen_printer_device_path, "");
    // Schema version
    assert_eq!(p.schema_version, 1);
    // Local-prefs defaults
    assert_eq!(p.sound_volume, 80);
    assert!(!p.dark_mode);
    assert!(p.scale_auto_zero);
}

#[test]
fn save_and_load_roundtrip() {
    let dir = temp_dir();
    let path = TerminalProfile::profile_path(dir.path(), "term-001");

    let profile = TerminalProfile {
        printer_connection: "network".into(),
        printer_device_path: "192.168.1.100".into(),
        printer_paper_size: "58".into(),
        scanner_device_id: "scanner-001".into(),
        scanner_input_mode: "serial".into(),
        scale_connection: "serial".into(),
        scale_device_path: "COM3".into(),
        scale_baud_rate: 115200,
        scale_zero_on_boot: true,
        kitchen_printer_connection: "network".into(),
        kitchen_printer_device_path: "192.168.1.51".into(),
        schema_version: 1,
        sound_volume: 60,
        dark_mode: true,
        scale_auto_zero: false,
    };

    profile.save(&path).unwrap();
    assert!(path.exists());

    let loaded = TerminalProfile::load(&path).unwrap().unwrap();
    assert_eq!(loaded, profile);
}

#[test]
fn load_returns_none_for_missing_file() {
    let dir = temp_dir();
    let path = TerminalProfile::profile_path(dir.path(), "nonexistent");
    assert!(TerminalProfile::load(&path).unwrap().is_none());
}

#[test]
fn profile_path_uses_terminal_id() {
    let path = TerminalProfile::profile_path(Path::new("/data"), "reg-42");
    assert_eq!(path, PathBuf::from("/data/terminal_profiles/reg-42.json"));
}

#[test]
fn ensure_default_creates_profile() {
    let dir = temp_dir();
    let created = TerminalProfile::ensure_default(dir.path(), "new-term").unwrap();
    assert!(created);

    let path = TerminalProfile::profile_path(dir.path(), "new-term");
    assert!(path.exists());

    let loaded = TerminalProfile::load(&path).unwrap().unwrap();
    assert_eq!(loaded, TerminalProfile::default());
}

#[test]
fn ensure_default_is_idempotent() {
    let dir = temp_dir();
    assert!(TerminalProfile::ensure_default(dir.path(), "term").unwrap());
    assert!(!TerminalProfile::ensure_default(dir.path(), "term").unwrap());
}

#[test]
fn save_overwrites_existing() {
    let dir = temp_dir();
    let path = TerminalProfile::profile_path(dir.path(), "term");

    let p1 = TerminalProfile {
        printer_connection: "usb".into(),
        ..Default::default()
    };
    p1.save(&path).unwrap();

    let p2 = TerminalProfile {
        printer_connection: "network".into(),
        ..Default::default()
    };
    p2.save(&path).unwrap();

    let loaded = TerminalProfile::load(&path).unwrap().unwrap();
    assert_eq!(loaded.printer_connection, "network");
}

#[test]
fn three_phase_commit_no_leftover_tmp_or_bak() {
    let dir = temp_dir();
    let path = TerminalProfile::profile_path(dir.path(), "term");

    let profile = TerminalProfile::default();
    profile.save(&path).unwrap();

    assert!(!path.with_extension("tmp").exists());
    assert!(!path.with_extension("bak").exists());
    assert!(path.exists());
}

#[test]
fn serde_roundtrip_preserves_all_fields() {
    let json = r#"{
        "printer_connection": "serial",
        "printer_device_path": "/dev/ttyUSB0",
        "printer_paper_size": "a4",
        "scanner_device_id": "scan-42",
        "scanner_input_mode": "keyboard"
    }"#;

    let profile: TerminalProfile = serde_json::from_str(json).unwrap();
    assert_eq!(profile.printer_connection, "serial");
    assert_eq!(profile.printer_device_path, "/dev/ttyUSB0");
    assert_eq!(profile.printer_paper_size, "a4");
    assert_eq!(profile.scanner_device_id, "scan-42");
    assert_eq!(profile.scanner_input_mode, "keyboard");
    // New fields get defaults (backward compatible)
    assert_eq!(profile.scale_connection, "none");
    assert_eq!(profile.sound_volume, 80);

    let out = serde_json::to_string_pretty(&profile).unwrap();
    let roundtrip: TerminalProfile = serde_json::from_str(&out).unwrap();
    assert_eq!(roundtrip, profile);
}

#[test]
fn missing_fields_get_defaults() {
    let json = r#"{"printer_connection": "usb"}"#;
    let profile: TerminalProfile = serde_json::from_str(json).unwrap();
    assert_eq!(profile.printer_connection, "usb");
    assert_eq!(profile.printer_paper_size, "80"); // default
    assert_eq!(profile.scanner_input_mode, "auto"); // default
    assert_eq!(profile.scale_connection, "none"); // new default
    assert!(!profile.dark_mode); // new default
}

#[test]
fn multiple_terminals_have_separate_profiles() {
    let dir = temp_dir();

    let p_a = TerminalProfile {
        printer_connection: "usb".into(),
        ..Default::default()
    };
    p_a.save(&TerminalProfile::profile_path(dir.path(), "term-a"))
        .unwrap();

    let p_b = TerminalProfile {
        printer_connection: "network".into(),
        ..Default::default()
    };
    p_b.save(&TerminalProfile::profile_path(dir.path(), "term-b"))
        .unwrap();

    let loaded_a = TerminalProfile::load(&TerminalProfile::profile_path(dir.path(), "term-a"))
        .unwrap()
        .unwrap();
    let loaded_b = TerminalProfile::load(&TerminalProfile::profile_path(dir.path(), "term-b"))
        .unwrap()
        .unwrap();

    assert_eq!(loaded_a.printer_connection, "usb");
    assert_eq!(loaded_b.printer_connection, "network");
}
