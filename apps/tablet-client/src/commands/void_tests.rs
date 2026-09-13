use super::*;

#[test]
fn void_sale_args_deserialize() {
    // Wire keys are camelCase, matching the UI caller (ui/src/api/sales.ts
    // VoidSaleArgs: { saleId, userId, reason }) and the desktop shell —
    // the bridge DTO is the single wire definition. The old tablet-local
    // DTO accepted snake_case keys the UI never sends.
    let json = r#"{"saleId":"s1","userId":"u1","reason":"customer cancelled"}"#;
    let args: VoidSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.user_id, "u1");
    assert_eq!(args.reason, "customer cancelled");
}

#[test]
fn void_sale_args_deserialize_camelcase() {
    // The bridge DTO accepts both casing conventions: tauri hands the
    // command whatever the UI sent, and the UI caller sends camelCase
    // (`loggedInvoke('void_sale_scoped', { sessionToken, args: { saleId,
    // reason } })` — ui/src/api/sales.ts voidSaleScoped), matching the
    // desktop wire. The old tablet-local DTO was snake_case-only and
    // failed this exact payload with "missing field `sale_id`".
    let json = r#"{"saleId":"s4","userId":"u4","reason":"duplicate entry"}"#;
    let args: VoidSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s4");
    assert_eq!(args.user_id, "u4");
    assert_eq!(args.reason, "duplicate entry");
}

#[test]
fn void_sale_args_debug() {
    let args = VoidSaleArgs {
        sale_id: "s2".into(),
        user_id: "u2".into(),
        reason: "wrong item".into(),
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("s2"));
    assert!(debug.contains("wrong item"));
}

#[test]
fn void_sale_args_deserialize_empty_reason() {
    let json = r#"{"saleId":"s3","userId":"u3","reason":""}"#;
    let args: VoidSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s3");
    assert_eq!(args.reason, "");
}

#[test]
fn void_sale_scoped_args_match_ui_wire() {
    // The regression this slice closes: the UI sends `{ saleId, reason }`
    // (camelCase) inside `args`. The re-exported bridge DTO must accept
    // that exact shape — snake_case-only input previously failed.
    let json = r#"{"saleId":"sale-99","reason":"customer changed mind"}"#;
    let args: VoidSaleScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "sale-99");
    assert_eq!(args.reason, "customer changed mind");
}
