/*
last audited 25-07-26 by RSA-Agent (kasirmu-hal slice A: transport/usb deep read)
crate: kasirmu-hal | status: SAFE | lint: CLEAN
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

/// Process-wide `rusb` context.
///
/// A fresh `rusb::Context` costs a `libusb_init` + `libusb_exit` pair, which
/// re-initialises the whole backend — it is the expensive part of a connect,
/// not the enumeration that follows. `rusb::Context` is `Clone + Send + Sync`
/// (it is an `Arc` around the raw handle), and `libusb` is documented as safe
/// to use from multiple threads against one context, so one context is shared
/// for the life of the process and never dropped.
static USB_CONTEXT: std::sync::OnceLock<Context> = std::sync::OnceLock::new();

/// Borrow the process-wide USB context, creating it on first use.
fn shared_context() -> Result<&'static Context, HalError> {
    if let Some(context) = USB_CONTEXT.get() {
        return Ok(context);
    }
    let context =
        Context::new().map_err(|e| HalError::Usb(format!("failed to create USB context: {e}")))?;
    // If another thread won the race, the loser's context is simply dropped.
    let _ = USB_CONTEXT.set(context);
    USB_CONTEXT
        .get()
        .ok_or_else(|| HalError::Usb("failed to create USB context".to_owned()))
}

/// Enumerate USB devices whose interface class matches `class`.
///
/// This is a thin filter over `probe_classes` and walks the bus once.
pub fn probe_by_class(class: u8) -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_classes(&[class]).unwrap_or_default();
    Ok(results.into_iter().map(|c| c.info).collect())
}

/// Enumerate USB devices having at least one interface whose class is in
/// `classes`, with the bus walked exactly ONCE.
///
/// Every interface setting is visited in the order libusb reports it, so the
/// result is the concatenation of what one per-class walk would have produced
/// for each class. Each kept interface opens its device to read the three
/// string descriptors — the expensive part of enumeration — so callers that
/// need several classes must call this once, not once per class.
///
/// Only the initial context creation / device-list failures are errors;
/// per-device and per-interface failures are skipped, as they always were.
pub(crate) fn probe_classes(classes: &[u8]) -> Result<Vec<Classified>, HalError> {
    let mut results = Vec::new();
    walk_bus(classes, &mut |class, info| {
        results.push(Classified { class, info })
    })?;
    Ok(results)
}

/// Visit every USB interface setting whose class is in `classes`, in bus
/// order, handing each one to `visit`.
///
/// This is the single bus walk. Splitting the walk from the accumulation lets
/// `probe_all` partition in memory with no extra enumeration and keeps the
/// per-device fail-soft behaviour in one place.
fn walk_bus(classes: &[u8], visit: &mut impl FnMut(u8, UsbDeviceInfo)) -> Result<(), HalError> {
    let context = shared_context()?;
    let devices = context
        .devices()
        .map_err(|e| HalError::Usb(format!("failed to list USB devices: {e}")))?;

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
                if !classes.contains(&setting.class_code()) {
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
                let class = setting.class_code();
                let info = UsbDeviceInfo {
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
                };
                visit(class, info);
            }
        }
    }

    Ok(())
}

/// One enumerated interface setting together with the class it matched on.
///
/// The class is not part of [`UsbDeviceInfo`] (that struct is public and
/// serde-stable), so the internal walk hands it back alongside the record and
/// the partition steps below can tell a vendor-specific scanner interface
/// from a HID one without re-walking the bus.
#[derive(Clone)]
pub(crate) struct Classified {
    class: u8,
    info: UsbDeviceInfo,
}

/// Interface classes `probe_scanners` looks at: HID first, then the
/// vendor-specific class some scanners expose instead.
const SCANNER_CLASSES: &[u8] = &[CLASS_HID, CLASS_VENDOR_SPECIFIC];
/// Interface classes `probe_printers` looks at.
const PRINTER_CLASSES: &[u8] = &[CLASS_PRINTER];
/// Interface classes `probe_scales` looks at.
const SCALE_CLASSES: &[u8] = &[CLASS_HID];

/// Partition an already-enumerated scanner-class list into scanner results.
fn scanners_from(enumerated: Vec<Classified>) -> Vec<UsbDeviceInfo> {
    // HID results first, in bus order; vendor-specific interfaces are kept in
    // a separate list so they can be appended AFTER all HID results — the
    // order the original two-walk implementation produced.
    let mut results: Vec<UsbDeviceInfo> = Vec::new();
    let mut vendor_results: Vec<UsbDeviceInfo> = Vec::new();

    for Classified { class, info } in enumerated {
        if class == CLASS_VENDOR_SPECIFIC {
            vendor_results.push(info);
        } else {
            results.push(info);
        }
    }

    // Also check vendor-specific class for devices not exposing HID class
    for dev in vendor_results {
        if KNOWN_SCANNERS.contains(&(dev.vid, dev.pid))
            && !results.iter().any(|r| r.vid == dev.vid && r.pid == dev.pid)
        {
            results.push(dev);
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
    results
}

/// Filter + label an already-enumerated printer-class list.
fn printers_from(enumerated: Vec<Classified>) -> Vec<UsbDeviceInfo> {
    let results: Vec<UsbDeviceInfo> = enumerated.into_iter().map(|c| c.info).collect();
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
    filtered
}

/// Filter + label an already-enumerated HID-class list.
fn scales_from(enumerated: Vec<Classified>) -> Vec<UsbDeviceInfo> {
    let results: Vec<UsbDeviceInfo> = enumerated.into_iter().map(|c| c.info).collect();
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
    filtered
}

/// Probe for USB HID barcode scanners matching [`KNOWN_SCANNERS`].
///
/// Returns an empty vec (not an error) when no hardware is found — this
/// lets the system fall back to the mock driver.
pub fn probe_scanners() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_classes(SCANNER_CLASSES).unwrap_or_default();
    Ok(scanners_from(results))
}

/// Probe for USB receipt printers matching [`KNOWN_PRINTERS`].
pub fn probe_printers() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_classes(PRINTER_CLASSES).unwrap_or_default();
    Ok(printers_from(results))
}

/// Probe for weight scales matching [`KNOWN_SCALES`].
pub fn probe_scales() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let results = probe_classes(SCALE_CLASSES).unwrap_or_default();
    Ok(scales_from(results))
}

/// Probe all known USB devices (scanners, printers, scales) and return a
/// unified list. Each result has its `category` and `label` populated.
///
/// The bus is walked ONCE — every interface of every relevant class is
/// collected — and the three categories are partitioned in memory afterwards.
/// The output is scanners, then printers, then scales: the same order, and
/// the same three lists, that calling each `probe_*` function in turn gave.
pub fn probe_all() -> Result<Vec<UsbDeviceInfo>, HalError> {
    let mut all = Vec::new();

    let enumerated =
        probe_classes(&[CLASS_HID, CLASS_VENDOR_SPECIFIC, CLASS_PRINTER]).unwrap_or_default();

    // Scanners only ever look at HID and vendor-specific interfaces, printers
    // only at printer-class ones; the HID list is shared with scales, as it
    // was when the two callers each enumerated the HID class.
    let mut hid: Vec<Classified> = Vec::new();
    let mut vendor: Vec<Classified> = Vec::new();
    let mut printer_class: Vec<Classified> = Vec::new();
    for c in enumerated {
        match c.class {
            CLASS_PRINTER => printer_class.push(c),
            CLASS_VENDOR_SPECIFIC => vendor.push(c),
            _ => hid.push(c),
        }
    }

    // Scanner order: all HID interfaces in bus order, then the vendor-specific
    // ones that `scanners_from` merges in.
    let mut scanner_input = Vec::with_capacity(hid.len() + vendor.len());
    scanner_input.extend(hid.iter().map(|c| Classified {
        class: c.class,
        info: c.info.clone(),
    }));
    scanner_input.extend(vendor);
    all.extend(scanners_from(scanner_input));

    all.extend(printers_from(printer_class));
    all.extend(scales_from(hid));

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
///
/// The enumeration this performs is fresh on EVERY call — the device list is
/// built, searched and dropped here, so a device that has been unplugged is
/// simply absent and yields [`HalError::NotFound`], never a stale-handle
/// failure. What is reused is the `libusb` context ([static `USB_CONTEXT`]),
/// which is the expensive `libusb_init` half of the old per-connect cost.
/// Replugging therefore works: nothing about the previous connection is kept.
pub fn open_device(
    vid: u16,
    pid: u16,
    interface: u8,
) -> Result<rusb::DeviceHandle<rusb::Context>, HalError> {
    let context = shared_context()?;

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
