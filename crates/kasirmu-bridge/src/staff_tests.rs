//! Staff command unit tests (Wave-B test relocation: moved out of
//! `apps/desktop-tauri/src/commands/staff_tests.rs`).
//!
//! Mounted at the foot of `staff.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs, the scoped operations and the pub
//! `run_bootstrap_owner` body directly. The desktop file drove the shell
//! commands through `AppState` + a Tauri mock app; here the calls go through
//! same-named desktop-shaped adapters over a `TestBridge` context (the
//! crate's `testing` harness), the global-identity seeds are ported verbatim
//! against `testing::temp_conn`, and error assertions are the 1:1
//! `AppError` -> `BridgeError` rename.
use super::*;
use crate::testing::TestBridge;
use crate::testing::seeded_row_reaches_a_paid_tier;
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

// ── Desktop-shaped adapters (relocation scaffolding) ─────────────────
// The desktop tests called the shell commands with (token, args, State)
// argument order; the bridge fns take (&BridgeCtx, ...). These same-named
// module items shadow the glob imports so every call site below keeps its
// desktop shape; each one delegates to the production bridge fn.
#[allow(dead_code)]
mod desktop_shaped {
    use crate::ctx::BridgeCtx;
    use crate::error::BridgeError;
    use crate::staff::{
        BootstrapOwnerArgs, BootstrapOwnerResult, CreateRoleArgs, CreateStaffScopedArgs,
        PermissionKeyDto, ProfileViewDto, RoleDto, RoleHoldersDto, StaffMemberDto, UpdateRoleArgs,
        UpdateStaffScopedArgs,
    };

