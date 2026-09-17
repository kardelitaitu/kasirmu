//! Integration tests using mock HAL drivers.
//!
//! These tests verify that the `DriverRegistry`, mock drivers, and
//! cross-trait workflows integrate correctly — no real hardware needed.

use std::sync::Arc;

use kasirmu_hal::DriverRegistry;
use kasirmu_hal::drivers::mock::{MockBarcodeScanner, MockCashDrawer, MockReceiptPrinter};
use kasirmu_hal::traits::barcode::BarcodeScanner;
use kasirmu_hal::traits::cash_drawer::CashDrawer;
use kasirmu_hal::traits::printer::ReceiptPrinter;
use kasirmu_hal::types::{Barcode, DeviceInfo};

// ── Registry + mock registration ───────────────────────────────────────

#[tokio::test]
async fn register_and_lookup_scanner() {
    let registry = DriverRegistry::new();
    let mock = Arc::new(MockBarcodeScanner::new());

    registry
        .register_scanner("scanner:main", mock.clone())
        .await;
    let found = registry.scanner("scanner:main").await;
    assert!(found.is_some(), "registered scanner should be found");
}

#[tokio::test]
async fn register_and_lookup_printer() {
    let registry = DriverRegistry::new();
    let mock = Arc::new(MockReceiptPrinter::new());

    registry
        .register_printer("printer:main", mock.clone())
        .await;
    let found = registry.printer("printer:main").await;
    assert!(found.is_some(), "registered printer should be found");
}

#[tokio::test]
async fn register_and_lookup_drawer() {
    let registry = DriverRegistry::new();
    let mock = Arc::new(MockCashDrawer::new());

    registry
        .register_cash_drawer("drawer:main", mock.clone())
        .await;
    let found = registry.cash_drawer("drawer:main").await;
    assert!(found.is_some(), "registered drawer should be found");
}

#[tokio::test]
async fn register_overwrites_previous() {
    let registry = DriverRegistry::new();
    let a = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "a", "a", "a",
    )));
    let b = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "b", "b", "b",
    )));

    registry.register_scanner("same-id", a).await;
    registry.register_scanner("same-id", b.clone()).await;

    let found = registry.scanner("same-id").await.unwrap();
    assert_eq!(found.device_info().vendor, "b");
}

#[tokio::test]
async fn lookup_unknown_returns_none() {
    let registry = DriverRegistry::new();
    assert!(registry.scanner("nope").await.is_none());
    assert!(registry.printer("nope").await.is_none());
    assert!(registry.cash_drawer("nope").await.is_none());
}

#[tokio::test]
async fn ids_snapshot() {
    let registry = DriverRegistry::new();
    registry
        .register_scanner("s1", Arc::new(MockBarcodeScanner::new()))
        .await;
    registry
        .register_scanner("s2", Arc::new(MockBarcodeScanner::new()))
        .await;
    registry
        .register_printer("p1", Arc::new(MockReceiptPrinter::new()))
        .await;
    registry
        .register_cash_drawer("d1", Arc::new(MockCashDrawer::new()))
        .await;

    let mut scanners = registry.scanner_ids().await;
    scanners.sort();
    assert_eq!(scanners, vec!["s1", "s2"]);

    let mut printers = registry.printer_ids().await;
    printers.sort();
    assert_eq!(printers, vec!["p1"]);

    let mut drawers = registry.drawer_ids().await;
    drawers.sort();
    assert_eq!(drawers, vec!["d1"]);
}

// ── Barcode scanner mock workflows ─────────────────────────────────────

#[tokio::test]
async fn scan_queue_returns_in_order() {
    let mut mock = MockBarcodeScanner::new();
    mock.push(Barcode::new("012345678905"));
    mock.push(Barcode::new("987654321098"));

    let scan1 = mock.poll(1000).await.unwrap().unwrap();
    assert_eq!(scan1.code, "012345678905");

    let scan2 = mock.poll(1000).await.unwrap().unwrap();
    assert_eq!(scan2.code, "987654321098");
}

