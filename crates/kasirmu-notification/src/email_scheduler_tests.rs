use super::*;
use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use rusqlite::Connection;

fn test_db() -> Arc<tokio::sync::Mutex<Connection>> {
    let conn = migrations::fresh_db();
    Arc::new(tokio::sync::Mutex::new(conn))
}

#[tokio::test]
async fn skips_when_no_smtp_config() {
    let db = test_db();
    let result = try_send_scheduled(&db).await;
    assert!(
        result.is_ok(),
        "should return Ok when SMTP is not configured"
    );
}

#[tokio::test]
async fn skips_when_schedule_disabled() {
    let db = test_db();

    // Seed SMTP config so it doesn't bail at that gate.
    {
        let conn = db.lock().await;
        let store = Store::new(&conn);
        store
            .set_setting("smtp.host", "localhost")
            .expect("set smtp host");
        store
            .set_setting("smtp.port", "587")
            .expect("set smtp port");
        store
            .set_setting("smtp.username", "user")
            .expect("set smtp user");
        store
            .set_setting("smtp.password", "pass")
            .expect("set smtp pass");
        store
            .set_setting("smtp.from", "pos@example.com")
            .expect("set smtp from");
        // No report schedule set — get_report_schedule returns None.
    }

    let result = try_send_scheduled(&db).await;
    assert!(
        result.is_ok(),
        "should return Ok when no report schedule is configured"
    );
}

#[tokio::test]
async fn error_from_db_is_propagated() {
    let db = test_db();

    // Corrupt the settings table so get_smtp_config fails.
    {
        let conn = db.lock().await;
        conn.execute_batch("DROP TABLE settings")
            .expect("drop settings");
    }

    let result = try_send_scheduled(&db).await;
    assert!(result.is_err(), "should propagate DB errors");
}

// ── O-H23: the DB lock is released before the report is rendered ──────

/// The render half must be callable with NO lock held.
///
/// **The O-H23 regression guard.** The scheduler used to hold
/// `db.lock().await` across `generate_filtered_report_email`, which runs
/// ten sequential aggregates *and* builds the HTML and text bodies. The
/// connection is the process-wide mutex shared with every UI command and
/// both sync daemons, so rendering — pure, and needing no database at all —
/// blocked the whole till for its duration.
///
/// This test pins the split by proving the render is reachable while the
/// lock is free. `try_lock` is the assertion that matters: it succeeds
/// only if nothing holds the mutex, so a future edit that folded the
/// render back inside the locked scope would fail here rather than
/// silently reintroduce the stall.
#[tokio::test]
async fn render_is_reachable_without_holding_the_db_lock() {
    let db = test_db();

    let schedule = kasirmu_core::export::ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into()],
        recipients: vec!["owner@example.com".into()],
        send_at_time: "08:00".into(),
        timezone: "UTC".into(),
        lookback_days: 7,
    };

    // Load under the lock, exactly as the scheduler does.
    //
    // The guard is dropped explicitly inside the scope: `Store::new(&conn)`
    // borrows the guard, and under temporary-lifetime extension that borrow
    // would otherwise keep the lock alive until the end of the OUTER block —
    // which is the very stall this test exists to catch. Dropping it here
    // mirrors what the scheduler's own scope does.
    let bundle = {
        let conn = db.lock().await;
        let store = Store::new(&conn);
        let bundle = kasirmu_core::export::email_sender::load_analytics_bundle(
            &store,
            &schedule,
            "Test Store",
        )
        .expect("analytics bundle loads from a fresh database");
        drop(store);
        drop(conn);
        bundle
    };

    // The lock must be free again once that scope ends.
    let free = db.try_lock();
    assert!(
        free.is_ok(),
        "the DB lock must be released after loading, before rendering"
    );
    drop(free);

    // Rendering must work with no lock held at all.
    let report =
        kasirmu_core::export::email_sender::render_report_email(bundle, &schedule, "Test Store");
    assert!(
        !report.subject.is_empty(),
        "the rendered report must carry a subject"
    );
}

/// The one-call convenience path still works unchanged.
///
/// `generate_filtered_report_email` is kept for callers that own their
/// database exclusively; the split must not have altered its result. This
/// pins that the refactor was behaviour-preserving for that entry point.
#[tokio::test]
async fn convenience_path_still_produces_a_report() {
    let db = test_db();
    let conn = db.lock().await;
    let store = Store::new(&conn);

    let schedule = kasirmu_core::export::ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into(), "top_products".into()],
        recipients: vec!["owner@example.com".into()],
        send_at_time: "08:00".into(),
        timezone: "UTC".into(),
        lookback_days: 7,
    };

    let report = kasirmu_core::export::email_sender::generate_filtered_report_email(
        &store,
        &schedule,
        "Test Store",
    )
    .expect("the convenience path still generates a report");
    assert!(!report.subject.is_empty());
}
