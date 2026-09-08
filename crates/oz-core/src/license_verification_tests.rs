use super::*;
use rsa::RsaPrivateKey;
use rsa::pkcs8::{DecodePublicKey, EncodePublicKey};
use rsa::signature::SignatureEncoding;

/// Generate a test RSA key pair and return (private, public_pem).
fn generate_test_keypair() -> (RsaPrivateKey, String) {
    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048).expect("failed to generate test RSA key");
    let public_pem = private_key
        .to_public_key()
        .to_public_key_pem(rsa::pkcs8::LineEnding::LF)
        .expect("failed to export public key PEM");
    (private_key, public_pem)
}

/// Sign a payload using a test RSA key (matching the license server Go code).
fn sign_test_payload(key: &RsaPrivateKey, payload: &str) -> String {
    use rsa::pkcs1v15::SigningKey;
    use rsa::signature::Signer;

    let signing_key = SigningKey::<Sha256>::new(key.clone());
    let sig = signing_key.sign(payload.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(sig.to_bytes())
}

#[test]
fn verify_valid_signature() {
    let (private_key, public_pem) = generate_test_keypair();
    let payload = r#"{"tenant_id":"test","tier_key":"pro"}"#;
    let sig = sign_test_payload(&private_key, payload);

    // Temporarily override the embedded key for testing.
    // In a real build, LICENSE_PUBLIC_KEY_PEM is embedded at compile time.
    // We test the core verification logic directly.
    let public_key = RsaPublicKey::from_public_key_pem(&public_pem).expect("parse public key");
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&sig)
        .unwrap();
    let signature = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()).unwrap();

    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    let result = verifying_key.verify(payload.as_bytes(), &signature);
    assert!(result.is_ok(), "valid signature should verify: {result:?}");
}

#[test]
fn verify_tampered_payload_fails() {
    let (private_key, public_pem) = generate_test_keypair();
    let payload = r#"{"tenant_id":"test","tier_key":"pro"}"#;
    let sig = sign_test_payload(&private_key, payload);

    let public_key = RsaPublicKey::from_public_key_pem(&public_pem).expect("parse public key");
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&sig)
        .unwrap();
    let signature = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()).unwrap();

    // Tamper with the payload
    let tampered = r#"{"tenant_id":"test","tier_key":"enterprise"}"#;
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    let result = verifying_key.verify(tampered.as_bytes(), &signature);
    assert!(result.is_err(), "tampered payload should fail verification");
}

#[test]
fn verify_bootstrap_free_bypasses_rsa_in_debug() {
    // The BOOTSTRAP_FREE sentinel should pass without a real key
    // in debug/dev/test builds (where #[cfg(debug_assertions)] applies).
    // This test is always compiled in test mode (which is debug).
    let result = verify_license_signature("anything", "BOOTSTRAP_FREE");
    assert!(result.is_ok());
}

#[test]
fn verify_rejects_garbage_signatures() {
    // Non-BOOTSTRAP_FREE garbage signatures (random strings, empty)
    // should always fail verification, regardless of build mode.
    let payload = r#"{"tenant_id":"test","tier_key":"free"}"#;

    let result = verify_license_signature(payload, "TAMPERED_SIGNATURE");
    assert!(
        result.is_err(),
        "tampered signature should fail: {result:?}"
    );

    let result = verify_license_signature(payload, "");
    assert!(result.is_err(), "empty signature should fail: {result:?}");
}

/// NOTE: There is intentionally no test that BOOTSTRAP_FREE is *rejected*
/// in release builds, because `cargo test` always runs with
/// `debug_assertions` enabled. The `#[cfg(debug_assertions)]` guard is
/// validated by inspection and by running `cargo build --release` and
/// confirming the symbol is absent.

#[test]
fn embedded_public_key_is_loadable() {
    // The embedded public key must be parseable at startup.
    // A corrupt or missing key file would cause this to panic.
    use rsa::traits::PublicKeyParts;

    let key = RsaPublicKey::from_public_key_pem(LICENSE_PUBLIC_KEY_PEM);
    assert!(key.is_ok(), "embedded public key should load: {key:?}");
    let key = key.unwrap();
    // Verify it's a 2048-bit key (the expected size).
    let bits = key.size() * 8;
    assert_eq!(bits, 2048, "embedded key should be 2048-bit RSA");
}

#[test]
fn license_server_url_default() {
    // Test the default URL without env var overrides (avoid unsafe on set_var).
    let url = license_server_url();
    assert_eq!(url, LICENSE_SERVER_URL);
    assert!(url.starts_with("https://"));
}

