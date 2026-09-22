//! Session account revalidation tests (R4).
//!
//! Pins the residual closed in [\`crate::ctx\`]: a token whose account row is
//! trashed or deactivated by ANOTHER PROCESS against the same identity DB must
//! stop resolving within a bounded window. The in-process eviction in
//! \`staff::delete_staff_scoped\` cannot reach that case — it only touches the
//! session map of the host that ran the delete — so only the periodic re-read
//! can catch it.
//!
//! Mounted at the foot of \`ctx.rs\` with \`#[cfg(test)] #[path]\`, so
//! \`use super::*\` reaches [\`BridgeCtx::resolve_session\`], [\`BridgeError\`] and the
//! thread-local window override directly.
use super::*;
use crate::testing::TestBridge;

/// Seed a LIVE owner row (and the roles it points at) into the identity DB.
fn seed_live_owner(conn: &rusqlite::Connection) {
    Store::new(conn).seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1,
                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// A bridge whose identity DB holds one live owner and whose session map holds
/// one token for that owner.
fn bridge_with_owner_session() -> TestBridge {
    let conn = crate::testing::temp_conn();
    seed_live_owner(&conn);
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        "owner-token".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
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

/// Restores the thread-local window even if an assertion panics mid-test.
struct WindowGuard(Option<Duration>);

impl Drop for WindowGuard {
    fn drop(&mut self) {
        set_revalidation_window_for_test(self.0);
    }
}

/// Drive one revoke-detection cycle: start the window on the first resolve,
/// mutate the account row out from under the running process, prove the token
/// still resolves INSIDE the window, then prove it stops once the window has
/// elapsed.
async fn assert_account_change_revokes_within_the_window(ctx: &BridgeCtx<'_>, change: &str) {
    // A long window: the first resolve only stamps the token, and the second
    // resolve below must fall inside it.
    let _guard = WindowGuard(set_revalidation_window_for_test(Some(Duration::from_secs(
        3600,
    ))));
    assert!(ctx.resolve_session("owner-token").is_ok());

    {
        let db = ctx.lock_global().await;
        db.execute(change, []).unwrap();
    }

    // INSIDE the window the token still resolves. That is the bounded lag this
    // design deliberately trades for a query-free hot path; the single-instance
    // desktop closes it to zero through its shared in-process eviction.
    assert!(
        ctx.resolve_session("owner-token").is_ok(),
        "a change inside the revalidation window must not have been noticed yet"
    );

    // Window elapsed: the re-read runs and revokes.
    set_revalidation_window_for_test(Some(Duration::ZERO));
    assert!(matches!(
        ctx.resolve_session("owner-token"),
        Err(BridgeError::InvalidSession)
    ));
    // The revocation evicted the token, so a later resolve gets the SAME error
    // an unknown token gets — the wire contract is unchanged.
    assert!(matches!(
        ctx.resolve_session("owner-token"),
        Err(BridgeError::InvalidSession)
    ));
    assert!(!ctx.sessions.read().unwrap().contains_key("owner-token"));
}

#[tokio::test]
async fn trashed_account_stops_resolving_after_the_revalidation_window() {
    let bridge = bridge_with_owner_session();
    let ctx = bridge.ctx();
    // Trash the row the way a DIFFERENT host on the same DB would: the row
    // survives (that is the design) and this process never ran an eviction.
    assert_account_change_revokes_within_the_window(
        &ctx,
        "UPDATE users SET deleted_at = '2026-08-01T00:00:00.000Z' WHERE id = 'user-owner'",
    )
    .await;
}

#[tokio::test]
async fn deactivated_account_stops_resolving_after_the_revalidation_window() {
    let bridge = bridge_with_owner_session();
    let ctx = bridge.ctx();
    // Deactivation is the other half of the same residual: the account is not
    // trashed, it is simply switched off.
    assert_account_change_revokes_within_the_window(
        &ctx,
        "UPDATE users SET is_active = 0 WHERE id = 'user-owner'",
    )
    .await;
}

#[tokio::test]
async fn healthy_session_is_unaffected_by_revalidation() {
    let bridge = bridge_with_owner_session();
    let ctx = bridge.ctx();
    // Window of zero forces a re-read on every resolve after the first: a live
    // account must keep resolving, so the backstop cannot log everyone out.
    let _guard = WindowGuard(set_revalidation_window_for_test(Some(Duration::ZERO)));
    for _ in 0..8 {
        assert!(ctx.resolve_session("owner-token").is_ok());
    }
    assert!(ctx.sessions.read().unwrap().contains_key("owner-token"));
}
