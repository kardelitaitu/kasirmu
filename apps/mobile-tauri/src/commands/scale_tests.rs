use super::*;

#[test]
fn scale_device_info_debug() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x0922".into(),
        product_id: "0x8001".into(),
        device_path: "/dev/hidraw0".into(),
    };
    let debug = format!("{:?}", info);
    assert!(debug.contains("0x0922"));
}

#[test]
fn scale_device_info_serialize() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x1234".into(),
        product_id: "0x5678".into(),
        device_path: "/dev/ttyUSB0".into(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "0x1234");
    assert_eq!(json["product_id"], "0x5678");
}

#[test]
fn scale_device_info_empty_fields() {
    let info = ScaleDeviceInfo {
        vendor_id: String::new(),
        product_id: String::new(),
        device_path: String::new(),
    };
    assert_eq!(info.vendor_id, "");
}
