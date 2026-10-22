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

// ── O-M40: single bus walk, in-memory partition ─────────────────
//
// The bus walk itself cannot run without libusb hardware, so what is pinned
// here is everything downstream of it: given ONE enumeration of "any
// interface whose class is in the requested set", the partition step must
// reproduce the ORIGINAL per-function behaviour exactly — same devices, same
// order, same category, same label. The oracle below is a faithful port of
// the pre-change implementation (two `probe_by_class` calls for scanners,
// one each for printers and scales), fed from the same enumeration.

/// Build a device record exactly as the walk would, using the real
/// `classify_device` fallbacks.
fn device(vid: u16, pid: u16, iface: u8) -> UsbDeviceInfo {
    let (category, label) = classify_device(vid, pid);
    UsbDeviceInfo {
        vid,
        pid,
        manufacturer: String::new(),
        product: String::new(),
        serial: String::new(),
        interface_number: iface,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category,
        label,
    }
}

fn cls(class: u8, vid: u16, pid: u16, iface: u8) -> Classified {
    Classified {
        class,
        info: device(vid, pid, iface),
    }
}

/// What one `probe_by_class(class)` walk used to return: the records whose
/// interface class is `class`, in bus order.
fn walk(enumeration: &[Classified], class: u8) -> Vec<UsbDeviceInfo> {
    enumeration
        .iter()
        .filter(|c| c.class == class)
        .map(|c| c.info.clone())
        .collect()
}

/// The PRE-CHANGE `probe_scanners`, verbatim in behaviour.
fn legacy_scanners(enumeration: &[Classified]) -> Vec<UsbDeviceInfo> {
    let mut results = walk(enumeration, CLASS_HID);
    for dev in walk(enumeration, CLASS_VENDOR_SPECIFIC) {
        if KNOWN_SCANNERS.contains(&(dev.vid, dev.pid))
            && !results.iter().any(|r| r.vid == dev.vid && r.pid == dev.pid)
        {
            results.push(dev);
        }
    }
    for dev in &mut results {
        if KNOWN_SCANNERS.contains(&(dev.vid, dev.pid)) {
            dev.category = DeviceCategory::Scanner;
            if dev.label.is_empty() {
                dev.label = format!("Scanner {:04x}:{:04x}", dev.vid, dev.pid);
            }
        }
    }
    results.retain(|d| KNOWN_SCANNERS.contains(&(d.vid, d.pid)));
    results
}

/// The PRE-CHANGE `probe_printers`, verbatim in behaviour.
fn legacy_printers(enumeration: &[Classified]) -> Vec<UsbDeviceInfo> {
    walk(enumeration, CLASS_PRINTER)
        .into_iter()
        .filter(|d| KNOWN_PRINTERS.contains(&(d.vid, d.pid)))
        .map(|mut d| {
            d.category = DeviceCategory::Printer;
            if d.label.is_empty() {
                d.label = format!("Printer {:04x}:{:04x}", d.vid, d.pid);
            }
            d
        })
        .collect()
}

/// The PRE-CHANGE `probe_scales`, verbatim in behaviour.
fn legacy_scales(enumeration: &[Classified]) -> Vec<UsbDeviceInfo> {
    walk(enumeration, CLASS_HID)
        .into_iter()
        .filter(|d| {
            KNOWN_SCALES
                .iter()
                .any(|(v, p, _)| *v == d.vid && *p == d.pid)
        })
        .map(|mut d| {
            d.category = DeviceCategory::Scale;
            for &(v, p, name) in KNOWN_SCALES {
                if v == d.vid && p == d.pid && !name.is_empty() {
                    d.label = name.to_owned();
                    break;
                }
            }
            if d.label.is_empty() {
                d.label = format!("Scale {:04x}:{:04x}", d.vid, d.pid);
            }
            d
        })
        .collect()
}

