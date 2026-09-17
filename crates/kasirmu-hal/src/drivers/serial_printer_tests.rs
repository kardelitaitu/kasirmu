//! Serial receipt printer — construction, accessors, and lazy-open contract.

use super::*;
use crate::traits::printer::ReceiptPrinter;

fn info(model: &str) -> DeviceInfo {
    DeviceInfo::new("Epson", model, "SN001")
}

#[test]
fn new_stores_fields() {
    let printer = SerialReceiptPrinter::new("COM7", 9600, info("TM-m30"));
    assert_eq!(printer.port_name, "COM7");
    assert_eq!(printer.baud_rate, 9600);
    assert!(!printer.partial_cut);
}

#[test]
fn the_accessors_echo_what_the_constructor_was_given() {
    // A setup wizard must be able to show the operator which port and speed
    // a saved profile resolved to; without these the configuration is
    // write-only and unverifiable after the fact.
    let printer = SerialReceiptPrinter::new("/dev/ttyUSB0", 115200, info("TS-T88"));
    assert_eq!(printer.port_name(), "/dev/ttyUSB0");
    assert_eq!(printer.baud_rate(), 115200);
}

#[test]
fn device_info_returns_identity() {
    let info = DeviceInfo::new("Star", "SP700", "SN002");
    let printer = SerialReceiptPrinter::new("/dev/rfcomm0", 115200, info.clone());
    let returned = printer.device_info();
    assert_eq!(returned.vendor, "Star");
    assert_eq!(returned.model, "SP700");
    assert_eq!(returned.serial, "SN002");
}

#[test]
fn with_partial_cut_is_a_builder_not_a_mutation_in_place() {
    let on = SerialReceiptPrinter::new("COM1", 9600, info("x")).with_partial_cut(true);
    assert!(on.partial_cut);
    let off = SerialReceiptPrinter::new("COM1", 9600, info("x"));
    assert!(!off.partial_cut, "the default stays full-cut");
    assert!(
        !SerialReceiptPrinter::new("COM1", 9600, info("x"))
            .with_partial_cut(false)
            .partial_cut
    );
}

#[tokio::test]
async fn constructing_a_printer_never_opens_the_port() {
    // The whole fail-open premise of the bootstrap: a saved profile naming a
    // port that is gone must register fine and fail on the print, not at
    // startup. If new() ever opens, this test is where it gets caught.
    let printer = SerialReceiptPrinter::new("OZ-POS-NOT-A-REAL-PORT", 9600, info("ghost"));
    assert!(
        printer.port.lock().await.is_none(),
        "new() must not connect"
    );
}

#[tokio::test]
async fn printing_to_an_absent_port_errors_instead_of_panicking() {
    let printer = SerialReceiptPrinter::new("OZ-POS-NOT-A-REAL-PORT", 9600, info("ghost"));
    let result = printer.print_receipt("hello").await;
    assert!(
        result.is_err(),
        "an unreachable port must not report success"
    );
}

#[test]
fn default_baud_matches_the_other_serial_drivers() {
    assert_eq!(DEFAULT_BAUD, 9600);
    assert_eq!(
        DEFAULT_BAUD,
        crate::drivers::serial_display::DISPLAY_DEFAULT_BAUD
    );
}
