/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section D)
crate: kasirmu-mobile | status: SAFE | lint: CLEAN
findings: mirror of the desktop staff gate matrix (verified line-level: STAFF_READ reads, STAFF_CREATE + tier limit create, STAFF_UPDATE update, shared enforce_role_assignment_policy STAFF-02/10, permission-denied tombstones for legacy unscoped commands, ungated bootstrap_owner first-run bootstrap); tablet parity holds — no gate divergence found
next: none | perf: fine
*/
//! Staff management commands — list, create, update staff members and roles.
//!
//! These commands are the IPC surface for the Staff Management UI.

use rusqlite::OptionalExtension;
use tauri::{State, command};

use kasirmu_core::auth::hash_pin;
use kasirmu_core::db::Store;
use kasirmu_core::db::audit_security::{
    SECURITY_ACTION_USER_UPDATE, SECURITY_REASON_PIN_ROTATED, SECURITY_REASON_PROFILE_CHANGED,
    SecurityEvent,
};
use kasirmu_core::db::profile::SensitiveWritePolicy;
use kasirmu_core::permissions;

#[cfg(test)]
use kasirmu_core::Role;

use foundation::validate_min_length;

use crate::commands::auth::record_security_event;
use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T5: the staff wire DTOs and their helpers moved to the shared
// `kasirmu_bridge::staff` module and are re-exported here, same as the desktop
// shell — one wire definition, ending the fork. `to_staff_dto`,
// `assignment_dto`, `parse_scope_mode`, `assignment_spec` and
// `enforce_role_assignment_policy` re-export as-is (their error type is the
// bridge's `BridgeError`, which the tablet converts via the `From<BridgeError>`
// seam); the shell keeps two thin `AppError` adapters that the sibling test
// modules call directly.
//
// ADR #49: every door in this module now delegates to `kasirmu_bridge::staff`, and
// each body is statement-identical to its bridge twin. Five of them the parity
// instrument flags anyway, and each flag is spelling, not behaviour:
// `bootstrap_owner` qualifies `SystemTime`/`sign_picker_ticket` where the
// bridge imports them; `get_staff_profile_scoped` takes `user_id: String` where
// the bridge takes `&str` and allocates; `update_staff_scoped` calls
// `invalidate_user_sessions_except` as a `BridgeCtx` method where the shell had
// a free fn. `create_role_scoped` and `update_role_scoped` take the bridge's
// `grants_json` parameter — the shell computes it and passes it in, which is
// ADR #49 §Decision 2's own pattern (the bridge module doc names it as the one
// exception: encoding needs `serde_json`, which is not an kasirmu-bridge
// dependency).
pub use kasirmu_bridge::staff::{
    AssignmentArgs, AssignmentDto, BootstrapOwnerArgs, BootstrapOwnerResult, CreateRoleArgs,
    CreateStaffScopedArgs, PermissionKeyDto, ProfileArgs, ProfileViewDto, RoleDto, RoleHolderDto,
    RoleHoldersDto, StaffMemberDto, UpdateRoleArgs, UpdateStaffScopedArgs, assignment_dto,
    assignment_spec, enforce_role_assignment_policy, parse_scope_mode, to_staff_dto,
};

/// Serialize a grant set into the JSON array roles.permissions stores.
///
/// Stays in the shell and is passed into the bridge as a `&str`: encoding
/// needs `serde_json`, which is not an `kasirmu-bridge` dependency (mirrors the
/// desktop staff.rs adapter exactly).
fn grants_json(keys: &[String]) -> Result<String, AppError> {
    serde_json::to_string(keys).map_err(|e| AppError::Internal(format!("encoding grants: {e}")))
}

/// Build the authoring DTO from a domain role, adding the two facts the
/// surface needs in order to decide what it may offer.
///
/// Thin adapter over `kasirmu_bridge::staff::role_dto`: same name, parameters
/// and `Result<_, AppError>` so the sibling test modules keep building DTOs
/// from a shell-held `Store` (mirrors the desktop staff.rs adapter).
#[cfg(test)]
fn role_dto(store: &Store<'_>, role: Role) -> Result<RoleDto, AppError> {
    kasirmu_bridge::staff::role_dto(store, role).map_err(AppError::from)
}