    pub async fn list_staff_scoped(
        token: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<Vec<StaffMemberDto>, BridgeError> {
        crate::staff::list_staff_scoped(ctx, &token).await
    }

    pub async fn get_staff_profile_scoped(
        token: String,
        user_id: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<ProfileViewDto, BridgeError> {
        crate::staff::get_staff_profile_scoped(ctx, &token, &user_id).await
    }

    pub async fn list_roles_scoped(
        token: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<Vec<RoleDto>, BridgeError> {
        crate::staff::list_roles_scoped(ctx, &token).await
    }

    pub async fn list_permission_keys_scoped(
        token: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<Vec<PermissionKeyDto>, BridgeError> {
        crate::staff::list_permission_keys_scoped(ctx, &token).await
    }

    pub async fn create_role_scoped(
        token: String,
        args: CreateRoleArgs,
        ctx: &BridgeCtx<'_>,
    ) -> Result<RoleDto, BridgeError> {
        let grants = serde_json::to_string(&args.permissions).unwrap();
        crate::staff::create_role_scoped(ctx, &token, &args, &grants).await
    }

    pub async fn update_role_scoped(
        token: String,
        args: UpdateRoleArgs,
        ctx: &BridgeCtx<'_>,
    ) -> Result<RoleDto, BridgeError> {
        let grants = serde_json::to_string(&args.permissions).unwrap();
        crate::staff::update_role_scoped(ctx, &token, &args, &grants).await
    }

    pub async fn delete_role_scoped(
        token: String,
        id: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<(), BridgeError> {
        crate::staff::delete_role_scoped(ctx, &token, &id).await
    }

    pub async fn list_role_holders_scoped(
        role_id: String,
        token: String,
        ctx: &BridgeCtx<'_>,
    ) -> Result<RoleHoldersDto, BridgeError> {
        crate::staff::list_role_holders_scoped(ctx, &role_id, &token).await
    }

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

    pub async fn bootstrap_owner(
        args: BootstrapOwnerArgs,
        ctx: &BridgeCtx<'_>,
    ) -> Result<BootstrapOwnerResult, BridgeError> {
        crate::staff::bootstrap_owner(ctx, &args).await
    }
}
use desktop_shaped::{
    create_staff_scoped, list_roles_scoped, list_staff_scoped, update_staff_scoped,
};

/// A complete ADR #35 D6 profile for create/update fixtures.
fn complete_profile_args() -> ProfileArgs {
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

// ── StaffMemberDto ──────────────────────────────────────────────────

#[test]
fn staff_member_dto_debug() {
    let dto = StaffMemberDto {
        id: "u1".into(),
        username: "jdoe".into(),
        display_name: "John Doe".into(),
        avatar: None,
        phone: None,
        // Live rows never carry a trash stamp; the trash read sets it after
        // the fact, which is how the screen tells the two lists apart.
        deleted_at: None,
        role_id: "r1".into(),
        role_name: "Manager".into(),
        is_active: true,
        national_id_masked: "*****6789".into(),
        is_profile_complete: true,
        assignment: assignment_dto(None),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("jdoe"));
    assert!(d.contains("Manager"));
}

#[test]
fn staff_member_dto_serialize() {
    let dto = StaffMemberDto {
        id: "u2".into(),
        username: "asmith".into(),
        display_name: "Alice Smith".into(),
        avatar: Some("abcdef0123456789".into()),
        phone: Some("+14155550123".into()),
        deleted_at: None,
        role_id: "r2".into(),
        role_name: "Cashier".into(),
        is_active: false,
        national_id_masked: "****".into(),
        is_profile_complete: false,
        assignment: assignment_dto(None),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["username"], "asmith");
    assert_eq!(json["is_active"], false);
    // The list carries each member's avatar hash as a plain string so the
    // roster can render a photo; null is the "no photo" case, not an omission.
    assert_eq!(json["avatar"], "abcdef0123456789");
    assert_eq!(json["phone"], "+14155550123");
}

// ── RoleDto ─────────────────────────────────────────────────────────

#[test]
fn role_dto_debug() {
    let dto = RoleDto {
        id: "r1".into(),
        name: "Admin".into(),
        description: "Full access".into(),
        permissions: vec![],
        deleted_at: None,
        // preset-guard fields (7948344e): a preset-owned builtin row with
        // no references — the common default shape.
        is_builtin: true,
        reference_count: 0,
        holder_count: 0,
        grant_count: 0,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Admin"));
}

#[test]
fn role_dto_serialize() {
    let dto = RoleDto {
        id: "r2".into(),
        name: "Viewer".into(),
        description: String::new(),
        permissions: vec![],
        deleted_at: None,
        is_builtin: false,
        reference_count: 0,
        holder_count: 0,
        grant_count: 0,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Viewer");
    assert_eq!(json["description"], "");
    // The two split counts are on the wire, not computed front-end: TS
    // declares them required, and a label that reads accounts has to get
    // them from the resolver predicate rather than derive them from rows.
    assert_eq!(json["holder_count"], 0);
    assert_eq!(json["grant_count"], 0);
}

// ── CreateStaffArgs ─────────────────────────────────────────────────

#[test]
fn create_staff_args_deserialize() {
    let json = r##"{"username":"jdoe","pin":"1234","display_name":"John Doe","role_id":"r1","caller_user_id":"admin1"}"##;
    let args: CreateStaffArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "jdoe");
    assert_eq!(args.role_id, "r1");
}

#[test]
fn create_staff_args_debug() {
    let args = CreateStaffArgs {
        username: "u".into(),
        pin: "0000".into(),
        display_name: "D".into(),
        role_id: "r".into(),
        caller_user_id: "c".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("u"));
    assert!(d.contains("r"));
}

// ── UpdateStaffArgs ─────────────────────────────────────────────────

#[test]
fn update_staff_args_deserialize() {
    let json = r##"{"id":"u1","username":"jdoe2","display_name":"John D","role_id":"r2","is_active":false,"caller_user_id":"admin1"}"##;
    let args: UpdateStaffArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "u1");
    assert!(!args.is_active);
}

#[test]
fn update_staff_args_debug() {
    let args = UpdateStaffArgs {
        id: "x".into(),
        username: "y".into(),
        display_name: "z".into(),
        role_id: "r".into(),
        is_active: true,
        caller_user_id: "c".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("z"));
}

// ── STAFF-01 / STAFF-04 — session-scoped authorization (audit-open-findings) ───
//
// TDD red: these tests pin the NEW scoped-command contract. They fail to
// compile until `list_staff_scoped` / `list_roles_scoped` /
// `create_staff_scoped` / `update_staff_scoped` and their arg structs
// (which carry NO caller-supplied identity) exist.

use kasirmu_core::session::SessionContext;

/// Seed the GLOBAL identity DB with an owner (all permissions) and a
/// limited user (no staff permissions — the retired cashier role maps
/// to a narrow custom role, 0048 sweep). Users/roles are global records
/// (ADR #4 / ADR #7); store-scoped DBs contain no users.
fn seed_global_users(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner',   'owner',   'hash', 'Owner',   'role-owner',   1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite',    1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

/// Raise the default tenant's subscription tier so C1.1 staff-quota
/// enforcement has headroom (fresh_db seeds Free, which allows 1 staff).
fn seed_subscription_tier(conn: &rusqlite::Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

fn scoped_state_with_token(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

// NOTE (Wave-B relocation): the two STAFF-01 tombstone tests that lived here
// called the desktop-only unscoped create_staff / update_staff commands,
// which intentionally have no bridge counterpart (the desktop shims are
// unconditional permission-denied stubs). Their denial is now shim source; the
// session-identity property they motivated is pinned by the scoped tests below.
// ── STAFF-01 fix — scoped commands bind identity to the session ────

#[tokio::test]
async fn scoped_create_staff_rejects_invalid_session() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge = TestBridge::new().with_conn(conn);
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "missing-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_create_staff_denies_cashier_session() {
    // The caller identity is bound to the session token. A cashier
    // session (no staff:create) must be denied — there is no request
    // field left to forge.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge = scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "cashier-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_create_staff_allows_owner_session() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    // Pro (20 staff) — plenty of headroom past the seeded cashier.
    seed_subscription_tier(&conn, "pro");
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "owner-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    // Release: staff.rs:1080 verifies the seeded row signature BEFORE the tier gate
    // and before any write, so this refusal is not the staff-quota answer the
    // fixture is about and there is no DTO to read.
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_seeded_row(&bridge, result, "pro").await;
        return;
    }
    let result = result.unwrap();
    assert_eq!(result.username, "mallory");
    assert_eq!(result.role_name, "Staff");
}

#[tokio::test]
async fn scoped_create_staff_blocked_at_free_tier_staff_limit() {
    // C1.1: fresh_db seeds Free (max 1 staff) and seed_global_users
    // already created the cashier — the next creation must be rejected
    // with the subscription-limit error, not silently inserted.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "owner-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;

    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so staff.rs:1080 proceeds past the
    // signature in both and the QUOTA verdict below is asserted in both. This
    // arm is reached only when the row exists but does not verify - then the
    // signature gate refuses FIRST, the free tier 1-staff limit is never
    // consulted, and the error that arrives is InvalidSubscriptionSignature.
    // That ordering is why this arm cannot reuse the match below.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, result, "free").await;
        return;
    }
    match result {
        Err(BridgeError::Core { sub_kind, message }) => {
            assert!(matches!(
                sub_kind,
                kasirmu_core::CoreErrorKind::SubscriptionLimitExceeded
            ));
            assert!(message.contains("allows maximum 1 staff users"));
        }
        other => panic!("expected subscription-limit error, got {other:?}"),
    }
}

#[tokio::test]
async fn scoped_create_staff_allowed_with_headroom_tier() {
    // C1.1: with a Plus tier (5 staff) and a single seeded cashier,
    // the owner can add a new staff member.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    seed_subscription_tier(&conn, "plus");
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "owner-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    // Release: staff.rs:1080 verifies the seeded row signature BEFORE the tier gate
    // and before any write, so this refusal is not the staff-quota answer the
    // fixture is about and there is no DTO to read.
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_seeded_row(&bridge, result, "plus").await;
        return;
    }
    let result = result.unwrap();
    assert_eq!(result.username, "mallory");
}

#[tokio::test]
async fn scoped_update_staff_denies_cashier_session() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge = scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "cashier-token".into(),
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
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── STAFF-02 — role hierarchy ─────────────────────────────────────

#[tokio::test]
async fn scoped_create_staff_denies_cashier_creating_owner() {
    // Even though the cashier has no staff:create at all, the hierarchy
    // guard must also block a role that DOES have staff:create but not
    // staff:manage_roles (Manager/Staff presets) from assigning Owner.
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = create_staff_scoped(
        "manager-token".into(),
        CreateStaffScopedArgs {
            username: "newowner".into(),
            pin: "1234".into(),
            display_name: "New Owner".into(),
            role_id: "role-owner".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "Manager must not create an Owner account"
    );
}

#[tokio::test]
async fn scoped_update_staff_denies_manager_promoting_to_owner() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "manager-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
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
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "Manager must not promote a user to Owner"
    );
}

#[tokio::test]
async fn scoped_update_staff_denies_self_promotion() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    );
    let ctx = bridge.ctx();
    // Manager edits their OWN role → denied (no self-promotion), even
    // though the assignment to role-manager is itself harmless.
    let result = update_staff_scoped(
        "manager-token".into(),
        UpdateStaffScopedArgs {
            id: "user-manager".into(),
            username: "manager".into(),
            display_name: "Manager".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_update_staff_protects_last_active_owner() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    // Owner is the only active owner → cannot demote or deactivate self.
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "last active Owner must not be deactivated"
    );
}

/// STAFF-10 branch pin: the self-deactivation guard must fire on its own —
/// the last-owner test above is satisfied by EITHER branch (both return
/// `PermissionDenied`), so removing the last-owner check would not be
/// caught there. Here the caller is not an Owner at all: only the
/// self-deactivation rule can reject this update.
#[tokio::test]
async fn scoped_update_staff_denies_self_deactivation_by_manager() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-hr', 'HR', 'Staff updater', '[\"staff:update\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-hr', 'hr', 'hash', 'HR Admin', 'role-hr', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(conn, "hr-token", "user-hr", "role-hr", "store-a");
    let ctx = bridge.ctx();
    // HR admin deactivates their OWN account, role unchanged.
    let result = update_staff_scoped(
        "hr-token".into(),
        UpdateStaffScopedArgs {
            id: "user-hr".into(),
            username: "hr".into(),
            display_name: "HR Admin".into(),
            role_id: "role-hr".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    match result {
        Err(BridgeError::PermissionDenied(msg)) => {
            assert!(
                msg.contains("your own account"),
                "expected the self-deactivation message, got: {msg}"
            );
        }
        other => panic!(
            "expected self-deactivation denial, got ok={}",
            other.is_ok()
        ),
    }
}

/// Last-owner branch pin: caller is a non-Owner admin who legitimately
/// holds `staff:manage_roles` (so the Owner-role gate passes) editing a
/// DIFFERENT user — the self-change guard cannot fire. Only the
/// last-active-Owner protection can reject this update.
#[tokio::test]
async fn scoped_update_staff_protects_last_owner_from_other_admin() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-hrboss', 'HR Boss', 'Can manage staff incl. roles', '[\"staff:update\",\"staff:manage_roles\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-hrboss', 'hrboss', 'hash', 'HR Boss', 'role-hrboss', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(
        conn,
        "hrboss-token",
        "user-hrboss",
        "role-hrboss",
        "store-a",
    );
    let ctx = bridge.ctx();
    // Admin deactivates the ONLY active Owner (caller is not an Owner).
    let result = update_staff_scoped(
        "hrboss-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    match result {
        Err(BridgeError::PermissionDenied(msg)) => {
            assert!(
                msg.contains("last active Owner"),
                "expected the last-owner message, got: {msg}"
            );
        }
        other => panic!(
            "expected last-owner protection denial, got ok={}",
            other.is_ok()
        ),
    }
}

// ── STAFF-03 — PIN rotation ───────────────────────────────────────

#[tokio::test]
async fn scoped_update_staff_rotates_pin_when_provided() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();
    assert_eq!(result.username, "cashier");

    // The PIN hash must have changed from the seeded 'hash'.
    let db = ctx.lock_global().await;
    let user = Store::new(&db).get_user("user-cashier").unwrap().unwrap();
    assert_ne!(user.pin_hash, "hash");
}

#[tokio::test]
async fn scoped_update_staff_pin_rotation_invalidates_sessions() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    // A stale session for the cashier whose PIN we rotate.
    bridge.sessions().write().unwrap().insert(
        "cashier-old-session".into(),
        SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();

    // The old cashier session must be gone (invalidated by the rotation).
    let st = &ctx;
    assert!(matches!(
        st.resolve_session("cashier-old-session"),
        Err(BridgeError::InvalidSession)
    ));
    // The owner session survives (different user).
    assert!(st.resolve_session("owner-token").is_ok());
}

#[tokio::test]
async fn scoped_update_staff_self_rotation_preserves_callers_session() {
    // An Owner rotating their OWN PIN must keep their current session:
    // the UI immediately reloads with the same token after the update.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    // Another terminal session for the same owner (issued under the old
    // PIN) SHOULD be invalidated.
    bridge.sessions().write().unwrap().insert(
        "owner-stale-terminal".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-2".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: Some("4321".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();

    let st = &ctx;
    // Current session survives so the UI can continue working.
    assert!(st.resolve_session("owner-token").is_ok());
    // Stale terminal session is gone.
    assert!(matches!(
        st.resolve_session("owner-stale-terminal"),
        Err(BridgeError::InvalidSession)
    ));
}

#[tokio::test]
async fn scoped_update_staff_writes_assignment_scope_atomically() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: None,
            profile: None,
            // ADR #35 D5 (spec 0048): scoped assignment with explicit
            // all/list per dimension — `retail-pos` is FK-valid (seeded
            // by migration 128), branch ids are locations ids.
            assignment: Some(AssignmentArgs {
                scope_mode: "scoped".into(),
                branches_all: false,
                branch_ids: vec!["store-a".into()],
                workspaces_all: false,
                workspace_keys: vec!["retail-pos".into()],
                scope_type: None,
                scope_id: None,
            }),
        },
        &ctx,
    )
    .await
    .unwrap();

    let db = ctx.lock_global().await;
    let assignment = Store::new(&db)
        .assignment_for_user("user-cashier")
        .unwrap()
        .expect("assignment");
    assert_eq!(assignment.scope_mode, ScopeMode::Scoped);
    assert!(!assignment.branches_all && !assignment.workspaces_all);
    assert_eq!(assignment.branches, vec!["store-a"]);
    assert_eq!(assignment.workspaces, vec!["retail-pos"]);
}

/// ADR #47 slice 3: the staff-update IPC now carries the resource axis, so
/// an owner can bind a manager to a single location — and the gate slice 2
/// installed then enforces it end to end (deny on the other location).
#[tokio::test]
async fn scoped_update_staff_writes_location_scoped_assignment() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: Some(AssignmentArgs {
                scope_mode: "global".into(),
                branches_all: true,
                branch_ids: vec![],
                workspaces_all: true,
                workspace_keys: vec![],
                scope_type: Some("location".into()),
                scope_id: Some("loc-a".into()),
            }),
        },
        &ctx,
    )
    .await
    .unwrap();

    let db = ctx.lock_global().await;
    let assignment = Store::new(&db)
        .assignment_for_user("user-cashier")
        .unwrap()
        .expect("assignment");
    assert_eq!(assignment.scope_type, Some(ScopeType::Location));
    assert_eq!(assignment.scope_id.as_deref(), Some("loc-a"));
    assert_eq!(assignment.scope_mode, ScopeMode::Global);
    // The 0048 axis was written alongside it (global mode = all/all).
    assert!(assignment.branches_all && assignment.workspaces_all);
}

