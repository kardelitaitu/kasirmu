use super::*;

#[test]
fn active_memo_dto_nests_memo_and_delivery_status() {
    let memo = Memo {
        id: "m-1".into(),
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
    assert_eq!(json["memo"]["authorRole"], "role-owner");
    assert!(json["memo"].get("author_role").is_none());
}

#[test]
fn memo_display_dto_carries_server_issued_cadence() {
    // The display read serves the cadence alongside the memos so the UI never
    // hardcodes the intervals: the KDS value is derived as 2 × the base in
    // `oz_core::memo`, and this test pins both the envelope shape and the 2×
    // relationship across the wire.
    let dto = MemoDisplayDto {
        memos: vec![],
        cadence: MemoCadenceDto {
            base_interval_secs: oz_core::memo::NOTIFICATION_BASE_INTERVAL_SECS,
            kds_interval_secs: oz_core::memo::kds_notification_interval_secs(),
        },
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["cadence"]["baseIntervalSecs"], 900);
    assert_eq!(json["cadence"]["kdsIntervalSecs"], 1_800);
    assert_eq!(
        json["cadence"]["kdsIntervalSecs"].as_i64().unwrap(),
        2 * json["cadence"]["baseIntervalSecs"].as_i64().unwrap()
    );
    assert!(json["memos"].is_array());
}

#[test]
fn memo_dto_org_scope_serializes_location_id_null() {
    let memo = Memo {
        id: "m-2".into(),
        tenant_id: "default".into(),
        location_id: None,
        author_user_id: "user-1".into(),
        author_role: "role-manager".into(),
        title: "Org".into(),
        body: "All terminals".into(),
        status: oz_core::memo::MemoStatus::Published,
        duration: oz_core::memo::MemoDuration::Days3,
        revision: 2,
        published_at: Some("2026-09-06T00:00:00.000Z".into()),
        expires_at: Some("2026-09-09T00:00:00.000Z".into()),
        stopped_at: None,
        stopped_by: None,
        created_at: "2026-09-06T00:00:00.000Z".into(),
        updated_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(MemoDto::from(memo)).unwrap();
    assert!(json["locationId"].is_null());
    assert_eq!(json["duration"], "3d");
    assert_eq!(json["revision"], 2);
    assert_eq!(json["expiresAt"], "2026-09-09T00:00:00.000Z");
}
