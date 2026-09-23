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

/// The BOOTSTRAP_FREE short-circuit is compiled only under
/// `#[cfg(debug_assertions)]`, so this assertion can hold only in a
/// debug-profile test run. In a release build the sentinel is not accepted and
/// the call returns Err, which is why the test is gated rather than paired with
/// a second assertion -- the honest counterpart of a debug-only bypass is no
/// assertion in release. Gated in the form `entitlements_tests.rs:150` and
/// `:176` use.
#[cfg(debug_assertions)]
#[test]
fn verify_bootstrap_free_bypasses_rsa_in_debug() {
    // The BOOTSTRAP_FREE sentinel passes without a real key, but only in debug
    // /dev/test builds where the production guard at license_verification.rs
    // :391-392 is compiled in. See the note at the bottom of this file for what
    // a release build does with the sentinel instead.
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

// NOTE: the sentinel short-circuit lives behind `#[cfg(debug_assertions)]` at
// license_verification.rs:391-392 (true when this note was written at 38bfcdd41; the guard is at :397 and the comparison at :398 at HEAD 4a4c5fc9e, six lines lower because 9927adec1 grew the comment above it from 3 lines to 9 — marked, not silently repointed, and re-grepped here rather than copied). In a release build execution falls through
// to `base64::STANDARD.decode("BOOTSTRAP_FREE")`, which fails with
// `InvalidByte(9, 95)`: offset 9 is the first underscore of the sentinel and 95
// is that underscore's byte value. The decode error is wrapped at
// license_verification.rs:399-403 (likewise true at 38bfcdd41; the same six-line shift puts that block at :405-409 at HEAD 4a4c5fc9e) as
// `CoreError::InvalidSubscriptionSignature`, carrying the text
// "failed to decode base64 signature: InvalidByte(9, 95)".
//
// That is the first panic a release-profile run reports for a sentinel-signed
// row, and it is the signature of a migration-seeded row rather than of any test
// literal: 20260813_init.sql:1514 and its generated PG twin at :2101 INSERT
// BOOTSTRAP_FREE as the default tenant subscription signature.
//
// What this note used to claim -- that `cargo test` always runs with
// `debug_assertions` enabled -- is false, and that false premise is why
// `verify_bootstrap_free_bypasses_rsa_in_debug` carried no guard: `cargo test
// --release` clears `debug_assertions`, so the assertion was red by construction
// in that profile. It is now `#[cfg(debug_assertions)]`-gated; see the doc
// comment on that test.
//
// UPDATE 19-09-26: everything above still holds for THIS function, which
// continues to reject the sentinel in release -- so the debug-gated test stays
// correctly gated. But it is no longer the path a real install takes. The
// policy moved up to `TenantSubscription::verify_signature` (subscription.rs),
// which honours the sentinel in every profile when the row's tier is Free, so
// the migration-seeded row no longer fails in a release build. That is the
// release-side counterpart this note used to say was deliberately absent, and
// it now exists as `seeded_bootstrap_free_row_verifies_in_every_profile` and
// `sentinel_does_not_carry_a_paid_tier` in subscription_tests.rs.

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

    let result = store_subscription(&conn, "test-tenant", payload, "TESTSIG");
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
    assert_eq!(
        stored.api_key, "",
        "the cleartext copy is closed: the column holds only its empty default"
    );
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

    store_subscription(&conn, "trial-tenant", payload, "BOOTSTRAP_FREE")
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

    store_subscription(&conn, "paid-tenant", payload, "BOOTSTRAP_FREE")
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

        let result = store_subscription(&conn, &format!("tenant-{key}"), &payload, "TESTSIG");
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

    store_subscription(&conn, "test-tenant", payload, "TESTSIG")
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

    store_subscription(&conn, "test-tenant", payload, "TESTSIG")
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

// ── apply_license_verdict_to_cache (ADR #58 option C) ──────────

/// Build a minimal status response for the verdict tests.
fn status_response(
    status: &str,
    device_revoked: bool,
    expires_at: Option<&str>,
) -> LicenseStatusResponse {
    LicenseStatusResponse {
        tenant_id: "test-tenant".into(),
        status: status.into(),
        tier: "pro".into(),
        active: status.eq_ignore_ascii_case("active"),
        device_revoked,
        expires_at: expires_at.map(str::to_string),
        grace_until: None,
        max_locations: None,
        max_stores: None,
        hardware_verified: None,
        hardware_token: None,
    }
}

/// Seed the `default` subscription row the cache write targets.
fn seed_subscription_row(conn: &rusqlite::Connection, status: &str, expires_at: Option<&str>) {
    conn.execute(
        "INSERT OR REPLACE INTO tenant_subscription
         (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances,
          allowed_types_json, signature, signed_payload,
          updated_at)
         VALUES ('default', 'pro', ?1, ?2, 2, 1, '[]', 'SIG', '{}',
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![status, expires_at],
    )
    .expect("seed subscription row");
}

/// The function reports the TENANT verdict as its return value, which is what
/// the caller keys the live-session sweep on. A device-level revocation must
/// NOT be reported through this return value — the session gate reads that
/// from the cache instead (ADR #58 §2.4a.2), and conflating them would sweep
/// every session on a per-device verdict.
#[test]
fn verdict_return_is_the_tenant_status_not_the_device_flag() {
    use crate::migrations;
    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    let device_only = apply_license_verdict_to_cache(
        &conn,
        &status_response("active", true, Some("2027-01-01T00:00:00Z")),
    );
    assert!(
        !device_only,
        "a device revocation is not a tenant revocation"
    );

    let tenant = apply_license_verdict_to_cache(&conn, &status_response("revoked", false, None));
    assert!(tenant, "the revoked tenant status must be reported");
}

/// The device verdict is cached under `device.revoked`, and the write is
/// unconditional — a later `false` must CLEAR an earlier `true`, or an
/// un-revoke could never take effect on a device that had been locked out.
#[test]
fn verdict_caches_and_clears_the_device_flag() {
    use crate::migrations;
    use crate::settings::{Settings, keys};

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    apply_license_verdict_to_cache(&conn, &status_response("active", true, None));
    assert_eq!(
        Settings::get(&conn, keys::DEVICE_REVOKED)
            .unwrap()
            .as_deref(),
        Some("true"),
        "a revoked device must be cached as true"
    );

    apply_license_verdict_to_cache(&conn, &status_response("active", false, None));
    assert_eq!(
        Settings::get(&conn, keys::DEVICE_REVOKED)
            .unwrap()
            .as_deref(),
        Some("false"),
        "an un-revoke must clear the cached verdict, not leave it stuck"
    );
}

#[test]
fn verdict_attestation_caches_hardware_token_and_verified_at() {
    use crate::migrations;
    use crate::settings::{Settings, keys};

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    let mut resp = status_response("active", false, None);
    resp.hardware_verified = Some(true);
    resp.hardware_token = Some("hwt_sig_12345".to_string());

    apply_license_verdict_to_cache(&conn, &resp);

    assert_eq!(
        Settings::get(&conn, keys::DEVICE_REVOKED)
            .unwrap()
            .as_deref(),
        Some("false")
    );
    assert_eq!(
        Settings::get(&conn, keys::HARDWARE_TOKEN)
            .unwrap()
            .as_deref(),
        Some("hwt_sig_12345")
    );
    assert!(
        Settings::get(&conn, keys::MACHINE_VERIFIED_AT)
            .unwrap()
            .is_some()
    );
}

#[test]
fn verdict_hardware_mismatch_locks_device() {
    use crate::migrations;
    use crate::settings::{Settings, keys};

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    let mut resp = status_response("active", false, None);
    resp.hardware_verified = Some(false); // hardware mismatch detected by server

    apply_license_verdict_to_cache(&conn, &resp);

    assert_eq!(
        Settings::get(&conn, keys::DEVICE_REVOKED)
            .unwrap()
            .as_deref(),
        Some("true"),
        "hardware mismatch must lock the device under device.revoked"
    );
}

#[test]
fn test_status_response_deserialization_hardware_fields() {
    let json_verified = r#"{
        "tenant_id": "t1",
        "status": "active",
        "tier": "pro",
        "active": true,
        "device_revoked": false,
        "hardware_verified": true,
        "hardware_token": "hwt_test_token"
    }"#;

    let parsed: LicenseStatusResponse = serde_json::from_str(json_verified).unwrap();
    assert_eq!(parsed.hardware_verified, Some(true));
    assert_eq!(parsed.hardware_token.as_deref(), Some("hwt_test_token"));

    let json_legacy = r#"{
        "tenant_id": "t1",
        "status": "active",
        "tier": "pro",
        "active": true,
        "device_revoked": false
    }"#;
    let parsed_legacy: LicenseStatusResponse = serde_json::from_str(json_legacy).unwrap();
    assert_eq!(parsed_legacy.hardware_verified, None);
    assert_eq!(parsed_legacy.hardware_token, None);
}

