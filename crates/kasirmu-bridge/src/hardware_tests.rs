//! Hardware command unit tests (Wave-D test relocation: moved out of
//! `apps/desktop-tauri/src/commands/hardware_tests.rs`).
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
