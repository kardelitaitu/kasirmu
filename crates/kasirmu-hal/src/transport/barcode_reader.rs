/*
last audited 2026-11-XX by debt-agent (O-M42)
crate: kasirmu-hal | status: SAFE | lint: CLEAN
findings: single buffered read loop replacing the one-byte-per-read loops in
serial_scanner.rs and bt_scanner.rs. No unsafe, no panic paths outside the
documented expect-free code; the cap makes the retained remainder bounded.
next: none | perf: 64-byte reads; a 13-char barcode is one read() not thirteen
*/
//! Buffered barcode read loop shared by the serial and Bluetooth SPP barcode
//! scanner drivers.
//!
//! Both drivers poll a `serialport::SerialPort` from a blocking thread. This
//! module is the whole of that work: read CHUNKS (not one byte per `read()`),
//! accumulate until a terminator, and return.
//!
//! ## Invariants
//!
//! - **One read is all you get.** A single `read()` returning `n > 0` bytes
//!   is everything available; nothing waits for the 64-byte buffer to fill.
//! - **The terminator is CR or LF.** Both end a barcode, so a trailing `CR LF`
//!   yields the code once (a terminator at the start of an empty code is
//!   skipped, as the byte-at-a-time loop did).
//! - **The remainder is RETAINED.** Bytes that arrive in the same `read()` as
//!   a terminator belong to a LATER barcode, so they stay in
//!   [`BarcodeReader`] and are returned by the next `poll`. The old
//!   one-byte-per-read loop never had a remainder; a chunked read does, and
//!   dropping it would silently swallow a barcode bound tightly behind another.
//! - **Read errors and `n == 0` end the poll.** Whatever was accumulated is
//!   returned (trimmed); with nothing accumulated the poll yields `None`.
//!   Unchanged from the byte-at-a-time loop.
//! - **Bounded.** At most [`MAX_BARCODE_LEN`] bytes are held in total (current
//!   code plus retained remainder), so a silent port cannot grow the buffer.

use std::collections::VecDeque;

use crate::error::HalError;
use crate::types::Barcode;

/// Maximum length of a single scanned barcode buffer (1024 bytes) to bound memory.
pub const MAX_BARCODE_LEN: usize = 1024;

/// Size of the chunk handed to each blocking `read()`.
///
/// A 13-character barcode arrives in one `read()` at this size, not thirteen.
pub const READ_CHUNK: usize = 64;

/// The two characters a barcode scanner appends to mark end-of-code.
const TERMINATORS: &[u8] = b"\r\n";

fn is_terminator(byte: u8) -> bool {
    TERMINATORS.contains(&byte)
}

/// Buffered state for one barcode-scanner port.
///
/// Owned by the driver and guarded by the same lock as the port: a retained
/// remainder belongs to the NEXT poll of that same port, so the two must not
/// be separated.
#[derive(Default)]
pub struct BarcodeReader {
    /// Bytes already read off the port that belong to the next barcode.
    pending: VecDeque<u8>,
    /// The code currently being assembled.
    current: Vec<u8>,
}

impl BarcodeReader {
    /// Create an empty reader.
    pub fn new() -> Self {
        Self::default()
    }

    /// Bytes held for the next poll (current code plus retained remainder).
    ///
    /// NOT `#[cfg(test)]`. This was gated as test-only and called from the read
    /// loop at two sites, which made `cargo check -p kasirmu-hal` fail while
    /// `cargo test -p kasirmu-hal` passed: the test build sets `cfg(test)`, so
    /// the definition existed there and the error only appeared in the
    /// non-test build. That is the worst shape of build breakage — green in the
    /// command people run while iterating, red in the one CI runs.
    pub(crate) fn buffered_bytes(&self) -> usize {
        self.current.len() + self.pending.len()
    }

    /// Return the next barcode read from `port` within `timeout_ms`.
    ///
    /// Blocks on the port until a terminator, a read error, `n == 0`, or the
    /// deadline is reached, and blocks no longer than that deadline.
    pub fn next_barcode(
        &mut self,
        port: &mut dyn serialport::SerialPort,
        timeout_ms: u32,
    ) -> Result<Option<Barcode>, HalError> {
        self.next_barcode_capped(port, timeout_ms, MAX_BARCODE_LEN)
    }

    /// [`BarcodeReader::next_barcode`] with an explicit buffer cap.
    ///
    /// The cap is a parameter so the terminator / remainder rules can be
    /// pinned by tests without moving a kilobyte through a mock port.
    pub(crate) fn next_barcode_capped(
        &mut self,
        port: &mut dyn serialport::SerialPort,
        timeout_ms: u32,
        max_len: usize,
    ) -> Result<Option<Barcode>, HalError> {
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms as u64);

        // A retained remainder may already hold a complete barcode: serve it
        // before touching the port, so the second half of a split burst comes
        // out of the very next poll even under a zero timeout.
        if let Some(code) = self.scan_pending(max_len) {
            return Ok(Some(code));
        }

        loop {
            if std::time::Instant::now() >= deadline {
                return Ok(self.flush_if_any());
            }

            let room = max_len.saturating_sub(self.buffered_bytes());
            if room == 0 {
                return Ok(Some(self.take_current()));
            }

            let mut chunk = [0u8; READ_CHUNK];
            let to_read = room.min(READ_CHUNK);
            match port.read(&mut chunk[..to_read]) {
                // n == 0 means nothing was available in this slice of time —
                // a would-block (the port's read timeout expired) or EOF; the
                // two are not distinguishable here.
                //
                // A HALF-READ CODE MUST SURVIVE IT. A barcode whose terminator
                // has not arrived yet is the normal case when the bytes trail
                // in, so a would-block keeps the partial code buffered and the
                // loop returns to the deadline check instead of handing the
                // prefix back as if it were whole. With nothing buffered there
                // is nothing to wait for, so the poll ends at once — which is
                // also what a long n == 0 / EOF loop would otherwise busy-spin
                // on, since no bytes are coming.
                Ok(0) => {
                    if self.buffered_bytes() == 0 {
                        return Ok(None);
                    }
                }
                // A hard error is not a gap: hand over what was read.
                Err(_) => {
                    return Ok(self.flush_if_any());
                }
                Ok(n) => {
                    let n = n.min(to_read);
                    self.pending.extend(chunk[..n].iter().copied());
                    if let Some(code) = self.scan_pending(max_len) {
                        return Ok(Some(code));
                    }
                }
            }
        }
    }

    /// Move bytes from `pending` into `current`, stopping at a terminator or
    /// when the buffer holds a full code.
    ///
    /// Returns the completed barcode; anything after its terminator stays in
    /// `pending` for the next call.
    fn scan_pending(&mut self, max_len: usize) -> Option<Barcode> {
        while let Some(&byte) = self.pending.front() {
            if self.current.len() >= max_len {
                return None;
            }
            self.pending.pop_front();
            if is_terminator(byte) {
                if self.current.is_empty() {
                    continue;
                }
                return Some(self.take_current());
            }
            self.current.push(byte);
        }
        None
    }

    fn take_current(&mut self) -> Barcode {
        let code = String::from_utf8_lossy(&self.current).trim().to_owned();
        self.current.clear();
        Barcode::new(code)
    }

    fn flush_if_any(&mut self) -> Option<Barcode> {
        if self.current.is_empty() {
            None
        } else {
            Some(self.take_current())
        }
    }
}

#[cfg(test)]
#[path = "barcode_reader_tests.rs"]
mod tests;