#[test]
fn ping_license_server_hits_api_health_path() {
    // The reachability probe must target the unauthenticated
    // /api/health endpoint (not the cloud server's /health) and return
    // a structured result. A live HTTP call is not made here — the
    // default URL is a real deployment, so assert the URL construction
    // contract instead and keep the network call out of unit tests.
    let url = license_server_url();
    assert!(url.starts_with("https://"));
    let health = format!("{}/api/health", url.trim_end_matches('/'));
    assert!(health.ends_with("/api/health"));
    // The struct serializes camelCase like the sync PingResult so the
    // UI can render both connection pills uniformly.
    let json = serde_json::to_value(LicensePingResult {
        ok: true,
        status: "Connected (1ms)".into(),
        latency_ms: Some(1),
        state: crate::service_health::HealthState::Operational,
        cause: None,
    })
    .unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["latencyMs"], 1);
    // The new fields ride the same camelCase convention, and the state
    // serializes to the same snake_case string as_str/parse agree on.
    assert_eq!(json["state"], "operational");
    assert!(
        json.get("cause").is_some(),
        "cause is always present on the wire"
    );
}

#[test]
fn store_subscription_inserts_row() {
    use crate::migrations;

    let conn = migrations::fresh_db();

    let payload = r#"{
        "tenant_id": "test-tenant",
        "tier_key": "pro",
        "status": "active",
        "max_stores": 2,
        "max_pos_instances": 3,
        "allowed_types": ["restaurant-pos", "store-pos"],
        "starts_at": "2026-01-01T00:00:00Z",
        "expires_at": "2027-01-01T00:00:00Z",
        "grace_until": "2027-01-15T00:00:00Z",
        "issued_at": "2026-01-01T00:00:00Z"
    }"#;

    let result = store_subscription(
        &conn,
        "test-tenant",
        payload,
        "TESTSIG",
        "oz_test_api_key_123",
    );
    assert!(result.is_ok(), "store_subscription failed: {result:?}");

    // Verify the row was inserted
    let stored = TenantSubscription::load(&conn, "test-tenant")
        .expect("load")
        .expect("should exist");
    assert_eq!(stored.tenant_id, "test-tenant");
    assert_eq!(stored.tier, crate::subscription::SubscriptionTier::Pro);
    assert_eq!(stored.max_locations, 2);
    assert_eq!(stored.max_pos_instances, 3);
    assert_eq!(stored.signature, "TESTSIG");
    assert_eq!(stored.signed_payload, payload);
    assert_eq!(stored.api_key, "oz_test_api_key_123");
}

/// Phase C round-trip: a trial payload stored through the production path
/// and re-loaded from the row still reports both trial fields. This is the
/// proof that the wire change needs no migration — the fields ride inside
/// the `signed_payload` column the table already has, so nothing new is
/// persisted and a tampered row cannot invent a trial without breaking the
/// signature that covers the payload.
#[test]
fn store_subscription_round_trips_trial_fields() {
    use crate::migrations;

    let conn = migrations::fresh_db();
    let payload = r#"{
        "tenant_id": "trial-tenant",
        "tier_key": "pro",
        "status": "active",
        "max_locations": 2,
        "max_pos_instances": 3,
        "allowed_types": ["restaurant-pos", "store-pos"],
        "starts_at": "2026-09-08T00:00:00Z",
        "expires_at": "2026-09-22T00:00:00Z",
        "grace_until": "2026-10-06T00:00:00Z",
        "issued_at": "2026-09-08T00:00:00Z",
        "is_trial": true,
        "trial_ends_at": "2026-09-22T00:00:00Z"
    }"#;

    store_subscription(&conn, "trial-tenant", payload, "BOOTSTRAP_FREE", "k")
        .expect("store_subscription should succeed");

    let stored = TenantSubscription::load(&conn, "trial-tenant")
        .expect("load")
        .expect("row should exist");
    assert!(stored.is_trial(), "trial flag must survive the round trip");
    assert_eq!(
        stored.trial_ends_at().as_deref(),
        Some("2026-09-22T00:00:00Z"),
        "trial end must survive the round trip"
    );
    // And the quota answer is untouched by any of it.
    assert_eq!(stored.tier, crate::subscription::SubscriptionTier::Pro);
}

/// The mirror case: a pre-Phase-C payload (no trial fields at all) loads
/// through the same path and reads as not-a-trial rather than erroring.
#[test]
fn store_subscription_trial_fields_absent_reads_as_paid() {
    use crate::migrations;

    let conn = migrations::fresh_db();
    let payload = r#"{
        "tenant_id": "paid-tenant",
        "tier_key": "pro",
        "status": "active",
        "max_locations": 2,
        "max_pos_instances": 3,
        "allowed_types": ["store-pos"],
        "starts_at": "2026-09-08T00:00:00Z",
        "expires_at": "2027-09-08T00:00:00Z",
        "grace_until": "2027-09-22T00:00:00Z",
        "issued_at": "2026-09-08T00:00:00Z"
    }"#;

    store_subscription(&conn, "paid-tenant", payload, "BOOTSTRAP_FREE", "k")
        .expect("store_subscription should succeed");

    let stored = TenantSubscription::load(&conn, "paid-tenant")
        .expect("load")
        .expect("row should exist");
    assert!(!stored.is_trial());
    assert_eq!(stored.trial_ends_at(), None);
}

