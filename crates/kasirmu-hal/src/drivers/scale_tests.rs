use super::*;
use crate::registry::DriverRegistry;

#[test]
fn new_stores_device_path() {
    let scale = HidWeightScale::new(0x1234, 0x5678, "/dev/hidraw0".into());
    assert_eq!(scale.device_path(), "/dev/hidraw0");
}

#[tokio::test]
async fn the_stub_is_not_registered_by_the_bootstrap() {
    // Pins the deliberate gap. Wiring HidWeightScale into apply_config would
    // look like progress and be a regression: read_scale_weight_scoped turns
    // a missing scale into Ok(None), but a registered stub makes the same
    // command return Err on every poll.
    let reg = DriverRegistry::default();
    let cfg = crate::bootstrap::HardwareConfig {
        printers: vec![crate::bootstrap::PrinterConfig {
            id: "default".into(),
            connection: crate::bootstrap::Connection::Network {
                addr: "1.2.3.4:9100".into(),
            },
            info: crate::types::DeviceInfo::new("v", "m", "s"),
        }],
        ..crate::bootstrap::HardwareConfig::default()
    };
    let report = crate::bootstrap::apply_config(&reg, &cfg).await;
    assert!(report.ok(), "{report}");
    assert!(
        reg.scale_ids().await.is_empty(),
        "no scale may be registered while read_weight is a stub"
    );
}

#[test]
fn read_weight_reports_unsupported_not_missing() {
    // NotFound is what an unplugged device returns. If the stub shared that
    // kind, an operator would be told to check the cable on a feature that
    // was never written, and the two would be indistinguishable in the logs.
    let scale = HidWeightScale::new(0x1234, 0x5678, "COM3".into());
    let err = scale
        .read_weight()
        .expect_err("the stub must never report a weight");
    assert!(
        matches!(err, HalError::Unsupported(_)),
        "expected Unsupported, got {err:?}"
    );
    assert!(
        err.to_string().contains("not implemented"),
        "the message must say the feature is absent: {err}"
    );
    assert!(
        err.to_string().contains("COM3"),
        "and name the device it was asked about: {err}"
    );
}

#[test]
fn device_info_returns_vendor_and_product() {
    let scale = HidWeightScale::new(0x1234, 0x5678, "COM3".into());
    let info = scale.device_info();
    assert_eq!(info.vendor, "1234");
    assert_eq!(info.model, "5678");
}

#[test]
fn device_info_includes_device_path() {
    let scale = HidWeightScale::new(0x0001, 0x0011, "/dev/hidraw0".into());
    let info = scale.device_info();
    assert_eq!(info.serial, "/dev/hidraw0");
}