/// The PRE-CHANGE `probe_all`: scanners, then printers, then scales.
fn legacy_all(enumeration: &[Classified]) -> Vec<UsbDeviceInfo> {
    let mut all = Vec::new();
    all.extend(legacy_scanners(enumeration));
    all.extend(legacy_printers(enumeration));
    all.extend(legacy_scales(enumeration));
    all
}

/// The NEW `probe_all` partition, lifted out of `probe_all` so a test can
/// drive it with a synthetic enumeration instead of a real bus.
fn new_all(enumeration: Vec<Classified>) -> Vec<UsbDeviceInfo> {
    let mut hid: Vec<Classified> = Vec::new();
    let mut vendor: Vec<Classified> = Vec::new();
    let mut printer_class: Vec<Classified> = Vec::new();
    for c in enumeration {
        match c.class {
            CLASS_PRINTER => printer_class.push(c),
            CLASS_VENDOR_SPECIFIC => vendor.push(c),
            _ => hid.push(c),
        }
    }
    let mut scanner_input = Vec::new();
    scanner_input.extend(hid.iter().map(|c| Classified {
        class: c.class,
        info: c.info.clone(),
    }));
    scanner_input.extend(vendor);

    let mut all = Vec::new();
    all.extend(scanners_from(scanner_input));
    all.extend(printers_from(printer_class));
    all.extend(scales_from(hid));
    all
}

fn key(d: &UsbDeviceInfo) -> (u16, u16, u8, String, DeviceCategory) {
    (
        d.vid,
        d.pid,
        d.interface_number,
        d.label.clone(),
        d.category,
    )
}

/// A bus with every awkward combination: a scanner on HID AND vendor-specific
/// (the dedup case), a vendor-only scanner, a vendor-specific device that is
/// NOT a known scanner (dropped), a HID printer/scale/scanner overlap, an
/// unknown HID device, and several interfaces per device.
fn busy_bus() -> Vec<Classified> {
    vec![
        // Honeywell Voyager 1450g: HID scanner.
        cls(CLASS_HID, 0x0C2E, 0x0A10, 0),
        cls(CLASS_PRINTER, 0x0416, 0x5011, 0), // Epson TM-T20
        // Dibal G-XT on HID: a scale, and NOT in KNOWN_SCANNERS.
        cls(CLASS_HID, 0x0D81, 0x0A01, 0),
        // Zebra DS2208 HID scanner, with a vendor-specific control interface.
        cls(CLASS_HID, 0x06DA, 0x4001, 0),
        cls(CLASS_VENDOR_SPECIFIC, 0x06DA, 0x4001, 1),
        // Magellan 800i that ONLY exposes vendor-specific — merged in.
        cls(CLASS_VENDOR_SPECIFIC, 0x05F9, 0x2211, 0),
        // Unknown vendor-specific device — must be dropped from scanners.
        cls(CLASS_VENDOR_SPECIFIC, 0xDEAD, 0xBEEF, 0),
        // Unknown HID device — must be dropped from everything.
        cls(CLASS_HID, 0x1234, 0x5678, 0),
        // Unknown printer-class device — dropped.
        cls(CLASS_PRINTER, 0xAAAA, 0xBBBB, 0),
        // Second HID interface of the same Voyager (an interface duplicate).
        cls(CLASS_HID, 0x0C2E, 0x0A10, 1),
        // Star TSP100 printer, and the generic HID POS scale sentinel.
        cls(CLASS_PRINTER, 0x0519, 0x0301, 0),
        cls(CLASS_HID, 0x0000, 0x0000, 0),
    ]
}

#[test]
fn probe_all_partition_matches_the_original_three_walks_exactly() {
    let enumeration = busy_bus();
    let expected = legacy_all(&enumeration);
    let actual = new_all(enumeration);
    assert_eq!(
        expected.iter().map(key).collect::<Vec<_>>(),
        actual.iter().map(key).collect::<Vec<_>>(),
        "probe_all's single-walk partition must reproduce the three-walk result, in order"
    );
}

