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
    //
    // WHY THE SEED DOES NOT GO THROUGH run_set_setting: this test asserts a
    // READ-side property, so the write is scaffolding only. Since 0f26a4b29 the
    // tracked funnel refuses a deny-listed credential stored in cleartext
    // (Settings::refuse_cleartext_credential), so funnel-seeding it fails on the
    // write and never reaches the redaction assertion - the test would then prove
    // nothing about the read. Settings::set is the untracked door the lifecycle
    // managers themselves use, and it stores what it is handed, which is the only
    // way to plant a cleartext secret and show the reader refuses to hand it back.
    // Do NOT tidy these lines back onto run_set_setting.
    Settings::set(&conn, "sync_api_key", "secret-key").unwrap();
    Settings::set(&conn, "pg_sync.password", "db-pass").unwrap();
    // lan_server.* is manager-owned: the guarded writer rejects it (see
    // run_set_setting_rejects_lan_server_keys), so seed it raw.
    Settings::set(&conn, "lan_server.psk", "psk-val").unwrap();
    // smtp_config is the one named exception to that cleartext refusal
    // (Settings::CLEARTEXT_CREDENTIAL_EXCEPTION), so it still goes through the
    // writer a real save takes - the merge seam, not a refusal.
    run_set_setting(&conn, "smtp_config", "smtp-secret", "t").unwrap();
    Settings::set(&conn, "license.api_key", "lic-key").unwrap();
    Settings::set(&conn, "stripe.api_key", "sk_test_stripe").unwrap();
    Settings::set(&conn, "square.api_key", "sq_test_square").unwrap();
    Settings::set(&conn, "midtrans.server_key", "mid_test").unwrap();
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

/// The prefix rule, asserted through the shared predicate the bridge now calls.
///
/// This used to be a test of a bridge-local `is_managed_key` with a bridge-local
/// list of prefixes. It keeps the same cases — including `sync.auth_token`, which
/// is a credential but NOT manager-owned, so it is the case that would break if
/// the two rules were ever collapsed into one — and adds the agreement check:
/// the label lookup may never widen or narrow what the shared predicate claims.
#[test]
fn manager_owned_prefix_semantics() {
    assert!(is_manager_owned_key("local_api.enabled"));
    assert!(is_manager_owned_key("local_api.")); // even the bare prefix is owned
    assert!(!is_manager_owned_key("local_api"));
    assert!(is_manager_owned_key("lan_server.psk")); // same class, same guard
    assert!(is_manager_owned_key("lan_server.enabled"));
    assert!(!is_manager_owned_key("sync.auth_token"));
    for key in [
        "local_api.enabled",
        "lan_server.psk",
        "sync.auth_token",
        "local_api",
    ] {
        assert_eq!(
            managed_key_owner(key).is_some(),
            is_manager_owned_key(key),
            "{key}: the owner label must never widen or narrow the shared rule",
        );
    }
}

/// The one thing the bridge still owns about this rule: which manager a refused
/// key belongs to, for the message the UI shows. Built from the shared key
/// constants, so no second prefix list exists in this crate.
#[test]
fn managed_key_owner_labels_the_manager() {
    assert_eq!(managed_key_owner("local_api.secret"), Some("Local API"));
    assert_eq!(managed_key_owner("local_api."), Some("Local API"));
    assert_eq!(managed_key_owner("lan_server.enabled"), Some("LAN server"));
    assert_eq!(managed_key_owner("lan_server.bind"), Some("LAN server"));
    // Prefix lookalikes are not families, and neither is an ordinary key.
    assert_eq!(managed_key_owner("local_api_x.enabled"), None);
    assert_eq!(managed_key_owner("my_local_api.enabled"), None);
    assert_eq!(managed_key_owner("sync.auth_token"), None);
}

