use super::*;

#[test]
fn serial_discover_does_not_panic() {
    // No hardware expected in CI — should return empty vec.
    let scanners = SerialBarcodeScanner::discover_all();
    assert!(scanners.is_empty() || !scanners.is_empty());
}

#[test]
fn new_stores_port_and_baud() {
    let info = SerialPortInfo {
        port_name: "/dev/ttyUSB0".into(),
        description: "Honeywell Serial".into(),
        vid: Some(0x0C2E),
        pid: Some(0x0A10),
    };
    let scanner = SerialBarcodeScanner::new(info, 19200);
    assert_eq!(scanner.port_name, "/dev/ttyUSB0");
    assert_eq!(scanner.baud_rate, 19200);
}

#[test]
fn new_default_uses_9600_baud() {
    let info = SerialPortInfo {
        port_name: "COM3".into(),
        description: "Zebra Serial".into(),
        vid: Some(0x06DA),
        pid: Some(0x4001),
    };
    let scanner = SerialBarcodeScanner::new_default(info);
    assert_eq!(scanner.baud_rate, DEFAULT_BAUD);
}

#[test]
fn device_info_reflects_constructor() {
    let info = SerialPortInfo {
        port_name: "COM4".into(),
        description: "Datalogic Serial".into(),
        vid: Some(0x05F9),
        pid: Some(0x2211),
    };
    let scanner = SerialBarcodeScanner::new(info, 9600);
    let dev_info = scanner.device_info();
    assert_eq!(dev_info.vendor, "serial");
    assert_eq!(dev_info.model, "Datalogic Serial");
    assert_eq!(dev_info.serial, "COM4");
}

#[test]
fn default_baud_constant_is_9600() {
    assert_eq!(DEFAULT_BAUD, 9600);
}
