//! Unit tests for workspace CRUD and quota enforcement in topology Apply.
//!
//! Covers KDS screen quota, POS instance quota, archive recycling,
//! `quota_suspended` status, update-only skip path, Enterprise unlimited.

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::subscription::SubscriptionTier;
use kasirmu_core::workspace_type::KDS;

/// Seed a workspace instance directly in the store DB for quota-setup fixtures.
fn seed_workspace(
    ctx: &BridgeCtx<'_>,
    id: &str,
    type_key: &str,
    store_id: &str,
    name: &str,
    status: &str,
) {
    let conn = ctx
        .db_manager
        .open_store(store_id)
        .expect("open store for seeding");
    let db = conn.lock().expect("store db lock for seeding");
    db.execute(
        "INSERT OR IGNORE INTO workspace_instances \
         (id, type_key, location_id, name, status, last_accessed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![id, type_key, store_id, name, status],
    )
    .expect("seed workspace instance");
}

#[test]
fn apply_workspace_crud_enforces_kds_screen_quota_on_pro() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // `TestBridge::new()` seeds 1 default `store-pos` and 1 default `kds` screen in "default".
    // On Pro tier, max_kds_screens is 2.
    // 1. Creating 1 additional KDS screen brings total to 2 -> succeeds.
    let one_kds = vec![CreateInstanceRequest {
        id: "kds-second".into(),
        type_key: KDS.to_string(),
        store_id: store_id.into(),
        name: "Kitchen Display 2".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let result = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &one_kds, &[], &[]);
    assert!(
        result.is_ok(),
        "Pro allows up to 2 KDS screens (current 1 + requested 1 = 2): {result:?}"
    );

    // 2. Attempting to create 2 additional KDS screens (projected 1 + 2 = 3) -> rejected by KDS quota.
    let two_more_kds = vec![
        CreateInstanceRequest {
            id: "kds-overflow-1".into(),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: "Kitchen Display 3".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "kds-overflow-2".into(),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: "Kitchen Display 4".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
    ];
    let err = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Pro,
        &two_more_kds,
        &[],
        &[],
    )
    .unwrap_err();
    assert!(
        err.to_string()
            .contains("KDS screen quota exceeded: limit 2"),
        "expected KDS quota error, got: {err}"
    );

    // 3. Premium tier allows unlimited KDS screens -> succeeds with 2 more KDS.
    let result_premium = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Premium,
        &two_more_kds,
        &[],
        &[],
    );
    assert!(
        result_premium.is_ok(),
        "Premium tier has unlimited KDS screens: {result_premium:?}"
    );
}

#[test]
fn apply_workspace_crud_kds_creation_does_not_consume_pos_register_quota() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // `TestBridge::new()` seeds baseline workspaces into "default":
    // 2 POS instances (store-pos, restaurant-pos) and 1 KDS screen.
    // On Pro tier:
    // - max_pos_instances is 5. With 2 current, 3 more POS registers reach the exact limit (2 + 3 = 5).
    // - max_kds_screens is 2. With 1 current, 1 more KDS screen reaches the exact limit (1 + 1 = 2).
    //
    // If KDS creations were mistakenly counted in POS quota (the prior bug),
    // requested POS would be 3 POS + 1 KDS = 4, bringing projected POS to 2 + 4 = 6 > 5 and failing.
    // With KDS separated from POS, both quotas are satisfied (projected POS = 5, projected KDS = 2).
    let mixed_batch = vec![
        CreateInstanceRequest {
            id: "pos-reg-3".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "Register 3".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-reg-4".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "Register 4".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-reg-5".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "Register 5".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "kds-2".into(),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: "Kitchen Display 2".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
    ];

    let result = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Pro,
        &mixed_batch,
        &[],
        &[],
    );
    assert!(
        result.is_ok(),
        "mixed batch of 3 POS registers and 1 KDS screen should succeed without quota collision: {result:?}"
    );

    // Adding one MORE POS register now exceeds the Pro POS quota (5 current + 1 requested = 6 > 5).
    let fourth_pos = vec![CreateInstanceRequest {
        id: "pos-reg-6".into(),
        type_key: "store-pos".into(),
        store_id: store_id.into(),
        name: "Register 6".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let err = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &fourth_pos, &[], &[])
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("workspace instance quota exceeded: limit 5"),
        "expected POS quota limit 5 error, got: {err}"
    );
}

