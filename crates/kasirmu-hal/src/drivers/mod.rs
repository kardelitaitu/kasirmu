/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean — 15 driver modules, all declared, none orphaned. (The dead drivers/scanner.rs that sat here uncompiled was deleted 31-08-26.) drivers/edc/ arrived the same day from oz-payment as part of the HAL unification; its drivers are stubs, so nothing here opens a device that the trait does not model. bt_printer.rs is now an alias for serial_printer.rs rather than a second implementation — see its header for why.
next: none | perf: N/A
*/
//! Hardware drivers.
//!
//! Every real driver implements one of the traits in `crate::traits`.
//! Mocks live in `mock.rs` and are compiled unconditionally so tests
//! never need a `mock` feature flag.

/// Bluetooth receipt printer driver.
pub mod bt_printer;
/// Bluetooth barcode scanner driver.
pub mod bt_scanner;
/// Cash drawer driver (serial / USB).
pub mod drawer;
/// EDC card-payment terminal drivers and vendor protocol codecs.
pub mod edc;
/// ESC/POS command builder for receipt printers.
pub mod escpos;
/// KDS kitchen chit formatter.
pub mod kds_chit;
/// Programmable mock implementations for all HAL traits.
pub mod mock;
/// Generic receipt printer abstraction.
pub mod receipt;
/// Weight scale driver.
pub mod scale;
/// Serial-attached customer display driver.
pub mod serial_display;
/// Serial receipt printer — RS-232, USB-serial and Bluetooth SPP alike.
pub mod serial_printer;
/// Serial-attached barcode scanner driver.
pub mod serial_scanner;
/// TCP/IP network receipt printer driver.
pub mod tcp_printer;
/// USB receipt printer driver.
pub mod usb_printer;
/// USB barcode scanner driver.
pub mod usb_scanner;
