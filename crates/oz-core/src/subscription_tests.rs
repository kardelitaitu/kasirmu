#![allow(deprecated)] // OneTime is intentionally tested for DB back-compat verification

use super::*;

// ── InstanceStatus ────────────────────────────────────

#[test]
fn instance_status_from_db() {
    assert_eq!(InstanceStatus::from_db("active"), InstanceStatus::Active);
    assert_eq!(
        InstanceStatus::from_db("quota_suspended"),
        InstanceStatus::QuotaSuspended
    );
    assert_eq!(
        InstanceStatus::from_db("archived"),
        InstanceStatus::Archived
    );
    assert_eq!(InstanceStatus::from_db("unknown"), InstanceStatus::Active);
}

#[test]
fn instance_status_as_str() {
    assert_eq!(InstanceStatus::Active.as_str(), "active");
    assert_eq!(InstanceStatus::QuotaSuspended.as_str(), "quota_suspended");
    assert_eq!(InstanceStatus::Archived.as_str(), "archived");
}

#[test]
fn instance_status_serialize() {
    let json = serde_json::to_value(InstanceStatus::Active).unwrap();
    assert_eq!(json, "active");

    let json = serde_json::to_value(InstanceStatus::QuotaSuspended).unwrap();
    assert_eq!(json, "quota_suspended");
}

// ── SubscriptionTier ──────────────────────────────────

#[test]
fn tier_from_db() {
    assert_eq!(SubscriptionTier::from_db("free"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db("plus"), SubscriptionTier::Plus);
    assert_eq!(
        SubscriptionTier::from_db("standard"), // legacy alias → Plus
        SubscriptionTier::Plus
    );
    assert_eq!(SubscriptionTier::from_db("pro"), SubscriptionTier::Pro);
    assert_eq!(
        SubscriptionTier::from_db("premium"),
        SubscriptionTier::Premium
    );
    assert_eq!(
        SubscriptionTier::from_db("enterprise"),
        SubscriptionTier::Enterprise
    );
    assert_eq!(SubscriptionTier::from_db("invalid"), SubscriptionTier::Free);
}

#[test]
fn tier_max_locations() {
    assert_eq!(SubscriptionTier::Free.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::OneTime.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Pro.max_locations(), Some(2));
    assert_eq!(SubscriptionTier::Premium.max_locations(), Some(5));
    assert_eq!(SubscriptionTier::Enterprise.max_locations(), None);
}

#[test]
fn tier_max_pos_instances() {
    assert_eq!(SubscriptionTier::Free.max_pos_instances(), Some(1));
    assert_eq!(SubscriptionTier::OneTime.max_pos_instances(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_pos_instances(), Some(2));
    assert_eq!(SubscriptionTier::Pro.max_pos_instances(), Some(5));
    assert_eq!(SubscriptionTier::Premium.max_pos_instances(), None);
    assert_eq!(SubscriptionTier::Enterprise.max_pos_instances(), None);
}

#[test]
fn tier_allows_workspace_type() {
    // Free tier & OneTime
    assert!(SubscriptionTier::Free.allows_workspace_type("store-pos"));
    assert!(SubscriptionTier::Free.allows_workspace_type("admin"));
    assert!(!SubscriptionTier::Free.allows_workspace_type("kds"));
    assert!(!SubscriptionTier::Free.allows_workspace_type("warehouse"));

    // Plus tier: warehouse/inventory allowed, kds NOT allowed
    assert!(SubscriptionTier::Plus.allows_workspace_type("warehouse"));
    assert!(SubscriptionTier::Plus.allows_workspace_type("inventory"));
    assert!(!SubscriptionTier::Plus.allows_workspace_type("kds"));

    // Pro & Enterprise tier allow all
    assert!(SubscriptionTier::Pro.allows_workspace_type("kds"));
    assert!(SubscriptionTier::Pro.allows_workspace_type("analytics-pro"));
    assert!(SubscriptionTier::Pro.allows_workspace_type("warehouse"));
    assert!(SubscriptionTier::Enterprise.allows_workspace_type("anything"));
}

#[test]
fn tier_name() {
    assert_eq!(SubscriptionTier::Free.name(), "Free");
    assert_eq!(SubscriptionTier::OneTime.name(), "1-Time Perpetual");
    assert_eq!(SubscriptionTier::Plus.name(), "Plus");
    assert_eq!(SubscriptionTier::Pro.name(), "Pro");
    assert_eq!(SubscriptionTier::Premium.name(), "Premium");
    assert_eq!(SubscriptionTier::Enterprise.name(), "Enterprise");
}

#[test]
fn tier_serialize() {
    let json = serde_json::to_value(SubscriptionTier::Free).unwrap();
    assert_eq!(json, "free");
    let json = serde_json::to_value(SubscriptionTier::Plus).unwrap();
    assert_eq!(json, "plus");
    let json = serde_json::to_value(SubscriptionTier::Premium).unwrap();
    assert_eq!(json, "premium");
}

// ── Signature Verification ────────────────────────────

#[test]
fn verify_bootstrap_signature_passes() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Free,
        status: "active".into(),
        expires_at: None,
        max_locations: 1,
        max_pos_instances: 1,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.verify_signature().is_ok());
}

#[test]
fn verify_non_bootstrap_signature_rejected() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Free,
        status: "active".into(),
        expires_at: None,
        max_locations: 1,
        max_pos_instances: 1,
        allowed_types_json: "[]".into(),
        signature: "TAMPERED_SIGNATURE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.verify_signature().is_err());
}

// ── QuotaError Display ────────────────────────────────

#[test]
fn quota_error_register_limit() {
    let err = QuotaError::RegisterLimit {
        tier: "Free".into(),
        limit: 1,
        current: 1,
    };
    let msg = err.to_string();
    assert!(msg.contains("Free"));
    assert!(msg.contains("1"));
}

#[test]
fn quota_error_store_limit() {
    let err = QuotaError::StoreLimit {
        tier: "Pro".into(),
        limit: 2,
        current: 2,
    };
    let msg = err.to_string();
    assert!(msg.contains("Pro"));
    assert!(msg.contains("2"));
}

#[test]
fn quota_error_type_not_allowed() {
    let err = QuotaError::TypeNotAllowed {
        tier: "Free".into(),
        type_key: "kds".into(),
    };
    let msg = err.to_string();
    assert!(msg.contains("kds"));
    assert!(msg.contains("Free"));
}

// ── Clock Rollback Detection ──────────────────────────

#[test]
fn clock_rollback_detects_future_timestamps() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    // Insert a sale with a timestamp far in the future.
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('sale-1', 'completed', 1000, 'USD', 1, '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let result = TenantSubscription::validate_clock_rollback(&conn);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("system clock tampered"));
    assert!(err.contains("2099"));
}

#[test]
fn clock_rollback_passes_with_recent_timestamps() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    // Insert a sale with a recent timestamp.
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('sale-1', 'completed', 1000, 'USD', 1, ?1, ?1)",
        rusqlite::params![now],
    )
    .unwrap();

    let result = TenantSubscription::validate_clock_rollback(&conn);
    assert!(result.is_ok(), "expected OK, got: {result:?}");
}

#[test]
fn clock_rollback_passes_with_empty_tables() {
    use crate::migrations;
    let conn = migrations::fresh_db();
    // No sales or audit_logs — should default to Utc::now().
    let result = TenantSubscription::validate_clock_rollback(&conn);
    assert!(result.is_ok());
}

