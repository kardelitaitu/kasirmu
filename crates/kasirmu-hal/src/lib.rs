/*
last audited DD-MM-YY by DSH-Agent
crate: oz-hal | status: SAFE | lint: CLEAN
findings: 0 actual unsafe blocks. #![deny(unsafe_code)] at crate root (RUST-06). Mock driver's .expect("poisoned") calls on Mutex locks are documented as test-double convention (mock always compiled per AGENTS.md). No other production unwrap/expect. Registry uses per-category RwLock with fail-open discovery; all 6 hardware traits have mock implementations. The EDC terminal slot was unified 31-08-26 (closing the bypass). WeightScale discovery gap documented in registry stamp.
next: WeightScale discovery path still open; otherwise stable | perf: N/A
*/
// RUST-06: no unsafe code exists today; deny at crate root so any future
// unsafe addition requires an explicit, narrowly-scoped reviewable allow.
#![deny(unsafe_code)]

//! Hardware Abstraction Layer for OZ-POS.
//!
//! `oz-hal` is the seam between business logic and physical devices.
//! Business code only ever sees the trait (`BarcodeScanner`,
//! `ReceiptPrinter`, `CashDrawer`, `CustomerDisplay`, `WeightScale`) — it
//! never imports a specific driver.
//!
//! Implemented device categories: barcode scanners (USB HID, serial,
//! Bluetooth SPP, plus a TCP path), receipt printers (USB, Bluetooth, TCP)
//! with ESC/POS formatting and KDS chits, cash drawers (standalone serial
//! and printer-kick), serial customer pole displays, and weight scales.
//!
//! Card-payment terminals: the [`EdcTerminal`] trait is defined here and its
//! drivers live in `crates/oz-hal/src/drivers/edc/` (`wired`, `wireless`, plus
//! the Ingenico/PAX/Verifone codecs under `drivers/edc/protocol/`), registered
//! through [`registry::DriverRegistry`] by the setup wizard. NFC readers are not
//! implemented at all.
//!
//! Every trait has a programmable mock in [`drivers::mock`]. Tests use
//! the mocks; production code uses real drivers registered through
//! [`registry::DriverRegistry`] at startup.

/// Turning saved hardware configuration into registered drivers.
pub mod bootstrap;
pub mod drivers;
pub mod error;
pub mod registry;
pub mod traits;
/// USB transport helpers for device enumeration.
pub mod transport;
pub mod types;

pub use bootstrap::{
    BootstrapReport, Connection, DisplayConfig, DrawerConfig, HardwareConfig, PrinterConfig,
    TerminalConfig, TerminalConnection, apply_config,
};
pub use error::{HalError, HalErrorKind};
pub use registry::DriverRegistry;
pub use traits::barcode::BarcodeScanner;
pub use traits::cash_drawer::CashDrawer;
pub use traits::customer_display::CustomerDisplay;
pub use traits::customer_display::DisplayContent;
pub use traits::edc::{EdcPaymentResult, EdcTerminal, TerminalStatus};
pub use traits::printer::{PaperStatus, PrinterStatus, ReceiptPrinter};
pub use traits::weight_scale::WeightReading;
pub use traits::weight_scale::WeightScale;
pub use types::{Barcode, BarcodeSymbology, DeviceInfo};
