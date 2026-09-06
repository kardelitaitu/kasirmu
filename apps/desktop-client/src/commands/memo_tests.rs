use super::*;

#[test]
fn memo_dto_uses_camel_case_wire_fields() {
    let dto = MemoDto {
        id: "m-1".into(),
        tenant_id: "default".into(),
        location_id: Some("loc-1".into()),
        author_user_id: "user-1".into(),
        author_role: "role-manager".into(),
        title: "Heads up".into(),
        body: "Close early".into(),
        status: "published".into(),
        duration: "24h".into(),
        revision: 1,
        published_at: Some("2026-09-06T00:00:00.000Z".into()),
        expires_at: Some("2026-09-07T00:00:00.000Z".into()),
        created_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(dto).unwrap();
    assert_eq!(json["tenantId"], "default");
    assert_eq!(json["locationId"], "loc-1");
    assert_eq!(json["authorUserId"], "user-1");
    assert_eq!(json["authorRole"], "role-manager");
    assert_eq!(json["publishedAt"], "2026-09-06T00:00:00.000Z");
    assert_eq!(json["expiresAt"], "2026-09-07T00:00:00.000Z");
    assert_eq!(json["createdAt"], "2026-09-06T00:00:00.000Z");
    assert!(json.get("tenant_id").is_none());
    assert!(json.get("location_id").is_none());
}

#[test]
fn memo_dto_org_scope_serializes_location_id_null() {
    let dto = MemoDto {
        id: "m-2".into(),
        tenant_id: "default".into(),
        location_id: None,
        author_user_id: "user-1".into(),
        author_role: "role-owner".into(),
        title: "Org".into(),
        body: "All terminals".into(),
        status: "draft".into(),
        duration: "12h".into(),
        revision: 1,
        published_at: None,
        expires_at: None,
        created_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(dto).unwrap();
    assert!(json["locationId"].is_null());
    assert!(json["publishedAt"].is_null());
}

#[test]
fn active_memo_dto_nests_memo_and_delivery_status() {
    let memo = Memo {
        id: "m-3".into(),
        tenant_id: "default".into(),
        location_id: None,
        author_user_id: "user-1".into(),
        author_role: "role-owner".into(),
        title: "T".into(),
        body: "B".into(),
        status: oz_core::memo::MemoStatus::Published,
        duration: oz_core::memo::MemoDuration::Hours24,
        revision: 1,
        published_at: None,
        expires_at: None,
        stopped_at: None,
        stopped_by: None,
        created_at: "2026-09-06T00:00:00.000Z".into(),
        updated_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let active = ActiveMemo {
        memo,
        delivery_status: oz_core::memo::DeliveryStatus::Pending,
    };
    let json = serde_json::to_value(ActiveMemoDto::from(active)).unwrap();
    assert_eq!(json["deliveryStatus"], "pending");
    assert_eq!(json["memo"]["status"], "published");
    assert_eq!(json["memo"]["duration"], "24h");
}

#[test]
fn create_args_deserialize_camel_case_and_optional_fields() {
    let args: CreateMemoArgs = serde_json::from_value(serde_json::json!({
        "title": "Heads up",
        "body": "Close early tonight",
        "duration": "3d"
    }))
    .unwrap();
    assert_eq!(args.title, "Heads up");
    assert_eq!(args.duration.as_deref(), Some("3d"));
    assert_eq!(args.location_id, None);
}

#[test]
fn create_args_duration_defaults_to_none_when_absent() {
    // Omitted duration ⇒ None ⇒ the command applies DEFAULT_MEMO_DURATION.
    let args: CreateMemoArgs = serde_json::from_value(serde_json::json!({
        "title": "T",
        "body": "B"
    }))
    .unwrap();
    assert_eq!(args.duration, None);
    assert_eq!(
        oz_core::memo::DEFAULT_MEMO_DURATION,
        oz_core::memo::MemoDuration::Hours24
    );
}

#[test]
fn create_args_rejects_missing_required_fields() {
    // title and body are required (no serde default).
    let missing_body: Result<CreateMemoArgs, _> = serde_json::from_value(serde_json::json!({
        "title": "T"
    }));
    assert!(missing_body.is_err());
}
