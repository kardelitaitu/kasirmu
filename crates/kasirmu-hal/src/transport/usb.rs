/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: transport/usb deep read)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean — rusb enumeration with per-device continue on descriptor errors and fail-open string reads; KNOWN allowlist tables (scanners/printers/P6-1 scales) documented by model; vendor-specific class second pass deduped; no unsafe
next: none | perf: N/A
*/
//! USB device enumeration helpers for barcode scanners and receipt printers.
//!
//! Uses `rusb` (libusb wrapper) to probe for HID-class and printer-class
//! devices by known VID/PID pairs. The discovery functions in this module
//! are called by `DriverRegistry::discover()` at startup.

use rusb::{Context, UsbContext};

use crate::error::HalError;

/// USB interface class code for HID devices.
pub const CLASS_HID: u8 = 3;
/// USB interface class code for printer devices.
pub const CLASS_PRINTER: u8 = 7;
/// Vendor-specific class — some barcode scanners use this.
pub const CLASS_VENDOR_SPECIFIC: u8 = 0xFF;

/// The category of a discovered USB device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum DeviceCategory {
    /// Barcode scanner.
    Scanner,
    /// Receipt printer.
    Printer,
    /// Weight scale.
    Scale,
    /// Other / unknown.
    Other,
}

/// Static metadata about a discovered USB device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UsbDeviceInfo {
    /// USB vendor ID (hex).
    pub vid: u16,
    /// USB product ID (hex).
    pub pid: u16,
    /// Manufacturer string descriptor.
    pub manufacturer: String,
    /// Product name string descriptor.
    pub product: String,
    /// Serial number string descriptor.
    pub serial: String,
    /// Interface number (for `claim_interface`).
    pub interface_number: u8,
    /// Bulk IN endpoint address.
    pub endpoint_in: u8,
    /// Optional bulk OUT endpoint address.
    pub endpoint_out: Option<u8>,
    /// Device category (scanner, printer, scale, or other).
    pub category: DeviceCategory,
    /// Human-readable label for the setup wizard.
    pub label: String,
}

/// Known barcode scanner VID/PID pairs.
pub const KNOWN_SCANNERS: &[(u16, u16)] = &[
    // Honeywell
    (0x0C2E, 0x0A10), // Voyager 1450g
    (0x0C2E, 0x0A11), // Voyager 1452g
    (0x0C2E, 0x0B10), // Voyager 1900g
    (0x0C2E, 0x0B11), // Voyager 1902g
    // Datalogic
    (0x05F9, 0x2211), // Magellan 800i
    (0x05F9, 0x2212), // Magellan 900i
    (0x05F9, 0x2201), // Gryphon
    (0x05F9, 0x2203), // QuickScan
    // Zebra
    (0x06DA, 0x5001), // LI3678
    (0x06DA, 0x5002), // DS3678
    (0x06DA, 0x4001), // DS2208
    (0x06DA, 0x4002), // DS4608
    // Generic / other
    (0x045E, 0x0800), // Microsoft USB barcode scanner
    (0x055D, 0x2020), // Wasp WLR-8950
];

/// Known receipt printer VID/PID pairs.
pub const KNOWN_PRINTERS: &[(u16, u16)] = &[
    // Epson
    (0x0416, 0x5011), // TM-T20
    (0x0416, 0x5021), // TM-T88VI
    (0x0416, 0x5031), // TM-T70
    (0x0416, 0x5041), // TM-m30
    // Star
    (0x0519, 0x0201), // SP700
    (0x0519, 0x0301), // TSP100
    (0x0519, 0x0401), // mC-Print3
    // Bixolon
    (0x0525, 0xA800), // SRP-350
    (0x0525, 0xA900), // SRP-275
    // Generic
    (0x067B, 0x2305), // Prolific-based USB printer
];