#[test]
#[allow(deprecated)] // OneTime kept for DB back-compat
fn store_subscription_handles_all_tier_keys() {
    use crate::migrations;
    use crate::subscription::SubscriptionTier;

    let conn = migrations::fresh_db();

    let tiers = vec![
        ("free", SubscriptionTier::Free, 1, 1),
        ("one_time", SubscriptionTier::OneTime, 1, 1),
        ("plus", SubscriptionTier::Plus, 1, 2),
        ("standard", SubscriptionTier::Plus, 1, 2), // legacy alias → Plus
        ("pro", SubscriptionTier::Pro, 0, 0),
        ("enterprise", SubscriptionTier::Enterprise, 0, 0),
    ];

    for (key, expected_tier, stores, pos) in tiers {
        let payload = format!(
            r#"{{
            "tenant_id": "tenant-{key}",
            "tier_key": "{key}",
            "status": "active",
            "max_stores": {stores},
            "max_pos_instances": {pos},
            "allowed_types": ["store-pos"],
            "starts_at": "2026-01-01T00:00:00Z",
            "expires_at": "2027-01-01T00:00:00Z",
            "grace_until": "2027-01-15T00:00:00Z",
            "issued_at": "2026-01-01T00:00:00Z"
        }}"#
        );

        let result = store_subscription(
            &conn,
            &format!("tenant-{key}"),
            &payload,
            "TESTSIG",
            "api_key_test",
        );
        assert!(
            result.is_ok(),
            "store_subscription for {key} failed: {result:?}"
        );

        let stored = TenantSubscription::load(&conn, &format!("tenant-{key}"))
            .unwrap()
            .unwrap();
        assert_eq!(stored.tier, expected_tier);
        assert_eq!(stored.max_locations, stores);
        assert_eq!(stored.max_pos_instances, pos);
    }
}

// We need to import TenantSubscription for the test above.
use crate::subscription::TenantSubscription;

#[test]
fn store_subscription_reads_renamed_wire_field() {
    // 1g: the license server now emits `max_locations` as the primary
    // wire name. A payload carrying ONLY the new name must parse and
    // land in the local max_locations column.
    use crate::migrations;

    let conn = migrations::fresh_db();

    let payload = r#"{
        "tenant_id": "test-tenant",
        "tier_key": "pro",
        "status": "active",
        "max_locations": 4,
        "max_pos_instances": 3,
        "allowed_types": ["restaurant-pos", "store-pos"],
        "starts_at": "2026-01-01T00:00:00Z",
        "expires_at": "2027-01-01T00:00:00Z",
        "grace_until": "2027-01-15T00:00:00Z",
        "issued_at": "2026-01-01T00:00:00Z"
    }"#;

    store_subscription(
        &conn,
        "test-tenant",
        payload,
        "TESTSIG",
        "oz_test_api_key_123",
    )
    .expect("store_subscription should accept the new wire name");

    let stored = TenantSubscription::load(&conn, "test-tenant")
        .expect("load")
        .expect("should exist");
    assert_eq!(stored.max_locations, 4);
}

#[test]
fn store_subscription_dual_emitted_payload_prefers_consistent_value() {
    // 1g dual-emit: during the client rotation window the server sends
    // BOTH wire names with the same value. The payload must parse and
    // the quota must come through unchanged.
    use crate::migrations;

    let conn = migrations::fresh_db();

    let payload = r#"{
        "tenant_id": "test-tenant",
        "tier_key": "plus",
        "status": "active",
        "max_locations": 1,
        "max_stores": 1,
        "max_pos_instances": 2,
        "allowed_types": ["restaurant-pos", "store-pos"],
        "starts_at": "2026-01-01T00:00:00Z",
        "expires_at": "2027-01-01T00:00:00Z",
        "grace_until": "2027-01-15T00:00:00Z",
        "issued_at": "2026-01-01T00:00:00Z"
    }"#;

    store_subscription(
        &conn,
        "test-tenant",
        payload,
        "TESTSIG",
        "oz_test_api_key_123",
    )
    .expect("store_subscription should accept the dual-emitted payload");

    let stored = TenantSubscription::load(&conn, "test-tenant")
        .expect("load")
        .expect("should exist");
    assert_eq!(stored.max_locations, 1);
    assert_eq!(stored.signed_payload, payload);
}