/// The guard folds and the label lookup has to fold the same way, or a refusal
/// names the wrong manager. The case above cannot see this: every spelling it
/// tries is already exact lowercase, so the two agree by construction. This was
/// the third site of that half-folded pattern in one subsystem (`d690f8f66`
/// closed the ingest boolean; the deny and device lists folded before it), and
/// it is why `keys::normalised_candidate` is public instead of a second
/// normalisation being written here. The lookalikes are tried folded too, to
/// show the fold only re-labels a claim the shared rule already makes — it
/// never widens the rule.
#[test]
fn managed_key_owner_labels_a_variant_spelling_like_the_lowercase_form() {
    for (variant, exact, owner) in [
        ("LOCAL_API.SECRET", "local_api.secret", Some("Local API")),
        ("  Lan_Server.Bind  ", "lan_server.bind", Some("LAN server")),
        ("\tLAN_SERVER.PSK\n", "lan_server.psk", Some("LAN server")),
    ] {
        assert!(
            is_manager_owned_key(variant),
            "{variant:?}: the shared gate does not claim this variant, so the case proves nothing"
        );
        assert_eq!(
            managed_key_owner(variant),
            owner,
            "{variant:?}: a refused key must carry the name of its manager, not the generic label"
        );
        assert_eq!(
            managed_key_owner(variant),
            managed_key_owner(exact),
            "{variant:?} must label exactly like the lowercase form {exact:?}"
        );
    }
    for variant in ["LOCAL_API_X.ENABLED", "  My_Lan_Server.Bind  "] {
        assert!(
            !is_manager_owned_key(variant),
            "{variant:?}: the shared gate must not claim a prefix lookalike"
        );
        assert!(
            managed_key_owner(variant).is_none(),
            "{variant:?}: folding a lookalike must not turn it into a managed key"
        );
    }
}

