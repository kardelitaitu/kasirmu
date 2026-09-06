use super::*;
use crate::migrations;

fn fresh() -> (Store<'static>, String) {
    let conn = migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    let store = Store::new(conn);

    // Seed a role and user for FK compliance.
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-test', 'Test', 'Test', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at)
         VALUES ('user-1', 'alice', 'hash', 'Alice', 'role-test', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();

    (store, "user-1".into())
}

/// A subscription with the EMPTY quota block — workspace-type
/// entitlement falls back to the tier's static defaults, which is what
/// the pre-bundle entitlement tests exercised via a bare `SubscriptionTier`.
fn sub_for_tier(tier: SubscriptionTier) -> TenantSubscription {
    TenantSubscription {
        tenant_id: "default".into(),
        tier,
        status: "active".into(),
        expires_at: None,
        max_stores: 1,
        max_pos_instances: 1,
        allowed_types_json: "[]".into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    }
}

/// A Plus + restaurant_starter bundle subscription — the signed payload's
/// `allowed_types` lists `kds` even though the Plus TIER statically
/// excludes it (C3.2).
fn plus_bundle_sub() -> TenantSubscription {
    TenantSubscription {
        tenant_id: "default".into(),
        tier: SubscriptionTier::Plus,
        status: "active".into(),
        expires_at: None,
        max_stores: 1,
        max_pos_instances: 2,
        allowed_types_json:
            r#"["store-pos","restaurant-pos","admin","warehouse","inventory","kds"]"#.into(),
        signature: "BOOTSTRAP_FREE".into(),
        signed_payload: String::new(),
        api_key: String::new(),
        updated_at: String::new(),
    }
}

// ── Legacy tests (backward compatible) ────────────────────────────

#[test]
fn list_all_workspace_types_returns_seeded() {
    let (store, _) = fresh();
    let ws = store.list_all_workspace_types().unwrap();
    assert_eq!(ws.len(), 6);
    assert!(ws.iter().any(|w| w.key == "restaurant-pos"));
    assert!(ws.iter().any(|w| w.key == "kds"));
    assert!(ws.iter().any(|w| w.key == "store-pos"));
    // ADR-18 §3 + §13 finding 37 (migration 091): workspace_types.key
    // rename cascade renames 'inventory' -> 'warehouse' across all FK
    // references including the legacy `workspaces` table. This fixture
    // asserts the post-rename state — the user-facing workspace type
    // for stock-keeping is 'warehouse', not 'inventory'.
    assert!(ws.iter().any(|w| w.key == "warehouse"));
    assert!(ws.iter().any(|w| w.key == "admin"));
    // ADR #35 D5 (migration 128): 'retail-pos' is the legacy cashier
    // workspace that role-cashier users fold into as Staff assignments.
    assert!(ws.iter().any(|w| w.key == "retail-pos"));
    let kds = ws.iter().find(|w| w.key == "kds").unwrap();
    assert_eq!(kds.name, "Kitchen Display");
    assert_eq!(kds.icon, "kds");
}

#[test]
fn list_workspaces_legacy_owner_returns_all() {
    let (store, _) = fresh();
    let ws = store.list_workspaces_legacy("role-owner", None).unwrap();
    assert_eq!(ws.len(), 6);
}

#[test]
fn list_workspaces_legacy_with_user_override() {
    let (store, user_id) = fresh();
    let before = store
        .list_workspaces_legacy("role-test", Some(&user_id))
        .unwrap();
    assert!(before.is_empty(), "role-test has no role_workspaces");

    // The user_workspaces write path is retired (assignment model
    // supersedes it); seed the legacy row directly to keep pinning the
    // legacy listing's replace-mode read.
    store
        .conn
        .execute(
            "INSERT INTO user_workspaces (user_id, ws_key) VALUES (?1, ?2)",
            params![user_id, "admin"],
        )
        .unwrap();
    let after = store
        .list_workspaces_legacy("role-test", Some(&user_id))
        .unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].key, "admin");
}

// ── New tests (ADR #4 Phase 1) ────────────────────────────────────

#[test]
fn list_workspace_types_returns_all() {
    let (store, _) = fresh();
    let types = store.list_workspace_types().unwrap();
    assert_eq!(types.len(), 6);
    assert!(types.iter().any(|t| t.layout_mode == "fullscreen"));
    assert!(types.iter().any(|t| t.layout_mode == "sidebar"));
}

#[test]
fn list_workspaces_owner_returns_instances_in_store() {
    let (store, _) = fresh();
    // Primary store has default instances seeded by migration.
    let dto = store
        .list_workspaces("role-owner", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 5);
    assert!(dto.iter().any(|w| w.type_key == "kds"));
    assert!(dto.iter().any(|w| w.type_key == "restaurant-pos"));
    // All should have instance_id, store_id, etc.
    for w in &dto {
        assert!(!w.instance_id.is_empty());
        assert!(!w.store_id.is_empty());
        assert!(!w.name.is_empty());
        assert!(!w.layout_mode.is_empty());
    }
}

#[test]
fn list_workspaces_auditor_returns_instances_in_store() {
    // Auditor is a global read-only role per the five-role taxonomy — it
    // must resolve the same workspace instances as the management roles
    // so it can reach its read-only screens (audit log, reports,
    // inventory) through the workspace picker.
    let (store, _) = fresh();
    let dto = store
        .list_workspaces("role-auditor", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 5);
    assert!(dto.iter().any(|w| w.type_key == "kds"));
    assert!(dto.iter().any(|w| w.type_key == "restaurant-pos"));
    assert!(dto.iter().any(|w| w.type_key == "admin"));
}

#[test]
fn get_workspace_instance_returns_correct_dto() {
    let (store, user_id) = fresh();
    let dto = store
        .get_workspace_instance("default-restaurant-pos", Some(&user_id))
        .unwrap();
    assert_eq!(dto.instance_id, "default-restaurant-pos");
    assert_eq!(dto.type_key, "restaurant-pos");
    assert_eq!(dto.store_id, "default");
    assert_eq!(dto.layout_mode, "fullscreen");
}

