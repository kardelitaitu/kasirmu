//! Email command bodies (SMTP settings and test-report sending).
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-client/src/commands/email.rs`. Only the mechanical
//! `state.*` → `ctx.*` receiver swaps and `AppError::` → `BridgeError::`
//! renames were applied; lock scopes, message building and error strings
//! are unchanged.
//!
//! Gate-hazard note: `get_report_schedule_scoped` gates with
//! REPORTS_SCHEDULE BEFORE delegating to the GATE-FREE unscoped
//! `get_report_schedule`; they stay two distinct entry points so the
//! unscoped command never acquires a gate and the scoped one never loses
//! its own.

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Send a test report email using the currently configured SMTP
/// settings and report schedule.
///
/// Uses [`oz_core::export::email_sender::generate_filtered_report_email`]
/// so that the user's report_type checkbox selections are respected.
///
/// # Returns
///
/// A success message string on completion, or an error on
/// failure (invalid config, SMTP connection refused, etc.).
pub async fn send_test_report(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<String, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SETTINGS_EDIT)
        .await?;
    let db = ctx.db.clone();

    let (smtp_config, recipients, report_email) = {
        let conn = db.lock().await;
        let store = oz_core::Store::new(&conn);

        let smtp_config = store
            .get_smtp_config()
            .map_err(|e| BridgeError::Internal(format!("Failed to load SMTP config: {e}")))?
            .ok_or_else(|| {
                BridgeError::Internal(
                    "SMTP not configured. Please save SMTP settings first.".into(),
                )
            })?;

        let schedule = store
            .get_report_schedule()
            .map_err(|e| BridgeError::Internal(format!("Failed to load report schedule: {e}")))?
            .unwrap_or_default();

        let recipients = if schedule.recipients.is_empty() {
            vec![smtp_config.from.clone()]
        } else {
            schedule.recipients.clone()
        };

        let store_name = oz_core::Settings::get(store.conn, "store.name")
            .ok()
            .flatten()
            .unwrap_or_else(|| "OZ-POS Store".to_string());

        // Generate filtered report email (respects report_types checkboxes)
        let report_email = oz_core::export::email_sender::generate_filtered_report_email(
            &store,
            &schedule,
            &store_name,
        )
        .map_err(|e| BridgeError::Internal(format!("Failed to generate report: {e}")))?;

        (smtp_config, recipients, report_email)
    };

    let transport = oz_core::export::email_sender::build_smtp_transport(&smtp_config)
        .map_err(|e| BridgeError::Internal(format!("SMTP transport failed: {e}")))?;

    for recipient in &recipients {
        use lettre::AsyncTransport;

        let msg = lettre::Message::builder()
            .from(
                smtp_config
                    .from
                    .parse()
                    .map_err(|e| BridgeError::Internal(format!("Invalid from address: {e}")))?,
            )
            .to(recipient.parse().map_err(|e| {
                BridgeError::Internal(format!("Invalid recipient '{recipient}': {e}"))
            })?)
            .subject(&report_email.subject)
            .multipart(
                lettre::message::MultiPart::alternative()
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(lettre::message::header::ContentType::TEXT_PLAIN)
                            .body(report_email.text_body.clone()),
                    )
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(lettre::message::header::ContentType::TEXT_HTML)
                            .body(report_email.html_body.clone()),
                    ),
            )
            .map_err(|e| BridgeError::Internal(format!("Failed to build email: {e}")))?;

        transport
            .send(msg)
            .await
            .map_err(|e| BridgeError::Internal(format!("SMTP send failed: {e}")))?;
    }

    Ok(format!(
        "Test report sent to {} recipient(s)",
        recipients.len()
    ))
}

/// Get the current report schedule configuration.
///
/// Returns the saved [`ReportScheduleConfig`](oz_core::export::ReportScheduleConfig) or a default if none
/// has been persisted yet.
///
/// GATE-FREE by design (see module doc): the unscoped IPC surface performs
/// no session resolution and no permission check — do not add one here.
pub async fn get_report_schedule(
    ctx: &BridgeCtx<'_>,
) -> Result<oz_core::export::ReportScheduleConfig, BridgeError> {
    let conn = ctx.lock_global().await;
    let store = oz_core::Store::new(&conn);
    store
        .get_report_schedule()
        .map_err(|e| BridgeError::Internal(format!("Failed to load report schedule: {e}")))
        .map(|opt| opt.unwrap_or_default())
}

/// Save the report schedule configuration.
pub async fn save_report_schedule(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    config: oz_core::export::ReportScheduleConfig,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx.lock_global().await;
    let store = oz_core::Store::new(&conn);
    store
        .save_report_schedule(&config)
        .map_err(|e| BridgeError::Internal(format!("Failed to save report schedule: {e}")))
}

/// Session-scoped variant of [`get_report_schedule`].
///
/// Gates with REPORTS_SCHEDULE BEFORE delegating to the gate-free unscoped
/// fn; the delegation order mirrors the original command-calls-command
/// shape exactly.
pub async fn get_report_schedule_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<oz_core::export::ReportScheduleConfig, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::REPORTS_SCHEDULE)
        .await?;
    get_report_schedule(ctx).await
}