#[test]
fn compute_max_ledger_timestamp_prefers_recent_over_older() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('s1', 'completed', 1000, 'USD', 1, '2025-06-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO audit_log (id, action, user_id, created_at)
         VALUES ('a1', 'login', 'user-1', '2025-07-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let ts = TenantSubscription::compute_max_ledger_timestamp(&conn).unwrap();
    // Should pick the audit_log timestamp (2025-07-01) over sales (2025-06-01).
    assert!(ts.contains("2025-07-01"), "expected July, got: {ts}");
}

// ── Offline Grace Period ──────────────────────────────

#[test]
fn free_tier_always_within_grace() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Free,
        status: "active".into(),
        expires_at: Some("2020-01-01T00:00:00.000Z".into()),
        max_locations: 1,
        max_pos_instances: 1,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn paid_tier_with_no_expiry_within_grace() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Pro,
        status: "active".into(),
        expires_at: None, // lifetime
        max_locations: 2,
        max_pos_instances: 3,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Pro);
}

#[test]
fn paid_tier_within_14_day_grace() {
    // Expiry is 7 days ago — still within 14-day grace.
    let recent = chrono::Utc::now() - chrono::Duration::days(7);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Premium,
        status: "active".into(),
        expires_at: Some(recent.to_rfc3339()),
        max_locations: 5,
        max_pos_instances: 10,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Premium);
}

#[test]
fn paid_tier_outside_grace_downgrades_to_free() {
    // Expiry is 30 days ago — outside 14-day grace.
    let old = chrono::Utc::now() - chrono::Duration::days(30);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Premium,
        status: "active".into(),
        expires_at: Some(old.to_rfc3339()),
        max_locations: 5,
        max_pos_instances: 10,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn enterprise_lifetime_never_downgrades() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Enterprise,
        status: "active".into(),
        expires_at: None,
        max_locations: 0,
        max_pos_instances: 0,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Enterprise);
}

// ── Lifecycle state (§B fail-closed contract) ─────────

