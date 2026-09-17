//! Unit tests for the license command bodies (relocated from
//! `apps/desktop-tauri/src/commands/license_tests.rs`).
//!
//! Mounted at the foot of `license.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs, the machine-id / hardware-fingerprint
//! generators, `grace_deadline_for` and the imported `store_subscription`
//! / `RenewLicenseRequest` exactly as the desktop sibling module did.
//! Every test body is a byte-for-byte carry of the desktop original; the
//! generator tests exercise the same real `get_system_uuid` fallback
//! chain the ported bridge body runs.

use super::*;
use kasirmu_core::error::CoreError;
use kasirmu_core::subscription::TenantSubscription;

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
    use kasirmu_core::migrations;
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
    use kasirmu_core::migrations;
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
    use kasirmu_core::migrations;
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
    use kasirmu_core::migrations;
    let conn = migrations::fresh_db();

    // Verify bootstrap Free tier is seeded
    let sub = TenantSubscription::load(&conn, "default")
        .expect("load")
        .expect("bootstrap row should exist");
    assert_eq!(sub.tier, kasirmu_core::SubscriptionTier::Free);

    // Simulate a Pro activation — store_subscription should
    // replace the bootstrap row with the activated tier. This payload
    // uses the NEW 1g wire name (max_locations); the alias path for
    // pre-rename payloads (max_locations) is covered by the kasirmu-core tests.
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

    store_subscription(&conn, "default", payload, "SIG_PRO")
        .expect("store_subscription should succeed");

    let updated = TenantSubscription::load(&conn, "default")
        .expect("load")
        .expect("row should exist after update");
    assert_eq!(updated.tier, kasirmu_core::SubscriptionTier::Pro);
    assert_eq!(updated.max_locations, 2);
    assert_eq!(updated.max_pos_instances, 3);
    assert_eq!(updated.signature, "SIG_PRO");
    assert_eq!(
        updated.api_key, "",
        "store_subscription no longer writes a cleartext key copy"
    );
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

/// THE DECIDING TEST FOR THE CLEARTEXT-COPY FIX: after a subscription is
/// persisted the way both license lanes do it, `tenant_subscription.api_key`
/// must still hold its empty default and must not equal the plaintext key,
/// while the sealed `license.api_key` settings row still decrypts back to it.
/// Proves the duplicate is closed without damaging the machine-bound lane.
#[test]
fn subscription_store_leaves_the_cleartext_column_empty_and_the_sealed_row_intact() {
    let conn = kasirmu_core::migrations::fresh_db();
    let machine_id = "MACHINE-FOR-CLEARTTEXT-COPY-TEST";
    let plaintext = "oz-live-API-KEY-9f2c1d";

    // Seed the sealed lane exactly as the activate lane writes it, then persist
    // the subscription through the production entry point.
    let encrypted = encrypt_api_key(plaintext, machine_id).expect("encrypt");
    Settings::set(&conn, "license.api_key", &encrypted).expect("seed sealed row");
    let sealed_raw: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'license.api_key'",
            [],
            |r| r.get(0),
        )
        .expect("sealed settings row");
    assert_ne!(sealed_raw, plaintext, "the settings lane holds ciphertext");

    let payload = r#"{
        "tenant_id": "default",
        "tier_key": "pro",
        "status": "active",
        "max_stores": 2,
        "max_pos_instances": 3,
        "allowed_types": ["store-pos"],
        "starts_at": "2026-01-01T00:00:00Z",
        "expires_at": "2027-01-01T00:00:00Z",
        "grace_until": "2027-01-15T00:00:00Z",
        "issued_at": "2026-01-01T00:00:00Z"
    }"#;
    store_subscription(&conn, "default", payload, "SIG_CLEAR_COPY").expect("store");

    // ABSENCE, read from the COLUMN rather than through the struct, so a
    // default-on-read cannot masquerade as a default-on-write.
    let stored_col: String = conn
        .query_row(
            "SELECT api_key FROM tenant_subscription WHERE tenant_id = 'default'",
            [],
            |r| r.get(0),
        )
        .expect("the column must still exist — it was not dropped");
    assert_eq!(
        stored_col, "",
        "tenant_subscription.api_key must hold its empty default"
    );
    assert_ne!(
        stored_col, plaintext,
        "and must never equal the plaintext key"
    );
    assert!(
        !stored_col.contains(plaintext) && !sealed_raw.contains(plaintext),
        "no cleartext form of the key may exist in either table"
    );
    // The lane that must keep working: the sealed row still decrypts back.
    let back = decrypt_api_key(&sealed_raw, machine_id).expect("decrypt");
    assert_eq!(
        back, plaintext,
        "the machine-bound settings row is unchanged"
    );
    assert_eq!(
        TenantSubscription::load(&conn, "default")
            .expect("load")
            .expect("row")
            .api_key,
        "",
        "the struct view agrees with the column"
    );
}

