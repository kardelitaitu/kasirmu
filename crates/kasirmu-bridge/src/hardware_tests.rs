//! Hardware command unit tests (Wave-D test relocation: moved out of
//! `apps/desktop-client/src/commands/hardware_tests.rs`, since renamed to desktop-tauri).
//!
//! Mounted at the foot of `hardware.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and the scanner-preference helper
//! directly. The desktop tests were pure DTO/serde/plain-fn assertions with
//! no `AppState` coupling, so the bodies port verbatim; the scanner
//! fail-closed test below additionally pins the Wave-D Option A rule that a
//! `None` event sink must refuse to start a scanner.
use super::*;
use crate::testing::TestBridge;

#[test]
fn print_receipt_args_deserialise() {
    let json = r#"{"body":"COFFEE\n3.50\n"}"#;
    let args: PrintReceiptArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.body.lines().count(), 2);
}

#[test]
fn money_dto_to_money() {
    let dto = MoneyDto {
        minor_units: 1550,
        currency: "USD".into(),
    };
    let m = dto.to_money().unwrap();
    assert_eq!(m.minor_units, 1550);
}

#[test]
fn money_dto_invalid_currency() {
    let dto = MoneyDto {
        minor_units: 100,
        currency: "INVALID".into(),
    };
    assert!(dto.to_money().is_err());
}

#[test]
fn print_sales_receipt_args_deserialise() {
    let json = r#"{
        "date": "01 Jan 2026",
        "receiptNumber": "REC-001",
        "items": [
            {
                "name": "Coffee",
                "quantity": 1,
                "unitPrice": { "minor_units": 350, "currency": "USD" },
                "totalPrice": { "minor_units": 350, "currency": "USD" }
            }
        ],
        "subtotal": { "minor_units": 350, "currency": "USD" },
        "total": { "minor_units": 350, "currency": "USD" },
        "payments": [
            {
                "method": "CASH",
                "amount": { "minor_units": 500, "currency": "USD" },
                "change": { "minor_units": 150, "currency": "USD" }
            }
        ]
    }"#;
    let args: PrintSalesReceiptArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.date, "01 Jan 2026");
    assert_eq!(args.items.len(), 1);
    assert_eq!(args.payments.len(), 1);
}

#[test]
fn print_sales_receipt_args_deserialise_camel_case() {
    let json = r#"{
        "date": "01 Jan 2026",
        "receiptNumber": "REC-001",
        "items": [
            {
                "name": "Coffee",
                "quantity": 1,
                "unitPrice": { "minorUnits": 350, "currency": "USD" },
                "totalPrice": { "minorUnits": 350, "currency": "USD" }
            }
        ],
        "subtotal": { "minorUnits": 350, "currency": "USD" },
        "total": { "minorUnits": 350, "currency": "USD" },
        "payments": [
            {
                "method": "CASH",
                "amount": { "minorUnits": 500, "currency": "USD" },
                "change": { "minorUnits": 150, "currency": "USD" }
            }
        ]
    }"#;
    let args: PrintSalesReceiptArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.date, "01 Jan 2026");
    assert_eq!(args.items.len(), 1);
    assert_eq!(args.items[0].unit_price.minor_units, 350);
    assert_eq!(args.subtotal.minor_units, 350);
    assert_eq!(args.total.minor_units, 350);
    assert_eq!(args.payments[0].amount.minor_units, 500);
}

#[test]
fn line_item_dto_deserialise_with_note() {
    let json = r#"{
        "name": "Nasi Goreng Spesial",
        "quantity": 1,
        "unitPrice": { "minor_units": 35000, "currency": "IDR" },
        "totalPrice": { "minor_units": 35000, "currency": "IDR" },
        "note": "pedas"
    }"#;
    let item: LineItemDto = serde_json::from_str(json).unwrap();
    assert_eq!(item.note.as_deref(), Some("pedas"));
}

// -- DTO struct tests --

