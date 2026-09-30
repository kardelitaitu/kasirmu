//! Scale command unit tests (Wave-D test relocation: moved out of
//! `apps/desktop-tauri/src/commands/scale_tests.rs`).
//!
//! Mounted at the foot of `scale.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs directly. The tests are pure DTO
//! serialisation assertions with no `AppState` coupling; the bodies port
//! verbatim.
use super::*;

#[test]
fn scale_device_info_debug() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x0922".into(),
        product_id: "0x8001".into(),
        device_path: "/dev/hidraw0".into(),
    };
    let debug = format!("{info:?}");
    assert!(debug.contains("0x0922"));
    assert!(debug.contains("0x8001"));
    assert!(debug.contains("/dev/hidraw0"));
}

#[test]
fn scale_device_info_serialize() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x067B".into(),
        product_id: "0x2303".into(),
        device_path: "COM3".into(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "0x067B");
    assert_eq!(json["product_id"], "0x2303");
    assert_eq!(json["device_path"], "COM3");
}

#[test]
fn scale_device_info_empty_fields() {
    let info = ScaleDeviceInfo {
        vendor_id: String::new(),
        product_id: String::new(),
        device_path: String::new(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "");
    assert_eq!(json["product_id"], "");
    assert_eq!(json["device_path"], "");
}

// ── read_scale_weight (unscoped) ────────────────────────────────────

#[tokio::test]
async fn an_unscoped_read_with_no_scale_is_none_not_an_error() {
    // The tablet shell exposes this door, so the body lives here rather than
    // being copied into the shell. No scale bound is a defined state.
    let bridge = crate::testing::TestBridge::new();
    let ctx = bridge.ctx();
    let reading = read_scale_weight(&ctx).await.unwrap();
    assert!(reading.is_none());
}

#[tokio::test]
async fn an_unscoped_read_does_not_need_a_session() {
    // Deliberately unlike its scoped twin: this body is the tablet's
    // unscoped door and performs no resolution at all, so an empty session
    // store must not turn into an InvalidSession error.
    let bridge = crate::testing::TestBridge::new();
    let ctx = bridge.ctx();
    assert!(read_scale_weight(&ctx).await.is_ok());
}

// ── list_scale_devices_scoped ───────────────────────────────────────

use kasirmu_hal::drivers::mock::MockWeightScale;
use kasirmu_hal::types::DeviceInfo;
use std::sync::Arc;

/// A bridge with a valid `tok` session and no scale registered.
fn signed_in(bridge: crate::testing::TestBridge) -> crate::testing::TestBridge {
    bridge.sessions().write().unwrap().insert(
        "tok".into(),
        kasirmu_core::session::SessionContext::new(
            "user-1".into(),
            "role-1".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

/// A signed-in bridge whose registry holds one scale under `id`.
async fn bridge_with_scale(id: &str) -> crate::testing::TestBridge {
    let bridge = signed_in(crate::testing::TestBridge::new());
    bridge
        .registry()
        .register_scale(
            id,
            Arc::new(MockWeightScale::with_info(DeviceInfo::new(
                "0x0922",
                "0x8001",
                "/dev/hidraw0",
            ))),
        )
        .await;
    bridge
}

#[tokio::test]
async fn a_registered_scale_is_reported_with_its_identity() {
    let bridge = bridge_with_scale("default").await;
    let ctx = bridge.ctx();
    let devices = list_scale_devices_scoped(&ctx, "tok").await.unwrap();
    assert_eq!(devices.len(), 1, "the registered scale must be listed");
    assert_eq!(devices[0].vendor_id, "0x0922");
    assert_eq!(devices[0].product_id, "0x8001");
    assert_eq!(devices[0].device_path, "/dev/hidraw0");
}

#[tokio::test]
async fn a_register_with_no_scale_reports_an_empty_list_not_an_error() {
    // Absence is a defined state, not a failure: the command resolves the
    // session first (a bad token is still an InvalidSession error) and then
    // reports an empty list, which is what a "no scale configured" UI
    // renders.
    let bridge = signed_in(crate::testing::TestBridge::new());
    let ctx = bridge.ctx();
    let devices = list_scale_devices_scoped(&ctx, "tok").await.unwrap();
    assert!(devices.is_empty());
}

#[tokio::test]
async fn listing_never_silently_omits_a_listed_scale() {
    // The defect this guards: the loop used to walk `scale_ids()` and
    // `if let Some(..)` each one, so a lookup that came back empty was
    // DROPPED from the result — a shorter list than the registry holds, with
    // no error and no log. The invariant the fixed body holds is that the
    // count matches the snapshot exactly, whatever the registry holds; a
    // silent skip can only ever make it smaller.
    let bridge = signed_in(crate::testing::TestBridge::new());
    bridge
        .registry()
        .register_scale("default", Arc::new(MockWeightScale::new()))
        .await;
    bridge
        .registry()
        .register_scale("front", Arc::new(MockWeightScale::new()))
        .await;
    let ctx = bridge.ctx();
    let listed = list_scale_devices_scoped(&ctx, "tok").await.unwrap();
    assert_eq!(
        listed.len(),
        ctx.registry.scale_ids().await.len(),
        "the listed devices must account for every id the registry reports"
    );
    assert_eq!(listed.len(), 2, "both registered scales must be listed");
}

#[tokio::test]
async fn the_scale_snapshot_pairs_every_id_with_its_driver() {
    // `scales()` is what makes the list impossible to shorten silently: it
    // hands back the id and the driver from the SAME read, so there is no
    // second lookup that can come back empty. A regression that went back to
    // `scale_ids()` + `scale(id)` would still compile, so pin the pairing.
    let bridge = bridge_with_scale("default").await;
    let ctx = bridge.ctx();
    let snapshot = ctx.registry.scales().await;
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].0, "default");
    assert!(
        snapshot[0].1.is_some(),
        "a registered scale must arrive with its driver, not as an id alone"
    );
    assert_eq!(
        snapshot[0].1.as_ref().unwrap().device_info().serial,
        "/dev/hidraw0"
    );
}

#[tokio::test]
async fn listing_refuses_an_unknown_session() {
    let bridge = bridge_with_scale("default").await;
    let ctx = bridge.ctx();
    let err = list_scale_devices_scoped(&ctx, "nope").await.unwrap_err();
    assert!(matches!(err, BridgeError::InvalidSession));
}
