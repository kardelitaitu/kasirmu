/*
last audited 31-08-26 by DSH-Agent (stub corrected)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: the driver is a stub and used to say otherwise. The struct doc claimed it "communicates with the scale over the HID POS usage page" while read_weight unconditionally returned an error and _vendor_id/_product_id were placeholders. It also reported NotFound, the same kind an unplugged device reports, so an operator was told to check a cable on a feature that was never written. Now Unsupported. Deliberately NOT wired into bootstrap::apply_config: read_scale_weight_scoped maps a missing scale to Ok(None) — the UI shows no weight — but a registered stub would make the same command return Err on every poll, turning a silent absence into a recurring error. Wiring is blocked on this driver, not on the config schema.
next: implement HID POS reads (rusb is already a dependency; a HID interrupt-endpoint read path is what usb_scanner.rs does) and only then add scale entries to HardwareConfig | perf: N/A
*/
//! USB HID weight scale driver — currently a stub.
//!
//! Declares [`HidWeightScale`] so the [`WeightScale`] trait has a named
//! production type and the registry, mocks and setup wizard all have
//! something concrete to hold. No device is opened: [`WeightScale::read_weight`]
//! always fails with [`HalError::Unsupported`], which is why the startup
//! bootstrap registers no scales and why wiring one would be a regression
//! rather than a feature.

use crate::error::HalError;
use crate::traits::weight_scale::{WeightReading, WeightScale};

/// A USB HID weight scale.
///
/// **Stub.** Holds the identity a configured scale would need but opens
/// nothing and reads nothing; see the module doc for why it stays out of the
/// startup bootstrap.
pub struct HidWeightScale {
    device_path: String,
    /// Placeholder for a future HID device handle.
    _vendor_id: u16,
    _product_id: u16,
}

impl HidWeightScale {
    /// Create a new `HidWeightScale`.
    ///
    /// `vendor_id` and `product_id` identify the USB device.
    /// `device_path` is the platform-specific path (e.g. `/dev/hidraw0`
    /// or `COM3`).
    pub fn new(vendor_id: u16, product_id: u16, device_path: String) -> Self {
        Self {
            device_path,
            _vendor_id: vendor_id,
            _product_id: product_id,
        }
    }

    /// The configured device path.
    pub fn device_path(&self) -> &str {
        &self.device_path
    }
}

impl WeightScale for HidWeightScale {
    fn read_weight(&self) -> Result<WeightReading, HalError> {
        // Not implemented. A real version would open the HID device at
        // self.device_path, listen for reports on the HID POS scale usage
        // page (0x0001:0x0011), and parse the weight and stability fields.
        //
        // Reported as Unsupported rather than NotFound on purpose. NotFound
        // is what an unplugged device returns, and the two need different
        // answers from an operator: "check the cable" versus "this build
        // cannot read a scale at all, whatever the cable is doing". The
        // weight command propagates either way, so the sub_kind is the only
        // place the distinction survives to the UI.
        Err(HalError::Unsupported(format!(
            "weight scale reading is not implemented (device {})",
            self.device_path
        )))
    }

    fn device_info(&self) -> crate::types::DeviceInfo {
        crate::types::DeviceInfo::new(
            format!("{:04x}", self._vendor_id),
            format!("{:04x}", self._product_id),
            &self.device_path,
        )
    }
}

#[cfg(test)]
#[path = "scale_tests.rs"]
mod tests;