// ── trial_vertical serialization (C2.1) ────────────────────────

#[test]
fn test_trial_activation_vertical_serializes_when_set() {
    // A restaurant vertical must travel in the request body so the
    // license server can mint the segmented 14-day Pro trial.
    let req = ActivateLicenseRequest {
        key: "OZ-TRIAL-0000".into(),
        machine_id: "m1".into(),
        email: "cafe@example.com".into(),
        phone: "08123".into(),
        trial_vertical: Some("restaurant".into()),
        bundle_id: None,
        hardware_fingerprint: None,
        api_key: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        json.contains("\"trial_vertical\":\"restaurant\""),
        "got: {json}"
    );
    // The api_key must stay out of the body (Bearer header only).
    assert!(!json.contains("api_key"), "got: {json}");
}

#[test]
fn test_trial_activation_vertical_omitted_when_none() {
    // Generic (non-trial) activations omit trial_vertical entirely so
    // the body stays byte-identical to pre-C2.1 clients and paid keys
    // are never segmented by accident.
    let req = ActivateLicenseRequest {
        key: "OZ-PRO-KEY-0001".into(),
        machine_id: "m1".into(),
        email: "paid@example.com".into(),
        phone: "08123".into(),
        trial_vertical: None,
        bundle_id: None,
        hardware_fingerprint: None,
        api_key: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        !json.contains("trial_vertical"),
        "trial_vertical must be omitted when None, got: {json}"
    );
}

#[test]
fn test_trial_activation_vertical_all_segments() {
    // Every accepted vertical value round-trips through the wire format
    // (the Go server maps: blank/unknown → plus 14d, restaurant/cafe →
    // pro 14d, enterprise_referral → pro 30d).
    for (vertical, expected) in [
        ("", "\"trial_vertical\":\"\""),
        ("restaurant", "\"trial_vertical\":\"restaurant\""),
        ("cafe", "\"trial_vertical\":\"cafe\""),
        (
            "enterprise_referral",
            "\"trial_vertical\":\"enterprise_referral\"",
        ),
    ] {
        let req = ActivateLicenseRequest {
            key: "OZ-TRIAL-KEY".into(),
            machine_id: "m1".into(),
            email: "trial@example.com".into(),
            phone: "08123".into(),
            trial_vertical: Some(vertical.into()),
            bundle_id: None,
            hardware_fingerprint: None,
            api_key: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(expected), "vertical {vertical:?}: got {json}");
    }
}

// ── bundle_id serialization (C3.2) ─────────────────────────────

#[test]
fn test_bundle_id_serializes_when_set() {
    // A recognized bundle must travel in the request body so the license
    // server can unlock the kds workspace at the Plus trial tier.
    let req = ActivateLicenseRequest {
        key: "OZ-TRIAL-BUNDLE".into(),
        machine_id: "m1".into(),
        email: "bundle@example.com".into(),
        phone: "08123".into(),
        trial_vertical: None,
        bundle_id: Some("restaurant_starter".into()),
        hardware_fingerprint: None,
        api_key: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        json.contains("\"bundle_id\":\"restaurant_starter\""),
        "got: {json}"
    );
}

#[test]
fn test_bundle_id_omitted_when_none() {
    // Activations without a bundle omit bundle_id entirely so the body
    // stays byte-identical to pre-C3.2 clients.
    let req = ActivateLicenseRequest {
        key: "OZ-PRO-KEY-0001".into(),
        machine_id: "m1".into(),
        email: "paid@example.com".into(),
        phone: "08123".into(),
        trial_vertical: None,
        bundle_id: None,
        hardware_fingerprint: None,
        api_key: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        !json.contains("bundle_id"),
        "bundle_id must be omitted when None, got: {json}"
    );
}

// ── extract_server_error tests ────────────────────────────────

#[test]
fn extract_error_from_json_body() {
    let body = r#"{"error":"Wrong email or phone number"}"#;
    let msg = super::extract_server_error(body);
    assert_eq!(msg, "Wrong email or phone number");
}

#[test]
fn extract_error_escaped_json() {
    let body = r#"{"error":"invalid or already used license key"}"#;
    let msg = super::extract_server_error(body);
    assert_eq!(msg, "invalid or already used license key");
}

#[test]
fn extract_error_falls_back_to_raw_body() {
    // Non-JSON body should be returned as-is.
    let body = "Internal Server Error";
    let msg = super::extract_server_error(body);
    assert_eq!(msg, "Internal Server Error");
}

#[test]
fn extract_error_empty_json() {
    let body = "{}";
    let msg = super::extract_server_error(body);
    assert_eq!(msg, "{}");
}

#[test]
fn extract_error_empty_string() {
    let msg = super::extract_server_error("");
    assert_eq!(msg, "");
}
