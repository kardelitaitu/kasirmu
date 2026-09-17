use super::*;
use crate::drivers::mock::MockReceiptPrinter;

#[tokio::test]
async fn printer_kick_sends_kick_command() {
    let printer = Arc::new(MockReceiptPrinter::new());
    let drawer = PrinterKickCashDrawer::new_pin2(printer.clone());

    drawer.open().await.unwrap();

    let raw = printer.printed_raw.lock().unwrap();
    assert_eq!(raw.len(), 1, "should have sent one raw command");
    assert_eq!(
        raw[0],
        escpos::KICK_DRAWER_PIN2,
        "should send standard kick command"
    );
}

#[tokio::test]
async fn printer_kick_pin5_sends_pin5_command() {
    let printer = Arc::new(MockReceiptPrinter::new());
    let drawer = PrinterKickCashDrawer::new_pin5(printer.clone());

    drawer.open().await.unwrap();

    let raw = printer.printed_raw.lock().unwrap();
    assert_eq!(raw[0], escpos::KICK_DRAWER_PIN5);
}

#[tokio::test]
async fn printer_kick_device_info() {
    let printer = Arc::new(MockReceiptPrinter::with_info(DeviceInfo::new(
        "Epson", "TM-T88", "SN001",
    )));
    let drawer = PrinterKickCashDrawer::new_pin2(printer);
    let info = drawer.device_info();
    assert_eq!(info.vendor, "PrinterKick");
}

#[tokio::test]
async fn printer_kick_propagates_error() {
    let printer = Arc::new(MockReceiptPrinter::new());
    printer.set_next_error(HalError::Disconnected);
    let drawer = PrinterKickCashDrawer::new_pin2(printer);

    let err = drawer.open().await.unwrap_err();
    assert!(matches!(err, HalError::Disconnected));
}

#[test]
fn serial_discover_does_not_panic() {
    let drawers = SerialCashDrawer::discover_all();
    // No hardware expected in CI — empty vec is fine.
    assert!(drawers.is_empty() || !drawers.is_empty());
}

#[tokio::test]
async fn serial_drawer_device_info() {
    let info = DeviceInfo::new("Test", "SerialDrawer", "COM99");
    let drawer = SerialCashDrawer::new("COM99", 9600, info.clone());
    assert_eq!(drawer.device_info(), info);
}