#[test]
fn open_cash_drawer_args_default_device() {
    let json = r#"{}"#;
    let args: OpenCashDrawerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.device_id, None);
}

#[test]
fn open_cash_drawer_args_with_device() {
    let json = r#"{"device_id":"drawer-1"}"#;
    let args: OpenCashDrawerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.device_id.as_deref(), Some("drawer-1"));
}

#[test]
fn open_cash_drawer_args_debug() {
    let args = OpenCashDrawerArgs {
        device_id: Some("d".into()),
    };
    let d = format!("{args:?}");
    assert!(d.contains("d"));
}

#[test]
fn open_cash_drawer_result_serialize() {
    let result = OpenCashDrawerResult { opened: true };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["opened"], true);
}

#[test]
fn print_receipt_result_serialize() {
    let result = PrintReceiptResult { printed_lines: 42 };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["printed_lines"], 42);
}

#[test]
fn scanner_info_serialize() {
    let info = ScannerInfo {
        id: "scanner-1".into(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["id"], "scanner-1");
}

#[test]
fn scanner_info_debug() {
    let info = ScannerInfo { id: "s".into() };
    let d = format!("{info:?}");
    assert!(d.contains("s"));
}

#[test]
fn display_show_args_deserialize() {
    let json = r##"{"display_id":"d1","line1":"Welcome","line2":"Customer"}"##;
    let args: DisplayShowArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.line1, "Welcome");
    assert_eq!(args.line2, "Customer");
}

#[test]
fn display_show_args_debug() {
    let args = DisplayShowArgs {
        display_id: "d".into(),
        line1: "L1".into(),
        line2: "L2".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("L1"));
}

#[test]
fn print_receipt_args_deserialize() {
    let json = r#"{"body":"Hello\nWorld"}"#;
    let args: PrintReceiptArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.body.lines().count(), 2);
}

#[test]
fn print_receipt_args_debug() {
    let args = PrintReceiptArgs {
        body: "test".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("test"));
}

#[test]
fn line_item_dto_deserialize() {
    let json = r#"{"name":"Coffee","quantity":2,"unitPrice":{"minor_units":350,"currency":"USD"},"totalPrice":{"minor_units":700,"currency":"USD"}}"#;
    let item: LineItemDto = serde_json::from_str(json).unwrap();
    assert_eq!(item.name, "Coffee");
    assert_eq!(item.quantity, 2);
    assert!(item.tax_amount.is_none());
}

#[test]
fn payment_dto_deserialize() {
    let json = r#"{"method":"CASH","amount":{"minor_units":500,"currency":"USD"},"change":{"minor_units":150,"currency":"USD"}}"#;
    let p: PaymentDto = serde_json::from_str(json).unwrap();
    assert_eq!(p.method, "CASH");
    assert!(p.change.is_some());
}

// ── scanner preference ───────────────────────────────────────────────

fn ids(list: &[&str]) -> Vec<ScannerInfo> {
    list.iter()
        .map(|id| ScannerInfo { id: (*id).into() })
        .collect()
}

fn ordered(scanners: &[ScannerInfo]) -> Vec<&str> {
    scanners.iter().map(|s| s.id.as_str()).collect()
}

#[test]
fn the_saved_scanner_is_moved_to_the_front_for_the_autodetect() {
    // useBarcodeScanner.ts takes scanners[0]; this is the only place the
    // saved scanner_device_id can influence which device that is.
    let got = prefer_first(ids(&["scanner:a", "scanner:b", "scanner:c"]), "scanner:c");
    assert_eq!(ordered(&got), ["scanner:c", "scanner:a", "scanner:b"]);
}

#[test]
fn moving_the_preferred_scanner_keeps_the_rest_in_order() {
    // A swap would leave the tail unordered, so the second device would
    // depend on where the preferred one happened to sit.
    let got = prefer_first(ids(&["a", "b", "c", "d"]), "c");
    assert_eq!(ordered(&got), ["c", "a", "b", "d"]);
}

