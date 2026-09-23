//! Command-level tests for the C8 S5a restore IPC surface
//! (`apps/desktop-tauri/src/commands/data.rs`).
//!
//! The three wrappers are what make the restore feature reachable from the
//! app at all: before S5a, `list_restore_candidates` / `restore_prepare` /
//! `restore_status` were registered nowhere, so only the CLI could restore
//! (runbook §11.2). These tests pin the GATE, which is the part of the slice
//! that is not just plumbing: `restore_prepare` writes the request file the
//! boot consumer promotes, so it must require `SETTINGS_EDIT` rather than
//! trust the renderer.
//!
//! The bridge's own body is tested in `crates/kasirmu-bridge/src/data_tests.rs`
//! and is not re-tested here — these assert the wrapper's gate and the
//! read/write permission split, driven through the real `#[tauri::command]`
//! functions.

use super::*;
use kasirmu_core::migrations;
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;
use tauri::Manager as _;

/// A state whose global identity DB has roles seeded and one user per role.
///
/// The two roles are the DISCRIMINATOR: `role-owner` carries `*` (so it holds
/// `SETTINGS_EDIT`), while `role-auditor` is the read-only preset that grants
/// `SETTINGS_READ` but deliberately NOT `SETTINGS_EDIT`. That is exactly the
/// asymmetry these tests must separate — being able to see that a restore is
/// pending must not confer the right to request one. Both are real
/// `ROLE_PRESETS` rows, so `users.role_id` satisfies its FK.
fn state_with_users() -> (AppState, String, String) {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute_batch(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                ('user-auditor', 'auditor', 'hash', 'Auditor', 'role-auditor', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        )
        .unwrap();
    }
    (
        AppState::for_test_with_conn(conn),
        "user-owner".into(),
        "user-auditor".into(),
    )
}

/// Mint a session for `user_id` on `state` and return its token.
fn session_for(state: &AppState, user_id: &str, role_id: &str) -> String {
    let token = format!("token-{user_id}");
    let mut sessions = state.session_store.write().unwrap();
    sessions.insert(
        token.clone(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            format!("term-{user_id}"),
            "store-1".into(),
            "inst-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
    token
}

// ── restore_prepare: the write door ──────────────────────────────

/// A session WITHOUT `SETTINGS_EDIT` is refused. This is the discriminating
/// case: the command writes the file that replaces the database on the next
/// boot, so a cashier must not reach it.
#[tokio::test]
async fn restore_prepare_refuses_a_session_without_settings_edit() {
    let (state, _owner, auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();
    let token = session_for(st.inner(), &auditor, "role-auditor");

    let err = restore_prepare(
        token,
        RestorePrepareArgs {
            candidate_path: "/tmp/whatever.db".into(),
            confirm_store_name: "whatever".into(),
        },
        st,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, AppError::PermissionDenied(_)),
        "a session without SETTINGS_EDIT must be refused at the wrapper, got {err:?}"
    );
}

/// A session that DOES carry `SETTINGS_EDIT` passes the gate and reaches the
/// bridge body. The candidate is bogus, so the bridge refuses it on its own
/// merits — which is the proof the gate let the call through rather than
/// short-circuiting on the permission.
#[tokio::test]
async fn restore_prepare_admits_a_session_with_settings_edit() {
    let (state, owner, _auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();
    let token = session_for(st.inner(), &owner, "role-owner");

    let err = restore_prepare(
        token,
        RestorePrepareArgs {
            candidate_path: "/tmp/does-not-exist.db".into(),
            confirm_store_name: "whatever".into(),
        },
        st,
    )
    .await
    .unwrap_err();
    assert!(
        !matches!(err, AppError::PermissionDenied(_)),
        "the owner carries SETTINGS_EDIT and must clear the wrapper gate, got {err:?}"
    );
}

// ── the two reads: SETTINGS_READ, never SETTINGS_EDIT ────────────

/// `restore_status` is refused without a session at all — it is registered, so
/// it is a renderer-reachable door and must not be open.
#[tokio::test]
async fn restore_status_refuses_an_unknown_session() {
    let (state, _owner, _auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();

    let err = restore_status("no-such-token".into(), st)
        .await
        .unwrap_err();
    assert!(
        matches!(err, AppError::InvalidSession),
        "an unauthenticated call must be refused, got {err:?}"
    );
}

/// The read commands are gated on `SETTINGS_READ`, which the narrow cashier
/// role holds — so the READ half works for a session that must NOT be able to
/// request a restore. That asymmetry is the point of the split.
#[tokio::test]
async fn restore_status_is_readable_without_the_write_permission() {
    let (state, _owner, auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();
    let token = session_for(st.inner(), &auditor, "role-auditor");

    // The cashier must NOT hold the write permission — asserted through the
    // SAME gate the wrapper uses, so the fixture's meaning is the gate's.
    let session = st.inner().resolve_session(&token).unwrap();
    assert!(
        require_permission_for_session(st.inner(), &session, permissions::SETTINGS_EDIT)
            .await
            .is_err(),
        "the fixture is only meaningful if this session lacks SETTINGS_EDIT"
    );

    // ...and must still be able to READ whether a restore is pending.
    let status = restore_status(token, st).await.unwrap();
    assert!(!status.pending, "no request file exists in a fresh state");
}

/// `list_restore_candidates` is gated the same way and returns the generations
/// it finds. A fresh state has none, and the read must still succeed — an
/// empty list is a legitimate answer, not an error.
#[tokio::test]
async fn list_restore_candidates_is_reachable_and_reports_none() {
    let (state, owner, _auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();
    let token = session_for(st.inner(), &owner, "role-owner");

    let listed = list_restore_candidates(token, st).await.unwrap();
    assert!(
        listed.candidates.is_empty(),
        "a fresh install has no backup generations, got {:?}",
        listed.candidates
    );
}

/// `list_restore_candidates` refuses an unknown session too — both reads are
/// doors, and neither is ungated.
#[tokio::test]
async fn list_restore_candidates_refuses_an_unknown_session() {
    let (state, _owner, _auditor) = state_with_users();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let st = app.state::<AppState>();

    let err = list_restore_candidates("no-such-token".into(), st)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidSession), "got {err:?}");
}
