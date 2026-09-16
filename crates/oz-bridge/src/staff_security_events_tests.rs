//! Security-event wiring on the staff-management paths (Wave-B test
//! relocation: moved out of `apps/desktop-client/src/commands/staff_security_events_tests.rs`).
//!
//! Mounted at the foot of `staff.rs` beside `staff_tests.rs` (multi-mount
//! ruling). The desktop file drove the shell commands through `AppState` + a
//! Tauri mock app; here they run through same-named desktop-shaped adapters
//! over a `TestBridge` context, and the audit rows are read from the global
//! identity DB via `ctx.lock_global()` — the same connection the shell held.
//! Security-event wiring on the staff-management paths.
//!
//! A separate module from `staff_tests.rs` on purpose: that file is another
//! stream's in-flight work, and the audit baseline's tests belong to the audit
//! slice. Both are wired from `staff.rs`.
//!
//! These prove the WRITE side of the staff class end to end through the real
//! commands — that an account creation and a profile edit actually land audit
//! rows naming the ACTOR and the SUBJECT separately, and that a rejected
//! mutation leaves no phantom event. The recorder's own semantics (tier gate,
//! fail-open, payload shape) are covered in `oz-core`.

use super::*;

use crate::testing::TestBridge;
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

// ── Desktop-shaped adapters (relocation scaffolding) ─────────────────
#[allow(dead_code)]
mod desktop_shaped {
    use crate::ctx::BridgeCtx;
    use crate::error::BridgeError;
    use crate::staff::{
        CreateStaffScopedArgs, ProfileViewDto, StaffMemberDto, UpdateStaffScopedArgs,
    };

    pub async fn create_staff_scoped(
        token: String,
        args: CreateStaffScopedArgs,
        ctx: &BridgeCtx<'_>,
    ) -> Result<StaffMemberDto, BridgeError> {
        crate::staff::create_staff_scoped(ctx, &token, &args).await
    }

    pub async fn update_staff_scoped(
        token: String,
        args: UpdateStaffScopedArgs,
        ctx: &BridgeCtx<'_>,
    ) -> Result<StaffMemberDto, BridgeError> {
        crate::staff::update_staff_scoped(ctx, &token, &args).await
    }

