/*
last audited 31-08-26 by DSH-Agent (bootstrap module, new)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: exists because the registry had a complete read side and no write side — DriverRegistry::discover() had exactly one caller (registry_tests.rs:213) and no app ever called register_*, so every hardware command resolved None at runtime while the setup wizard could still list devices via probe_all(). Second, independent defect found here: discover() mints hardware-derived ids ("printer:vendor:model") while the app looks up "default"/"kitchen", so calling discover() alone would not have fixed anything — apply_config binds the operator's id to the device. Addressed transports are constructed without I/O; Connection::Usb is the one branch that enumerates the bus, since it names no address. Scales are absent because HidWeightScale is a stub: registering one would turn read_scale_weight_scoped's clean Ok(None) into an Err on every poll, so wiring waits on the driver, not on the config schema.
next: implement HID POS reads in drivers/scale.rs, then add vid/pid to TerminalProfile and scale entries here | perf: USB enumeration is synchronous and blocks the runtime thread briefly at startup
*/
//! Registry bootstrap — turning saved hardware configuration into drivers.
//!
//! [`HardwareConfig`] is the HAL's own description of what an operator
//! configured. An app reads its persistence layer (for OZ-POS that is
//! `platform_core::terminal_profile::TerminalProfile`) and maps it here;
//! the HAL never reaches into a settings table.
//!
//! [`DriverRegistry::apply_config`] then registers each entry and returns a
//! [`BootstrapReport`] naming what was registered, skipped, or rejected.
//! Addressed transports are constructed without touching the device; only a
//! `"usb"` printer enumerates the bus, because it names no address to bind.

use std::fmt;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::drivers::drawer::PrinterKickCashDrawer;
use crate::drivers::edc::WirelessTarget;
use crate::registry::DriverRegistry;
use crate::types::DeviceInfo;

/// Baud rate assumed when a saved profile predates the baud field or
/// recorded zero. 9600 is the default on every thermal printer and pole
/// display this crate ships a driver for.
pub const DEFAULT_BAUD: u32 = 9600;

/// How a configured device is reached.
///
/// The string forms the profile uses are `"usb"`, `"serial"`, `"bluetooth"`,
/// `"network"` and `"auto"`; [`Connection::parse`] accepts them
/// case-insensitively so a profile saved by an older build still loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Connection {
    /// Match by USB vendor/product, no address needed.
    Usb,
    /// Serial port at a given baud rate.
    Serial {
        /// Platform port name (`COM3`, `/dev/ttyUSB0`).
        port: String,
        /// Baud rate; 9600 when the profile did not record one.
        baud: u32,
    },
    /// Bluetooth SPP exposed as a serial port by the OS.
    Bluetooth {
        /// The COM/port name the stack bound the device to.
        port: String,
    },
    /// Host[:port] socket.
    Network {
        /// Address, e.g. `192.168.1.50:9100`.
        addr: String,
    },
}

impl Connection {
    /// Parse the profile's connection vocabulary. Returns `None` for
    /// `"none"`, `"disabled"`, `"auto"` and anything unrecognised, which the
    /// caller reports as skipped rather than failed.
    #[must_use]
    pub fn parse(kind: &str, address: &str, baud: u32) -> Option<Self> {
        match kind.trim().to_ascii_lowercase().as_str() {
            "usb" => Some(Self::Usb),
            "serial" if !address.trim().is_empty() => Some(Self::Serial {
                port: address.trim().to_owned(),
                baud: if baud == 0 { DEFAULT_BAUD } else { baud },
            }),
            "bluetooth" | "bt" if !address.trim().is_empty() => Some(Self::Bluetooth {
                port: address.trim().to_owned(),
            }),
            "network" | "tcp" | "ethernet" if !address.trim().is_empty() => Some(Self::Network {
                addr: address.trim().to_owned(),
            }),
            _ => None,
        }
    }

    /// The address this connection names, if any.
    #[must_use]
    pub fn address(&self) -> Option<&str> {
        match self {
            Self::Usb => None,
            Self::Serial { port, .. } | Self::Bluetooth { port } => Some(port),
            Self::Network { addr } => Some(addr),
        }
    }
}

/// A receipt printer the operator configured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrinterConfig {
    /// Registry id the app will look the printer up under (`"default"`,
    /// `"kitchen"`).
    pub id: String,
    /// How to reach it.
    pub connection: Connection,
    /// Identity for logs and the setup wizard.
    pub info: DeviceInfo,
}

