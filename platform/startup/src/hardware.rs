/*
last audited 31-08-26 by DSH-Agent (hardware bootstrap, new)
crate: platform-startup | status: SAFE | lint: CLEAN
findings: the missing write side of the HAL registry. Both clients built an empty DriverRegistry and nothing ever registered into it, so every hardware command resolved None while the setup wizard could still list devices. Reads the profile the UI already saves; adds no new configuration surface. Scanners are registered by enumeration (autodetect_scanners), not from the profile: start_scanner_scoped does look a scanner up by id and useBarcodeScanner.ts auto-detects with scanners[0], so an earlier note here claiming "nothing looks a scanner up by id" was wrong and left barcode input dead in both clients. Scales stay unwired (drivers/scale.rs is a stub whose read_weight always fails, so registering one would turn the weight command's clean Ok(None) into an error on every poll; TerminalProfile also records a device path where HidWeightScale wants a vendor/product pair). Card terminals now come from edc_terminals via register_card_terminals; a wired row gets DEFAULT_BAUD because the table records no baud column.
next: implement HID POS reads in drivers/scale.rs before wiring any scale; baud_rate + is_default columns on edc_terminals | perf: one indexed profile read, one ordered terminal read
*/
//! Startup hardware registration — the missing write side of the HAL registry.
//!
//! The UI already lets an operator save a [`TerminalProfile`] describing
//! their printer, kitchen printer, scanner and scale, and an `edc_terminals`
//! table holds their card terminals. Until now nothing read either back into
//! drivers, so `AppState` held an empty [`DriverRegistry`] and every hardware
//! command resolved `None`.
//!
//! [`load_profile`] reads the profile the same way the settings command
//! does — database first, JSON file as fallback — and
//! [`register_hardware`] maps it onto [`HardwareConfig`] and applies it.
//! [`register_card_terminals`] does the same for terminal rows. Both
//! mappings are pure where they can be, so they are testable without a
//! device.

use std::path::Path;

use platform_core::terminal_profile::TerminalProfile;
use rusqlite::Connection;

use kasirmu_hal::DriverRegistry;
use kasirmu_hal::bootstrap::{
    BootstrapReport, Connection as HalConnection, HardwareConfig, PrinterConfig, TerminalConfig,
};
use kasirmu_hal::drivers::edc::WirelessTarget;
use kasirmu_hal::types::DeviceInfo;

use kasirmu_core::db::edc_terminals::EdcTerminalConfig;

/// Registry id the main receipt printer is looked up under.
///
/// `run_print_receipt_inner` asks for exactly this string; binding the
/// configured printer to any other id leaves receipt printing broken.
pub const MAIN_PRINTER_ID: &str = "default";

/// Registry id the kitchen display system looks its printer up under.
pub const KITCHEN_PRINTER_ID: &str = "kitchen";

/// Describe a configured device for logs and the setup wizard.
///
/// The profile records addressing, not identity, so the transport and its
/// address stand in for vendor and model.
fn configured_info(kind: &str, address: &str) -> DeviceInfo {
    if address.is_empty() {
        DeviceInfo::new("configured", kind, "")
    } else {
        DeviceInfo::new("configured", kind, address)
    }
}

/// Map a saved terminal profile onto the HAL's own hardware description.
///
/// Only what the profile can express becomes a driver:
///
/// | Profile field | Becomes |
/// |---|---|
/// | `printer_connection` + `printer_device_path` | printer under [`MAIN_PRINTER_ID`] |
/// | `kitchen_printer_connection` + path | printer under [`KITCHEN_PRINTER_ID`] |
/// | `scanner_*` | nothing directly — the stored id cannot build a driver, which needs a `SerialPortInfo` from enumeration. Scanners are registered by autodetect instead; see [`HardwareConfig::autodetect_scanners`] |
/// | `scale_*` | nothing — see [`HardwareConfig`] docs |
///
/// A `"disabled"`, `"none"` or `"auto"` connection yields no entry rather
/// than a placeholder, so an unconfigured kitchen printer does not shadow a
/// working one.
#[must_use]
pub fn config_from_profile(profile: &TerminalProfile) -> HardwareConfig {
    let mut printers = Vec::new();

    if let Some(connection) =
        HalConnection::parse(&profile.printer_connection, &profile.printer_device_path, 0)
    {
        printers.push(PrinterConfig {
            id: MAIN_PRINTER_ID.to_string(),
            info: configured_info("printer", connection.address().unwrap_or("")),
            connection,
        });
    }

    if let Some(connection) = HalConnection::parse(
        &profile.kitchen_printer_connection,
        &profile.kitchen_printer_device_path,
        0,
    ) {
        printers.push(PrinterConfig {
            id: KITCHEN_PRINTER_ID.to_string(),
            info: configured_info("kitchen printer", connection.address().unwrap_or("")),
            connection,
        });
    }

    HardwareConfig {
        printers,
        // Scanners are the exception to "the operator names the device":
        // the UI auto-detects with scanners[0] and never asks, and a
        // discovery-minted id round-trips through the same call that listed
        // it. See HardwareConfig::autodetect_scanners.
        autodetect_scanners: true,
        ..HardwareConfig::default()
    }
}