/// A narrowed assignment row without its resource id is rejected with a
/// typed Invalid error before any write happens.
#[tokio::test]
async fn scoped_update_staff_rejects_location_scope_without_id() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: Some(AssignmentArgs {
                scope_mode: "global".into(),
                branches_all: true,
                branch_ids: vec![],
                workspaces_all: true,
                workspace_keys: vec![],
                scope_type: Some("location".into()),
                scope_id: None,
            }),
        },
        &ctx,
    )
    .await;

    assert!(matches!(result, Err(BridgeError::Invalid(_))));
}

#[tokio::test]
async fn scoped_update_staff_pin_rotation_clears_login_attempts() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    // Simulate an accumulated lockout for the cashier.
    let _ = Store::new(&conn).record_login_attempt("cashier", 3, 60);
    let _ = Store::new(&conn).record_login_attempt("cashier", 3, 60);
    let _ = Store::new(&conn).record_login_attempt("cashier", 3, 60);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();

    // The lockout must be cleared — a fresh attempt should succeed.
    let db = ctx.lock_global().await;
    let remaining = Store::new(&db)
        .record_login_attempt("cashier", 3, 60)
        .unwrap();
    assert!(remaining.is_ok(), "lockout should be cleared");
}

#[tokio::test]
async fn scoped_update_staff_pin_rotation_never_touches_other_users_sessions() {
    // Isolation guard: rotating one user's PIN must only invalidate that
    // user's own stale sessions — never a different user's active session.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    // A third user (manager) with an active session on another terminal.
    // DB row id is a generated UUID — the session below keys off
    // "user-manager" in the in-memory session store, which is what
    // resolve_session validates (mirrors the self-rotation test).
    Store::new(&conn)
        .create_user("manager", "hash", "Manager", "role-owner")
        .unwrap();
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    // Target user's stale terminal (issued under the old PIN).
    bridge.sessions().write().unwrap().insert(
        "cashier-stale-terminal".into(),
        SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
            "terminal-2".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    // A DIFFERENT user's active session — must survive the rotation.
    bridge.sessions().write().unwrap().insert(
        "manager-token".into(),
        SessionContext::new(
            "user-manager".into(),
            "role-owner".into(),
            "terminal-3".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();

    let st = &ctx;
    // Target's stale session is gone.
    assert!(matches!(
        st.resolve_session("cashier-stale-terminal"),
        Err(BridgeError::InvalidSession)
    ));
    // Caller's session survives (UI reload path).
    assert!(st.resolve_session("owner-token").is_ok());
    // The other user's session is completely untouched.
    assert!(st.resolve_session("manager-token").is_ok());
}

#[tokio::test]
async fn scoped_update_staff_rejects_short_pin() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("12".into()),
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await;
    assert!(matches!(result, Err(BridgeError::Invalid(_))));
}

#[tokio::test]
async fn scoped_list_staff_requires_staff_read() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge = scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = list_staff_scoped("cashier-token".into(), &ctx).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_list_roles_requires_staff_read() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge = scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = list_roles_scoped("cashier-token".into(), &ctx).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_list_roles_carries_each_roles_granted_permission_keys() {
    // The staff screen shows what each role can do — the role listing
    // must carry the granted keys verbatim (Owner = global wildcard,
    // a narrow custom role = its exact grants).
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let roles = list_roles_scoped("owner-token".into(), &ctx).await.unwrap();
    let owner = roles.iter().find(|r| r.id == "role-owner").unwrap();
    assert_eq!(owner.permissions, vec!["*"]);
    let lite = roles.iter().find(|r| r.id == "role-lite").unwrap();
    assert_eq!(lite.permissions, vec!["sales:view"]);
}

#[tokio::test]
async fn scoped_list_staff_lists_global_identity_db() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    let staff = list_staff_scoped("owner-token".into(), &ctx).await.unwrap();
    let names: Vec<&str> = staff.iter().map(|s| s.username.as_str()).collect();
    assert!(names.contains(&"owner"));
    assert!(names.contains(&"cashier"));
}

// ── STAFF-04 — two-store isolation ────────────────────────────────

#[tokio::test]
async fn scoped_staff_commands_use_global_identity_db_for_any_store() {
    // Users/roles are global; store-scoped DBs have no users. A session
    // bound to store B must still resolve the caller from the GLOBAL
    // identity DB (not fail with "user not found" from an empty store
    // DB), and must not observe store A's business data.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    // Pro tier so the staff-creation quota (C1.1) has headroom.
    seed_subscription_tier(&conn, "pro");
    let bridge = TestBridge::new().with_conn(conn);
    for (token, store_id) in [("owner-token-a", "store-a"), ("owner-token-b", "store-b")] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    let ctx = bridge.ctx();

    // Store B's session can create staff (identity + roles are global).
    let created = create_staff_scoped(
        "owner-token-b".into(),
        CreateStaffScopedArgs {
            username: "storeb-cashier".into(),
            pin: "1234".into(),
            display_name: "Store B Cashier".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        &ctx,
    )
    .await;
    // Release: staff.rs:1080 verifies the seeded row signature BEFORE the tier gate
    // and before any write, so this refusal is not the staff-quota answer the
    // fixture is about and there is no DTO to read.
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_seeded_row(&bridge, created, "pro").await;
        return;
    }
    let created = created.unwrap();
    assert_eq!(created.username, "storeb-cashier");

    // Store A's session sees the same global identity set (no cross-store
    // leakage of business data — staff identity is intentionally shared).
    let staff = list_staff_scoped("owner-token-a".into(), &ctx)
        .await
        .unwrap();
    let names: Vec<&str> = staff.iter().map(|s| s.username.as_str()).collect();
    assert!(names.contains(&"storeb-cashier"));
}

// ── BootstrapOwnerArgs ──────────────────────────────────────────────

#[test]
fn bootstrap_owner_args_deserialize() {
    let json = r##"{"username":"owner1","pin":"1234","display_name":"Store Owner"}"##;
    let args: BootstrapOwnerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "owner1");
    assert_eq!(args.pin, "1234");
    assert_eq!(args.display_name, "Store Owner");
}

