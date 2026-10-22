use super::*;

use std::collections::VecDeque;
use std::io::{Error, ErrorKind};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serialport::{ClearBuffer, DataBits, FlowControl, Parity, SerialPort, StopBits};
use std::io;

/// What the next `read()` of a [`ScriptedPort`] should do.
enum Step {
    /// Hand back these bytes.
    Bytes(Vec<u8>),
    /// Return `Ok(0)` — would-block / EOF.
    WouldBlock,
    /// Return an `Err` — a dead port.
    Fail,
}

/// A `serialport::SerialPort` mock that replays scripted `read()` results.
///
/// When the script is exhausted the port returns `Ok(0)`, which is what a
/// real port does once its read timeout expires; a `WouldBlock` step does the
/// same but SLEEPS 5 ms first, like a port blocking until its timeout. `reads`
/// counts `read()` calls and `requested` records the buffer size each call
/// offered, so a test can prove the loop now offers 64 bytes rather than 1.
struct ScriptedPort {
    inner: Arc<PortState>,
}

#[derive(Default)]
struct PortState {
    script: StdMutex<VecDeque<Step>>,
    reads: AtomicUsize,
    requested: StdMutex<Vec<usize>>,
}

impl ScriptedPort {
    fn new(steps: Vec<Step>) -> Self {
        let state = PortState::default();
        *state.script.lock().unwrap() = steps.into();
        Self {
            inner: Arc::new(state),
        }
    }

    /// A second handle onto the same script, so a test can inspect the port
    /// after the driver has taken ownership of the original.
    fn probe(&self) -> ScriptedPort {
        ScriptedPort {
            inner: self.inner.clone(),
        }
    }

    fn read_count(&self) -> usize {
        self.inner.reads.load(Ordering::SeqCst)
    }

    fn requested_sizes(&self) -> Vec<usize> {
        self.inner.requested.lock().unwrap().clone()
    }
}

impl SerialPort for ScriptedPort {
    fn name(&self) -> Option<String> {
        Some("mock".to_owned())
    }

    fn baud_rate(&self) -> serialport::Result<u32> {
        Ok(9600)
    }

    fn data_bits(&self) -> serialport::Result<DataBits> {
        Ok(DataBits::Eight)
    }

    fn flow_control(&self) -> serialport::Result<FlowControl> {
        Ok(FlowControl::None)
    }

    fn parity(&self) -> serialport::Result<Parity> {
        Ok(Parity::None)
    }

    fn stop_bits(&self) -> serialport::Result<StopBits> {
        Ok(StopBits::One)
    }

    fn timeout(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn set_timeout(&mut self, _timeout: Duration) -> serialport::Result<()> {
        Ok(())
    }

    fn set_baud_rate(&mut self, _baud_rate: u32) -> serialport::Result<()> {
        Ok(())
    }

    fn set_data_bits(&mut self, _data_bits: DataBits) -> serialport::Result<()> {
        Ok(())
    }

    fn set_flow_control(&mut self, _flow_control: FlowControl) -> serialport::Result<()> {
        Ok(())
    }

    fn set_parity(&mut self, _parity: Parity) -> serialport::Result<()> {
        Ok(())
    }

    fn set_stop_bits(&mut self, _stop_bits: StopBits) -> serialport::Result<()> {
        Ok(())
    }

    fn write_request_to_send(&mut self, _level: bool) -> serialport::Result<()> {
        Ok(())
    }

    fn write_data_terminal_ready(&mut self, _level: bool) -> serialport::Result<()> {
        Ok(())
    }

    fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }

    fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }

    fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }

    fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }

    fn bytes_to_read(&self) -> serialport::Result<u32> {
        Ok(0)
    }

    fn bytes_to_write(&self) -> serialport::Result<u32> {
        Ok(0)
    }

    fn clear(&self, _buffer_to_clear: ClearBuffer) -> serialport::Result<()> {
        Ok(())
    }

    fn try_clone(&self) -> serialport::Result<Box<dyn SerialPort>> {
        Ok(Box::new(self.probe()))
    }

    fn set_break(&self) -> serialport::Result<()> {
        Ok(())
    }

    fn clear_break(&self) -> serialport::Result<()> {
        Ok(())
    }
}

// serialport 4.x requires `SerialPort: io::Read + io::Write`; the read side
// lives here so the script stays one queue.
impl io::Read for ScriptedPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.requested.lock().unwrap().push(buf.len());
        match self.inner.script.lock().unwrap().pop_front() {
            Some(Step::Bytes(bytes)) => {
                let n = bytes.len().min(buf.len());
                buf[..n].copy_from_slice(&bytes[..n]);
                Ok(n)
            }
            Some(Step::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(5));
                Ok(0)
            }
            None => Ok(0),
            Some(Step::Fail) => Err(Error::new(ErrorKind::BrokenPipe, "port died")),
        }
    }
}

