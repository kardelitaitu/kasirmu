/*
last audited 31-08-26 by DSH-Agent (implementation moved to serial_printer.rs)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: this file is now a transport-named alias, not a driver. Nothing Bluetooth-specific ever lived in it — open_port(name, baud) plus ESC/POS — and registry.rs builds it from a plain serial-port enumeration, so keeping a second implementation would have meant two drivers to keep in step. The alias stays because discovery, the setup wizard and the README all describe what was found, not how it is wired.
next: none | perf: N/A
*/
//! Bluetooth (SPP) receipt printer — an alias for the serial driver.
//!
//! The Serial Port Profile presents a paired printer as an ordinary COM or
//! rfcomm port, so the application cannot tell a Bluetooth printer from a
//! wired one and there is nothing for a separate driver to do. The
//! implementation is [`SerialReceiptPrinter`]; this name exists because
//! [`crate::registry::DriverRegistry::discover`] finds ports over Bluetooth
//! and the setup wizard should report the transport the operator chose.
//!
//! Prefer [`SerialReceiptPrinter`] in new code. The alias is a compatibility
//! name, not a distinct device class.

pub use super::serial_printer::SerialReceiptPrinter;

/// Compatibility spelling of [`SerialReceiptPrinter`].
///
/// Not deprecated: `discover()`, the setup wizard and several tests name the
/// transport they found, and marking those call sites would break the
/// `-D warnings` gate for a rename that carries no behavioural difference.
pub type BtReceiptPrinter = SerialReceiptPrinter;

#[cfg(test)]
#[path = "bt_printer_tests.rs"]
mod tests;
