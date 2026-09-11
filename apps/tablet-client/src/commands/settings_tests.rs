use super::*;
use oz_core::SyncPriority;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

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
        margin_top: 3,
        margin_bottom: 5,
        margin_left: 1,
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
    assert_eq!(result.margin_top, 3);
    assert_eq!(result.margin_bottom, 5);
    assert_eq!(result.margin_left, 1);
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
            show_table_number: true,
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
            show_table_number: false,
            margin_top: 5,
            margin_bottom: 2,
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
    assert!(
        !result.show_table_number,
        "v2 overwrites show_table_number to false"
    );
    assert_eq!(result.margin_top, 5);
    assert_eq!(result.margin_bottom, 2);
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

// ── DTO struct tests ──────────────────────────────────────────

#[test]
fn receipt_settings_dto_debug() {
    let dto = ReceiptSettingsDto {
        show_currency: true,
        decimal_separator: "comma".into(),
        show_tax: false,
        footer: "Thank you".into(),
        paper_width: "narrow".into(),
        show_table_number: true,
        margin_top: 5,
        margin_bottom: 3,
        margin_left: 2,
        margin_right: 2,
        tax_rounding_mode: "half_up".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("comma"));
    assert!(d.contains("narrow"));
}

#[test]
fn receipt_settings_dto_serialize() {
    let dto = ReceiptSettingsDto {
        show_currency: false,
        decimal_separator: "dot".into(),
        show_tax: true,
        footer: "".into(),
        paper_width: "standard".into(),
        show_table_number: false,
        margin_top: 0,
        margin_bottom: 0,
        margin_left: 0,
        margin_right: 0,
        tax_rounding_mode: "half_up".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert!(!json["showCurrency"].as_bool().unwrap());
    assert_eq!(json["decimalSeparator"], "dot");
    assert_eq!(json["paperWidth"], "standard");
}

#[test]
fn receipt_settings_dto_deserialize() {
    let json = r#"{"showCurrency":true,"decimalSeparator":"comma","showTax":false,"footer":"Thanks","paperWidth":"narrow","showTableNumber":false,"marginTop":4,"marginBottom":2,"marginLeft":1,"marginRight":1}"#;
    let dto: ReceiptSettingsDto = serde_json::from_str(json).unwrap();
    assert!(dto.show_currency);
    assert_eq!(dto.decimal_separator, "comma");
    assert_eq!(dto.margin_top, 4);
}

#[test]
fn store_settings_dto_debug() {
    let dto = StoreSettingsDto {
        name: "My Store".into(),
        address: "123 Main".into(),
        tax_id: "TAX-001".into(),
        currency: "USD".into(),
        branch: "Main".into(),
        logo: "abc123".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("My Store"));
    assert!(d.contains("USD"));
}

#[test]
fn store_settings_dto_serialize() {
    let dto = StoreSettingsDto {
        name: "Cafe".into(),
        address: "456 Oak".into(),
        tax_id: "".into(),
        currency: "IDR".into(),
        branch: "Mall".into(),
        logo: "".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Cafe");
    assert_eq!(json["currency"], "IDR");
    assert_eq!(json["address"], "456 Oak");
}

#[test]
fn store_settings_dto_deserialize() {
    let json =
        r#"{"name":"Shop","address":"1 Rd","taxId":"TX","currency":"EUR","branch":"A","logo":"L"}"#;
    let dto: StoreSettingsDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.name, "Shop");
    assert_eq!(dto.currency, "EUR");
    assert_eq!(dto.branch, "A");
}

#[test]
fn credit_settings_dto_serialize() {
    let dto = CreditSettingsDto {
        enabled: true,
        reminder_interval_hours: 24,
        max_limit_minor: 500000,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert!(json["enabled"].as_bool().unwrap());
    assert_eq!(json["reminderIntervalHours"], 24);
    assert_eq!(json["maxLimitMinor"], 500000);
}

#[test]
fn hardware_settings_dto_serialize() {
    let dto = HardwareSettingsDto {
        printer_connection: "usb".into(),
        printer_device_path: "/dev/usb/lp0".into(),
        printer_paper_size: "80mm".into(),
        scanner_device_id: "scanner-01".into(),
        scanner_input_mode: "keyboard".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["printerConnection"], "usb");
    assert_eq!(json["scannerInputMode"], "keyboard");
}

#[test]
fn user_pref_entry_debug() {
    let entry = UserPrefEntry {
        key: "theme".into(),
        value: "dark".into(),
    };
    let d = format!("{entry:?}");
    assert!(d.contains("theme"));
    assert!(d.contains("dark"));
}

#[test]
fn user_pref_entry_serialize() {
    let entry = UserPrefEntry {
        key: "lang".into(),
        value: "en".into(),
    };
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["key"], "lang");
    assert_eq!(json["value"], "en");
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
    };
    let json = serde_json::to_value(&dto).unwrap();
    let back: HardwareSettingsDto = serde_json::from_value(json).unwrap();
    assert_eq!(back.printer_connection, "Network");
    assert_eq!(back.scanner_device_id, "scanner-2");
}

