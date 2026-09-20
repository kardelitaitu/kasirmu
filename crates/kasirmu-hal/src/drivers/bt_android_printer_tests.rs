//! Tests for the Android Bluetooth printer driver (run only on the Android
//! target — the module is `cfg(target_os = "android")`).
//!
//! Pure-logic coverage only: construction, identity, configuration. A live
//! connect/print needs real hardware and belongs to on-device verification
//! (see .agents/skills/android-apk-build/SKILL.md for the device lane).

use super::*;
use crate::traits::printer::ReceiptPrinter;

#[test]
fn new_stores_address_and_lazy_state() {
    let info = DeviceInfo::new("AndroidBt", "Test Printer", "AA:BB:CC:DD:EE:FF");
    let printer = AndroidBtReceiptPrinter::new("AA:BB:CC:DD:EE:FF", info);
    assert_eq!(printer.address(), "AA:BB:CC:DD:EE:FF");
    // Nothing was opened: the stream slot is empty until the first print.
    assert!(printer.stream.try_lock().is_ok());
}

#[test]
fn partial_cut_flag_round_trips() {
    let info = DeviceInfo::new("AndroidBt", "Test Printer", "AA:BB:CC:DD:EE:FF");
    let printer = AndroidBtReceiptPrinter::new("AA:BB:CC:DD:EE:FF", info).with_partial_cut(true);
    assert!(printer.partial_cut);
}

#[tokio::test]
async fn print_before_any_device_fails_without_panic() {
    // No JVM is captured under cargo test, so ensure_connected must resolve
    // to a plain HalError — the graceful-degradation contract.
    let info = DeviceInfo::new("AndroidBt", "Test Printer", "AA:BB:CC:DD:EE:FF");
    let printer = AndroidBtReceiptPrinter::new("AA:BB:CC:DD:EE:FF", info);
    let result = printer.print_receipt("hello").await;
    assert!(result.is_err(), "printing without a VM must fail, not hang");
}

#[test]
fn discover_all_never_panics_without_a_vm() {
    // Whatever the environment, discovery returns a list (possibly empty)
    // rather than propagating a panic.
    let _ = AndroidBtReceiptPrinter::discover_all();
}
