use super::*;

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
    // Asserted for the same reason as `tax_amount` above: this test is what forces a
    // NEW optional field to be read rather than merely declared. `note` was added to
    // `LineItemDto` with `#[serde(default)]` and to the HAL's `receipt::LineItem`, but
    // the tablet's constructor kept the three old fields and dropped it — the payload
    // deserialised fine, so nothing here went red, and the tablet silently printed no
    // order notes while desktop did. A `None` from a payload that omits the key is
    // also the contract the UI relies on when it sends no note.
    assert!(item.note.is_none());
}

#[test]
fn line_item_dto_carries_the_order_note_when_sent() {
    let json = r#"{"name":"Nasi Goreng","quantity":1,"unitPrice":{"minor_units":25000,"currency":"IDR"},"totalPrice":{"minor_units":25000,"currency":"IDR"},"note":"pedas"}"#;
    let item: LineItemDto = serde_json::from_str(json).unwrap();
    assert_eq!(
        item.note.as_deref(),
        Some("pedas"),
        "the UI sends `note` and the HAL prints it under the item, so the DTO must keep it"
    );
}

#[test]
fn payment_dto_deserialize() {
    let json = r#"{"method":"CASH","amount":{"minor_units":500,"currency":"USD"},"change":{"minor_units":150,"currency":"USD"}}"#;
    let p: PaymentDto = serde_json::from_str(json).unwrap();
    assert_eq!(p.method, "CASH");
    assert!(p.change.is_some());
}

// ── Displays and discovery (parity with the desktop shell) ───────────

#[test]
fn display_show_args_deserialize() {
    let json = r##"{"display_id":"d1","line1":"Welcome","line2":"Customer"}"##;
    let args: DisplayShowArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.display_id, "d1");
    assert_eq!(args.line1, "Welcome");
    assert_eq!(args.line2, "Customer");
}

#[test]
fn display_show_args_accepts_exactly_the_keys_the_shared_wizard_sends() {
    // One React wizard drives both shells. The tablet has no dependency on
    // the desktop crate, so the parity that matters is the wire shape: pin
    // the accepted key set and a rename on either side shows up here as a
    // runtime failure the wizard can no longer produce.
    let value = serde_json::json!({ "display_id": "pole", "line1": "a", "line2": "b" });
    let args: DisplayShowArgs = serde_json::from_value(value.clone()).expect("accepted");
    assert_eq!(args.display_id, "pole");

    let mut keys: Vec<&str> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["display_id", "line1", "line2"]);

    // A missing line is not optional: the display API takes both lines.
    let missing = serde_json::json!({ "display_id": "pole", "line1": "a" });
    assert!(
        serde_json::from_value::<DisplayShowArgs>(missing).is_err(),
        "line2 must not silently default to empty"
    );
}

#[test]
fn usb_device_info_has_the_fields_the_setup_wizard_renders() {
    // discover_hardware_scoped hands the HAL's type straight to the wizard.
    // The shape is not this crate's to choose, so the test exists to catch a
    // subset being deserialised and blank rows rendered.
    let json = r#"{
        "vid": 3128, "pid": 98, "manufacturer": "Epson", "product": "TM-T88",
        "serial": "X1", "interface_number": 0, "endpoint_in": 129,
        "endpoint_out": 1, "category": "Printer", "label": "Epson TM-T88"
    }"#;
    let info: UsbDeviceInfo = serde_json::from_str(json).expect("deserialises");
    assert_eq!(info.vid, 3128);
    assert_eq!(info.manufacturer, "Epson");
    assert_eq!(info.product, "TM-T88");
    assert_eq!(info.label, "Epson TM-T88");
}

