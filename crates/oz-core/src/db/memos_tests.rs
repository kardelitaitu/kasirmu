use super::*;
use crate::memo::{DeliveryStatus, MemoDuration, MemoStatus, NewMemo};
use rusqlite::params;

/// A current ISO-8601 timestamp string (for the `now` params).
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// A timestamp far in the past, to force expiry.
fn long_ago() -> String {
    "2000-01-01T00:00:00.000Z".to_string()
}

fn store() -> Store<'static> {
    let conn = crate::migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

/// Seed a terminal; `bound_location` sets `bound_location_id` (NULL for an
/// unbound terminal).
fn seed_terminal(store: &Store<'_>, id: &str, bound_location: Option<&str>) {
    seed_terminal_with_tenant(store, id, bound_location, "default");
}

/// Seed a terminal with an explicit tenant. `bound_location` sets
/// `bound_location_id` (NULL for an unbound terminal). Mirrors the
/// 20260912_terminals_tenant.sql backfill: a bound terminal carries its
/// location's tenant_id; an unbound one carries the 'default' sentinel.
fn seed_terminal_with_tenant(
    store: &Store<'_>,
    id: &str,
    bound_location: Option<&str>,
    tenant_id: &str,
) {
    store
        .conn()
        .execute(
            "INSERT INTO terminals (id, name, device_id, bound_location_id, tenant_id)
             VALUES (?1, ?1, ?1 || '-dev', ?2, ?3)",
            params![id, bound_location, tenant_id],
        )
        .unwrap();
}

/// Seed a location row (terminals.bound_location_id has an FK to locations).
fn seed_location(store: &Store<'_>, id: &str) {
    seed_location_with_tenant(store, id, "default");
}

/// Seed a location in an explicit tenant — lets a fixture express a second
/// tenant, which the hardcoded-'default' helper could not (the fixture
/// limitation the Phase 2 journal flagged: without it, no cross-tenant
/// fan-out test can even be written).
fn seed_location_with_tenant(store: &Store<'_>, id: &str, tenant_id: &str) {
    store
        .conn()
        .execute(
            "INSERT INTO locations (id, name, tenant_id) VALUES (?1, ?1, ?2)",
            params![id, tenant_id],
        )
        .unwrap();
}

fn new_memo(tenant: &str, locations: &[&str]) -> NewMemo {
    NewMemo {
        tenant_id: tenant.into(),
        location_ids: locations.iter().map(|s| s.to_string()).collect(),
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
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
    let mut m = new_memo("default", &[]);
    m.title = "   ".into();
    let err = store.create_memo_draft(&m).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "title", .. }));
}

#[test]
fn location_memo_scope_is_location() {
    let store = store();
    // 'default' location exists in the seeded schema.
    let memo = store
        .create_memo_draft(&new_memo("default", &["default"]))
        .unwrap();
    assert_eq!(memo.scope(), crate::memo::MemoScope::Location);
    assert_eq!(memo.location_ids, vec!["default".to_string()]);
}

#[test]
fn publish_transitions_stamps_expiry_and_snapshots_revision() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
        .create_memo_draft(&new_memo("default", &["default"]))
        .unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    // Only the terminal bound to 'default' receives the Location Memo.
    assert_eq!(recipient_count(&store, &memo.id), 1);
}