/// A customer pole display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayConfig {
    /// Registry id.
    pub id: String,
    /// Serial port name.
    pub port: String,
    /// Baud rate, 9600 when unset.
    pub baud: u32,
    /// Identity for logs.
    pub info: DeviceInfo,
}

/// A standalone cash drawer on its own serial line.
///
/// Drawers kicked through a printer's RJ11 port do not appear here: the
/// registry registers a companion `PrinterKickCashDrawer` automatically
/// whenever a printer is registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawerConfig {
    /// Registry id.
    pub id: String,
    /// Serial port name.
    pub port: String,
    /// Baud rate, 9600 when unset.
    pub baud: u32,
    /// Identity for logs.
    pub info: DeviceInfo,
}

/// A card-payment terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalConfig {
    /// Registry id.
    pub id: String,
    /// Wired serial/USB, or wireless Bluetooth/network.
    pub connection: TerminalConnection,
    /// Identity for logs.
    pub info: DeviceInfo,
}

/// How a card terminal is attached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalConnection {
    /// Serial or USB line at a baud rate.
    Wired {
        /// Platform port name.
        port: String,
        /// Baud rate.
        baud: u32,
    },
    /// Bluetooth or network address.
    Wireless {
        /// The HAL wireless target.
        target: WirelessTarget,
    },
}

/// Everything the operator configured on this terminal, in the HAL's own
/// vocabulary.
///
/// Weight scales are intentionally absent, and not only for the config
/// reason. `TerminalProfile` records a scale device path while
/// [`crate::drivers::scale::HidWeightScale`] is constructed from a USB
/// vendor/product pair the profile never captured — but the blocking fact is
/// that the driver is a stub whose `read_weight` always fails.
/// `read_scale_weight_scoped` maps a missing scale to `Ok(None)` so the UI
/// simply shows no weight; registering a stub would make the same command
/// return `Err` on every poll. Wiring a scale is therefore a regression
/// until the driver reads a device, whatever the config schema says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HardwareConfig {
    /// Receipt printers.
    pub printers: Vec<PrinterConfig>,
    /// Customer pole displays.
    pub displays: Vec<DisplayConfig>,
    /// Standalone cash drawers.
    pub drawers: Vec<DrawerConfig>,
    /// Card-payment terminals.
    pub terminals: Vec<TerminalConfig>,
    /// Bind every barcode scanner enumeration finds, under its
    /// hardware-derived id.
    ///
    /// The one entry that is not a device the operator named, and the one
    /// that does not need naming: the UI lists registered scanner ids and
    /// `useBarcodeScanner.ts` auto-detects by taking the first, so a
    /// discovery id round-trips correctly where `printer("default")` never
    /// would. Off by default so `apply_config` stays explicit about what it
    /// binds; `config_from_profile` turns it on. Enumeration opens no port.
    pub autodetect_scanners: bool,
}

impl HardwareConfig {
    /// A config that registers nothing.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// `true` when the operator named no device.
    ///
    /// Deliberately ignores [`Self::autodetect_scanners`]: that is a
    /// behaviour, not a configured device, and enumeration may legitimately
    /// find nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.printers.is_empty()
            && self.displays.is_empty()
            && self.drawers.is_empty()
            && self.terminals.is_empty()
    }

    /// Total number of devices the operator configured.
    #[must_use]
    pub fn len(&self) -> usize {
        self.printers.len() + self.displays.len() + self.drawers.len() + self.terminals.len()
    }
}

/// What happened during [`DriverRegistry::apply_config`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BootstrapReport {
    /// `"<category>:<id>"` for each driver registered.
    pub registered: Vec<String>,
    /// `"<category>:<id>"` for entries skipped as unconfigured or disabled.
    pub skipped: Vec<String>,
    /// `"<category>:<id>"` and why it could not be registered.
    pub rejected: Vec<(String, String)>,
}

impl BootstrapReport {
    /// How many drivers were registered.
    #[must_use]
    pub fn registered_count(&self) -> usize {
        self.registered.len()
    }

    /// `true` when nothing was rejected. A report can be `ok` while
    /// registering nothing — an unconfigured machine is a valid state.
    #[must_use]
    pub fn ok(&self) -> bool {
        self.rejected.is_empty()
    }
}

impl fmt::Display for BootstrapReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "hardware bootstrap: {} registered, {} skipped, {} rejected",
            self.registered.len(),
            self.skipped.len(),
            self.rejected.len()
        )?;
        for (id, reason) in &self.rejected {
            write!(f, "; rejected {id}: {reason}")?;
        }
        Ok(())
    }
}

