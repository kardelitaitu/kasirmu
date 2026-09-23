use super::*;
use crate::migrations;
use crate::subscription::SubscriptionTier;

fn setup() -> (Store<'static>, String) {
    let conn = migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    let store = Store::new(conn);

    // ADR #56 §2.6 removed the seeded 'Default Store' row: a store with no
    // merchant should have no location, so the baseline no longer ships one
    // and the test creates what it needs. Inserting is also what
    // provision_device does, so the fixture matches production.
    conn.execute(
        "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
        rusqlite::params![
            "default",
            "Main Store",
            "123 Main St",
            "TAX-001",
            "USD",
            "America/New_York",
            "2026-06-30T12:00:00Z",
            "2026-06-30T12:00:00Z",
        ],
    )
    .unwrap();
    (store, "default".into())
}

#[test]
fn list_returns_seeded_primary() {
    let (store, _) = setup();
    let profiles = store.list_locations().unwrap();
    assert_eq!(profiles.len(), 1);
    assert!(profiles[0].is_primary);
}

#[test]
fn get_returns_seeded_primary() {
    let (store, id) = setup();
    let profile = store.get_location_profile(&id).unwrap().unwrap();
    assert_eq!(profile.name, "Main Store");
}

#[test]
fn get_returns_none_for_missing() {
    let (store, _) = setup();
    let profile = store.get_location_profile("nonexistent").unwrap();
    assert!(profile.is_none());
}

#[test]
fn get_primary_returns_seeded() {
    let (store, _) = setup();
    let profile = store.get_primary_location().unwrap().unwrap();
    assert_eq!(profile.id, "default");
    assert!(profile.is_primary);
}

