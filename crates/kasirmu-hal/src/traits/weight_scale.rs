/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! `WeightScale` — the trait every weight-scale driver implements.
//!
//! Scale drivers read weight over USB HID POS (usage page `0x0011`).
//! The trait is synchronous because USB HID reads are blocking by
//! nature — callers should run them on a blocking threadpool.

use serde::{Deserialize, Serialize};

use crate::error::HalError;

/// A single weight reading from the scale.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightReading {
    /// Weight in grams.
    pub weight_grams: f64,
    /// Whether the scale reports the reading as stable.
    pub stable: bool,
}

/// Trait for USB HID weight scale drivers.
pub trait WeightScale: Send + Sync {
    /// Read the current weight from the scale.
    ///
    /// Returns a [`WeightReading`] on success, or a [`HalError`] if the
    /// device is disconnected, busy, or returns an invalid packet.
    fn read_weight(&self) -> Result<WeightReading, HalError>;

    /// Static device identity (vendor, model, serial).
    fn device_info(&self) -> crate::types::DeviceInfo;
}

#[cfg(test)]
#[path = "weight_scale_tests.rs"]
mod tests;