#[test]
fn org_memo_fanout_excludes_other_tenants_terminals() {
    // The Phase 2 journal's tenant-isolation reconciliation named exactly this
    // test as the one that could not be written while `seed_location`
    // hardcoded 'default' and `terminals` had no tenant_id. Both are closed:
    // two tenants, one location + terminal each, and the Organization Memo
    // published by tenant-a must reach only tenant-a's terminal.
    let store = store();
    seed_location_with_tenant(&store, "loc-a", "tenant-a");
    seed_location_with_tenant(&store, "loc-b", "tenant-b");
    seed_terminal_with_tenant(&store, "term-a", Some("loc-a"), "tenant-a");
    seed_terminal_with_tenant(&store, "term-b", Some("loc-b"), "tenant-b");

    let memo = store.create_memo_draft(&new_memo("tenant-a", &[])).unwrap();
    store.publish_memo("tenant-a", &memo.id).unwrap();

    // tenant-b's terminal must NOT receive tenant-a's Organization Memo.
    assert_eq!(recipient_count(&store, &memo.id), 1);
    let recipients: Vec<String> = store
        .conn()
        .prepare("SELECT terminal_id FROM memo_recipients WHERE memo_id = ?1")
        .unwrap()
        .query_map(params![memo.id], |r| r.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(recipients, vec!["term-a".to_string()]);
}

#[test]
fn org_memo_fanout_still_reaches_unbound_terminals_of_same_tenant() {
    // Behavior-preservation pin: the tenant narrowing must NOT silently drop
    // unbound terminals of the memo's own tenant — they carry the 'default'
    // sentinel (20260912_terminals_tenant.sql) and the pre-narrowing behavior
    // (and memos_tests' dependence on it) expects them to receive Org Memos.
    let store = store();
    seed_terminal_with_tenant(&store, "t-unbound", None, "default");
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    assert_eq!(recipient_count(&store, &memo.id), 1);
}

#[test]
fn publish_twice_is_rejected() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    let stopped = store.stop_memo("default", &memo.id, "user-2").unwrap();

    assert_eq!(stopped.status, MemoStatus::Stopped);
    assert_eq!(stopped.stopped_by.as_deref(), Some("user-2"));
    assert!(stopped.stopped_at.is_some());
}

#[test]
fn stop_draft_is_rejected() {
    let store = store();
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
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
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    // A different tenant cannot see it.
    assert_eq!(store.get_memo("other-tenant", &memo.id).unwrap(), None);
    // And cannot publish it.
    assert!(matches!(
        store.publish_memo("other-tenant", &memo.id).unwrap_err(),
        CoreError::NotFound { .. }
    ));
}

// ── Read path: list_active_for_terminal ─────────────────────────────

#[test]
fn list_stacks_location_above_organization() {
    let store = store();
    seed_terminal(&store, "t1", Some("default"));
    let org = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &org.id).unwrap();
    let loc = store
        .create_memo_draft(&new_memo("default", &["default"]))
        .unwrap();
    store.publish_memo("default", &loc.id).unwrap();

    let active = store
        .list_active_for_terminal("default", "t1", &now())
        .unwrap();
    assert_eq!(active.len(), 2);
    // Location Memo stacks above Organization Memo.
    assert_eq!(active[0].memo.id, loc.id, "location memo first");
    assert_eq!(active[1].memo.id, org.id);
    assert_eq!(active[0].delivery_status, DeliveryStatus::Pending);
}

#[test]
fn list_excludes_expired_and_stopped() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let live = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &live.id).unwrap();

    let expiring = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &expiring.id).unwrap();
    // Force it past expiry.
    store
        .conn()
        .execute(
            "UPDATE memos SET expires_at = ?1 WHERE id = ?2",
            params![long_ago(), expiring.id],
        )
        .unwrap();

    let stopped = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &stopped.id).unwrap();
    store.stop_memo("default", &stopped.id, "user-2").unwrap();

    let active = store
        .list_active_for_terminal("default", "t1", &now())
        .unwrap();
    let ids: Vec<&str> = active.iter().map(|a| a.memo.id.as_str()).collect();
    assert_eq!(ids, vec![live.id.as_str()], "only the live memo displays");
}

