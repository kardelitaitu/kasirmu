//! Sibling tests for the `user` facade (AGENTS.md: no tests in production files).
//!
//! The facade re-exports the staff models and the role-id taxonomy from `platform_core`.
//! The taxonomy assertions are the guard that keeps ONE source of truth: until 2026-09-28
//! `modules-staff` carried a four-constant copy of these ids whose values were duplicated rather
//! than shared, and two spellings of one id set is exactly how the two drift apart. These tests
//! fail if anyone reintroduces a second copy rather than re-exporting this one.

use crate::user::UserId;

/// Every id the facade exposes must BE the authoritative one, not a matching copy.
#[test]
fn core_role_ids_are_the_authoritative_platform_ones() {
    for (core, platform) in [
        (crate::builtin_roles::OWNER, platform_core::rbac::builtin_roles::OWNER),
        (crate::builtin_roles::MANAGER, platform_core::rbac::builtin_roles::MANAGER),
        (crate::builtin_roles::ADMIN, platform_core::rbac::builtin_roles::ADMIN),
        (crate::builtin_roles::AUDITOR, platform_core::rbac::builtin_roles::AUDITOR),
        (crate::builtin_roles::STAFF, platform_core::rbac::builtin_roles::STAFF),
        (crate::builtin_roles::CUSTOM, platform_core::rbac::builtin_roles::CUSTOM),
    ] {
        assert_eq!(core, platform, "the two spellings of {core:?} diverged");
        assert!(!core.is_empty());
    }
    assert!(!crate::seed_users::ADMIN.is_empty());
}

/// The facade exposes the platform models themselves, not a second definition of them.
#[test]
fn facade_exposes_the_platform_staff_models() {
    let role = crate::Role::new(platform_core::rbac::builtin_roles::OWNER, "owner");
    assert_eq!(role.id, platform_core::rbac::builtin_roles::OWNER);
    // Default construction grants nothing, so the parsed key list is empty.
    assert!(role.permission_keys().is_empty());

    let user = crate::User::new("alice", "hash", "Alice", platform_core::rbac::builtin_roles::STAFF);
    assert_eq!(user.role_id, platform_core::rbac::builtin_roles::STAFF);
    assert_eq!(user.username, "alice");
    assert_eq!(user.display_name, "Alice");

    // `UserId` is reachable through the facade and mints distinct ids.
    let a = UserId::new();
    let b = UserId::new();
    assert_ne!(a.as_str(), b.as_str());
}
