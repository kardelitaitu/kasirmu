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
    assert_eq!(result.tax_rounding_mode, Some("half_up".to_string()));
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
        tax_rounding_mode: Some("truncate".into()),
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
    assert_eq!(result.tax_rounding_mode, Some("truncate".to_string()));
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
            tax_rounding_mode: Some("half_up".into()),
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
            tax_rounding_mode: Some("half_up".into()),
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
        tax_rounding_mode: Some("half_up".into()),
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
        tax_rounding_mode: Some("half_up".into()),
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
        tax_rounding_mode: Some("half_up".into()),
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

/// The refusal sentence itself, spelled out. Out-of-band ON PURPOSE.
///
/// The parity sweep at the bottom of this file proves the lanes do not RESTATE
/// the manager-owned-key sentence. This proves the sentence does not MOVE — a
/// different question, and one the sweep is structurally unable to ask: by
/// design it reads the expected words out of the producer at run time, so it
/// transcribes no single word of the sentence and therefore cannot notice a word
/// leaving. `9f1eca86c` is the demonstration: it centralised the sentence,
/// reworded what this lane shows the operator, and the sweep stayed green
/// because the sweep was right to.
///
/// Nor can the two door tests above fail on a rewording — they assert only that
/// the message contains the KEY NAME, and every paraphrase keeps the key.
///
/// So the expectation here is deliberately NOT asked of the producer: an
/// expectation derived from the thing under test cannot notice a paraphrase of
/// it. It also deliberately lives in THIS file and not in `settings.rs`: the
/// sweep reads that file's literals and fails on a restated sentence, and does
/// not read this one.
#[test]
fn tablet_manager_refusal_sentence_drift_pin() {
    let conn = fresh_conn();
    // Both keys are genuinely manager-owned — `is_manager_owned_key` matches the
    // `local_api.` / `lan_server.` prefixes in
    // `platform/core/src/settings/raw.rs` — and the manager door in
    // `run_set_setting` runs BEFORE the credential door, so this probe value is
    // refused by the door under test whichever way the predicates are ordered.
    // This lane has no manager-name lookup, so it passes `None` and the producer
    // substitutes its generic label. `\u{2014}` is the em dash inside that
    // sentence, spelled as an escape exactly as the bridge's byte-identical
    // literals at `crates/oz-bridge/src/settings_tests.rs` spell theirs.
    for (key, expected) in [
        (
            "local_api.enabled",
            "local_api.enabled is managed by the dedicated controls \u{2014} use those",
        ),
        (
            "lan_server.bind",
            "lan_server.bind is managed by the dedicated controls \u{2014} use those",
        ),
    ] {
        let err = run_set_setting(&conn, key, "not-a-value-just-a-probe", "term-1").unwrap_err();
        let AppError::Invalid(message) = &err else {
            panic!("{key}: the manager door must refuse as AppError::Invalid, got {err:?}");
        };
        assert_eq!(
            message.as_str(),
            expected,
            "{key}: this lane's refusal sentence has moved off the producer's — a \
             reworded refusal is a second definition of the policy"
        );
    }
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

// -- Parity: the manager-owned refusal has exactly one producer ----------
//
// The credential sentence got one at fb63dc535 and a sweep at 371b6ace0.
// This is the same seam one rule over: both lanes already asked
// `is_manager_owned_key`, but the WORDING had no owner — the tablet
// hardcoded one phrasing and the bridge built another at both of its
// doors, so a paraphrase could drift with nothing failing.
// `manager_owned_key_refusal` in platform-core is now the only place the
// sentence exists.
//
// Mirrors the pattern the credential sweep established and transcribes no
// wording: the sentence is read out of the producer at run time with a
// marker owner name, split into the fixed words on either side of the
// marker, and the lanes are read out of their own files. Nothing below is
// a copy of a sentence, so a fix to platform-core wording moves this test
// with it instead of failing here first. The helpers are duplicated from
// `crates/oz-bridge/src/settings_tests.rs` because that file guards the
// credential seam and is not this commit to edit.

/// The producer, named once so the three files below are compared against it.
use platform_core::settings::Settings as ManagerProducer;

const PLAT_RAW_RS: &str = include_str!("../../../../platform/core/src/settings/raw.rs");
const BRIDGE_SETTINGS_RS: &str = include_str!("../../../../crates/oz-bridge/src/settings.rs");
const TABLET_SETTINGS_RS: &str = include_str!("settings.rs");

/// String literals in a file, comments removed, so prose cannot be counted
/// as a restated sentence.
fn swept_literals(source: &str) -> Vec<String> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && next == Some('*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        if c == '"' {
            i += 1;
            let mut lit = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    lit.push(chars[i + 1]);
                    i += 2;
                } else {
                    lit.push(chars[i]);
                    i += 1;
                }
            }
            i += 1;
            out.push(lit);
            continue;
        }
        i += 1;
    }
    out
}