// ── Generic get_setting / set_setting tests (C-3 fix verification) ─

#[test]
fn get_setting_returns_none_for_missing_key() {
    let conn = fresh_conn();
    let result = run_get_setting(&conn, "nonexistent.key").unwrap();
    assert!(result.is_none());
}

/// ADR #22 parity: the tablet's settings write must record a delta
/// (version 1), not just overwrite the row — the delta ledger is the
/// basis for version-LWW when the change syncs.
#[test]
fn run_set_setting_writes_delta_row() {
    let conn = fresh_conn();
    run_set_setting(&conn, "delta.test", "delta-val", "term-delta").unwrap();
    assert_eq!(
        Settings::get(&conn, "delta.test").unwrap(),
        Some("delta-val".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "delta.test", "term-delta").unwrap(),
        Some(1)
    );
}

/// SYNC-10 parity: a tablet settings save must enqueue a
/// `settings.update` item on the global queue so the tablet's sync
/// daemon pushes it to the cloud (and the desktop's pull re-applies it).
#[test]
fn set_setting_enqueues_settings_update_item() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    enqueue_settings_update(&store, "theme", "dark", "term-1").unwrap();

    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "settings.update");
    assert_eq!(pending[0].tenant_id, "default");
    assert_eq!(pending[0].priority, SyncPriority::Low);
    let v: serde_json::Value = serde_json::from_str(&pending[0].payload).unwrap();
    assert_eq!(v["key"], "theme");
    assert_eq!(v["value"], "dark");
    assert_eq!(v["terminal_id"], "term-1");
}

#[test]
fn set_setting_persists_and_get_returns_it() {
    let conn = fresh_conn();
    run_set_setting(&conn, "sync.auth_token", "sk_test_abc123", "term-1").unwrap();
    let result = run_get_setting(&conn, "sync.auth_token").unwrap();
    assert_eq!(result, Some("sk_test_abc123".into()));
}

#[test]
fn set_setting_overwrites_previous_value() {
    let conn = fresh_conn();
    run_set_setting(&conn, "my.key", "v1", "term-1").unwrap();
    run_set_setting(&conn, "my.key", "v2", "term-1").unwrap();
    let result = run_get_setting(&conn, "my.key").unwrap();
    assert_eq!(result, Some("v2".into()));
}

#[test]
fn set_setting_empty_string_is_stored_as_empty() {
    let conn = fresh_conn();
    run_set_setting(&conn, "key", "hello", "term-1").unwrap();
    run_set_setting(&conn, "key", "", "term-1").unwrap();
    let result = run_get_setting(&conn, "key").unwrap();
    assert_eq!(result, Some("".into()));
}

#[test]
fn get_setting_after_multiple_keys_only_returns_requested() {
    let conn = fresh_conn();
    run_set_setting(&conn, "a", "1", "term-1").unwrap();
    run_set_setting(&conn, "b", "2", "term-1").unwrap();
    run_set_setting(&conn, "c", "3", "term-1").unwrap();
    assert_eq!(run_get_setting(&conn, "b").unwrap(), Some("2".into()));
    assert_eq!(run_get_setting(&conn, "d").unwrap(), None);
}