// ── get_license_status: the two debug-only bypasses ─────────────────
//
// These are the FIRST tests this command has ever had. Measured 2026-09-14
// before this block landed: get_license_status appears 39 times tree-wide —
// definition (license.rs:572), a scoped wrapper, two desktop IPC shims,
// generate_handler! registrations, a gate table, doc comments — and ZERO times
// in any *_tests.rs in either crate or in apps/.
// cargo test -p kasirmu-bridge --release --lib license reported 18/18 green, and
// that green was the absence of any call, not coverage.
//
// Both hazards are cfg-split in production, so every case below asserts BOTH
// build profiles in ONE body, in the repo's two established forms:
// kasirmu-core/src/db/audit_security_tests.rs:418
// (assert_eq!(recorded, cfg!(debug_assertions))) and
// kasirmu-bridge/src/subscription_tests.rs:26-48 (an explicit debug arm plus a
// #[cfg(not(debug_assertions))] arm). Asserting only the debug value would go
// red in release and get "fixed" by weakening it — the mechanism that kept
// this gap invisible.
//
// THE TRAP, named so a release failure is never misread as a bad assertion:
// the only signature a test can seed is the BOOTSTRAP_FREE sentinel, and
// kasirmu-core/src/license_verification.rs:391-393 accepts it under
// #[cfg(debug_assertions)] ONLY. So every payload-seeded case forks for that
// reason alone: debug verifies and falls through to the date logic; release
// rejects at license.rs:594 and returns InvalidSignature before a single date
// is read. Consequence, recorded rather than papered over: the release arm of
// the expired-past-grace branch (license.rs:670-683, is_active: false +
// Expired) is UNREACHABLE from any test in this crate — it needs an RSA
// signature made with the license server's private key, and
// license_verification embeds only the public half.

/// Seed the two settings lanes get_license_status reads (license.rs:590-591).
fn seed_license_settings(conn: &rusqlite::Connection, payload: &str, signature: &str) {
    Settings::set(conn, "license.payload", payload).expect("seed license.payload");
    Settings::set(conn, "license.signature", signature).expect("seed license.signature");
}

/// A payload whose dates are entirely in the past: expired 2020-01-01, grace
/// ended 2020-01-15, so now >= grace_deadline on every tier's window.
fn expired_payload_json() -> String {
    r#"{
        "tenant_id": "default",
        "tier_key": "pro",
        "status": "expired",
        "max_stores": 2,
        "max_pos_instances": 3,
        "allowed_types": ["store-pos"],
        "starts_at": "2019-01-01T00:00:00Z",
        "expires_at": "2020-01-01T00:00:00Z",
        "grace_until": "2020-01-15T00:00:00Z",
        "issued_at": "2019-01-01T00:00:00Z"
    }"#
    .to_string()
}

/// The ACTIVE control: same shape, same seed path, dates entirely future.
fn active_payload_json() -> String {
    r#"{
        "tenant_id": "default",
        "tier_key": "pro",
        "status": "active",
        "max_stores": 2,
        "max_pos_instances": 3,
        "allowed_types": ["store-pos"],
        "starts_at": "2020-01-01T00:00:00Z",
        "expires_at": "2099-01-01T00:00:00Z",
        "grace_until": "2099-01-15T00:00:00Z",
        "issued_at": "2020-01-01T00:00:00Z"
    }"#
    .to_string()
}