#[tokio::test]
async fn scan_empty_queue_returns_none_with_zero_timeout() {
    let mut mock = MockBarcodeScanner::new();
    let result = mock.poll(0).await.unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn scan_tracks_call_counters() {
    let mut mock = MockBarcodeScanner::new();
    mock.push(Barcode::new("ABC"));

    assert_eq!(
        mock.connect_calls.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    mock.connect().await.unwrap();
    assert_eq!(
        mock.connect_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert_eq!(mock.poll_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    let _ = mock.poll(100).await;
    assert_eq!(mock.poll_calls.load(std::sync::atomic::Ordering::SeqCst), 1);

    assert_eq!(
        mock.cancel_calls.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    mock.cancel().await.unwrap();
    assert_eq!(
        mock.cancel_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[tokio::test]
async fn scanner_device_info() {
    let info = DeviceInfo::new("TestCo", "ScannerX", "SN-001");
    let mock = MockBarcodeScanner::with_info(info.clone());
    assert_eq!(mock.device_info(), info);
}

// ── Receipt printer mock workflows ─────────────────────────────────────

#[tokio::test]
async fn printer_captures_text() {
    let mock = MockReceiptPrinter::new();

    mock.print_receipt("Hello, World!").await.unwrap();

    let captured = mock.printed.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0], "Hello, World!");
}

#[tokio::test]
async fn printer_captures_multiple_receipts() {
    let mock = MockReceiptPrinter::new();

    mock.print_receipt("Receipt #1").await.unwrap();
    mock.print_receipt("Receipt #2").await.unwrap();
    mock.print_receipt("Receipt #3").await.unwrap();

    let captured = mock.printed.lock().unwrap();
    assert_eq!(captured.len(), 3);
    assert_eq!(captured[2], "Receipt #3");
}

#[tokio::test]
async fn printer_captures_raw_bytes() {
    let mock = MockReceiptPrinter::new();

    let bytes: Vec<u8> = vec![0x1b, 0x40, 0x1b, 0x45]; // ESC/POS init + bold
    mock.print_raw(&bytes).await.unwrap();

    let captured = mock.printed_raw.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0], bytes);
}

#[tokio::test]
async fn printer_tracks_cut_calls() {
    let mock = MockReceiptPrinter::new();

    assert_eq!(mock.cut_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    mock.cut().await.unwrap();
    assert_eq!(mock.cut_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    mock.cut().await.unwrap();
    assert_eq!(mock.cut_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[tokio::test]
async fn printer_propagates_error() {
    let mock = MockReceiptPrinter::new();
    mock.set_next_error(kasirmu_hal::HalError::Busy);

    let result = mock.print_receipt("fail me").await;
    assert!(result.is_err());
    match result {
        Err(kasirmu_hal::HalError::Busy) => {} // expected
        _ => panic!("expected Busy error"),
    }
}

#[tokio::test]
async fn printer_error_clears_after_one_use() {
    let mock = MockReceiptPrinter::new();
    mock.set_next_error(kasirmu_hal::HalError::Disconnected);

    // First call fails
    assert!(mock.print_receipt("first").await.is_err());

    // Second call succeeds (error was consumed)
    mock.print_receipt("second").await.unwrap();
    let captured = mock.printed.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0], "second");
}

// ── Cash drawer mock workflows ─────────────────────────────────────────

#[tokio::test]
async fn drawer_tracks_opens() {
    let mock = MockCashDrawer::new();

    assert_eq!(mock.open_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    mock.open().await.unwrap();
    assert_eq!(mock.open_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    mock.open().await.unwrap();
    assert_eq!(mock.open_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[tokio::test]
async fn drawer_propagates_error() {
    let mock = MockCashDrawer::new();
    mock.set_next_error(kasirmu_hal::HalError::NotFound("drawer-1".into()));

    let result = mock.open().await;
    match result {
        Err(kasirmu_hal::HalError::NotFound(_)) => {} // expected
        _ => panic!("expected NotFound error"),
    }
}

#[tokio::test]
async fn is_open_default_returns_disconnected() {
    let mock = MockCashDrawer::new();
    match mock.is_open().await {
        Err(kasirmu_hal::HalError::Disconnected) => {} // expected
        _ => panic!("expected Disconnected from default is_open"),
    }
}

// ── Cross-trait workflow (scan -> print -> open drawer) ────────────────

#[tokio::test]
async fn scan_print_open_workflow() {
    // 1. Scan a product
    let mut scanner = MockBarcodeScanner::new();
    scanner.push(Barcode::new("4901234567890"));

    let scan = scanner.poll(1000).await.unwrap().unwrap();
    assert_eq!(scan.code, "4901234567890");

    // 2. Generate receipt text from the scan
    let receipt_body = format!("Store: Test\nItem: {}\nTotal: $5.00\nThank you!", scan.code);

    // 3. Print the receipt
    let printer = MockReceiptPrinter::new();
    printer.print_receipt(&receipt_body).await.unwrap();
    printer.cut().await.unwrap();

    {
        let captured = printer.printed.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert!(captured[0].contains("4901234567890"));
        assert!(captured[0].contains("$5.00"));
    }
    assert_eq!(
        printer.cut_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    // 4. Open the cash drawer
    let drawer = MockCashDrawer::new();
    drawer.open().await.unwrap();
    assert_eq!(
        drawer.open_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

// ── Registry-driven workflow ──────────────────────────────────────────

#[tokio::test]
async fn full_workflow_through_registry() {
    let registry = DriverRegistry::new();

    // Register mock devices
    let scanner = Arc::new(MockBarcodeScanner::new());
    let printer = Arc::new(MockReceiptPrinter::new());
    let drawer = Arc::new(MockCashDrawer::new());

    registry
        .register_scanner("main-scanner", scanner.clone())
        .await;
    registry
        .register_printer("main-printer", printer.clone())
        .await;
    registry
        .register_cash_drawer("main-drawer", drawer.clone())
        .await;

    // Look up devices through registry
    let s = registry.scanner("main-scanner").await.unwrap();
    let p = registry.printer("main-printer").await.unwrap();
    let d = registry.cash_drawer("main-drawer").await.unwrap();

    // Push a scan into the mock via the Arc<MockBarcodeScanner> handle
    scanner.push(Barcode::new("scan-via-registry"));

    // Verify device info through the registry
    let device = s.device_info();
    assert_eq!(device.vendor, "mock");

    // Print via registry
    p.print_receipt("Receipt from registry").await.unwrap();
    p.cut().await.unwrap();
    assert_eq!(printer.printed.lock().unwrap().len(), 1);
    assert_eq!(
        printer.cut_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    // Open drawer via registry
    d.open().await.unwrap();
    assert_eq!(
        drawer.open_calls.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}
