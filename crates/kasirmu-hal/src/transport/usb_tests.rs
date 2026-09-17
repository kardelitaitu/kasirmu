use super::*;

// ── UsbDeviceInfo struct ─────────────────────────────────────────

#[test]
fn usb_device_info_debug() {
    let info = UsbDeviceInfo {
        vid: 0x0C2E,
        pid: 0x0A10,
        manufacturer: "Honeywell".into(),
        product: "Voyager 1450g".into(),
        serial: "ABC123".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Scanner,
        label: "Honeywell Voyager 1450g".into(),
    };
    let debug = format!("{info:?}");
    assert!(debug.contains("3118")); // 0x0C2E in decimal
    assert!(debug.contains("2576")); // 0x0A10 in decimal
    assert!(debug.contains("Honeywell"));
    assert!(debug.contains("Voyager 1450g"));
    assert!(debug.contains("ABC123"));
}

#[test]
fn usb_device_info_clone_eq() {
    let info = UsbDeviceInfo {
        vid: 0x0C2E,
        pid: 0x0A10,
        manufacturer: "Honeywell".into(),
        product: "Voyager 1450g".into(),
        serial: "ABC123".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Scanner,
        label: "Honeywell Voyager 1450g".into(),
    };
    let cloned = info.clone();
    assert_eq!(info.vid, cloned.vid);
    assert_eq!(info.pid, cloned.pid);
    assert_eq!(info.manufacturer, cloned.manufacturer);
    assert_eq!(info.product, cloned.product);
    assert_eq!(info.serial, cloned.serial);
    assert_eq!(info.interface_number, cloned.interface_number);
    assert_eq!(info.endpoint_in, cloned.endpoint_in);
    assert_eq!(info.endpoint_out, cloned.endpoint_out);
}

#[test]
fn usb_device_info_fields() {
    let info = UsbDeviceInfo {
        vid: 0x06DA,
        pid: 0x4001,
        manufacturer: "Zebra".into(),
        product: "DS2208".into(),
        serial: "SERIAL01".into(),
        interface_number: 1,
        endpoint_in: 0x82,
        endpoint_out: None,
        category: DeviceCategory::Scanner,
        label: "Zebra DS2208".into(),
    };
    assert_eq!(info.vid, 0x06DA);
    assert_eq!(info.pid, 0x4001);
    assert_eq!(info.manufacturer, "Zebra");
    assert_eq!(info.product, "DS2208");
    assert_eq!(info.serial, "SERIAL01");
    assert_eq!(info.interface_number, 1);
    assert_eq!(info.endpoint_in, 0x82);
    assert_eq!(info.endpoint_out, None);
}

#[test]
fn usb_device_info_empty_strings() {
    let info = UsbDeviceInfo {
        vid: 0,
        pid: 0,
        manufacturer: String::new(),
        product: String::new(),
        serial: String::new(),
        interface_number: 0,
        endpoint_in: 0,
        endpoint_out: None,
        category: DeviceCategory::Other,
        label: String::new(),
    };
    assert_eq!(info.manufacturer, "");
    assert_eq!(info.product, "");
    assert_eq!(info.serial, "");
}

#[test]
fn usb_device_info_none_endpoint_out() {
    let info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN123".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: None,
        category: DeviceCategory::Printer,
        label: "Epson TM-T20".into(),
    };
    assert!(info.endpoint_out.is_none());
}

#[test]
fn usb_device_info_some_endpoint_out() {
    let info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN123".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: "Epson TM-T20".into(),
    };
    assert_eq!(info.endpoint_out, Some(0x02));
}

// ── Constants ────────────────────────────────────────────────────

#[test]
fn class_hid_value() {
    assert_eq!(CLASS_HID, 3);
}

#[test]
fn class_printer_value() {
    assert_eq!(CLASS_PRINTER, 7);
}

#[test]
fn class_vendor_specific_value() {
    assert_eq!(CLASS_VENDOR_SPECIFIC, 0xFF);
}