/// Load the profile for `terminal_id`, preferring the database.
///
/// Mirrors the read order of the `get_hardware_settings` command:
/// `hardware_profiles.profile_json` first, then the crash-safe JSON file
/// under `base_dir/terminal_profiles/`. Returns `None` when neither has a
/// parsable row, which the caller treats as "nothing to register" rather
/// than an error — a first run has no profile yet.
#[must_use]
pub fn load_profile(
    conn: &Connection,
    terminal_id: &str,
    base_dir: &Path,
) -> Option<TerminalProfile> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT profile_json FROM hardware_profiles WHERE terminal_id = ?1",
            rusqlite::params![terminal_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(json) = stored {
        match serde_json::from_str::<TerminalProfile>(&json) {
            Ok(profile) => return Some(profile),
            Err(e) => tracing::warn!(
                terminal_id,
                error = %e,
                "hardware profile in DB is unparsable; falling back to the JSON file"
            ),
        }
    }

    let path = TerminalProfile::profile_path(base_dir, terminal_id);
    match TerminalProfile::load(&path) {
        Ok(profile) => profile,
        Err(e) => {
            tracing::warn!(
                terminal_id,
                error = %e,
                "could not read the hardware profile file"
            );
            None
        }
    }
}

/// Register every device the profile describes.
///
/// Does not call [`DriverRegistry::discover`]: discovery binds hardware-
/// derived ids and probes devices the operator never named. The two are
/// complementary and the caller decides whether to also discover.
pub async fn register_hardware(
    registry: &DriverRegistry,
    profile: &TerminalProfile,
) -> BootstrapReport {
    kasirmu_hal::apply_config(registry, &config_from_profile(profile)).await
}

/// The registry id the EDC commands resolve when no terminal is named.
///
/// Mirrors `oz_pos_app::commands::edc::DEFAULT_TERMINAL_ID`; duplicated
/// because platform-startup must not depend on an app crate. A desktop test
/// asserts the two stay equal.
pub const DEFAULT_TERMINAL_ID: &str = "default";

/// Map a stored row onto the HAL's terminal connection.
///
/// A wired row needs a baud rate that `edc_terminals` does not record, so it
/// gets [`kasirmu_hal::drivers::edc::wired::DEFAULT_BAUD`]. Adding a `baud_rate`
/// column is the known follow-up; inferring one from the address would be
/// worse than using the documented default.
fn terminal_connection(
    row: &EdcTerminalConfig,
) -> Option<kasirmu_hal::bootstrap::TerminalConnection> {
    use kasirmu_hal::bootstrap::TerminalConnection;
    match (
        row.connection_type.as_str(),
        row.transport.as_str(),
        row.address.trim(),
    ) {
        (_, _, "") => None,
        ("wired", "serial" | "usb", address) => Some(TerminalConnection::Wired {
            port: address.to_owned(),
            baud: kasirmu_hal::drivers::edc::wired::DEFAULT_BAUD,
        }),
        ("wireless", "bluetooth", address) => Some(TerminalConnection::Wireless {
            target: WirelessTarget::Bluetooth(address.to_owned()),
        }),
        ("wireless", "tcp", address) => Some(TerminalConnection::Wireless {
            target: WirelessTarget::Network(address.to_owned()),
        }),
        _ => None,
    }
}

/// Register every card terminal the operator configured.
///
/// Each row is registered under its own database id, and the first row in
/// the slice is additionally bound to [`DEFAULT_TERMINAL_ID`] — the string
/// the EDC commands look up. Without that alias the commands still resolve
/// `None`, because a UUID row id is not the name `terminal("default")` asks
/// for. The alias is interim, not design: `edc_terminals` has no
/// `is_default` column, so "which terminal is this register's" is answered
/// by creation order until the column exists or the commands take a
/// `terminal_id`. Callers must pass rows already ordered by
/// `list_active_edc_terminals()`, never `DriverRegistry::terminal_ids()`,
/// which iterates a `HashMap` and would make the choice vary per restart.
pub async fn register_card_terminals(
    registry: &DriverRegistry,
    rows: &[EdcTerminalConfig],
) -> BootstrapReport {
    let mut report = BootstrapReport::default();
    // Carries the identity alongside the connection so the alias registers
    // the same device, not rows[0] which may have been rejected.
    let mut default_terminal: Option<(kasirmu_hal::bootstrap::TerminalConnection, DeviceInfo)> =
        None;

    for row in rows {
        let Some(connection) = terminal_connection(row) else {
            report.rejected.push((
                format!("terminal:{}", row.id),
                format!(
                    "no HAL terminal driver for {} + {}",
                    row.connection_type, row.transport
                ),
            ));
            continue;
        };
        let info = DeviceInfo::new(
            row.vendor.clone().unwrap_or_else(|| "unknown".into()),
            row.model.clone().unwrap_or_else(|| "card".into()),
            &row.address,
        );
        // The first *registrable* row claims the default id, not merely the
        // first row: an unpairable row earlier in the table would otherwise
        // leave the register with no terminal at all.
        if default_terminal.is_none() {
            default_terminal = Some((connection.clone(), info.clone()));
        }

        let config = HardwareConfig {
            terminals: vec![TerminalConfig {
                id: row.id.clone(),
                connection,
                info,
            }],
            ..HardwareConfig::default()
        };
        merge(
            &mut report,
            kasirmu_hal::apply_config(registry, &config).await,
        );
    }

    if let Some((connection, info)) = default_terminal {
        let config = HardwareConfig {
            terminals: vec![TerminalConfig {
                id: DEFAULT_TERMINAL_ID.to_string(),
                connection,
                info,
            }],
            ..HardwareConfig::default()
        };
        merge(
            &mut report,
            kasirmu_hal::apply_config(registry, &config).await,
        );
    }

    report
}

/// Fold one device's report into the running total.
fn merge(into: &mut BootstrapReport, from: BootstrapReport) {
    into.registered.extend(from.registered);
    into.skipped.extend(from.skipped);
    into.rejected.extend(from.rejected);
}

#[cfg(test)]
#[path = "hardware_tests.rs"]
mod tests;
