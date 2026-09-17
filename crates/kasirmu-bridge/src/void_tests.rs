//! Unit tests for the void-sale command body (Wave-D test relocation:
//! moved out of `apps/desktop-tauri/src/commands/void_tests.rs`).
//!
//! Mounted at the foot of `void.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the args DTOs directly. The desktop file
//! exercised session validation through `AppState`; here the same
//! rejection goes through the bridge context's shared session map. The
//! frontend camelCase parity assertions (Bug #13) are verbatim.

use super::*;
use crate::testing::TestBridge;

#[test]
fn void_sale_args_deserialize() {
    // Uses camelCase — the exact format the frontend sends
    // (ui/src/api/sales.ts VoidSaleArgs: { saleId, userId, reason }).
    let json = r##"{"saleId":"s1","userId":"u1","reason":"Wrong item"}"##;
    let args: VoidSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.user_id, "u1");
    assert_eq!(args.reason, "Wrong item");
}

#[test]
fn void_sale_args_debug() {
    let args = VoidSaleArgs {
        sale_id: "s2".into(),
        user_id: "u2".into(),
        reason: "Test".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("s2"));
    assert!(d.contains("Test"));
}

#[test]
fn void_sale_scoped_args_deserialize() {
    // camelCase — the exact format the frontend sends for the
    // scoped variant ({ saleId, reason }).
    let json = r##"{"saleId":"s1","reason":"Wrong item"}"##;
    let args: VoidSaleScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.reason, "Wrong item");
}

#[test]
fn void_sale_scoped_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn void_sale_args_deserialize_empty_reason() {
    // camelCase — the exact format the frontend sends.
    let json = r##"{"saleId":"s3","userId":"u3","reason":""}"##;
    let args: VoidSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s3");
    assert_eq!(args.reason, "");
}

// ── Frontend camelCase parity (Bug #13) ──────────────────────────────
//
// The frontend (ui/src/api/sales.ts VoidSaleArgs) sends camelCase keys:
//   { saleId, userId, reason }
// The frontend VoidSaleScopedArgs + the scoped invoke send:
//   { saleId, reason }
// wrapped in { args: { ... } }. Tauri auto-converts bare command
// params (sessionToken) but does NOT rename struct fields — serde
// uses the exact field names. Without #[serde(rename_all =
// "camelCase")], serde looks for "sale_id"/"user_id" and fails on
// the real frontend payload. The tests above only pass because
// they use snake_case — a false-positive coverage gap.

#[test]
fn void_sale_args_deserialize_frontend_camelcase() {
    // Exact payload shape the frontend sends (ui/src/api/sales.ts:332).
    let json = r##"{"saleId":"s1","userId":"u1","reason":"Wrong item"}"##;
    let args: VoidSaleArgs = serde_json::from_str(json)
        .expect("VoidSaleArgs must accept the frontend's camelCase payload");
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.user_id, "u1");
    assert_eq!(args.reason, "Wrong item");
}

#[test]
fn void_sale_scoped_args_deserialize_frontend_camelcase() {
    // Exact payload shape the frontend sends for the scoped variant
    // (ui/src/api/sales.ts:337 -> { args: { saleId, reason } }).
    let json = r##"{"saleId":"s1","reason":"Wrong item"}"##;
    let args: VoidSaleScopedArgs = serde_json::from_str(json)
        .expect("VoidSaleScopedArgs must accept the frontend's camelCase payload");
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.reason, "Wrong item");
}