#[test]
fn bootstrap_owner_args_debug() {
    let args = BootstrapOwnerArgs {
        username: "adm".into(),
        pin: "0000".into(),
        display_name: "Admin".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("adm"));
    assert!(d.contains("Admin"));
}

#[test]
fn bootstrap_owner_result_serialize() {
    let result = BootstrapOwnerResult {
        session: kasirmu_core::auth::LoginSession {
            user_id: "u1".into(),
            display_name: "Owner".into(),
            role_name: "Owner".into(),
            role_id: "role-owner".into(),
            permissions: vec!["*".into()],
        },
        picker_ticket: String::new(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["session"]["user_id"], "u1");
    assert_eq!(json["session"]["role_name"], "Owner");
    assert_eq!(json["session"]["permissions"], serde_json::json!(["*"]));
}

#[test]
fn bootstrap_owner_result_debug() {
    let result = BootstrapOwnerResult {
        session: kasirmu_core::auth::LoginSession {
            user_id: "u2".into(),
            display_name: "Alice".into(),
            role_name: "Owner".into(),
            role_id: "role-owner".into(),
            permissions: vec![],
        },
        picker_ticket: String::new(),
    };
    let d = format!("{result:?}");
    assert!(d.contains("Alice"));
}

// ── BootstrapOwner logic tests ─────────────────────────────────────

use rusqlite::Connection;

fn fresh_conn() -> Connection {
    crate::testing::temp_conn()
}

#[test]
fn bootstrap_owner_creates_user_with_owner_role() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "owner".into(),
        pin: "1234".into(),
        display_name: "Store Owner".into(),
    };

    let result = run_bootstrap_owner(&conn, &args).unwrap();

    assert_eq!(result.session.display_name, "Store Owner");
    assert_eq!(result.session.role_name, "Owner");
    assert_eq!(result.session.role_id, "role-owner");
    assert!(!result.session.user_id.is_empty());

    // Verify directly via Store.
    let store = Store::new(&conn);
    let users = store.list_users().unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].username, "owner");
    assert_eq!(users[0].display_name, "Store Owner");
    assert_eq!(users[0].role_id, "role-owner");
    assert!(users[0].is_active);
}