/// Register every device in `config` on `registry`.
///
/// Fail-open per device: one bad entry is recorded in
/// [`BootstrapReport::rejected`] and the rest still register, matching how
/// [`DriverRegistry::discover`] treats a driver that fails to probe.
///
/// Addressed transports — network, Bluetooth-on-a-COM-port, serial — are
/// constructed without touching the device, so a stale saved profile cannot
/// block startup and the first real I/O error surfaces on the operation that
/// needs the hardware. `Connection::Usb` is the exception: it names no
/// address, so it enumerates the bus to find something to bind.
pub async fn apply_config(registry: &DriverRegistry, config: &HardwareConfig) -> BootstrapReport {
    let mut report = BootstrapReport::default();

    for printer in &config.printers {
        let key = format!("printer:{}", printer.id);
        match &printer.connection {
            Connection::Usb => {
                // The profile said "a USB printer" without naming one, so
                // this is the one branch that has to look at the bus. It is
                // also the branch that makes a bootstrap necessary at all:
                // discover() registers what it finds under hardware-derived
                // ids like "printer:vendor:model", while the receipt path
                // asks for "default". Without this binding, calling
                // discover() would still leave every lookup empty.
                //
                // discover_all() is synchronous USB enumeration, so it does
                // block the runtime thread briefly. It returns a Vec rather
                // than a Result, so a dead or absent bus yields an empty
                // list rather than an error.
                match crate::drivers::usb_printer::UsbReceiptPrinter::discover_all()
                    .into_iter()
                    .next()
                {
                    Some(found) => {
                        let driver = Arc::new(found);
                        registry.register_printer(&printer.id, driver.clone()).await;
                        registry
                            .register_cash_drawer(
                                &format!("drawer:kick:{}", printer.id),
                                Arc::new(PrinterKickCashDrawer::new_pin2(driver)),
                            )
                            .await;
                        report.registered.push(key);
                    }
                    // Nothing plugged in is a normal state, not a fault.
                    None => report.skipped.push(key),
                }
            }
            Connection::Serial { port, baud } => {
                registry
                    .register_serial_printer(&printer.id, port, *baud, printer.info.clone())
                    .await;
                report.registered.push(key);
            }
            Connection::Bluetooth { port } => {
                registry
                    .register_bluetooth_printer(
                        &printer.id,
                        port,
                        DEFAULT_BAUD,
                        printer.info.clone(),
                    )
                    .await;
                report.registered.push(key);
            }
            Connection::Network { addr } => {
                registry
                    .register_tcp_printer(&printer.id, addr, printer.info.clone())
                    .await;
                report.registered.push(key);
            }
        }
    }

    for display in &config.displays {
        let key = format!("display:{}", display.id);
        if display.port.trim().is_empty() {
            report.skipped.push(key);
            continue;
        }
        registry
            .register_serial_display(&display.id, &display.port, display.info.clone())
            .await;
        report.registered.push(key);
    }

    for drawer in &config.drawers {
        let key = format!("drawer:{}", drawer.id);
        if drawer.port.trim().is_empty() {
            report.skipped.push(key);
            continue;
        }
        registry
            .register_serial_drawer(&drawer.id, &drawer.port, drawer.info.clone())
            .await;
        report.registered.push(key);
    }

    for terminal in &config.terminals {
        let key = format!("terminal:{}", terminal.id);
        match &terminal.connection {
            TerminalConnection::Wired { port, baud } if !port.trim().is_empty() => {
                registry
                    .register_wired_terminal(
                        &terminal.id,
                        port.trim(),
                        if *baud == 0 {
                            crate::drivers::edc::wired::DEFAULT_BAUD
                        } else {
                            *baud
                        },
                        terminal.info.clone(),
                    )
                    .await;
                report.registered.push(key);
            }
            TerminalConnection::Wireless { target } if !target.address().trim().is_empty() => {
                registry
                    .register_wireless_terminal(&terminal.id, target.clone(), terminal.info.clone())
                    .await;
                report.registered.push(key);
            }
            _ => report.skipped.push(key),
        }
    }

    if config.autodetect_scanners {
        // Enumerate and bind every attached scanner. Reported per device so
        // the startup log says what the register actually picked up rather
        // than a bare "autodetect ran" — the whole reason this campaign
        // started was a registry whose contents nobody could see.
        for id in registry.discover_scanners().await {
            report.registered.push(id);
        }
    }

    report
}

#[cfg(test)]
#[path = "bootstrap_tests.rs"]
mod tests;