#[test]
fn list_is_terminal_scoped() {
    let store = store();
    seed_terminal(&store, "t1", None);
    seed_terminal(&store, "t2", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    // Both terminals see the org memo.
    assert_eq!(
        store
            .list_active_for_terminal("default", "t1", &now())
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store
            .list_active_for_terminal("default", "t2", &now())
            .unwrap()
            .len(),
        1
    );
    // An unknown terminal sees nothing.
    assert!(
        store
            .list_active_for_terminal("default", "t-unknown", &now())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn list_is_tenant_scoped() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    // The owning tenant sees it on its terminal.
    assert_eq!(
        store
            .list_active_for_terminal("default", "t1", &now())
            .unwrap()
            .len(),
        1
    );
    // A different tenant asking about the SAME terminal id sees nothing.
    // Deliberately the shared-terminal case: `terminals` carries no
    // tenant_id (see the org fan-out comment in memos.rs), so a terminal id
    // is precisely the thing two tenants could both address. This is the
    // only coverage for tenant scoping on the read path — every other list
    // test passes "default" for both.
    //
    // What this pins, measured by mutation (not assumed): dropping EITHER
    // `m.tenant_id` or `r.tenant_id` from the query still passes, because
    // the other predicate catches it. Dropping both fails here. So it proves
    // the boundary holds, not that each predicate is individually required.
    // `r.tenant_id` is therefore untested on its own — the store cannot
    // produce a recipient tagged with a different tenant than its memo, so
    // pinning it would need a directly-inserted inconsistent row. Left as
    // deliberate defense-in-depth rather than loosened.
    assert!(
        store
            .list_active_for_terminal("other-tenant", "t1", &now())
            .unwrap()
            .is_empty()
    );
}

// ── Delivery / acknowledgement ──────────────────────────────────────

#[test]
fn mark_delivered_then_acknowledge() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    store
        .mark_recipient_delivered("default", &memo.id, "t1")
        .unwrap();
    let active = store
        .list_active_for_terminal("default", "t1", &now())
        .unwrap();
    assert_eq!(active[0].delivery_status, DeliveryStatus::Delivered);

    store
        .acknowledge_memo("default", &memo.id, "t1", "user-9")
        .unwrap();
    let active = store
        .list_active_for_terminal("default", "t1", &now())
        .unwrap();
    assert_eq!(active[0].delivery_status, DeliveryStatus::Acknowledged);
    let ack_by: String = store
        .conn()
        .query_row(
            "SELECT acknowledged_by FROM memo_recipients WHERE memo_id = ?1 AND terminal_id = 't1'",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ack_by, "user-9");
}

#[test]
fn acknowledge_from_pending_backfills_delivered_at() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    // Ack directly from pending (online terminal) — an ack proves delivery.
    store
        .acknowledge_memo("default", &memo.id, "t1", "user-9")
        .unwrap();
    let (status, delivered): (String, Option<String>) = store
        .conn()
        .query_row(
            "SELECT delivery_status, delivered_at FROM memo_recipients
             WHERE memo_id = ?1 AND terminal_id = 't1'",
            params![memo.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "acknowledged");
    assert!(delivered.is_some(), "delivered_at backfilled by the ack");
}

#[test]
fn ack_is_idempotent_and_rejects_unknown_recipient() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    store
        .acknowledge_memo("default", &memo.id, "t1", "user-9")
        .unwrap();
    // Second ack is a no-op success (already acknowledged).
    store
        .acknowledge_memo("default", &memo.id, "t1", "user-9")
        .unwrap();
    // Unknown recipient → NotFound.
    assert!(matches!(
        store
            .acknowledge_memo("default", &memo.id, "t-nope", "user-9")
            .unwrap_err(),
        CoreError::NotFound { .. }
    ));
}

// ── Expiry sweep ────────────────────────────────────────────────────

#[test]
fn sweep_expired_transitions_past_due_memos() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    store
        .conn()
        .execute(
            "UPDATE memos SET expires_at = ?1 WHERE id = ?2",
            params![long_ago(), memo.id],
        )
        .unwrap();

    let swept = store.sweep_expired("default", &now()).unwrap();
    assert_eq!(swept, 1);
    assert_eq!(
        store.get_memo("default", &memo.id).unwrap().unwrap().status,
        MemoStatus::Expired
    );
    // Re-sweep is a no-op.
    assert_eq!(store.sweep_expired("default", &now()).unwrap(), 0);
}

#[test]
fn sweep_all_expired_spans_tenants() {
    // The daemon's global maintenance sweep tidies every tenant's past-due
    // memos in one pass (it is the system reclaiming its own rows, not a
    // user-facing read, so it carries no tenant filter).
    let store = store();
    seed_terminal(&store, "t1", None);
    let a = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &a.id).unwrap();
    let b = store
        .create_memo_draft(&new_memo("other-tenant", &[]))
        .unwrap();
    store.publish_memo("other-tenant", &b.id).unwrap();
    // Force both past their deadline.
    store
        .conn()
        .execute("UPDATE memos SET expires_at = ?1", params![long_ago()])
        .unwrap();

    let swept = store.sweep_all_expired(&now()).unwrap();
    assert_eq!(swept, 2, "sweeps across both tenants in one pass");
    assert_eq!(
        store.get_memo("default", &a.id).unwrap().unwrap().status,
        MemoStatus::Expired
    );
    assert_eq!(
        store
            .get_memo("other-tenant", &b.id)
            .unwrap()
            .unwrap()
            .status,
        MemoStatus::Expired
    );
    assert_eq!(store.sweep_all_expired(&now()).unwrap(), 0);
}

