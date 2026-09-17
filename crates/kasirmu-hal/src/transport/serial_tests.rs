use super::*;

#[test]
fn probe_serial_does_not_panic() {
    // This test just verifies the function runs without panicking.
    // No hardware expected in CI — should return an empty vec or error.
    let result = probe_ports(true);
    assert!(result.is_ok() || result.is_err());
}

// ── SerialPortInfo struct tests ──────────────────────────────────

#[test]
fn serial_port_info_debug() {
    let info = SerialPortInfo {
        port_name: "COM3".into(),
        description: "FTDI FT232R USB UART".into(),
        vid: Some(0x0403),
        pid: Some(0x6001),
    };
    let debug = format!("{info:?}");
    assert!(debug.contains("COM3"));
    assert!(debug.contains("FTDI"));
    assert!(debug.contains("1027")); // 0x0403 in decimal
    assert!(debug.contains("24577")); // 0x6001 in decimal
}

#[test]
fn serial_port_info_clone_eq() {
    let info = SerialPortInfo {
        port_name: "COM3".into(),
        description: "Test".into(),
        vid: Some(0x0403),
        pid: Some(0x6001),
    };
    let cloned = info.clone();
    assert_eq!(info.port_name, cloned.port_name);
    assert_eq!(info.description, cloned.description);
    assert_eq!(info.vid, cloned.vid);
    assert_eq!(info.pid, cloned.pid);
}

#[test]
fn serial_port_info_no_vid_pid() {
    let info = SerialPortInfo {
        port_name: "COM1".into(),
        description: "Onboard Serial".into(),
        vid: None,
        pid: None,
    };
    assert_eq!(info.port_name, "COM1");
    assert!(info.vid.is_none());
    assert!(info.pid.is_none());
}

#[test]
fn serial_port_info_vid_only() {
    let info = SerialPortInfo {
        port_name: "/dev/ttyS0".into(),
        description: "Legacy Serial".into(),
        vid: Some(0x0403),
        pid: None,
    };
    assert_eq!(info.vid, Some(0x0403));
    assert!(info.pid.is_none());
}

#[test]
fn serial_port_info_empty_description() {
    let info = SerialPortInfo {
        port_name: "/dev/ttyUSB0".into(),
        description: String::new(),
        vid: None,
        pid: None,
    };
    assert_eq!(info.description, "");
}

// ── description_for_type tests ───────────────────────────────────

#[test]
fn description_for_usb_port_with_manufacturer() {
    let info = UsbPortInfo {
        vid: 0x0403,
        pid: 0x6001,
        serial_number: Some("A123".into()),
        manufacturer: Some("FTDI".into()),
        product: Some("FT232R".into()),
    };
    let desc = description_for_type(&SerialPortType::UsbPort(info));
    assert_eq!(desc, "FTDI FT232R");
}

#[test]
fn description_for_usb_port_without_manufacturer() {
    let info = UsbPortInfo {
        vid: 0x1A86,
        pid: 0x7523,
        serial_number: None,
        manufacturer: None,
        product: None,
    };
    let desc = description_for_type(&SerialPortType::UsbPort(info));
    assert_eq!(desc, "Unknown USB Serial");
}

#[test]
fn description_for_usb_port_product_only() {
    let info = UsbPortInfo {
        vid: 0x1A86,
        pid: 0x7523,
        serial_number: None,
        manufacturer: None,
        product: Some("CH340".into()),
    };
    let desc = description_for_type(&SerialPortType::UsbPort(info));
    assert_eq!(desc, "Unknown CH340");
}

#[test]
fn description_for_bluetooth_port() {
    let desc = description_for_type(&SerialPortType::BluetoothPort);
    assert_eq!(desc, "Bluetooth Serial");
}

#[test]
fn description_for_pci_port() {
    let desc = description_for_type(&SerialPortType::PciPort);
    assert_eq!(desc, "PCI Serial");
}

// ── Known serial adapters tests ──────────────────────────────────

#[test]
fn known_serial_adapters_non_empty() {
    assert!(!KNOWN_SERIAL_ADAPTERS.is_empty());
}

#[test]
fn known_serial_adapters_no_duplicates() {
    let len = KNOWN_SERIAL_ADAPTERS.len();
    let mut unique: Vec<_> = KNOWN_SERIAL_ADAPTERS.to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        len,
        "KNOWN_SERIAL_ADAPTERS has duplicate entries"
    );
}

#[test]
fn known_serial_adapters_contains_ftdi() {
    assert!(KNOWN_SERIAL_ADAPTERS.contains(&(0x0403, 0x6001)));
}

#[test]
fn known_serial_adapters_contains_ch340() {
    assert!(KNOWN_SERIAL_ADAPTERS.contains(&(0x1A86, 0x7523)));
}

#[test]
fn known_serial_adapters_count() {
    assert_eq!(KNOWN_SERIAL_ADAPTERS.len(), 11);
}
