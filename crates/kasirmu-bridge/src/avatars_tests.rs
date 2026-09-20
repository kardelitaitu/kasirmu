//! Tests for the avatar command bodies (`avatars.rs`).
//!
//! The subject under test is the PERMISSION RULE and the store write, not the
//! ingest: the ingest is `products_images::ingest_to_store`, already covered by
//! `products_images_tests.rs`. Every denial case here therefore runs the gate
//! and stops — `require_avatar_write` is called BEFORE the source path is
//! touched, which is what lets a denial be asserted against a path that does
//! not exist. That ordering is itself pinned below, because a future refactor
//! that ingests first would still pass every denial case while burning a
//! transcode on a caller who is about to be refused.
//!
//! Harness: `TestBridge::new().with_conn(temp_conn())` plus a session minted
//! into `bridge.sessions()` — the same shape `staff_tests.rs` uses for the same
//! `staff:update` gate, so the two agree on what that grant means.

use super::*;
use crate::testing::{TestBridge, temp_conn};

/// A fully migrated in-memory DB carrying the default role presets plus a
/// manager and a cashier, wired to a `TestBridge` whose session map holds
/// `token` for `user_id`.
///
/// `role-manager` is a preset that grants `staff:update`. `role-lite` is
/// hand-rolled as `["sales:view"]` so the cashier holds NONE of the grants this
/// module gates on — asserting a denial against a role that merely lacks one
/// permission would not prove the gate reads the right one.
fn avatar_state(token: &str, user_id: &str, role_id: &str) -> TestBridge {
    let conn = temp_conn();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute_batch(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
             INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite',    1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
        )
        .unwrap();
    }
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

#[tokio::test]
async fn a_cashier_may_clear_their_own_avatar_without_any_grant() {
    // The whole reason `require_avatar_write` has a self-write arm: a cashier
    // owns their own face and holds no staff grant.
    let bridge = avatar_state("cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();
    clear_avatar_scoped(&ctx, "cashier-token", "user-cashier")
        .await
        .expect("self-write must not require staff:update");
}

#[tokio::test]
async fn a_cashier_may_not_write_someone_elses_avatar() {
    let bridge = avatar_state("cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();
    let result = clear_avatar_scoped(&ctx, "cashier-token", "user-manager").await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "role-lite lacks staff:update, so editing the manager's photo must be refused; got {result:?}"
    );
}

#[tokio::test]
async fn a_manager_may_write_someone_elses_avatar() {
    // The manager half of the same rule — the staff drawer's path.
    let bridge = avatar_state("manager-token", "user-manager", "role-manager");
    let ctx = bridge.ctx();
    clear_avatar_scoped(&ctx, "manager-token", "user-cashier")
        .await
        .expect("the Manager preset grants staff:update");
}

#[tokio::test]
async fn the_gate_runs_before_the_source_path_is_read() {
    // Ordering, not just outcome: the refusal must arrive without the ingest
    // ever touching the filesystem. Asserted by naming a source path that does
    // not exist — if the ingest ran first this would be an Invalid ingest
    // error instead of a denial, and every denial case above would be a
    // lie about what the gate protects.
    let bridge = avatar_state("cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();
    let result = set_avatar_scoped(
        &ctx,
        "cashier-token",
        "user-manager",
        "/nonexistent/face.png",
        std::path::Path::new("/nonexistent"),
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "expected the permission gate before the ingest, got {result:?}"
    );
}

#[tokio::test]
async fn an_unknown_token_is_an_invalid_session() {
    let bridge = avatar_state("cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();
    assert!(
        matches!(
            get_own_avatar_scoped(&ctx, "no-such-token").await,
            Err(BridgeError::InvalidSession)
        ),
        "the read path must reject an unknown token"
    );
    assert!(
        matches!(
            clear_avatar_scoped(&ctx, "no-such-token", "user-cashier").await,
            Err(BridgeError::InvalidSession)
        ),
        "the write path must reject an unknown token"
    );
}

#[tokio::test]
async fn a_write_to_a_user_who_does_not_exist_is_not_found() {
    // The gate passes for a manager, so the UPDATE is the thing that has to
    // notice the missing row — a silent success here would mean the write is
    // not conditional on the user existing.
    let bridge = avatar_state("manager-token", "user-manager", "role-manager");
    let ctx = bridge.ctx();
    let result = clear_avatar_scoped(&ctx, "manager-token", "user-ghost").await;
    assert!(
        matches!(
            result,
            Err(BridgeError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::NotFound,
                ..
            })
        ),
        "expected NotFound from the UPDATE, got {result:?}"
    );
}

#[tokio::test]
async fn set_then_read_then_clear_roundtrips_through_the_content_store() {
    let dir = tempfile::tempdir().expect("temp dir for the media root");
    let bridge = avatar_state("cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();

    assert_eq!(
        get_own_avatar_scoped(&ctx, "cashier-token").await.unwrap(),
        None,
        "a user with no photo reads NULL — the renderer's initials fallback — not an empty string"
    );

    let source = dir.path().join("face.png");
    image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 50, 50, 255]))
        .save_with_format(&source, image::ImageFormat::Png)
        .expect("write the source png");

    let hash = set_avatar_scoped(
        &ctx,
        "cashier-token",
        "user-cashier",
        source.to_str().expect("utf-8 temp path"),
        dir.path(),
    )
    .await
    .expect("a self-write of a real image succeeds");

    assert_eq!(hash.len(), 16, "the avatar hash is 16 hex chars: {hash}");
    assert!(
        dir.path()
            .join("images")
            .join(format!("{hash}.webp"))
            .is_file(),
        "the transcode must land in the SHARED content-addressed store, \
         which is what lets ProductThumb resolve an avatar and a product photo \
         through one code path"
    );

    assert_eq!(
        get_own_avatar_scoped(&ctx, "cashier-token")
            .await
            .unwrap()
            .as_deref(),
        Some(hash.as_str()),
        "the read path must return what the write stored"
    );

    clear_avatar_scoped(&ctx, "cashier-token", "user-cashier")
        .await
        .unwrap();
    assert_eq!(
        get_own_avatar_scoped(&ctx, "cashier-token").await.unwrap(),
        None,
        "clearing returns the user to the initials fallback"
    );
}