    pub async fn get_staff_profile_scoped(
        token: String,
        user_id: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<ProfileViewDto, BridgeError> {
        crate::staff::get_staff_profile_scoped(ctx, &token, &user_id).await
    }
}
use desktop_shaped::{create_staff_scoped, update_staff_scoped};

/// A complete ADR #35 D6 profile — creation requires the mandatory fields.
fn profile() -> ProfileArgs {
    ProfileArgs {
        date_of_birth: Some("1990-05-14".into()),
        phone: Some("+14155550123".into()),
        national_id_type: Some("ssn".into()),
        national_id: Some("123456789".into()),
        email: Some("fixture@example.com".into()),
        monthly_take_home_minor: Some(5_000_000),
        emergency_contact_name: Some("Bob".into()),
        emergency_contact_phone: Some("+14155550987".into()),
        ..Default::default()
    }
}

/// Global DB with an owner, on a tier with staff-quota headroom.
///
/// `fresh_db` seeds Free, which caps staff users at 1 — the quota check
/// would reject the create before the command ever reached the recorder, so
/// every test here raises the tier first.
fn seeded_conn(tier_key: &str) -> rusqlite::Connection {
    let conn = crate::testing::temp_conn();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
    conn
}

/// An app whose `owner-token` session resolves to the owner.
fn owner_app(tier_key: &str) -> TestBridge {
    let conn = seeded_conn(tier_key);
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        "owner-token".into(),
        oz_core::session::SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

/// Every audit row in the global DB.
async fn audit_rows(bridge: &TestBridge) -> Vec<(String, String, String, String, String)> {
    let ctx = bridge.ctx();
    let db = ctx.lock_global().await;
    let mut stmt = db
        .prepare(
            "SELECT user_id, action, outcome, COALESCE(target_id,''), COALESCE(details,'{}')
             FROM audit_log ORDER BY created_at ASC",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .map(|r| r.unwrap())
    .collect()
}

/// An app whose `lite-token` session resolves to a `staff:view`-only user on
/// the given tier.
///
/// The refusal this produces is a PERMISSION one, and the choice is load
/// bearing: see the comment on `a_rejected_create_records_no_security_event`.
/// `create_staff_scoped` gates on `staff:create` at `staff.rs:1073` and only
/// reaches `sub.verify_signature()` at `:1080`, so a permission refusal is the
/// one kind of refusal on that path that is live in BOTH profiles.
fn lite_app(tier_key: &str) -> TestBridge {
    let conn = seeded_conn(tier_key);
    conn.execute(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '["sales:view"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        "lite-token".into(),
        oz_core::session::SessionContext::new(
            "user-lite".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

fn create_args(username: &str) -> CreateStaffScopedArgs {
    CreateStaffScopedArgs {
        username: username.into(),
        pin: "1234".into(),
        display_name: "New Hire".into(),
        role_id: "role-staff".into(),
        profile: profile(),
        assignment: None,
    }
}

#[tokio::test]
async fn create_staff_scoped_records_a_security_event() {
    // Creating an account is how an attacker with a stolen admin session
    // installs persistence — the trail must name who did it and who appeared.
    let bridge = owner_app("premium");
    let ctx = bridge.ctx();
    let settled = create_staff_scoped("owner-token".into(), create_args("jdoe"), &ctx).await;
    // Release: staff.rs:1080 refuses the create at the seeded row signature before the
    // recorder is ever reached, so there is NO event to read - asserting a row count
    // here would be false evidence. Actor-vs-subject, the action name and the PIN
    // redaction below are all debug-profile claims about the WRITE side.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, settled, "premium").await;
        return;
    }
    settled.unwrap();

    let rows = audit_rows(&bridge).await;
    assert_eq!(rows.len(), 1, "one create event, got {rows:?}");
    let (user_id, action, outcome, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner", "user_id is the ACTOR");
    assert_eq!(action, "user.create", "already in auditCatalog.ts");
    assert_eq!(outcome, "success");
    assert_ne!(
        target_id, "user-owner",
        "target_id is the SUBJECT, not the actor"
    );
    let created = {
        let db = ctx.lock_global().await;
        db.query_row::<String, _, _>("SELECT id FROM users WHERE username = 'jdoe'", [], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(target_id, &created);
    assert!(details.contains("jdoe"), "subject username: {details}");
    assert!(details.contains("account_created"), "classifier: {details}");
    assert!(
        !details.contains("1234"),
        "the PIN must never reach the table"
    );
}

#[tokio::test]
async fn a_rejected_create_records_no_security_event() {
    // The recorder runs only after the account exists, so a create refused by
    // a gate leaves no phantom row.
    //
    // THE REFUSAL UNDER TEST IS A PERMISSION ONE, and that is the fix. It used
    // to be a duplicate username; that case is now
    // `a_duplicate_username_create_records_no_security_event`, forked, because
    // it cannot be made honest in the release profile. `create_staff_scoped`
    // gates on `staff:create` at staff.rs:1073 and only reaches
    // `sub.verify_signature()` at :1080 — a duplicate-username setup needs the
    // FIRST create to succeed, and in release that create dies at :1080 on the
    // BOOTSTRAP_FREE sentinel. No fixture in this crate can mint a verifying
    // signature (testing.rs:103-148 — the licence private key is not in this
    // checkout), so no seeded row lets it through: `before` was 0, the
    // duplicate was then refused at :1080 too, and `0 == 0` held for a reason
    // with nothing to do with the recorder. A permission refusal is UPSTREAM
    // of :1080 and therefore live in both profiles, so this case keeps
    // exercising its subject in release instead of going vacuously green.
    let bridge = lite_app("premium");
    let ctx = bridge.ctx();

    let denied = create_staff_scoped("lite-token".into(), create_args("jdoe"), &ctx).await;
    assert!(
        matches!(denied, Err(BridgeError::PermissionDenied(_))),
        "the refusal must be the staff:create gate at staff.rs:1073, upstream of the \
         subscription read — any other error means this case no longer tests what it says: \
         {denied:?}"
    );
    // The refusal was real and not merely a passport stamp: no account exists.
    let created = {
        let db = ctx.lock_global().await;
        db.query_row::<i64, _, _>(
            "SELECT COUNT(*) FROM users WHERE username = 'jdoe'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(
        created, 0,
        "the refused create must not have written a user row"
    );
    assert!(
        audit_rows(&bridge).await.is_empty(),
        "a refused create must not add an event: {:?}",
        audit_rows(&bridge).await
    );
}

#[tokio::test]
async fn a_duplicate_username_create_records_no_security_event() {
    // The duplicate-specific half of the claim above: a create refused for a
    // DUPLICATE USERNAME writes no audit row.
    //
    // Split out because this half IS profile-bound, and the fork says so
    // instead of hiding it. The setup create must SUCCEED for a duplicate to
    // exist, and `create_staff_scoped` only reaches the duplicate check past
    // `sub.verify_signature()` (staff.rs:1080), which the release profile
    // refuses — see testing.rs:103-148 on why no fixture can satisfy it. So in
    // release there is no `jdoe` and no reachable duplicate check: the release
    // leg asserts the REFUSAL (with the row's existence pinned by
    // `assert_refused_by_the_seeded_row`) and stops. The recorder-silence
    // claim this case is really about is carried in both profiles by
    // `a_rejected_create_records_no_security_event`, which refuses upstream of
    // the subscription read.
    let bridge = owner_app("premium");
    let ctx = bridge.ctx();
    let first = create_staff_scoped("owner-token".into(), create_args("jdoe"), &ctx).await;
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, first, "premium").await;
        return;
    }
    first.expect("the setup create must land for a duplicate to be possible");

    let before = audit_rows(&bridge).await.len();
    assert_eq!(
        before, 1,
        "the setup create wrote its own event, so the comparison below is not 0 == 0"
    );

    let dup = create_staff_scoped("owner-token".into(), create_args("jdoe"), &ctx).await;
    assert!(dup.is_err(), "duplicate username must be refused");
    assert_eq!(
        audit_rows(&bridge).await.len(),
        before,
        "a refused create must not add an event"
    );
}

#[tokio::test]
async fn update_staff_scoped_records_one_event_without_a_pin_change() {
    let bridge = owner_app("premium");
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner Renamed".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(result.is_ok(), "{:?}", result.err());

    let rows = audit_rows(&bridge).await;
    assert_eq!(rows.len(), 1, "one update event, got {rows:?}");
    let (user_id, action, _, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner", "actor");
    assert_eq!(action, "user.update");
    assert_eq!(
        target_id, "user-owner",
        "self-edit: actor and subject coincide"
    );
    assert!(details.contains("profile_changed"), "got {details}");
    assert!(
        !details.contains("pin_rotated"),
        "no PIN was supplied: {details}"
    );
}

#[tokio::test]
async fn update_staff_scoped_records_two_events_when_the_pin_rotates() {
    // A rotation is a distinct security fact: it dropped every other session
    // for the account (STAFF-03). Collapsing it into the profile event would
    // lose which of the two happened, so both are written.
    let bridge = owner_app("premium");
    let ctx = bridge.ctx();
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();

    let rows = audit_rows(&bridge).await;
    assert_eq!(rows.len(), 2, "profile + rotation, got {rows:?}");
    assert!(rows.iter().all(|(_, a, _, _, _)| a == "user.update"));
    let reasons: Vec<&str> = rows
        .iter()
        .map(|(_, _, _, _, d)| {
            if d.contains("pin_rotated") {
                "pin_rotated"
            } else {
                "profile_changed"
            }
        })
        .collect();
    assert!(reasons.contains(&"profile_changed"), "got {reasons:?}");
    assert!(reasons.contains(&"pin_rotated"), "got {reasons:?}");
    // The rotation is separable WITHOUT inventing an uncatalogued action.
    assert_eq!(
        rows.iter()
            .filter(|(_, a, _, _, _)| a == "user.pin_change")
            .count(),
        0,
        "no uncatalogued action string may be emitted"
    );
}

#[tokio::test]
async fn a_denied_update_records_no_security_event() {
    // The permission check runs before any write, so a refused edit leaves the
    // trail untouched.
    let bridge = lite_app("premium");
    let ctx = bridge.ctx();
    let denied = update_staff_scoped(
        "lite-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(
        matches!(denied, Err(BridgeError::PermissionDenied(_))),
        "{denied:?}"
    );
    assert!(audit_rows(&bridge).await.is_empty());
}