#[test]
fn bootstrap_owner_rejects_when_users_exist() {
    let conn = fresh_conn();
    // Seed a user directly to simulate existing staff.
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    store
        .create_user("existing", "hash", "Existing", "role-staff")
        .unwrap();

    let args = BootstrapOwnerArgs {
        username: "owner".into(),
        pin: "1234".into(),
        display_name: "Owner".into(),
    };

    let err = run_bootstrap_owner(&conn, &args).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("already exist")));
}

#[test]
fn bootstrap_owner_rejects_empty_username() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "  ".into(),
        pin: "1234".into(),
        display_name: "Owner".into(),
    };

    let err = run_bootstrap_owner(&conn, &args).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("username")));
}

#[test]
fn bootstrap_owner_rejects_empty_display_name() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "owner".into(),
        pin: "1234".into(),
        display_name: "  ".into(),
    };

    let err = run_bootstrap_owner(&conn, &args).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("display_name")));
}

#[test]
fn bootstrap_owner_rejects_short_pin() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "owner".into(),
        pin: "12".into(),
        display_name: "Owner".into(),
    };

    let err = run_bootstrap_owner(&conn, &args).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("pin")));
}

#[test]
fn bootstrap_owner_lowercases_username() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "StoreOwner".into(),
        pin: "1234".into(),
        display_name: "Store Owner".into(),
    };

    let result = run_bootstrap_owner(&conn, &args).unwrap();
    assert_eq!(result.session.display_name, "Store Owner");

    // Username should be lowercased.
    let store = Store::new(&conn);
    let user = store.get_user_by_username("storeowner").unwrap().unwrap();
    assert_eq!(user.display_name, "Store Owner");
}