#[test]
fn create_second_store() {
    let (store, _) = setup();
    let second = LocationProfile {
        id: uuid::Uuid::now_v7().to_string(),
        name: "Branch 2".into(),
        address: "456 Oak Ave".into(),
        tax_id: "TAX-002".into(),
        currency: "USD".into(),
        timezone: "America/Chicago".into(),
        is_primary: false,
        created_at: "2026-06-30T13:00:00Z".into(),
        updated_at: "2026-06-30T13:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();
    let profiles = store.list_locations().unwrap();
    assert_eq!(profiles.len(), 2);
}

#[test]
fn update_location_profile() {
    let (store, id) = setup();
    let updated = store
        .update_location_profile(&id, "Updated Store", "456 New St", "TAX-999", "USD", "UTC")
        .unwrap();
    assert_eq!(updated.name, "Updated Store");
    assert_eq!(updated.address, "456 New St");
}

#[test]
fn update_nonexistent_returns_not_found() {
    let (store, _) = setup();
    let err = store
        .update_location_profile("nonexistent", "X", "", "", "USD", "UTC")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn set_primary_location_promotes_and_demotes() {
    let (store, primary_id) = setup();
    let second = LocationProfile {
        id: uuid::Uuid::now_v7().to_string(),
        name: "Branch 2".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-06-30T13:00:00Z".into(),
        updated_at: "2026-06-30T13:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();

    // Promote branch 2 to primary.
    let promoted = store.set_primary_location(&second.id).unwrap();
    assert!(promoted.is_primary);

    // Original primary should now be non-primary.
    let original = store.get_location_profile(&primary_id).unwrap().unwrap();
    assert!(!original.is_primary);

    // Only one primary.
    let primaries: Vec<_> = store
        .list_locations()
        .unwrap()
        .into_iter()
        .filter(|p| p.is_primary)
        .collect();
    assert_eq!(primaries.len(), 1);
}

#[test]
fn set_primary_nonexistent_returns_not_found() {
    let (store, _) = setup();
    let err = store.set_primary_location("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn delete_second_store() {
    let (store, _) = setup();
    let second = LocationProfile {
        id: uuid::Uuid::now_v7().to_string(),
        name: "Branch 2".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-06-30T13:00:00Z".into(),
        updated_at: "2026-06-30T13:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();
    store.delete_location_profile(&second.id).unwrap();
    let profiles = store.list_locations().unwrap();
    assert_eq!(profiles.len(), 1);
}

#[test]
fn delete_primary_store_rejected() {
    let (store, id) = setup();
    let err = store.delete_location_profile(&id).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "id", .. }));
}

#[test]
fn delete_nonexistent_returns_not_found() {
    let (store, _) = setup();
    let err = store.delete_location_profile("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

/// ADR #6: Deleting a store that has workspace instances must be rejected
/// by the ON DELETE RESTRICT foreign key constraint.
#[test]
fn delete_store_with_workspace_instances_rejected() {
    let (store, _) = setup();
    let second = LocationProfile {
        id: "store-branch".into(),
        name: "Branch".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-06-30T13:00:00Z".into(),
        updated_at: "2026-06-30T13:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();

    // Create a workspace instance referencing this store.
    store.conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name) VALUES (?1, 'store-pos', ?2, 'Branch POS')",
        rusqlite::params!["wi-branch-pos", "store-branch"],
    ).unwrap();

    // Attempt to delete the store — must fail due to FK RESTRICT.
    let err = store.delete_location_profile("store-branch").unwrap_err();
    assert!(
        matches!(err, CoreError::Db(_)),
        "expected DB error from FK constraint, got: {err:?}"
    );

    // Clean up the workspace instance first, then deletion works.
    store
        .conn
        .execute(
            "DELETE FROM workspace_instances WHERE id = ?1",
            rusqlite::params!["wi-branch-pos"],
        )
        .unwrap();
    store.delete_location_profile("store-branch").unwrap();
}

/// ADR #6: user_location_access FK also enforces ON DELETE RESTRICT.
#[test]
fn delete_store_with_user_access_rejected() {
    let (store, _) = setup();
    let second = LocationProfile {
        id: "store-b2".into(),
        name: "Branch 2".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-06-30T14:00:00Z".into(),
        updated_at: "2026-06-30T14:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();

    // Seed a user and assign store access.
    store.conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-cashier', 'Cashier', '', '[]');
         INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('u-cashier', 'cash', 'hash', 'Cash', 'r-cashier');
         INSERT INTO user_location_access (user_id, location_id, access_level) VALUES ('u-cashier', 'store-b2', 'operator');"
    ).unwrap();

    // Attempt to delete the store — must fail due to FK RESTRICT.
    let err = store.delete_location_profile("store-b2").unwrap_err();
    assert!(
        matches!(err, CoreError::Db(_)),
        "expected DB error from FK constraint, got: {err:?}"
    );

    // Clean up the user access, then deletion works.
    store
        .conn
        .execute(
            "DELETE FROM user_location_access WHERE location_id = ?1",
            rusqlite::params!["store-b2"],
        )
        .unwrap();
    store.delete_location_profile("store-b2").unwrap();
}

// ── Additional coverage: field roundtrip, ordering, edge cases ──

/// Helper: create a non-primary location with full fields.
fn make_second(store: &Store<'_>, id: &str, name: &str) -> LocationProfile {
    let p = LocationProfile {
        id: id.into(),
        name: name.into(),
        address: "456 Oak Ave".into(),
        tax_id: "TAX-002".into(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        is_primary: false,
        created_at: "2026-07-01T10:00:00Z".into(),
        updated_at: "2026-07-01T10:00:00Z".into(),
    };
    store.create_location_profile(&p).unwrap();
    p
}

#[test]
fn update_all_fields_roundtrip() {
    // Verify every mutable field (name, address, tax_id, currency,
    // timezone) is persisted and returned. The existing test only
    // checks name + address.
    let (store, id) = setup();
    let updated = store
        .update_location_profile(
            &id,
            "New Name",
            "New Address",
            "TAX-NEW",
            "EUR",
            "Europe/Berlin",
        )
        .unwrap();
    assert_eq!(updated.name, "New Name");
    assert_eq!(updated.address, "New Address");
    assert_eq!(updated.tax_id, "TAX-NEW");
    assert_eq!(updated.currency, "EUR");
    assert_eq!(updated.timezone, "Europe/Berlin");
    assert_eq!(updated.id, id);
    assert!(updated.is_primary, "is_primary must not change on update");

    // Re-fetch to confirm persistence.
    let fetched = store.get_location_profile(&id).unwrap().unwrap();
    assert_eq!(fetched.name, "New Name");
    assert_eq!(fetched.tax_id, "TAX-NEW");
    assert_eq!(fetched.currency, "EUR");
    assert_eq!(fetched.timezone, "Europe/Berlin");
}

#[test]
fn list_orders_primary_first() {
    // list_locations orders by is_primary DESC, created_at ASC.
    // The primary must appear before any non-primary locations.
    let (store, _) = setup();
    make_second(&store, "branch-a", "Branch A");
    make_second(&store, "branch-b", "Branch B");

    let profiles = store.list_locations().unwrap();
    assert_eq!(profiles.len(), 3);
    assert!(
        profiles[0].is_primary,
        "primary location must be listed first"
    );
    assert!(
        !profiles[1].is_primary && !profiles[2].is_primary,
        "non-primary locations must follow"
    );
}

#[test]
fn create_store_with_is_primary_true_rejected_by_db() {
    // The locations table has a partial unique index on
    // is_primary=1 (migration 025). Creating a second store with
    // is_primary=true is rejected at the DB level, so the
    // single-primary invariant is enforced by the schema, not by
    // create_location_profile. This test documents that enforcement.
    let (store, _) = setup();
    let second = LocationProfile {
        id: "branch-p".into(),
        name: "Branch P".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: true, // would create a second primary
        created_at: "2026-07-01T10:00:00Z".into(),
        updated_at: "2026-07-01T10:00:00Z".into(),
    };
    let result = store.create_location_profile(&second);
    assert!(
        result.is_err(),
        "DB must reject a second primary location via the partial unique index"
    );
    assert!(matches!(result.unwrap_err(), CoreError::Db(_)));
}

#[test]
fn set_primary_on_already_primary_is_noop() {
    // set_primary_location on the location that's already primary should
    // succeed and leave the state unchanged (demote then re-promote).
    let (store, id) = setup();
    let result = store.set_primary_location(&id).unwrap();
    assert!(result.is_primary);
    // Still exactly one primary.
    let primaries: Vec<_> = store
        .list_locations()
        .unwrap()
        .into_iter()
        .filter(|p| p.is_primary)
        .collect();
    assert_eq!(primaries.len(), 1);
    assert_eq!(primaries[0].id, id);
}

#[test]
fn set_primary_rolls_back_on_nonexistent() {
    // set_primary_location demotes the current primary BEFORE
    // promoting the target. If the target doesn't exist, the
    // rollback (tx.rollback()) must restore the original primary.
    // This test verifies the transaction is rolled back correctly.
    let (store, original_id) = setup();
    let err = store.set_primary_location("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));

    // The original primary must STILL be primary — the demote was
    // rolled back.
    let original = store.get_location_profile(&original_id).unwrap().unwrap();
    assert!(
        original.is_primary,
        "original primary must be restored after rollback"
    );
    let primaries: Vec<_> = store
        .list_locations()
        .unwrap()
        .into_iter()
        .filter(|p| p.is_primary)
        .collect();
    assert_eq!(primaries.len(), 1, "exactly one primary after rollback");
}

#[test]
fn create_and_delete_cycle() {
    // Full lifecycle: create, verify, delete, verify gone.
    let (store, _) = setup();
    let p = make_second(&store, "temp-store", "Temp");
    assert_eq!(store.list_locations().unwrap().len(), 2);

    store.delete_location_profile(&p.id).unwrap();
    assert_eq!(store.list_locations().unwrap().len(), 1);
    assert!(store.get_location_profile(&p.id).unwrap().is_none());
}

#[test]
fn update_does_not_change_is_primary() {
    // Updating a non-primary location must not promote it.
    let (store, _) = setup();
    let p = make_second(&store, "branch-u", "Branch U");
    store
        .update_location_profile(&p.id, "Renamed", "", "", "USD", "UTC")
        .unwrap();
    let fetched = store.get_location_profile(&p.id).unwrap().unwrap();
    assert!(!fetched.is_primary, "update must not change is_primary");
}

#[test]
fn get_primary_returns_none_when_no_primary() {
    // Edge case: if no store is marked primary (corrupted state),
    // get_primary_location returns None rather than erroring.
    let (store, _) = setup();
    // Demote the only primary to simulate corruption.
    store
        .conn
        .execute("UPDATE locations SET is_primary = 0", [])
        .unwrap();
    let result = store.get_primary_location().unwrap();
    assert!(result.is_none(), "no primary must return None, not error");
}

#[test]
fn multiple_locations_distinct_currencies() {
    // Verify locations with different currencies coexist.
    let (store, _) = setup();
    let p1 = LocationProfile {
        id: "usd-store".into(),
        name: "USD Branch".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-07-02T00:00:00Z".into(),
        updated_at: "2026-07-02T00:00:00Z".into(),
    };
    store.create_location_profile(&p1).unwrap();

    let p2 = LocationProfile {
        id: "eur-store".into(),
        name: "EUR Branch".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "EUR".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-07-02T00:00:00Z".into(),
        updated_at: "2026-07-02T00:00:00Z".into(),
    };
    store.create_location_profile(&p2).unwrap();

    let profiles = store.list_locations().unwrap();
    let currencies: Vec<&str> = profiles.iter().map(|p| p.currency.as_str()).collect();
    assert!(currencies.contains(&"USD"));
    assert!(currencies.contains(&"EUR"));
}

// ── Store quota enforcement (C1.2, §9 pre-launch) ─────────

#[test]
fn count_locations_returns_seeded() {
    let (store, _) = setup();
    assert_eq!(store.count_locations().unwrap(), 1);
}

#[test]
fn enforce_location_quota_allows_within_limit() {
    let (store, _) = setup();
    // Free allows 1 store; we have 1 seeded → adding another must
    // NOT be blocked here (the quota check counts BEFORE the new
    // insert, so current=1, limit=1 → current >= limit → blocked).
    // But Plus also allows 1, Pro allows 2, Premium allows 10.
    assert!(store.enforce_location_quota(&SubscriptionTier::Pro).is_ok());
    assert!(
        store
            .enforce_location_quota(&SubscriptionTier::Premium)
            .is_ok()
    );
    assert!(
        store
            .enforce_location_quota(&SubscriptionTier::Enterprise)
            .is_ok()
    );
}

#[test]
fn create_location_profile_tx_veto_closes_limit_race() {
    // W4-S4: the gate arms the tier; the create consumes it inside its own
    // transaction, so the second create at the cap is refused IN-TX and the
    // over-cap row never commits.
    fn profile(id: &str, name: &str) -> LocationProfile {
        LocationProfile {
            id: id.into(),
            name: name.into(),
            address: "456 Oak Ave".into(),
            tax_id: "TAX-002".into(),
            currency: "IDR".into(),
            timezone: "Asia/Jakarta".into(),
            is_primary: false,
            created_at: "2026-07-01T10:00:00Z".into(),
            updated_at: "2026-07-01T10:00:00Z".into(),
        }
    }
    let (store, _) = setup();
    let tier = SubscriptionTier::Pro; // limit 2; the seed is location #1.
    store.arm_creation_quota(QuotaDimension::Locations, tier.clone());
    store
        .create_location_profile(&profile("store-2", "Branch 2"))
        .unwrap();
    assert_eq!(store.count_locations().unwrap(), 2);
    // Re-arm (one-shot by design) — now at the cap, the next create vetoes.
    store.arm_creation_quota(QuotaDimension::Locations, tier.clone());
    let err = store
        .create_location_profile(&profile("store-3", "Branch 3"))
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Pro at 2/2 must be refused in-tx: {err:?}"
    );
    assert_eq!(
        store.count_locations().unwrap(),
        2,
        "the over-cap row must not persist"
    );
}

#[test]
fn create_location_profile_unarmed_is_ungated() {
    // The race closure arms only through the central gate; direct
    // programmatic creates keep the exact legacy un-gated behavior (quota
    // policy stays at the gate layer).
    fn profile(id: &str, name: &str) -> LocationProfile {
        LocationProfile {
            id: id.into(),
            name: name.into(),
            address: "456 Oak Ave".into(),
            tax_id: "TAX-002".into(),
            currency: "IDR".into(),
            timezone: "Asia/Jakarta".into(),
            is_primary: false,
            created_at: "2026-07-01T10:00:00Z".into(),
            updated_at: "2026-07-01T10:00:00Z".into(),
        }
    }
    let (store, _) = setup();
    store
        .create_location_profile(&profile("store-2", "Branch 2"))
        .unwrap();
    assert_eq!(store.count_locations().unwrap(), 2);
}

#[test]
fn enforce_location_quota_blocks_at_limit() {
    let (store, _) = setup();
    // Free allows 1 store; we already have 1 → must be blocked.
    let err = store
        .enforce_location_quota(&SubscriptionTier::Free)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Free with 1 store must be blocked: {err:?}"
    );
}

#[test]
fn enforce_location_quota_blocks_plus_at_limit() {
    let (store, _) = setup();
    // Plus allows 1 store; we already have 1 → must be blocked.
    let err = store
        .enforce_location_quota(&SubscriptionTier::Plus)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Plus with 1 store must be blocked: {err:?}"
    );
}

#[test]
fn enforce_location_quota_pro_allows_two_locations() {
    let (store, _) = setup();
    // Pro allows 2 locations; we have 1 → adding a second is OK.
    let second = LocationProfile {
        id: "store-2".into(),
        name: "Branch 2".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-07-02T00:00:00Z".into(),
        updated_at: "2026-07-02T00:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();
    assert_eq!(store.count_locations().unwrap(), 2);
    // Now at 2 locations → Pro must be blocked.
    let err = store
        .enforce_location_quota(&SubscriptionTier::Pro)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Pro with 2 locations must be blocked: {err:?}"
    );
    // Premium (10) still allows it.
    assert!(
        store
            .enforce_location_quota(&SubscriptionTier::Premium)
            .is_ok()
    );
}

#[test]
fn enforce_location_quota_error_message_includes_tier_and_count() {
    let (store, _) = setup();
    let err = store
        .enforce_location_quota(&SubscriptionTier::Free)
        .unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("Free"), "message should name the tier: {msg}");
    assert!(msg.contains("1"), "message should show the limit: {msg}");
}

#[test]
fn enforce_location_quota_premium_allows_four() {
    let (store, _) = setup();
    // Premium allows up to 5 locations (limit is exclusive: >= blocks).
    // We have 1 seeded; add 3 more = 4 total → OK.
    for i in 0..3 {
        let p = LocationProfile {
            id: format!("store-{i}"),
            name: format!("Branch {i}"),
            address: "".into(),
            tax_id: "".into(),
            currency: "USD".into(),
            timezone: "UTC".into(),
            is_primary: false,
            created_at: "2026-07-02T00:00:00Z".into(),
            updated_at: "2026-07-02T00:00:00Z".into(),
        };
        store.create_location_profile(&p).unwrap();
    }
    assert_eq!(store.count_locations().unwrap(), 4);
    assert!(
        store
            .enforce_location_quota(&SubscriptionTier::Premium)
            .is_ok()
    );
    // Add 1 more = 5 total → must be blocked.
    let p = LocationProfile {
        id: "store-3".into(),
        name: "Branch 3".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-07-02T00:00:00Z".into(),
        updated_at: "2026-07-02T00:00:00Z".into(),
    };
    store.create_location_profile(&p).unwrap();
    assert_eq!(store.count_locations().unwrap(), 5);
    let err = store
        .enforce_location_quota(&SubscriptionTier::Premium)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Premium with 5 locations must be blocked: {err:?}"
    );
}