/// Archiving a KDS screen must FREE quota for a new KDS creation.
///
/// Pro tier has max_kds_screens = 2, starting with 1 active.
/// Archive the active KDS (decrement by 1), then create 2 new KDS screens.
/// Projected: (current 1 - archived 1 + created 2) = 2 ≤ limit 2 → succeeds.
#[test]
fn apply_workspace_crud_archive_frees_kds_quota() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // Archive the seeded default-kds, then create 2 new KDS screens.
    // Archived reduces the count: projected = 1 - 1 + 2 = 2 ≤ 2 → ok.
    let two_new_kds = vec![
        CreateInstanceRequest {
            id: "kds-replacement-1".into(),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: "Fry Station".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "kds-replacement-2".into(),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: "Grill Station".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
    ];

    let result = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Pro,
        &two_new_kds,
        &[],
        &["default-kds".to_string()],
    );
    assert!(
        result.is_ok(),
        "archiving 1 KDS + creating 2 must succeed (projected 2 ≤ limit 2): {result:?}"
    );
}

/// Archiving a POS register must FREE quota for a new POS creation.
///
/// Pro tier has max_pos_instances = 5, starting with 2 POS + 1 KDS.
/// Archive the restaurant-pos (1 freed), create 4 new store-pos.
/// Projected POS = 2 - 1 + 4 = 5 ≤ 5 → ok (without the archive, 2+4=6 > 5).
#[test]
fn apply_workspace_crud_archive_frees_pos_quota() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    let four_new_pos = vec![
        CreateInstanceRequest {
            id: "pos-new-1".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS 1".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-new-2".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS 2".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-new-3".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS 3".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-new-4".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS 4".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
    ];

    let result = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Pro,
        &four_new_pos,
        &[],
        // Archive the seeded restaurant-pos to free one slot.
        &["default-restaurant-pos".to_string()],
    );
    assert!(
        result.is_ok(),
        "archiving 1 POS + creating 4 must succeed (projected 5 ≤ limit 5): {result:?}"
    );
}

/// A `quota_suspended` KDS screen must NOT count as active, so creating
/// additional KDS screens past the normal limit succeeds when one is suspended.
#[test]
fn apply_workspace_crud_quota_suspended_kds_does_not_consume_quota() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // Seed a second KDS screen with `quota_suspended` status.
    // The existing active KDS + this suspended one = 1 active. Pro limit is 2.
    seed_workspace(
        &ctx,
        "kds-suspended",
        "kds",
        store_id,
        "Suspended KDS",
        "quota_suspended",
    );

    // Creating 1 additional KDS brings active total to 2 → ok.
    let one_kds = vec![CreateInstanceRequest {
        id: "kds-after-suspend".into(),
        type_key: KDS.to_string(),
        store_id: store_id.into(),
        name: "KDS After Suspend".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let result = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &one_kds, &[], &[]);
    assert!(
        result.is_ok(),
        "suspended KDS must not count toward quota: {result:?}"
    );

    // Now the active total is 2. Creating one more must be rejected (3 > 2).
    let overflow = vec![CreateInstanceRequest {
        id: "kds-overflow-suspend".into(),
        type_key: KDS.to_string(),
        store_id: store_id.into(),
        name: "Overflow".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let err = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &overflow, &[], &[])
        .unwrap_err();
    assert!(
        err.to_string().contains("KDS screen quota exceeded"),
        "after reaching active limit, another KDS must be rejected: {err}"
    );
}

/// A `quota_suspended` POS register must not count as active for POS quota.
#[test]
fn apply_workspace_crud_quota_suspended_pos_does_not_consume_quota() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // Baseline: 2 active POS. Seed one more as `quota_suspended`.
    seed_workspace(
        &ctx,
        "pos-suspended",
        "store-pos",
        store_id,
        "Suspended POS",
        "quota_suspended",
    );

    // Pro max_pos_instances = 5. 2 active + 3 more = 5 → ok.
    let three_new = vec![
        CreateInstanceRequest {
            id: "pos-post-suspend-1".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS A".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-post-suspend-2".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS B".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "pos-post-suspend-3".into(),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: "POS C".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
    ];
    let result = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &three_new, &[], &[]);
    assert!(
        result.is_ok(),
        "suspended POS must not count toward quota: {result:?}"
    );

    // 5 active now. One more overflows.
    let overflow = vec![CreateInstanceRequest {
        id: "pos-overflow-suspend".into(),
        type_key: "store-pos".into(),
        store_id: store_id.into(),
        name: "Overflow".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let err = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &overflow, &[], &[])
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("workspace instance quota exceeded"),
        "after reaching active limit, another POS must be rejected: {err}"
    );
}