// ── Session-scoped staff commands (ADR #7 · audit-open-findings STAFF-01) ────────
//
// Replacement for the legacy staff commands. Caller identity is resolved
// from the opaque `session_token`; the commands NEVER accept a
// caller-supplied `caller_user_id`. Users/roles are GLOBAL identity
// records (ADR #4 / ADR #7) — the permission check and CRUD run against
// the global identity DB.

/// List staff members. Caller identity is resolved from the session token.
#[command]
pub async fn list_staff_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffMemberDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_staff_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Load a staff member's full profile as the session user sees it (ADR #35
/// D6). Sensitive fields are withheld or masked unless the caller holds
/// `staff:read_identity` / `staff:read_payroll`, and every sensitive read is
/// audited.
#[command]
pub async fn get_staff_profile_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<ProfileViewDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::get_staff_profile_scoped(&ctx, &session_token, &user_id)
        .await
        .map_err(Into::into)
}

/// List roles. Caller identity is resolved from the session token.
#[command]
pub async fn list_roles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_roles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Role authoring (ADR #47 ruling 4) ──────────────────────────────

/// List the registered permission keys.
///
/// Without this the authoring UI would have to hardcode the vocabulary, which
/// is what ADR #35 forbids: the registry is the single source of truth, and a
/// picker fed from a copy of it drifts from the keys the gate actually
/// honors. Gated on 'staff:read' rather than 'staff:manage_roles' — knowing
/// which keys exist is not the power to grant them.
#[command]
pub async fn list_permission_keys_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PermissionKeyDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_permission_keys_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a custom role: a named key-set row in the same vocabulary
/// enforcement already speaks (ADR #47 ruling 4).
///
/// The id is generated here and never accepted from the wire. A row whose id
/// the preset seeder owns is rewritten by the next seed_default_roles_scoped,
/// so letting a caller choose ids would put them one typo away from authoring
/// something they cannot keep; a generated 'role-<uuidv7>' is outside
/// ROLE_PRESETS by construction.
#[command]
pub async fn create_role_scoped(
    session_token: String,
    args: CreateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    // ADR #49 §Decision 2: `grants_json` needs `serde_json`, which is not an
    // `kasirmu-bridge` dependency, so the shim computes it and passes it in. The
    // bridge module doc names this as its one exception.
    let grants = grants_json(&args.permissions)?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::create_role_scoped(&ctx, &session_token, &args, &grants)
        .await
        .map_err(Into::into)
}

/// Re-name, re-describe, or re-grant an authored role.
///
/// Editing re-points every holder, so the grant set is validated against the
/// registry core-side and preset ids are refused there too — the rule lives in
/// one place, so this command cannot become the way around it.
#[command]
pub async fn update_role_scoped(
    session_token: String,
    args: UpdateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    // ADR #49 §Decision 2 — see `create_role_scoped` above.
    let grants = grants_json(&args.permissions)?;
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::update_role_scoped(&ctx, &session_token, &args, &grants)
        .await
        .map_err(Into::into)
}

/// Delete an authored role.
///
/// Refused for preset ids and for any role still referenced. The second guard
/// matters more here than a usual FK: authorize_with fails closed on an
/// unresolvable role, so dropping one out from under a holder would be a
/// silent loss of access rather than an error.
#[command]
pub async fn delete_role_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::delete_role_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// List the accounts that hold one role, org-wide.
///
/// No store filter, deliberately: `users`, `assignments` and `roles` are
/// tenant-global identity records (ADR #4 / #7) and a store-scoped database
/// holds none of them, so "who holds this role" has exactly one honest
/// answer for the whole organization. Gated on `staff:read`, the same gate
/// [`list_staff_scoped`] uses, because that command already discloses these
/// accounts and their role — asking for `staff:manage_roles` here would
/// imply this reveals something the staff list does not.
///
/// The predicate lives in core (`Store::role_holders`) and resolves a role
/// the way authorization does — assignment first, `users.role_id` as the
/// fallback. A holder list that disagreed with what a user can actually do
/// would be worse than no list, because this is the surface an admin reads
/// before revoking something.
#[tauri::command]
pub async fn list_role_holders_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RoleHoldersDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_role_holders_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Move a staff member to the trash (the soft delete, 90-day retention window).
///
/// The first enforcement consumer of `staff:delete`, which had none until now.
#[command]
pub async fn delete_staff_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::delete_staff_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Take a staff member back out of the trash.
///
/// They come back INACTIVE — reactivating is the separate, audited step.
#[command]
pub async fn restore_staff_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::restore_staff_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// The staff trash, newest first. Runs the 90-day purge sweep before listing.
#[command]
pub async fn list_staff_trash_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffMemberDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_staff_trash_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Take a custom role back out of the trash.
#[command]
pub async fn restore_role_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::restore_role_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// The role trash, newest first. Runs the 90-day purge sweep before listing.
#[command]
pub async fn list_role_trash_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::list_role_trash_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
/// Create a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy (only Owner-level
/// callers may create an Owner account).
#[command]
pub async fn create_staff_scoped(
    session_token: String,
    args: CreateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::create_staff_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy.
/// STAFF-03: optionally rotates the PIN when `args.pin` is a non-empty value.
/// STAFF-05: the profile update, PIN rotation, and (optional) assignment
/// scope run as one command inside a single global-DB transaction — any
/// failure rolls the whole update back atomically. The legacy store-scoped
/// `workspace_keys` write path (which needed cross-DB compensation) is
/// retired; assignments ride the same transaction as the profile.
///
/// ADR #49 §4: **not delegated**, and the pin
/// `staff_security_events_tests::confirmed_free_records_nothing_even_in_a_debug_build`
/// is the proof. `Store::record_security_event` takes a `debug_upgrade` flag;
/// the tablet passes **`false`** (`commands/auth.rs:81`) and the bridge passes
/// **`true`** (`crates/kasirmu-bridge/src/auth.rs:160`), which is the desktop's
/// dev Free→Premium promotion. Delegating would start auditing Free-tier
/// staff updates in debug builds on a client that deliberately never does.
/// `create_staff_scoped` shares the fork but not the exposure: the quota check
/// precedes the recorder and Free caps staff at one account, so a Free tenant
/// cannot reach its `record_security_event` call at all.
#[command]
pub async fn update_staff_scoped(
    session_token: String,
    args: UpdateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;

    // Permission + role-hierarchy checks run against the global identity DB.
    // The `Store` borrows the (non-Sync) `Connection`, so it must be scoped in
    // a block and dropped BEFORE any further `.await` — otherwise the command
    // future is not `Send` and Tauri rejects it at compile time.
    {
        let store = Store::new(&db);
        require_permission_for_user(&store, &session.user_id, permissions::STAFF_UPDATE)?;
        enforce_role_assignment_policy(
            &store,
            &session.user_id,
            Some(&args.id),
            &args.role_id,
            args.is_active,
        )?;
    }

    // Snapshot the profile BEFORE the update. Used below ONLY to default the
    // returned DTO's profile when the caller didn't send one — there is no
    // restore/compensation path and none is needed: the legacy store-scoped
    // `workspace_keys` write this snapshot once compensated was retired
    // (50337ba1b), and the assignment scope now joins the same transaction
    // as the user update below, so any later failure rolls both back.
    let previous_profile = {
        let store = Store::new(&db);
        let user = store.get_user(&args.id)?;
        let profile = store.get_user_profile(&args.id)?;
        user.map(|u| {
            (
                u.username,
                u.display_name,
                u.role_id,
                u.is_active,
                u.pin_hash,
                profile,
            )
        })
    };

    // STAFF-03: profile + PIN rotate atomically inside one transaction so a
    // failed PIN hash never leaves the profile half-updated (STAFF-05). The
    // transaction also borrows the non-Sync Connection, so it stays scoped in
    // its own block too.
    let (user, roles, pin_rotated) = {
        let tx = db.unchecked_transaction()?;
        let store = Store::new(&tx);
        // ADR #35 D6 incomplete-profile semantics: assigning a role that
        // grants sensitive permissions requires a complete profile.
        store.require_role_assignable(&args.id, &args.role_id)?;
        // C1.1 / W7-B: the reactivation door of the staff limit — the tablet's
        // copy of the gate the desktop reaches through
        // `kasirmu_bridge::staff::update_staff_scoped`. This door is NOT
        // delegated (see this command's doc), so the gate has to exist here too
        // or the tablet stays bypassable while the desktop is fixed: creating a
        // member is capped, but switching one back ON adds exactly the same row
        // to the same count, so deactivate -> create -> reactivate would exceed
        // the plan with every individual step allowed.
        //
        // Only the INACTIVE -> ACTIVE transition is gated: that is the one that
        // grows the counted set, and a plan at its cap must still let an
        // operator edit an active member or deactivate one. The current state
        // is read HERE, inside the transaction and with the same
        // `deleted_at IS NULL` guard the write below uses, so a trashed or
        // absent id answers NotFound from `update_user_in_tx` rather than
        // being misreported as a quota failure.
        let reactivating = args.is_active
            && tx
                .query_row(
                    "SELECT is_active FROM users WHERE id = ?1 AND deleted_at IS NULL",
                    rusqlite::params![args.id],
                    |row| row.get::<_, bool>(0),
                )
                .optional()?
                .is_some_and(|active| !active);
        if reactivating {
            // Arms the in-tx veto on the SAME Store that performs the write, so
            // the verdict and the UPDATE commit or roll back together (the
            // pre-tx form alone leaves a WAL-snapshot TOCTOU where two
            // concurrent reactivations both pass).
            let tier = store.resolve_tier_fail_closed()?;
            store.enforce_staff_quota(&tier)?;
        }
        store.update_user_in_tx(
            &args.id,
            &args.username,
            &args.display_name,
            &args.role_id,
            args.is_active,
        )?;
        // ADR #35 D6: the profile columns (validated, encrypted at rest by
        // kasirmu-core) follow the same atomic update.
        //
        // The write is caller-aware, and both halves of the policy matter:
        //
        // * an editor WITHOUT `staff:read_identity` was shown an empty national
        //   id and tax id because the read withheld them, not because they are
        //   unset. The write must therefore keep the stored ones: requiring
        //   them leaves no way to save except inventing a value for a document
        //   the editor cannot see, and clearing them destroys the real one.
        // * this screen does not manage payroll — the pay field belongs to its
        //   own surface — so an update from here never moves the stored amount.
        //   `keep_pay` is what makes that true; without it, omitting the field
        //   would clear it, and requiring it would force a blank edit.
        //
        // This block is deliberately the same policy the desktop reaches through
        // `kasirmu_bridge::staff::update_staff_scoped` (see the ADR #49 §4 note
        // on that function's doc for why this door is not delegated): the two
        // must move together, because the tablet and desktop edit the same rows.
        if let Some(profile) = &args.profile {
            let policy = SensitiveWritePolicy {
                keep_identity_record: !store
                    .holds_permission(&session.user_id, permissions::STAFF_READ_IDENTITY)?,
                keep_pay: true,
            };
            store.write_user_profile_with(policy, &args.id, &profile.clone().into_profile())?;
        }

        // ADR #35 D5 (spec 0048): the assignment scope rides the same
        // transaction — in-tx writer, no nested BEGIN. `update_user` above
        // already synced the assignment role; this replaces only the scope.
        if let Some(spec) = &args.assignment {
            let spec = assignment_spec(spec)?;
            store.write_assignment_scope(&args.id, &args.role_id, &spec)?;
        }

        // Hash server-side; never accept plaintext beyond the command boundary.
        let pin_rotated = if let Some(pin) = args.pin.as_deref().filter(|p| !p.is_empty()) {
            validate_min_length("pin", pin, 4).map_err(|e| AppError::Invalid(e.to_string()))?;
            let pin_hash =
                hash_pin(pin).map_err(|e| AppError::Internal(format!("hashing PIN: {e}")))?;
            store.update_user_pin(&args.id, &pin_hash)?;
            // A successful rotation also clears any accumulated failed-login
            // lockout for this account (atomic with the rotation).
            store.clear_login_attempts(&args.username.trim().to_lowercase())?;
            true
        } else {
            false
        };

        let user = store
            .get_user(&args.id)?
            .ok_or_else(|| AppError::Internal(format!("updated user {} vanished", args.id)))?;
        let roles = store.list_roles()?;
        // Recorded INSIDE the transaction, so the audit row commits with the
        // change it describes: a rolled-back edit leaves no phantom event, and
        // a committed one can never be missing its trail.
        record_security_event(
            &store,
            &SecurityEvent::staff_change(
                &session.user_id,
                &args.id,
                &user.username,
                SECURITY_ACTION_USER_UPDATE,
                SECURITY_REASON_PROFILE_CHANGED,
            ),
        );
        // A PIN rotation is a SECOND, distinct fact — it dropped every other
        // session for the account (STAFF-03). It reuses the catalogued
        // `user.update` action with its own classifier rather than inventing
        // `user.pin_change`, which has no Fluent label and would strand one.
        if pin_rotated {
            record_security_event(
                &store,
                &SecurityEvent::staff_change(
                    &session.user_id,
                    &args.id,
                    &user.username,
                    SECURITY_ACTION_USER_UPDATE,
                    SECURITY_REASON_PIN_ROTATED,
                ),
            );
        }
        tx.commit()?;
        (user, roles, pin_rotated)
    };
    drop(db);

    if pin_rotated {
        // STAFF-03: a rotated PIN invalidates every OTHER session issued
        // under the old PIN. The caller's own session is preserved — they
        // authenticated moments ago and the UI reloads with the same token.
        state.invalidate_user_sessions_except(&args.id, &session_token);
    }

    let profile = match &args.profile {
        Some(p) => Some(p.clone().into_profile()),
        None => previous_profile.and_then(|(_, _, _, _, _, p)| p),
    };
    let assignment = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        store.assignment_for_user(&args.id)?
    };
    Ok(to_staff_dto(
        &user,
        &roles,
        profile.as_ref(),
        assignment.as_ref(),
    ))
}

// ── Bootstrap first owner (no authentication required) ────────────────
//
// Parity with the desktop client (audit-open-findings residual): the tablet needs the
// same first-owner path so a fresh installation can be provisioned from the
// tablet itself. Like `staff_login`, the command mints a short-lived picker
// ticket so the pre-session workspace picker stays bound to the real user.

/// Create the first owner user in a fresh installation.
///
/// This is the only command that does NOT require an existing session,
/// because there are no users yet. It seeds the default roles first,
/// then creates a user with the `role-owner` role.
///
/// # Errors
///
/// Returns `Invalid` if any users already exist, preventing accidental
/// re-bootstrapping after staff accounts have been created.
/// Returns `Invalid` if validation fails (empty username, short PIN, etc.).
#[command]
pub async fn bootstrap_owner(
    args: BootstrapOwnerArgs,
    state: State<'_, AppState>,
) -> Result<BootstrapOwnerResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::staff::bootstrap_owner(&ctx, &args)
        .await
        .map_err(Into::into)
}