/// Fixture: a subscription row with only the fields `lifecycle_state`
/// reads (tier, status, expires_at); the rest are bootstrap filler.
fn state_sub(
    tier: SubscriptionTier,
    status: &str,
    expires_at: Option<String>,
) -> TenantSubscription {
    TenantSubscription {
        tenant_id: "default".into(),
        tier,
        status: status.into(),
        expires_at,
        max_locations: 1,
        max_pos_instances: 1,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn lifecycle_state_paid_no_expiry_is_active() {
    assert_eq!(
        state_sub(SubscriptionTier::Pro, "active", None).lifecycle_state(),
        SubscriptionLifecycleState::Active
    );
}

#[test]
fn lifecycle_state_future_expiry_is_active() {
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    assert_eq!(
        state_sub(SubscriptionTier::Plus, "active", Some(future)).lifecycle_state(),
        SubscriptionLifecycleState::Active
    );
}

#[test]
fn lifecycle_state_within_grace_is_grace() {
    // Premium grace is 30 days — 7 days past expiry is still grace.
    let recent = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    assert_eq!(
        state_sub(SubscriptionTier::Premium, "active", Some(recent)).lifecycle_state(),
        SubscriptionLifecycleState::Grace
    );
}

#[test]
fn lifecycle_state_past_grace_is_expired() {
    // Plus grace is 14 days — 30 days past expiry is outside it.
    let old = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    assert_eq!(
        state_sub(SubscriptionTier::Plus, "active", Some(old)).lifecycle_state(),
        SubscriptionLifecycleState::Expired
    );
}

#[test]
fn lifecycle_state_free_is_active_even_past_expiry() {
    // Mirrors is_within_grace_period: Free never downgrades.
    let ancient = (chrono::Utc::now() - chrono::Duration::days(400)).to_rfc3339();
    assert_eq!(
        state_sub(SubscriptionTier::Free, "active", Some(ancient)).lifecycle_state(),
        SubscriptionLifecycleState::Active
    );
}

#[test]
fn lifecycle_state_unparseable_expiry_fails_closed_as_expired() {
    assert_eq!(
        state_sub(SubscriptionTier::Pro, "active", Some("not-a-date".into())).lifecycle_state(),
        SubscriptionLifecycleState::Expired
    );
}

#[test]
fn lifecycle_state_canceled_and_revoked_statuses() {
    // Even with a live future expiry, the server's word is final.
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    assert_eq!(
        state_sub(SubscriptionTier::Pro, "canceled", Some(future.clone())).lifecycle_state(),
        SubscriptionLifecycleState::Canceled
    );
    assert_eq!(
        state_sub(SubscriptionTier::Pro, "revoked", Some(future)).lifecycle_state(),
        SubscriptionLifecycleState::Canceled
    );
}

#[test]
fn lifecycle_state_paused_status() {
    assert_eq!(
        state_sub(SubscriptionTier::Plus, "paused", None).lifecycle_state(),
        SubscriptionLifecycleState::Paused
    );
}

#[test]
fn lifecycle_state_server_written_grace_and_expired_statuses() {
    // Midtrans writes grace_period on failed payment; admin tooling
    // reads/writes expired — both map directly.
    assert_eq!(
        state_sub(SubscriptionTier::Plus, "grace_period", None).lifecycle_state(),
        SubscriptionLifecycleState::Grace
    );
    assert_eq!(
        state_sub(SubscriptionTier::Plus, "expired", None).lifecycle_state(),
        SubscriptionLifecycleState::Expired
    );
}

#[test]
fn lifecycle_state_unknown_status_is_unavailable() {
    // Unrecognized data must fail closed, not guess.
    assert_eq!(
        state_sub(SubscriptionTier::Pro, "something_else", None).lifecycle_state(),
        SubscriptionLifecycleState::Unavailable
    );
}

#[test]
fn lifecycle_state_as_str_matches_serde_snake_case() {
    assert_eq!(SubscriptionLifecycleState::Active.as_str(), "active");
    assert_eq!(SubscriptionLifecycleState::Grace.as_str(), "grace");
    assert_eq!(SubscriptionLifecycleState::Expired.as_str(), "expired");
    assert_eq!(SubscriptionLifecycleState::Canceled.as_str(), "canceled");
    assert_eq!(SubscriptionLifecycleState::Paused.as_str(), "paused");
    assert_eq!(
        SubscriptionLifecycleState::Unavailable.as_str(),
        "unavailable"
    );
}

// ── constants ────────────────────────────────────────

// ── allowed_types_json workspace-type entitlement (C3.2 bundle) ──────

#[test]
fn allows_workspace_type_bundle_payload_unlocks_kds_on_plus() {
    // A Plus + restaurant_starter bundle mints a signed payload whose
    // allowed_types lists kds even though the Plus TIER statically
    // excludes it (subscription-tiers.md §5). The entitlement must honor
    // the payload, not the tier defaults.
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: None,
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json:
            r#"["store-pos","restaurant-pos","admin","warehouse","inventory","kds"]"#.into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.allows_workspace_type("kds"));
    assert!(sub.allows_workspace_type("store-pos"));
    assert!(sub.allows_workspace_type("warehouse"));
}

#[test]
fn allows_workspace_type_empty_payload_falls_back_to_tier_defaults() {
    // Bootstrap / legacy rows carry `[]` — the tier defaults apply, so
    // plain Plus still cannot create a kds workspace.
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: None,
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.allows_workspace_type("kds"));
    assert!(sub.allows_workspace_type("warehouse"));
    assert!(sub.allows_workspace_type("store-pos"));
}

#[test]
fn allows_workspace_type_payload_is_authoritative_not_union() {
    // A payload that does NOT list a type must not grant it, even when
    // the tier would — the signed list is the entitlement boundary.
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Pro,
        status: "active".into(),
        expires_at: None,
        max_locations: 2,
        max_pos_instances: 5,
        allowed_types_json: r#"["store-pos","restaurant-pos","admin"]"#.into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    // Pro's static defaults would allow kds/warehouse, but the payload
    // does not list them.
    assert!(!sub.allows_workspace_type("kds"));
    assert!(!sub.allows_workspace_type("warehouse"));
    assert!(sub.allows_workspace_type("store-pos"));
}

#[test]
fn allows_workspace_type_grace_expired_ignores_stored_list() {
    // A grace-expired subscription reverts to Free — the stored bundle
    // entitlement no longer applies even though the JSON still lists kds.
    let old = chrono::Utc::now() - chrono::Duration::days(30);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(old.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json:
            r#"["store-pos","restaurant-pos","admin","warehouse","inventory","kds"]"#.into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert!(!sub.allows_workspace_type("kds"));
    assert!(sub.allows_workspace_type("store-pos")); // Free default
}

#[test]
fn bootstrap_free_uses_free_defaults() {
    let sub = TenantSubscription::bootstrap_free();
    assert_eq!(sub.tier, SubscriptionTier::Free);
    assert!(sub.allows_workspace_type("store-pos"));
    assert!(!sub.allows_workspace_type("kds"));
    assert!(!sub.allows_workspace_type("warehouse"));
}

#[test]
fn canceled_subscription_not_within_grace() {
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Pro,
        status: "canceled".into(),
        expires_at: None, // lifetime but canceled
        max_locations: 2,
        max_pos_instances: 3,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn clock_skew_constants_are_reasonable() {
    assert_eq!(CLOCK_SKEW_TOLERANCE_SECONDS, 30);
}

#[test]
fn test_is_within_grace_period_with_ledger_evaluates_against_ledger_time() {
    // Expiry was 20 days ago.
    let expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus, // 14-day grace period
        status: "active".into(),
        expires_at: Some(expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };

    // Case 1: If ledger timestamp is 10 days past expiry, it is within the 14-day grace window.
    let ledger_in_grace = (expiry + chrono::Duration::days(10)).to_rfc3339();
    assert!(sub.is_within_grace_period_with_timestamp(&ledger_in_grace));

    // Case 2: If ledger timestamp is 15 days past expiry, it has exceeded the 14-day grace window.
    let ledger_past_grace = (expiry + chrono::Duration::days(15)).to_rfc3339();
    assert!(!sub.is_within_grace_period_with_timestamp(&ledger_past_grace));

    // Case 3: Tampered clock check:
    // If ledger has advanced past the grace deadline (25 days after expiry),
    // even if a rolled-back system clock says it's only 5 days after expiry,
    // evaluation using the ledger timestamp must reject grace.
    let ledger_advanced = (expiry + chrono::Duration::days(25)).to_rfc3339();
    assert!(!sub.is_within_grace_period_with_timestamp(&ledger_advanced));

    // Case 4: Invalid/unparseable ledger timestamp fails closed to wall-clock / false
    assert!(!sub.is_within_grace_period_with_timestamp("not-a-date"));
}

#[test]
fn test_lifecycle_state_with_ledger_evaluates_against_ledger_time() {
    let expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus, // 14-day grace
        status: "active".into(),
        expires_at: Some(expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };

    // Before expiry -> Active
    let before_expiry = (expiry - chrono::Duration::days(2)).to_rfc3339();
    assert_eq!(
        sub.lifecycle_state_with_timestamp(&before_expiry),
        SubscriptionLifecycleState::Active
    );

    // Within grace -> Grace
    let in_grace = (expiry + chrono::Duration::days(5)).to_rfc3339();
    assert_eq!(
        sub.lifecycle_state_with_timestamp(&in_grace),
        SubscriptionLifecycleState::Grace
    );

    // Past grace -> Expired
    let past_grace = (expiry + chrono::Duration::days(16)).to_rfc3339();
    assert_eq!(
        sub.lifecycle_state_with_timestamp(&past_grace),
        SubscriptionLifecycleState::Expired
    );
}

#[test]
fn test_effective_tier_with_ledger_timestamp() {
    let expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus, // 14-day grace
        status: "active".into(),
        expires_at: Some(expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };

    let in_grace = (expiry + chrono::Duration::days(5)).to_rfc3339();
    assert_eq!(
        sub.effective_tier_with_timestamp(&in_grace),
        SubscriptionTier::Plus
    );

    let past_grace = (expiry + chrono::Duration::days(20)).to_rfc3339();
    assert_eq!(
        sub.effective_tier_with_timestamp(&past_grace),
        SubscriptionTier::Free
    );
}

#[test]
fn test_pos_read_only_with_ledger_timestamp() {
    let expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus, // 14-day grace
        status: "active".into(),
        expires_at: Some(expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };

    let in_grace = (expiry + chrono::Duration::days(5)).to_rfc3339();
    assert!(!sub.pos_read_only_with_timestamp(&in_grace));

    let past_grace = (expiry + chrono::Duration::days(20)).to_rfc3339();
    assert!(sub.pos_read_only_with_timestamp(&past_grace));
}

#[test]
fn test_connection_aware_grace_and_pos_read_only() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    // Subscription expired 20 days ago (Plus tier, 14-day grace).
    let expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };

    // Case 1: Empty tables. Monotonic ledger defaults to Utc::now() (20 days past expiry).
    // Grace expired -> false, effective tier -> Free, pos_read_only -> true.
    assert!(!sub.is_within_grace_period_for_connection(&conn));
    assert_eq!(
        sub.effective_tier_for_connection(&conn),
        SubscriptionTier::Free
    );
    assert!(sub.pos_read_only_for_connection(&conn));

    // Case 2: Subscription expiry was only 3 days ago (within 14-day grace).
    let recent_expiry = chrono::Utc::now() - chrono::Duration::days(3);
    let mut sub_recent = sub.clone();
    sub_recent.expires_at = Some(recent_expiry.to_rfc3339());

    assert!(sub_recent.is_within_grace_period_for_connection(&conn));
    assert_eq!(
        sub_recent.effective_tier_for_connection(&conn),
        SubscriptionTier::Plus
    );
    assert!(!sub_recent.pos_read_only_for_connection(&conn));

    // Case 3: Sale inserted with a timestamp far past the grace period (e.g. +25 days).
    let future_sale = (recent_expiry + chrono::Duration::days(25)).to_rfc3339();
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('s-future', 'completed', 500, 'USD', 1, ?1, ?1)",
        rusqlite::params![future_sale],
    )
    .unwrap();

    // Now, even if wall clock was somehow earlier, the ledger timestamp in the DB
    // advances time past the grace deadline -> grace rejected, read-only enforced.
    assert!(!sub_recent.is_within_grace_period_for_connection(&conn));
    assert_eq!(
        sub_recent.effective_tier_for_connection(&conn),
        SubscriptionTier::Free
    );
    assert!(sub_recent.pos_read_only_for_connection(&conn));
}

// ── SubscriptionTier feature-flag coverage ─────────────────────────