/// Topology edits with ZERO creates and ZERO archives must skip the
/// quota check entirely — the user is reorganising, not growing.
///
/// Even at the Pro tier with the KDS quota saturated at 2, a rename
/// update (no creates, no archives) must not be rejected.
#[test]
fn apply_workspace_crud_update_only_skips_quota_check() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // Seed a second KDS so the Pro tier is already at its limit of 2.
    seed_workspace(&ctx, "kds-extra", "kds", store_id, "Extra KDS", "active");

    // Update only: no creates, no archives. Must pass even though quota is saturated.
    let updates = vec![UpdateInstanceRequest {
        id: "default-kds".into(),
        name: "Renamed KDS".into(),
        purpose_key: None,
    }];
    let result = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Pro, &[], &updates, &[]);
    assert!(
        result.is_ok(),
        "update-only topology edit must not be blocked by quota: {result:?}"
    );
}

/// Enterprise tier allows unlimited KDS screens (max_kds_screens = None).
/// Must succeed even with many simultaneous KDS creations.
#[test]
fn apply_workspace_crud_enterprise_allows_unlimited_kds() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    // Enterprise has no KDS limit. Even creating 10 KDS screens must succeed.
    let ten_kds: Vec<CreateInstanceRequest> = (1..=10)
        .map(|i| CreateInstanceRequest {
            id: format!("kds-ent-{i}"),
            type_key: KDS.to_string(),
            store_id: store_id.into(),
            name: format!("Enterprise KDS {i}"),
            description: None,
            colour: None,
            purpose_key: None,
        })
        .collect();

    let result = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Enterprise,
        &ten_kds,
        &[],
        &[],
    );
    assert!(
        result.is_ok(),
        "Enterprise must allow unlimited KDS screens: {result:?}"
    );
}

/// Enterprise tier allows unlimited POS instances (max_pos_instances = None).
#[test]
fn apply_workspace_crud_enterprise_allows_unlimited_pos() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    let ten_pos: Vec<CreateInstanceRequest> = (1..=10)
        .map(|i| CreateInstanceRequest {
            id: format!("pos-ent-{i}"),
            type_key: "store-pos".into(),
            store_id: store_id.into(),
            name: format!("Enterprise POS {i}"),
            description: None,
            colour: None,
            purpose_key: None,
        })
        .collect();

    let result = apply_workspace_crud(
        &ctx,
        store_id,
        SubscriptionTier::Enterprise,
        &ten_pos,
        &[],
        &[],
    );
    assert!(
        result.is_ok(),
        "Enterprise must allow unlimited POS instances: {result:?}"
    );
}

/// Free tier has max_kds_screens = 0, so ANY KDS creation is rejected.
#[test]
fn apply_workspace_crud_free_tier_rejects_any_kds() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let store_id = "default";

    let one_kds = vec![CreateInstanceRequest {
        id: "kds-free".into(),
        type_key: KDS.to_string(),
        store_id: store_id.into(),
        name: "KDS on Free".into(),
        description: None,
        colour: None,
        purpose_key: None,
    }];
    let err = apply_workspace_crud(&ctx, store_id, SubscriptionTier::Free, &one_kds, &[], &[])
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("does not allow workspace type kds")
            || err.to_string().contains("KDS screen quota exceeded"),
        "Free tier must reject any KDS creation: {err}"
    );
}