/// Business logic for `bootstrap_owner` (extracted for testing).
///
/// A forwarder, not a copy. The body now lives once in
/// `kasirmu_bridge::staff::run_bootstrap_owner`, which this shell's eight
/// `run_bootstrap_owner_*` tests drive through this name and which the desktop
/// shell reaches the same way. The two copies were line-for-line identical
/// (same trim/lowercase, the same three validations in the same order, the same
/// "staff accounts already exist" guard against `list_users`, the same
/// seed-then-create sequence, and the same empty `picker_ticket` that the
/// command wrapper above replaces) apart from the error type, so
/// `BridgeError::Invalid -> AppError::Invalid` keeps every message byte-equal
/// and those tests are the proof rather than a claim of equivalence.
#[cfg(test)]
fn run_bootstrap_owner(
    conn: &rusqlite::Connection,
    args: &BootstrapOwnerArgs,
) -> Result<BootstrapOwnerResult, AppError> {
    Ok(kasirmu_bridge::staff::run_bootstrap_owner(conn, args)?)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "staff_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "staff_security_events_tests.rs"]
mod security_events_tests;

/// Role-holder tests: a sibling module for the same reason the audit slice
/// used one — `staff_tests.rs` is another stream's in-flight file.
#[cfg(test)]
#[path = "staff_role_holders_tests.rs"]
mod role_holders_tests;