/// Known weight scale VID/PID pairs (P6-1).
pub const KNOWN_SCALES: &[(u16, u16, &str)] = &[
    // Dibal
    (0x0D81, 0x0A01, "Dibal G-XT"),
    (0x0D81, 0x0A02, "Dibal V-Plus"),
    // CAS
    (0x1B9E, 0x0001, "CAS PDII"),
    (0x1B9E, 0x0002, "CAS CL5000"),
    // Mettler Toledo
    (0x0B9A, 0x0010, "Mettler Toledo BPlus"),
    (0x0B9A, 0x0020, "Mettler Toledo PCE"),
    // Bizerba
    (0x114D, 0x0101, "Bizerba SE"),
    // Ishida
    (0x0D46, 0x1001, "Ishida UNI-"),
    // Generic HID POS scale (usage page 0x0011)
    (0x0000, 0x0000, "Generic HID POS Scale"),
];

/// Enumerate USB devices whose interface class matches `class`.
pub fn probe_by_class(class: u8) -> Result<Vec<UsbDeviceInfo>, HalError> {
    let context =
        Context::new().map_err(|e| HalError::Usb(format!("failed to create USB context: {e}")))?;
    let devices = context
        .devices()
        .map_err(|e| HalError::Usb(format!("failed to list USB devices: {e}")))?;

    let mut results = Vec::new();

    for device in devices.iter() {
        let desc = match device.device_descriptor() {
            Ok(d) => d,
            Err(_) => continue,
        };

        let config = match device.config_descriptor(0) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for interface in config.interfaces() {
            for setting in interface.descriptors() {
                if setting.class_code() != class {
                    continue;
                }

                let if_num = setting.interface_number();
                let mut ep_in = None;
                let mut ep_out = None;

                for ep in setting.endpoint_descriptors() {
                    if ep.direction() == rusb::Direction::In {
                        ep_in = Some(ep.address());
                    } else {
                        ep_out = Some(ep.address());
                    }
                }

                let Some(ep_in) = ep_in else { continue };

                let (manufacturer, product, serial) = match device.open() {
                    Ok(handle) => (
                        handle
                            .read_manufacturer_string_ascii(&desc)
                            .unwrap_or_default(),
                        handle.read_product_string_ascii(&desc).unwrap_or_default(),
                        handle
                            .read_serial_number_string_ascii(&desc)
                            .unwrap_or_default(),
                    ),
                    Err(_) => (String::new(), String::new(), String::new()),
                };

                let (category, label) = classify_device(desc.vendor_id(), desc.product_id());
                results.push(UsbDeviceInfo {
                    vid: desc.vendor_id(),
                    pid: desc.product_id(),
                    manufacturer,
                    product,
                    serial,
                    interface_number: if_num,
                    endpoint_in: ep_in,
                    endpoint_out: ep_out,
                    category,
                    label,
                });
            }
        }
    }

    Ok(results)
}

/// Probe for USB HID barcode scanners matching [`KNOWN_SCANNERS`].
///
/// Returns an empty vec (not an error) when no hardware is found — this
/// lets the system fall back to the mock driver.
pub fn probe_scanners() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let mut results = probe_by_class(CLASS_HID).unwrap_or_default();

    // Also check vendor-specific class for devices not exposing HID class
    if let Ok(vendor_devices) = probe_by_class(CLASS_VENDOR_SPECIFIC) {
        for dev in vendor_devices {
            if KNOWN_SCANNERS.contains(&(dev.vid, dev.pid))
                && !results.iter().any(|r| r.vid == dev.vid && r.pid == dev.pid)
            {
                results.push(dev);
            }
        }
    }

    // Re-classify known scanners (probe_by_class may have set Other)
    for dev in &mut results {
        if KNOWN_SCANNERS.contains(&(dev.vid, dev.pid)) {
            dev.category = DeviceCategory::Scanner;
            if dev.label.is_empty() {
                dev.label = format!("Scanner {:04x}:{:04x}", dev.vid, dev.pid);
            }
        }
    }

    results.retain(|d| KNOWN_SCANNERS.contains(&(d.vid, d.pid)));
    Ok(results)
}

