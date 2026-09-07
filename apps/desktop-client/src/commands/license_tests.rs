use super::*;
use oz_core::error::CoreError;
use oz_core::subscription::TenantSubscription;

#[test]
fn clock_tampered_serializes_camel_case() {
    let status = LicenseVerificationStatus::ClockTampered;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"clockTampered\"");
}

#[test]
fn all_variants_round_trip() {
    let variants = [
        LicenseVerificationStatus::Valid,
        LicenseVerificationStatus::Expired,
        LicenseVerificationStatus::GracePeriod,
        LicenseVerificationStatus::InvalidSignature,
        LicenseVerificationStatus::ClockTampered,
        LicenseVerificationStatus::Missing,
    ];
    for v in &variants {
        let json = serde_json::to_string(v).unwrap();
        let back: LicenseVerificationStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(v, &back, "round-trip failed for {json}");
    }
}

#[test]
fn clock_tampered_dto_is_inactive() {
    let dto = LicenseStatusDto {
        is_active: false,
        status: LicenseVerificationStatus::ClockTampered,
        tier: None,
        payload: None,
        message: Some("Clock tampering detected: test".into()),
    };
    let json = serde_json::to_string(&dto).unwrap();
    assert!(json.contains("\"clockTampered\""));
    assert!(json.contains("\"isActive\":false"));
    assert!(json.contains("Clock tampering detected"));
}

#[test]
fn generate_machine_id_returns_15_chars() {
    let id = generate_machine_id();
    assert_eq!(id.len(), 15, "machine ID must be 15 chars, got {id}");
    assert!(
        id.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        "machine ID must be lowercase alphanumeric, got {id}"
    );
}

#[test]
fn generate_machine_id_is_deterministic() {
    // The machine ID is derived from the system UUID (or a random
    // fallback), hashed via SHA-256.  On the same machine it must
    // always return the same value — the first 15 hex chars of the
    // hash are stable.
    let id1 = generate_machine_id();
    for _ in 0..10 {
        assert_eq!(
            generate_machine_id(),
            id1,
            "machine ID changed between calls"
        );
    }
}

#[test]
fn machine_id_is_persisted_in_settings() {
    use oz_core::migrations;
    let conn = migrations::fresh_db();
    let id1 = generate_machine_id();
    // Simulate what get_machine_id does: persist to Settings.
    Settings::set_batch(&conn, &[("machine_id".to_string(), id1.clone())]).unwrap();
    let id2 = Settings::get(&conn, "machine_id").unwrap().unwrap();
    assert_eq!(
        id1, id2,
        "machine ID should survive round-trip through Settings"
    );
}

#[test]
fn hardware_fingerprint_has_spec_shape_and_is_deterministic() {
    // SPEC-2026-TRIAL-LOCK: the fingerprint is "hw_" + 64 lowercase
    // hex chars (the full SHA-256 of the hardware anchor) — exactly
    // what the license server's normalizeHardwareFingerprint accepts.
    let fp1 = generate_hardware_fingerprint();
    assert!(
        fp1.starts_with("hw_") && fp1.len() == 67,
        "fingerprint must be hw_ + 64 hex, got {fp1:?} (len {})",
        fp1.len()
    );
    assert!(
        fp1[3..]
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        "fingerprint hex must be lowercase alphanumeric, got {fp1}"
    );
    for _ in 0..10 {
        assert_eq!(
            generate_hardware_fingerprint(),
            fp1,
            "hardware fingerprint changed between calls"
        );
    }
}

#[test]
fn hardware_fingerprint_is_persisted_in_settings() {
    use oz_core::migrations;
    let conn = migrations::fresh_db();
    let fp1 = generate_hardware_fingerprint();
    // Simulate what get_hardware_fingerprint does: persist to Settings.
    Settings::set_batch(&conn, &[("hardware_fingerprint".to_string(), fp1.clone())]).unwrap();
    let fp2 = Settings::get(&conn, "hardware_fingerprint")
        .unwrap()
        .unwrap();
    assert_eq!(
        fp1, fp2,
        "hardware fingerprint should survive round-trip through Settings"
    );
}

#[test]
fn clock_tamper_detected_on_future_ledger_timestamps() {
    use oz_core::migrations;
    let conn = migrations::fresh_db();

    // Insert a sale with a timestamp far in the future
    // (simulates OS clock being rolled back).
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('sale-clocktest', 'completed', 1000, 'USD', 1,
                 '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let result = TenantSubscription::validate_clock_rollback(&conn);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        matches!(err, CoreError::SystemClockTampered(_)),
        "should be SystemClockTampered, got: {err:?}"
    );
    assert!(err.to_string().contains("system clock tampered"));
}

// ── ServerLicenseStatusDto tests ────────────────────────────