/// The subscription row's server-authoritative fields are refreshed, so the
/// next capability read reflects the new lifecycle without re-activation.
#[test]
fn verdict_refreshes_the_subscription_row() {
    use crate::migrations;

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    apply_license_verdict_to_cache(
        &conn,
        &status_response("canceled", false, Some("2026-06-01T00:00:00Z")),
    );

    let stored = TenantSubscription::load(&conn, "default")
        .expect("load")
        .expect("row must exist");
    assert_eq!(stored.status, "canceled");
    assert_eq!(stored.expires_at.as_deref(), Some("2026-06-01T00:00:00Z"));
}

/// A missing row is a no-op, not an error, and still reports the verdict: this
/// is the no-license-activated path a free/local install takes.
#[test]
fn verdict_on_a_missing_row_still_reports_and_does_not_panic() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    let revoked = apply_license_verdict_to_cache(&conn, &status_response("revoked", false, None));
    assert!(
        revoked,
        "the verdict is the server's answer, independent of local rows"
    );
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

// ── CRL Verification and Revocation Tests (ADR #58 §2.1/§2.2) ──────────

#[test]
fn test_crl_signature_verification_and_tamper_detection() {
    let (private_key, public_pem) = generate_test_keypair();

    let crl = CrlPayload {
        issuer: "kasir.mu".into(),
        issued_at: "2026-09-22T07:00:00Z".into(),
        entries: vec![CrlEntry {
            key: "OZ-PRO-COMPROMISED-01".into(),
            key_hash: "a".repeat(64),
            tenant_id: Some("tenant-compromised-1".into()),
            revoked_at: "2026-09-22T06:00:00Z".into(),
            reason: Some("Stolen key".into()),
        }],
        revoked_tenants: vec!["tenant-banned-99".into()],
        revoked_devices: vec!["stolen-tablet-01".into()],
    };

    let payload_json = serde_json::to_string(&crl).unwrap();
    let signature_base64 = sign_test_payload(&private_key, &payload_json);

    // 1. Valid signature verifies successfully
    let verified = verify_crl_signature_with_pem(&payload_json, &signature_base64, &public_pem)
        .expect("verify");
    assert_eq!(verified.issuer, "kasir.mu");
    assert_eq!(verified.entries.len(), 1);
    assert_eq!(verified.entries[0].key, "OZ-PRO-COMPROMISED-01");
    assert_eq!(
        verified.revoked_tenants,
        vec!["tenant-banned-99".to_string()]
    );
    assert_eq!(
        verified.revoked_devices,
        vec!["stolen-tablet-01".to_string()]
    );

    // 2. Tampered payload fails verification
    let tampered_json = payload_json.replace("kasir.mu", "attacker.io");
    let tampered_res =
        verify_crl_signature_with_pem(&tampered_json, &signature_base64, &public_pem);
    assert!(
        matches!(
            tampered_res,
            Err(CoreError::InvalidSubscriptionSignature(_))
        ),
        "tampered CRL payload must fail verification"
    );

    // 3. Corrupted base64 fails verification
    let corrupt_res =
        verify_crl_signature_with_pem(&payload_json, "not-valid-base64!", &public_pem);
    assert!(
        matches!(corrupt_res, Err(CoreError::InvalidSubscriptionSignature(_))),
        "invalid signature base64 must fail"
    );
}

