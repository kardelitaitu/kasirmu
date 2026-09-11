//! Tests for the CLI `.ozpkg` settings gate.
//!
//! A `.ozpkg` is a *portable* artefact — written to a file, carried to another
//! install, decrypted with a shared password — so the invariant documented in
//! `platform_core::settings::keys` applies to this lane too: credential keys
//! and device-bound identities never travel in a portable export or restore
//! package, in EITHER direction. The desktop bridge and the tablet shell have
//! asserted that for a while; `oz export-ozpkg` / `oz import-ozpkg` filtered
//! nothing, which is the hole these tests pin shut.
//!
//! Keys are named by the same constants the shared deny list is built from,
//! never retyped string literals, so renaming a key moves the assertion with
//! it instead of silently dropping coverage.

use super::*;
use oz_core::ozpkg::{OzpkgPayload, export_ozpkg, import_ozpkg};

/// Password for throwaway packages. Non-empty: `export_ozpkg` refuses an
/// empty password (B50) and the CLI passes `--password` straight through.
const PWD: &str = "correct-horse-battery-staple";

/// Credential and device-bound keys that must never appear in a portable
/// package — and must never be written back from one.
const MUST_NOT_TRAVEL: &[&str] = &[
    keys::LOCAL_API_SECRET,
    keys::SYNC_TERMINAL_SECRET,
    keys::LICENSE_API_KEY,
    keys::STRIPE_API_KEY,
    keys::MIDTRANS_SERVER_KEY,
    keys::MACHINE_ID,
    keys::SYNC_TERMINAL_ID,
];

/// Ordinary, machine-portable settings a store expects to move between
/// installs — proof the gate is a filter, not a deleted arm.
const MUST_TRAVEL: &[&str] = &[keys::STORE_NAME, keys::DEFAULT_CURRENCY];

/// Seed a source database with both halves of the settings table: the
/// ordinary rows that must survive and the secrets that must not.
fn seeded_source_db() -> Connection {
    let conn = oz_core::migrations::fresh_db();
    let rows: &[(&str, &str)] = &[
        (keys::STORE_NAME, "Warung Sedap"),
        (keys::DEFAULT_CURRENCY, "IDR"),
        (keys::RECEIPT_FOOTER, "Terima kasih"),
        (keys::LOCAL_API_SECRET, "src-local-api-signing-secret"),
        (keys::SYNC_TERMINAL_SECRET, "src-terminal-secret"),
        (keys::LICENSE_API_KEY, "src-license-api-key"),
        (keys::STRIPE_API_KEY, "sk_live_src_stripe"),
        (keys::MIDTRANS_SERVER_KEY, "midtrans-src-server-key"),
        (keys::MACHINE_ID, "src-machine-fingerprint"),
        (keys::SYNC_TERMINAL_ID, "src-terminal-id"),
    ];
    for (key, value) in rows {
        Settings::set(&conn, key, value).unwrap();
    }
    conn
}

/// A unique temp path (uuid keeps parallel test runs from colliding).
fn temp_path(tag: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "oz-cli-ozpkg-{tag}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ))
}

