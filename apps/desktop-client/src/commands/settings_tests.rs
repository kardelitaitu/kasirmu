use super::*;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

// ── Token rejection tests ──────────────────────────────

#[test]
fn settings_scoped_rejects_invalid_token() {
    let state = AppState::for_test();
    let result = state.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(AppError::InvalidSession)));
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
            matches!(&err, AppError::Invalid(m) if m.contains("Local API controls")),
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
        matches!(&err, AppError::Invalid(m) if m.contains("LAN server controls")),
        "lan_server.* must name its owning controls: {err:?}"
    );
}

// ── Deployment info tests ───────────────────────────────────

#[test]
fn build_deployment_info_returns_pkg_version() {
    let info = build_deployment_info();
    assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
}
