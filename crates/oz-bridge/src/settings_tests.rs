//! Unit tests for the settings bridge module.
//!
//! Relocated from `apps/desktop-client/src/commands/settings_tests.rs` (Wave E /
//! EW1). The shell's `AppState::for_test` is replaced by the headless
//! `TestBridge` harness ([`crate::testing`]); the conn-taking `run_*`
//! helpers resolve against `oz_bridge::settings` directly via `use super::*`.
use super::*;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

/// The portable-package refusal, asked of the sealed policy directly.
///
/// Replaces the deleted bridge-local `is_non_exportable_key`, which was
/// `is_non_exportable_setting_key(key) || is_managed_key(key)` — exactly the
/// negation of what [`IngestPolicy::PortablePackage`] admits. The bridge kept
/// a hand-copied OR of two rules it did not own; asking the policy keeps ONE
/// rule in the tree, which is the whole point of the funnel.
fn refused_by_portable_package(key: &str) -> bool {
    !IngestPolicy::PortablePackage.admits(key)
}

// ── Token rejection tests ──────────────────────────────

#[test]
fn settings_scoped_rejects_invalid_token() {
    let tb = crate::testing::TestBridge::new();
    let result = tb.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Receipt settings tests ─────────────────────────────

#[test]
fn get_receipt_settings_returns_defaults() {
    let conn = fresh_conn();
    let result = run_get_receipt_settings(&conn).unwrap();

    assert!(!result.show_currency, "show_currency defaults to false");
    assert_eq!(result.decimal_separator, "dot");
    assert!(result.show_tax, "show_tax defaults to true");
    assert_eq!(result.footer, "");
    assert_eq!(result.paper_width, "standard");
    assert!(
        !result.show_table_number,
        "show_table_number defaults to false"
    );
    assert_eq!(result.margin_top, 0);
    assert_eq!(result.margin_bottom, 0);
    assert_eq!(result.margin_left, 0);
    assert_eq!(result.margin_right, 0);
    assert_eq!(result.tax_rounding_mode, "half_up");
}

#[test]
fn set_receipt_settings_persists() {
    let conn = fresh_conn();
    let dto = ReceiptSettingsDto {
        show_currency: false,
        decimal_separator: "comma".into(),
        show_tax: false,
        footer: "Thanks!".into(),
        paper_width: "narrow".into(),
        show_table_number: true,
        margin_top: 5,
        margin_bottom: 3,
        margin_left: 2,
        margin_right: 2,
        tax_rounding_mode: "truncate".into(),
    };

    run_set_receipt_settings(&conn, &dto).unwrap();
    let result = run_get_receipt_settings(&conn).unwrap();

    assert!(!result.show_currency);
    assert_eq!(result.decimal_separator, "comma");
    assert!(!result.show_tax);
    assert_eq!(result.footer, "Thanks!");
    assert_eq!(result.paper_width, "narrow");
    assert!(result.show_table_number);
    assert_eq!(result.margin_top, 5);
    assert_eq!(result.margin_bottom, 3);
    assert_eq!(result.margin_left, 2);
    assert_eq!(result.margin_right, 2);
    assert_eq!(result.tax_rounding_mode, "truncate");
}

#[test]
fn get_store_settings_returns_defaults() {
    let conn = fresh_conn();
    let result = run_get_store_settings(&conn).unwrap();

    assert_eq!(result.name, "");
    assert_eq!(result.address, "");
    assert_eq!(result.tax_id, "");
    assert_eq!(result.currency, "IDR");
    assert_eq!(result.branch, "");
    assert_eq!(result.logo, "");
}

#[test]
fn set_store_settings_persists() {
    let conn = fresh_conn();
    let dto = StoreSettingsDto {
        name: "My Coffee Shop".into(),
        address: "123 Main St".into(),
        tax_id: "TAX-12345".into(),
        currency: "USD".into(),
        branch: "Downtown".into(),
        logo: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAA".into(),
    };

    run_set_store_settings(&conn, &dto).unwrap();
    let result = run_get_store_settings(&conn).unwrap();

    assert_eq!(result.name, "My Coffee Shop");
    assert_eq!(result.address, "123 Main St");
    assert_eq!(result.tax_id, "TAX-12345");
    assert_eq!(result.currency, "USD");
    assert_eq!(result.branch, "Downtown");
    assert_eq!(result.logo, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAA");
}

#[test]
fn set_receipt_settings_overwrites_previous() {
    let conn = fresh_conn();

    run_set_receipt_settings(
        &conn,
        &ReceiptSettingsDto {
            show_currency: true,
            decimal_separator: "dot".into(),
            show_tax: false,
            footer: "v1".into(),
            paper_width: "standard".into(),
            show_table_number: false,
            margin_top: 0,
            margin_bottom: 0,
            margin_left: 0,
            margin_right: 0,
            tax_rounding_mode: "half_up".into(),
        },
    )
    .unwrap();

    run_set_receipt_settings(
        &conn,
        &ReceiptSettingsDto {
            show_currency: false,
            decimal_separator: "comma".into(),
            show_tax: true,
            footer: "v2".into(),
            paper_width: "narrow".into(),
            show_table_number: true,
            margin_top: 10,
            margin_bottom: 5,
            margin_left: 0,
            margin_right: 0,
            tax_rounding_mode: "half_up".into(),
        },
    )
    .unwrap();

    let result = run_get_receipt_settings(&conn).unwrap();

    assert!(!result.show_currency);
    assert_eq!(result.decimal_separator, "comma");
    assert!(result.show_tax);
    assert_eq!(result.footer, "v2");
    assert_eq!(result.paper_width, "narrow");
    assert!(result.show_table_number);
    assert_eq!(result.margin_top, 10);
    assert_eq!(result.margin_bottom, 5);
    assert_eq!(result.margin_left, 0);
    assert_eq!(result.margin_right, 0);
}

#[test]
fn set_store_settings_overwrites_previous() {
    let conn = fresh_conn();

    run_set_store_settings(
        &conn,
        &StoreSettingsDto {
            name: "Old Name".into(),
            address: "Old Address".into(),
            tax_id: "".into(),
            currency: "USD".into(),
            branch: "".into(),
            logo: "".into(),
        },
    )
    .unwrap();

    run_set_store_settings(
        &conn,
        &StoreSettingsDto {
            name: "New Name".into(),
            address: "New Address".into(),
            tax_id: "TAX-999".into(),
            currency: "IDR".into(),
            branch: "Mall".into(),
            logo: "logo_data".into(),
        },
    )
    .unwrap();

    let result = run_get_store_settings(&conn).unwrap();

    assert_eq!(result.name, "New Name");
    assert_eq!(result.address, "New Address");
    assert_eq!(result.tax_id, "TAX-999");
    assert_eq!(result.currency, "IDR");
    assert_eq!(result.branch, "Mall");
    assert_eq!(result.logo, "logo_data");
}

// -- DTO struct tests --

#[test]
fn receipt_settings_dto_debug() {
    let dto = ReceiptSettingsDto {
        show_currency: false,
        decimal_separator: "dot".into(),
        show_tax: true,
        footer: "Thanks".into(),
        paper_width: "standard".into(),
        show_table_number: false,
        margin_top: 0,
        margin_bottom: 0,
        margin_left: 0,
        margin_right: 0,
        tax_rounding_mode: "half_up".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Thanks"));
    assert!(d.contains("dot"));
}

#[test]
fn receipt_settings_dto_deserialize() {
    let json = r##"{"showCurrency":true,"decimalSeparator":"comma","showTax":false,"footer":"","paperWidth":"narrow","showTableNumber":true,"marginTop":5,"marginBottom":3,"marginLeft":2,"marginRight":2}"##;
    let dto: ReceiptSettingsDto = serde_json::from_str(json).unwrap();
    assert!(dto.show_currency);
    assert_eq!(dto.decimal_separator, "comma");
    assert_eq!(dto.margin_top, 5);
}

#[test]
fn store_settings_dto_debug() {
    let dto = StoreSettingsDto {
        name: "Test Store".into(),
        address: "123 Rd".into(),
        tax_id: "T1".into(),
        currency: "IDR".into(),
        branch: "Main".into(),
        logo: String::new(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Test Store"));
}

#[test]
fn store_settings_dto_serialize() {
    let dto = StoreSettingsDto {
        name: "S".into(),
        address: "A".into(),
        tax_id: "T".into(),
        currency: "USD".into(),
        branch: "B".into(),
        logo: "L".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "S");
    assert_eq!(json["currency"], "USD");
}

#[test]
fn credit_settings_dto_deserialize() {
    let json = r##"{"enabled":true,"reminderIntervalHours":24,"maxLimitMinor":500000}"##;
    let dto: CreditSettingsDto = serde_json::from_str(json).unwrap();
    assert!(dto.enabled);
    assert_eq!(dto.reminder_interval_hours, 24);
}

#[test]
fn credit_settings_dto_debug() {
    let dto = CreditSettingsDto {
        enabled: false,
        reminder_interval_hours: 12,
        max_limit_minor: 100000,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("100000"));
}

#[test]
fn hardware_settings_dto_serialize() {
    let dto = HardwareSettingsDto {
        printer_connection: "USB".into(),
        printer_device_path: "/dev/usb/lp0".into(),
        printer_paper_size: "80mm".into(),
        scanner_device_id: "scanner-1".into(),
        scanner_input_mode: "keyboard".into(),
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
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["printerConnection"], "USB");
    assert_eq!(json["scaleConnection"], "serial");
    assert_eq!(json["soundVolume"], 60);
}

#[test]
fn user_pref_entry_deserialize() {
    let json = r##"{"key":"theme","value":"dark"}"##;
    let entry: UserPrefEntry = serde_json::from_str(json).unwrap();
    assert_eq!(entry.key, "theme");
    assert_eq!(entry.value, "dark");
}

// ── Generic get_setting / set_setting tests ──────────────────

#[test]
fn get_setting_returns_none_for_missing_key() {
    let conn = fresh_conn();
    let result = run_get_setting(&conn, "nonexistent.key").unwrap();
    assert!(result.is_none());
}

#[test]
fn set_setting_persists_and_get_returns_it() {
    let conn = fresh_conn();
    run_set_setting(
        &conn,
        "payment.stripe_key",
        "sk_test_abc123",
        "test-terminal",
    )
    .unwrap();
    let result = run_get_setting(&conn, "payment.stripe_key").unwrap();
    assert_eq!(result, Some("sk_test_abc123".into()));
}

#[test]
fn set_setting_overwrites_previous_value() {
    let conn = fresh_conn();
    run_set_setting(&conn, "my.key", "v1", "test-terminal").unwrap();
    run_set_setting(&conn, "my.key", "v2", "test-terminal").unwrap();
    let result = run_get_setting(&conn, "my.key").unwrap();
    assert_eq!(result, Some("v2".into()));
}

#[test]
fn set_setting_empty_string_clears_value() {
    let conn = fresh_conn();
    run_set_setting(&conn, "key", "hello", "test-terminal").unwrap();
    run_set_setting(&conn, "key", "", "test-terminal").unwrap();
    let result = run_get_setting(&conn, "key").unwrap();
    assert_eq!(result, Some("".into()));
}

#[test]
fn run_set_setting_writes_delta_row() {
    let conn = fresh_conn();
    run_set_setting(&conn, "delta.test", "delta-val", "term-delta").unwrap();
    // Settings value must be persisted.
    assert_eq!(
        Settings::get(&conn, "delta.test").unwrap(),
        Some("delta-val".into())
    );
    // Delta row must exist at version 1.
    assert_eq!(
        Settings::get_version(&conn, "delta.test", "term-delta").unwrap(),
        Some(1)
    );
}

#[test]
fn get_setting_after_multiple_keys_only_returns_requested() {
    let conn = fresh_conn();
    run_set_setting(&conn, "a", "1", "test-terminal").unwrap();
    run_set_setting(&conn, "b", "2", "test-terminal").unwrap();
    run_set_setting(&conn, "c", "3", "test-terminal").unwrap();
    assert_eq!(run_get_setting(&conn, "b").unwrap(), Some("2".into()));
    assert_eq!(run_get_setting(&conn, "d").unwrap(), None);
}

#[test]
fn get_setting_redacts_secret_keys() {
    let conn = fresh_conn();
    // Write secret values via Settings directly (bypassing get_setting).
    run_set_setting(&conn, "sync_api_key", "secret-key", "t").unwrap();
    run_set_setting(&conn, "pg_sync.password", "db-pass", "t").unwrap();
    // lan_server.* is manager-owned: the guarded writer rejects it (see
    // run_set_setting_rejects_lan_server_keys), so seed it raw.
    Settings::set(&conn, "lan_server.psk", "psk-val").unwrap();
    run_set_setting(&conn, "smtp_config", "smtp-secret", "t").unwrap();
    run_set_setting(&conn, "license.api_key", "lic-key", "t").unwrap();
    run_set_setting(&conn, "stripe.api_key", "sk_test_stripe", "t").unwrap();
    run_set_setting(&conn, "square.api_key", "sq_test_square", "t").unwrap();
    run_set_setting(&conn, "midtrans.server_key", "mid_test", "t").unwrap();
    // All secret keys must return None via get_setting.
    assert_eq!(run_get_setting(&conn, "sync_api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "pg_sync.password").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "lan_server.psk").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "smtp_config").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "license.api_key").unwrap(), None);
    // UI-1: payment gateway credentials must never reach the renderer.
    assert_eq!(run_get_setting(&conn, "stripe.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "square.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "midtrans.server_key").unwrap(), None);
    // Non-secret keys still work.
    run_set_setting(&conn, "store.name", "My Store", "t").unwrap();
    assert_eq!(
        run_get_setting(&conn, "store.name").unwrap(),
        Some("My Store".into())
    );
}

// ── CamelCase serde round-trip tests ─────────────────────────

#[test]
fn receipt_settings_dto_serde_roundtrip() {
    let dto = ReceiptSettingsDto {
        show_currency: true,
        decimal_separator: "comma".into(),
        show_tax: false,
        footer: "Round Trip".into(),
        paper_width: "narrow".into(),
        show_table_number: true,
        margin_top: 5,
        margin_bottom: 3,
        margin_left: 2,
        margin_right: 1,
        tax_rounding_mode: "half_up".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    let back: ReceiptSettingsDto = serde_json::from_value(json).unwrap();
    assert!(back.show_currency);
    assert_eq!(back.decimal_separator, "comma");
    assert!(!back.show_tax);
    assert_eq!(back.footer, "Round Trip");
    assert_eq!(back.paper_width, "narrow");
    assert!(back.show_table_number);
    assert_eq!(back.margin_top, 5);
}

#[test]
fn store_settings_dto_serde_roundtrip() {
    let dto = StoreSettingsDto {
        name: "Round".into(),
        address: "Trip St".into(),
        tax_id: "RT-001".into(),
        currency: "EUR".into(),
        branch: "Main".into(),
        logo: "logo_data".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    let back: StoreSettingsDto = serde_json::from_value(json).unwrap();
    assert_eq!(back.name, "Round");
    assert_eq!(back.tax_id, "RT-001");
    assert_eq!(back.logo, "logo_data");
}

#[test]
fn credit_settings_dto_serde_roundtrip() {
    let dto = CreditSettingsDto {
        enabled: true,
        reminder_interval_hours: 48,
        max_limit_minor: 999999,
    };
    let json = serde_json::to_value(&dto).unwrap();
    let back: CreditSettingsDto = serde_json::from_value(json).unwrap();
    assert!(back.enabled);
    assert_eq!(back.reminder_interval_hours, 48);
}

#[test]
fn hardware_settings_dto_serde_roundtrip() {
    let dto = HardwareSettingsDto {
        printer_connection: "Network".into(),
        printer_device_path: "192.168.1.100".into(),
        printer_paper_size: "58mm".into(),
        scanner_device_id: "scanner-2".into(),
        scanner_input_mode: "serial".into(),
        scale_connection: "usb".into(),
        scale_device_path: "/dev/hidraw0".into(),
        scale_baud_rate: 9600,
        scale_zero_on_boot: false,
        kitchen_printer_connection: "network".into(),
        kitchen_printer_device_path: "10.0.0.50".into(),
        schema_version: 1,
        sound_volume: 80,
        dark_mode: false,
        scale_auto_zero: true,
    };
    let json = serde_json::to_value(&dto).unwrap();
    let back: HardwareSettingsDto = serde_json::from_value(json).unwrap();
    assert_eq!(back.printer_connection, "Network");
    assert_eq!(back.scanner_device_id, "scanner-2");
    assert_eq!(back.scale_connection, "usb");
    assert_eq!(back.sound_volume, 80);
    assert!(back.scale_auto_zero);
}

/// The orphan-cleanup keys in `get_hardware_settings` must stay
/// in sync with the constants in `platform_core::settings::keys`.
/// If this test fails, update the `hw_keys` array.
#[test]
fn hw_orphan_keys_match_platform_core_constants() {
    use platform_core::settings::keys;
    let expected = [
        keys::PRINTER_CONNECTION,
        keys::PRINTER_DEVICE_PATH,
        keys::PRINTER_PAPER_SIZE,
        keys::SCANNER_DEVICE_ID,
        keys::SCANNER_INPUT_MODE,
    ];
    // These must match the hw_keys array in get_hardware_settings.
    assert_eq!(expected[0], "printer.connection");
    assert_eq!(expected[1], "printer.device_path");
    assert_eq!(expected[2], "printer.paper_size");
    assert_eq!(expected[3], "scanner.device_id");
    assert_eq!(expected[4], "scanner.input_mode");
}

// ── Managed-key write guard (review MED-1) ─────────────────────

#[test]
fn run_set_setting_rejects_local_api_keys() {
    let conn = fresh_conn();
    for key in ["local_api.enabled", "local_api.port", "local_api.secret"] {
        let err = run_set_setting(&conn, key, "1", "t-1").unwrap_err();
        assert!(
            matches!(&err, BridgeError::Invalid(m) if m.contains("Local API controls")),
            "{key} must be rejected from the raw settings writer: {err:?}"
        );
        // And nothing was persisted.
        assert!(
            Settings::get(&conn, key).unwrap().is_none(),
            "{key} must not reach the settings table"
        );
    }
}

#[test]
fn run_set_setting_allows_unmanaged_keys() {
    let conn = fresh_conn();
    run_set_setting(&conn, "sync.enabled", "1", "t-1").unwrap();
    // Prefix lookalikes are NOT managed keys.
    run_set_setting(&conn, "local_api_x.enabled", "1", "t-1").unwrap();
    run_set_setting(&conn, "my_local_api.enabled", "1", "t-1").unwrap();
}

#[test]
fn is_managed_key_prefix_semantics() {
    assert!(is_managed_key("local_api.enabled"));
    assert!(is_managed_key("local_api.")); // even the bare prefix is owned
    assert!(!is_managed_key("local_api"));
    assert!(is_managed_key("lan_server.psk")); // same class, same guard
    assert!(is_managed_key("lan_server.enabled"));
    assert!(!is_managed_key("sync.auth_token"));
}

#[test]
fn run_set_setting_rejects_lan_server_keys() {
    let conn = fresh_conn();
    let err = run_set_setting(&conn, "lan_server.enabled", "1", "t-1").unwrap_err();
    assert!(
        matches!(&err, BridgeError::Invalid(m) if m.contains("LAN server controls")),
        "lan_server.* must name its owning controls: {err:?}"
    );
}

// ── Deployment info tests ───────────────────────────────────

#[test]
fn build_deployment_info_returns_pkg_version() {
    let info = build_deployment_info();
    assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
}

// ── Shared credential deny list (C-2 · the sync_terminal_secret typo) ──

use platform_core::settings::keys;

use crate::data::exportable_settings_rows;

/// The platform-core key registry, read as text so this test can sweep every
/// declared constant instead of trusting a hand-typed list of them.
const KEYS_RS: &str = include_str!("../../../platform/core/src/settings/keys.rs");

/// Every `pub const NAME: &str = "value";` declared in the platform-core key
/// registry, as (const name, key value) pairs.
fn declared_keys() -> Vec<(String, String)> {
    KEYS_RS
        .lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("pub const ")?;
            let (name, tail) = rest.split_once(": &str = \"")?;
            let value = tail.split_terminator('"').next()?.to_string();
            Some((name.to_string(), value))
        })
        .collect()
}

/// True when a constant NAME marks the credential / device-identity family.
///
/// Judged on the NAME, not the value, so a new secret cannot escape the guard
/// by being spelled like an ordinary setting key.
fn is_credential_family(name: &str) -> bool {
    const MARKERS: &[&str] = &[
        "SECRET",
        "API_KEY",
        "PASSWORD",
        "SERVER_KEY",
        "PSK",
        "LICENSE_",
        "SMTP_CONFIG",
        "TERMINAL_ID",
        "MACHINE_ID",
        "FINGERPRINT",
        // `redis.url` carries its password INSIDE the URL
        // (`redis://:PASSWORD@host:6379`), so the whole value is a
        // credential. The marker is the full constant name on purpose:
        // "_URL" would also sweep `sync_server_url`, which is an endpoint
        // and must stay replicable — a second install that is not told the
        // server URL cannot sync at all. Refusing an endpoint is not the
        // same act as refusing a secret.
        "REDIS_URL",
    ];
    MARKERS.iter().any(|marker| name.contains(marker))
}

#[test]
fn every_credential_family_key_declared_in_keys_rs_is_blocked() {
    let declared = declared_keys();
    assert!(
        declared.len() > 40,
        "parsed only {} key constants out of keys.rs - the parser broke, not the guard",
        declared.len()
    );

    // (1) forward: every credential-family constant is denied somewhere - the
    // credentials on both surfaces, the two device-identity keys on the export
    // surface only (that asymmetry is a recorded decision, see the table test).
    let mut swept = 0;
    for (name, key) in &declared {
        if !is_credential_family(name) {
            continue;
        }
        swept += 1;
        assert!(
            refused_by_portable_package(key),
            "credential {name} = {key:?} leaks through the GUI export/restore redaction"
        );
        if !NON_EXPORTABLE_DEVICE_KEYS.contains(&key.as_str()) {
            assert!(
                is_secret_key(key),
                "credential {name} = {key:?} is readable through the raw get_setting IPC"
            );
        }
    }
    // (2) reverse: nothing is denied by an ad-hoc literal that no constant
    // declares - that is exactly how the dotted "sync.terminal_secret" entry
    // looked correct while covering nothing.
    for key in SECRET_KEY_DENY_LIST
        .iter()
        .chain(NON_EXPORTABLE_DEVICE_KEYS.iter())
    {
        assert!(
            declared.iter().any(|(_, v)| v.as_str() == *key),
            "deny-list entry {key:?} is a retyped literal, not a declared key constant"
        );
    }
    // (3) no entry is only half-registered: the swept set and the two lists
    // must be the same size, so a family constant cannot be added outside a
    // list and a list entry cannot be dropped without a name change.
    assert_eq!(
        swept,
        SECRET_KEY_DENY_LIST.len() + NON_EXPORTABLE_DEVICE_KEYS.len(),
        "keys.rs declares a different credential family than the deny lists cover"
    );

    let mut dedup: Vec<&str> = SECRET_KEY_DENY_LIST.iter().copied().collect();
    dedup.sort_unstable();
    dedup.dedup();
    assert_eq!(
        dedup.len(),
        SECRET_KEY_DENY_LIST.len(),
        "the shared deny list carries a duplicate entry"
    );
}

/// The same family stated as a table, so a review reads the coverage without
/// parsing the registry: name -> constant -> both verdicts.
#[test]
fn credential_table_is_blocked_by_both_surfaces() {
    let table: [(&str, &str); 18] = [
        ("SYNC_API_KEY", keys::SYNC_API_KEY),
        ("SYNC_TERMINAL_SECRET", keys::SYNC_TERMINAL_SECRET),
        ("PG_SYNC_PASSWORD", keys::PG_SYNC_PASSWORD),
        ("REDIS_URL", keys::REDIS_URL),
        ("RATE_SYNC_API_KEY", keys::RATE_SYNC_API_KEY),
        ("LAN_SERVER_PSK", keys::LAN_SERVER_PSK),
        ("LOCAL_API_SECRET", keys::LOCAL_API_SECRET),
        ("SMTP_CONFIG", keys::SMTP_CONFIG),
        ("LICENSE_API_KEY", keys::LICENSE_API_KEY),
        ("LICENSE_PAYLOAD", keys::LICENSE_PAYLOAD),
        ("LICENSE_SIGNATURE", keys::LICENSE_SIGNATURE),
        ("LICENSE_TENANT_ID", keys::LICENSE_TENANT_ID),
        ("STRIPE_API_KEY", keys::STRIPE_API_KEY),
        ("SQUARE_API_KEY", keys::SQUARE_API_KEY),
        ("MIDTRANS_SERVER_KEY", keys::MIDTRANS_SERVER_KEY),
        ("SYNC_TERMINAL_ID", keys::SYNC_TERMINAL_ID),
        ("MACHINE_ID", keys::MACHINE_ID),
        ("HARDWARE_FINGERPRINT", keys::HARDWARE_FINGERPRINT),
    ];
    for (name, key) in table {
        assert!(
            refused_by_portable_package(key),
            "{name} = {key:?} must never be exported"
        );
        let credential = !keys::NON_EXPORTABLE_DEVICE_KEYS.contains(&key);
        assert_eq!(
            is_secret_key(key),
            credential,
            "{name} = {key:?}: credentials are IPC-blocked, device identity is not"
        );
    }
}

/// The hardware fingerprint is device identity like machine_id (it is the
/// license server's one-trial-per-device lock), so BOTH untrusted lanes
/// refuse it while the local manager lane keeps minting it.
#[test]
fn hardware_fingerprint_is_refused_on_both_untrusted_lanes() {
    for policy in [IngestPolicy::RemoteSync, IngestPolicy::PortablePackage] {
        assert!(
            !policy.admits(keys::HARDWARE_FINGERPRINT),
            "{policy:?} must refuse the device fingerprint"
        );
    }
    assert!(
        IngestPolicy::TrustedLocal.admits(keys::HARDWARE_FINGERPRINT),
        "license.rs mints the fingerprint locally and must keep working"
    );
}

/// The reviewer's finding: `redis.url` is spelled like an endpoint and
/// declared like one, but the form operators actually save embeds the
/// password in the URL — `redis://:PASSWORD@10.0.0.5:6379`. It was absent
/// from the credential list, so `RemoteSync` admitted it verbatim and every
/// peer got the cleartext password; symmetrically a peer could repoint this
/// install's Redis. Both untrusted lanes now refuse it, and the local lane
/// still admits it because the operator has to be able to save it.
#[test]
fn redis_url_with_embedded_password_is_refused_on_both_untrusted_lanes() {
    let conn = fresh_conn();
    let url = "redis://:s3cr3t@10.0.0.5:6379";
    // Ingress: a peer cannot write it onto this install.
    for policy in [IngestPolicy::RemoteSync, IngestPolicy::PortablePackage] {
        assert!(
            !policy.admits(keys::REDIS_URL),
            "{policy:?} must refuse redis.url"
        );
        assert!(
            !Settings::set_with_policy(&conn, keys::REDIS_URL, url, policy).unwrap(),
            "{policy:?} must write nothing"
        );
    }
    assert_eq!(Settings::get(&conn, keys::REDIS_URL).unwrap(), None);
    // Egress: saving it locally must not queue it for peers.
    Settings::set(&conn, keys::REDIS_URL, url).unwrap();
    let store = Store::new(&conn);
    let entries = HashMap::from([(keys::REDIS_URL.to_string(), url.to_string())]);
    enqueue_settings_updates(&store, &entries, "term-1", "store-x").unwrap();
    assert!(
        store
            .list_pending_offline_for_tenant("store-x")
            .unwrap()
            .is_empty(),
        "the redis password must not be offered to the network"
    );
    // Reads: the raw IPC surface must not hand it to the renderer...
    assert_eq!(run_get_setting(&conn, keys::REDIS_URL).unwrap(), None);
    // ...while the daemon's own typed accessor still works, which is what
    // keeps terminal startup reading its cache config.
    assert_eq!(Settings::get_redis_url(&conn).unwrap(), url);
    // And the local lane that owns the write still admits it.
    assert!(IngestPolicy::TrustedLocal.admits(keys::REDIS_URL));
}

/// The typo regression itself: the stored key is UNDERSCORED, the old entry
/// was DOTTED, so get_setting handed back the terminal secret ciphertext.
#[test]
fn get_setting_blocks_underscored_sync_terminal_secret() {
    let conn = fresh_conn();
    Settings::set(&conn, keys::SYNC_TERMINAL_SECRET, "enc:v1:deadbeef").unwrap();
    Settings::set(&conn, keys::LOCAL_API_SECRET, "a1b2c3").unwrap();
    assert_eq!(
        run_get_setting(&conn, keys::SYNC_TERMINAL_SECRET).unwrap(),
        None,
        "sync_terminal_secret ciphertext must never reach the raw get_setting IPC"
    );
    assert_eq!(
        run_get_setting(&conn, keys::LOCAL_API_SECRET).unwrap(),
        None,
        "local_api.secret must be blocked on both shells (the tablet list omitted it)"
    );
    let rows = exportable_settings_rows(vec![(
        keys::SYNC_TERMINAL_SECRET.to_string(),
        "enc:v1:deadbeef".to_string(),
    )]);
    assert!(
        rows.is_empty(),
        "the terminal secret must not ride in a package"
    );
}

/// Deliberate asymmetry, recorded: the cleartext half of the credential pair
/// and the machine fingerprint stay IPC-readable (the shipped UI reads them
/// back through get_setting) while being barred from portable packages.
#[test]
fn device_identity_keys_stay_readable_but_never_exportable() {
    let conn = fresh_conn();
    Settings::set(&conn, keys::SYNC_TERMINAL_ID, "term-42").unwrap();
    Settings::set(&conn, keys::MACHINE_ID, "MACHINE-FP").unwrap();
    assert_eq!(
        run_get_setting(&conn, keys::SYNC_TERMINAL_ID).unwrap(),
        Some("term-42".into()),
        "sync_terminal_id stays IPC-readable by decision - it is an identifier"
    );
    assert_eq!(
        run_get_setting(&conn, keys::MACHINE_ID).unwrap(),
        Some("MACHINE-FP".into()),
        "machine_id stays IPC-readable by decision - get_machine_id has no gate"
    );
    assert!(refused_by_portable_package(keys::SYNC_TERMINAL_ID));
    assert!(refused_by_portable_package(keys::MACHINE_ID));
}
// ── SYNC egress: a locally written secret must not be offered to peers ──

/// The enqueue leg was the one settings surface with no guard at all: reads
/// refused the deny list, writes refused the manager prefixes, and
/// `enqueue_settings_updates` queued anything. Fails against HEAD, where a
/// `local_api.secret` saved locally replicated to every terminal in the tenant.
#[test]
fn enqueue_settings_updates_does_not_replicate_secret_or_device_keys() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let entries = HashMap::from([
        ("store.name".to_string(), "Warung Sedap".to_string()),
        ("receipt.footer".to_string(), "Terima kasih".to_string()),
        (
            "local_api.secret".to_string(),
            "own-signing-secret".to_string(),
        ),
        ("local_api.enabled".to_string(), "true".to_string()),
        (
            "machine_id".to_string(),
            "own-machine-fingerprint".to_string(),
        ),
        (
            "sync_terminal_secret".to_string(),
            "own-terminal-secret".to_string(),
        ),
        ("license.api_key".to_string(), "own-license-key".to_string()),
        ("lan_server.bind".to_string(), "0.0.0.0".to_string()),
    ]);

    enqueue_settings_updates(&store, &entries, "term-1", "store-x").unwrap();

    let pending = store.list_pending_offline_for_tenant("store-x").unwrap();
    let queued: Vec<String> = pending
        .iter()
        .map(|item| {
            serde_json::from_str::<serde_json::Value>(&item.payload)
                .ok()
                .and_then(|v| v["key"].as_str().map(String::from))
                .unwrap_or_default()
        })
        .collect();
    assert!(
        queued.contains(&"store.name".to_string()),
        "ordinary key must replicate: {queued:?}"
    );
    assert!(
        queued.contains(&"receipt.footer".to_string()),
        "ordinary key must replicate: {queued:?}"
    );
    for forbidden in [
        "local_api.secret",
        "local_api.enabled",
        "machine_id",
        "sync_terminal_secret",
        "license.api_key",
        "lan_server.bind",
    ] {
        assert!(
            !queued.iter().any(|k| k == forbidden),
            "{forbidden} must never be offered to the network; queued {queued:?}"
        );
    }
    assert_eq!(
        pending.len(),
        2,
        "exactly the two portable rows may be queued"
    );
}

/// The egress gate must agree with the ingest gate, or the two halves disagree
/// silently the way the two shell deny lists did.
#[test]
fn sync_egress_gate_agrees_with_the_sealed_policy() {
    for key in ["store.name", "currency.default", "theme"] {
        assert!(remote_sync_admits(key), "{key} must replicate");
    }
    for key in [
        "local_api.secret",
        "local_api.enabled",
        "lan_server.psk",
        "machine_id",
        "sync_terminal_id",
        "sync_terminal_secret",
        "stripe.api_key",
    ] {
        assert!(!remote_sync_admits(key), "{key} must not replicate");
    }
}

// ── The batch door: set_settings_scoped used to write straight through
// `Settings::set_tracked`, bypassing `run_set_setting` entirely, so neither
// the manager-key refusal nor the smtp_config keep-on-blank merge reached it.

/// A batch write of `smtp_config` that omits the password must preserve the
/// stored secret, exactly like the single-write funnel now does.
#[test]
fn batch_smtp_config_write_preserves_the_stored_password() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store
        .save_smtp_config(&oz_core::export::email_report::SmtpConfig {
            host: "smtp.old.com".into(),
            from: "a@b.com".into(),
            password: Some("stored-secret".into()),
            ..Default::default()
        })
        .unwrap();

    run_set_settings_batch(
        &conn,
        &HashMap::from([(
            SMTP_CONFIG_SETTINGS_KEY.to_string(),
            r#"{"host":"smtp.new.com","port":465,"username":null,"password":null,"from":"b@c.com","use_tls":true}"#
                .to_string(),
        )]),
        "term-1",
    )
    .unwrap();

    let loaded = store.get_smtp_config().unwrap().unwrap();
    assert_eq!(
        loaded.password.as_deref(),
        Some("stored-secret"),
        "a batch save that omits the password must not destroy it"
    );
    assert_eq!(
        loaded.host, "smtp.new.com",
        "the other fields must still update"
    );
    assert_eq!(loaded.from, "b@c.com");
}

/// A batch containing a manager-owned key is refused and writes NOTHING — not
/// even the innocent sibling key. Refusal is batch-wide and pre-flight, which
/// is what the command's documented all-or-nothing semantics require.
#[test]
fn batch_write_refuses_local_api_secret_and_writes_nothing() {
    let conn = fresh_conn();
    let err = run_set_settings_batch(
        &conn,
        &HashMap::from([
            (
                "local_api.secret".to_string(),
                "attacker-secret".to_string(),
            ),
            ("store_name".to_string(), "My Store".to_string()),
        ]),
        "term-1",
    )
    .unwrap_err();
    assert!(
        matches!(&err, BridgeError::Invalid(m) if m.contains("local_api.secret")),
        "refusal must be the Invalid error naming the key: {err:?}"
    );
    assert!(
        Settings::get(&conn, "local_api.secret").unwrap().is_none(),
        "a refused write must not reach the settings table"
    );
    assert!(
        Settings::get(&conn, "store_name").unwrap().is_none(),
        "one bad row must abort the batch, not skip its own row"
    );
}

/// Control, and the guard against over-correction: refusing a bad row by
/// aborting the WHOLE batch is only safe because it is what the single-write
/// funnel does too. Two ordinary keys must both land.
#[test]
fn batch_write_of_two_ordinary_keys_lands_both() {
    let conn = fresh_conn();
    run_set_settings_batch(
        &conn,
        &HashMap::from([
            ("store_name".to_string(), "My Store".to_string()),
            ("currency".to_string(), "IDR".to_string()),
        ]),
        "term-1",
    )
    .unwrap();
    assert_eq!(
        Settings::get(&conn, "store_name").unwrap().as_deref(),
        Some("My Store")
    );
    assert_eq!(
        Settings::get(&conn, "currency").unwrap().as_deref(),
        Some("IDR")
    );
}
