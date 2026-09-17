/*
last audited 25-07-26 by RSA-Agent (oz-hal slice B: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unwrap/panic/unsafe, sibling tests per convention
next: none | perf: N/A
*/
//! Serial pole display driver (CD5220 / Emax protocol).
//!
//! Implements `CustomerDisplay` over a serial (RS-232) connection using
//! the de-facto CD5220 command set used by most POS pole displays:
//! EM-220, Epson DM-D, POS-X, APG, etc.
//!
//! ## Protocol reference
//!
//! | Action       | Command                        |
//! |--------------|--------------------------------|
//! | Clear screen | `ESC "Q"`                      |
//! | Write line 1 | `ESC "D" <text> <CR>`          |
//! | Write line 2 | `ESC "D" <text> <CR>`          |
//! | Cursor home  | `ESC "H"`                      |
//!
//! Typical settings: 9600 baud, 8 data bits, 1 stop bit, no parity.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::customer_display::{CustomerDisplay, DisplayContent};
use crate::transport::serial;
use crate::types::DeviceInfo;

/// Default baud rate for serial pole displays (CD5220 standard).
pub const DISPLAY_DEFAULT_BAUD: u32 = 9600;

/// The serial display is typically a 20-column × 2-line LCD/VFD.
pub const DISPLAY_COLS: usize = 20;

// ── CD5220 ESC/POS-like commands ──────────────────────────────────────

/// Clear the display and home the cursor.
const CMD_CLEAR: &[u8] = &[0x1B, b'Q'];
/// Move cursor to home position.
#[allow(dead_code)]
const CMD_HOME: &[u8] = &[0x1B, b'H'];
/// Write text at current cursor position — followed by `<text><CR>`.
const CMD_WRITE: &[u8] = &[0x1B, b'D'];

/// Build a "write line" command: `ESC D <text> \r`
fn write_line(line: &str) -> Vec<u8> {
    let mut buf = Vec::with_capacity(4 + line.len());
    buf.extend_from_slice(CMD_WRITE);
    // Truncate/pad to DISPLAY_COLS characters.
    let truncated: String = line.chars().take(DISPLAY_COLS).collect();
    buf.extend_from_slice(truncated.as_bytes());
    // Pad with spaces if shorter than DISPLAY_COLS.
    let pad_len = DISPLAY_COLS.saturating_sub(truncated.chars().count());
    buf.extend(std::iter::repeat_n(b' ', pad_len));
    buf.push(b'\r');
    buf
}

// ── Driver ────────────────────────────────────────────────────────────

/// A customer-facing pole display driven over serial (CD5220 protocol).
pub struct SerialCustomerDisplay {
    port_name: String,
    baud_rate: u32,
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    info: DeviceInfo,
}

impl SerialCustomerDisplay {
    /// Create a new serial pole display on the given port.
    pub fn new(port_name: impl Into<String>, baud_rate: u32, info: DeviceInfo) -> Self {
        Self {
            port_name: port_name.into(),
            baud_rate,
            port: Arc::new(Mutex::new(None)),
            info,
        }
    }

    /// Discover serial ports that could be pole displays.
    ///
    /// Returns a driver for every serial port matched via
    /// `crate::transport::serial::KNOWN_SERIAL_ADAPTERS`.
    pub fn discover_all() -> Vec<Self> {
        let ports = match serial::probe_ports(true) {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        ports
            .into_iter()
            .map(|p| {
                let info = DeviceInfo::new("SerialDisplay", &p.description, &p.port_name);
                Self::new(p.port_name, DISPLAY_DEFAULT_BAUD, info)
            })
            .collect()
    }
}

#[async_trait]
impl CustomerDisplay for SerialCustomerDisplay {
    async fn connect(&self) -> Result<Box<dyn CustomerDisplay>, HalError> {
        let mut guard = self.port.lock().await;
        if guard.is_some() {
            return Ok(Box::new(Self {
                port_name: self.port_name.clone(),
                baud_rate: self.baud_rate,
                port: self.port.clone(),
                info: self.info.clone(),
            }));
        }

        let mut port = serial::open_port(&self.port_name, self.baud_rate)
            .map_err(|e| HalError::NotFound(format!("display serial {0}: {e}", self.port_name)))?;

        port.set_timeout(std::time::Duration::from_millis(500))
            .map_err(|e| HalError::NotFound(format!("display timeout {0}: {e}", self.port_name)))?;

        *guard = Some(port);

        Ok(Box::new(Self {
            port_name: self.port_name.clone(),
            baud_rate: self.baud_rate,
            port: self.port.clone(),
            info: self.info.clone(),
        }))
    }

    async fn show(&self, content: &DisplayContent) -> Result<(), HalError> {
        let port_arc = self.port.clone();
        let line1 = content.line1.clone();
        let line2 = content.line2.clone();

        spawn_blocking(move || {
            let mut guard = port_arc.blocking_lock();
            let port = guard
                .as_mut()
                .ok_or_else(|| HalError::NotFound("display not connected".into()))?;

            // Clear, home, then write both lines.
            port.write_all(CMD_CLEAR).map_err(HalError::Io)?;
            port.write_all(&write_line(&line1)).map_err(HalError::Io)?;
            port.write_all(&write_line(&line2)).map_err(HalError::Io)?;

            Ok::<_, HalError>(())
        })
        .await
        .map_err(|e| HalError::Bluetooth(format!("display spawn join: {e}")))?
    }

    async fn clear(&self) -> Result<(), HalError> {
        let port_arc = self.port.clone();

        spawn_blocking(move || {
            let mut guard = port_arc.blocking_lock();
            let port = guard
                .as_mut()
                .ok_or_else(|| HalError::NotFound("display not connected".into()))?;

            port.write_all(CMD_CLEAR).map_err(HalError::Io)?;

            Ok::<_, HalError>(())
        })
        .await
        .map_err(|e| HalError::Bluetooth(format!("display spawn join: {e}")))?
    }

    async fn set_brightness(&self, _level: f32) -> Result<(), HalError> {
        // CD5220-compatible pole displays typically don't support
        // software brightness control.
        Err(HalError::Protocol("brightness not supported".into()))
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "serial_display_tests.rs"]
mod tests;