/// Code only: comments never count as a call site.
fn swept_code_lines(source: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_block = false;
    for line in source.lines() {
        let t = line.trim_start();
        if in_block {
            if t.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if t.starts_with("/*") {
            in_block = true;
            continue;
        }
        if t.starts_with("//") {
            continue;
        }
        let cut = match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        };
        out.push(cut.to_string());
    }
    out
}

/// The longest contiguous case-insensitive word run two sentences share:
/// the paraphrase meter — a copy shares everything, a paraphrase a phrase.
fn longest_shared_word_run(text: &str, sentence: &str) -> usize {
    let a: Vec<&str> = sentence.split_whitespace().collect();
    let b: Vec<&str> = text.split_whitespace().collect();
    let mut best = 0usize;
    for i in 0..a.len() {
        for j in 0..b.len() {
            let mut k = 0usize;
            while i + k < a.len() && j + k < b.len() && a[i + k].eq_ignore_ascii_case(b[j + k]) {
                k += 1;
            }
            if k > best {
                best = k;
            }
        }
    }
    best
}

#[test]
fn both_shell_lanes_take_the_manager_refusal_from_its_one_producer() {
    // (A) Read the sentence out of the producer with a marker in the NAME
    // slot, so the fixed words on either side of the label are derived.
    let marker = "marker-owner-name";
    let probe = "local_api.enabled";
    let sentence = ManagerProducer::manager_owned_key_refusal(probe, Some(marker))
        .expect("the producer refuses a manager-owned key");
    assert!(
        sentence.starts_with(probe),
        "the refusal must name the key: {sentence:?}"
    );
    let (head, tail) = sentence
        .split_once(marker)
        .expect("the producer puts the owner name inside the sentence");
    let head_words: Vec<&str> = head[probe.len()..].split_whitespace().collect();
    let tail_words: Vec<&str> = tail.split_whitespace().collect();
    let frame = head_words.len() + tail_words.len();
    assert!(
        head_words.len() >= 3 && tail_words.len() >= 3 && frame >= 6,
        "the sentence frame around the owner name collapsed to {frame} words, too thin to sweep against: {sentence:?}"
    );
    let head_run = head_words.join(" ");
    let tail_run = tail_words.join(" ");

    // The rule, asked of the producer: a generic label where a lane has no
    // name, and silence for a key nobody owns — including a credential,
    // which is the other door and must not collapse into this one.
    let generic = ManagerProducer::manager_owned_key_refusal("lan_server.bind", None)
        .expect("lan_server.* is manager-owned");
    assert!(
        !generic.contains(marker) && generic != sentence,
        "the generic refusal is not a named one: {generic:?}"
    );
    for not_mine in [
        "store.name",
        "sync.auth_token",
        "local_api",
        "my_local_api.x",
    ] {
        assert!(
            ManagerProducer::manager_owned_key_refusal(not_mine, None).is_none(),
            "{not_mine} is not manager-owned, so the producer must not refuse it"
        );
    }

    // (B) Exactly one of the three swept files carries the sentence.
    let mut carriers: Vec<String> = Vec::new();
    for (label, source) in [
        ("platform/core/src/settings/raw.rs", PLAT_RAW_RS),
        ("crates/oz-bridge/src/settings.rs", BRIDGE_SETTINGS_RS),
        (
            "apps/tablet-client/src/commands/settings.rs",
            TABLET_SETTINGS_RS,
        ),
    ] {
        let literals = swept_literals(source);
        assert!(
            literals.len() >= 5,
            "the sweep read only {} string literals out of {label}: the include_str path moved, so this leg finds nothing rather than finding agreement",
            literals.len()
        );
        let borrowed: Vec<String> = literals
            .iter()
            // A paraphrase keeps one half of the frame and bends the other, so
            // the meter adds the two runs and lets exactly one word go: a copy
            // scores the full frame, a reworded lane still scores frame - 1, and
            // an unrelated sentence about the same subject scores one or two.
            .filter(|lit| {
                let h = longest_shared_word_run(lit, &head_run);
                let t = longest_shared_word_run(lit, &tail_run);
                h >= 2 && t >= 2 && h + t >= frame - 1
            })
            .cloned()
            .collect();
        assert!(
            borrowed.len() <= 1,
            "{label} carries the manager-refusal wording in {} separate literals, so the sentence is being rebuilt inside one lane: {borrowed:?}",
            borrowed.len()
        );
        if !borrowed.is_empty() {
            carriers.push(label.to_string());
        }
    }
    let carrier_n = carriers.len();
    assert_eq!(
        carriers,
        vec!["platform/core/src/settings/raw.rs".to_string()],
        "the manager-owned-key refusal sentence has {carrier_n} carrier(s) among the swept lanes: {carriers:?} — it must live in raw.rs alone, beside cleartext_credential_refusal, and be CALLED from the lanes. Swept scope is those three files, not the whole tree."
    );

    // (C) Each lane asks the producer and wraps the answer in its own
    // Invalid. Counts are what the files hold: bridge at two doors,
    // tablet at one, platform-core defining it once.
    for (label, source, wrap, asks) in [
        (
            "platform/core/src/settings/raw.rs",
            PLAT_RAW_RS,
            "pub fn",
            1usize,
        ),
        (
            "crates/oz-bridge/src/settings.rs",
            BRIDGE_SETTINGS_RS,
            "BridgeError::Invalid(refusal)",
            2usize,
        ),
        (
            "apps/tablet-client/src/commands/settings.rs",
            TABLET_SETTINGS_RS,
            "AppError::Invalid(refusal)",
            1usize,
        ),
    ] {
        let lines = swept_code_lines(source);
        let asked: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.contains("manager_owned_key_refusal("))
            .map(|(i, _)| i)
            .collect();
        assert_eq!(
            asked.len(),
            asks,
            "{label} names manager_owned_key_refusal at code lines {asked:?}, expected {asks}"
        );
        if wrap != "pub fn" {
            let wrapped = asked
                .iter()
                .filter(|i| {
                    lines
                        .iter()
                        .skip(**i)
                        .take(5)
                        .any(|later| later.contains(wrap))
                })
                .count();
            assert_eq!(
                wrapped, asks,
                "{label} asks the producer {asks} time(s) but wraps the answer in {wrap} only {wrapped} time(s): a lane refusing the same act with a different variant, or building its own wording, is what this sweep exists to catch"
            );
        }
    }

    // (D) Executable leg, tablet side: the door emits the producer sentence
    // unchanged and leaks no value into it.
    let conn = fresh_conn();
    let value = "0.0.0.0:48080";
    let err = run_set_setting(&conn, "lan_server.bind", value, "term-1").unwrap_err();
    let AppError::Invalid(message) = &err else {
        panic!("the tablet door must refuse a manager key as Invalid: {err:?}")
    };
    assert_eq!(
        message,
        &ManagerProducer::manager_owned_key_refusal("lan_server.bind", None)
            .expect("the producer refuses lan_server.bind"),
        "the tablet lane did not pass the producer sentence through unchanged: {message:?}"
    );
    assert!(
        !message.contains(value),
        "the refusal leaked the value it was handed: {message}"
    );
}