#[test]
fn bootstrap_owner_session_matches_user() {
    let conn = fresh_conn();
    let args = BootstrapOwnerArgs {
        username: "admin".into(),
        pin: "9999".into(),
        display_name: "Admin".into(),
    };

    let result = run_bootstrap_owner(&conn, &args).unwrap();

    // The returned session user_id should match the created user.
    let store = Store::new(&conn);
    let user = store.get_user(&result.session.user_id).unwrap().unwrap();
    assert_eq!(user.username, "admin");
    assert_eq!(user.display_name, "Admin");

    // The role name should be resolved from the DB.
    let role = store.get_role("role-owner").unwrap().unwrap();
    assert_eq!(result.session.role_id, role.id);
    assert_eq!(result.session.role_name, role.name);
}

#[tokio::test]
async fn update_staff_scoped_allows_manager_updating_staff() {
    // STAFF-02 positive path: the Manager preset grants STAFF_UPDATE.
    // A manager editing a staff member's display name must succeed
    // (the role hierarchy allows it — target is not Owner, not self).
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    );
    let ctx = bridge.ctx();
    let result = update_staff_scoped(
        "manager-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Updated Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        &ctx,
    )
    .await
    .unwrap();
    assert_eq!(result.username, "cashier");
    assert_eq!(result.display_name, "Updated Cashier");
    assert_eq!(result.role_id, "role-lite");
}
// ── Trash: soft delete, 90-day retention ────────────────────────────
//
// Called in the BRIDGE shape (ctx first) rather than through a
// `desktop_shaped` adapter: those adapters exist so the relocated desktop
// call sites read byte-identically, and these commands have no desktop
// predecessor. The shell shims are thin enough to read against the
// signature directly.

