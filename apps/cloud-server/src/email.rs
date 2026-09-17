//! Email report delivery — background scheduled send loop + SMTP transport.
//!
//! ## Background task
//!
//! [`start_report_sender_loop`] spawns a tokio task that polls every 60
//! seconds. Scheduling logic (cadence, timezone, dedup) and report-type
//! filtering are delegated to [`kasirmu_core::export::email_sender`].
//!
//! ## Test send
//!
//! [`send_test_report`] is a public function that the Tauri desktop client
//! can invoke to validate SMTP configuration without waiting for the
//! scheduled window.

use std::sync::Arc;

use lettre::message::header::ContentType;
use lettre::{AsyncTransport, Message};
use kasirmu_core::{
    Store,
    export::{
        email_report::{ReportEmail, SmtpConfig},
        email_sender,
    },
};
use serde::Deserialize;
use tracing::{error, info};

use crate::outbox::{DeliverFuture, SharedSqliteConn, enqueue_sqlite};

// ── Send a single email ──────────────────────────────────────────────

/// Send an email report via SMTP.
///
/// # Errors
///
/// Returns a human-readable error string on any SMTP failure
/// (connection refused, auth failure, timeout, etc.).
pub async fn send_email(
    smtp_config: &SmtpConfig,
    email: &ReportEmail,
    to: &[String],
) -> Result<(), String> {
    if to.is_empty() {
        return Err("No recipients configured".into());
    }

    // Validate config early so the caller gets a clear error.
    smtp_config
        .validate()
        .map_err(|e| format!("Invalid SMTP config: {e}"))?;

    let transport = email_sender::build_smtp_transport(smtp_config)?;

    for recipient in to {
        let msg = Message::builder()
            .from(
                smtp_config
                    .from
                    .parse()
                    .map_err(|e| format!("Invalid from address: {e}"))?,
            )
            .to(recipient
                .parse()
                .map_err(|e| format!("Invalid recipient '{recipient}': {e}"))?)
            .subject(&email.subject)
            .multipart(
                lettre::message::MultiPart::alternative()
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(email.text_body.clone()),
                    )
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(email.html_body.clone()),
                    ),
            )
            .map_err(|e| format!("Failed to build email message: {e}"))?;

        transport
            .send(msg)
            .await
            .map_err(|e| format!("SMTP send failed: {e}"))?;
        info!("Report email sent to {recipient}");
    }

    Ok(())
}

// ── Background scheduled send loop ──────────────────────────────────

/// Start the background task that polls every 60s and sends scheduled
/// report emails when the configured send time arrives.
///
/// Uses [`email_sender::should_send_scheduled`] for cadence + timezone +
/// dedup logic and [`email_sender::generate_filtered_report_email`] for
/// report-type-aware generation.
pub fn start_report_sender_loop(db: Arc<tokio::sync::Mutex<rusqlite::Connection>>) {
    tokio::spawn(async move {
        // Poll every 5 min instead of 60s — reports are hourly, so 60s
        // polling wastes CPU on idle loops. Saves ~0.001 core.
        info!("Report sender background loop started (poll interval: 300s)");
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;

            if let Err(e) = try_send_scheduled(db.clone()).await {
                error!("Report sender loop error: {e}");
            }
        }
    });
}

/// Try to send a scheduled report — checks the schedule config via the
/// shared scheduler, generates a filtered report, and sends.
async fn try_send_scheduled(
    db: Arc<tokio::sync::Mutex<rusqlite::Connection>>,
) -> Result<(), String> {
    // Scope 1: Read SMTP + schedule config, check schedule.
    let (schedule, recipients, should_send) = {
        let conn = db.lock().await;
        let store = Store::new(&conn);

        // SMTP must be configured before anything can be delivered; without
        // it the enqueued report would just dead-letter.
        if store
            .get_smtp_config()
            .map_err(|e| format!("DB error: {e}"))?
            .is_none()
        {
            return Ok(());
        }

        let schedule = match store
            .get_report_schedule()
            .map_err(|e| format!("DB error: {e}"))?
        {
            Some(s) if s.enabled => s,
            _ => return Ok(()),
        };

        // Use shared scheduler for cadence + timezone + dedup
        let should_send = email_sender::should_send_scheduled(&store, &schedule)
            .map_err(|e| format!("Schedule check failed: {e}"))?;

        (schedule.clone(), schedule.recipients.clone(), should_send)
    };

    if !should_send {
        return Ok(());
    }

    // Scope 2: Generate filtered report
    let store_name = {
        let conn = db.lock().await;
        let store = Store::new(&conn);
        get_store_name(&store).unwrap_or_else(|_| "OZ-POS Store".to_string())
    };

    let report = {
        let conn = db.lock().await;
        let store = Store::new(&conn);
        email_sender::generate_filtered_report_email(&store, &schedule, &store_name)
            .map_err(|e| format!("Failed to generate report: {e}"))?
    };

    // D7 (ADR #43): enqueue the report into the transactional outbox
    // instead of sending synchronously. The drainer picks it up, reads SMTP
    // config at delivery time, and sends with retry/backoff/dead-letter.
    // Recording the sent timestamp here (at enqueue) keeps the scheduler
    // from re-enqueueing the same period; actual delivery is the drainer's
    // job.
    {
        let conn = db.lock().await;
        let payload = serde_json::json!({
            "recipients": recipients,
            "report": {
                "subject": report.subject,
                "html_body": report.html_body,
                "text_body": report.text_body,
            },
        })
        .to_string();
        enqueue_sqlite(&conn, "email_report", &payload, 5, 0)
            .map_err(|e| format!("Failed to enqueue report: {e}"))?;
    }

    // Record successful enqueue for dedup
    {
        let conn = db.lock().await;
        let store = Store::new(&conn);
        email_sender::record_sent_timestamp(&store)
            .map_err(|e| format!("Failed to record send timestamp: {e}"))?;
    }

    info!(
        "Scheduled report enqueued for delivery to {} recipients (cadence: {}, types: {:?})",
        recipients.len(),
        schedule.cadence,
        schedule.report_types,
    );

    Ok(())
}

