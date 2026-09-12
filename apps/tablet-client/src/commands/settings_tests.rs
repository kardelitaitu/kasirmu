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

/// INVERTED from `set_setting_persists_and_get_returns_it`, which asserted
/// that `sync.auth_token` round-trips back to the renderer through
/// `get_setting`. That claim was never testable, because the reader it
/// described does not exist: `git grep -n auth_token -- ui/src` returns the
/// writer (`SettingsPage.tsx`) and a copy of that writer inside a UI test,
/// and nothing else — no `getSettingScoped(.., 'sync.auth_token')` call, no
/// Rust reader outside this suite. A test that asserts a round trip needs two
/// ends; this one only ever exercised the write, so it was pinning the
/// storage layer to itself and calling the pair a contract.
///
/// The key is now registered as `keys::AUTH_TOKEN` and sits on the shared
/// credential deny list, so the honest assertion is the refusal — the same
/// shape `get_setting_redacts_secret_keys` already takes. The row is seeded
/// through `Settings::set`, NOT through the funnel: since 0f26a4b29 the tracked
/// funnel refuses a deny-listed credential stored in cleartext as well, so the
/// old premise — that the funnel guards only manager-owned keys and the write
/// therefore still lands — is false, and a funnel seed would fail on the write
/// before the read boundary was ever exercised. The read is still the thing
/// under test, which is why the row has to exist for it to mean anything.
///
/// Named for the two INDEPENDENT facts it pins: the row is in the table (when
/// a raw door put it there) and the read still refuses it. The first half used
/// to read "set_setting persists", which stopped being true at 0f26a4b29 — the
/// funnel refuses the write now — so the persistence claim is scoped to the
/// door that actually performed it.
#[test]
fn denied_key_persists_when_written_raw_but_get_refuses_it() {
    let conn = fresh_conn();
    // Seed door: the untracked `Settings::set`. The funnel refuses this write
    // now, so it cannot be the scaffolding for a read-side test.
    Settings::set(&conn, oz_core::settings::keys::AUTH_TOKEN, "sk_test_abc123").unwrap();
    assert_eq!(
        run_get_setting(&conn, oz_core::settings::keys::AUTH_TOKEN).unwrap(),
        None,
        "sync.auth_token is a cleartext copy of the sync API key and must never reach the renderer"
    );
    // The row is still there — the refusal is at the IPC surface, not in the
    // table. Naming the difference keeps the next reader from "fixing" this
    // by deleting the write and concluding the guard works.
    assert_eq!(
        Settings::get(&conn, oz_core::settings::keys::AUTH_TOKEN).unwrap(),
        Some("sk_test_abc123".into()),
        "the row must exist, or the read refusal above proves nothing"
    );
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
    // WHY THESE SEEDS DO NOT GO THROUGH run_set_setting: this test asserts a
    // READ-side property, so the write is scaffolding only. Since 0f26a4b29 the
    // tracked funnel refuses a deny-listed credential stored in cleartext
    // (Settings::refuse_cleartext_credential), so funnel-seeding it fails on the
    // write and never reaches the redaction assertion. Settings::set is the
    // untracked door the lifecycle managers themselves use, and it stores what it
    // is handed - the same seed the desktop bridge redaction test uses. Do NOT
    // tidy these lines back onto run_set_setting.
    Settings::set(&conn, "sync_api_key", "secret-key").unwrap();
    Settings::set(&conn, "pg_sync.password", "db-pass").unwrap();
    // lan_server.* is manager-owned: the guarded writer rejects it (see
    // run_set_setting_rejects_lan_server_bind), so seed it raw — same as the
    // desktop bridge's redaction test.
    Settings::set(&conn, "lan_server.psk", "psk-val").unwrap();
    // smtp_config is the one named exception to that cleartext refusal
    // (Settings::CLEARTEXT_CREDENTIAL_EXCEPTION), so it still goes through the
    // writer a real tablet save takes - the merge seam, not a refusal.
    run_set_setting(&conn, "smtp_config", "smtp-secret", "t").unwrap();
    Settings::set(&conn, "stripe.api_key", "sk_test_stripe").unwrap();
    Settings::set(&conn, "square.api_key", "sq_test_square").unwrap();
    Settings::set(&conn, "midtrans.server_key", "mid_test").unwrap();
    assert_eq!(run_get_setting(&conn, "pg_sync.password").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "lan_server.psk").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "smtp_config").unwrap(), None);
    // UI-1: payment gateway credentials must never reach the renderer.
    assert_eq!(run_get_setting(&conn, "stripe.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "square.api_key").unwrap(), None);
    assert_eq!(run_get_setting(&conn, "midtrans.server_key").unwrap(), None);
    // license.api_key was asserted here without ever being seeded, so the
    // refusal passed over an absent row; seed it like the desktop twin does.
    Settings::set(&conn, "license.api_key", "lic-key").unwrap();
    assert_eq!(run_get_setting(&conn, "license.api_key").unwrap(), None);
    run_set_setting(&conn, "store.name", "My Store", "t").unwrap();
    assert_eq!(
        run_get_setting(&conn, "store.name").unwrap(),
        Some("My Store".into())
    );
}

/// Manager-owned keys (`local_api.*`, `lan_server.*`) must be refused by the
/// tablet write funnel exactly as the desktop bridge refuses them — the shared
/// `platform_core::settings::is_manager_owned_key` predicate is the rule, so
/// the two shells cannot drift on what the prefixes mean. A tablet save of
/// `local_api.secret` would silently replace the Local API signing secret.
#[test]
fn run_set_setting_rejects_local_api_secret_and_writes_nothing() {
    let conn = fresh_conn();
    let err = run_set_setting(&conn, "local_api.secret", "attacker-secret", "term-1").unwrap_err();
    assert!(
        matches!(&err, AppError::Invalid(m) if m.contains("local_api.secret")),
        "refusal must be the bridge-shaped Invalid error naming the key: {err:?}"
    );
    // And nothing was persisted — no value, no delta row.
    assert!(
        Settings::get(&conn, "local_api.secret").unwrap().is_none(),
        "a refused write must not reach the settings table"
    );
    assert!(
        Settings::get_version(&conn, "local_api.secret", "term-1")
            .unwrap()
            .is_none(),
        "a refused write must not create a delta row either"
    );
}

/// lan_server.* is the same manager-owned class (PSK + bind + enabled owned by
/// the LAN server module): the tablet funnel must refuse it too.
#[test]
fn run_set_setting_rejects_lan_server_bind() {
    let conn = fresh_conn();
    let err = run_set_setting(&conn, "lan_server.bind", "0.0.0.0:48080", "term-1").unwrap_err();
    assert!(
        matches!(&err, AppError::Invalid(m) if m.contains("lan_server.bind")),
        "refusal must name the key: {err:?}"
    );
    assert!(
        Settings::get(&conn, "lan_server.bind").unwrap().is_none(),
        "a refused write must not reach the settings table"
    );
}

/// The THIRD refusal this door must raise, and the one that was misclassified.
///
/// `pg_sync.password` is on the credential deny list but is NOT manager-owned,
/// so neither the `local_api.*` / `lan_server.*` guard above nor the read-side
/// redaction can be what stops it — only the cleartext-credential rule can.
///
/// READ THIS BEFORE CALLING IT A DOOR: the tablet never stored the credential.
/// `run_set_setting` ends in `Settings::set_tracked`, and platform-core asks
/// `refuse_cleartext_credential` before it opens the transaction (and again per
/// row inside it), so the write was refused here all along. What was missing was
/// the CLASS: platform-core raises `PlatformError::Internal`, which reaches a
/// tablet renderer as `AppError::Core { sub_kind: Platform }` — "the shell
/// broke" — while the desktop bridge pre-flights the same rule and answers
/// `Invalid` — "you asked for the wrong thing". Same refusal, two error
/// classes, and the operator sees the wrong one on exactly one of the two
/// shells. The pre-flight is now mirrored; these assertions pin both halves.
#[test]
fn run_set_setting_refuses_a_deny_listed_credential_as_invalid() {
    let conn = fresh_conn();
    const SPOOF: &str = "spoofed-db-password";
    let err = run_set_setting(&conn, "pg_sync.password", SPOOF, "term-1").unwrap_err();
    assert!(
        matches!(&err, AppError::Invalid(m)
            if m.contains("pg_sync.password") && !m.contains(SPOOF)),
        "refusal must be Invalid, must name the key, and must never carry the value: {err:?}"
    );
    // And nothing was persisted — no value, no delta row. This is the leg that
    // proves the class fix did not open a door on its way to renaming one.
    assert!(
        Settings::get(&conn, "pg_sync.password").unwrap().is_none(),
        "a refused credential must not reach the settings table"
    );
    assert!(
        Settings::get_version(&conn, "pg_sync.password", "term-1")
            .unwrap()
            .is_none(),
        "a refused credential must not create a delta row either"
    );
}

/// The tablet must not PARAPHRASE the rule. The sentence it returns has to be
/// platform-core's, byte for byte — the same text the desktop bridge hands back
/// (the bridge's `both_write_doors_credential_refusals_carry_the_identical_message`
/// pins the pair on that side). A reworded refusal is a second definition of the
/// policy wearing a message, and the day the exception changes, one shell keeps
/// refusing while the other starts accepting and nothing fails.
#[test]
fn run_set_setting_credential_refusal_carries_platform_core_wording() {
    let conn = fresh_conn();
    let expected = platform_core::settings::Settings::cleartext_credential_refusal(
        oz_core::settings::keys::STRIPE_API_KEY,
    )
    .expect("stripe.api_key must be on the credential deny list");
    let err = run_set_setting(
        &conn,
        oz_core::settings::keys::STRIPE_API_KEY,
        "sk_test_live",
        "term-1",
    )
    .unwrap_err();
    match err {
        AppError::Invalid(m) => assert_eq!(m, expected),
        other => panic!("expected AppError::Invalid, got {other:?}"),
    }
}

/// Control for the two tests directly above, run on ONE connection: a guard
/// that refused every key would pass them and brick the settings page. The
/// ordinary key leg is what separates the pin from the decoration, and the
/// `smtp_config` leg is the exception the pre-flight must NOT restate — if this
/// lane ever writes its own copy of the deny list instead of asking
/// `cleartext_credential_refusal`, the email card's save turns into a refusal
/// here first.
#[test]
fn credential_refusal_is_per_key_and_the_smtp_exception_still_writes() {
    let conn = fresh_conn();
    let err = run_set_setting(&conn, "sync_api_key", "secret-key", "term-1").unwrap_err();
    assert!(
        matches!(&err, AppError::Invalid(m) if m.contains("sync_api_key")),
        "the credential must be refused as Invalid: {err:?}"
    );
    run_set_setting(&conn, "store.name", "My Store", "term-1").unwrap();
    assert_eq!(
        Settings::get(&conn, "store.name").unwrap(),
        Some("My Store".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "store.name", "term-1").unwrap(),
        Some(1)
    );
    // Non-blob value: `merged_smtp_password_json` passes it through unchanged,
    // so this line exercises the exception, not the merge seam.
    run_set_setting(&conn, "smtp_config", "smtp-blob", "term-1").unwrap();
    assert_eq!(
        Settings::get(&conn, "smtp_config").unwrap(),
        Some("smtp-blob".into())
    );
}

/// Control: a guard that refused EVERYTHING would pass the two tests above
/// and fail the shop — an ordinary store-owned key must still land through
/// the tracked path, exactly as before the guard existed.
#[test]
fn run_set_setting_store_name_control_still_writes() {
    let conn = fresh_conn();
    run_set_setting(&conn, "store.name", "My Store", "term-1").unwrap();
    assert_eq!(
        Settings::get(&conn, "store.name").unwrap(),
        Some("My Store".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "store.name", "term-1").unwrap(),
        Some(1)
    );
}

/// INVERTED from `sync_auth_token_cross_screen_roundtrip`, which pinned the
/// opposite contract: that a token saved on SettingsPage must be readable by
/// "another screen (RetailOptionsScreen / useCloudSync)" through
/// `get_setting`. No such reader exists. `useCloudSync` is not in the tree at
/// all — the only surviving mention of it is the comment on the writer at
/// `ui/src/features/settings/SettingsPage.tsx:478` and a doc line in
/// `ui/src/hooks/useSyncConnection.ts` saying that hook replaced it — and
/// `RetailOptionsScreen` survives only as two prose mentions in
/// `PosScreen.tsx`. So the "cross-screen" leg this test claimed to verify was
/// never a screen: both ends of the round trip were the same test writing and
/// reading one row, which is why it could assert a contract the code had no
/// way to honour and still pass.
///
/// What the key actually did was leave the device: a second cleartext copy of
/// the sync API key, posted through the generic funnel, on no deny list, so
/// both untrusted lanes carried it. Now that it is registered as
/// `keys::AUTH_TOKEN` and denied, the honest assertion is the refusal on the
/// read surface AND on the sync egress surface. Since 0f26a4b29 the generic
/// funnel refuses the WRITE too, so the row below is seeded through
/// `Settings::set`: a funnel seed would leave the row absent and turn every
/// refusal asserted on it into a pass over a missing key.
#[test]
fn sync_auth_token_is_refused_on_read_and_never_replicated() {
    use oz_core::settings::IngestPolicyKind as _;
    let conn = fresh_conn();
    let key = oz_core::settings::keys::AUTH_TOKEN;

    // Seeded through the untracked door so every refusal below is a refusal of
    // an EXISTING row, not a vacuous pass over a missing one; the row-exists
    // assertion right below is what keeps that honest.
    Settings::set(&conn, key, "jwt-token-xyz").unwrap();
    assert_eq!(
        Settings::get(&conn, key).unwrap(),
        Some("jwt-token-xyz".into()),
        "the row must exist for the refusals below to mean anything"
    );

    // Read surface: no screen gets it back, which is the claim this test used
    // to make in the opposite direction.
    assert_eq!(
        run_get_setting(&conn, key).unwrap(),
        None,
        "sync.auth_token is a cleartext copy of the sync API key and must never reach the renderer"
    );
    assert!(
        platform_core::settings::keys::is_secret_setting_key(key),
        "it must be denied as a credential, not merely absent"
    );
    assert!(
        !platform_core::settings::keys::NON_EXPORTABLE_DEVICE_KEYS.contains(&key),
        "it is a credential, not device identity — the two lists record different acts"
    );

    // Both untrusted lanes refuse it; the local lane still admits it, because
    // SettingsPage writes it locally and that write is not what is being
    // refused here.
    for policy in [IngestPolicy::RemoteSync, IngestPolicy::PortablePackage] {
        assert!(
            !policy.admits(key),
            "{policy:?} must refuse sync.auth_token"
        );
    }
    assert!(
        IngestPolicy::TrustedLocal.admits(key),
        "the local write must keep working"
    );

    // Egress: a locally saved token must not be offered to the network.
    let store = Store::new(&conn);
    enqueue_settings_update(&store, key, "jwt-token-xyz", "term-1").unwrap();
    assert!(
        store.list_pending_offline().unwrap().is_empty(),
        "the duplicate sync secret must not be queued for sync egress"
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

/// Tablet-lane mirror of the bridge finding: `redis.url` is spelled like an
/// endpoint but the form operators save is `redis://:PASSWORD@host:6379`, so
/// the value IS the credential. It must not be readable through this shell's
/// get_setting and must not be queued for peers, while the daemon's typed
/// accessor keeps reading it for cache setup.
#[test]
fn redis_url_with_embedded_password_is_refused_for_read_and_egress() {
    let conn = fresh_conn();
    let url = "redis://:s3cr3t@10.0.0.5:6379";
    let key = oz_core::settings::keys::REDIS_URL;
    // Seed door: the untracked `Settings::set`. Since 0f26a4b29 the funnel
    // refuses a cleartext `redis.url`, so seeding through it would fail the
    // write and leave the read and egress refusals below untested. Do NOT tidy
    // this back onto run_set_setting.
    Settings::set(&conn, key, url).unwrap();
    assert_eq!(
        run_get_setting(&conn, key).unwrap(),
        None,
        "the redis password must never reach the renderer"
    );
    let store = Store::new(&conn);
    enqueue_settings_update(&store, key, url, "term-1").unwrap();
    assert!(
        store.list_pending_offline().unwrap().is_empty(),
        "redis.url must not be queued for sync egress"
    );
    assert_eq!(
        oz_core::Settings::get_redis_url(&conn).unwrap(),
        url,
        "the local typed accessor is not an egress surface"
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
/// license.phone is PII captured at activation and per-install identity, not
/// device identity: the credential act (deny list — also hidden from the raw
/// get_setting surface) is the correct set, argued by family consistency with
/// license.tenant_id, which was already denied while identifying LESS. Both
/// untrusted lanes must refuse it; the local activation write keeps working,
/// and a restore to a second till is unaffected because the whole license
/// family (api_key KDF-bound to machine_id, payload, signature, tenant_id)
/// already refused the portable package before this key was registered.
#[test]
fn license_phone_is_denied_as_a_credential_and_refused_on_egress() {
    use oz_core::settings::IngestPolicyKind as _;
    let phone = oz_core::settings::keys::LICENSE_PHONE;
    assert!(
        platform_core::settings::keys::is_secret_setting_key(phone),
        "license.phone must be IPC-hidden like the rest of the license family"
    );
    assert!(
        !oz_core::settings::keys::NON_EXPORTABLE_DEVICE_KEYS.contains(&phone),
        "it is per-install identity, not device identity — the acts differ"
    );
    for policy in [IngestPolicy::RemoteSync, IngestPolicy::PortablePackage] {
        assert!(
            !policy.admits(phone),
            "{policy:?} must refuse license.phone"
        );
    }
    assert!(
        IngestPolicy::TrustedLocal.admits(phone),
        "the activation write in license.rs is local and must keep working"
    );

    // And the tablet egress boundary queues nothing for it.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    enqueue_settings_update(&store, phone, "+62-811-000-0000", "term-1").unwrap();
    assert!(
        store.list_pending_offline().unwrap().is_empty(),
        "license.phone must not be queued for sync egress"
    );
}