#[test]
fn create_workspace_instance_basic() {
    let (store, _) = fresh();
    let row = store
        .create_workspace_instance(
            "test-cashier-1",
            "restaurant-pos",
            "default",
            "Test Cashier 1",
            "A test instance",
            Some("#FF0000"),
        )
        .unwrap();
    assert_eq!(row.id, "test-cashier-1");
    assert_eq!(row.type_key, "restaurant-pos");
    assert_eq!(row.colour, Some("#FF0000".into()));
    assert_eq!(row.status, "active");

    // Verify it appears in owner's list.
    let dto = store
        .list_workspaces("role-owner", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 6);
    assert!(dto.iter().any(|w| w.instance_id == "test-cashier-1"));
}

#[test]
fn purpose_key_is_independent_from_type_and_name() {
    let (store, _) = fresh();
    store
        .create_workspace_instance_with_purpose(CreateWorkspaceInstanceArgs {
            id: "ws-checkout".into(),
            type_key: "store-pos".into(),
            store_id: "default".into(),
            name: "Front Counter".into(),
            description: String::new(),
            colour: None,
            purpose_key: "checkout".into(),
        })
        .unwrap();
    store
        .create_workspace_instance_with_purpose(CreateWorkspaceInstanceArgs {
            id: "ws-returns".into(),
            type_key: "store-pos".into(),
            store_id: "default".into(),
            name: "Returns Counter".into(),
            description: String::new(),
            colour: None,
            purpose_key: "returns".into(),
        })
        .unwrap();

    let rows = store.list_all_instances("default").unwrap();
    let checkout = rows.iter().find(|row| row.id == "ws-checkout").unwrap();
    let returns = rows.iter().find(|row| row.id == "ws-returns").unwrap();
    assert_eq!(checkout.type_key, returns.type_key);
    assert_eq!(checkout.purpose_key, "checkout");
    assert_eq!(returns.purpose_key, "returns");
    assert_ne!(checkout.name, returns.name);
}

#[test]
fn create_workspace_instance_duplicate_fails() {
    let (store, _) = fresh();
    let result = store.create_workspace_instance(
        "default-restaurant-pos",
        "restaurant-pos",
        "default",
        "Dup",
        "",
        None,
    );
    assert!(result.is_err());
}

#[test]
fn list_workspaces_with_user_override_instances() {
    let (store, user_id) = fresh();

    // No user override → falls back to role_workspace_types.
    let before = store
        .list_workspaces("role-test", Some(&user_id), "default")
        .unwrap();
    assert!(before.is_empty(), "role-test has no role_workspace_types");

    // Set explicit instances for user.
    store
        .set_user_workspace_instances(&user_id, ["default-admin"], Some("default-admin"))
        .unwrap();

    let after = store
        .list_workspaces("role-test", Some(&user_id), "default")
        .unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].type_key, "admin");
    assert!(after[0].is_default);
}

#[test]
fn set_user_workspace_instances_empty_clears() {
    let (store, user_id) = fresh();
    store
        .set_user_workspace_instances(&user_id, ["default-admin"], None)
        .unwrap();
    let ids = store.get_user_workspace_instance_ids(&user_id).unwrap();
    assert_eq!(ids.len(), 1);

    store
        .set_user_workspace_instances(&user_id, [], None)
        .unwrap();
    let ids = store.get_user_workspace_instance_ids(&user_id).unwrap();
    assert!(ids.is_empty());
}

#[test]
fn list_workspaces_owner_without_store_access_sees_all() {
    let (store, _) = fresh();
    // role-owner with no user_location_access (Phase 1 single-store mode)
    let dto = store
        .list_workspaces("role-owner", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 5);
}

#[test]
fn list_all_instances_returns_all_in_store() {
    let (store, _) = fresh();
    let instances = store.list_all_instances("default").unwrap();
    assert_eq!(instances.len(), 5);
    assert!(instances.iter().any(|i| i.id == "default-kds"));
}

// ── Entitlement tests (ADR #5) ───────────────────────────────

#[test]
fn list_workspaces_with_entitlement_filters_by_tier() {
    let (store, _) = fresh();
    // Free tier only allows restaurant-pos, store-pos, admin
    let free = sub_for_tier(SubscriptionTier::Free);
    let dto = store
        .list_workspaces_with_entitlement("role-owner", None, "default", &free)
        .unwrap();
    // KDS and inventory should be filtered out
    assert!(
        dto.iter()
            .all(|w| SubscriptionTier::Free.allows_workspace_type(&w.type_key))
    );
    assert!(!dto.iter().any(|w| w.type_key == "kds"));
    assert!(!dto.iter().any(|w| w.type_key == "inventory"));
    // restaurant-pos, store-pos, admin should remain
    assert!(dto.iter().any(|w| w.type_key == "restaurant-pos"));
    assert!(dto.iter().any(|w| w.type_key == "store-pos"));
    assert!(dto.iter().any(|w| w.type_key == "admin"));
}

#[test]
fn list_workspaces_with_entitlement_premium_sees_kds() {
    let (store, _) = fresh();
    // Premium tier includes KDS. Post ADR-18 §13-37 migration 091
    // renamed `workspace_types.key = 'inventory'` -> `'warehouse'`,
    // so the entitlement query checks 'warehouse' as the user-facing
    // stock-keeping workspace type (internal crate is still
    // `modules/inventory/` per §3 multi-crate carve-out rationale).
    let premium = sub_for_tier(SubscriptionTier::Premium);
    let dto = store
        .list_workspaces_with_entitlement("role-owner", None, "default", &premium)
        .unwrap();
    assert!(dto.iter().any(|w| w.type_key == "kds"));
    assert!(dto.iter().any(|w| w.type_key == "warehouse"));
    // All 5 types should be present
    assert_eq!(dto.len(), 5);
}

#[test]
fn list_workspaces_with_entitlement_enterprise_sees_all() {
    let (store, _) = fresh();
    let enterprise = sub_for_tier(SubscriptionTier::Enterprise);
    let dto = store
        .list_workspaces_with_entitlement("role-owner", None, "default", &enterprise)
        .unwrap();
    assert_eq!(dto.len(), 5);
}