#[test]
fn get_setting_redacts_secret_keys() {
    let conn = fresh_conn();
    run_set_setting(&conn, "sync_api_key", "secret-key", "t").unwrap();
    run_set_setting(&conn, "pg_sync.password", "db-pass", "t").unwrap();
    run_set_setting(&conn, "lan_server.psk", "psk-val", "t").unwrap();
    run_set_setting(&conn, "smtp_config", "smtp-secret", "t").unwrap();
    run_set_setting(&conn, "stripe.api_key", "sk_test_stripe", "t").unwrap();
    run_set_setting(&conn, "square.api_key", "sq_test_square", "t").unwrap();
    run_set_setting(&conn, "midtrans.server_key", "mid_test", "t").unwrap();
    assert_eq!(run_get_setting(&conn, "pg_sync.password").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "lan_server.psk").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "smtp_config").unwrap(), None);
    // UI-1: payment gateway credentials must never reach the renderer.
    assert_eq!(run_get_setting(&conn, "stripe.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "square.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "midtrans.server_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "license.api_key").unwrap(), None);
    run_set_setting(&conn, "store.name", "My Store", "t").unwrap();
    assert_eq!(
        run_get_setting(&conn, "store.name").unwrap(),
        Some("My Store".into())
    );
}

#[test]
fn sync_auth_token_cross_screen_roundtrip() {
    // C-3 fix verification: the sync.auth_token key written by
    // one screen (SettingsPage) must be readable by another
    // (RetailOptionsScreen / useCloudSync) via get_setting.
    let conn = fresh_conn();

    // Simulate SettingsPage saving a token
    run_set_setting(&conn, "sync.auth_token", "jwt-token-xyz", "term-1").unwrap();

    // Simulate useCloudSync loading the token on the other screen
    let loaded = run_get_setting(&conn, "sync.auth_token").unwrap();
    assert_eq!(
        loaded,
        Some("jwt-token-xyz".into()),
        "C-3 regression: token saved via SettingsPage must be readable via get_setting"
    );
}

// ── Scoped user preferences (tablet parity — AUDIT-25) ─────────

use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Seed a session for `token` bound to `store_id` and `user_id`.
fn seed_session(state: &mut AppState, token: &str, store_id: &str, user_id: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            "role-staff".into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
}

fn pref(key: &str, value: &str) -> UserPrefEntry {
    UserPrefEntry {
        key: key.into(),
        value: value.into(),
    }
}

#[tokio::test]
async fn scoped_user_preferences_rejects_invalid_token() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();

    let read = get_user_preferences_scoped("missing-token".into(), app.state()).await;
    assert!(matches!(read, Err(AppError::InvalidSession)));

    let write = set_user_preferences_scoped(
        "missing-token".into(),
        vec![pref("cardsize", "3")],
        app.state(),
    )
    .await;
    assert!(matches!(write, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_user_preferences_roundtrip_targets_session_store_and_user() {
    let conn = oz_core::migrations::fresh_db();
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    seed_session(&mut state, "store-a-token", "store-a", "cashier-a");
    seed_session(&mut state, "store-b-token", "store-b", "cashier-a");
    seed_session(&mut state, "other-user-token", "store-a", "cashier-b");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // The restaurant-menu hamburger configuration for cashier-a in
    // store-a — the exact keys RestaurantMenu persists scoped.
    set_user_preferences_scoped(
        "store-a-token".into(),
        vec![
            pref("sort", "popularity"),
            pref("cardsize", "3"),
            pref("fontsize", "2"),
        ],
        app.state(),
    )
    .await
    .unwrap();

    let prefs = get_user_preferences_scoped("store-a-token".into(), app.state())
        .await
        .unwrap();
    assert_eq!(prefs.get("sort").map(String::as_str), Some("popularity"));
    assert_eq!(prefs.get("cardsize").map(String::as_str), Some("3"));
    assert_eq!(prefs.get("fontsize").map(String::as_str), Some("2"));

    // Isolated per store: the same user in store-b must not see store-a.
    let store_b = get_user_preferences_scoped("store-b-token".into(), app.state())
        .await
        .unwrap();
    assert!(
        store_b.is_empty(),
        "store B must not see store A user preferences"
    );

    // Isolated per user: another user in store-a must not see them.
    let other = get_user_preferences_scoped("other-user-token".into(), app.state())
        .await
        .unwrap();
    assert!(
        other.is_empty(),
        "another user in the same store must not see cashier-a preferences"
    );
}
/// The bypass reproduce (egress-gate parity with the bridge funnel): a
/// locally written credential must NOT leave the device in a settings.update
/// sync item, even though the local write itself succeeds and is non-fatal.
#[test]
fn enqueue_settings_update_refuses_credential_key_for_egress() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    enqueue_settings_update(
        &store,
        oz_core::settings::keys::LOCAL_API_SECRET,
        "signing-secret",
        "term-1",
    )
    .unwrap();
    assert!(
        store.list_pending_offline().unwrap().is_empty(),
        "local_api.secret must not be queued for sync egress"
    );
}

/// Control for the gate: an ordinary key still queues, so the refusal above
/// is the policy and not a broken enqueue path.
#[test]
fn enqueue_settings_update_still_queues_ordinary_key() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    enqueue_settings_update(
        &store,
        oz_core::settings::keys::STORE_NAME,
        "Renamed",
        "term-1",
    )
    .unwrap();
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "store.name must still queue for egress");
    assert_eq!(pending[0].action, "settings.update");
}
