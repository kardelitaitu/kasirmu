use super::*;
use chrono::Timelike;
use kasirmu_core::export::ReportScheduleConfig;
use kasirmu_core::migrations;
use std::sync::Arc;

#[tokio::test]
async fn generate_report_email_smoke() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    let schedule = ReportScheduleConfig {
        enabled: true,
        lookback_days: 7,
        ..ReportScheduleConfig::default()
    };

    let store_name = "Test Store";
    let result = email_sender::generate_filtered_report_email(&store, &schedule, store_name);
    assert!(result.is_ok(), "should generate email: {:?}", result.err());
    let email = result.unwrap();
    assert!(email.subject.contains("OZ-POS Report"));
    assert!(email.html_body.contains("<table") || email.html_body.contains("<p>"));
    assert!(email.text_body.contains("OZ-POS Report"));
}

#[tokio::test]
async fn generate_report_email_empty_db() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    let schedule = ReportScheduleConfig::default();
    let result = email_sender::generate_filtered_report_email(&store, &schedule, "Store");
    assert!(
        result.is_ok(),
        "empty DB should still generate: {:?}",
        result.err()
    );
}

#[tokio::test]
async fn send_test_report_fails_without_smtp_config() {
    let conn = migrations::fresh_db();
    let db = Arc::new(tokio::sync::Mutex::new(conn));
    let result = send_test_report(db).await;
    assert!(result.is_err(), "should fail without SMTP config");
    assert!(result.unwrap_err().contains("SMTP not configured"));
}

// ── D7 outbox dispatch ──────────────────────────────────────────────

#[tokio::test]
async fn deliver_outbox_entry_unknown_topic_returns_error() {
    let conn = Arc::new(tokio::sync::Mutex::new(migrations::fresh_db()));
    let result = deliver_outbox_entry(conn, "nonexistent", "{}").await;
    assert!(result.is_err(), "unknown topic must return error");
    assert!(result.unwrap_err().contains("unknown outbox topic"));
}

#[tokio::test]
async fn deliver_outbox_entry_email_report_fails_without_smtp_config() {
    let conn = Arc::new(tokio::sync::Mutex::new(migrations::fresh_db()));
    let payload = r#"{"recipients":["a@b.c"],"report":{"subject":"t","html_body":"<p>hi</p>","text_body":"hi"}}"#;
    let result = deliver_outbox_entry(conn, "email_report", payload).await;
    assert!(result.is_err(), "should fail without SMTP config");
    assert!(result.unwrap_err().contains("SMTP not configured"));
}

#[tokio::test]
async fn deliver_outbox_entry_rejects_malformed_json() {
    let conn = Arc::new(tokio::sync::Mutex::new(migrations::fresh_db()));
    let result = deliver_outbox_entry(conn, "email_report", "not json").await;
    assert!(result.is_err(), "malformed JSON must return error");
    assert!(result.unwrap_err().contains("invalid email payload"));
}

#[tokio::test]
async fn scheduled_report_enqueues_outbox_entry_when_due() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Set up SMTP and schedule so the loop thinks it should send.
    let smtp = SmtpConfig {
        host: "localhost".into(),
        port: 25,
        username: None,
        password: None,
        from: "test@example.com".into(),
        use_tls: false,
    };
    store.save_smtp_config(&smtp).unwrap();

    // Set send_at_time to the current hour:minute so the 2-min window
    // always matches during the test.
    let now = chrono::Utc::now();
    let send_at_time = format!("{:02}:{:02}", now.hour(), now.minute());
    let schedule = kasirmu_core::export::ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        send_at_time,
        recipients: vec!["admin@example.com".into()],
        ..Default::default()
    };
    store.save_report_schedule(&schedule).unwrap();

    let db = Arc::new(tokio::sync::Mutex::new(conn));
    try_send_scheduled(db.clone()).await.unwrap();

    // Verify an outbox entry was enqueued (instead of being sent directly).
    let outbox_count = {
        let db = db.lock().await;
        db.query_row(
            "SELECT COUNT(*) FROM outbox WHERE topic = 'email_report' AND status = 'pending'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    };
    assert_eq!(
        outbox_count, 1,
        "a scheduled report must enqueue an outbox entry"
    );
}