#[test]
fn probe_all_keeps_scanners_then_printers_then_scales_order() {
    let actual = new_all(busy_bus());
    // The blocks are scanners, then printers, then scales: the category must
    // never go back to an earlier block once it has moved on.
    let rank = |c: DeviceCategory| match c {
        DeviceCategory::Scanner => 0,
        DeviceCategory::Printer => 1,
        DeviceCategory::Scale => 2,
        DeviceCategory::Other => panic!("probe_all must not emit Other"),
    };
    let ranks: Vec<u8> = actual.iter().map(|d| rank(d.category)).collect();
    assert!(
        ranks.windows(2).all(|w| w[0] <= w[1]),
        "categories out of order: {ranks:?}"
    );
    assert!(ranks.contains(&0) && ranks.contains(&1) && ranks.contains(&2));

    // And a HID scale (Dibal) must NOT leak into the scanner block: it is a
    // scale-classified record on a HID interface.
    let first_printer = actual
        .iter()
        .position(|d| d.category == DeviceCategory::Printer)
        .unwrap();
    assert!(
        actual[..first_printer]
            .iter()
            .all(|d| d.category == DeviceCategory::Scanner)
    );
}

#[test]
fn scanner_partition_matches_the_original_and_merges_vendor_specific_after_hid() {
    let enumeration = busy_bus();
    let expected = legacy_scanners(&enumeration);
    let mut walkable = Vec::new();
    walkable.extend(
        walk(&enumeration, CLASS_HID)
            .into_iter()
            .map(|info| Classified {
                class: CLASS_HID,
                info,
            }),
    );
    walkable.extend(
        enumeration
            .iter()
            .filter(|c| c.class == CLASS_VENDOR_SPECIFIC)
            .cloned(),
    );
    let actual = scanners_from(walkable);

    assert_eq!(
        expected.iter().map(key).collect::<Vec<_>>(),
        actual.iter().map(key).collect::<Vec<_>>()
    );
    // The vendor-only Magellan appears LAST: vendor-specific results are
    // appended after every HID result, as before.
    assert_eq!(
        actual.last().map(|d| (d.vid, d.pid)),
        Some((0x05F9, 0x2211))
    );
}

#[test]
fn scanner_dedup_keeps_the_hid_interface_and_drops_the_vendor_one() {
    // DS2208 exposes both a HID interface 0 and a vendor-specific interface 1.
    let walkable = vec![
        cls(CLASS_HID, 0x06DA, 0x4001, 0),
        cls(CLASS_VENDOR_SPECIFIC, 0x06DA, 0x4001, 1),
    ];
    let actual = scanners_from(walkable);
    assert_eq!(actual.len(), 1, "one device, not one per interface class");
    assert_eq!(actual[0].interface_number, 0, "the HID interface wins");
}

#[test]
fn vendor_specific_scanner_absent_from_hid_is_still_found() {
    let walkable = vec![cls(CLASS_VENDOR_SPECIFIC, 0x05F9, 0x2211, 0)];
    let actual = scanners_from(walkable);
    assert_eq!(actual.len(), 1);
    assert_eq!(actual[0].category, DeviceCategory::Scanner);
}

#[test]
fn unknown_vendor_specific_device_is_dropped_from_scanners() {
    let walkable = vec![cls(CLASS_VENDOR_SPECIFIC, 0xDEAD, 0xBEEF, 0)];
    assert!(scanners_from(walkable).is_empty());
}

#[test]
fn printer_partition_matches_the_original() {
    let enumeration = busy_bus();
    let expected = legacy_printers(&enumeration);
    let actual = printers_from(
        enumeration
            .into_iter()
            .filter(|c| c.class == CLASS_PRINTER)
            .collect(),
    );
    assert_eq!(
        expected.iter().map(key).collect::<Vec<_>>(),
        actual.iter().map(key).collect::<Vec<_>>()
    );
}

