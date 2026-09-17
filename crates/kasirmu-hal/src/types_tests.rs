use super::*;

#[test]
fn barcode_new_defaults_to_any_symbology() {
    let b = Barcode::new("12345");
    assert_eq!(b.code, "12345");
    assert_eq!(b.symbology, BarcodeSymbology::Any);
}

#[test]
fn device_info_display_format() {
    let info = DeviceInfo::new("OZ", "Mock", "0001");
    assert_eq!(info.display(), "OZ Mock (0001)");
}

#[test]
fn barcode_with_explicit_symbology() {
    let b = Barcode {
        code: "012345678905".into(),
        symbology: BarcodeSymbology::Ean13,
    };
    assert_eq!(b.code, "012345678905");
    assert_eq!(b.symbology, BarcodeSymbology::Ean13);
}

#[test]
fn device_info_empty_serial() {
    let info = DeviceInfo::new("test", "dev", "");
    assert_eq!(info.display(), "test dev ()");
}

#[test]
fn device_info_long_fields() {
    let info = DeviceInfo::new("Honeywell", "Voyager 1450g", "ABC123XYZ");
    assert_eq!(info.vendor, "Honeywell");
    assert_eq!(info.model, "Voyager 1450g");
    assert_eq!(info.serial, "ABC123XYZ");
}

#[test]
fn barcode_symbology_debug_and_clone() {
    let variants = [
        BarcodeSymbology::Any,
        BarcodeSymbology::Ean13,
        BarcodeSymbology::UpcA,
        BarcodeSymbology::Code128,
        BarcodeSymbology::Qr,
        BarcodeSymbology::Pdf417,
    ];
    for &v in &variants {
        let cloned = v;
        assert_eq!(format!("{cloned:?}"), format!("{v:?}"));
    }
}

#[test]
fn barcode_eq_and_hash() {
    use std::collections::HashSet;
    let b1 = Barcode::new("ABC");
    let b2 = Barcode::new("ABC");
    let b3 = Barcode::new("XYZ");
    assert_eq!(b1, b2);
    assert_ne!(b1, b3);

    let mut set = HashSet::new();
    set.insert(b1);
    set.insert(b2);
    set.insert(b3);
    assert_eq!(set.len(), 2, "only 2 distinct barcodes: ABC and XYZ");
}

#[test]
fn device_info_eq() {
    let a = DeviceInfo::new("a", "b", "c");
    let b = DeviceInfo::new("a", "b", "c");
    let c = DeviceInfo::new("x", "y", "z");
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn barcode_serde_roundtrip() {
    let b = Barcode {
        code: "12345".into(),
        symbology: BarcodeSymbology::Ean13,
    };
    let json = serde_json::to_string(&b).unwrap();
    let back: Barcode = serde_json::from_str(&json).unwrap();
    assert_eq!(back, b);
}

#[test]
fn device_info_serde_roundtrip() {
    let info = DeviceInfo::new("OZ", "Mock", "0001");
    let json = serde_json::to_string(&info).unwrap();
    let back: DeviceInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(back, info);
}
