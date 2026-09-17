//! Tests for `outbox.rs` — enqueue, drain with retry/backoff/dead-letter,
//! and the delivery-dispatch contract.

use super::*;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Build an in-memory DB with migrations applied.
fn fresh_db() -> rusqlite::Connection {
    kasirmu_core::migrations::fresh_db()
}

fn shared_conn() -> Arc<Mutex<rusqlite::Connection>> {
    Arc::new(Mutex::new(fresh_db()))
}

/// Fetch the full state of a single outbox entry by id.
fn get_entry(conn: &rusqlite::Connection, id: &str) -> OutboxEntry {
    conn.query_row(
        "SELECT id, topic, payload, status, max_attempts, attempts, \
         next_attempt_at, created_at, last_error FROM outbox WHERE id = ?1",
        params![id],
        |row| {
            Ok(OutboxEntry {
                id: row.get(0)?,
                topic: row.get(1)?,
                payload: row.get(2)?,
                status: row.get(3)?,
                max_attempts: row.get(4)?,
                attempts: row.get(5)?,
                next_attempt_at: row.get(6)?,
                created_at: row.get(7)?,
                last_error: row.get(8)?,
            })
        },
    )
    .expect("entry must exist")
}

// ── Enqueue ─────────────────────────────────────────────────────────