#[tokio::test]
async fn get_license_status_without_a_stored_payload_is_free_in_debug_and_missing_in_release() {
    // HAZARD 2 of 2 — license.rs:687. No license.payload and no
    // license.signature row: debug answers "Valid, free tier, go ahead",
    // release answers "Missing, please activate". A fresh migrated DB is
    // exactly that state (no migration seeds these two settings rows), so this
    // is also the suite's BOTH-PROFILE CONTROL: the only case whose release
    // arm reaches a real verdict instead of the sentinel, which is what proves
    // the release arms below are about BOOTSTRAP_FREE and not about the
    // command being broken in release.
    let app = crate::testing::TestBridge::new();
    let dto = get_license_status(&app.ctx()).await.expect("status");

    // Shared by both profiles.
    assert!(dto.payload.is_none(), "no payload exists to report");

    // Profile-split, one body, both builds.
    assert_eq!(
        dto.is_active,
        cfg!(debug_assertions),
        "debug reports an unlicensed install ACTIVE (the :687 bypass); release reports it INACTIVE"
    );
    assert_eq!(
        dto.status,
        if cfg!(debug_assertions) {
            LicenseVerificationStatus::Valid
        } else {
            LicenseVerificationStatus::Missing
        },
        "debug takes Valid(:692), release takes Missing(:702)"
    );
    assert_eq!(
        dto.tier.as_deref(),
        if cfg!(debug_assertions) {
            Some("free")
        } else {
            None
        },
        "the debug bypass invents a free tier; release reports no tier at all"
    );
    assert_eq!(
        dto.message.as_deref(),
        if cfg!(debug_assertions) {
            None
        } else {
            Some("No license found. Please activate.")
        },
        "only the release path tells the operator why"
    );
}

#[tokio::test]
async fn get_license_status_past_grace_reports_active_in_debug_only() {
    // HAZARD 1 of 2 — license.rs:659. A license that expired AND whose grace
    // window has closed must be INACTIVE. In debug it is not: that cfg arm
    // returns is_active: true / Valid with the payload attached. Asserted AS
    // SHIPPED, not as correct — this is the pin that fails loudly if anyone
    // later reads the debug arm as the spec.
    let conn = crate::testing::temp_conn();
    let payload = expired_payload_json();
    seed_license_settings(&conn, &payload, "BOOTSTRAP_FREE");
    let app = crate::testing::TestBridge::new().with_conn(conn);
    let dto = get_license_status(&app.ctx()).await.expect("status");

    if cfg!(debug_assertions) {
        assert!(
            dto.is_active,
            "the :659 debug bypass must report an expired, past-grace license as ACTIVE"
        );
        assert_eq!(
            dto.status,
            LicenseVerificationStatus::Valid,
            "debug returns Valid, not Expired and not GracePeriod"
        );
        assert_eq!(
            dto.tier.as_deref(),
            Some("pro"),
            "the payload tier is echoed"
        );
        assert_eq!(
            dto.payload.as_deref(),
            Some(payload.as_str()),
            "and the raw payload is handed back to the caller"
        );
        assert!(
            dto.message.is_none(),
            "the debug arm reports no problem at all"
        );
    } else {
        // NOT the Expired arm: BOOTSTRAP_FREE is rejected at :594, so the date
        // logic at :638-684 never runs in release. See the trap note above.
        assert!(
            !dto.is_active,
            "release never reports an active license here"
        );
        assert_eq!(
            dto.status,
            LicenseVerificationStatus::InvalidSignature,
            "release stops at the sentinel, NOT at the :670 Expired arm — an Expired assertion here would be unreachable, not wrong"
        );
        assert!(
            dto.tier.is_none(),
            "nothing is parsed after a failed verify"
        );
    }
}

#[tokio::test]
async fn get_license_status_active_payload_is_the_control_that_passes_in_debug() {
    // CONTROL — an actually-valid license through the same fixture and the
    // same seed path. Debug returns active/Valid/tier=pro/payload-echoed for
    // BOTH this and the expired case, which is exactly why the case above is
    // the finding: to a debug caller a past-grace license and a live one are
    // indistinguishable. It also shows the suite is not asserting "everything
    // fails in release" — release fails here for the same sentinel reason.
    let conn = crate::testing::temp_conn();
    let payload = active_payload_json();
    seed_license_settings(&conn, &payload, "BOOTSTRAP_FREE");
    let app = crate::testing::TestBridge::new().with_conn(conn);
    let dto = get_license_status(&app.ctx()).await.expect("status");

    if cfg!(debug_assertions) {
        assert!(
            dto.is_active,
            "a future expiry is active whenever the signature verifies"
        );
        assert_eq!(dto.status, LicenseVerificationStatus::Valid);
        assert_eq!(dto.tier.as_deref(), Some("pro"));
        assert_eq!(dto.payload.as_deref(), Some(payload.as_str()));
    } else {
        assert_eq!(
            dto.status,
            LicenseVerificationStatus::InvalidSignature,
            "release: the sentinel again — this control cannot reach :638 either"
        );
        assert!(!dto.is_active);
    }
}