/// A second session for a caller other than the one `scoped_state_with_token`
/// seeded, so one caller can be denied what the other is granted.
fn insert_session(bridge: &TestBridge, token: &str, user_id: &str, role_id: &str) {
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
}

/// Put the seeded cashier in the state deletion requires (inactive).
fn deactivate_cashier(conn: &rusqlite::Connection) {
    conn.execute(
        "UPDATE users SET is_active = 0 WHERE id = 'user-cashier'",
        [],
    )
    .unwrap();
}

#[tokio::test]
async fn scoped_delete_staff_requires_staff_delete() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    deactivate_cashier(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    // role-lite carries sales:view only, so the cashier holds no staff:delete.
    insert_session(&bridge, "cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();

    let denied = delete_staff_scoped(&ctx, "user-owner", "cashier-token").await;
    assert!(matches!(denied, Err(BridgeError::PermissionDenied(_))));
    // And nothing moved: a denied command must not have deleted as a side effect.
    assert!(
        list_staff_trash_scoped(&ctx, "owner-token")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn scoped_delete_staff_refuses_a_member_who_is_still_active() {
    // soft_delete_user owns this rule; the command must not paper over it with
    // a friendlier error, and the UI only offers the action on an inactive card
    // for the same reason.
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();

    let err = delete_staff_scoped(&ctx, "user-cashier", "owner-token").await;
    // The typed Validation reaches the wire as a Core error carrying its
    // message, so the words core chose are what a caller can assert against.
    assert!(
        matches!(
            &err,
            Err(BridgeError::Core { message, .. }) if message.contains("deactivate this member")
        ),
        "expected the active-account refusal, got {err:?}"
    );
}

#[tokio::test]
async fn scoped_delete_staff_trashes_the_member_and_ends_their_session() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    deactivate_cashier(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    insert_session(&bridge, "cashier-token", "user-cashier", "role-lite");
    let ctx = bridge.ctx();

    delete_staff_scoped(&ctx, "user-cashier", "owner-token")
        .await
        .unwrap();

    // Off the roster and in the trash, carrying the instant it entered.
    let roster = list_staff_scoped("owner-token".into(), &ctx).await.unwrap();
    assert!(roster.iter().all(|m| m.id != "user-cashier"));
    let trash = list_staff_trash_scoped(&ctx, "owner-token").await.unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, "user-cashier");
    assert!(trash[0].deleted_at.is_some());
    assert!(!trash[0].is_active);

    // resolve_session never re-reads the account, so the eviction — not the
    // deleted_at stamp — is what actually ends the member's access.
    assert!(matches!(
        ctx.resolve_session("cashier-token"),
        Err(BridgeError::InvalidSession)
    ));
    // The caller who did the deleting keeps their own session.
    assert!(ctx.resolve_session("owner-token").is_ok());
}

#[tokio::test]
async fn scoped_restore_staff_returns_them_inactive() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    deactivate_cashier(&conn);
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();
    delete_staff_scoped(&ctx, "user-cashier", "owner-token")
        .await
        .unwrap();

    let restored = restore_staff_scoped(&ctx, "user-cashier", "owner-token")
        .await
        .unwrap();
    // Back on the roster INACTIVE — restoring must not re-grant access.
    assert!(!restored.is_active);
    assert!(restored.deleted_at.is_none());
    let roster = list_staff_scoped("owner-token".into(), &ctx).await.unwrap();
    assert!(roster.iter().any(|m| m.id == "user-cashier"));
    assert!(
        list_staff_trash_scoped(&ctx, "owner-token")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn scoped_role_trash_round_trip_keeps_the_row_restorable() {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    // An authored role nothing references: soft_delete_role refuses a preset id
    // and any role a holder still points at, which is what keeps the trash safe
    // to purge by DELETE.
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-temp', 'Temp', 'throwaway', '[]',
                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge =
        scoped_state_with_token(conn, "owner-token", "user-owner", "role-owner", "store-a");
    let ctx = bridge.ctx();

    crate::staff::delete_role_scoped(&ctx, "role-temp", "owner-token")
        .await
        .unwrap();
    assert!(
        list_roles_scoped("owner-token".into(), &ctx)
            .await
            .unwrap()
            .iter()
            .all(|r| r.id != "role-temp")
    );
    let trash = list_role_trash_scoped(&ctx, "owner-token").await.unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, "role-temp");
    assert!(trash[0].deleted_at.is_some());

    let restored = restore_role_scoped(&ctx, "role-temp", "owner-token")
        .await
        .unwrap();
    assert_eq!(restored.id, "role-temp");
    assert!(restored.deleted_at.is_none());
    assert!(
        list_roles_scoped("owner-token".into(), &ctx)
            .await
            .unwrap()
            .iter()
            .any(|r| r.id == "role-temp")
    );
}
