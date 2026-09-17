//! Wireless EDC driver — stub coverage.
//!
//! Pins target addressing (the part a setup wizard and the registry both
//! key off) and the fail-closed contract.

use oz_core::{Currency, Money};

use super::*;
use crate::error::HalError;

fn usd(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "USD".parse::<Currency>().unwrap(),
    }
}

#[test]
fn over_bluetooth_records_the_address() {
    let t = WirelessEdcTerminal::over_bluetooth(
        "AA:BB:CC:DD:EE:FF",
        DeviceInfo::new("PAX", "S920", "S920-0001"),
    );
    assert!(matches!(t.target(), WirelessTarget::Bluetooth(_)));
    assert_eq!(t.address(), "AA:BB:CC:DD:EE:FF");
    assert!(!t.target().is_network());
}

#[test]
fn over_network_records_the_address() {
    let t = WirelessEdcTerminal::over_network("192.168.1.50:9500", DeviceInfo::new("v", "m", "s"));
    assert!(t.target().is_network());
    assert_eq!(t.address(), "192.168.1.50:9500");
}

#[test]
fn address_is_reachable_from_either_variant() {
    for target in [
        WirelessTarget::Bluetooth("AA:BB".into()),
        WirelessTarget::Network("10.0.0.1:1".into()),
    ] {
        assert!(!target.address().is_empty());
    }
}

#[test]
fn device_info_reports_identity() {
    let info = WirelessEdcTerminal::over_bluetooth("AA", DeviceInfo::new("Verifone", "P400", "X1"))
        .device_info();
    assert_eq!(info.vendor, "Verifone");
    assert_eq!(info.model, "P400");
}

#[tokio::test]
async fn every_operation_fails_closed() {
    let t = WirelessEdcTerminal::over_network("127.0.0.1:9500", DeviceInfo::new("v", "m", "s"));
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
        t.refund("txn-1", None).await,
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
    assert!(matches!(
        t.sale(usd(1000)).await,
        Err(HalError::Unsupported(_))
    ));
}