#[test]
fn list_workspaces_with_entitlement_bundle_plus_sees_kds() {
    let (store, _) = fresh();
    // A Plus + restaurant_starter bundle subscriber's signed payload
    // lists kds — the listing must show the KDS workspace even though
    // the Plus TIER statically excludes it (C3.2).
    let sub = plus_bundle_sub();
    let dto = store
        .list_workspaces_with_entitlement("role-owner", None, "default", &sub)
        .unwrap();
    assert!(
        dto.iter().any(|w| w.type_key == "kds"),
        "bundle subscriber must see the KDS workspace, got {dto:?}"
    );
    assert_eq!(dto.len(), 5);
}

#[test]
fn list_workspaces_without_entitlement_sees_all() {
    let (store, _) = fresh();
    // Original list_workspaces without tier filtering should return all 5
    let dto = store
        .list_workspaces("role-owner", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 5);
    assert!(dto.iter().any(|w| w.type_key == "kds"));
}
#[test]
fn count_active_instances_excludes_suspended() {
    let (store, _) = fresh();
    let initial = store.count_active_instances("default").unwrap();
    assert_eq!(initial, 5);
    // Archive one instance using the public wrapper.
    store.archive_instance("default-kds").unwrap();
    let after = store.count_active_instances("default").unwrap();
    assert_eq!(after, 4);
}

#[test]
fn update_workspace_instance_changes_editable_fields() {
    let (store, _) = fresh();
    // Seed a fresh instance to mutate.
    store
        .create_workspace_instance(
            "ws-edit",
            "store-pos",
            "default",
            "Old Name",
            "Old desc",
            Some("#111111"),
        )
        .unwrap();

    store
        .update_workspace_instance("ws-edit", "New Name", Some("New desc"), Some("#222222"))
        .unwrap();

    let row = store
        .list_all_instances("default")
        .unwrap()
        .into_iter()
        .find(|r| r.id == "ws-edit")
        .unwrap();
    assert_eq!(row.name, "New Name");
    assert_eq!(row.description, "New desc");
    assert_eq!(row.colour.as_deref(), Some("#222222"));
}

#[test]
fn update_workspace_instance_none_preserves_existing_fields() {
    let (store, _) = fresh();
    store
        .create_workspace_instance(
            "ws-preserve",
            "store-pos",
            "default",
            "Name",
            "keep me",
            Some("#abcdef"),
        )
        .unwrap();

    // Rename only — description and colour must be preserved (COALESCE).
    store
        .update_workspace_instance("ws-preserve", "Renamed", None, None)
        .unwrap();

    let row = store
        .list_all_instances("default")
        .unwrap()
        .into_iter()
        .find(|r| r.id == "ws-preserve")
        .unwrap();
    assert_eq!(row.name, "Renamed");
    assert_eq!(row.description, "keep me");
    assert_eq!(row.colour.as_deref(), Some("#abcdef"));
}

#[test]
fn update_workspace_instance_missing_returns_not_found() {
    let (store, _) = fresh();
    let err = store
        .update_workspace_instance("does-not-exist", "X", Some("Y"), None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn owner_with_user_store_access_filtered_by_assigned_stores() {
    let (store, user_id) = fresh();
    // Create a second store profile so we have multiple stores.
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, currency, timezone)
             VALUES ('store-b', 'Store B', '456 Elm', 'IDR', 'Asia/Jakarta')",
            [],
        )
        .unwrap();
    // Seed a workspace instance in store-b so we can detect cross-store leakage.
    store
        .create_workspace_instance(
            "store-b-restaurant-pos",
            "restaurant-pos",
            "store-b",
            "Store B POS",
            "",
            None,
        )
        .unwrap();

    // Seed user_location_access — user-1 only has access to "default", not "store-b".
    store
        .conn
        .execute(
            "INSERT INTO user_location_access (user_id, location_id, access_level)
             VALUES (?1, 'default', 'manager')",
            params![user_id],
        )
        .unwrap();

    // User can see instances in "default" store.
    let dto_default = store
        .list_workspaces("role-owner", Some(&user_id), "default")
        .unwrap();
    assert!(
        !dto_default.is_empty(),
        "should see default store instances"
    );

    // User CANNOT see instances in "store-b" — empty result.
    let dto_store_b = store
        .list_workspaces("role-owner", Some(&user_id), "store-b")
        .unwrap();
    assert!(
        dto_store_b.is_empty(),
        "owner with user_location_access should not see unassigned store"
    );
}

#[test]
fn enforce_instance_quota_rejects_disallowed_type() {
    let (store, _) = fresh();
    let free = sub_for_tier(SubscriptionTier::Free);
    let result = store.enforce_instance_quota(&free, "kds", "default");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("kds"));
    assert!(err.contains("Free"));
}

#[test]
fn enforce_instance_quota_allows_type_but_fails_on_count() {
    let (store, _) = fresh();
    let free = sub_for_tier(SubscriptionTier::Free);
    // Free tier allows restaurant-pos but we have 5 active instances.
    // Free tier allows 1 max, so this should fail on count, not type.
    let result = store.enforce_instance_quota(&free, "restaurant-pos", "default");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("1 registers"));
}