// ── The read door and the key the status bar asks for ─────────────────────
//
// Appended for the `useGatewayStatus` claim: a reviewer measured that
// `ui/src/hooks/useGatewayStatus.ts:23` calls the UNGATED `get_setting`
// command with a deny-listed credential name and concluded the credential
// reaches the renderer, because the refusal built all night sits on the write
// path (`set_tracked`) and on the egress/ingest policies. These two tests
// settle whether the READ half answers it. It refuses.

/// A sentinel value, not a credential — shaped like a Stripe test key so a
/// reader recognises the field, and carrying a word no real key contains so it
/// cannot be mistaken for live material.
const GATEWAY_PROBE_SENTINEL: &str = "sk_test_SENTINEL_NOT_A_REAL_KEY_deadbeef";

/// Extract one function body, through its closing brace, from a source string.
fn read_door_body(src: &str, signature: &str) -> String {
    let start = src
        .find(signature)
        .unwrap_or_else(|| panic!("signature `{signature}` no longer exists: the door moved"));
    let rest = &src[start..];
    let open = rest.find('{').expect("a function body opens with a brace");
    let mut depth = 0usize;
    let mut body = String::new();
    for ch in rest[open..].chars() {
        body.push(ch);
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
    }
    body
}

/// DECISION PIN — `run_get_setting` refuses `stripe.api_key`; the caller is
/// dead code, not a leak.
///
/// The refusal is on the READ path, not only the write path: `run_get_setting`
/// asks `is_secret_key` (-> `platform_core::settings::keys::is_secret_setting_key`
/// -> `credential_base` -> whole-key equality against `SECRET_KEY_DENY_LIST`)
/// and returns `Ok(None)` before it touches the table. The bare spelling
/// `stripe.api_key` is inside that domain by construction; the suffix-blind
/// miss (`smtp_config:tenant-a`) is a different shape and is pinned in
/// `keys_tests.rs`, not here.
///
/// The second assertion is the one that keeps the first honest, and it is also
/// the measurement the claim turned on: BELOW the door, `Settings::get` hands
/// the sentinel back byte for byte. There is no decrypt step on this path, so
/// whatever is stored is what a caller would receive — the name test is the
/// only thing between a stored credential and an IPC surface that checks no
/// permission. If a read gate is ever removed, this pin does not "become
/// wrong": the hazard it names becomes real, and the value it asserts is the
/// evidence.
#[test]
fn decision_pin_run_get_setting_refuses_the_key_the_status_bar_hook_asks_for() {
    let conn = fresh_conn();
    // Premise, measured: the caller's spelling resolves to a credential base.
    assert_eq!(
        platform_core::settings::keys::credential_base("stripe.api_key"),
        Some("stripe.api_key"),
        "the bare spelling must be inside the credential domain, or this pin          refuses a key nothing owns"
    );
    assert!(
        platform_core::settings::keys::is_secret_setting_key("stripe.api_key"),
        "SECRET_KEY_DENY_LIST lost stripe.api_key"
    );

    // Seed through the untracked door: the tracked funnel refuses a cleartext
    // deny-listed write, so a funnel seed would leave the row absent and make
    // the refusal below a pass over nothing.
    Settings::set(&conn, "stripe.api_key", GATEWAY_PROBE_SENTINEL).unwrap();
    assert_eq!(
        Settings::get(&conn, "stripe.api_key").unwrap().as_deref(),
        Some(GATEWAY_PROBE_SENTINEL),
        "one level below the door the read path returns the stored value          verbatim — it does not decrypt, it does not withhold"
    );
    assert_eq!(
        run_get_setting(&conn, "stripe.api_key").unwrap(),
        None,
        "the ungated get_setting door must answer a deny-listed name with None"
    );
    // Control: the door is a name test, not a broken read.
    Settings::set(&conn, "store.name", "Counter Store").unwrap();
    assert_eq!(
        run_get_setting(&conn, "store.name").unwrap().as_deref(),
        Some("Counter Store"),
        "an ordinary key must still read back through the same door"
    );
}