/// Deliver an outbox `email_report` entry (ADR #43 D7).
///
/// Reads the SMTP config from the store at delivery time (never stored in
/// the outbox payload), parses the report JSON, and sends. The payload
/// shape matches what [`try_send_scheduled`] enqueues.
async fn deliver_email_report(conn: SharedSqliteConn, payload: &str) -> Result<(), String> {
    #[derive(Deserialize)]
    struct EmailPayload {
        recipients: Vec<String>,
        report: EmailReportShape,
    }
    #[derive(Deserialize)]
    struct EmailReportShape {
        subject: String,
        html_body: String,
        text_body: String,
    }

    let parsed: EmailPayload =
        serde_json::from_str(payload).map_err(|e| format!("invalid email payload: {e}"))?;

    let smtp_config = {
        let db = conn.lock().await;
        let store = Store::new(&db);
        store
            .get_smtp_config()
            .map_err(|e| format!("DB error: {e}"))?
            .ok_or_else(|| "SMTP not configured".to_string())?
    };

    let report = ReportEmail {
        subject: parsed.report.subject,
        html_body: parsed.report.html_body,
        text_body: parsed.report.text_body,
    };

    send_email(&smtp_config, &report, &parsed.recipients).await
}

/// Top-level outbox dispatch: route a delivery entry to the correct
/// topic handler (ADR #43 D7).
///
/// The signature matches [`outbox::start_drainer_sqlite`]'s `deliver_fn`
/// so it can be passed directly as a static function pointer.
pub fn deliver_outbox_entry(conn: SharedSqliteConn, topic: &str, payload: &str) -> DeliverFuture {
    let topic = topic.to_owned();
    let payload = payload.to_owned();
    Box::pin(async move {
        match topic.as_str() {
            "email_report" => deliver_email_report(conn, &payload).await,
            other => Err(format!("unknown outbox topic: {other}")),
        }
    })
}

/// Send a test report immediately (used by the Tauri desktop client for
/// the "Send Test Report" button in Settings).
///
/// Uses the filtered report generator so the test email reflects the
/// user's report_type selections.
#[allow(dead_code)]
pub async fn send_test_report(
    db: Arc<tokio::sync::Mutex<rusqlite::Connection>>,
) -> Result<String, String> {
    let conn = db.lock().await;
    let store = Store::new(&conn);

    let smtp_config = store
        .get_smtp_config()
        .map_err(|e| format!("Failed to load SMTP config: {e}"))?
        .ok_or_else(|| "SMTP not configured. Please save SMTP settings first.".to_string())?;

    let schedule = store
        .get_report_schedule()
        .map_err(|e| format!("Failed to load report schedule: {e}"))?
        .unwrap_or_default();

    let recipients = if schedule.recipients.is_empty() {
        vec![smtp_config.from.clone()]
    } else {
        schedule.recipients.clone()
    };

    let store_name = get_store_name(&store).unwrap_or_else(|_| "OZ-POS Store".to_string());

    let report = email_sender::generate_filtered_report_email(&store, &schedule, &store_name)
        .map_err(|e| format!("Failed to generate report: {e}"))?;
    drop(store);
    drop(conn);

    send_email(&smtp_config, &report, &recipients).await?;

    Ok(format!(
        "Test report sent to {} recipient(s)",
        recipients.len()
    ))
}

// ── Helper to read store name ───────────────────────────────────────

/// Read the store name from settings, falling back to a default.
fn get_store_name(store: &Store<'_>) -> Result<String, String> {
    use kasirmu_core::settings::Settings;
    let name = Settings::get(store.conn, "store.name").map_err(|e| format!("DB error: {e}"))?;
    Ok(name.unwrap_or_else(|| "OZ-POS Store".to_string()))
}

#[cfg(test)]
#[path = "email_tests.rs"]
mod tests;