#[test]
fn server_license_status_dto_camel_case() {
    let dto = ServerLicenseStatusDto {
        tenant_id: "test-tenant".into(),
        status: "active".into(),
        tier: "pro".into(),
        active: true,
        expires_at: Some("2027-01-01T00:00:00Z".into()),
        grace_until: Some("2027-01-15T00:00:00Z".into()),
        max_locations: 2,
    };
    let json = serde_json::to_string(&dto).unwrap();
    assert!(json.contains("\"tenantId\""));
    assert!(json.contains("\"expiresAt\""));
    assert!(json.contains("\"graceUntil\""));
    // The §B staged-migration rename: the wire field is now maxLocations.
    assert!(json.contains("\"maxLocations\""));
    assert!(json.contains("\"active\":true"));
}

#[test]
fn server_license_status_dto_null_optionals() {
    let dto = ServerLicenseStatusDto {
        tenant_id: "t1".into(),
        status: "canceled".into(),
        tier: "free".into(),
        active: false,
        expires_at: None,
        grace_until: None,
        max_locations: 1,
    };
    let json = serde_json::to_string(&dto).unwrap();
    assert!(json.contains("\"expiresAt\":null"));
    assert!(json.contains("\"graceUntil\":null"));
}

// ── store_subscription → TenantSubscription round-trip ───────

#[test]
fn store_subscription_updates_tenant_subscription_default() {
    use oz_core::migrations;
    let conn = migrations::fresh_db();

    // Verify bootstrap Free tier is seeded
    let sub = TenantSubscription::load(&conn, "default")
        .expect("load")
        .expect("bootstrap row should exist");
    assert_eq!(sub.tier, oz_core::SubscriptionTier::Free);

    // Simulate a Pro activation — store_subscription should
    // replace the bootstrap row with the activated tier. This payload
    // uses the NEW 1g wire name (max_locations); the alias path for
    // pre-rename payloads (max_locations) is covered by the oz-core tests.
    let payload = r#"{
        "tenant_id": "default",
        "tier_key": "pro",
        "status": "active",
        "max_locations": 2,
        "max_pos_instances": 3,
        "allowed_types": ["restaurant-pos", "store-pos", "admin"],
        "starts_at": "2026-07-12T00:00:00Z",
        "expires_at": "2027-07-12T00:00:00Z",
        "grace_until": "2027-07-26T00:00:00Z",
        "issued_at": "2026-07-12T00:00:00Z"
    }"#;

    store_subscription(&conn, "default", payload, "SIG_PRO", "oz_apikey_pro")
        .expect("store_subscription should succeed");

    let updated = TenantSubscription::load(&conn, "default")
        .expect("load")
        .expect("row should exist after update");
    assert_eq!(updated.tier, oz_core::SubscriptionTier::Pro);
    assert_eq!(updated.max_locations, 2);
    assert_eq!(updated.max_pos_instances, 3);
    assert_eq!(updated.signature, "SIG_PRO");
    assert_eq!(updated.api_key, "oz_apikey_pro");
    assert_eq!(updated.signed_payload, payload);
}

// ── RenewLicenseRequest serialization ────────────────────────

#[test]
fn renew_license_request_serializes_snake_case() {
    let req = RenewLicenseRequest {
        tenant_id: "test-tenant".into(),
        api_key: "oz_test_key".into(),
        key: "OZ-PRO-NEW-KEY".into(),
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("\"tenant_id\""));
    assert!(json.contains("\"key\""));
    assert!(json.contains("test-tenant"));
    assert!(json.contains("OZ-PRO-NEW-KEY"));
    // The api_key must NOT be serialized into the body — it travels in
    // the Authorization: Bearer header so access logs never capture it.
    assert!(
        !json.contains("api_key"),
        "api_key must stay out of the request body, got: {json}"
    );
}

#[test]
fn renew_license_request_deserializes() {
    let json = r#"{"tenant_id":"t1","api_key":"k1","key":"OZ-KEY"}"#;
    let req: RenewLicenseRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.tenant_id, "t1");
    assert_eq!(req.api_key, "k1");
    assert_eq!(req.key, "OZ-KEY");
}

#[test]
fn grace_deadline_uses_the_published_per_tier_table() {
    // §B: Free 7, Plus 14, Pro 14, Premium 30, Enterprise 60 — the same
    // table lifecycle_state() applies, so the license-status verdict and
    // the capabilities gate can never disagree on stale payloads.
    let expiry = Utc::now();
    let cases = [
        ("free", 7i64),
        ("plus", 14),
        ("pro", 14),
        ("premium", 30),
        ("enterprise", 60),
    ];
    for (tier_key, days) in cases {
        let want = expiry + chrono::Duration::days(days);
        assert_eq!(
            grace_deadline_for(tier_key, expiry),
            want,
            "tier {tier_key} must get a {days}-day window"
        );
    }
}

#[test]
fn grace_deadline_fails_closed_on_unknown_tiers() {
    // Unknown tier keys parse as Free (the shortest window) — never
    // over-credit an unrecognized payload.
    let expiry = Utc::now();
    let want = expiry + chrono::Duration::days(7);
    assert_eq!(grace_deadline_for("mystery-tier", expiry), want);
}