/// DECISION PIN — both doors, on both shells, reach that one refused function.
///
/// The unscoped command is what `useGatewayStatus` calls; the scoped twin is
/// what a future "fix" would reach for. Both must delegate. A door that reads
/// the table itself puts the credential back on the wire, and on the scoped
/// side a `settings:read` permission is NOT a credential rule — a manager can
/// hold the permission and still have no business reading a secret. Sweep, not
/// a call, because the standing-up of a session adds nothing to what is being
/// pinned here: which function the body names.
#[test]
fn decision_pin_both_read_doors_on_both_shells_reach_the_refused_function() {
    for (label, src) in [
        ("tablet settings.rs", TABLET_SETTINGS_RS),
        ("oz-bridge settings.rs", BRIDGE_SETTINGS_RS),
    ] {
        for signature in [
            "pub async fn get_setting(",
            "pub async fn get_setting_scoped(",
        ] {
            let body = read_door_body(src, signature);
            assert!(
                body.contains("run_get_setting"),
                "{label}: `{signature}` no longer reaches the refused door —                  it either reads the table itself or the door was renamed. Body: {body}"
            );
            assert!(
                !body.contains("Settings::get"),
                "{label}: `{signature}` grew its own read of the settings                  table, which bypasses the credential refusal in run_get_setting"
            );
        }
    }
}