#[test]
fn enforce_instance_quota_non_pos_types_do_not_inflate_pos_count() {
    // A store with 0 POS instances (store-pos/restaurant-pos) but 1 non-POS
    // instance (kds) should still allow creating 1 POS instance on Free tier
    // (max_pos_instances = 1). The quota must count only POS-class types,
    // not every workspace type — otherwise a legacy kds/warehouse inflates
    // the register count and blocks legitimate POS creation.
    let (store, _) = fresh();
    let free = sub_for_tier(SubscriptionTier::Free);
    // Use a fresh store with only a kds instance (no POS instances).
    let store_id = "quota-test";
    store
        .conn
        .execute(
            "INSERT OR IGNORE INTO locations (id, name) VALUES ('quota-test', 'Quota Test')",
            [],
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name, status, created_at, updated_at)
             VALUES ('quota-kds', 'kds', 'quota-test', 'KDS', 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    // count_active_instances returns 1 (the kds instance).
    assert_eq!(store.count_active_instances(store_id).unwrap(), 1);
    // Creating a store-pos should succeed: no POS instances exist yet,
    // and the Free tier allows 1. But count_active_instances counts all
    // types, so current=1 >= limit=1 → currently fails.
    let result = store.enforce_instance_quota(&free, "store-pos", store_id);
    assert!(
        result.is_ok(),
        "non-POS instances must not count toward the POS-instance limit, got {result:?}"
    );
}

#[test]
fn enforce_instance_quota_enforces_warehouse_limit() {
    let (store, _) = fresh();
    let free = sub_for_tier(SubscriptionTier::Free);
    let plus = sub_for_tier(SubscriptionTier::Plus);
    let store_id = "wh-quota-test";
    store
        .conn
        .execute(
            "INSERT OR IGNORE INTO locations (id, name) VALUES ('wh-quota-test', 'WH Test')",
            [],
        )
        .unwrap();

    // Free tier rejects warehouse type entirely
    assert!(
        store
            .enforce_instance_quota(&free, "warehouse", store_id)
            .is_err()
    );

    // Plus allows 2 warehouses: 0 existing allows creation
    assert!(
        store
            .enforce_instance_quota(&plus, "warehouse", store_id)
            .is_ok()
    );

    // Add 1st warehouse instance
    store
        .conn
        .execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name, status, created_at, updated_at)
             VALUES ('wh-1', 'warehouse', 'wh-quota-test', 'WH 1', 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();

    // 1 warehouse exists; Plus (limit 2) still allows creation
    assert!(
        store
            .enforce_instance_quota(&plus, "warehouse", store_id)
            .is_ok()
    );

    // Add 2nd warehouse instance
    store
        .conn
        .execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name, status, created_at, updated_at)
             VALUES ('wh-2', 'warehouse', 'wh-quota-test', 'WH 2', 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();

    // Now 2 warehouses exist; Plus (limit 2) should be blocked on count
    let err = store
        .enforce_instance_quota(&plus, "warehouse", store_id)
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::SubscriptionLimitExceeded(msg) if msg.contains("warehouse")
    ));

    // Pro tier allows 3 warehouses (2 exist currently)
    let pro = sub_for_tier(SubscriptionTier::Pro);
    assert!(
        store
            .enforce_instance_quota(&pro, "warehouse", store_id)
            .is_ok()
    );
}

#[test]
fn enforce_instance_quota_bundle_plus_allows_kds() {
    let (store, _) = fresh();
    // A fresh store id has zero active instances, so the type check is
    // the only gate — kds must pass for the bundle even at Plus tier.
    let sub = plus_bundle_sub();
    assert!(
        store
            .enforce_instance_quota(&sub, "kds", "fresh-store")
            .is_ok(),
        "Plus + restaurant_starter must be able to create a kds workspace"
    );
    // The same type stays rejected for plain Plus (empty block → tier
    // defaults), proving the payload is what widened the entitlement.
    let plain = sub_for_tier(SubscriptionTier::Plus);
    let result = store.enforce_instance_quota(&plain, "kds", "fresh-store");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("kds"));
    assert!(err.contains("Plus"));
}

// ── Auto-Recovery & Suspension tests (ADR #5 Phase 3b/3c) ───────

#[test]
fn auto_recover_restores_suspended_to_limit() {
    let (store, _) = fresh();
    // Suspend two instances manually. Post ADR-18 §13-37 migration 091
    // renamed workspace_instances.id 'default-inventory' -> 'default-warehouse'
    // (the matched-pair workaround for the workspace_types.key -> id rename
    // cascade — see the migration_060 seed-row derivation cited inline in
    // migration 091).
    store.conn.execute(
        "UPDATE workspace_instances SET status = 'quota_suspended' WHERE id IN ('default-kds', 'default-warehouse')",
        [],
    ).unwrap();
    // Now: 3 active, 2 suspended.
    assert_eq!(store.count_active_instances("default").unwrap(), 3);

    // Premium tier allows 10 per store — recover should restore both.
    let premium = SubscriptionTier::Premium;
    let restored = store.auto_recover_instances("default", &premium).unwrap();
    assert_eq!(restored, 2);
    assert_eq!(store.count_active_instances("default").unwrap(), 5);
}

#[test]
fn auto_recover_respects_tier_limit() {
    let (store, _) = fresh();
    // Suspend one instance.
    store
        .conn
        .execute(
            "UPDATE workspace_instances SET status = 'quota_suspended' WHERE id = 'default-kds'",
            [],
        )
        .unwrap();
    // Now: 4 active, 1 suspended.

    // Free tier allows 1 per store — no slots, nothing to recover.
    let free = SubscriptionTier::Free;
    let restored = store.auto_recover_instances("default", &free).unwrap();
    assert_eq!(restored, 0);
    assert_eq!(store.count_active_instances("default").unwrap(), 4);
}

#[test]
fn auto_recover_unlimited_restores_all() {
    let (store, _) = fresh();
    store
        .conn
        .execute(
            "UPDATE workspace_instances SET status = 'quota_suspended'",
            [],
        )
        .unwrap();
    assert_eq!(store.count_active_instances("default").unwrap(), 0);

    let enterprise = SubscriptionTier::Enterprise;
    let restored = store
        .auto_recover_instances("default", &enterprise)
        .unwrap();
    assert_eq!(restored, 5);
    assert_eq!(store.count_active_instances("default").unwrap(), 5);
}

#[test]
fn suspend_surplus_transitions_excess_to_suspended() {
    let (store, _) = fresh();
    // 5 active instances. Free tier allows 1. Surplus = 4.
    let free = SubscriptionTier::Free;
    let suspended = store.suspend_surplus_instances("default", &free).unwrap();
    assert_eq!(suspended, 4);
    assert_eq!(store.count_active_instances("default").unwrap(), 1);
}

#[test]
fn suspend_surplus_no_op_when_under_limit() {
    let (store, _) = fresh();
    // Premium allows 10, we only have 5 — nothing to suspend.
    let premium = SubscriptionTier::Premium;
    let suspended = store
        .suspend_surplus_instances("default", &premium)
        .unwrap();
    assert_eq!(suspended, 0);
    assert_eq!(store.count_active_instances("default").unwrap(), 5);
}

#[test]
fn suspend_surplus_unlimited_tier_no_op() {
    let (store, _) = fresh();
    let enterprise = SubscriptionTier::Enterprise;
    let suspended = store
        .suspend_surplus_instances("default", &enterprise)
        .unwrap();
    assert_eq!(suspended, 0);
}