#[test]
fn max_warehouses_per_tier() {
    // Free/OneTime: 1 warehouse; Plus: 2; Pro: 3
    assert_eq!(SubscriptionTier::Free.max_warehouses(), Some(1));
    assert_eq!(SubscriptionTier::OneTime.max_warehouses(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_warehouses(), Some(2));
    assert_eq!(SubscriptionTier::Pro.max_warehouses(), Some(3));
    // Premium/Enterprise: unlimited
    assert_eq!(SubscriptionTier::Premium.max_warehouses(), None);
    assert_eq!(SubscriptionTier::Enterprise.max_warehouses(), None);
}

#[test]
fn supports_cloud_sync_per_tier() {
    assert!(!SubscriptionTier::Free.supports_cloud_sync());
    assert!(!SubscriptionTier::OneTime.supports_cloud_sync());
    assert!(SubscriptionTier::Plus.supports_cloud_sync());
    assert!(SubscriptionTier::Pro.supports_cloud_sync());
    assert!(SubscriptionTier::Premium.supports_cloud_sync());
    assert!(SubscriptionTier::Enterprise.supports_cloud_sync());
}

#[test]
fn supports_qris_per_tier() {
    assert!(!SubscriptionTier::Free.supports_qris());
    assert!(!SubscriptionTier::OneTime.supports_qris());
    assert!(SubscriptionTier::Plus.supports_qris());
    assert!(SubscriptionTier::Pro.supports_qris());
    assert!(SubscriptionTier::Premium.supports_qris());
    assert!(SubscriptionTier::Enterprise.supports_qris());
}

#[test]
fn supports_stripe_per_tier() {
    assert!(!SubscriptionTier::Free.supports_stripe());
    assert!(!SubscriptionTier::OneTime.supports_stripe());
    assert!(!SubscriptionTier::Plus.supports_stripe());
    assert!(SubscriptionTier::Pro.supports_stripe());
    assert!(SubscriptionTier::Premium.supports_stripe());
    assert!(SubscriptionTier::Enterprise.supports_stripe());
}

#[test]
fn supports_lua_engine_per_tier() {
    assert!(!SubscriptionTier::Free.supports_lua_engine());
    assert!(!SubscriptionTier::OneTime.supports_lua_engine());
    assert!(!SubscriptionTier::Plus.supports_lua_engine());
    // Pro does NOT get Lua — Premium/Enterprise only (§3 Business Logic).
    assert!(!SubscriptionTier::Pro.supports_lua_engine());
    assert!(SubscriptionTier::Premium.supports_lua_engine());
    assert!(SubscriptionTier::Enterprise.supports_lua_engine());
}

#[test]
fn supports_multi_warehouse_fallback_per_tier() {
    assert!(!SubscriptionTier::Free.supports_multi_warehouse_fallback());
    assert!(!SubscriptionTier::OneTime.supports_multi_warehouse_fallback());
    assert!(!SubscriptionTier::Plus.supports_multi_warehouse_fallback());
    assert!(SubscriptionTier::Pro.supports_multi_warehouse_fallback());
    assert!(SubscriptionTier::Premium.supports_multi_warehouse_fallback());
    assert!(SubscriptionTier::Enterprise.supports_multi_warehouse_fallback());
}

#[test]
fn supports_regional_zones_only_enterprise() {
    assert!(!SubscriptionTier::Free.supports_regional_zones());
    assert!(!SubscriptionTier::OneTime.supports_regional_zones());
    assert!(!SubscriptionTier::Plus.supports_regional_zones());
    assert!(!SubscriptionTier::Pro.supports_regional_zones());
    assert!(!SubscriptionTier::Premium.supports_regional_zones());
    assert!(SubscriptionTier::Enterprise.supports_regional_zones());
}

#[test]
fn max_locations_per_tier() {
    assert_eq!(SubscriptionTier::Free.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::OneTime.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Pro.max_locations(), Some(2));
    assert_eq!(SubscriptionTier::Premium.max_locations(), Some(5));
    assert_eq!(SubscriptionTier::Enterprise.max_locations(), None);
}

#[test]
fn max_pos_instances_per_tier() {
    assert_eq!(SubscriptionTier::Free.max_pos_instances(), Some(1));
    assert_eq!(SubscriptionTier::OneTime.max_pos_instances(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_pos_instances(), Some(2));
    assert_eq!(SubscriptionTier::Pro.max_pos_instances(), Some(5));
    assert_eq!(SubscriptionTier::Premium.max_pos_instances(), None);
    assert_eq!(SubscriptionTier::Enterprise.max_pos_instances(), None);
}

#[test]
fn allows_workspace_type_free_tier() {
    let tier = SubscriptionTier::Free;
    assert!(tier.allows_workspace_type("store-pos"));
    assert!(tier.allows_workspace_type("restaurant-pos"));
    assert!(tier.allows_workspace_type("admin"));
    assert!(!tier.allows_workspace_type("warehouse"));
    assert!(!tier.allows_workspace_type("kds"));
    assert!(!tier.allows_workspace_type("custom-plugin"));
}

#[test]
fn allows_workspace_type_plus_tier() {
    let tier = SubscriptionTier::Plus;
    assert!(tier.allows_workspace_type("store-pos"));
    assert!(tier.allows_workspace_type("restaurant-pos"));
    assert!(tier.allows_workspace_type("admin"));
    assert!(tier.allows_workspace_type("warehouse"));
    assert!(tier.allows_workspace_type("inventory"));
    // Plus does NOT unlock kds — that is Pro (§3 Workspace Types).
    assert!(!tier.allows_workspace_type("kds"));
    assert!(!tier.allows_workspace_type("custom-plugin"));
}

#[test]
fn allows_workspace_type_pro_tier_allows_all() {
    for tier in [
        SubscriptionTier::Pro,
        SubscriptionTier::Premium,
        SubscriptionTier::Enterprise,
    ] {
        assert!(tier.allows_workspace_type("store-pos"));
        assert!(tier.allows_workspace_type("restaurant-pos"));
        assert!(tier.allows_workspace_type("warehouse"));
        assert!(tier.allows_workspace_type("kds"));
        assert!(tier.allows_workspace_type("admin"));
        assert!(tier.allows_workspace_type("custom-plugin"));
        assert!(tier.allows_workspace_type("anything"));
    }
}

#[test]
fn from_db_aliases() {
    assert_eq!(SubscriptionTier::from_db("free"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db("trial"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db("FREE"), SubscriptionTier::Free);
    assert_eq!(
        SubscriptionTier::from_db("one_time"),
        SubscriptionTier::OneTime
    );
    assert_eq!(
        SubscriptionTier::from_db("perpetual"),
        SubscriptionTier::OneTime
    );
    assert_eq!(
        SubscriptionTier::from_db("one-time"),
        SubscriptionTier::OneTime
    );
    assert_eq!(
        SubscriptionTier::from_db("onetime"),
        SubscriptionTier::OneTime
    );
    assert_eq!(
        SubscriptionTier::from_db("standard"), // legacy alias → Plus
        SubscriptionTier::Plus
    );
    assert_eq!(SubscriptionTier::from_db("plus"), SubscriptionTier::Plus);
    assert_eq!(SubscriptionTier::from_db("pro"), SubscriptionTier::Pro);
    assert_eq!(
        SubscriptionTier::from_db("premium"),
        SubscriptionTier::Premium
    );
    assert_eq!(
        SubscriptionTier::from_db("enterprise"),
        SubscriptionTier::Enterprise
    );
}

#[test]
fn from_db_unknown_defaults_to_free() {
    assert_eq!(SubscriptionTier::from_db("unknown"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db(""), SubscriptionTier::Free);
    assert_eq!(
        SubscriptionTier::from_db("ENTREPRISE"),
        SubscriptionTier::Free
    ); // case-sensitive after to_lowercase
}

#[test]
fn tier_names() {
    assert_eq!(SubscriptionTier::Free.name(), "Free");
    assert_eq!(SubscriptionTier::OneTime.name(), "1-Time Perpetual");
    assert_eq!(SubscriptionTier::Plus.name(), "Plus");
    assert_eq!(SubscriptionTier::Pro.name(), "Pro");
    assert_eq!(SubscriptionTier::Premium.name(), "Premium");
    assert_eq!(SubscriptionTier::Enterprise.name(), "Enterprise");
}

// ── New tier model (subscription-tiers.md §3) ──────────────────────

#[test]
fn test_plus_quota_limits() {
    assert_eq!(SubscriptionTier::Plus.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_pos_instances(), Some(2));
    assert_eq!(SubscriptionTier::Plus.max_warehouses(), Some(2));
    assert_eq!(SubscriptionTier::Plus.max_staff_users(), Some(5));
    assert_eq!(SubscriptionTier::Plus.sales_history_days(), Some(365));
}

#[test]
fn test_pro_quota_limits() {
    assert_eq!(SubscriptionTier::Pro.max_locations(), Some(2));
    assert_eq!(SubscriptionTier::Pro.max_pos_instances(), Some(5));
    assert_eq!(SubscriptionTier::Pro.max_warehouses(), Some(3));
    assert_eq!(SubscriptionTier::Pro.max_staff_users(), Some(20));
    assert_eq!(SubscriptionTier::Pro.sales_history_days(), Some(5 * 365));
}

#[test]
fn test_free_history_limit() {
    // Free: 3 months, Plus: 1 year, Pro: 5 years, Premium+: unlimited.
    assert_eq!(SubscriptionTier::Free.sales_history_days(), Some(90));
    assert_eq!(SubscriptionTier::Plus.sales_history_days(), Some(365));
    assert_eq!(SubscriptionTier::Pro.sales_history_days(), Some(5 * 365));
    assert_eq!(SubscriptionTier::Premium.sales_history_days(), None);
    assert_eq!(SubscriptionTier::Enterprise.sales_history_days(), None);
}

#[test]
fn test_workspace_type_matrix() {
    // Plus gets inventory/warehouse but NOT kds.
    assert!(SubscriptionTier::Plus.allows_workspace_type("store-pos"));
    assert!(SubscriptionTier::Plus.allows_workspace_type("restaurant-pos"));
    assert!(SubscriptionTier::Plus.allows_workspace_type("admin"));
    assert!(SubscriptionTier::Plus.allows_workspace_type("inventory"));
    assert!(SubscriptionTier::Plus.allows_workspace_type("warehouse"));
    assert!(!SubscriptionTier::Plus.allows_workspace_type("kds"));
    // Pro gets kds.
    assert!(SubscriptionTier::Pro.allows_workspace_type("kds"));
    assert!(SubscriptionTier::Pro.allows_workspace_type("warehouse"));
}

#[test]
fn test_staff_limits_per_tier() {
    assert_eq!(SubscriptionTier::Free.max_staff_users(), Some(1));
    assert_eq!(SubscriptionTier::Plus.max_staff_users(), Some(5));
    assert_eq!(SubscriptionTier::Pro.max_staff_users(), Some(20));
    assert_eq!(SubscriptionTier::Premium.max_staff_users(), Some(50));
    assert_eq!(SubscriptionTier::Enterprise.max_staff_users(), None);
}

#[test]
fn test_feature_flag_matrix() {
    // Loyalty: Premium/Enterprise only.
    assert!(!SubscriptionTier::Free.supports_loyalty());
    assert!(!SubscriptionTier::Plus.supports_loyalty());
    assert!(!SubscriptionTier::Pro.supports_loyalty());
    assert!(SubscriptionTier::Premium.supports_loyalty());
    assert!(SubscriptionTier::Enterprise.supports_loyalty());
    // Analytics: Pro and above.
    assert!(!SubscriptionTier::Free.supports_analytics());
    assert!(!SubscriptionTier::Plus.supports_analytics());
    assert!(SubscriptionTier::Pro.supports_analytics());
    assert!(SubscriptionTier::Premium.supports_analytics());
    assert!(SubscriptionTier::Enterprise.supports_analytics());
    // Daily Sales Dashboard: Plus and above (blurred teaser on Free).
    assert!(!SubscriptionTier::Free.supports_daily_dashboard());
    assert!(SubscriptionTier::Plus.supports_daily_dashboard());
    assert!(SubscriptionTier::Pro.supports_daily_dashboard());
    assert!(SubscriptionTier::Premium.supports_daily_dashboard());
    assert!(SubscriptionTier::Enterprise.supports_daily_dashboard());
}

#[test]
fn test_offline_grace_days_per_tier() {
    assert_eq!(SubscriptionTier::Free.offline_grace_days(), 7);
    assert_eq!(SubscriptionTier::Plus.offline_grace_days(), 14);
    assert_eq!(SubscriptionTier::Pro.offline_grace_days(), 14);
    assert_eq!(SubscriptionTier::Premium.offline_grace_days(), 30);
    // §B: standard Enterprise uses 60 days (the pricing page publishes the
    // same number); a contract needing a different window ships as a
    // signed custom override, not a client-side fallback.
    assert_eq!(SubscriptionTier::Enterprise.offline_grace_days(), 60);
}

#[test]
fn test_from_db_plus_and_standard_alias() {
    assert_eq!(SubscriptionTier::from_db("plus"), SubscriptionTier::Plus);
    // Legacy "standard" rows map to Plus.
    assert_eq!(
        SubscriptionTier::from_db("standard"),
        SubscriptionTier::Plus
    );
    assert_eq!(
        SubscriptionTier::from_db("STANDARD"),
        SubscriptionTier::Plus
    );
}

// ── C4.3: Add-on Marketplace ──────────────────────────────

/// Helper: build a TenantSubscription with a given signed payload.
fn sub_with_payload(payload: &str) -> TenantSubscription {
    TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: None,
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: payload.into(),
        api_key: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn addons_parses_json_array() {
    let payload = r#"{"tier":"plus","addons":["advanced_analytics","priority_support"]}"#;
    let sub = sub_with_payload(payload);
    let addons = sub.addons();
    assert_eq!(addons.len(), 2);
    assert!(addons.contains(&"advanced_analytics".to_string()));
    assert!(addons.contains(&"priority_support".to_string()));
}

#[test]
fn addons_empty_payload_returns_empty_vec() {
    let sub = sub_with_payload("");
    assert!(sub.addons().is_empty());
}

#[test]
fn addons_no_addons_key_returns_empty_vec() {
    let payload = r#"{"tier":"plus"}"#;
    let sub = sub_with_payload(payload);
    assert!(sub.addons().is_empty());
}

#[test]
fn addons_invalid_json_returns_empty_vec() {
    let sub = sub_with_payload("not json at all");
    assert!(sub.addons().is_empty());
}

#[test]
fn addons_addons_not_array_returns_empty_vec() {
    let payload = r#"{"addons":"not_an_array"}"#;
    let sub = sub_with_payload(payload);
    assert!(sub.addons().is_empty());
}

#[test]
fn has_addon_case_insensitive() {
    let payload = r#"{"addons":["Advanced_Analytics"]}"#;
    let sub = sub_with_payload(payload);
    assert!(sub.has_addon("advanced_analytics"));
    assert!(sub.has_addon("ADVANCED_ANALYTICS"));
    assert!(sub.has_addon("Advanced_Analytics"));
}

#[test]
fn has_addon_returns_false_when_not_present() {
    let payload = r#"{"addons":["priority_support"]}"#;
    let sub = sub_with_payload(payload);
    assert!(!sub.has_addon("advanced_analytics"));
}

#[test]
fn has_addon_empty_payload() {
    let sub = sub_with_payload("");
    assert!(!sub.has_addon("anything"));
}

#[test]
fn supports_analytics_with_addons_plus_tier() {
    // Plus without addon → no analytics
    let payload = r#"{"tier":"plus","addons":[]}"#;
    let sub = sub_with_payload(payload);
    assert!(!sub.supports_analytics_with_addons());

    // Plus with advanced_analytics addon → analytics enabled
    let payload = r#"{"tier":"plus","addons":["advanced_analytics"]}"#;
    let sub = sub_with_payload(payload);
    assert!(sub.supports_analytics_with_addons());
}

#[test]
fn supports_analytics_with_addons_pro_tier() {
    // Pro always supports analytics regardless of addons
    let mut sub = sub_with_payload("");
    sub.tier = SubscriptionTier::Pro;
    assert!(sub.supports_analytics_with_addons());
}

#[test]
fn supports_analytics_with_addons_free_tier() {
    // Free never supports analytics, even with addon
    let mut sub = sub_with_payload(r#"{"addons":["advanced_analytics"]}"#);
    sub.tier = SubscriptionTier::Free;
    assert!(!sub.supports_analytics_with_addons());
}

#[test]
fn supports_analytics_with_addons_premium_tier() {
    let mut sub = sub_with_payload("");
    sub.tier = SubscriptionTier::Premium;
    assert!(sub.supports_analytics_with_addons());
}

#[test]
fn addons_empty_array() {
    let payload = r#"{"addons":[]}"#;
    let sub = sub_with_payload(payload);
    assert!(sub.addons().is_empty());
    assert!(!sub.has_addon("anything"));
}

#[test]
fn addons_multiple_addons() {
    let payload =
        r#"{"addons":["advanced_analytics","priority_support","extra_storage","custom_hal"]}"#;
    let sub = sub_with_payload(payload);
    assert_eq!(sub.addons().len(), 4);
    assert!(sub.has_addon("advanced_analytics"));
    assert!(sub.has_addon("priority_support"));
    assert!(sub.has_addon("extra_storage"));
    assert!(sub.has_addon("custom_hal"));
}

// ── SubscriptionTier::tier_key() — explicit coverage ───────────────────

#[test]
fn tier_key_free_is_free() {
    assert_eq!(SubscriptionTier::Free.tier_key(), "free");
}

#[test]
fn tier_key_onetime_maps_to_free() {
    // Critical: OneTime DB rows were always treated as free quota tier.
    assert_eq!(SubscriptionTier::OneTime.tier_key(), "free");
}

#[test]
fn tier_key_plus() {
    assert_eq!(SubscriptionTier::Plus.tier_key(), "plus");
}

#[test]
fn tier_key_pro() {
    assert_eq!(SubscriptionTier::Pro.tier_key(), "pro");
}

#[test]
fn tier_key_premium() {
    assert_eq!(SubscriptionTier::Premium.tier_key(), "premium");
}

#[test]
fn tier_key_enterprise() {
    assert_eq!(SubscriptionTier::Enterprise.tier_key(), "enterprise");
}

// ── is_within_grace_period edge cases ───────────────────────────────────

#[test]
fn grace_period_unparseable_expiry_returns_false() {
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some("not-a-valid-date".into()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    // Unparseable expiry → assume expired.
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn grace_period_premium_20_days_after_expiry_still_in_grace() {
    // Premium has 30-day grace. 20 days past expiry → still within grace.
    let past_expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Premium,
        status: "active".into(),
        expires_at: Some(past_expiry.to_rfc3339()),
        max_locations: 5,
        max_pos_instances: 10,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Premium);
}

#[test]
fn grace_period_pro_20_days_after_expiry_outside_grace() {
    // Pro has 14-day grace. 20 days past expiry → outside grace.
    let past_expiry = chrono::Utc::now() - chrono::Duration::days(20);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Pro,
        status: "active".into(),
        expires_at: Some(past_expiry.to_rfc3339()),
        max_locations: 2,
        max_pos_instances: 5,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn grace_period_plus_13_days_still_in_grace() {
    // Plus has 14-day grace. 13 days past expiry → safely within grace.
    // (We avoid exactly 14 days because Utc::now() is called twice —
    // once in setup and once in is_within_grace_period — and a few
    // milliseconds elapse, making the boundary flaky.)
    let past_expiry = chrono::Utc::now() - chrono::Duration::days(13);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(past_expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
}

#[test]
fn grace_period_plus_15_days_just_outside() {
    // Plus has 14-day grace. 15 days past expiry → outside grace.
    let past_expiry = chrono::Utc::now() - chrono::Duration::days(15);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(past_expiry.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn grace_period_future_expiry_always_valid() {
    // Subscription hasn't expired yet → always within grace.
    let future = chrono::Utc::now() + chrono::Duration::days(365);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Pro,
        status: "active".into(),
        expires_at: Some(future.to_rfc3339()),
        max_locations: 2,
        max_pos_instances: 5,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Pro);
}

// ── QuotaError Display for all variants ─────────────────────────────────

#[test]
fn quota_error_staff_limit_display() {
    let err = QuotaError::StaffLimit {
        tier: "Plus".into(),
        limit: 5,
        current: 5,
    };
    let msg = err.to_string();
    assert!(msg.contains("Plus"));
    assert!(msg.contains("5"));
    assert!(msg.contains("staff"));
}

#[test]
fn quota_error_warehouse_limit_display() {
    let err = QuotaError::WarehouseLimit {
        tier: "Pro".into(),
        limit: 3,
        current: 3,
    };
    let msg = err.to_string();
    assert!(msg.contains("Pro"));
    assert!(msg.contains("3"));
    assert!(msg.contains("warehouse"));
}

#[test]
fn quota_error_type_not_allowed_display() {
    let err = QuotaError::TypeNotAllowed {
        tier: "Free".into(),
        type_key: "kds".into(),
    };
    let msg = err.to_string();
    assert!(msg.contains("kds"));
    assert!(msg.contains("Free"));
    assert!(msg.contains("higher tier"));
}

// ── QuotaError → CoreError conversion ───────────────────────────────────

#[test]
fn quota_error_converts_to_core_error() {
    let err = QuotaError::RegisterLimit {
        tier: "Free".into(),
        limit: 1,
        current: 1,
    };
    let core_err: CoreError = err.into();
    let msg = core_err.to_string();
    assert!(msg.contains("Free"));
    assert!(msg.contains("register"));
}

#[test]
fn quota_error_store_limit_converts_to_core_error() {
    let err = QuotaError::StoreLimit {
        tier: "Pro".into(),
        limit: 2,
        current: 2,
    };
    let core_err: CoreError = err.into();
    let msg = core_err.to_string();
    assert!(msg.contains("Pro"));
    assert!(msg.contains("store"));
}

#[test]
fn quota_error_staff_limit_converts_to_core_error() {
    let err = QuotaError::StaffLimit {
        tier: "Enterprise".into(),
        limit: 50,
        current: 50,
    };
    let core_err: CoreError = err.into();
    let msg = core_err.to_string();
    assert!(msg.contains("Enterprise"));
    assert!(msg.contains("staff"));
}

#[test]
fn quota_error_warehouse_limit_converts_to_core_error() {
    let err = QuotaError::WarehouseLimit {
        tier: "Premium".into(),
        limit: 10,
        current: 10,
    };
    let core_err: CoreError = err.into();
    let msg = core_err.to_string();
    assert!(msg.contains("Premium"));
    assert!(msg.contains("warehouse"));
}

#[test]
fn quota_error_type_not_allowed_converts_to_core_error() {
    let err = QuotaError::TypeNotAllowed {
        tier: "Plus".into(),
        type_key: "kds".into(),
    };
    let core_err: CoreError = err.into();
    let msg = core_err.to_string();
    assert!(msg.contains("kds"));
    assert!(msg.contains("Plus"));
}

// ── effective_tier edge cases ───────────────────────────────────────────

#[test]
fn effective_tier_canceled_with_future_expiry() {
    // Canceled subscription with a future expiry → still reverts to Free.
    let future = chrono::Utc::now() + chrono::Duration::days(365);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Premium,
        status: "canceled".into(),
        expires_at: Some(future.to_rfc3339()),
        max_locations: 5,
        max_pos_instances: 10,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
}

#[test]
fn effective_tier_enterprise_active() {
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Enterprise,
        status: "active".into(),
        expires_at: None,
        max_locations: 0,
        max_pos_instances: 0,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Enterprise);
}

#[test]
fn effective_tier_plus_within_grace() {
    let recent = chrono::Utc::now() - chrono::Duration::days(5);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(recent.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Plus);
}

// ── workspace type entitlement with grace expiration ────────────────────

#[test]
fn workspace_type_grace_expired_plus_reverts_to_free_defaults() {
    // Plus with expired grace → Free workspace types only.
    let old = chrono::Utc::now() - chrono::Duration::days(30);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: Some(old.to_rfc3339()),
        max_locations: 1,
        max_pos_instances: 2,
        // Even though kds is in the payload, grace expiry reverts to Free.
        allowed_types_json:
            r#"["store-pos","restaurant-pos","admin","warehouse","inventory","kds"]"#.into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    // Grace expired → Free defaults.
    assert!(!sub.allows_workspace_type("kds"));
    assert!(!sub.allows_workspace_type("warehouse"));
    assert!(sub.allows_workspace_type("store-pos"));
    assert!(sub.allows_workspace_type("admin"));
}

#[test]
fn workspace_type_grace_expired_pro_reverts_to_free_defaults() {
    // Pro with expired grace → Free workspace types only (no kds, no warehouse).
    let old = chrono::Utc::now() - chrono::Duration::days(30);
    let sub = TenantSubscription {
        tenant_id: "test".into(),
        tier: SubscriptionTier::Pro,
        status: "active".into(),
        expires_at: Some(old.to_rfc3339()),
        max_locations: 2,
        max_pos_instances: 5,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    };
    assert!(!sub.allows_workspace_type("kds"));
    assert!(!sub.allows_workspace_type("warehouse"));
    assert!(!sub.allows_workspace_type("inventory"));
    assert!(sub.allows_workspace_type("store-pos"));
    assert!(sub.allows_workspace_type("restaurant-pos"));
    assert!(sub.allows_workspace_type("admin"));
}

// ── from_db case sensitivity ───────────────────────────────────────────

#[test]
fn from_db_case_insensitive() {
    assert_eq!(SubscriptionTier::from_db("FREE"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db("Free"), SubscriptionTier::Free);
    assert_eq!(SubscriptionTier::from_db("PLUS"), SubscriptionTier::Plus);
    assert_eq!(SubscriptionTier::from_db("Pro"), SubscriptionTier::Pro);
    assert_eq!(
        SubscriptionTier::from_db("PREMIUM"),
        SubscriptionTier::Premium
    );
    assert_eq!(
        SubscriptionTier::from_db("ENTERPRISE"),
        SubscriptionTier::Enterprise
    );
}

// ── bootstrap_free helper ───────────────────────────────────────────────

#[test]
fn bootstrap_free_has_correct_defaults() {
    let sub = TenantSubscription::bootstrap_free();
    assert_eq!(sub.tenant_id, "default");
    assert_eq!(sub.tier, SubscriptionTier::Free);
    assert_eq!(sub.status, "active");
    assert!(sub.expires_at.is_none());
    assert_eq!(sub.max_locations, 1);
    assert_eq!(sub.max_pos_instances, 1);
    assert_eq!(sub.allowed_types_json, "[]");
    assert!(sub.signature.is_empty());
    assert!(sub.signed_payload.is_empty());
    assert!(sub.api_key.is_empty());
    assert!(sub.updated_at.is_empty());
}

// ── tier_key round-trip with from_db ───────────────────────────────────

#[test]
fn tier_key_roundtrip_for_all_tiers() {
    // tier_key() should produce a value that from_db() can parse back.
    let tiers = [
        SubscriptionTier::Free,
        SubscriptionTier::Plus,
        SubscriptionTier::Pro,
        SubscriptionTier::Premium,
        SubscriptionTier::Enterprise,
    ];
    for tier in &tiers {
        let key = tier.tier_key();
        let parsed = SubscriptionTier::from_db(key);
        match tier {
            SubscriptionTier::Free => assert_eq!(parsed, SubscriptionTier::Free),
            SubscriptionTier::OneTime => assert_eq!(parsed, SubscriptionTier::Free),
            SubscriptionTier::Plus => assert_eq!(parsed, SubscriptionTier::Plus),
            SubscriptionTier::Pro => assert_eq!(parsed, SubscriptionTier::Pro),
            SubscriptionTier::Premium => assert_eq!(parsed, SubscriptionTier::Premium),
            SubscriptionTier::Enterprise => assert_eq!(parsed, SubscriptionTier::Enterprise),
        }
    }
}

// ── POS read-only lock (§B) ───────────────────────────────────────────

#[test]
fn pos_read_only_only_when_grace_fully_lapsed() {
    // Active (future expiry) → writable.
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    assert!(!state_sub(SubscriptionTier::Plus, "active", Some(future.clone())).pos_read_only());
    // In grace → operational runtime continues (the whole point of grace).
    let recent = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    assert!(!state_sub(SubscriptionTier::Plus, "active", Some(recent)).pos_read_only());
    // Past grace → read-only.
    let old = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    assert!(state_sub(SubscriptionTier::Plus, "active", Some(old)).pos_read_only());
}

#[test]
fn pos_read_only_free_never_locks() {
    // Free is active forever (mirrors is_within_grace_period) — a Free
    // register never locks, even with an ancient expiry on the row.
    let ancient = (chrono::Utc::now() - chrono::Duration::days(400)).to_rfc3339();
    assert!(!state_sub(SubscriptionTier::Free, "active", Some(ancient)).pos_read_only());
}

#[test]
fn pos_read_only_canceled_sells_as_free_instead_of_locking() {
    // Canceled reverts entitlements to Free immediately (core contract),
    // but the §B read-only lock is about grace lapse, not cancellation —
    // a canceled merchant keeps selling on the Free tier.
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    assert!(!state_sub(SubscriptionTier::Pro, "canceled", Some(future.clone())).pos_read_only());
    assert!(!state_sub(SubscriptionTier::Pro, "revoked", Some(future)).pos_read_only());
}

#[test]
fn pos_read_only_unknown_status_does_not_brick_the_register() {
    // Missing/tampered data degrades to Free-tier operations; the §B
    // fail-closed rule targets admin features, not the sale path.
    assert!(!state_sub(SubscriptionTier::Pro, "garbage", None).pos_read_only());
}

#[test]
fn enforce_pos_writable_error_is_actionable() {
    let old = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let sub = state_sub(SubscriptionTier::Plus, "active", Some(old));
    let err = sub.enforce_pos_writable().unwrap_err().to_string();
    assert!(err.contains("read-only"), "got: {err}");
    assert!(err.contains("grace"), "got: {err}");
}

#[test]
fn test_enforce_pos_writable_for_connection() {
    use crate::migrations;
    let conn = migrations::fresh_db();

    // Expired 3 days ago (Plus tier, within 14-day grace) -> writable.
    let recent = (chrono::Utc::now() - chrono::Duration::days(3)).to_rfc3339();
    let sub = state_sub(SubscriptionTier::Plus, "active", Some(recent));
    assert!(sub.enforce_pos_writable_for_connection(&conn).is_ok());

    // Insert a sale with a timestamp past the 14-day grace window.
    let future_ts = (chrono::Utc::now() + chrono::Duration::days(20)).to_rfc3339();
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('s1', 'completed', 100, 'USD', 1, ?1, ?1)",
        rusqlite::params![future_ts],
    )
    .unwrap();

    // With ledger advancing past grace, enforce_pos_writable_for_connection rejects with SubscriptionReadOnly.
    let res = sub.enforce_pos_writable_for_connection(&conn);
    assert!(res.is_err());
    let err = res.unwrap_err().to_string();
    assert!(err.contains("read-only"), "got: {err}");
}
// ── Phase C: trial state, client-visible ────────────────────────────

/// Both trial fields present, as the server emits them for a trial key.
#[test]
fn trial_fields_parse_when_present() {
    let sub = sub_with_payload(
        r#"{"tier_key":"plus","is_trial":true,"trial_ends_at":"2027-01-15T00:00:00Z"}"#,
    );
    assert!(sub.is_trial());
    assert_eq!(sub.trial_ends_at().as_deref(), Some("2027-01-15T00:00:00Z"));
}

/// A payload signed before Phase C carries neither field. It must read
/// exactly like a paid subscription — that equivalence is why the wire
/// change is additive and needs no dual-read on the client.
#[test]
fn trial_fields_absent_read_as_not_trial() {
    let sub = sub_with_payload(r#"{"tier_key":"plus"}"#);
    assert!(!sub.is_trial());
    assert_eq!(sub.trial_ends_at(), None);
}

/// An explicit `false` and an explicit empty string are the paid answer,
/// not a malformed one.
#[test]
fn trial_fields_explicitly_empty_read_as_not_trial() {
    let sub = sub_with_payload(r#"{"is_trial":false,"trial_ends_at":""}"#);
    assert!(!sub.is_trial());
    assert_eq!(sub.trial_ends_at(), None);
}

/// `is_trial: true` with no usable deadline still reports the flag — the
/// two fields are independent facts, not one gate.
#[test]
fn trial_flag_survives_a_missing_end_date() {
    let sub = sub_with_payload(r#"{"is_trial":true,"trial_ends_at":""}"#);
    assert!(sub.is_trial());
    assert_eq!(sub.trial_ends_at(), None);
}

/// The fail-closed case that matters: a `trial_ends_at` that is not valid
/// RFC3339 is dropped rather than surfaced. A trial whose deadline cannot
/// be parsed is not a trial the client can count days against, so it is
/// better to report no date than to report garbage as a date.
#[test]
fn trial_invalid_timestamp_fails_closed_to_none() {
    for bad in [
        "not-a-date",
        "2027-13-45T99:99:99Z",
        "15/01/2027",
        "2027-01-15",
        "2027-01-15 00:00:00",
    ] {
        let payload = format!(r#"{{"is_trial":true,"trial_ends_at":"{bad}"}}"#);
        let sub = sub_with_payload(&payload);
        assert_eq!(
            sub.trial_ends_at(),
            None,
            "unparseable {bad:?} must fail closed to None"
        );
    }
}

/// Wrong JSON types are as untrustworthy as wrong strings.
#[test]
fn trial_wrongly_typed_fields_fail_closed() {
    let sub = sub_with_payload(r#"{"is_trial":"yes","trial_ends_at":123}"#);
    assert!(!sub.is_trial());
    assert_eq!(sub.trial_ends_at(), None);
}

/// An unparseable payload yields the not-a-trial answer, matching the
/// `addons()` contract in the same impl block.
#[test]
fn trial_unparseable_payload_fails_closed() {
    let sub = sub_with_payload("not json at all");
    assert!(!sub.is_trial());
    assert_eq!(sub.trial_ends_at(), None);
}

/// Phase C's central invariant: trial-ness is carried as data ALONGSIDE
/// the tier, and the collapse itself is untouched. `from_db("trial")`
/// still answers Free, and adding the two fields to an otherwise
/// identical payload moves no quota answer.
#[test]
fn trial_state_does_not_change_the_tier_or_quota_answer() {
    assert_eq!(
        SubscriptionTier::from_db("trial"),
        SubscriptionTier::Free,
        "the quota answer for a trial must stay Free"
    );
    let plain = sub_with_payload(r#"{"tier_key":"plus"}"#);
    let trial = sub_with_payload(
        r#"{"tier_key":"plus","is_trial":true,"trial_ends_at":"2027-01-15T00:00:00Z"}"#,
    );
    assert_eq!(trial.tier, plain.tier, "trial fields must not move tier");
    assert_eq!(
        trial.effective_tier(),
        plain.effective_tier(),
        "nor the grace-aware effective tier"
    );
    assert_eq!(trial.max_locations, plain.max_locations);
    assert_eq!(trial.max_pos_instances, plain.max_pos_instances);
    // ...while the flag itself is the thing that survived the collapse.
    assert!(trial.is_trial());
    assert!(!plain.is_trial());
}

// ── Audit retention schedule (todo-global-saas-2.md P1) ──────

#[test]
fn tier_audit_retention_matches_published_schedule() {
    // Adopted schedule (todo-global-saas-1.md "Decisions to preserve",
    // published on the pricing page since 2026-09-06): Free none, Plus 90,
    // Pro 180, Premium 1 year, Enterprise 3 years.
    assert_eq!(SubscriptionTier::Free.audit_retention_days(), None);
    assert_eq!(SubscriptionTier::Plus.audit_retention_days(), Some(90));
    assert_eq!(SubscriptionTier::Pro.audit_retention_days(), Some(180));
    assert_eq!(
        SubscriptionTier::Premium.audit_retention_days(),
        Some(365),
        "1 year"
    );
    assert_eq!(
        SubscriptionTier::Enterprise.audit_retention_days(),
        Some(1_095),
        "3 years default"
    );
}

#[test]
fn tier_audit_retention_one_time_is_free() {
    // The deprecated perpetual license resolves as the free quota tier
    // everywhere else (tier_key), so it carries no audit retention
    // entitlement here either.
    assert_eq!(SubscriptionTier::OneTime.audit_retention_days(), None);
}

// ── Trial Grace & Expiry Enforcement ──────────────────────────────

#[test]
fn test_trial_expired_deadline_terminates_grace_and_lifecycle() {
    // A Plus subscription with contract expiry in the future (+30 days),
    // but marked as a trial with trial_ends_at in the past (-2 days).
    let future_contract = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    let past_trial = (chrono::Utc::now() - chrono::Duration::days(2)).to_rfc3339();

    let payload =
        format!(r#"{{"tier_key":"plus","is_trial":true,"trial_ends_at":"{past_trial}"}}"#);
    let mut sub = sub_with_payload(&payload);
    sub.expires_at = Some(future_contract);

    // Because trial_ends_at has passed and trials have 0 offline grace days,
    // it must not be within grace, and its lifecycle must be Expired.
    assert!(!sub.is_within_grace_period());
    assert_eq!(sub.effective_tier(), SubscriptionTier::Free);
    assert_eq!(sub.lifecycle_state(), SubscriptionLifecycleState::Expired);
    assert!(sub.pos_read_only());

    // Conversely, if trial_ends_at is in the future, it is Active and within grace.
    let future_trial = (chrono::Utc::now() + chrono::Duration::days(5)).to_rfc3339();
    let payload_active =
        format!(r#"{{"tier_key":"plus","is_trial":true,"trial_ends_at":"{future_trial}"}}"#);
    let mut sub_active = sub_with_payload(&payload_active);
    sub_active.expires_at = Some((chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339());

    assert!(sub_active.is_within_grace_period());
    assert_eq!(sub_active.effective_tier(), SubscriptionTier::Plus);
    assert_eq!(
        sub_active.lifecycle_state(),
        SubscriptionLifecycleState::Active
    );
    assert!(!sub_active.pos_read_only());
}
