//! Tests for the tablet's first-run provisioning commands (ADR #56 §2.1/§2.2).
//!
//! This file REPLACED a 614-line suite built around `write_setup` and
//! `complete_setup`. Those commands are retired, so their tests could not
//! survive as written — but the coverage they carried was not all about them,
//! and the part that was not is kept below: the wire shape, which is a
//! contract with the UI rather than with the command.
//!
//! What is deliberately NOT re-tested here: the provisioning transaction
//! itself. It lives one crate over in `kasirmu_core::db::provisioning` and
//! carries 21 tests of its own — the guard, the replay, the rollback, both
//! schema CHECKs and the workspace topology. Re-asserting it through this
//! shell's shim would be the mirrored-copy failure mode the old file's own
//! doc comment warned about: a copy that passes while the real body drifts.

use super::*;

// ── Wire contract with the UI ───────────────────────────────────────

/// The JSON keys a serialized value exposes.
fn wire_keys<T: serde::Serialize>(value: &T) -> Vec<String> {
    serde_json::to_value(value)
        .expect("value must serialize")
        .as_object()
        .expect("wire shape must be a JSON object")
        .keys()
        .cloned()
        .collect()
}

#[test]
fn unprovisioned_wire_is_the_ui_tag_and_nothing_else() {
    // `ui/src/api/settings.ts` reads `state === 'unprovisioned'`. The tag name,
    // its casing and the ABSENCE of payload fields on this arm are all part of
    // that contract: a field added here would be a silent widening of the
    // branch the UI takes on a fresh install.
    let keys = wire_keys(&kasirmu_bridge::setup::FirstRunStateDto::unprovisioned());
    assert_eq!(keys, vec!["state".to_string()]);
    let json =
        serde_json::to_value(kasirmu_bridge::setup::FirstRunStateDto::unprovisioned()).unwrap();
    assert_eq!(json["state"], "unprovisioned");
}

#[test]
fn provisioned_wire_carries_exactly_what_the_shell_routes_with() {
    // The shell reads `state` plus the five fields below; `ui`'s
    // `FirstRunState` union names the same set. A rename on either side is a
    // wire break, so the key list is pinned rather than described.
    let rec = kasirmu_core::db::provisioning::ProvisioningRecord {
        terminal_id: "dev-1".into(),
        tenant_id: None,
        location_id: Some("loc-1".into()),
        owner_user_id: Some("user-1".into()),
        device_id: None,
        mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
        home_region: "global".into(),
        provisioned_at: "2026-10-05T00:00:00Z".into(),
    };
    let dto = kasirmu_bridge::setup::FirstRunStateDto::provisioned(&rec);
    let mut keys = wire_keys(&dto);
    keys.sort();
    let mut expected = vec![
        "state",
        "location_id",
        "owner_user_id",
        "mode",
        "home_region",
        "tenant_id",
    ];
    expected.sort_unstable();
    assert_eq!(keys, expected);

    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["state"], "provisioned");
    assert_eq!(json["mode"], "local");
    assert_eq!(json["home_region"], "global");
    // A `local` install carries no licence-server tenant (§2.4) — the field is
    // PRESENT and null, not absent, so the UI's optional type stays accurate.
    assert!(json["tenant_id"].is_null());
}

#[test]
fn enabled_features_wire_is_the_ui_key() {
    let result = EnabledFeaturesResult {
        features: vec!["cash-payment".into()],
    };
    assert_eq!(wire_keys(&result), vec!["features".to_string()]);
}

#[test]
fn provision_device_args_deserialize_from_the_ui_payload() {
    // The exact object `ui/src/api/settings.ts` sends. `location_kind` and
    // `mode` are lowercase because both enums are `rename_all = "lowercase"`
    // in core; a casing change there would break every provision call, so the
    // payload is pinned as the UI writes it.
    let payload = serde_json::json!({
        "terminal_id": "dev-1",
        "location_name": "Sunset Cafe",
        "currency": "IDR",
        "timezone": "Asia/Jakarta",
        "owner_username": "owner",
        "owner_display_name": "Adi",
        "owner_pin": "1234",
        "preset": "cafe",
        "features": ["cash-payment"],
        "location_kind": "restaurant",
        "mode": "local"
    });
    let args: kasirmu_bridge::setup::ProvisionDeviceArgs =
        serde_json::from_value(payload).expect("the UI payload must deserialize");
    assert_eq!(args.terminal_id, "dev-1");
    assert_eq!(
        args.mode,
        kasirmu_core::db::provisioning::ProvisioningMode::Local
    );
    assert_eq!(
        args.location_kind,
        kasirmu_core::db::provisioning::LocationKind::Restaurant
    );
    // A `local` install omits these; the UI's optional fields must stay optional.
    assert!(args.tenant_id.is_none());
    assert!(args.device_credential_id.is_none());
}

#[test]
fn a_linked_provision_payload_carries_its_tenant_and_credential() {
    let payload = serde_json::json!({
        "terminal_id": "dev-2",
        "location_name": "Store",
        "currency": "IDR",
        "timezone": "Asia/Jakarta",
        "owner_username": "owner",
        "owner_display_name": "Adi",
        "owner_pin": "1234",
        "preset": "simple-retail",
        "features": [],
        "location_kind": "retail",
        "mode": "linked",
        "tenant_id": "tenant-abc",
        "device_credential_id": "cred-1"
    });
    let args: kasirmu_bridge::setup::ProvisionDeviceArgs = serde_json::from_value(payload).unwrap();
    assert_eq!(args.tenant_id.as_deref(), Some("tenant-abc"));
    assert_eq!(args.device_credential_id.as_deref(), Some("cred-1"));
}