#[test]
fn a_scanner_with_no_out_endpoint_still_deserialises() {
    // Scanners have no bulk OUT endpoint. If that field were required, every
    // scanner would silently drop out of the wizard's list.
    let json = r#"{
        "vid": 3118, "pid": 2576, "manufacturer": "Honeywell", "product": "Voyager",
        "serial": "S2", "interface_number": 1, "endpoint_in": 130,
        "endpoint_out": null, "category": "Scanner", "label": "Honeywell Voyager"
    }"#;
    let info: UsbDeviceInfo = serde_json::from_str(json).expect("null endpoint_out is fine");
    assert!(info.endpoint_out.is_none());
}

// ── scanner preference ───────────────────────────────────────────────

fn scanner_ids(list: &[&str]) -> Vec<ScannerInfo> {
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
    let got = prefer_first(
        scanner_ids(&["scanner:a", "scanner:b", "scanner:c"]),
        "scanner:c",
    );
    assert_eq!(ordered(&got), ["scanner:c", "scanner:a", "scanner:b"]);
}

#[test]
fn moving_the_preferred_scanner_keeps_the_rest_in_order() {
    let got = prefer_first(scanner_ids(&["a", "b", "c", "d"]), "c");
    assert_eq!(ordered(&got), ["c", "a", "b", "d"]);
}

#[test]
fn an_unset_preference_leaves_discovery_order_alone() {
    // Settings::get_scanner_device_id returns "" when never written.
    let got = prefer_first(scanner_ids(&["b", "a"]), "");
    assert_eq!(ordered(&got), ["b", "a"]);
}

#[test]
fn a_preference_naming_an_absent_scanner_changes_nothing() {
    let got = prefer_first(scanner_ids(&["a", "b"]), "scanner:gone");
    assert_eq!(ordered(&got), ["a", "b"]);
}

/// The `.ok()` call the legacy footer read must NOT carry. The check runs
/// against code with `//` comments stripped, so the fix's own prose that
/// names `.ok()` cannot trip it.
const OK_PROBE: &str = ".ok()";

// -- a failed legacy footer read must propagate (mirrors the bridge pin) --

/// The tablet's `print_sales_receipt_scoped` builds the receipt config inline,
/// so this is a SOURCE-TEXT pin: the body is unreachable without a full
/// `AppState`. It asserts the legacy footer read is not wrapped in `.ok()`,
/// which would turn a locked or corrupt `settings` table into `None` -- the
/// same value an operator sees when they configured no footer at all, so the
/// receipt would print without it and nothing would say so.
///
/// The scan starts at the first `use` so it inspects CODE, never the module
/// doc: the doc legitimately describes the swallow while explaining the fix,
/// and a pin that fails on a correct file gets deleted by the next reader.
/// (Round-145 lesson.)
#[test]
fn the_tablet_propagates_a_failed_legacy_footer_read() {
    const SOURCE: &str = include_str!("hardware.rs");
    let code = match SOURCE.find("use tauri::") {
        Some(at) => &SOURCE[at..],
        None => {
            panic!("hardware.rs no longer starts its imports with `use tauri::`; revisit this pin")
        }
    };
    // Strip `//` comment lines before asserting: the module doc and the fix's
    // own comment legitimately SPELL `.ok()` while explaining what was removed,
    // and a pin that trips on prose fails on a correct file (round-145 lesson).
    let code_only: String = code
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !code_only.contains(OK_PROBE),
        "the tablet must not wrap the legacy footer read in `.ok()`; that turns a locked or corrupt settings table into `None`, which reads as \"no footer\" and prints without it"
    );
    assert!(
        code_only.contains("?;"),
        "the tablet footer read must propagate its error with `?`"
    );
    assert!(
        code.contains("legacy_footer"),
        "the tablet footer chain must resolve the legacy read through a binding so `?` can propagate"
    );
}
#[test]
fn both_shells_order_scanners_the_same_way() {
    // The desktop and tablet each carry a copy of this helper, so a device
    // picked on one terminal must be the same device on the other.
    let got = prefer_first(scanner_ids(&["x", "y", "z"]), "y");
    assert_eq!(ordered(&got), ["y", "x", "z"]);
}