#[test]
fn auto_recover_then_suspend_roundtrip() {
    let (store, _) = fresh();
    // Suspend all
    store
        .conn
        .execute(
            "UPDATE workspace_instances SET status = 'quota_suspended'",
            [],
        )
        .unwrap();

    // Recover with Plus (2 limit)
    let plus = SubscriptionTier::Plus;
    let restored = store.auto_recover_instances("default", &plus).unwrap();
    assert_eq!(restored, 2);
    assert_eq!(store.count_active_instances("default").unwrap(), 2);

    // Downgrade to Free (1 limit) — should suspend 1
    let free = SubscriptionTier::Free;
    let suspended = store.suspend_surplus_instances("default", &free).unwrap();
    assert_eq!(suspended, 1);
    assert_eq!(store.count_active_instances("default").unwrap(), 1);
}

// ── TOPOLOGY_AUDIT follow-up tests ───────────────────────────────
//
// Cover audit #1 (type_key / store_id immutability) and audit #4
// (atomicity of the create + update + archive diff that
// `apply_topology_diff` runs in one SQLite transaction).

/// Helper: fetch a single instance row by id, panicking if absent.
fn fetch_instance(store: &Store<'_>, id: &str) -> WorkspaceInstanceRow {
    store
        .list_all_instances("default")
        .unwrap()
        .into_iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| panic!("instance {id} not found"))
}

// ── #4 regression: create_workspace_instance CANNOT be called from
//    inside an open transaction (it uses unchecked_transaction, which
//    issues a raw BEGIN that SQLite rejects when a tx is active).
//
// `apply_topology_diff` opens an outer transaction and then runs the
// create INSERT SQL directly on it (NOT via this method) for exactly
// this reason. This test documents the constraint so it is not
// accidentally regressed.

#[test]
fn create_workspace_instance_cannot_nest_in_open_transaction() {
    let (store, _) = fresh();
    let conn = store.conn;
    let outer = conn.unchecked_transaction().unwrap();
    let tx_store = Store::new(&outer);

    let result = tx_store.create_workspace_instance(
        "nested-should-fail",
        "restaurant-pos",
        "default",
        "Nested",
        "",
        None,
    );
    assert!(
        result.is_err(),
        "create_workspace_instance must not nest inside an open transaction; \
         apply_topology_diff must run the SQL directly on its own tx instead"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("cannot start a transaction within a transaction"),
        "expected the SQLite nesting error, got: {err}"
    );
    drop(outer);
    // Nothing was created.
    assert!(
        store
            .list_all_instances("default")
            .unwrap()
            .iter()
            .all(|r| r.id != "nested-should-fail")
    );
}

// ── #4: the correct pattern — run SQL directly on an outer tx ──

#[test]
fn direct_insert_on_outer_tx_persists_on_commit() {
    // The pattern apply_topology_diff uses: open one tx, run the
    // INSERT directly, commit once.
    let (store, _) = fresh();
    let conn = store.conn;
    let tx = conn.unchecked_transaction().unwrap();

    tx.execute(
        "INSERT INTO workspace_instances \
         (id, type_key, location_id, name, description, colour, status, last_accessed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'active', \
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params!["direct-1", "restaurant-pos", "default", "Direct", ""],
    )
    .unwrap();
    tx.commit().unwrap();

    let row = fetch_instance(&store, "direct-1");
    assert_eq!(row.type_key, "restaurant-pos");
    assert_eq!(row.status, "active");
}

#[test]
fn direct_insert_on_outer_tx_rolls_back_on_drop() {
    // Dropping the outer tx without commit rolls everything back —
    // the atomicity guarantee apply_topology_diff relies on.
    let (store, _) = fresh();
    let conn = store.conn;
    {
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute(
            "INSERT INTO workspace_instances \
             (id, type_key, location_id, name, description, colour, status, last_accessed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'active', \
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params!["rollback-1", "restaurant-pos", "default", "Roll", ""],
        )
        .unwrap();
        // Drop without commit → rollback.
    }
    assert!(
        store
            .list_all_instances("default")
            .unwrap()
            .iter()
            .all(|r| r.id != "rollback-1")
    );
}

#[test]
fn mixed_create_update_archive_on_one_tx_commits_atomically() {
    // Audit #4 happy path: create + update + archive in one tx all
    // succeed and commit together (direct SQL, no nested tx).
    let (store, _) = fresh();
    let conn = store.conn;
    let tx = conn.unchecked_transaction().unwrap();

    // Create two.
    for (id, name) in [("diff-a", "A"), ("diff-b", "B")] {
        tx.execute(
            "INSERT INTO workspace_instances \
             (id, type_key, location_id, name, description, colour, status, last_accessed_at) \
             VALUES (?1, 'store-pos', 'default', ?2, '', NULL, 'active', \
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![id, name],
        )
        .unwrap();
    }
    // Update A's name.
    tx.execute(
        "UPDATE workspace_instances SET name = ?2, \
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE id = ?1",
        params!["diff-a", "A Renamed"],
    )
    .unwrap();
    // Archive B.
    tx.execute(
        "UPDATE workspace_instances SET status = 'archived', \
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE id = ?1",
        params!["diff-b"],
    )
    .unwrap();
    tx.commit().unwrap();

    let instances = store.list_all_instances("default").unwrap();
    let a = instances.iter().find(|r| r.id == "diff-a").unwrap();
    assert_eq!(a.name, "A Renamed");
    assert_eq!(a.status, "active");
    let b = instances.iter().find(|r| r.id == "diff-b").unwrap();
    assert_eq!(b.status, "archived");
}

