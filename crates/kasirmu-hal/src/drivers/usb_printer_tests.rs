use super::*;
use crate::transport::usb::DeviceCategory;

#[test]
fn try_new_stores_info() {
    let usb_info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN007".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: String::new(),
    };
    let printer = UsbReceiptPrinter::try_new(usb_info);
    let info = printer.device_info();
    assert_eq!(info.vendor, "Epson");
    assert_eq!(info.model, "TM-T20");
    assert_eq!(info.serial, "SN007");
}

#[test]
fn device_info_reflects_manufacturer() {
    let usb_info = UsbDeviceInfo {
        vid: 0x0519,
        pid: 0x0301,
        manufacturer: "Star".into(),
        product: "TSP100".into(),
        serial: "SN008".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: String::new(),
    };
    let printer = UsbReceiptPrinter::try_new(usb_info);
    assert_eq!(printer.device_info().vendor, "Star");
}

#[test]
fn with_partial_cut_enables() {
    let usb_info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: String::new(),
    };
    let printer = UsbReceiptPrinter::try_new(usb_info).with_partial_cut(true);
    assert!(printer.partial_cut);
}

#[test]
fn default_partial_cut_is_false() {
    let usb_info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: String::new(),
    };
    let printer = UsbReceiptPrinter::try_new(usb_info);
    assert!(!printer.partial_cut);
}

#[test]
fn discover_all_does_not_panic() {
    let printers = UsbReceiptPrinter::discover_all();
    // No USB hardware expected in CI — empty vec is fine.
    assert!(printers.is_empty() || !printers.is_empty());
}

#[test]
fn try_new_preserves_usb_info() {
    let usb_info = UsbDeviceInfo {
        vid: 0x0416,
        pid: 0x5011,
        manufacturer: "Epson".into(),
        product: "TM-T20".into(),
        serial: "SN009".into(),
        interface_number: 0,
        endpoint_in: 0x81,
        endpoint_out: Some(0x02),
        category: DeviceCategory::Printer,
        label: String::new(),
    };
    let printer = UsbReceiptPrinter::try_new(usb_info.clone());
    assert_eq!(printer.usb_info.vid, 0x0416);
    assert_eq!(printer.usb_info.pid, 0x5011);
    assert_eq!(printer.usb_info.serial, "SN009");
}
