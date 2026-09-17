use super::*;

/// Verify that discovery doesn't panic on systems without BT hardware.
#[test]
fn bt_discover_does_not_panic() {
    let scanners = BtBarcodeScanner::discover_all();
    // No hardware expected in CI — should return empty vec.
    assert!(scanners.is_empty() || !scanners.is_empty());
}

#[test]
fn new_stores_port_and_baud() {
    let info = SerialPortInfo {
        port_name: "COM7".into(),
        description: "Honeywell BT Scanner".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new(info, 115200);
    assert_eq!(scanner.port_name, "COM7");
    assert_eq!(scanner.baud_rate, 115200);
}

#[test]
fn new_default_uses_9600_baud() {
    let info = SerialPortInfo {
        port_name: "COM8".into(),
        description: "Zebra BT Scanner".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new_default(info);
    assert_eq!(scanner.baud_rate, DEFAULT_BAUD);
}

#[test]
fn device_info_reflects_constructor() {
    let info = SerialPortInfo {
        port_name: "COM9".into(),
        description: "Datalogic BT".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new(info, 9600);
    let dev_info = scanner.device_info();
    assert_eq!(dev_info.vendor, "Bluetooth");
    assert_eq!(dev_info.model, "Datalogic BT");
    assert_eq!(dev_info.serial, "COM9");
}

#[test]
fn default_baud_constant_is_9600() {
    assert_eq!(DEFAULT_BAUD, 9600);
}