#[test]
fn scale_partition_matches_the_original_and_uses_the_known_name() {
    let enumeration = busy_bus();
    let expected = legacy_scales(&enumeration);
    let actual = scales_from(
        enumeration
            .into_iter()
            .filter(|c| c.class == CLASS_HID)
            .collect(),
    );
    assert_eq!(
        expected.iter().map(key).collect::<Vec<_>>(),
        actual.iter().map(key).collect::<Vec<_>>()
    );
    assert!(
        actual.iter().any(|d| d.label == "Dibal G-XT"),
        "KNOWN_SCALES name must win over the formatted fallback"
    );
}

#[test]
fn an_empty_bus_yields_three_empty_lists_either_way() {
    let expected = legacy_all(&[]);
    let actual = new_all(Vec::new());
    assert!(expected.is_empty());
    assert!(actual.is_empty());
}

#[test]
fn every_known_vid_pid_is_classified_identically_by_old_and_new_paths() {
    // Exhaustive over the tables, with each device presented on each of the
    // three classes, including devices that appear in more than one table
    // position and the (0,0) generic-scale sentinel.
    let mut enumeration = Vec::new();
    for &(v, p) in KNOWN_SCANNERS {
        for class in [CLASS_HID, CLASS_VENDOR_SPECIFIC, CLASS_PRINTER] {
            enumeration.push(cls(class, v, p, 0));
        }
    }
    for &(v, p) in KNOWN_PRINTERS {
        for class in [CLASS_HID, CLASS_VENDOR_SPECIFIC, CLASS_PRINTER] {
            enumeration.push(cls(class, v, p, 0));
        }
    }
    for &(v, p, _) in KNOWN_SCALES {
        for class in [CLASS_HID, CLASS_VENDOR_SPECIFIC, CLASS_PRINTER] {
            enumeration.push(cls(class, v, p, 0));
        }
    }

    assert_eq!(
        legacy_all(&enumeration).iter().map(key).collect::<Vec<_>>(),
        new_all(enumeration).iter().map(key).collect::<Vec<_>>()
    );
}

#[test]
fn label_fallbacks_are_unchanged() {
    // A known scanner with no label from classify_device still gets "Scanner ...".
    let mut d = device(0x0C2E, 0x0A10, 0);
    d.label = String::new();
    let out = scanners_from(vec![Classified {
        class: CLASS_HID,
        info: d,
    }]);
    assert_eq!(out[0].label, "Scanner 0c2e:0a10");

    let mut p = device(0x0416, 0x5011, 0);
    p.label = String::new();
    let out = printers_from(vec![Classified {
        class: CLASS_PRINTER,
        info: p,
    }]);
    assert_eq!(out[0].label, "Printer 0416:5011");

    // The generic HID POS scale (0,0) carries a real name in KNOWN_SCALES, so
    // it takes that name — the "Scale ..." fallback is only for a table entry
    // with an EMPTY name, which no current entry has.
    let mut s = device(0x0000, 0x0000, 0);
    s.label = String::new();
    let out = scales_from(vec![Classified {
        class: CLASS_HID,
        info: s,
    }]);
    assert_eq!(out[0].label, "Generic HID POS Scale");
}

#[test]
fn probe_classes_requests_every_class_probe_all_needs() {
    // The one walk must ask for all three of the classes the old code walked;
    // missing one silently empties a category.
    let wanted = [CLASS_HID, CLASS_VENDOR_SPECIFIC, CLASS_PRINTER];
    for class in wanted {
        assert!(
            SCANNER_CLASSES.contains(&class)
                || PRINTER_CLASSES.contains(&class)
                || SCALE_CLASSES.contains(&class),
            "class {class:#04x} is walked by some probe_* but not by probe_all's set"
        );
    }
}

#[test]
fn shared_usb_context_is_created_once_and_reused() {
    // O-M41: the process-wide context must be the SAME handle on every call,
    // so the connect path stops paying a libusb_init/libusb_exit pair.
    let first = shared_context().expect("a USB context");
    let second = shared_context().expect("a USB context");
    assert!(std::ptr::eq(first, second), "context must be process-wide");
}