impl io::Write for ScriptedPort {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn bytes(s: &str) -> Step {
    Step::Bytes(s.as_bytes().to_vec())
}

// ── The win: one read for a whole barcode ────────────────────────

#[test]
fn chunked_read_uses_one_syscall_for_a_short_barcode() {
    let mut port = ScriptedPort::new(vec![bytes("4006381333931\r")]);
    let mut reader = BarcodeReader::new();

    let code = reader
        .next_barcode(&mut port, 100)
        .expect("poll ok")
        .expect("a barcode");

    assert_eq!(code.code, "4006381333931");
    // 13 characters + CR used to be 14 blocking read() calls of one byte.
    assert_eq!(
        port.read_count(),
        1,
        "one read() should fetch the whole code"
    );
    assert!(
        port.requested_sizes()[0] >= READ_CHUNK,
        "the loop must offer a chunk, not one byte"
    );
}

#[test]
fn read_chunk_is_64_bytes() {
    assert_eq!(READ_CHUNK, 64);
}

// ── Terminator handling ─────────────────────────────────────────

#[test]
fn cr_terminates_a_barcode() {
    let mut port = ScriptedPort::new(vec![bytes("ABC\r")]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "ABC"
    );
}

#[test]
fn lf_terminates_a_barcode() {
    let mut port = ScriptedPort::new(vec![bytes("ABC\n")]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "ABC"
    );
}

#[test]
fn crlf_suffix_yields_the_code_once() {
    let mut port = ScriptedPort::new(vec![bytes("XYZ\r\n"), Step::WouldBlock]);
    let mut reader = BarcodeReader::new();

    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "XYZ"
    );
    // The LF of the CRLF pair must not become an empty second barcode.
    assert!(reader.next_barcode(&mut port, 1).unwrap().is_none());
}

#[test]
fn leading_terminator_is_skipped() {
    let mut port = ScriptedPort::new(vec![bytes("\n\rABC\r")]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "ABC"
    );
}

#[test]
fn surrounding_whitespace_is_trimmed_like_before() {
    let mut port = ScriptedPort::new(vec![bytes("  ABC  \r")]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "ABC"
    );
}

// ── The case that matters: the terminator arrives in a second read ──

#[test]
fn barcode_split_across_two_reads_keeps_every_character() {
    // The device sent "ABCDE" then, a poll-timeout later, "FGHIJ\r".
    let mut port = ScriptedPort::new(vec![bytes("ABCDE"), Step::WouldBlock, bytes("FGHIJ\r")]);
    let mut reader = BarcodeReader::new();

    let code = reader
        .next_barcode(&mut port, 100)
        .expect("poll ok")
        .expect("a barcode");

    assert_eq!(
        code.code, "ABCDEFGHIJ",
        "a barcode split across two reads must not lose or duplicate characters"
    );
    assert_eq!(port.read_count(), 3, "one read per scripted chunk");
}

#[test]
fn barcode_split_at_every_offset_is_reassembled() {
    let full = "4006381333931\r";
    for split in 1..full.len() {
        let (head, tail) = full.split_at(split);
        let mut port = ScriptedPort::new(vec![bytes(head), bytes(tail)]);
        let mut reader = BarcodeReader::new();
        let code = reader
            .next_barcode(&mut port, 100)
            .unwrap()
            .unwrap_or_else(|| panic!("split at {split} lost the barcode"));
        assert_eq!(code.code, "4006381333931", "split at {split}");
    }
}

// ── The remainder is RETAINED, not discarded ────────────────────

#[test]
fn bytes_after_the_terminator_are_retained_for_the_next_poll() {
    // Two barcodes arrived in ONE read: the second must not be swallowed.
    let mut port = ScriptedPort::new(vec![bytes("FIRST\rSECOND\r")]);
    let mut reader = BarcodeReader::new();

    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "FIRST"
    );
    let reads_before = port.read_count();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "SECOND"
    );
    assert_eq!(
        port.read_count(),
        reads_before,
        "the remainder is served without touching the port"
    );
}

#[test]
fn retained_partial_remainder_is_completed_by_the_next_read() {
    let mut port = ScriptedPort::new(vec![bytes("ONE\rPART"), Step::WouldBlock, bytes("IAL\r")]);
    let mut reader = BarcodeReader::new();

    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "ONE"
    );
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "PARTIAL"
    );
}

