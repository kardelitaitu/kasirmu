//! The staff and role trash: soft delete, restore, and the two listing reads.
//!
//! All five commands are owner-gated and operate on the global identity DB.
//!
//! Invariant: the 90-day retention window has NO scheduler. Each trash read
//! runs its own purge sweep before it lists, so a window closes the next time
//! anyone looks - and a row past its deadline can never be read or restored as
//! if it still had time left. Both clocks read `TRASH_RETENTION_DAYS` in core.

use kasirmu_core::db::Store;
use kasirmu_core::db::audit_security::{
    SECURITY_ACTION_USER_UPDATE, SECURITY_REASON_ACCOUNT_DELETED, SECURITY_REASON_ACCOUNT_RESTORED,
    SecurityEvent,
};
use kasirmu_core::permissions;

use crate::auth::record_security_event;
use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::{
    RoleDto, StaffMemberDto, invalidate_user_sessions_except, require_permission_for_user,
    role_dto, to_staff_dto,
};

// The 90-day retention window has no scheduler. Each trash read runs its own
// purge sweep before it lists, so a window closes the next time anyone looks —
// and a row past its deadline can never be read or restored as if it still had
// time left. Both clocks read `TRASH_RETENTION_DAYS` in core.

/// Move a staff member to the trash (the soft delete, 90-day window).
///
/// Deletion is owner-only (`staff:delete`) and requires an account that is
/// already INACTIVE — `Store::soft_delete_user` enforces that itself, so the
/// rule holds for every caller and not only this one. A member cannot delete
/// themselves in passing either: the sweep refuses active rows and a caller
/// holding a session is active by definition.
///
/// Every in-memory session of the member is dropped. This closes the gap to
/// zero on THIS host: `BridgeCtx::resolve_session` also re-reads the account,
/// but only once per its 30s revalidation window, so revalidation alone would
/// leave a member working for up to that window. The eviction ends their access
/// here at once; the window is what covers the other hosts sharing this
/// identity DB.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:delete`;
/// [`BridgeError::NotFound`] for an unknown id; [`BridgeError::Core`] on store
/// errors, including the active-account and already-trashed refusals.
pub async fn delete_staff_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_DELETE)?;
    let user = store.soft_delete_user(id)?;
    // Recorded after the row is trashed, exactly as `create_staff_scoped`
    // records its event after the account exists: `soft_delete_user` commits
    // its own transaction, so there is no outer transaction to join. A failure
    // here can lose the trail but can never resurrect the member.
    record_security_event(
        &store,
        &SecurityEvent::staff_change(
            &session.user_id,
            &user.id,
            &user.username,
            SECURITY_ACTION_USER_UPDATE,
            SECURITY_REASON_ACCOUNT_DELETED,
        ),
    );
    drop(db);

    // Keep no token: the point of the eviction is that NOBODY stays logged in
    // as the deleted member.
    invalidate_user_sessions_except(ctx, &user.id, "", SECURITY_REASON_ACCOUNT_DELETED);
    Ok(())
}

/// Take a staff member back out of the trash.
///
/// They come back INACTIVE, exactly as the delete found them (core owns that
/// invariant), so a restore is not a back door to re-granting access —
/// reactivating is the separate, audited step.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:delete`;
/// [`BridgeError::NotFound`] when no such member sits in the trash (a purged
/// tombstone included); [`BridgeError::Core`] on store errors.
pub async fn restore_staff_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<StaffMemberDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_DELETE)?;
    let user = store.restore_user(id)?;
    record_security_event(
        &store,
        &SecurityEvent::staff_change(
            &session.user_id,
            &user.id,
            &user.username,
            SECURITY_ACTION_USER_UPDATE,
            SECURITY_REASON_ACCOUNT_RESTORED,
        ),
    );
    let roles = store.list_roles()?;
    let profile = store.get_user_profile(&user.id).ok().flatten();
    let assignment = store.assignment_for_user(&user.id).ok().flatten();
    let dto = to_staff_dto(&user, &roles, profile.as_ref(), assignment.as_ref());
    drop(db);
    Ok(dto)
}

/// The staff trash, newest first.
///
/// Gated on `staff:delete` rather than `staff:read`, unlike the roster: a deleted
/// identity is still an identity, and a manager who cannot delete anyone has no
/// business reading the names of the people who were. Owner-only by preset, so
/// the same key that admits a delete admits its undo.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:delete`;
/// [`BridgeError::Core`] on store errors.
pub async fn list_staff_trash_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<StaffMemberDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_DELETE)?;
    // The retention sweep rides the read: opening the trash is what closes the
    // windows that have expired, so a stale row is never listed as restorable
    // after its deadline.
    store.purge_expired_users()?;
    let roles = store.list_roles()?;
    let dtos = store
        .list_trashed_users()?
        .iter()
        .map(|entry| {
            let profile = store.get_user_profile(&entry.user.id).ok().flatten();
            let assignment = store.assignment_for_user(&entry.user.id).ok().flatten();
            let mut dto = to_staff_dto(&entry.user, &roles, profile.as_ref(), assignment.as_ref());
            dto.deleted_at = Some(entry.deleted_at.clone());
            dto
        })
        .collect();
    drop(db);
    Ok(dtos)
}

/// Take a custom role back out of the trash.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:manage_roles`;
/// [`BridgeError::NotFound`] when no such role sits in the trash;
/// [`BridgeError::Core`] on store errors.
pub async fn restore_role_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<RoleDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_MANAGE_ROLES)
        .await?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let role = store.restore_role(id)?;
    let dto = role_dto(&store, role)?;
    drop(db);
    Ok(dto)
}

/// The role trash, newest first.
///
/// Unlike the staff half this window really deletes at the end of it, which is
/// safe for a role and only for a role: it carries no personal data, and core
/// trashed it only after proving nothing references it (`purge_expired_roles`
/// re-checks inside its own transaction).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:manage_roles`;
/// [`BridgeError::Core`] on store errors.
pub async fn list_role_trash_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<RoleDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_MANAGE_ROLES)
        .await?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store.purge_expired_roles()?;
    let dtos = store
        .list_trashed_roles()?
        .iter()
        .map(|entry| {
            let mut dto = role_dto(&store, entry.role.clone())?;
            dto.deleted_at = Some(entry.deleted_at.clone());
            Ok(dto)
        })
        .collect::<Result<Vec<_>, BridgeError>>()?;
    drop(db);
    Ok(dtos)
}