#[test]
fn enforce_location_quota_enterprise_unlimited() {
    let (store, _) = setup();
    // Enterprise has no location limit (None) — always passes.
    for i in 0..15 {
        let p = LocationProfile {
            id: format!("store-{i}"),
            name: format!("Branch {i}"),
            address: "".into(),
            tax_id: "".into(),
            currency: "USD".into(),
            timezone: "UTC".into(),
            is_primary: false,
            created_at: "2026-07-02T00:00:00Z".into(),
            updated_at: "2026-07-02T00:00:00Z".into(),
        };
        store.create_location_profile(&p).unwrap();
    }
    assert!(
        store
            .enforce_location_quota(&SubscriptionTier::Enterprise)
            .is_ok()
    );
}

// -- ticket prefix (W2-A, D16) ----------------------------------------

#[test]
fn ticket_prefix_empty_resolves_to_none() {
    let (store, id) = setup();
    // '' is the no-prefix sentinel: no inheritance from the entity's
    // statutory fiscal prefix, and no default spelling either.
    assert_eq!(store.location_ticket_prefix(&id).unwrap(), None);
    assert_eq!(
        store.location_ticket_prefix("no-such-location").unwrap(),
        None,
        "a missing location is a read miss, not an error"
    );
}

#[test]
fn ticket_prefix_normalizes_trim_and_case_at_the_boundary() {
    let (store, id) = setup();
    store.set_location_ticket_prefix(&id, "  kds-a  ").unwrap();
    assert_eq!(
        store.location_ticket_prefix(&id).unwrap(),
        Some("KDS-A".to_string()),
        "trim + ASCII-uppercase normalization at the core boundary"
    );
    // Clearing through whitespace-only resolves back to no prefix.
    store.set_location_ticket_prefix(&id, "   ").unwrap();
    assert_eq!(store.location_ticket_prefix(&id).unwrap(), None);
    assert!(
        store
            .set_location_ticket_prefix("no-such-location", "A")
            .is_err(),
        "setting on a missing location must be NotFound, not a silent no-op"
    );
}