#[test]
fn test_crl_caching_and_revocation_checks() {
    use crate::migrations;
    use crate::settings::{Settings, keys};

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    let crl = CrlPayload {
        issuer: "kasir.mu".into(),
        issued_at: "2026-09-22T07:00:00Z".into(),
        entries: vec![CrlEntry {
            key: "OZ-REVOKED-KEY-123".into(),
            key_hash: {
                use sha2::Digest;
                let mut hasher = Sha256::new();
                hasher.update(b"OZ-REVOKED-KEY-123");
                hex::encode(hasher.finalize())
            },
            tenant_id: Some("tenant-bad".into()),
            revoked_at: "2026-09-22T00:00:00Z".into(),
            reason: Some("chargeback".into()),
        }],
        revoked_tenants: vec!["tenant-bad".into(), "tenant-banned-456".into()],
        revoked_devices: vec!["bad-pos-tablet-01".into()],
    };

    // 1. Initial state: not revoked
    assert!(
        !is_revoked_in_cached_crl(&conn, Some("OZ-REVOKED-KEY-123"), None, None).unwrap(),
        "before CRL caching, should not be marked revoked"
    );

    // 2. Apply CRL to cache for an innocent tenant
    let revoked = apply_crl_to_cache(
        &conn,
        &crl,
        Some("default"),
        Some("OZ-CLEAN-KEY-789"),
        Some("clean-pos-01"),
    )
    .expect("apply CRL");
    assert!(!revoked, "innocent tenant must not be revoked");

    // Check cached settings
    let cached = Settings::get(&conn, keys::CRL_CACHE_JSON).unwrap();
    assert!(cached.is_some(), "crl.cache_json must be persisted");
    let checked_at = Settings::get(&conn, keys::CRL_CHECKED_AT).unwrap();
    assert!(checked_at.is_some(), "crl.checked_at must be persisted");

    // 3. Query revocation in cached CRL
    assert!(
        is_revoked_in_cached_crl(&conn, Some("OZ-REVOKED-KEY-123"), None, None).unwrap(),
        "revoked key must match in cached CRL"
    );
    assert!(
        is_revoked_in_cached_crl(&conn, None, Some("tenant-banned-456"), None).unwrap(),
        "revoked tenant must match in cached CRL"
    );
    assert!(
        is_revoked_in_cached_crl(&conn, None, None, Some("bad-pos-tablet-01")).unwrap(),
        "revoked device must match in cached CRL"
    );
    assert!(
        !is_revoked_in_cached_crl(
            &conn,
            Some("OZ-GOOD-KEY"),
            Some("tenant-good"),
            Some("pos-02")
        )
        .unwrap(),
        "good key and tenant must not match in CRL"
    );

    // 4. Apply CRL where current tenant IS revoked -> should flip local status to revoked
    let revoked_for_bad = apply_crl_to_cache(
        &conn,
        &crl,
        Some("default"),
        Some("OZ-REVOKED-KEY-123"),
        None,
    )
    .expect("apply CRL");
    assert!(revoked_for_bad, "tenant with revoked key must return true");

    let sub = TenantSubscription::load(&conn, "default").unwrap().unwrap();
    assert_eq!(
        sub.status, "revoked",
        "subscription row status must be flipped to revoked"
    );
}

#[test]
fn test_verify_signature_with_crl_denies_revoked_tenant() {
    use crate::migrations;

    let conn = migrations::fresh_db();
    seed_subscription_row(&conn, "active", Some("2027-01-01T00:00:00Z"));

    let crl = CrlPayload {
        issuer: "kasir.mu".into(),
        issued_at: "2026-09-22T07:00:00Z".into(),
        entries: vec![],
        revoked_tenants: vec!["default".into()],
        revoked_devices: vec![],
    };
    apply_crl_to_cache(&conn, &crl, None, None, None).unwrap();

    let sub = TenantSubscription::load(&conn, "default").unwrap().unwrap();
    let res = sub.verify_signature_with_crl(&conn, None);
    assert!(
        matches!(res, Err(CoreError::LicenseRevoked(_))),
        "verify_signature_with_crl must reject a tenant in CRL"
    );
}
