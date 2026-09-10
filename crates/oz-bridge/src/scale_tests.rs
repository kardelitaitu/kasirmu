//! Scale command unit tests (Wave-D test relocation: moved out of
//! `apps/desktop-client/src/commands/scale_tests.rs`).
//!
//! Mounted at the foot of `scale.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs directly. The tests are pure DTO
//! serialisation assertions with no `AppState` coupling; the bodies port
//! verbatim.
use super::*;

#[test]
fn scale_device_info_debug() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x0922".into(),
        product_id: "0x8001".into(),
        device_path: "/dev/hidraw0".into(),
    };
    let debug = format!("{info:?}");
    assert!(debug.contains("0x0922"));
    assert!(debug.contains("0x8001"));
    assert!(debug.contains("/dev/hidraw0"));
}

#[test]
fn scale_device_info_serialize() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x067B".into(),
        product_id: "0x2303".into(),
        device_path: "COM3".into(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "0x067B");
    assert_eq!(json["product_id"], "0x2303");
    assert_eq!(json["device_path"], "COM3");
}

#[test]
fn scale_device_info_empty_fields() {
    let info = ScaleDeviceInfo {
        vendor_id: String::new(),
        product_id: String::new(),
        device_path: String::new(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "");
    assert_eq!(json["product_id"], "");
    assert_eq!(json["device_path"], "");
}