// ── Phase 3.3 T4: the settings wire pins ────────────────────────────
//
// Everything above this line either builds a Rust value and asserts on the
// JSON that value produces, or hand-writes JSON transcribed from that same
// output. Neither shape can see the bug class T3 found in
// `LocalPaymentRailArgs`: a DTO and its only caller may disagree about key
// casing, and every self-referential test still passes, because the fixture
// was copied from the wrong side of the boundary. The card reports "saved"
// and the value never lands.
//
// These pins are written from the renderer instead. Every expected key list
// below is transcribed field-for-field from `ui/src/api/settings.ts` (and
// `ui/src/api/gateway.ts` for the status entry), so a Rust field renamed
// without the UI following — in either direction, camelCase or snake_case —
// reads red here instead of shipping.
//
#[test]
fn wire_pin_credit_sale_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:74 — CreditSaleDto. The renderer reads it as
    // camelCase in three places: features/retail/RetailModals.tsx:375-389
    // (`c.saleId` as the row key and again for Settle, `c.customerName`,
    // `c.totalMinor`, `c.createdAt`) and features/retail/RetailPosScreen.tsx:1274
    // and :1286 (`!c.settledAt`, `c.saleId !== saleId`).
    //
    // The struct carried no `rename_all` in ANY of its three definitions
    // (oz-bridge, the desktop re-export of it, and this shell's own copy), so it
    // emitted snake_case and every one of those reads was `undefined`: the list
    // showed an em-dash for the customer, NaN for the amount and "Invalid Date"
    // for the date; Settle sent `sale_id: undefined`; and the quiet one — the
    // `!c.settledAt` filter passed EVERY row, so a settled tab stayed on the
    // unpaid list forever. Invisible because
    // `ui/src/dev-mock/handlers/payment.ts:231-232` answers both
    // `list_credit_sales` variants with `[]`, and because nothing in the repo
    // had serialized this type in a test before this one.
    let dto = CreditSaleDto {
        sale_id: "s-1".into(),
        customer_name: "Bagus".into(),
        total_minor: 25_000,
        currency: "IDR".into(),
        created_at: "2026-09-15T00:00:00Z".into(),
        settled_at: None,
        cashier_name: "Rina".into(),
    };
    let mut want = [
        "saleId",
        "customerName",
        "totalMinor",
        "currency",
        "createdAt",
        "settledAt",
        "cashierName",
    ];
    want.sort_unstable();
    assert_eq!(
        wire_keys(&dto),
        want.iter().map(|k| k.to_string()).collect::<Vec<String>>(),
        "CreditSaleDto must serialize the keys the retail credit list reads"
    );
    // Names alone are not the contract: a renamed field whose value was mapped
    // to the wrong source would pass the key set above and still render the
    // wrong amount, so two values are read out by key.
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["totalMinor"], 25_000);
    assert_eq!(json["saleId"], "s-1");
    assert!(
        json["settledAt"].is_null(),
        "an open tab must emit `settledAt: null` rather than omit the key, so the renderer can tell an open tab from an absent field"
    );
}

/// Sorted key set of a value as the wire carries it.
fn wire_keys<T: Serialize>(value: &T) -> Vec<String> {
    let json = serde_json::to_value(value).expect("a settings DTO must serialize");
    let mut keys: Vec<String> = json
        .as_object()
        .expect("the wire shape of a settings DTO is an object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

/// Parse `payload` the way the command layer will, then send it back out, and
/// require every key the renderer wrote to still be there. Absence is the
/// silent-loss shape: serde ignores an unknown field unless the struct says
/// `deny_unknown_fields`, so the write returns `Ok(())` with the value gone.
fn assert_wire_matches<T>(payload: &str, expected: &[&str], label: &str)
where
    T: Serialize + serde::de::DeserializeOwned,
{
    let sent: serde_json::Map<String, serde_json::Value> = serde_json::from_str(payload)
        .unwrap_or_else(|e| panic!("{label}: pin is not valid JSON: {e}"));
    let parsed: T = serde_json::from_str(payload)
        .unwrap_or_else(|e| panic!("{label}: the DTO rejects the payload the renderer sends: {e}"));
    let mut keys = wire_keys(&parsed);
    let mut want: Vec<&str> = expected.to_vec();
    want.sort_unstable();
    keys.sort();
    let want: Vec<String> = want.iter().map(|k| (*k).to_string()).collect();
    assert_eq!(
        keys, want,
        "{label}: the wire key set does not match the renderer's declared interface"
    );
    let dropped: Vec<&String> = sent.keys().filter(|k| !keys.contains(k)).collect();
    assert!(
        dropped.is_empty(),
        "{label}: accepted and silently dropped {} renderer key(s): {dropped:?}",
        dropped.len()
    );
}

#[test]
fn wire_pin_receipt_settings_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:9 — ReceiptSettingsDto (11 keys, taxRoundingMode optional).
    const PAYLOAD: &str = r#"{
        "showCurrency": true, "decimalSeparator": "comma", "showTax": false,
        "footer": "Terima kasih", "paperWidth": "narrow", "showTableNumber": true,
        "marginTop": 5, "marginBottom": 4, "marginLeft": 3, "marginRight": 2,
        "taxRoundingMode": "truncate"
    }"#;
    assert_wire_matches::<ReceiptSettingsDto>(
        PAYLOAD,
        &[
            "showCurrency",
            "decimalSeparator",
            "showTax",
            "footer",
            "paperWidth",
            "showTableNumber",
            "marginTop",
            "marginBottom",
            "marginLeft",
            "marginRight",
            "taxRoundingMode",
        ],
        "ReceiptSettingsDto",
    );
    let parsed: ReceiptSettingsDto = serde_json::from_str(PAYLOAD).unwrap();
    // Two values from opposite ends of the object: a mis-ordered rename would
    // land one of these on the wrong field rather than dropping it.
    assert!(parsed.show_currency);
    assert_eq!(parsed.tax_rounding_mode, Some("truncate".to_string()));
    assert_eq!(parsed.margin_right, 2);
}