/// The refusal text is what the UI shows, so it is pinned byte for byte — the
/// owner name included. Deleting the bridge-local predicate must not move it.
#[test]
fn run_set_setting_refusal_message_is_byte_identical() {
    let conn = fresh_conn();
    let err = run_set_setting(&conn, "local_api.enabled", "1", "t-1").unwrap_err();
    assert!(
        matches!(&err, BridgeError::Invalid(m)
            if m.as_str() == "local_api.enabled is managed by the Local API controls \u{2014} use those"),
        "exact message the UI shows: {err:?}",
    );
    let err = run_set_setting(&conn, "lan_server.bind", "0.0.0.0", "t-1").unwrap_err();
    assert!(
        matches!(&err, BridgeError::Invalid(m)
            if m.as_str() == "lan_server.bind is managed by the LAN server controls \u{2014} use those"),
        "exact message the UI shows: {err:?}",
    );
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
        // `sync.auth_token` is a second cleartext copy of the sync API key.
        // It matched nothing above until it was declared as a constant at
        // all, which is the whole reason it needed a marker of its own: the
        // name carries neither SECRET nor API_KEY nor PASSWORD, so the
        // family test could only catch it by the token word itself. Narrowed
        // to the full constant name for the same reason REDIS_URL is — a
        // bare "TOKEN" would sweep any future `*_TOKEN` setting into the
        // credential family before anyone had decided it was one.
        "AUTH_TOKEN",
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
    let table: [(&str, &str); 20] = [
        ("SYNC_API_KEY", keys::SYNC_API_KEY),
        ("AUTH_TOKEN", keys::AUTH_TOKEN),
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
        ("LICENSE_PHONE", keys::LICENSE_PHONE),
        ("STRIPE_API_KEY", keys::STRIPE_API_KEY),
        ("SQUARE_API_KEY", keys::SQUARE_API_KEY),
        ("MIDTRANS_SERVER_KEY", keys::MIDTRANS_SERVER_KEY),
        ("SYNC_TERMINAL_ID", keys::SYNC_TERMINAL_ID),
        ("MACHINE_ID", keys::MACHINE_ID),
        ("HARDWARE_FINGERPRINT", keys::HARDWARE_FINGERPRINT),
    ];
    // The table is the readable statement of the swept set, so it must BE the
    // swept set. The computed balance in
    // `every_credential_family_key_declared_in_keys_rs_is_blocked` passes on
    // its own while this table lags a constant behind (LICENSE_PHONE did,
    // between bfd03822f and here) — a subset table that passes and a balance
    // that passes are two different guarantees, so the one-to-one is an
    // assertion, not a review act.
    let mut swept_names: Vec<String> = declared_keys()
        .into_iter()
        .filter(|(name, _)| is_credential_family(name))
        .map(|(name, _)| name)
        .collect();
    swept_names.sort();
    let mut table_names: Vec<String> = table.iter().map(|(name, _)| name.to_string()).collect();
    table_names.sort();
    assert_eq!(
        table_names, swept_names,
        "the credential table and the swept family must be the same set"
    );
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

    let tx = conn.unchecked_transaction().unwrap();
    run_set_settings_batch(
        &tx,
        &HashMap::from([(
            SMTP_CONFIG_SETTINGS_KEY.to_string(),
            r#"{"host":"smtp.new.com","port":465,"username":null,"password":null,"from":"b@c.com","use_tls":true}"#
                .to_string(),
        )]),
        "term-1",
    )
    .unwrap();
    tx.commit().unwrap();

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

/// The batch funnel must hand back what it wrote, because that is exactly what
/// the command enqueues: the sync payload carries the MERGED blob (with the
/// stored secret carried forward), never the passwordless re-post the client
/// sent. Against the pre-fix shape — where `set_settings_scoped` enqueued the
/// ORIGINAL `entries` — the offered row was not what we had written, and it
/// shipped only because `remote_sync_admits` refuses `smtp_config`.
#[test]
fn batch_funnel_returns_what_it_wrote_so_the_enqueue_carries_the_merged_blob() {
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

    let tx = conn.unchecked_transaction().unwrap();
    let written = run_set_settings_batch(
        &tx,
        &HashMap::from([
            (
                SMTP_CONFIG_SETTINGS_KEY.to_string(),
                r#"{"host":"smtp.new.com","port":465,"username":null,"password":null,"from":"b@c.com","use_tls":true}"#
                    .to_string(),
            ),
            ("store_name".to_string(), "My Store".to_string()),
        ]),
        "term-1",
    )
    .unwrap();
    tx.commit().unwrap();

    // What would be offered to the network is exactly what the table holds.
    let stored = Settings::get(&conn, SMTP_CONFIG_SETTINGS_KEY)
        .unwrap()
        .unwrap();
    assert_eq!(
        written.get(SMTP_CONFIG_SETTINGS_KEY),
        Some(&stored),
        "the enqueue map must carry smtp_config as written, not as posted"
    );
    let blob: serde_json::Value = serde_json::from_str(&stored).unwrap();
    assert!(
        !blob["password"].as_str().unwrap_or("").is_empty(),
        "the written blob must carry the stored password forward: {blob}"
    );
    assert_eq!(
        blob["host"], "smtp.new.com",
        "the other fields must still update"
    );
    assert_eq!(written.get("store_name"), Some(&"My Store".to_string()));
}

/// Same discipline for the single-write funnel: the two single-write commands
/// enqueue what `run_set_setting` returns, so it must be the value AS WRITTEN.
#[test]
fn single_write_funnel_returns_what_it_wrote() {
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

    let effective = run_set_setting(
        &conn,
        SMTP_CONFIG_SETTINGS_KEY,
        r#"{"host":"smtp.new.com","port":465,"username":null,"password":null,"from":"b@c.com","use_tls":true}"#,
        "term-1",
    )
    .unwrap();

    let stored = Settings::get(&conn, SMTP_CONFIG_SETTINGS_KEY)
        .unwrap()
        .unwrap();
    assert_eq!(
        effective, stored,
        "the single-write funnel must return the merged blob, not the posted one"
    );
}

/// A batch containing a manager-owned key is refused and writes NOTHING — not
/// even the innocent sibling key. Refusal is batch-wide and pre-flight, which
/// is what the command's documented all-or-nothing semantics require.
#[test]
fn batch_write_refuses_local_api_secret_and_writes_nothing() {
    let conn = fresh_conn();
    let tx = conn.unchecked_transaction().unwrap();
    let err = run_set_settings_batch(
        &tx,
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
    // Commit ANYWAY. The command would have dropped the transaction here, and
    // a rollback would hide a per-row guard that had already written its
    // sibling; committing proves the refusal was pre-flight, not a side effect
    // of the abort.
    tx.commit().unwrap();
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

/// The OTHER half of the guard `Settings::set_tracked` used to apply per row:
/// a deny-listed credential (that is NOT manager-owned, so the first guard
/// cannot see it) must be refused batch-wide before any write. This is the
/// test that pins the bridge's restatement of platform-core's
/// `refuse_cleartext_credential` — if the two ever diverge, this fails.
#[test]
fn batch_write_refuses_a_deny_listed_credential_key() {
    let conn = fresh_conn();
    let tx = conn.unchecked_transaction().unwrap();
    // A credential that is NOT manager-owned, so the first guard cannot be what
    // refuses it: "machine_id" is a device key, not a secret, and "local_api.*"
    // is caught by the manager prefix rule.
    assert!(is_secret_setting_key("pg_sync.password"));
    assert!(!is_manager_owned_key("pg_sync.password"));
    let err = run_set_settings_batch(
        &tx,
        &HashMap::from([
            (
                "pg_sync.password".to_string(),
                "spoofed-password".to_string(),
            ),
            ("store_name".to_string(), "My Store".to_string()),
        ]),
        "term-1",
    )
    .unwrap_err();
    tx.commit().unwrap();
    assert!(
        matches!(&err, BridgeError::Invalid(m) if m.contains("pg_sync.password") && !m.contains("spoofed-password")),
        "refusal must name the key and never the value: {err:?}"
    );
    assert!(
        Settings::get(&conn, "store_name").unwrap().is_none(),
        "the sibling of a refused credential row must not land either"
    );
    // smtp_config is the one named exception and must still be writable, or the
    // email-report card's Save button stays broken.
    assert!(
        is_secret_setting_key(SMTP_CONFIG_SETTINGS_KEY),
        "smtp_config is on the deny list, which is what makes the exception matter"
    );
}

/// The two doors must refuse the same key with the SAME VARIANT. The batch
/// pre-flight raises `BridgeError::Invalid`; the single-write door now asks
/// platform-core the same question (`TrackedSettings::cleartext_credential_refusal`)
/// before its tracked write, so it raises `Invalid` too. Left to the funnel
/// alone its refusal came back as `PlatformError::Internal` and crossed as
/// `BridgeError::Core { sub_kind: Internal }` — one key, one sentence, two
/// error classes depending on which button the user pressed. This test is
/// what stops that drifting back.
#[test]
fn both_write_doors_refuse_a_credential_with_the_same_variant() {
    let key = "pg_sync.password";
    assert!(is_secret_setting_key(key));
    assert!(
        !is_manager_owned_key(key),
        "the manager-key guard must not be what refuses this key"
    );

    let single = run_set_setting(&fresh_conn(), key, "spoofed-password", "term-1").unwrap_err();
    assert!(
        matches!(&single, BridgeError::Invalid(_)),
        "single door must refuse a credential as Invalid, like the batch door: {single:?}"
    );

    let conn = fresh_conn();
    let tx = conn.unchecked_transaction().unwrap();
    let batch = run_set_settings_batch(
        &tx,
        &HashMap::from([(key.to_string(), "spoofed-password".to_string())]),
        "term-1",
    )
    .unwrap_err();
    tx.commit().unwrap();
    assert!(
        matches!(&batch, BridgeError::Invalid(_)),
        "batch door must refuse a credential as Invalid: {batch:?}"
    );
}

/// And the words must be IDENTICAL: both doors ask platform-core's
/// `cleartext_credential_refusal`, so a refusal says exactly the same sentence
/// whichever door raised it — and it names the key, never the value.
#[test]
fn both_write_doors_credential_refusals_carry_the_identical_message() {
    let key = "pg_sync.password";
    let refusal_message = |err: &BridgeError| match err {
        BridgeError::Invalid(m) => m.clone(),
        other => panic!("expected BridgeError::Invalid, got {other:?}"),
    };
    let single = refusal_message(
        &run_set_setting(&fresh_conn(), key, "spoofed-password", "term-1").unwrap_err(),
    );
    let conn = fresh_conn();
    let tx = conn.unchecked_transaction().unwrap();
    let batch = refusal_message(
        &run_set_settings_batch(
            &tx,
            &HashMap::from([(key.to_string(), "spoofed-password".to_string())]),
            "term-1",
        )
        .unwrap_err(),
    );
    tx.commit().unwrap();
    assert_eq!(
        single, batch,
        "the two doors must speak platform-core's one refusal wording"
    );
    assert!(
        single.contains(key) && !single.contains("spoofed-password"),
        "the shared refusal names the key and never the value: {single}"
    );
}

/// Control, and the guard against over-correction: refusing a bad row by
/// aborting the WHOLE batch is only safe because it is what the single-write
/// funnel does too. Two ordinary keys must both land.
#[test]
fn batch_write_of_two_ordinary_keys_lands_both() {
    let conn = fresh_conn();
    let tx = conn.unchecked_transaction().unwrap();
    let written = run_set_settings_batch(
        &tx,
        &HashMap::from([
            ("store_name".to_string(), "My Store".to_string()),
            ("currency".to_string(), "IDR".to_string()),
        ]),
        "term-1",
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, "store_name").unwrap().as_deref(),
        Some("My Store")
    );
    assert_eq!(
        Settings::get(&conn, "currency").unwrap().as_deref(),
        Some("IDR")
    );
    // The same two rows are what the funnel hands back, verbatim: an ordinary
    // key is not rewritten, so the enqueue map has one entry per posted key and
    // the merge seam touched neither of them. Without this the control test
    // would prove only that the write happened, not that the payload the
    // command now replicates is the one the caller posted.
    assert_eq!(
        written,
        HashMap::from([
            ("store_name".to_string(), "My Store".to_string()),
            ("currency".to_string(), "IDR".to_string()),
        ]),
        "for unmerged keys the returned map must equal the request"
    );
}

// ── The REAL call shape: the command owns an outer transaction ─────────
//
// Every test above calls `run_set_settings_batch` with a BARE connection, a
// shape the product never uses. `set_settings_scoped` opens its own
// `unchecked_transaction` and runs the loop INSIDE it
// (crates/oz-bridge/src/settings.rs:1264-1266). A loop that opens a transaction
// of its own therefore nests, and SQLite rejects the second BEGIN — the same
// class `crates/oz-bridge/src/setup.rs:100-106` documents for
// `Settings::set_batch`. These two tests reproduce the command's shape.

/// The batch door must work inside the transaction the command already owns.
#[test]
fn batch_funnel_runs_inside_the_commands_own_outer_transaction() {
    let conn = fresh_conn();
    let entries = HashMap::from([
        ("store_name".to_string(), "My Store".to_string()),
        ("currency".to_string(), "IDR".to_string()),
    ]);

    let outcome = {
        let tx = conn.unchecked_transaction().unwrap();
        match run_set_settings_batch(&tx, &entries, "term-1") {
            Ok(written) => tx
                .commit()
                .map(|()| written)
                .map_err(|e| format!("commit failed: {e}")),
            Err(e) => {
                drop(tx);
                Err(format!("{e:?}"))
            }
        }
    };

    let written = outcome.expect("the batch door must run inside the command's own transaction");
    assert_eq!(written.len(), 2, "one row per posted key");
    assert_eq!(
        Settings::get(&conn, "store_name").unwrap().as_deref(),
        Some("My Store")
    );
    assert_eq!(
        Settings::get(&conn, "currency").unwrap().as_deref(),
        Some("IDR")
    );
    // ADR #22: the tracked funnel owes a delta row per key, not just a value.
    for key in ["store_name", "currency"] {
        assert_eq!(
            Settings::get_version(&conn, key, "term-1").unwrap(),
            Some(1),
            "{key} must have exactly one delta row after the batch"
        );
    }
}

/// All-or-nothing as the command promises the UI: a refused row must leave
/// NOTHING behind, and the failure must be the guard's refusal, not a
/// transaction error.
#[test]
fn batch_refusal_inside_the_commands_own_transaction_writes_nothing() {
    let conn = fresh_conn();
    let outcome = {
        let tx = conn.unchecked_transaction().unwrap();
        let r = run_set_settings_batch(
            &tx,
            &HashMap::from([
                ("store_name".to_string(), "My Store".to_string()),
                ("local_api.secret".to_string(), "attacker".to_string()),
            ]),
            "term-1",
        );
        // The command propagates the error, so the outer tx is dropped
        // uncommitted — that drop IS the rollback the UI relies on.
        drop(tx);
        r
    };
    let err = outcome.expect_err("a manager-owned key must abort the batch");
    assert!(
        matches!(&err, BridgeError::Invalid(m) if m.contains("local_api.secret")),
        "the failure must be the guard's refusal, not a transaction error: {err:?}"
    );
    assert!(
        Settings::get(&conn, "store_name").unwrap().is_none(),
        "the innocent sibling must not survive the aborted batch"
    );
}

// ── DRIFT PIN — the license rows must stay named by the constants ─────────

/// A DRIFT PIN, not a behaviour test. `crates/oz-bridge/src/license.rs` writes
/// its rows through the UNGUARDED `Settings::set_batch` door — four calls, at
/// :181, :206, :231 and :313 — and two of those four pass RETYPED STRING
/// LITERALS instead of naming the shared constants: seven literal rows, five
/// distinct keys. `platform/core/src/settings/keys.rs:206-213` states the rule
/// as plainly as it can be stated — the guard lists are built FROM the
/// constants declared there, "never from retyped literals", exactly so that
/// "renaming a key value moves the guard with it instead of silently dropping
/// coverage". These license rows are the largest retyped group left in the
/// tree, and nothing asserted the rule, so the rule was a comment.
///
/// Same hazard class as `edd605719` — one name spelled two ways, the two
/// spellings free to drift — measured on the license rows rather than on the
/// `smtp_config` duplicate name, and the same shape as
/// `hw_orphan_keys_match_platform_core_constants` above, which already pins the
/// printer/scanner group this way — the license group was the one left
/// unasserted. This is NOT an open hole tonight: all five
/// values are server-issued or locally minted and no renderer path reaches the
/// key argument, so no operator action writes a different row today. The value
/// of the assertion is that the next rename cannot move the guard off the row
/// that exists without this test going red first.
///
/// The table is the whole literal vocabulary of that file, not a sample: the
/// two writes that already name their keys through constants (:206
/// `keys::MACHINE_ID`, :231 `keys::HARDWARE_FINGERPRINT`) contribute no
/// literal to compare, and every READER of these rows in the same file (:116,
/// :252, :255, :474, :596, :597, :727, :762) uses one of the five spellings
/// below. Both kinds of site are therefore named, and every literal in the
/// table has a real constant — no row compares a spelling to itself.
///
/// Deliberately narrow: spelling against constant, nothing else. No claim here
/// about the VALUES stored under these keys and none about whether a value
/// was encrypted — the license readers carry their own legacy-plaintext
/// tolerance, pinned in the platform-core settings suite.
#[test]
fn license_writer_literals_are_still_the_shared_key_constants_byte_for_byte() {
    use platform_core::settings::keys;
    // (spelling as written at the call site, the constant behind it, its name,
    //  the sites) — byte for byte, so a one-character drift is red.
    let table: &[(&str, &str, &str, &str)] = &[
        (
            "license.payload",
            keys::LICENSE_PAYLOAD,
            "LICENSE_PAYLOAD",
            "license.rs:184 (activate) and :306 (renew)",
        ),
        (
            "license.signature",
            keys::LICENSE_SIGNATURE,
            "LICENSE_SIGNATURE",
            "license.rs:185 (activate) and :307 (renew)",
        ),
        (
            "license.tenant_id",
            keys::LICENSE_TENANT_ID,
            "LICENSE_TENANT_ID",
            "license.rs:186, :310; read at :252",
        ),
        (
            "license.api_key",
            keys::LICENSE_API_KEY,
            "LICENSE_API_KEY",
            "license.rs:187; read at :116, :255, :474, :727, :762",
        ),
        (
            "license.phone",
            keys::LICENSE_PHONE,
            "LICENSE_PHONE",
            "license.rs:188",
        ),
    ];
    for (literal, constant, constant_name, sites) in table {
        assert_eq!(
            *literal, *constant,
            "{sites} spells the settings key {literal:?} as a literal, but \
             platform_core::settings::keys::{constant_name} is now {constant:?}. \
             The deny list is built FROM that constant (rule: \
             platform/core/src/settings/keys.rs:206-213), so this write has moved \
             off the guarded row and the row it actually lands on is unguarded. \
             Route the call site through the constant, or rename the two together \
             in license.rs — do not fix this by editing the expectation here."
        );
    }
}
