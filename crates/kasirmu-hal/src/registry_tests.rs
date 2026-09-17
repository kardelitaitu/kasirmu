use super::*;
use crate::drivers::mock::MockBarcodeScanner;
use crate::drivers::mock::MockCashDrawer;
use crate::drivers::mock::MockReceiptPrinter;
use crate::types::DeviceInfo;

#[tokio::test]
async fn register_and_lookup_scanner() {
    let reg = DriverRegistry::default();
    let scanner: Arc<dyn BarcodeScanner> = Arc::new(MockBarcodeScanner::with_info(
        DeviceInfo::new("test", "MockScanner", "0001"),
    ));
    reg.register_scanner("front", scanner).await;
    let got = reg.scanner("front").await.unwrap();
    assert_eq!(got.device_info().vendor, "test");
}

#[tokio::test]
async fn missing_scanner_returns_none() {
    let reg = DriverRegistry::default();
    assert!(reg.scanner("nope").await.is_none());
}

#[tokio::test]
async fn register_printer_and_drawer() {
    let reg = DriverRegistry::default();
    let printer: Arc<dyn ReceiptPrinter> = Arc::new(MockReceiptPrinter::with_info(
        DeviceInfo::new("test", "MockPrinter", "0002"),
    ));
    let drawer: Arc<dyn CashDrawer> = Arc::new(MockCashDrawer::with_info(DeviceInfo::new(
        "test",
        "MockDrawer",
        "0003",
    )));
    reg.register_printer("default", printer).await;
    reg.register_cash_drawer("default", drawer).await;
    assert!(reg.printer("default").await.is_some());
    assert!(reg.cash_drawer("default").await.is_some());
}

#[tokio::test]
async fn register_overwrites_previous() {
    let reg = DriverRegistry::default();
    let old: Arc<dyn BarcodeScanner> = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "v1",
        "MockScanner",
        "0001",
    )));
    let new: Arc<dyn BarcodeScanner> = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "v2",
        "MockScanner",
        "0002",
    )));
    reg.register_scanner("main", old).await;
    reg.register_scanner("main", new).await;
    let got = reg.scanner("main").await.unwrap();
    assert_eq!(got.device_info().vendor, "v2");
}

#[tokio::test]
async fn scanner_ids_returns_registered_keys() {
    let reg = DriverRegistry::default();
    let s1: Arc<dyn BarcodeScanner> = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "t", "S1", "001",
    )));
    let s2: Arc<dyn BarcodeScanner> = Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "t", "S2", "002",
    )));
    reg.register_scanner("front", s1).await;
    reg.register_scanner("back", s2).await;
    let ids = reg.scanner_ids().await;
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"front".to_owned()));
    assert!(ids.contains(&"back".to_owned()));
}

#[tokio::test]
async fn printer_ids_returns_registered_keys() {
    let reg = DriverRegistry::default();
    let p: Arc<dyn ReceiptPrinter> = Arc::new(MockReceiptPrinter::with_info(DeviceInfo::new(
        "t", "P", "001",
    )));
    reg.register_printer("default", p).await;
    let ids = reg.printer_ids().await;
    assert_eq!(ids, vec!["default".to_owned()]);
}

#[tokio::test]
async fn drawer_ids_returns_registered_keys() {
    let reg = DriverRegistry::default();
    let d: Arc<dyn CashDrawer> =
        Arc::new(MockCashDrawer::with_info(DeviceInfo::new("t", "D", "001")));
    reg.register_cash_drawer("main", d).await;
    let ids = reg.drawer_ids().await;
    assert_eq!(ids, vec!["main".to_owned()]);
}

#[tokio::test]
async fn empty_registry_ids_are_empty() {
    let reg = DriverRegistry::default();
    assert!(reg.scanner_ids().await.is_empty());
    assert!(reg.printer_ids().await.is_empty());
    assert!(reg.drawer_ids().await.is_empty());
}

#[tokio::test]
async fn register_tcp_printer_and_lookup() {
    let reg = DriverRegistry::default();
    reg.register_tcp_printer(
        "net-printer",
        "192.168.1.100:9100",
        DeviceInfo::new("epson", "TM-T88", "net-001"),
    )
    .await;
    let got = reg.printer("net-printer").await;
    assert!(got.is_some());
    assert_eq!(got.unwrap().device_info().vendor, "epson");
}

// --- EDC card-payment terminals ------------------------------------------

fn usd(minor: i64) -> oz_core::Money {
    oz_core::Money {
        minor_units: minor,
        currency: "USD".parse::<oz_core::Currency>().unwrap(),
    }
}

#[tokio::test]
async fn register_and_lookup_terminal() {
    let reg = DriverRegistry::default();
    let terminal: Arc<dyn EdcTerminal> =
        Arc::new(crate::drivers::mock::MockEdcTerminal::with_info(
            DeviceInfo::new("pax", "S920", "S920-0001"),
        ));
    reg.register_terminal("front", terminal).await;
    let got = reg.terminal("front").await.unwrap();
    assert_eq!(got.device_info().vendor, "pax");
    assert_eq!(got.device_info().model, "S920");
}

#[tokio::test]
async fn missing_terminal_returns_none() {
    let reg = DriverRegistry::default();
    assert!(reg.terminal("nope").await.is_none());
}

#[tokio::test]
async fn terminal_ids_snapshot() {
    let reg = DriverRegistry::default();
    assert!(reg.terminal_ids().await.is_empty());
    reg.register_terminal(
        "front",
        Arc::new(crate::drivers::mock::MockEdcTerminal::new()),
    )
    .await;
    reg.register_terminal(
        "back",
        Arc::new(crate::drivers::mock::MockEdcTerminal::new()),
    )
    .await;
    let mut ids = reg.terminal_ids().await;
    ids.sort();
    assert_eq!(ids, vec!["back".to_string(), "front".to_string()]);
}

