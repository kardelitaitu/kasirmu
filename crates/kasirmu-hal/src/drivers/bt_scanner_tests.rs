use super::*;

use std::collections::VecDeque;
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serialport::{ClearBuffer, DataBits, FlowControl, Parity, SerialPort, StopBits};

/// A `serialport::SerialPort` mock that replays `read()` chunks.
///
/// The driver opens its own real port through `open_port`, so these tests
/// build the driver's state directly ([connected]) and swap this fake in.
/// `reads` counts `read()` calls: that count is the whole of O-M42.
struct FakePort {
    inner: Arc<FakeState>,
}

#[derive(Default)]
struct FakeState {
    script: StdMutex<VecDeque<Vec<u8>>>,
    reads: AtomicUsize,
}

impl FakePort {
    fn new(chunks: Vec<&str>) -> Self {
        let state = FakeState::default();
        *state.script.lock().unwrap() = chunks.iter().map(|c| c.as_bytes().to_vec()).collect();
        Self {
            inner: Arc::new(state),
        }
    }
}

/// Build a driver with an ALREADY-OPEN fake port — no hardware involved.
///
/// Returns the driver and a handle onto the port's state so a test can count
/// the `read()` calls the poll made.
fn connected(chunks: Vec<&str>) -> (BtBarcodeScanner, Arc<FakeState>) {
    let fake_port = FakePort::new(chunks);
    let counter = fake_port.inner.clone();
    let scanner = BtBarcodeScanner::new_default(SerialPortInfo {
        port_name: "FAKE".into(),
        description: "FAKE".into(),
        vid: None,
        pid: None,
    });
    *scanner.port.blocking_lock() = Some(Box::new(fake_port));
    (scanner, counter)
}

/// Run `poll` — which blocks — on its own runtime and its own thread.
fn poll_once(
    driver: &mut BtBarcodeScanner,
    timeout_ms: u32,
) -> Result<Option<crate::types::Barcode>, HalError> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    rt.block_on(driver.poll(timeout_ms))
}

