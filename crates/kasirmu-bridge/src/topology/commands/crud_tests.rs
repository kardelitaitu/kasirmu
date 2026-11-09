//! Unit tests for workspace CRUD and quota enforcement in topology Apply.

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::subscription::SubscriptionTier;

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
        type_key: "kds".into(),
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
            type_key: "kds".into(),
            store_id: store_id.into(),
            name: "Kitchen Display 3".into(),
            description: None,
            colour: None,
            purpose_key: None,
        },
        CreateInstanceRequest {
            id: "kds-overflow-2".into(),
            type_key: "kds".into(),
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
            type_key: "kds".into(),
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