// ── Known device lists ───────────────────────────────────────────

#[test]
fn known_scanners_non_empty() {
    assert!(!KNOWN_SCANNERS.is_empty());
}

#[test]
fn known_scanners_no_duplicates() {
    let len = KNOWN_SCANNERS.len();
    let mut unique: Vec<_> = KNOWN_SCANNERS.to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), len, "KNOWN_SCANNERS has duplicate entries");
}

#[test]
fn known_printers_non_empty() {
    assert!(!KNOWN_PRINTERS.is_empty());
}

#[test]
fn known_printers_no_duplicates() {
    let len = KNOWN_PRINTERS.len();
    let mut unique: Vec<_> = KNOWN_PRINTERS.to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), len, "KNOWN_PRINTERS has duplicate entries");
}

#[test]
fn known_scanners_count() {
    assert_eq!(KNOWN_SCANNERS.len(), 14);
}

#[test]
fn known_printers_count() {
    assert_eq!(KNOWN_PRINTERS.len(), 10);
}

// ── classify_device ───────────────────────────────────────────────

#[test]
fn classify_device_known_scanner() {
    let (cat, label) = classify_device(0x0C2E, 0x0A10);
    assert_eq!(cat, DeviceCategory::Scanner);
    assert!(!label.is_empty());
}

#[test]
fn classify_device_known_printer() {
    let (cat, label) = classify_device(0x0416, 0x5011);
    assert_eq!(cat, DeviceCategory::Printer);
    assert!(!label.is_empty());
}

#[test]
fn classify_device_known_scale() {
    let (cat, label) = classify_device(0x0D81, 0x0A01);
    assert_eq!(cat, DeviceCategory::Scale);
    assert_eq!(label, "Dibal G-XT");
}

#[test]
fn classify_device_unknown_returns_other() {
    let (cat, label) = classify_device(0xDEAD, 0xBEEF);
    assert_eq!(cat, DeviceCategory::Other);
    assert!(label.is_empty());
}

// ── KNOWN_SCALES ─────────────────────────────────────────────────

#[test]
fn known_scales_non_empty() {
    assert!(!KNOWN_SCALES.is_empty());
}

#[test]
fn known_scales_count() {
    assert_eq!(KNOWN_SCALES.len(), 9);
}

// ── UsbDeviceInfo serde ────────────────────────────────────────────

#[test]
fn usb_device_info_serde_roundtrip() {
    let info = UsbDeviceInfo {
        vid: 0x0C2E,
        pid: 0x0A10,
        manufacturer: "Honeywell".into(),
        product: "Voyager 1450g".into(),
        serial: "ABC123".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Scanner,
        label: "Honeywell Voyager 1450g".into(),
    };
    let json = serde_json::to_string(&info).unwrap();
    let back: UsbDeviceInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(back.vid, info.vid);
    assert_eq!(back.pid, info.pid);
    assert_eq!(back.category, info.category);
    assert_eq!(back.label, info.label);
}

// ── DeviceCategory ────────────────────────────────────────────────

#[test]
fn device_category_scanner_variant() {
    assert_eq!(format!("{:?}", DeviceCategory::Scanner), "Scanner");
}

#[test]
fn device_category_printer_variant() {
    assert_eq!(format!("{:?}", DeviceCategory::Printer), "Printer");
}

#[test]
fn device_category_scale_variant() {
    assert_eq!(format!("{:?}", DeviceCategory::Scale), "Scale");
}

#[test]
fn device_category_other_variant() {
    assert_eq!(format!("{:?}", DeviceCategory::Other), "Other");
}

#[test]
fn device_category_serde_roundtrip() {
    let variants = [
        DeviceCategory::Scanner,
        DeviceCategory::Printer,
        DeviceCategory::Scale,
        DeviceCategory::Other,
    ];
    for v in variants {
        let json = serde_json::to_string(&v).unwrap();
        let back: DeviceCategory = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}