#[test]
fn wire_pin_store_settings_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:35 — StoreSettingsDto (logo optional on the TS side,
    // required here, which is why the pin sends it).
    const PAYLOAD: &str = r#"{
        "name": "Kopi Kita", "address": "Jl. Melati 12", "taxId": "NP-0001",
        "currency": "IDR", "branch": "Bandung", "logo": "abc123"
    }"#;
    assert_wire_matches::<StoreSettingsDto>(
        PAYLOAD,
        &["name", "address", "taxId", "currency", "branch", "logo"],
        "StoreSettingsDto",
    );
    let parsed: StoreSettingsDto = serde_json::from_str(PAYLOAD).unwrap();
    assert_eq!(parsed.tax_id, "NP-0001");
    assert_eq!(parsed.branch, "Bandung");
}

#[test]
fn wire_pin_credit_settings_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:67 — CreditSettingsDto.
    const PAYLOAD: &str =
        r#"{"enabled": true, "reminderIntervalHours": 24, "maxLimitMinor": 500000}"#;
    assert_wire_matches::<CreditSettingsDto>(
        PAYLOAD,
        &["enabled", "reminderIntervalHours", "maxLimitMinor"],
        "CreditSettingsDto",
    );
    let parsed: CreditSettingsDto = serde_json::from_str(PAYLOAD).unwrap();
    assert_eq!(parsed.reminder_interval_hours, 24);
    assert_eq!(parsed.max_limit_minor, 500000);
}

#[test]
fn wire_pin_user_pref_entry_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:190 — UserPrefEntry. Single-word fields, so this
    // pin is cheap insurance against a future rename_all on the struct.
    const PAYLOAD: &str = r#"{"key": "cardsize", "value": "large"}"#;
    assert_wire_matches::<UserPrefEntry>(PAYLOAD, &["key", "value"], "UserPrefEntry");
    let parsed: UserPrefEntry = serde_json::from_str(PAYLOAD).unwrap();
    assert_eq!(parsed.key, "cardsize");
}

#[test]
fn wire_pin_deployment_info_carries_every_key_the_renderer_declares() {
    // ui/src/api/settings.ts:55 — DeploymentInfo. Response-only (`Serialize`
    // alone), so there is no inbound payload to pin and a drift here is a blank
    // "About" row rather than a lost write. The assertion is on what goes out.
    let keys = wire_keys(&DeploymentInfo {
        app_version: "0.0.39".into(),
    });
    assert_eq!(
        keys,
        ["appVersion"],
        "DeploymentInfo must emit exactly the one key the renderer reads"
    );
}

#[test]
fn wire_pin_gateway_status_entry_carries_every_key_the_renderer_declares() {
    // ui/src/api/gateway.ts — the array `gateway_status` resolves to. Response
    // only, and the whole point of UI-1 is that these three fields are ALL the
    // renderer ever sees about a credential, so the emitted key set is part of
    // the security boundary rather than a convenience: a fourth key would put a
    // value on the wire that the deny-list was written to keep off it.
    let keys = wire_keys(&GatewayStatusEntry {
        name: "Midtrans".into(),
        configured: true,
        online: false,
    });
    let mut want = ["configured", "name", "online"];
    want.sort_unstable();
    assert_eq!(
        keys,
        want.iter().map(|k| k.to_string()).collect::<Vec<String>>(),
        "GatewayStatusEntry must emit exactly name/configured/online — any extra key is a credential leak"
    );
}
