use super::*;

#[test]
fn new_stores_fields() {
    let info = DeviceInfo::new("Epson", "TM-T88VI", "SN003");
    let printer = TcpReceiptPrinter::new("192.168.1.100", info.clone());
    assert_eq!(printer.addr, "192.168.1.100");
    assert!(!printer.partial_cut);
}

#[test]
fn new_with_hostname() {
    let info = DeviceInfo::new("Star", "mC-Print3", "SN004");
    let printer = TcpReceiptPrinter::new("printer.local", info.clone());
    assert_eq!(printer.addr, "printer.local");
}

#[test]
fn new_with_custom_port() {
    let info = DeviceInfo::new("Bixolon", "SRP-350", "SN005");
    let printer = TcpReceiptPrinter::new("10.0.0.5:9999", info.clone());
    assert_eq!(printer.addr, "10.0.0.5:9999");
}

#[test]
fn device_info_returns_identity() {
    let info = DeviceInfo::new("Epson", "TM-T70", "SN006");
    let printer = TcpReceiptPrinter::new("printer.local", info.clone());
    let returned = printer.device_info();
    assert_eq!(returned.vendor, "Epson");
    assert_eq!(returned.model, "TM-T70");
    assert_eq!(returned.serial, "SN006");
}

#[test]
fn with_partial_cut_enables() {
    let info = DeviceInfo::new("Test", "TCP", "SN");
    let printer = TcpReceiptPrinter::new("localhost", info).with_partial_cut(true);
    assert!(printer.partial_cut);
}

#[test]
fn default_partial_cut_is_false() {
    let info = DeviceInfo::new("Test", "TCP", "SN");
    let printer = TcpReceiptPrinter::new("localhost", info);
    assert!(!printer.partial_cut);
}