// ── Retention sweep (ruled 2026-09-07: fixed 30-day window) ──────
// "stopped and expired Memos remain archived for 30 days before deletion or
// anonymization." Stage one transitions ended memos to `archived`, stamping
// `archived_at` as the deletion clock; stage two deletes archives past the
// window. The cascade removes the targeting/revisions/recipient rows, which
// is the spec's sanctioned deletion — it happens only after the window, never
// at stop/expire time (20260911 made the parent-delete guards RESTRICT for
// locations/terminals, but memo-child rows are true children).

#[test]
fn retention_sweep_archives_ended_memos_and_stamps_the_clock() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let expired = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &expired.id).unwrap();
    store
        .conn()
        .execute(
            "UPDATE memos SET expires_at = ?1 WHERE id = ?2",
            params![long_ago(), expired.id],
        )
        .unwrap();
    store.sweep_expired("default", &now()).unwrap();

    let stopped = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &stopped.id).unwrap();
    store.stop_memo("default", &stopped.id, "user-1").unwrap();

    // A published memo must NOT be archived by the retention sweep —
    // ending a live memo is explicit (stop) or natural (expire), never
    // silent.
    let active = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &active.id).unwrap();
    let draft = store.create_memo_draft(&new_memo("default", &[])).unwrap();

    let archived = store.sweep_ended_to_archived(&now()).unwrap();
    assert_eq!(archived, 2, "the expired and stopped memos archive");

    let archived_expired = store.get_memo("default", &expired.id).unwrap().unwrap();
    assert_eq!(archived_expired.status, MemoStatus::Archived);
    assert!(
        archived_expired.archived_at.is_some(),
        "the deletion clock is stamped at archival"
    );
    let archived_stopped = store.get_memo("default", &stopped.id).unwrap().unwrap();
    assert_eq!(archived_stopped.status, MemoStatus::Archived);
    // stopped_at survives: the reason for ending is still recorded.
    assert!(archived_stopped.stopped_at.is_some());

    assert_eq!(
        store
            .get_memo("default", &active.id)
            .unwrap()
            .unwrap()
            .status,
        MemoStatus::Published
    );
    assert_eq!(
        store
            .get_memo("default", &draft.id)
            .unwrap()
            .unwrap()
            .status,
        MemoStatus::Draft
    );
    // Re-run is a no-op.
    assert_eq!(store.sweep_ended_to_archived(&now()).unwrap(), 0);
}

#[test]
fn retention_sweep_deletes_archives_only_past_the_window() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    store
        .conn()
        .execute(
            "UPDATE memos SET expires_at = ?1 WHERE id = ?2",
            params![long_ago(), memo.id],
        )
        .unwrap();
    store.sweep_expired("default", &now()).unwrap();
    let archived_at = store.sweep_ended_to_archived(&now()).unwrap();
    assert_eq!(archived_at, 1);

    // Day 29: still inside the 30-day window — the memo and its history
    // survive (the audit trail is the point of the window).
    let now29 = (chrono::Utc::now() + chrono::Duration::days(-29))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    assert_eq!(store.sweep_expired_archives(&now29, 30).unwrap(), 0);
    assert!(store.get_memo("default", &memo.id).unwrap().is_some());

    // Backdate archived_at past the window: deletion removes the memo and
    // every child row in one cascade.
    store
        .conn()
        .execute(
            "UPDATE memos SET archived_at = ?1 WHERE id = ?2",
            params![long_ago(), memo.id],
        )
        .unwrap();
    assert_eq!(store.sweep_expired_archives(&now(), 30).unwrap(), 1);
    assert!(store.get_memo("default", &memo.id).unwrap().is_none());
    let child_rows: i64 = store
        .conn()
        .query_row(
            "SELECT (SELECT COUNT(*) FROM memo_revisions WHERE memo_id = ?1)
                   + (SELECT COUNT(*) FROM memo_recipients WHERE memo_id = ?1)
                   + (SELECT COUNT(*) FROM memo_locations WHERE memo_id = ?1)
                   + (SELECT COUNT(*) FROM memos WHERE id = ?1)
                   + (SELECT COUNT(*) FROM memos WHERE status = 'archived' AND archived_at IS NULL)
                   + (SELECT COUNT(*) FROM memos WHERE status = 'archived' AND archived_at > '2000-01-01T00:00:00.000Z' AND status = 'stopped')",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        child_rows, 0,
        "cascade removes revisions, recipients, targeting; no archived row ever lacks a stamp"
    );
    // Re-run is a no-op.
    assert_eq!(store.sweep_expired_archives(&now(), 30).unwrap(), 0);
}