#[test]
fn three_codes_arriving_together_come_out_in_order() {
    let mut port = ScriptedPort::new(vec![bytes("A1\rB2\rC3\r")]);
    let mut reader = BarcodeReader::new();
    for expected in ["A1", "B2", "C3"] {
        assert_eq!(
            reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
            expected
        );
    }
}

// ── n == 0 and read errors ──────────────────────────────────────

#[test]
fn would_block_with_nothing_buffered_yields_none() {
    let mut port = ScriptedPort::new(vec![Step::WouldBlock]);
    let mut reader = BarcodeReader::new();
    assert!(reader.next_barcode(&mut port, 100).unwrap().is_none());
}

#[test]
fn read_error_with_partial_data_returns_the_prefix() {
    // Pre-existing fail-soft shape: a dead port hands over what it read.
    let mut port = ScriptedPort::new(vec![bytes("PART"), Step::Fail]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "PART"
    );
}

#[test]
fn read_error_with_nothing_buffered_yields_none() {
    let mut port = ScriptedPort::new(vec![Step::Fail]);
    let mut reader = BarcodeReader::new();
    assert!(reader.next_barcode(&mut port, 100).unwrap().is_none());
}

#[test]
fn timeout_with_partial_data_returns_the_prefix_and_clears_it() {
    // One read offers the part, then the port blocks until the poll's own
    // deadline expires with no terminator in sight.
    let mut port = ScriptedPort::new(vec![bytes("HALF"), Step::WouldBlock]);
    let mut reader = BarcodeReader::new();
    assert_eq!(
        reader.next_barcode(&mut port, 100).unwrap().unwrap().code,
        "HALF"
    );
    // The prefix is handed over exactly once.
    assert!(reader.next_barcode(&mut port, 1).unwrap().is_none());
}

#[test]
fn a_zero_length_read_does_not_end_the_poll_while_a_code_is_pending() {
    // The property behind the split-barcode test, stated directly: a would-block
    // between two bites of ONE code must not hand back the first bite.
    let mut port = ScriptedPort::new(vec![bytes("4006"), Step::WouldBlock, bytes("381333931\r")]);
    let mut reader = BarcodeReader::new();
    let code = reader.next_barcode(&mut port, 200).unwrap().unwrap();
    assert_eq!(code.code, "4006381333931");
    assert_eq!(port.read_count(), 3);
}

#[test]
fn eof_never_blocks_a_poll_that_has_nothing_buffered() {
    // The counterpart: with nothing accumulated, an n == 0 must end the poll
    // immediately instead of spinning until the deadline.
    let mut port = ScriptedPort::new(Vec::new());
    let mut reader = BarcodeReader::new();
    let started = std::time::Instant::now();
    assert!(reader.next_barcode(&mut port, 5_000).unwrap().is_none());
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "an empty, answered read must not spin for the whole timeout"
    );
}

// ── Buffer cap ──────────────────────────────────────────────────

#[test]
fn buffer_cap_returns_a_full_code_and_leaves_no_residue() {
    let mut port = ScriptedPort::new(vec![
        Step::Bytes(b"12345".to_vec()),
        Step::WouldBlock,
        Step::Bytes(b"67890\r".to_vec()),
    ]);
    let mut reader = BarcodeReader::new();

    let code = reader
        .next_barcode_capped(&mut port, 100, 5)
        .unwrap()
        .unwrap();
    assert_eq!(code.code, "12345");
    assert_eq!(
        reader.buffered_bytes(),
        0,
        "cap must not leave a hidden remainder"
    );
}

#[test]
fn cap_is_never_exceeded_by_a_single_huge_read() {
    let mut port = ScriptedPort::new(vec![Step::Bytes(b"AAAAABBBBBCCCCC\r".to_vec())]);
    let mut reader = BarcodeReader::new();

    let code = reader
        .next_barcode_capped(&mut port, 100, 5)
        .unwrap()
        .unwrap();
    assert_eq!(code.code, "AAAAA");
    assert_eq!(reader.buffered_bytes(), 0);
}

#[test]
fn default_cap_matches_the_public_constant() {
    assert_eq!(MAX_BARCODE_LEN, 1024);
}

// ── Timeout semantics ───────────────────────────────────────────

#[test]
fn poll_does_not_block_past_its_timeout() {
    // A port that never has data: every read returns 0 immediately. The loop
    // must spin only until the deadline, never forever.
    let mut port = ScriptedPort::new(vec![Step::WouldBlock]);
    let mut reader = BarcodeReader::new();
    let started = std::time::Instant::now();
    let out = reader.next_barcode(&mut port, 50).unwrap();
    assert!(out.is_none());
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "poll must respect its timeout"
    );
}
