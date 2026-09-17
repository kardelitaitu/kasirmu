//! Integration tests for `TcpReceiptPrinter` reconnection behaviour.
//!
//! A networked printer connection can drop mid-session (printer reboot,
//! network blip, idle TCP timeout). `TcpReceiptPrinter` caches the
//! `TcpStream` in `ensure_connected`; if that cached stream goes stale
//! the driver must detect the dropped connection and reconnect on the
//! next operation — otherwise the printer is permanently stuck failing
//! on a dead socket until the `TcpReceiptPrinter` is recreated.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

use kasirmu_hal::drivers::tcp_printer::TcpReceiptPrinter;
use kasirmu_hal::traits::printer::ReceiptPrinter;
use kasirmu_hal::types::DeviceInfo;

/// A fake printer endpoint that accepts connections, reads incoming
/// data, and can be signalled to drop its current connection (simulating
/// a printer reboot / network blip).
struct FakePrinter {
    /// Number of TCP connections accepted so far.
    connect_count: Arc<AtomicUsize>,
}

impl FakePrinter {
    fn new() -> (Self, Arc<AtomicUsize>) {
        let connect_count = Arc::new(AtomicUsize::new(0));
        let fake = Self {
            connect_count: connect_count.clone(),
        };
        (fake, connect_count)
    }

    /// Accept exactly one connection, read whatever the client sends,
    /// then return. The caller controls the connection lifetime by
    /// dropping the returned `TcpStream`.
    async fn accept_one(&self, listener: &TcpListener) -> tokio::net::TcpStream {
        let (mut stream, _peer) = listener.accept().await.unwrap();
        self.connect_count.fetch_add(1, Ordering::SeqCst);
        // Drain whatever the printer driver writes so the write side
        // doesn't block on a full kernel buffer.
        let mut buf = [0u8; 4096];
        let _ = stream.read(&mut buf).await;
        stream
    }
}

#[tokio::test]
async fn print_receipt_reconnects_after_connection_drop() {
    // ── fake printer that rebinds so the driver can reconnect ──
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let port = addr.port();

    let (fake, connect_count) = FakePrinter::new();

    let server = tokio::spawn(async move {
        // Connection 1: accept, read a bit, then DROP with an RST
        // (SO_LINGER 0) so the client sees a hard reset rather than a
        // graceful FIN — simulates a printer reboot, not a graceful
        // close. The client's next write to the stale socket then
        // fails with ECONNRESET/EPIPE, which the driver must detect.
        let conn1 = fake.accept_one(&listener).await;
        // Don't drain — leaving the receive buffer unread makes the
        // client's subsequent write fail faster once we RST.
        // set_linger(ZERO) is deprecated (blocks on drop) but is the
        // correct tool here to force an RST that simulates a hard
        // printer reboot rather than a graceful FIN.
        #[allow(deprecated)]
        conn1.set_linger(Some(std::time::Duration::ZERO)).ok();
        drop(conn1);

        // Give the client's kernel time to process the RST so the next
        // write fails deterministically rather than silently buffering.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // Connection 2: accept on the SAME listener (no rebind needed).
        let mut conn2 = fake.accept_one(&listener).await;
        // Keep conn2 alive until the test finishes by draining writes
        // so they don't block on a full kernel buffer.
        let mut buf = [0u8; 4096];
        loop {
            if conn2.read(&mut buf).await.is_err() {
                break;
            }
        }
    });

    // Give the listener a moment to start accepting.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // ── driver under test ──
    let info = DeviceInfo::new("Epson", "TM-T88VI", "SN-RECONNECT");
    let printer = TcpReceiptPrinter::new(format!("127.0.0.1:{port}"), info);

    // First print succeeds (connection 1 established).
    printer.print_receipt("first\n").await.unwrap();
    // Poll for the server to register connection 1 (it drains the write
    // asynchronously in accept_one).
    for _ in 0..50 {
        if connect_count.load(Ordering::SeqCst) >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(
        connect_count.load(Ordering::SeqCst),
        1,
        "first print should establish connection 1"
    );

    // Give the fake server time to drop connection 1 and rebind.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // Second print: the cached stream is now stale (peer RST'd it).
    // BUG: ensure_connected sees guard.is_some() and never reconnects;
    // the write hits a dead socket and returns an error (or, on some
    // platforms, succeeds into a half-open buffer then the next op
    // fails). Either way the driver is permanently stuck on the dead
    // connection. The EXPECTED behaviour is to detect the failure,
    // drop the stale stream, and reconnect automatically.
    let result = printer.print_receipt("second\n").await;
    assert!(
        result.is_ok(),
        "second print after a dropped connection should reconnect and \
         succeed, but got: {:?}",
        result.err()
    );
    // Poll for the server to register connection 2 (it drains the
    // write asynchronously in accept_one).
    for _ in 0..100 {
        if connect_count.load(Ordering::SeqCst) >= 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(
        connect_count.load(Ordering::SeqCst),
        2,
        "second print should establish a fresh connection (reconnect)"
    );

    // Reap the server task.
    server.abort();
}