#[test]
fn retention_window_is_thirty_days_per_the_ruling() {
    assert_eq!(crate::memo::RETENTION_WINDOW_DAYS, 30);
}

// ── FK RESTRICT: a parent delete must not silently destroy Memo history ──
//
// Regression guard for the 20260911 fix, carried into the 20260913 join-table
// world: the location-side blocker now lives on `memo_locations.location_id`
// (memos no longer carries a location column). Before 20260911, the location
// and terminal edges were ON DELETE CASCADE, so deleting a Location or
// terminal erased the Memos and their audit/delivery trail — contradicting the
// 30-day retention promise and the repo's CUST-11 policy (block, don't destroy).

#[test]
fn location_delete_is_blocked_by_its_memos() {
    let store = store();
    seed_location(&store, "del-loc");
    // No terminal bound to del-loc, so the targeting row is the ONLY
    // dependent — this isolates memo_locations.location_id as the blocker
    // rather than a terminal binding.
    let memo = store
        .create_memo_draft(&new_memo("default", &["del-loc"]))
        .unwrap();
    store.publish_memo("default", &memo.id).unwrap();

    let result = store
        .conn()
        .execute("DELETE FROM locations WHERE id = ?1", params!["del-loc"]);
    assert!(
        result.is_err(),
        "deleting a Location that has Memos must be blocked, not cascade-destroy them"
    );
    // The memo and its audit trail survive.
    assert!(store.get_memo("default", &memo.id).unwrap().is_some());
    let revisions: i64 = store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_revisions WHERE memo_id = ?1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        revisions, 1,
        "the published revision (audit trail) is intact"
    );
}