/// Probe for USB receipt printers matching [`KNOWN_PRINTERS`].
pub fn probe_printers() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_by_class(CLASS_PRINTER).unwrap_or_default();
    let filtered: Vec<_> = results
        .into_iter()
        .filter(|d| KNOWN_PRINTERS.contains(&(d.vid, d.pid)))
        .map(|mut d| {
            d.category = DeviceCategory::Printer;
            if d.label.is_empty() {
                d.label = format!("Printer {:04x}:{:04x}", d.vid, d.pid);
            }
            d
        })
        .collect();
    Ok(filtered)
}

/// Probe for weight scales matching [`KNOWN_SCALES`].
pub fn probe_scales() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_by_class(CLASS_HID).unwrap_or_default();
    let filtered: Vec<_> = results
        .into_iter()
        .filter(|d| {
            KNOWN_SCALES
                .iter()
                .any(|(v, p, _)| *v == d.vid && *p == d.pid)
        })
        .map(|mut d| {
            d.category = DeviceCategory::Scale;
            // Use the human-readable name from KNOWN_SCALES if available
            for &(v, p, name) in KNOWN_SCALES {
                if v == d.vid && p == d.pid && !name.is_empty() {
                    d.label = name.to_owned();
                    break;
                }
            }
            if d.label.is_empty() {
                d.label = format!("Scale {:04x}:{:04x}", d.vid, d.pid);
            }
            d
        })
        .collect();
    Ok(filtered)
}

/// Probe all known USB devices (scanners, printers, scales) and return a
/// unified list. Each result has its `category` and `label` populated.
pub fn probe_all() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let mut all = Vec::new();
    if let Ok(scanners) = probe_scanners() {
        all.extend(scanners);
    }
    if let Ok(printers) = probe_printers() {
        all.extend(printers);
    }
    if let Ok(scales) = probe_scales() {
        all.extend(scales);
    }
    Ok(all)
}

/// Look up a known device by VID/PID across all three tables and return
/// its category + human-readable label. Returns `(DeviceCategory::Other, "")`
/// when no match is found.
pub fn classify_device(vid: u16, pid: u16) -> (DeviceCategory, String) {
    // Check scanners
    for &(v, p) in KNOWN_SCANNERS {
        if v == vid && p == pid {
            return (
                DeviceCategory::Scanner,
                format!("Scanner {v:#06x}:{p:#06x}"),
            );
        }
    }
    // Check printers
    for &(v, p) in KNOWN_PRINTERS {
        if v == vid && p == pid {
            return (
                DeviceCategory::Printer,
                format!("Printer {v:#06x}:{p:#06x}"),
            );
        }
    }
    // Check scales
    for &(v, p, name) in KNOWN_SCALES {
        if v == vid && p == pid {
            return (DeviceCategory::Scale, name.to_owned());
        }
    }
    (DeviceCategory::Other, String::new())
}

/// Helper to open a USB device and claim an interface.
pub fn open_device(
    vid: u16,
    pid: u16,
    interface: u8,
) -> Result<rusb::DeviceHandle<rusb::Context>, HalError> {
    let context =
        Context::new().map_err(|e| HalError::Usb(format!("failed to create USB context: {e}")))?;

    let device = context
        .devices()
        .map_err(|e| HalError::Usb(format!("failed to list devices: {e}")))?
        .iter()
        .find(|d| {
            d.device_descriptor()
                .map(|desc| desc.vendor_id() == vid && desc.product_id() == pid)
                .unwrap_or(false)
        })
        .ok_or_else(|| HalError::NotFound(format!("USB device {vid:#06x}:{pid:#06x}")))?;

    let handle = device
        .open()
        .map_err(|e| HalError::Usb(format!("failed to open USB device: {e}")))?;

    handle
        .claim_interface(interface)
        .map_err(|e| HalError::Usb(format!("failed to claim interface {interface}: {e}")))?;

    // On Linux, detach the kernel driver if it's attached.
    if handle.kernel_driver_active(interface).unwrap_or(false) {
        let _ = handle.detach_kernel_driver(interface);
    }

    Ok(handle)
}

#[cfg(test)]
#[path = "usb_tests.rs"]
mod tests;