#[test]
fn an_unset_preference_leaves_discovery_order_alone() {
    // Settings::get_scanner_device_id returns "" when never written, which
    // is every install that has not been through a wizard.
    let got = prefer_first(ids(&["b", "a"]), "");
    assert_eq!(ordered(&got), ["b", "a"]);
}

#[test]
fn a_preference_naming_an_absent_scanner_changes_nothing() {
    // The saved id may point at a device that has since been unplugged;
    // that must not empty the list or invent an entry.
    let got = prefer_first(ids(&["a", "b"]), "scanner:gone");
    assert_eq!(ordered(&got), ["a", "b"]);
}

#[test]
fn preference_survives_an_empty_registry() {
    assert!(prefer_first(vec![], "a").is_empty());
}

// ── ids_for_mode ────────────────────────────────────────────────────

fn ids_of(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn keyboard_mode_offers_no_scanner_at_all() {
    // A keyboard-wedge scanner types into the focused field and sends
    // Enter; there is no port for HAL to open. Offering one anyway is how
    // a wedge terminal came to open COM7 and report a scanner failure.
    let got = crate::hardware::ids_for_mode(
        ids_of(&["scanner:usb:1", "scanner:serial:COM7"]),
        "keyboard",
    );
    assert!(got.is_empty(), "{got:?} must be empty in keyboard mode");
}

#[test]
fn a_disabled_scanner_offers_nothing() {
    // "none" is the explicit off switch added alongside the mode select.
    let got = crate::hardware::ids_for_mode(ids_of(&["scanner:usb:1"]), "none");
    assert!(got.is_empty());
}

#[test]
fn serial_mode_offers_only_port_backed_scanners() {
    let got = crate::hardware::ids_for_mode(
        ids_of(&["scanner:usb:1", "scanner:serial:COM7", "scanner:bt:COM9"]),
        "serial",
    );
    // Filtering preserves the list's order, which is the family-ranked
    // order from the registry — it does not re-sort.
    assert_eq!(got, ids_of(&["scanner:serial:COM7", "scanner:bt:COM9"]));
}

// -- a scanner preference that cannot be read is not an unconfigured terminal --

/// `scanner_prefs` returned a bare `(String, String)` and folded all three of
/// its reads into defaults: a FAILED `hardware_profiles` query fell through via
/// `.ok()`, and both legacy keys via `unwrap_or_default()`. An unreadable
/// `settings` table therefore produced `("", "")` -- byte-identical to a
/// terminal that was never configured. The saved Device ID stopped being
/// fronted, and an empty mode falls to the `_ => ids` arm of `ids_for_mode`, so
/// a `keyboard`-wedge terminal would open COM ports and a serial-only one would
/// be handed a HID device.
///
/// The pin makes `settings` PRESENT but unreadable (BLOB `value`) and asserts
/// the read refuses instead of answering "nothing saved". No profile row exists
/// for the terminal, so the legacy branch is the one exercised.
#[test]
fn an_unreadable_settings_table_is_not_an_unconfigured_terminal() {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory settings db");
    conn.execute_batch(
        "CREATE TABLE hardware_profiles (terminal_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL); \
         CREATE TABLE settings (key TEXT PRIMARY KEY, value BLOB NOT NULL, \
                                 updated_at TEXT NOT NULL DEFAULT ''); \
         INSERT INTO settings (key, value) VALUES ('scanner.device_id', x'80');",
    )
    .expect("building the settings tables");

    let err = scanner_prefs(&conn, "term-1")
        .expect_err("an unreadable settings table must not read as no preference");
    assert!(
        matches!(err, BridgeError::Core { .. }),
        "expected the read failure to surface, got {err:?}"
    );
}

#[test]
fn a_missing_profile_row_falls_through_to_the_legacy_keys() {
    // The ONE legitimate absence: no profile row yet. It must not error, and it
    // must still resolve the legacy keys.
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory settings db");
    conn.execute_batch(
        "CREATE TABLE hardware_profiles (terminal_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL); \
         CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, \
                                 updated_at TEXT NOT NULL DEFAULT ''); \
         INSERT INTO settings (key, value) VALUES ('scanner.device_id', 'scanner:usb:abc');",
    )
    .expect("building the settings tables");

    let (preferred, mode) = scanner_prefs(&conn, "term-1").expect("absence must not error");
    assert_eq!(preferred, "scanner:usb:abc");
    // The getter's own documented default for an ABSENT key is "auto"
    // (platform/core/src/settings/typed.rs:272), which is what makes the outer
    // `unwrap_or_default()` the old code carried doubly wrong: it could only
    // fire on an error, and it would have replaced that documented default with
    // an empty string.
    assert_eq!(mode, "auto");
}

// -- receipt config: a failed legacy footer read must not read as "no footer" --

/// `read_receipt_config_for_scope` resolves the footer from three layers, the
/// legacy `settings` key last. That read used to be wrapped in `.ok()`, so a
/// real failure (a locked or corrupt `settings` table) became `None` -- the
/// same value an operator sees when they configured no footer at all. The
/// receipt then printed with the configured footer missing and nothing said so.
///
/// The pin makes `settings` PRESENT but unreadable (its `value` column is a
/// BLOB, so every `row.get::<_, String>(0)` fails), then asserts the config
/// builder REFUSES rather than returning a footer-less config. Every other
/// settings read in the same function already propagates, which is why `?`
/// here is consistency rather than a new policy.
#[test]
fn a_failed_legacy_footer_read_refuses_instead_of_printing_without_a_footer() {
    // A provisioned store db: the resolver reads `locations` and the scoped
    // `receipt_formats` rows before it ever reaches the legacy key, so an
    // empty in-memory db would fail earlier for the wrong reason.
    let bridge = TestBridge::new();
    let store = bridge.db_manager().open_store("default").unwrap();
    let guard = store.lock().expect("store db lock");
    platform_core::settings::Settings::set(&guard, "receipt.footer", "Thank you")
        .expect("seeding the legacy footer");

    let _ = read_receipt_config_for_scope(&guard, None)
        .expect("a readable settings table must resolve a config");

    // Rebuild `settings` with the value stored as a BLOB. Every read in this
    // path does `row.get::<_, String>(0)`, which fails on a blob, so the
    // settings layer is PRESENT but unreadable -- exactly the locked/corrupt
    // case the swallow used to absorb. Rows the resolver only probes with
    // `is_ok_and(..)` still answer falsy, so control reaches the footer chain.
    guard
        .execute_batch(
            "DROP TABLE settings; \
         CREATE TABLE settings (key TEXT PRIMARY KEY, value BLOB NOT NULL, \
                                     updated_at TEXT NOT NULL DEFAULT ''); \
         INSERT INTO settings (key, value) VALUES ('receipt.footer', x'80');",
        )
        .expect("rebuilding settings with an unreadable value");

    let err = read_receipt_config_for_scope(&guard, None).unwrap_err();
    assert!(
        matches!(err, BridgeError::Core { .. }),
        "a failed footer read must surface as a Core error, not a config whose footer silently vanished; got {err:?}"
    );
}

#[test]
fn auto_and_unset_modes_offer_everything() {
    // A profile predating the mode field reads as "", which must behave
    // like auto rather than silently disabling the scanner.
    for mode in ["auto", "", "AUTO", " something-else "] {
        let got =
            crate::hardware::ids_for_mode(ids_of(&["scanner:usb:1", "scanner:serial:COM7"]), mode);
        assert_eq!(
            got,
            ids_of(&["scanner:usb:1", "scanner:serial:COM7"]),
            "mode {mode:?} must not narrow the list"
        );
    }
}

#[tokio::test]
async fn starting_a_scanner_without_an_event_sink_fails_closed() {
    // Wave-D Option A: the shell emits barcode:* through the injected sink;
    // headless (None) must refuse to start rather than scan silently.
    let bridge = TestBridge::new();
    bridge
        .registry()
        .register_scanner(
            "scanner-1",
            std::sync::Arc::new(kasirmu_hal::drivers::mock::MockBarcodeScanner::default()),
        )
        .await;
    bridge.sessions().write().unwrap().insert(
        "tok".into(),
        kasirmu_core::session::SessionContext::new(
            "user-1".into(),
            "role-1".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let ctx = bridge.ctx();
    let err = crate::hardware::start_scanner_scoped(&ctx, "scanner-1", "tok")
        .await
        .unwrap_err();
    assert!(matches!(err, BridgeError::Internal(m) if m == "AppHandle unavailable"));
}

#[tokio::test]
async fn open_cash_drawer_scoped_resolves_companion_drawer_when_default() {
    let bridge = TestBridge::new();
    let token = bridge
        .token_granting(kasirmu_core::permissions::PAYMENTS_CASH)
        .await;

    let companion = std::sync::Arc::new(kasirmu_hal::drivers::mock::MockCashDrawer::default());
    bridge
        .registry()
        .register_cash_drawer("drawer:kick:default", companion.clone())
        .await;

    let ctx = bridge.ctx();
    let res = crate::hardware::open_cash_drawer_scoped(
        &ctx,
        OpenCashDrawerArgs { device_id: None },
        &token,
    )
    .await;

    assert!(res.is_ok());
    assert_eq!(
        companion
            .open_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

// ── receipt config: digit grouping (D6) ──────────────────────────────

/// D6: the renderer had no grouping at all, so an Indonesian receipt printed
/// `Rp15000` while the on-screen preview — which groups through
/// `Intl.NumberFormat('id-ID')` — showed `Rp 15.000`. These pin the loader's
/// three-way resolution of `currency.thousands_separator`.
#[test]
fn an_explicit_grouping_setting_is_honoured() {
    let bridge = TestBridge::new();
    let store = bridge.db_manager().open_store("default").unwrap();
    let guard = store.lock().expect("store db lock");
    platform_core::settings::Settings::set(
        &guard,
        platform_core::settings::keys::CURRENCY_THOUSANDS_SEPARATOR,
        "space",
    )
    .expect("seeding the separator");

    let (config, _) = read_receipt_config_for_scope(&guard, None).expect("a config");
    assert_eq!(
        config.grouping,
        receipt::ThousandSeparator::Space,
        "a store that wrote the key must get exactly what it asked for"
    );
}

/// The trap this deliberately avoids: the setting's OWN default is `"comma"`
/// (`platform/core/src/settings/typed.rs:704`), which is English. Trusting it
/// for an unset key would print `Rp15,000` beside a preview reading
/// `Rp 15.000` — trading one divergence for another.
#[test]
fn an_unset_grouping_key_follows_the_stores_currency_not_the_settings_english_default() {
    let bridge = TestBridge::new();
    let store = bridge.db_manager().open_store("default").unwrap();
    let guard = store.lock().expect("store db lock");
    // A fresh store has no separator key written.
    platform_core::settings::Settings::set_default_currency(&guard, "IDR")
        .expect("seeding the currency");

    let (config, _) = read_receipt_config_for_scope(&guard, None).expect("a config");
    assert_eq!(
        config.grouping,
        receipt::ThousandSeparator::Dot,
        "an IDR store must group with dots, matching the preview; the setting's \
         own comma default would print Rp15,000 beside a Rp 15.000 preview"
    );
}

/// A non-IDR store that never wrote the key keeps the ungrouped behaviour every
/// receipt had before this field existed. This is the case that proves the
/// grouping arrival cannot restyle existing stores by itself.
#[test]
fn an_unset_grouping_key_leaves_a_non_idr_store_ungrouped() {
    let bridge = TestBridge::new();
    let store = bridge.db_manager().open_store("default").unwrap();
    let guard = store.lock().expect("store db lock");
    platform_core::settings::Settings::set_default_currency(&guard, "USD")
        .expect("seeding the currency");

    let (config, _) = read_receipt_config_for_scope(&guard, None).expect("a config");
    assert_eq!(config.grouping, receipt::ThousandSeparator::None);
}

/// BRIDGE-7 closure test: a session that lacks `receivables:view` must be
/// denied when it tries to print the Kasbon settlement slip (the one hardware
/// command in this module that discloses cross-customer PII).
#[tokio::test]
async fn print_kasbon_settlement_slip_requires_receivables_view() {
    use crate::error::BridgeError;
    use crate::testing::temp_conn;

    let conn = temp_conn();

    // Seed a staff user whose role does NOT grant receivables:view.
    // TestBridge seeds the same role table that BridgeCtx reads.
    let bridge = TestBridge::new().with_conn(conn);
    // Insert a session under a role that holds no permissions at all.
    bridge.sessions().write().unwrap().insert(
        "tok-no-perm".into(),
        kasirmu_core::session::SessionContext::new(
            "user-noperm".into(),
            "role-noperm".into(),
            "term-1".into(),
            "store-a".into(),
            "inst-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );

    let args = PrintKasbonSettlementArgs {
        date: "2026-11-10".into(),
        settlement_number: "PAY-001".into(),
        customer_name: "Siti Nurhaliza".into(),
        customer_phone: Some("0812345678".into()),
        receivable_reference: None,
        payment_method: "cash".into(),
        previous_balance: MoneyDto {
            minor_units: 50_000,
            currency: "IDR".into(),
        },
        amount_paid: MoneyDto {
            minor_units: 30_000,
            currency: "IDR".into(),
        },
        remaining_balance: MoneyDto {
            minor_units: 20_000,
            currency: "IDR".into(),
        },
        cashier_name: None,
        note: None,
        printer_target: None,
    };

    let result = print_kasbon_settlement_slip_scoped(&bridge.ctx(), args, "tok-no-perm").await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "expected PermissionDenied for a session without receivables:view, got {:?}",
        result
    );
}

#[test]
fn print_kasbon_settlement_args_deserialise() {
    let json = r#"{
        "date": "2026-10-21 16:00",
        "settlementNumber": "PAY-00123",
        "customerName": "Siti Nurhaliza",
        "customerPhone": "0812345678",
        "receivableReference": "REC-01",
        "paymentMethod": "cash",
        "previousBalance": { "minorUnits": 50000, "currency": "IDR" },
        "amountPaid": { "minorUnits": 30000, "currency": "IDR" },
        "remainingBalance": { "minorUnits": 20000, "currency": "IDR" },
        "cashierName": "Budi",
        "note": "Cicilan kasbon"
    }"#;
    let args: PrintKasbonSettlementArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.settlement_number, "PAY-00123");
    assert_eq!(args.customer_name, "Siti Nurhaliza");
    assert_eq!(args.payment_method, "cash");
    assert_eq!(args.amount_paid.minor_units, 30000);
    assert_eq!(args.remaining_balance.minor_units, 20000);
}

#[test]
fn print_sales_receipt_args_with_credit_terms_deserialise() {
    let json = r#"{
        "date": "2026-10-21",
        "receiptNumber": "R-101",
        "items": [],
        "subtotal": { "minorUnits": 10000, "currency": "IDR" },
        "total": { "minorUnits": 10000, "currency": "IDR" },
        "payments": [
            { "method": "pay_later", "amount": { "minorUnits": 10000, "currency": "IDR" } }
        ],
        "customerName": "Pak Joko",
        "customerPhone": "081999888",
        "dueDate": "2026-11-20",
        "outstandingBalance": { "minorUnits": 25000, "currency": "IDR" }
    }"#;
    let args: PrintSalesReceiptArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.customer_name.as_deref(), Some("Pak Joko"));
    assert_eq!(args.customer_phone.as_deref(), Some("081999888"));
    assert_eq!(args.due_date.as_deref(), Some("2026-11-20"));
    assert_eq!(
        args.outstanding_balance.as_ref().map(|b| b.minor_units),
        Some(25000)
    );
}