#[test]
fn terminal_delete_is_blocked_by_its_recipients() {
    let store = store();
    seed_terminal(&store, "t-del", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap(); // org memo → recipient for t-del

    let result = store
        .conn()
        .execute("DELETE FROM terminals WHERE id = ?1", params!["t-del"]);
    assert!(
        result.is_err(),
        "deleting a terminal that has delivery records must be blocked"
    );
    assert_eq!(
        recipient_count(&store, &memo.id),
        1,
        "delivery record intact"
    );
}

#[test]
fn parent_delete_still_works_without_memo_dependents() {
    // Positive control (mirrors CUST-11): RESTRICT must not over-block. A
    // Location/terminal with no Memo references is still deletable.
    let store = store();
    seed_location(&store, "free-loc");
    seed_terminal(&store, "free-term", None);
    store
        .conn()
        .execute("DELETE FROM terminals WHERE id = ?1", params!["free-term"])
        .expect("terminal with no recipients is deletable");
    store
        .conn()
        .execute("DELETE FROM locations WHERE id = ?1", params!["free-loc"])
        .expect("location with no memos is deletable");
}

#[test]
fn deleting_a_memo_still_cascades_to_its_children() {
    // The genuine child edges (memo_id -> memos) must REMAIN cascade: removing
    // a memo takes its revisions + recipients with it. Only the location and
    // terminal edges were changed to RESTRICT.
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    assert_eq!(recipient_count(&store, &memo.id), 1);

    store
        .conn()
        .execute("DELETE FROM memos WHERE id = ?1", params![memo.id])
        .expect("memo delete must succeed and cascade to children");
    assert_eq!(recipient_count(&store, &memo.id), 0);
    let revisions: i64 = store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_revisions WHERE memo_id = ?1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(revisions, 0);
}

// ── Revise: corrections create a new immutable revision ─────────────

fn revision_count(store: &Store<'_>, memo_id: &str) -> i64 {
    store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_revisions WHERE memo_id = ?1",
            params![memo_id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn revise_bumps_revision_and_preserves_history() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    let published = store.publish_memo("default", &memo.id).unwrap();
    assert_eq!(published.revision, 1);
    let original_expiry = published.expires_at.clone();

    let revised = store
        .revise_memo(
            "default",
            &memo.id,
            "user-1",
            "Corrected title",
            "Corrected body",
        )
        .unwrap();

    assert_eq!(revised.status, MemoStatus::Published, "stays published");
    assert_eq!(revised.revision, 2, "revision bumped");
    assert_eq!(revised.title, "Corrected title");
    assert_eq!(revised.body, "Corrected body");
    assert_eq!(
        revised.expires_at, original_expiry,
        "a correction does not extend the memo's life"
    );
    // Both revisions now exist as immutable rows.
    assert_eq!(revision_count(&store, &memo.id), 2);
    let rev1_body: String = store
        .conn()
        .query_row(
            "SELECT body FROM memo_revisions WHERE memo_id = ?1 AND revision = 1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rev1_body, "Close early tonight", "revision 1 is untouched");
}

#[test]
fn revise_rejects_draft_and_terminal_states() {
    let store = store();
    seed_terminal(&store, "t1", None);
    // Draft: not yet published, nothing to correct.
    let draft = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    assert!(matches!(
        store
            .revise_memo("default", &draft.id, "user-1", "t", "b")
            .unwrap_err(),
        CoreError::Validation { .. }
    ));
    // Stopped: a terminal state cannot be revised.
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    store.stop_memo("default", &memo.id, "user-1").unwrap();
    assert!(matches!(
        store
            .revise_memo("default", &memo.id, "user-1", "t", "b")
            .unwrap_err(),
        CoreError::Validation { .. }
    ));
}

#[test]
fn revise_rejects_blank_content_and_unknown_memo() {
    let store = store();
    seed_terminal(&store, "t1", None);
    let memo = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    store.publish_memo("default", &memo.id).unwrap();
    assert!(matches!(
        store
            .revise_memo("default", &memo.id, "user-1", "  ", "body")
            .unwrap_err(),
        CoreError::Validation { .. }
    ));
    assert!(matches!(
        store
            .revise_memo("default", "no-such-memo", "user-1", "t", "b")
            .unwrap_err(),
        CoreError::NotFound { .. }
    ));
}

// ── Management read: list_memos_authored_by ───────────────────────

fn memo_by(author: &str) -> NewMemo {
    NewMemo {
        tenant_id: "default".into(),
        location_ids: vec![],
        author_user_id: author.into(),
        author_role: "admin".into(),
        title: format!("by {author}"),
        body: "body".into(),
        duration: MemoDuration::Hours24,
    }
}

#[test]
fn list_authored_scopes_to_author_and_includes_drafts() {
    let store = store();
    let draft = store.create_memo_draft(&memo_by("alice")).unwrap();
    let published = store.create_memo_draft(&memo_by("alice")).unwrap();
    store.publish_memo("default", &published.id).unwrap();
    // A different author's memo must not appear.
    store.create_memo_draft(&memo_by("bob")).unwrap();

    // Distinct timestamps so newest-first ordering is deterministic — memos
    // created in the same millisecond would otherwise tie on created_at.
    store
        .conn()
        .execute(
            "UPDATE memos SET created_at = ?1 WHERE id = ?2",
            params!["2026-01-01T00:00:00.000Z", draft.id],
        )
        .unwrap();
    store
        .conn()
        .execute(
            "UPDATE memos SET created_at = ?1 WHERE id = ?2",
            params!["2026-01-02T00:00:00.000Z", published.id],
        )
        .unwrap();

    let alice = store.list_memos_authored_by("default", "alice").unwrap();
    assert_eq!(alice.len(), 2, "alice's two memos, drafts included");
    assert!(alice.iter().all(|m| m.author_user_id == "alice"));
    assert_eq!(alice[0].id, published.id, "newest first");
    assert_eq!(alice[1].id, draft.id);
    assert!(alice.iter().any(|m| m.status == MemoStatus::Published));
    assert!(alice.iter().any(|m| m.status == MemoStatus::Draft));
    // Bob sees only his own.
    assert_eq!(
        store
            .list_memos_authored_by("default", "bob")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn list_authored_is_tenant_scoped() {
    let store = store();
    store.create_memo_draft(&memo_by("alice")).unwrap();
    // Same author id, different tenant: the memo belongs to 'default', so a
    // query under another tenant returns nothing.
    assert!(
        store
            .list_memos_authored_by("other-tenant", "alice")
            .unwrap()
            .is_empty()
    );
}

// ── Multi-location targeting (20260913_memo_locations.sql) ──────────

#[test]
fn multi_location_memo_fans_out_to_every_targeted_location() {
    let store = store();
    seed_location(&store, "loc-a");
    seed_location(&store, "loc-b");
    seed_location(&store, "loc-c"); // targeted by nothing
    // loc-a: one terminal; loc-b: two terminals; loc-c: one (must NOT get it).
    seed_terminal(&store, "t-a1", Some("loc-a"));
    seed_terminal(&store, "t-b1", Some("loc-b"));
    seed_terminal(&store, "t-b2", Some("loc-b"));
    seed_terminal(&store, "t-c1", Some("loc-c"));

    let memo = store
        .create_memo_draft(&new_memo("default", &["loc-a", "loc-b"]))
        .unwrap();
    assert_eq!(memo.location_ids.len(), 2);
    store.publish_memo("default", &memo.id).unwrap();

    for t in ["t-a1", "t-b1", "t-b2"] {
        let active = store
            .list_active_for_terminal("default", t, &now())
            .unwrap();
        assert_eq!(
            active.len(),
            1,
            "terminal {t} must receive the two-location memo"
        );
        assert_eq!(active[0].memo.id, memo.id);
    }
    let excluded = store
        .list_active_for_terminal("default", "t-c1", &now())
        .unwrap();
    assert!(
        excluded.is_empty(),
        "a terminal bound to an untargeted location must not receive the memo"
    );
}

#[test]
fn multi_location_targeting_normalizes_trims_and_dedupes() {
    let store = store();
    seed_location(&store, "loc-a");
    let memo = store
        .create_memo_draft(&new_memo("default", &["loc-a", "  loc-a  ", "loc-a", ""]))
        .unwrap();
    assert_eq!(
        memo.location_ids,
        vec!["loc-a".to_string()],
        "whitespace is trimmed and duplicates collapse, preserving first order"
    );
    let rows: i64 = store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memo_locations WHERE memo_id = ?1",
            params![memo.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1, "exactly one targeting row survives normalization");
}

#[test]
fn multi_location_memo_is_rejected_when_a_target_does_not_exist() {
    let store = store();
    seed_location(&store, "loc-real");
    let err = store
        .create_memo_draft(&new_memo("default", &["loc-real", "loc-ghost"]))
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Db(_)),
        "the unknown location fails the FK inside the create transaction"
    );
    // Nothing partial was written: no memo, no targeting row.
    let memos: i64 = store
        .conn()
        .query_row("SELECT COUNT(*) FROM memos", [], |r| r.get(0))
        .unwrap();
    assert_eq!(memos, 0, "a failed create leaves no draft behind");
}

#[test]
fn create_with_blank_targets_yields_an_organization_memo() {
    let store = store();
    let memo = store
        .create_memo_draft(&new_memo("default", &["   ", ""]))
        .unwrap();
    assert!(
        memo.location_ids.is_empty(),
        "all-blank targeting normalizes to the empty (Organization) set"
    );
    assert_eq!(memo.scope(), crate::memo::MemoScope::Organization);
}

#[test]
fn location_memo_still_sorts_above_organization() {
    let store = store();
    seed_location(&store, "loc-order");
    seed_terminal(&store, "t-order", Some("loc-order"));
    let org = store.create_memo_draft(&new_memo("default", &[])).unwrap();
    let loc = store
        .create_memo_draft(&new_memo("default", &["loc-order"]))
        .unwrap();
    store.publish_memo("default", &org.id).unwrap();
    store.publish_memo("default", &loc.id).unwrap();

    let active = store
        .list_active_for_terminal("default", "t-order", &now())
        .unwrap();
    assert_eq!(active.len(), 2);
    assert_eq!(
        active[0].memo.id, loc.id,
        "the Location memo (targeting rows present) stacks above the Organization memo"
    );
    assert_eq!(active[1].memo.id, org.id);
}
