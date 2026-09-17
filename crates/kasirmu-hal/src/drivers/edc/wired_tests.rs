//! Wired EDC driver — stub coverage.
//!
//! Pins the configuration accessors and the fail-closed contract: a wired
//! terminal that has not been implemented must report `Unsupported` for
//! every operation rather than look like an approved card.

use oz_core::{Currency, Money};

use super::*;
use crate::error::HalError;

fn usd(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "USD".parse::<Currency>().unwrap(),
    }
}

fn terminal() -> WiredEdcTerminal {
    WiredEdcTerminal::new(
        "COM3",
        115_200,
        DeviceInfo::new("Ingenico", "iPP320", "IPP320-0001"),
    )
}

#[test]
fn construction_records_the_link_configuration() {
    let t = terminal();
    assert_eq!(t.port_name(), "COM3");
    assert_eq!(t.baud_rate(), 115_200);
}

#[test]
fn new_default_uses_the_documented_baud() {
    let t = WiredEdcTerminal::new_default("/dev/ttyUSB0", DeviceInfo::new("v", "m", "s"));
    assert_eq!(t.baud_rate(), DEFAULT_BAUD);
    assert_eq!(t.port_name(), "/dev/ttyUSB0");
    assert_eq!(DEFAULT_BAUD, 9600, "9600 is the EDC serial default");
}

#[test]
fn device_info_reports_identity() {
    let info = terminal().device_info();
    assert_eq!(info.vendor, "Ingenico");
    assert_eq!(info.model, "iPP320");
    assert_eq!(info.serial, "IPP320-0001");
}

#[tokio::test]
async fn every_operation_fails_closed() {
    let t = terminal();
    assert!(matches!(t.status().await, Err(HalError::Unsupported(_))));
    assert!(matches!(
        t.authorize(usd(1000)).await,
        Err(HalError::Unsupported(_))
    ));
    assert!(matches!(
        t.capture("txn-1").await,
        Err(HalError::Unsupported(_))
    ));
    assert!(matches!(
        t.refund("txn-1", Some(usd(500))).await,
        Err(HalError::Unsupported(_))
    ));
    assert!(matches!(
        t.void("txn-1").await,
        Err(HalError::Unsupported(_))
    ));
    assert!(matches!(
        t.print_receipt("txn-1").await,
        Err(HalError::Unsupported(_))
    ));
}

#[tokio::test]
async fn sale_never_reports_success_while_stubbed() {
    // The trait's default sale() chains authorize+capture; both fail, so a
    // cashier pressing "card" on an unimplemented terminal cannot be shown
    // an approved receipt.
    let t = terminal();
    assert!(matches!(
        t.sale(usd(1000)).await,
        Err(HalError::Unsupported(_))
    ));
}