#[test]
fn failed_step_rolls_back_entire_diff_tx() {
    // Audit #4: if a later step fails, prior creates/updates must
    // roll back — no partial persistence.
    let (store, _) = fresh();
    let conn = store.conn;
    let tx = conn.unchecked_transaction().unwrap();

    // Create.
    tx.execute(
        "INSERT INTO workspace_instances \
         (id, type_key, location_id, name, description, colour, status, last_accessed_at) \
         VALUES (?1, 'store-pos', 'default', 'Will Roll Back', '', NULL, 'active', \
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params!["diff-rollback"],
    )
    .unwrap();
    // Archive a non-existent id → 0 rows affected (failure signal).
    let archived = tx
        .execute(
            "UPDATE workspace_instances SET status = 'archived' WHERE id = ?1",
            params!["ghost-id"],
        )
        .unwrap();
    assert_eq!(archived, 0, "ghost archive affects 0 rows");
    // Roll back (apply_topology_diff returns the error, drops the tx).
    drop(tx);

    assert!(
        store
            .list_all_instances("default")
            .unwrap()
            .iter()
            .all(|r| r.id != "diff-rollback")
    );
}

// ── #1: type_key and store_id are immutable via update ──────────

#[test]
fn update_does_not_change_type_key() {
    // Audit #1: a rename must not silently change the type. The
    // update path has no type_key parameter, so the type stays.
    let (store, _) = fresh();
    store
        .create_workspace_instance(
            "imm-type",
            "restaurant-pos",
            "default",
            "Original",
            "",
            None,
        )
        .unwrap();

    store
        .update_workspace_instance("imm-type", "Renamed", None, None)
        .unwrap();

    let row = fetch_instance(&store, "imm-type");
    assert_eq!(row.name, "Renamed");
    assert_eq!(
        row.type_key, "restaurant-pos",
        "type_key must be immutable across an update"
    );
}

#[test]
fn update_does_not_change_store_id() {
    let (store, _) = fresh();
    store
        .create_workspace_instance("imm-store", "store-pos", "default", "Original", "", None)
        .unwrap();

    store
        .update_workspace_instance("imm-store", "Renamed", None, None)
        .unwrap();

    let row = fetch_instance(&store, "imm-store");
    assert_eq!(row.name, "Renamed");
    assert_eq!(
        row.store_id, "default",
        "store_id must be immutable across an update"
    );
}

#[test]
fn update_preserves_type_and_store_when_changing_other_fields() {
    let (store, _) = fresh();
    store
        .create_workspace_instance(
            "imm-full",
            "kds",
            "default",
            "Kitchen",
            "old desc",
            Some("#aaaaaa"),
        )
        .unwrap();

    store
        .update_workspace_instance(
            "imm-full",
            "Kitchen Renamed",
            Some("new desc"),
            Some("#bbbbbb"),
        )
        .unwrap();

    let row = fetch_instance(&store, "imm-full");
    assert_eq!(row.name, "Kitchen Renamed");
    assert_eq!(row.description, "new desc");
    assert_eq!(row.colour.as_deref(), Some("#bbbbbb"));
    // Immutable fields untouched.
    assert_eq!(row.type_key, "kds");
    assert_eq!(row.store_id, "default");
}

#[test]
fn update_cannot_move_instance_to_another_store() {
    // Even when a second store exists, update has no store_id param.
    let (store, _) = fresh();
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, currency, timezone)
             VALUES ('store-b', 'Store B', '456 Elm', 'IDR', 'Asia/Jakarta')",
            [],
        )
        .unwrap();
    store
        .create_workspace_instance("stay", "store-pos", "default", "A", "", None)
        .unwrap();

    store
        .update_workspace_instance("stay", "Renamed", None, None)
        .unwrap();

    let row = fetch_instance(&store, "stay");
    assert_eq!(row.store_id, "default");
    let store_b = store.list_all_instances("store-b").unwrap();
    assert!(
        !store_b.iter().any(|r| r.id == "stay"),
        "instance must not leak across stores on update"
    );
}

#[test]
fn update_coalesces_unchanged_fields_preserving_type_and_store() {
    // COALESCE contract: None for description/colour keeps existing
    // values — the mechanism that makes partial updates safe and
    // never clobbers type/store.
    let (store, _) = fresh();
    store
        .create_workspace_instance(
            "coalesce",
            "store-pos",
            "default",
            "Name",
            "keep me",
            Some("#abcdef"),
        )
        .unwrap();

    store
        .update_workspace_instance("coalesce", "Renamed", None, None)
        .unwrap();

    let row = fetch_instance(&store, "coalesce");
    assert_eq!(row.name, "Renamed");
    assert_eq!(row.description, "keep me");
    assert_eq!(row.colour.as_deref(), Some("#abcdef"));
    assert_eq!(row.type_key, "store-pos");
    assert_eq!(row.store_id, "default");
}

// ── Input validation ────────────────────────────────────────────────

#[test]
fn create_workspace_instance_rejects_empty_id() {
    let (store, _) = fresh();
    let err = store
        .create_workspace_instance("", "store-pos", "default", "Name", "desc", None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "id", .. }));
}

#[test]
fn create_workspace_instance_rejects_empty_type_key() {
    let (store, _) = fresh();
    let err = store
        .create_workspace_instance("ws-1", "", "default", "Name", "desc", None)
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "type_key",
            ..
        }
    ));
}

#[test]
fn create_workspace_instance_rejects_empty_store_id() {
    let (store, _) = fresh();
    let err = store
        .create_workspace_instance("ws-1", "store-pos", "", "Name", "desc", None)
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_id",
            ..
        }
    ));
}

#[test]
fn create_workspace_instance_rejects_empty_name() {
    let (store, _) = fresh();
    let err = store
        .create_workspace_instance("ws-1", "store-pos", "default", "", "desc", None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "name", .. }));
}

#[test]
fn update_workspace_instance_rejects_empty_name() {
    let (store, _) = fresh();
    store
        .create_workspace_instance("ws-1", "store-pos", "default", "Name", "desc", None)
        .unwrap();
    let err = store
        .update_workspace_instance("ws-1", "", None, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "name", .. }));
}

// ── Session-mint authorization gate (audit-open-findings residual) ────────────
//
// `verify_instance_access` is the server-side gate `create_session`
// calls in both desktop and tablet clients (ADR #4 / ADR #7). TDD red:
// the gate must FAIL CLOSED when the caller identity cannot be trusted
// — unknown user, inactive user, or a claimed `role_id` that does not
// match the user's actual database role. The previous implementation
// trusted the caller-supplied `role_id` for the owner/manager bypass
// and never resolved the user, so any IPC caller who knew a user id
// could mint a session AS that user (privilege escalation) in ANY
// store's active instance (cross-store session minting) — the residual
// recorded in audit-open-findings.

