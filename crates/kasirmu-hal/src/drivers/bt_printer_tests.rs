//! The Bluetooth printer name is an alias, not a second driver.
//!
//! Behaviour lives in `serial_printer_tests.rs`; these tests only pin the
//! relationship, so the two cannot drift into being different devices.

use super::*;
use crate::registry::DriverRegistry;
use crate::types::DeviceInfo;

#[test]
fn the_alias_and_the_serial_type_are_interchangeable() {
    // If someone reintroduces a separate BtReceiptPrinter struct, this stops
    // compiling — which is the point. Two drivers for one transport is how
    // the crate ended up with a serial printer the bootstrap had to reject.
    let bt: BtReceiptPrinter = BtReceiptPrinter::new("COM7", 9600, DeviceInfo::new("a", "b", "c"));
    let serial: SerialReceiptPrinter = bt;
    assert_eq!(serial.port_name(), "COM7");
    assert_eq!(serial.baud_rate(), 9600);
}

#[tokio::test]
async fn both_registry_helpers_produce_a_working_serial_printer() {
    let reg = DriverRegistry::default();
    reg.register_serial_printer("ser", "COM3", 9600, DeviceInfo::new("v", "m", "s"))
        .await;
    reg.register_bluetooth_printer("bt", "COM7", 9600, DeviceInfo::new("v", "m", "s"))
        .await;

    for id in ["ser", "bt"] {
        let printer = reg.printer(id).await.expect("registered");
        assert_eq!(printer.device_info().model, "m");
        // Neither port exists on a test machine, so both must error rather
        // than report success — identical behaviour is the assertion here.
        assert!(
            printer.print_receipt("x").await.is_err(),
            "{id} must not claim a print it could not do"
        );
    }
}

#[tokio::test]
async fn each_helper_still_brings_its_companion_drawer() {
    let reg = DriverRegistry::default();
    reg.register_serial_printer("ser", "COM3", 9600, DeviceInfo::new("v", "m", "s"))
        .await;
    reg.register_bluetooth_printer("bt", "COM7", 9600, DeviceInfo::new("v", "m", "s"))
        .await;
    assert!(reg.cash_drawer("drawer:kick:ser").await.is_some());
    assert!(reg.cash_drawer("drawer:kick:bt").await.is_some());
}