/// Decrypt a package written by the CLI and return its settings rows.
fn exported_settings(path: &std::path::Path) -> Vec<(String, String)> {
    let bytes = std::fs::read(path).expect("export file must exist");
    let (_header, payload) = import_ozpkg(&bytes, PWD).expect("package must decrypt");
    payload
        .settings
        .expect("settings arm present when --types settings")
        .into_iter()
        .map(|row| {
            (
                row.get("key")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_owned(),
                row.get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect()
}

/// One settings value as raw bytes — `None` when the row is absent, so
/// "byte-identical" is asserted literally rather than through a lossy String.
fn setting_bytes(conn: &Connection, key: &str) -> Option<Vec<u8>> {
    Settings::get(conn, key).unwrap().map(String::into_bytes)
}

/// Build a package by hand that still carries secrets — exactly what an
/// `.ozpkg` produced by an OLDER build looks like — and return its path.
/// `export_ozpkg` is the unfiltered crypto layer, so whatever is put here is
/// what lands in the file regardless of what the CLI export arm withholds.
fn legacy_package(rows: &[(&str, &str)]) -> std::path::PathBuf {
    let path = temp_path("legacy");
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: Some(
            rows.iter()
                .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
                .collect(),
        ),
    };
    let bytes = export_ozpkg(
        PWD,
        "Legacy Store",
        "0.0.0-older-build",
        vec!["settings".into()],
        HashMap::new(),
        &payload,
    )
    .unwrap();
    std::fs::write(&path, &bytes).unwrap();
    path
}

// ── egress: `oz export-ozpkg` ─────────────────────────────────────────

#[test]
fn ozpkg_export_withholds_secret_and_device_bound_settings() {
    let conn = seeded_source_db();
    let path = temp_path("export");
    run_export_ozpkg(&conn, path.to_str().unwrap(), "settings", PWD).unwrap();

    let exported: Vec<String> = exported_settings(&path)
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    for forbidden in MUST_NOT_TRAVEL {
        assert!(
            !exported.iter().any(|k| k == forbidden),
            "portable package must not carry {forbidden}; got {exported:?}"
        );
    }
    let _ = std::fs::remove_file(&path);
}

#[test]
fn ozpkg_export_still_carries_ordinary_settings() {
    // Guards against "fixing" the hole by dropping the settings arm whole:
    // the store name and currency are the point of exporting settings, so
    // they must survive the filter with their values intact.
    let conn = seeded_source_db();
    let path = temp_path("export-plain");
    run_export_ozpkg(&conn, path.to_str().unwrap(), "settings", PWD).unwrap();

    let rows = exported_settings(&path);
    for wanted in MUST_TRAVEL {
        assert!(
            rows.iter().any(|(k, _)| k == wanted),
            "ordinary setting {wanted} must survive the export filter; got {rows:?}"
        );
    }
    assert!(
        rows.iter()
            .any(|(k, v)| k == keys::STORE_NAME && v == "Warung Sedap"),
        "store.name must keep its value, got {rows:?}"
    );
    let _ = std::fs::remove_file(&path);
}

// ── ingress: `oz import-ozpkg` ────────────────────────────────────────

#[test]
fn ozpkg_import_leaves_install_secrets_byte_identical() {
    // The half people forget. An older package still carries the source
    // install's credentials and identity; restoring it must not overwrite
    // this machine's values — every guarded key comes back byte-identical.
    let own: &[(&str, &str)] = &[
        (keys::LOCAL_API_SECRET, "own-local-api-signing-secret"),
        (keys::SYNC_TERMINAL_SECRET, "own-terminal-secret"),
        (keys::LICENSE_API_KEY, "own-license-api-key"),
        (keys::STRIPE_API_KEY, "sk_live_own_stripe"),
        (keys::MIDTRANS_SERVER_KEY, "midtrans-own-server-key"),
        (keys::MACHINE_ID, "own-machine-fingerprint"),
        (keys::SYNC_TERMINAL_ID, "own-terminal-id"),
        (keys::STORE_NAME, "Own Store"),
    ];
    let conn = oz_core::migrations::fresh_db();
    for (key, value) in own {
        Settings::set(&conn, key, value).unwrap();
    }
    let before: Vec<Option<Vec<u8>>> = MUST_NOT_TRAVEL
        .iter()
        .map(|key| setting_bytes(&conn, key))
        .collect();
    assert_eq!(
        before.iter().filter(|v| v.is_some()).count(),
        MUST_NOT_TRAVEL.len(),
        "test setup: this install must hold every guarded key before import"
    );

    let injected: Vec<(&str, &str)> = MUST_NOT_TRAVEL
        .iter()
        .map(|key| (*key, "FROM-FOREIGN-PACKAGE"))
        .collect();
    let path = legacy_package(&injected);

    run_import_ozpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    for (index, key) in MUST_NOT_TRAVEL.iter().enumerate() {
        assert_eq!(
            setting_bytes(&conn, key),
            before[index],
            "restoring an older package must leave this install's {key} byte-identical"
        );
    }
    let _ = std::fs::remove_file(&path);
}

#[test]
fn ozpkg_import_still_restores_ordinary_settings() {
    // The same arm keeps doing its job on portable rows, otherwise the gate
    // is a sledgehammer rather than a filter.
    let conn = oz_core::migrations::fresh_db();
    Settings::set(&conn, keys::STORE_NAME, "Own Store").unwrap();
    let path = legacy_package(&[
        (keys::STORE_NAME, "Packaged Store"),
        (keys::LOCAL_API_SECRET, "FROM-FOREIGN-PACKAGE"),
    ]);

    run_import_ozpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    assert_eq!(
        setting_bytes(&conn, keys::STORE_NAME),
        Some(b"Packaged Store".to_vec())
    );
    assert_eq!(
        setting_bytes(&conn, keys::LOCAL_API_SECRET),
        None,
        "the secret row must be skipped outright, not written"
    );
    let _ = std::fs::remove_file(&path);
}

// ── the gate itself ───────────────────────────────────────────────────

#[test]
fn ozpkg_portable_gate_agrees_with_shared_predicate() {
    // Pins the shape the next slice depends on: the lane asks ONE named
    // boundary, and that boundary answers like the shared predicate for a
    // credential, a device id and an ordinary key.
    assert!(!is_portable_settings_key(keys::LOCAL_API_SECRET));
    assert!(!is_portable_settings_key(keys::LICENSE_API_KEY));
    assert!(!is_portable_settings_key(keys::MACHINE_ID));
    assert!(!is_portable_settings_key(keys::SYNC_TERMINAL_ID));
    assert!(is_portable_settings_key(keys::STORE_NAME));
    assert!(is_portable_settings_key(keys::DEFAULT_CURRENCY));
    for probe in ["brand.primary_colour", "ui.locale", "tax.rounding_mode"] {
        assert_eq!(
            is_portable_settings_key(probe),
            !keys::is_non_exportable_setting_key(probe),
            "CLI gate drifted from the shared predicate on {probe}"
        );
    }
}