/// Seed the built-in roles plus an owner user (role-owner carries `*`).
fn seed_owner_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

#[test]
fn verify_instance_access_denies_unknown_user() {
    let (store, _) = fresh();
    // A ghost user id with the owner claim previously passed the owner
    // bypass (no `user_location_access` rows → single-store mode) and
    // would have minted a session for an identity that does not exist.
    let ok = store
        .verify_instance_access(
            "role-owner",
            "ghost-user",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(!ok, "unknown user must not be able to open a session");
}

#[test]
fn verify_instance_access_rejects_forged_owner_role() {
    let (store, user_id) = fresh();
    // user-1's ACTUAL role is role-test. Claiming role-owner must be
    // rejected even though the instance exists and is active.
    let ok = store
        .verify_instance_access("role-owner", &user_id, "default-restaurant-pos", "default")
        .unwrap();
    assert!(
        !ok,
        "a claimed role differing from the user's real role must be denied"
    );
}

#[test]
fn verify_instance_access_denies_inactive_user() {
    let (store, user_id) = fresh();
    // Claim the user's REAL role AND grant an explicit instance
    // assignment: without the `is_active` guard, branch 2 would return
    // Ok(true), so this test uniquely pins the inactive check rather
    // than being denied by a role mismatch.
    store
        .set_user_workspace_instances(&user_id, ["default-admin"], None)
        .unwrap();
    store
        .conn
        .execute(
            "UPDATE users SET is_active = 0 WHERE id = ?1",
            params![user_id],
        )
        .unwrap();
    let ok = store
        .verify_instance_access("role-test", &user_id, "default-admin", "default")
        .unwrap();
    assert!(!ok, "deactivated users must not be able to open a session");
}

#[test]
fn verify_instance_access_allows_real_owner() {
    let (store, _) = fresh();
    seed_owner_user(store.conn);
    let ok = store
        .verify_instance_access(
            "role-owner",
            "user-owner",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(
        ok,
        "a real owner with the matching role keeps instance access"
    );
}

#[test]
fn verify_instance_access_allows_auditor() {
    // Auditor is a global read-only role — the session-open gate must
    // admit it into any active instance so it can reach its read-only
    // screens (the plan's "Auditor is global" claim).
    let (store, _) = fresh();
    seed_owner_user(store.conn);
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at)
             VALUES ('user-auditor', 'auditor', 'hash', 'Auditor', 'role-auditor', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    let ok = store
        .verify_instance_access(
            "role-auditor",
            "user-auditor",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(
        ok,
        "a real auditor with the matching role keeps instance access"
    );
}

#[test]
fn verify_instance_access_allows_explicit_assignment_with_real_role() {
    let (store, user_id) = fresh();
    store
        .set_user_workspace_instances(&user_id, ["default-admin"], None)
        .unwrap();
    let ok = store
        .verify_instance_access("role-test", &user_id, "default-admin", "default")
        .unwrap();
    assert!(
        ok,
        "explicit instance assignment with the real role stays allowed"
    );
}

#[test]
fn verify_instance_access_multi_store_owner_limited_to_assigned_stores() {
    let (store, _) = fresh();
    seed_owner_user(store.conn);
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, currency, timezone)
             VALUES ('store-b', 'Store B', '456 Elm', 'IDR', 'Asia/Jakarta')",
            [],
        )
        .unwrap();
    store
        .create_workspace_instance(
            "store-b-restaurant-pos",
            "restaurant-pos",
            "store-b",
            "Store B POS",
            "",
            None,
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO user_location_access (user_id, location_id, access_level)
             VALUES ('user-owner', 'default', 'manager')",
            [],
        )
        .unwrap();

    let ok_default = store
        .verify_instance_access(
            "role-owner",
            "user-owner",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    let ok_store_b = store
        .verify_instance_access(
            "role-owner",
            "user-owner",
            "store-b-restaurant-pos",
            "store-b",
        )
        .unwrap();
    assert!(
        ok_default,
        "owner with store access keeps their assigned store"
    );
    assert!(
        !ok_store_b,
        "multi-store owner must not open a session in an unassigned store"
    );
}

// ── Staff role bypass removal (home-screen role gating) ──────────

#[test]
fn list_workspaces_staff_without_assignments_returns_empty() {
    // role-staff is no longer in the owner bypass — without explicit
    // user_workspace_instances or role_workspace_types rows the
    // listing must return empty (whereas before the change it returned
    // all 5 instances in the store).
    let (store, _) = fresh();
    let dto = store
        .list_workspaces("role-staff", None, "default")
        .unwrap();
    assert!(
        dto.is_empty(),
        "staff with no assignment must not see any workspaces, got {dto:?}"
    );
}

#[test]
fn list_workspaces_staff_sees_only_explicitly_assigned_instances() {
    let (store, user_id) = fresh();
    // Give the user explicit assignment to kds and admin.
    store
        .set_user_workspace_instances(&user_id, ["default-kds", "default-admin"], None)
        .unwrap();
    let dto = store
        .list_workspaces("role-staff", Some(&user_id), "default")
        .unwrap();
    assert_eq!(dto.len(), 2);
    assert!(dto.iter().any(|w| w.type_key == "kds"));
    assert!(dto.iter().any(|w| w.type_key == "admin"));
    // Must NOT see the other instances (restaurant-pos, store-pos, warehouse).
    assert!(!dto.iter().any(|w| w.type_key == "restaurant-pos"));
    assert!(!dto.iter().any(|w| w.type_key == "store-pos"));
    assert!(!dto.iter().any(|w| w.type_key == "warehouse"));
}

#[test]
fn list_workspaces_staff_falls_back_to_role_workspace_types() {
    let (store, _) = fresh();
    // role_workspace_types.role_id is an FK to roles(id) — seed the
    // built-in roles so the role-staff row can reference it.
    store.seed_default_roles().unwrap();
    // Seed a role_workspace_types row for role-staff → store-pos.
    store
        .conn
        .execute(
            "INSERT INTO role_workspace_types (role_id, type_key) VALUES ('role-staff', 'store-pos')",
            [],
        )
        .unwrap();
    let dto = store
        .list_workspaces("role-staff", None, "default")
        .unwrap();
    assert_eq!(dto.len(), 1);
    assert_eq!(dto[0].type_key, "store-pos");
}

#[test]
fn verify_instance_access_staff_denies_unassigned_instance() {
    let (store, _) = fresh();
    store.seed_default_roles().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();

    // No explicit assignment, no role_workspace_types → deny.
    let denied = store
        .verify_instance_access(
            "role-staff",
            "user-staff",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(
        !denied,
        "staff without assignment must be denied any instance"
    );

    // Explicit assignment → allow.
    store
        .set_user_workspace_instances("user-staff", ["default-restaurant-pos"], None)
        .unwrap();
    let allowed = store
        .verify_instance_access(
            "role-staff",
            "user-staff",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(allowed, "staff with explicit assignment must be allowed");
}

#[test]
fn verify_instance_access_staff_falls_back_to_role_workspace_types() {
    let (store, _) = fresh();
    store.seed_default_roles().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();

    // No assignment, no role_workspace_types → deny.
    let denied = store
        .verify_instance_access(
            "role-staff",
            "user-staff",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(
        !denied,
        "staff without any role_workspace_types must be denied"
    );

    // Seed role_workspace_types for staff → kds.
    store
        .conn
        .execute(
            "INSERT INTO role_workspace_types (role_id, type_key) VALUES ('role-staff', 'kds')",
            [],
        )
        .unwrap();

    // KDS is now allowed via the role_workspace_types fallback.
    let allowed_kds = store
        .verify_instance_access("role-staff", "user-staff", "default-kds", "default")
        .unwrap();
    assert!(
        allowed_kds,
        "staff with role_workspace_types must be allowed for kds"
    );

    // Restaurant-pos is NOT in role_workspace_types → still denied.
    let denied_restaurant = store
        .verify_instance_access(
            "role-staff",
            "user-staff",
            "default-restaurant-pos",
            "default",
        )
        .unwrap();
    assert!(
        !denied_restaurant,
        "staff without role_workspace_types for restaurant-pos must be denied"
    );
}

#[test]
fn list_workspaces_staff_respects_user_store_access_out_of_scope_store_denied() {
    let (store, _) = fresh();
    store.seed_default_roles().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    // Staff role gets store-pos via role_workspace_types.
    store
        .conn
        .execute(
            "INSERT INTO role_workspace_types (role_id, type_key) VALUES ('role-staff', 'store-pos')",
            [],
        )
        .unwrap();
    // A second store with a store-pos instance the staff role type-matches.
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, currency, timezone)
             VALUES ('store-b', 'Store B', '456 Elm', 'IDR', 'Asia/Jakarta')",
            [],
        )
        .unwrap();
    store
        .create_workspace_instance(
            "store-b-store-pos",
            "store-pos",
            "store-b",
            "Store B POS",
            "",
            None,
        )
        .unwrap();
    // Multi-store mode: staff is only granted access to the default store.
    store
        .conn
        .execute(
            "INSERT INTO user_location_access (user_id, location_id, access_level)
             VALUES ('user-staff', 'default', 'staff')",
            [],
        )
        .unwrap();

    // In-scope store lists normally.
    let in_scope = store
        .list_workspaces("role-staff", Some("user-staff"), "default")
        .unwrap();
    assert!(!in_scope.is_empty(), "staff must see its assigned store");

    // Out-of-scope store must be denied — empty list, not a leak.
    let out_of_scope = store
        .list_workspaces("role-staff", Some("user-staff"), "store-b")
        .unwrap();
    assert!(
        out_of_scope.is_empty(),
        "staff without user_location_access on store-b must not enumerate it, got {out_of_scope:?}"
    );
}

#[test]
fn verify_instance_access_staff_respects_user_store_access_out_of_scope_denied() {
    let (store, _) = fresh();
    store.seed_default_roles().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO role_workspace_types (role_id, type_key) VALUES ('role-staff', 'store-pos')",
            [],
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, currency, timezone)
             VALUES ('store-b', 'Store B', '456 Elm', 'IDR', 'Asia/Jakarta')",
            [],
        )
        .unwrap();
    store
        .create_workspace_instance(
            "store-b-store-pos",
            "store-pos",
            "store-b",
            "Store B POS",
            "",
            None,
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO user_location_access (user_id, location_id, access_level)
             VALUES ('user-staff', 'default', 'staff')",
            [],
        )
        .unwrap();

    // In-scope store instance verifies.
    let in_scope = store
        .verify_instance_access("role-staff", "user-staff", "default-store-pos", "default")
        .unwrap();
    assert!(in_scope, "staff must open a session in its assigned store");

    // Out-of-scope store instance is denied even though the role type-matches.
    let out_of_scope = store
        .verify_instance_access("role-staff", "user-staff", "store-b-store-pos", "store-b")
        .unwrap();
    assert!(
        !out_of_scope,
        "staff must not open a session in an unassigned store"
    );
}

#[test]
fn list_workspaces_with_entitlement_staff_filters_by_tier_after_assignment() {
    // Free tier allows restaurant-pos, store-pos, admin — but NOT kds.
    // A staff user explicitly assigned kds + store-pos must see only
    // store-pos after entitlement filtering (kds pruned by tier).
    let (store, _user_id) = fresh();
    store.seed_default_roles().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    store
        .set_user_workspace_instances("user-staff", ["default-kds", "default-store-pos"], None)
        .unwrap();
    let free = sub_for_tier(SubscriptionTier::Free);
    let dto = store
        .list_workspaces_with_entitlement("role-staff", Some("user-staff"), "default", &free)
        .unwrap();
    // kds is NOT allowed by Free tier → must be filtered out.
    assert!(
        !dto.iter().any(|w| w.type_key == "kds"),
        "Free tier staff must not see kds, got {dto:?}"
    );
    // store-pos IS allowed by Free tier → must remain.
    assert!(
        dto.iter().any(|w| w.type_key == "store-pos"),
        "Free tier staff must still see store-pos, got {dto:?}"
    );
    assert_eq!(dto.len(), 1, "expected only store-pos, got {dto:?}");
}