#[test]
fn ticket_prefix_duplicate_within_tenant_refused_by_index() {
    let (store, _) = setup();
    store
        .set_location_ticket_prefix("default", "KDS-A")
        .unwrap();
    let second = LocationProfile {
        id: "loc-2".into(),
        name: "Second".into(),
        address: "".into(),
        tax_id: "".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: "2026-09-26T00:00:00Z".into(),
        updated_at: "2026-09-26T00:00:00Z".into(),
    };
    store.create_location_profile(&second).unwrap();
    // The partial unique index (tenant_id, ticket_prefix) refuses the
    // second "KDS-A" in the SAME tenant -- even across a case/trim
    // variant, because the writer normalizes before the write.
    assert!(
        store.set_location_ticket_prefix("loc-2", "kds-a").is_err(),
        "duplicate normalized prefix within one tenant must be refused"
    );
}

#[test]
fn ticket_prefix_same_prefix_allowed_across_tenants() {
    // The f4a763aca lesson applied at design time: tenant-keying the
    // partial unique index means tenant B's "A" never refuses tenant
    // A's "A" (a plain UNIQUE (ticket_prefix) would couple them in the
    // shared cloud database).
    let conn = migrations::fresh_db();
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('t1-loc', 'T1', 'tenant-1')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('t2-loc', 'T2', 'tenant-2')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);
    store.set_location_ticket_prefix("t1-loc", "A").unwrap();
    store
        .set_location_ticket_prefix("t2-loc", "A")
        .expect("the SAME prefix on two tenants must be allowed");
    assert_eq!(
        store.location_ticket_prefix("t1-loc").unwrap(),
        Some("A".to_string())
    );
    assert_eq!(
        store.location_ticket_prefix("t2-loc").unwrap(),
        Some("A".to_string())
    );
}