#[test]
fn enqueue_inserts_pending_entry() {
    let db = fresh_db();
    let id = enqueue_sqlite(&db, "email_report", r#"{"to":"a@b.c"}"#, 5, 0).unwrap();
    let entry = get_entry(&db, &id);
    assert_eq!(entry.topic, "email_report");
    assert_eq!(entry.status, "pending");
    assert_eq!(entry.attempts, 0);
    assert_eq!(entry.max_attempts, 5);
    assert!(entry.last_error.is_none());
    assert!(!entry.next_attempt_at.is_empty());
}

#[test]
fn enqueue_generates_distinct_ids() {
    let db = fresh_db();
    let a = enqueue_sqlite(&db, "t", "{}", 5, 0).unwrap();
    let b = enqueue_sqlite(&db, "t", "{}", 5, 0).unwrap();
    assert_ne!(a, b);
}

// ── Drain: success ──────────────────────────────────────────────────

#[tokio::test]
async fn drain_marks_successful_delivery() {
    let conn = shared_conn();
    let id = {
        let db = conn.lock().await;
        enqueue_sqlite(&db, "email_report", r#"{"ok":true}"#, 5, 0).unwrap()
    };

    let deliver = |_conn: SharedSqliteConn, topic: &str, _payload: &str| -> DeliverFuture {
        let topic = topic.to_string();
        Box::pin(async move {
            assert_eq!(topic, "email_report");
            Ok(())
        })
    };
    let processed = drain_sqlite(&conn, &deliver).await.unwrap();
    assert_eq!(processed, 1);

    let db = conn.lock().await;
    let entry = get_entry(&db, &id);
    assert_eq!(entry.status, "delivered");
    assert_eq!(entry.attempts, 1);
    assert!(entry.last_error.is_none());
}

#[tokio::test]
async fn drain_skips_non_due_entries() {
    let conn = shared_conn();
    // Manually insert an entry with a future next_attempt_at.
    let id = {
        let db = conn.lock().await;
        let future = chrono::Utc::now()
            .checked_add_signed(chrono::Duration::hours(1))
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let id = uuid::Uuid::now_v7().to_string();
        db.execute(
            "INSERT INTO outbox (id, topic, payload, status, priority, max_attempts, attempts, \
             next_attempt_at, created_at) VALUES (?1, 't', '{}', 'pending', 0, 5, 0, ?2, ?2)",
            params![id, future],
        )
        .unwrap();
        id
    };
    // The query picks due entries only; a future deadline must not match.
    let processed = {
        let deliver = |_conn: SharedSqliteConn, _topic: &str, _payload: &str| -> DeliverFuture {
            Box::pin(async { Ok(()) })
        };
        drain_sqlite(&conn, &deliver).await.unwrap()
    };
    assert_eq!(processed, 0);
    let db = conn.lock().await;
    assert_eq!(get_entry(&db, &id).status, "pending");
}

// ── Drain: retry + backoff ──────────────────────────────────────────

#[tokio::test]
async fn drain_failure_schedules_retry_with_backoff() {
    let conn = shared_conn();
    let id = {
        let db = conn.lock().await;
        enqueue_sqlite(&db, "email_report", "{}", 5, 0).unwrap()
    };

    let deliver = |_conn: SharedSqliteConn, _topic: &str, _payload: &str| -> DeliverFuture {
        Box::pin(async { Err("smtp down".into()) })
    };
    let processed = drain_sqlite(&conn, &deliver).await.unwrap();
    assert_eq!(processed, 1);

    let db = conn.lock().await;
    let entry = get_entry(&db, &id);
    assert_eq!(entry.status, "pending", "must stay pending for retry");
    assert_eq!(entry.attempts, 1);
    let err = entry.last_error.as_deref().unwrap_or_default();
    assert!(
        err.contains("smtp down"),
        "last_error must record the failure: {err}"
    );
}

#[tokio::test]
async fn drain_dead_letters_after_max_attempts() {
    let conn = shared_conn();
    let id = {
        let db = conn.lock().await;
        enqueue_sqlite(&db, "webhook", "{}", 2, 0).unwrap()
    };

    let deliver = |_conn: SharedSqliteConn, _topic: &str, _payload: &str| -> DeliverFuture {
        Box::pin(async { Err("boom".into()) })
    };
    // First failure: attempts 0→1, retry.
    drain_sqlite(&conn, &deliver).await.unwrap();
    {
        let db = conn.lock().await;
        assert_eq!(get_entry(&db, &id).status, "pending");
        assert_eq!(get_entry(&db, &id).attempts, 1);
    }
    // Force the entry to be due again (bypass the backoff deadline) so the
    // second drain claims it.
    {
        let db = conn.lock().await;
        db.execute(
            "UPDATE outbox SET next_attempt_at = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )
        .unwrap();
    }
    // Second failure: attempts 1→2 = max_attempts → dead_letter.
    drain_sqlite(&conn, &deliver).await.unwrap();
    {
        let db = conn.lock().await;
        let entry = get_entry(&db, &id);
        assert_eq!(entry.status, "dead_letter");
        assert_eq!(entry.attempts, 2);
    }
}

#[tokio::test]
async fn drain_retry_waits_for_backoff_deadline() {
    let conn = shared_conn();
    let id = {
        let db = conn.lock().await;
        enqueue_sqlite(&db, "webhook", "{}", 3, 0).unwrap()
    };

    let deliver = |_conn: SharedSqliteConn, _topic: &str, _payload: &str| -> DeliverFuture {
        Box::pin(async { Err("still down".into()) })
    };
    drain_sqlite(&conn, &deliver).await.unwrap(); // attempt 1, backoff deadline set

    {
        let db = conn.lock().await;
        let entry = get_entry(&db, &id);
        assert_eq!(entry.attempts, 1);
        // The next_attempt_at must be in the future (backoff ≈ 2 min).
        let next = chrono::DateTime::parse_from_rfc3339(&entry.next_attempt_at).unwrap();
        let now = chrono::Utc::now();
        assert!(
            next > now,
            "backoff deadline must be in the future, got {next}"
        );
    }

    // A second drain immediately (still before the deadline) must NOT pick
    // it up again — the entry is pending but not due yet.
    let processed = drain_sqlite(&conn, &deliver).await.unwrap();
    assert_eq!(processed, 0, "non-due retry entry must not be claimed");
}

// ── Dispatch contract ───────────────────────────────────────────────

#[tokio::test]
async fn drain_receives_topic_and_payload() {
    let conn = shared_conn();
    {
        let db = conn.lock().await;
        enqueue_sqlite(&db, "email_report", r#"{"x":1}"#, 5, 0).unwrap();
        enqueue_sqlite(&db, "webhook", r#"{"url":"u"}"#, 5, 0).unwrap();
    }

    // drain takes a Fn (immutable) — capture via a shared Vec.
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let cap = captured.clone();
    let deliver = move |_conn: SharedSqliteConn, topic: &str, payload: &str| -> DeliverFuture {
        let (topic, payload) = (topic.to_string(), payload.to_string());
        let cap = cap.clone();
        Box::pin(async move {
            cap.lock().unwrap().push((topic, payload));
            Ok(())
        })
    };
    drain_sqlite(&conn, &deliver).await.unwrap();

    let delivered = captured.lock().unwrap();
    assert_eq!(delivered.len(), 2);
    assert!(delivered.iter().any(|(t, _)| t == "email_report"));
    assert!(delivered.iter().any(|(t, _)| t == "webhook"));
    assert!(delivered.iter().any(|(_, p)| p.contains("x")));
    assert!(delivered.iter().any(|(_, p)| p.contains("url")));
}

// ── Backoff deadline helper ─────────────────────────────────────────

#[test]
fn backoff_deadline_grows_and_caps() {
    // attempt 1 → 2 min, attempt 2 → 4 min, ... capped at 1 hour.
    let a1 = backoff_deadline(1);
    let a2 = backoff_deadline(2);
    let a3 = backoff_deadline(3);
    let a10 = backoff_deadline(10);
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).unwrap();
    assert!(parse(&a1) < parse(&a2), "backoff must grow");
    assert!(parse(&a2) < parse(&a3), "backoff must grow");
    // 2^10 min = 17h ≫ cap → capped at 1h; a10 must be ≤ 1h from now.
    let now = chrono::Utc::now();
    assert!(parse(&a10) <= now + chrono::Duration::hours(1));
    assert!(parse(&a10) >= now + chrono::Duration::minutes(59));
}
