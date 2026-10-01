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
}

#[test]
fn scale_device_info_serialize() {
    let info = ScaleDeviceInfo {
        vendor_id: "0x1234".into(),
        product_id: "0x5678".into(),
        device_path: "/dev/ttyUSB0".into(),
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["vendor_id"], "0x1234");
    assert_eq!(json["product_id"], "0x5678");
}

#[test]
fn scale_device_info_empty_fields() {
    let info = ScaleDeviceInfo {
        vendor_id: String::new(),
        product_id: String::new(),
        device_path: String::new(),
    };
    assert_eq!(info.vendor_id, "");
}

#[test]
fn the_tablet_scale_bodies_delegate_and_carry_no_registry_walk() {
    // The native `list_scale_devices_scoped` walked `scale_ids()` and skipped
    // any id that did not resolve, so a scale could vanish from the list with
    // no error. Delegating to the bridge is what removes that second copy;
    // this pin keeps a copy from creeping back in.
    //
    // Only the CODE is inspected, never the module documentation. The doc
    // comment above legitimately names `scale_ids()` while explaining what
    // was removed, so a whole-file scan would fail on a correct file — and a
    // pin that fails on a correct file is worse than no pin, because the next
    // person deletes it. Everything before the first `use` is prose.
    const SOURCE: &str = include_str!("scale.rs");
    let code = match SOURCE.find("use tauri::") {
        Some(at) => &SOURCE[at..],
        None => {
            panic!("scale.rs no longer starts its imports with `use tauri::`; revisit this pin")
        }
    };
    assert!(
        !code.contains("scale_ids()"),
        "the tablet must not walk the registry itself; delegate to kasirmu_bridge::scale"
    );
    assert!(
        !code.contains("registry.scale("),
        "the tablet must not resolve scales itself; delegate to kasirmu_bridge::scale"
    );
    assert!(
        code.contains("kasirmu_bridge::scale::list_scale_devices_scoped"),
        "the scoped list must come from the bridge"
    );
    assert!(
        code.contains("kasirmu_bridge::scale::read_scale_weight_scoped"),
        "the scoped read must come from the bridge"
    );
    assert!(
        code.contains("kasirmu_bridge::scale::read_scale_weight("),
        "the unscoped read must come from the bridge"
    );
}
