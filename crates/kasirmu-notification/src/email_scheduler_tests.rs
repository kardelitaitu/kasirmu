use super::*;
use oz_core::db::Store;
use oz_core::migrations;
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
