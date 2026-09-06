use super::*;
use crate::memo::{MemoDuration, MemoStatus, NewMemo};
use rusqlite::params;

fn store() -> Store<'static> {
    let conn = crate::migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

/// Seed a terminal; `bound_location` sets `bound_location_id` (NULL for an
/// unbound terminal).
fn seed_terminal(store: &Store<'_>, id: &str, bound_location: Option<&str>) {
    store
        .conn()
        .execute(
            "INSERT INTO terminals (id, name, device_id, bound_location_id)
             VALUES (?1, ?1, ?1 || '-dev', ?2)",
            params![id, bound_location],
        )
        .unwrap();
}

/// Seed a location row (terminals.bound_location_id has an FK to locations).
fn seed_location(store: &Store<'_>, id: &str) {
    store
        .conn()
        .execute(
            "INSERT INTO locations (id, name, tenant_id) VALUES (?1, ?1, 'default')",
            params![id],
        )
        .unwrap();
}

fn new_memo(tenant: &str, location: Option<&str>) -> NewMemo {
    NewMemo {
        tenant_id: tenant.into(),
        location_id: location.map(Into::into),
        author_user_id: "user-1".into(),
        author_role: "admin".into(),
        title: "Heads up".into(),
        body: "Close early tonight".into(),
        duration: MemoDuration::Hours24,
    }
}

fn recipient_count(store: &Store<'_>, memo_id: &str) -> i64 {
    store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_recipients WHERE memo_id = ?1",
            params![memo_id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn create_draft_sets_initial_state() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    assert_eq!(memo.status, MemoStatus::Draft);
    assert_eq!(memo.revision, 1);
    assert_eq!(memo.duration, MemoDuration::Hours24);
    assert_eq!(memo.scope(), crate::memo::MemoScope::Organization);
    assert!(memo.published_at.is_none());
    assert!(memo.expires_at.is_none());
    // Round-trips through get_memo identically.
    assert_eq!(store.get_memo("default", &memo.id).unwrap(), Some(memo));
}

#[test]
fn create_rejects_blank_title() {
    let store = store();
    let mut m = new_memo("default", None);
    m.title = "   ".into();
    let err = store.create_memo_draft(&m).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "title", .. }));
}

#[test]
fn location_memo_scope_is_location() {
    let store = store();
    // 'default' location exists in the seeded schema.
    let memo = store
        .create_memo_draft(&new_memo("default", Some("default")))
        .unwrap();
    assert_eq!(memo.scope(), crate::memo::MemoScope::Location);
    assert_eq!(memo.location_id.as_deref(), Some("default"));
}

#[test]
fn publish_transitions_stamps_expiry_and_snapshots_revision() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    let published = store.publish_memo("default", &memo.id).unwrap();

    assert_eq!(published.status, MemoStatus::Published);
    assert!(published.published_at.is_some());
    let expires = published.expires_at.clone().expect("expiry stamped");
    // 24h duration ⇒ expires strictly after published_at.
    assert!(expires > published.published_at.unwrap());

    // Revision 1 snapshot exists and matches the published content.
    let rev: (i64, String, String) = store
        .conn()
        .query_row(
            "SELECT revision, title, body FROM memo_revisions WHERE memo_id = ?1",
            params![memo.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(rev, (1, "Heads up".into(), "Close early tonight".into()));
}

#[test]
fn publish_fans_out_one_pending_recipient_per_terminal() {
    let store = store();
    seed_terminal(&store, "t1", None);
    seed_terminal(&store, "t2", None);
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    assert_eq!(recipient_count(&store, &memo.id), 2);
    // All start pending.
    let pending: i64 = store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_recipients WHERE memo_id = ?1 AND delivery_status = 'pending'",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pending, 2);
}

#[test]
fn publish_populates_child_table_tenant_id() {
    // Convention + future-proofing: memo_revisions and memo_recipients carry a
    // denormalized tenant_id so they can be tenant-filtered by predicate and
    // covered by RLS (20260910), rather than relying solely on joining memos.
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    let rev_tenant: String = store
        .conn()
        .query_row(
            "SELECT tenant_id FROM memo_revisions WHERE memo_id = ?1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rev_tenant, "default");
    let recip_tenant: String = store
        .conn()
        .query_row(
            "SELECT tenant_id FROM memo_recipients WHERE memo_id = ?1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(recip_tenant, "default");
}

#[test]
fn location_memo_fans_out_only_bound_terminals() {
    let store = store();
    seed_location(&store, "other-loc");
    seed_terminal(&store, "t-bound", Some("default"));
    seed_terminal(&store, "t-other", Some("other-loc"));
    seed_terminal(&store, "t-unbound", None);
    let memo = store
        .create_memo_draft(&new_memo("default", Some("default")))
        .unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    // Only the terminal bound to 'default' receives the Location Memo.
    assert_eq!(recipient_count(&store, &memo.id), 1);
}

#[test]
fn publish_twice_is_rejected() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    let err = store.publish_memo("default", &memo.id).unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn stop_published_records_actor_and_time() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    let stopped = store.stop_memo("default", &memo.id, "user-2").unwrap();

    assert_eq!(stopped.status, MemoStatus::Stopped);
    assert_eq!(stopped.stopped_by.as_deref(), Some("user-2"));
    assert!(stopped.stopped_at.is_some());
}

#[test]
fn stop_draft_is_rejected() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    let err = store.stop_memo("default", &memo.id, "user-2").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn get_is_tenant_scoped() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", None)).unwrap();
    // A different tenant cannot see it.
    assert_eq!(store.get_memo("other-tenant", &memo.id).unwrap(), None);
    // And cannot publish it.
    assert!(matches!(
        store.publish_memo("other-tenant", &memo.id).unwrap_err(),
        CoreError::NotFound { .. }
    ));
}