impl SerialPort for FakePort {
    fn name(&self) -> Option<String> {
        Some("FAKE".to_owned())
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
    fn set_timeout(&mut self, _t: Duration) -> serialport::Result<()> {
        Ok(())
    }
    fn set_baud_rate(&mut self, _b: u32) -> serialport::Result<()> {
        Ok(())
    }
    fn set_data_bits(&mut self, _d: DataBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_flow_control(&mut self, _f: FlowControl) -> serialport::Result<()> {
        Ok(())
    }
    fn set_parity(&mut self, _p: Parity) -> serialport::Result<()> {
        Ok(())
    }
    fn set_stop_bits(&mut self, _s: StopBits) -> serialport::Result<()> {
        Ok(())
    }
    fn write_request_to_send(&mut self, _l: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, _l: bool) -> serialport::Result<()> {
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
    fn clear(&self, _b: ClearBuffer) -> serialport::Result<()> {
        Ok(())
    }
    fn try_clone(&self) -> serialport::Result<Box<dyn SerialPort>> {
        Err(serialport::Error::new(
            serialport::ErrorKind::NoDevice,
            "not cloneable",
        ))
    }
    fn set_break(&self) -> serialport::Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> serialport::Result<()> {
        Ok(())
    }
}

impl io::Read for FakePort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.reads.fetch_add(1, Ordering::SeqCst);
        let next = self.inner.script.lock().unwrap().pop_front();
        match next {
            Some(bytes) => {
                let n = bytes.len().min(buf.len());
                buf[..n].copy_from_slice(&bytes[..n]);
                Ok(n)
            }
            // Exhausted: a real port blocks until its timeout, then returns 0.
            None => {
                std::thread::sleep(Duration::from_millis(2));
                Ok(0)
            }
        }
    }
}

impl io::Write for FakePort {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ── The win: the driver polls a whole barcode in ONE read ────────

#[test]
fn driver_poll_reads_a_short_barcode_in_one_syscall() {
    let (mut scanner, counter) = connected(vec!["4006381333931\r"]);

    let out = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("barcode");

    assert_eq!(out.code, "4006381333931");
    assert_eq!(
        counter.reads.load(Ordering::SeqCst),
        1,
        "13 characters used to cost 14 blocking reads of one byte each"
    );
}

// ── The case that matters: terminator in a SECOND read ──────────

#[test]
fn driver_poll_reassembles_a_barcode_split_across_two_reads() {
    // The port hands back "400638" and, on the next read, "1333931\r".
    let (mut scanner, counter) = connected(vec!["400638", "1333931\r"]);

    let out = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("barcode");

    assert_eq!(
        out.code, "4006381333931",
        "a terminator arriving in a second read must complete the code, not truncate it"
    );
    assert!(counter.reads.load(Ordering::SeqCst) >= 2);
}

#[test]
fn driver_poll_split_barcode_is_not_duplicated_or_lost() {
    let (mut scanner, _counter) = connected(vec!["ABC", "DEF", "\r"]);
    let out = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("barcode");
    assert_eq!(out.code, "ABCDEF");
}

#[test]
fn driver_poll_split_across_a_would_block_still_reassembles() {
    // The middle chunk is empty: a read that timed out. The barcode must
    // survive the gap.
    let (mut scanner, _counter) = connected(vec!["40063", "", "81333931\r"]);
    let out = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("barcode");
    assert_eq!(out.code, "4006381333931");
}

// ── Remainder retention through the driver ──────────────────────

#[test]
fn driver_poll_returns_two_codes_that_arrived_in_one_read() {
    let (mut scanner, _counter) = connected(vec!["FIRST\rSECOND\r"]);

    let a = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("first");
    let b = poll_once(&mut scanner, 200)
        .expect("poll ok")
        .expect("second");

    assert_eq!(a.code, "FIRST");
    assert_eq!(b.code, "SECOND", "the remainder must not be dropped");
}

// ── Framing ─────────────────────────────────────────────────────

#[test]
fn driver_poll_accepts_cr_lf_and_crlf() {
    for (wire, expected) in [("A\r", "A"), ("B\n", "B"), ("C\r\n", "C")] {
        let (mut scanner, _counter) = connected(vec![wire]);
        let out = poll_once(&mut scanner, 200)
            .expect("poll ok")
            .expect("barcode");
        assert_eq!(out.code, expected, "wire {wire:?}");
    }
}

#[test]
fn driver_poll_returns_none_when_the_port_stays_silent() {
    let (mut scanner, _counter) = connected(vec![]);
    let started = std::time::Instant::now();
    let out = poll_once(&mut scanner, 60);
    assert!(out.expect("poll ok").is_none());
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn driver_poll_without_a_port_is_not_connected() {
    let mut scanner = BtBarcodeScanner::new_default(SerialPortInfo {
        port_name: "FAKE".into(),
        description: "FAKE".into(),
        vid: None,
        pid: None,
    });
    let out = poll_once(&mut scanner, 50);
    assert!(matches!(out, Err(HalError::Bluetooth(_))));
}

// ── Existing contract ───────────────────────────────────────────

#[test]
fn bt_discover_does_not_panic() {
    // No hardware expected in CI — should return empty vec.
    let scanners = BtBarcodeScanner::discover_all();
    assert!(scanners.is_empty() || !scanners.is_empty());
}

#[test]
fn new_stores_port_and_baud() {
    let info = SerialPortInfo {
        port_name: "COM7".into(),
        description: "Honeywell BT Scanner".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new(info, 19200);
    assert_eq!(scanner.port_name, "COM7");
    assert_eq!(scanner.baud_rate, 19200);
}

#[test]
fn new_default_uses_9600_baud() {
    let info = SerialPortInfo {
        port_name: "COM8".into(),
        description: "Zebra BT Scanner".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new_default(info);
    assert_eq!(scanner.baud_rate, DEFAULT_BAUD);
}

#[test]
fn device_info_reflects_constructor() {
    let info = SerialPortInfo {
        port_name: "COM9".into(),
        description: "Datalogic BT".into(),
        vid: None,
        pid: None,
    };
    let scanner = BtBarcodeScanner::new(info, 9600);
    let dev_info = scanner.device_info();
    assert_eq!(dev_info.vendor, "Bluetooth");
    assert_eq!(dev_info.model, "Datalogic BT");
    assert_eq!(dev_info.serial, "COM9");
}

#[test]
fn default_baud_constant_is_9600() {
    assert_eq!(DEFAULT_BAUD, 9600);
}

#[test]
fn barcode_len_cap_is_still_re_exported() {
    // The constant moved to `transport::barcode_reader`; the module path that
    // callers used before must keep resolving to the same 1024 bytes.
    assert_eq!(MAX_BARCODE_LEN, 1024);
    assert_eq!(
        MAX_BARCODE_LEN,
        crate::transport::barcode_reader::MAX_BARCODE_LEN
    );
}