#[tokio::test]
async fn register_wired_terminal_installs_the_real_stub_driver() {
    let reg = DriverRegistry::default();
    reg.register_wired_terminal(
        "edc-front",
        "COM3",
        9600,
        DeviceInfo::new("ingenico", "iPP320", "IPP-0001"),
    )
    .await;
    let t = reg.terminal("edc-front").await.expect("registered");
    assert_eq!(t.device_info().model, "iPP320");
    // It is the wired stub, not a mock: an unimplemented driver must fail
    // closed rather than report an approval.
    assert!(
        matches!(
            t.authorize(usd(1000)).await,
            Err(crate::error::HalError::Unsupported(_))
        ),
        "wired stub must not authorize"
    );
}

#[tokio::test]
async fn register_wireless_terminal_installs_the_real_stub_driver() {
    let reg = DriverRegistry::default();
    reg.register_wireless_terminal(
        "edc-mobile",
        crate::drivers::edc::WirelessTarget::Network("192.168.1.50:9500".into()),
        DeviceInfo::new("verifone", "P400", "P400-0001"),
    )
    .await;
    let t = reg.terminal("edc-mobile").await.expect("registered");
    assert_eq!(t.device_info().vendor, "verifone");
    assert!(matches!(
        t.status().await,
        Err(crate::error::HalError::Unsupported(_))
    ));
}

#[tokio::test]
async fn discover_never_registers_a_card_terminal() {
    // Deliberate design, not an oversight: a money device must be named by
    // an operator before the register can take a card on it. If discovery
    // ever grows EDC probing this test fails and the decision gets revisited.
    let reg = DriverRegistry::default();
    reg.discover().await;
    assert!(
        reg.terminal_ids().await.is_empty(),
        "discover() must not auto-register EDC terminals"
    );
}

// ── id ordering ──────────────────────────────────────────────────────

fn mock_scanner(model: &str) -> Arc<dyn BarcodeScanner> {
    Arc::new(MockBarcodeScanner::with_info(DeviceInfo::new(
        "test", model, model,
    )))
}

#[tokio::test]
async fn scanner_ids_come_back_sorted_whatever_order_they_went_in() {
    // useBarcodeScanner.ts auto-detects with scanners[0]. Under HashMap
    // iteration that element is arbitrary, so two restarts of the same
    // register with the same hardware could drive a different device.
    let reg = DriverRegistry::default();
    for id in ["zulu", "alpha", "mike"] {
        reg.register_scanner(id, mock_scanner(id)).await;
    }
    assert_eq!(
        reg.scanner_ids().await,
        vec!["alpha".to_string(), "mike".into(), "zulu".into()]
    );
}

#[tokio::test]
async fn the_id_ordering_is_stable_across_repeated_calls() {
    let reg = DriverRegistry::default();
    for id in ["b", "d", "a", "c"] {
        reg.register_printer(id, Arc::new(MockReceiptPrinter::new()))
            .await;
    }
    let first = reg.printer_ids().await;
    for _ in 0..8 {
        assert_eq!(reg.printer_ids().await, first, "ordering must not drift");
    }
}

#[tokio::test]
async fn every_category_lists_its_ids_in_order() {
    // One rule for all six views, so no caller has to know which of them
    // happens to be sorted today.
    let reg = DriverRegistry::default();
    for id in ["s2", "s1"] {
        reg.register_scanner(id, mock_scanner(id)).await;
        reg.register_printer(id, Arc::new(MockReceiptPrinter::new()))
            .await;
        reg.register_cash_drawer(id, Arc::new(MockCashDrawer::new()))
            .await;
    }
    for listed in [
        reg.scanner_ids().await,
        reg.printer_ids().await,
        reg.drawer_ids().await,
        reg.display_ids().await,
        reg.scale_ids().await,
        reg.terminal_ids().await,
    ] {
        let mut sorted = listed.clone();
        sorted.sort();
        assert_eq!(listed, sorted, "{listed:?} is not sorted");
    }
}

// ── discover_scanners ────────────────────────────────────────────────

#[tokio::test]
async fn discover_scanners_registers_only_scanners() {
    // The startup path binds scanners by enumeration while printers,
    // drawers and displays stay config-driven. If this ever registers a
    // printer it has silently become discover(), and printer("default")
    // would still be empty.
    let reg = DriverRegistry::default();
    reg.discover_scanners().await;
    assert!(
        reg.printer_ids().await.is_empty(),
        "scanner autodetect must not bind printers"
    );
    assert!(reg.drawer_ids().await.is_empty());
    assert!(reg.display_ids().await.is_empty());
    assert!(reg.terminal_ids().await.is_empty());
}

#[tokio::test]
async fn discovered_scanner_ids_are_the_ones_the_registry_holds() {
    // The returned list is what the bootstrap reports, so it must agree with
    // what a later lookup can actually find. Depends on no attached device:
    // on a machine with no scanner both sides are simply empty.
    let reg = DriverRegistry::default();
    let found = reg.discover_scanners().await;
    assert_eq!(found, reg.scanner_ids().await);
    assert!(
        found.windows(2).all(|w| w[0] <= w[1]),
        "returned ids must be sorted: {found:?}"
    );
    for id in &found {
        assert!(id.starts_with("scanner:"), "unexpected id {id}");
        assert!(reg.scanner(id).await.is_some(), "{id} must resolve");
    }
}
