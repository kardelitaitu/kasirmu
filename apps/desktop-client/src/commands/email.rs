//! Email report commands — send test reports and manage SMTP config.
//!
//! These commands allow the settings UI to validate SMTP connectivity
//! by sending a test report email immediately.

use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

/// Send a test report email using the currently configured SMTP
/// settings and report schedule.
///
/// Uses [`oz_core::export::email_sender::generate_filtered_report_email`]
/// so that the user's report_type checkbox selections are respected.
///
/// # Returns
///
/// A success message string on completion, or an [`AppError`] on
/// failure (invalid config, SMTP connection refused, etc.).
#[tauri::command]
pub async fn send_test_report(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let db = state.db.clone();

    let (smtp_config, recipients, report_email) = {
        let conn = db.lock().await;
        let store = oz_core::Store::new(&conn);

        let smtp_config = store
            .get_smtp_config()
            .map_err(|e| AppError::Internal(format!("Failed to load SMTP config: {e}")))?
            .ok_or_else(|| {
                AppError::Internal("SMTP not configured. Please save SMTP settings first.".into())
            })?;

        let schedule = store
            .get_report_schedule()
            .map_err(|e| AppError::Internal(format!("Failed to load report schedule: {e}")))?
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
        .map_err(|e| AppError::Internal(format!("Failed to generate report: {e}")))?;

        (smtp_config, recipients, report_email)
    };

    let transport = oz_core::export::email_sender::build_smtp_transport(&smtp_config)
        .map_err(|e| AppError::Internal(format!("SMTP transport failed: {e}")))?;

    for recipient in &recipients {
        use lettre::AsyncTransport;

        let msg = lettre::Message::builder()
            .from(
                smtp_config
                    .from
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid from address: {e}")))?,
            )
            .to(recipient
                .parse()
                .map_err(|e| AppError::Internal(format!("Invalid recipient '{recipient}': {e}")))?)
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
            .map_err(|e| AppError::Internal(format!("Failed to build email: {e}")))?;

        transport
            .send(msg)
            .await
            .map_err(|e| AppError::Internal(format!("SMTP send failed: {e}")))?;
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
#[tauri::command]
pub async fn get_report_schedule(
    state: State<'_, AppState>,
) -> Result<oz_core::export::ReportScheduleConfig, AppError> {
    let conn = state.db.lock().await;
    let store = oz_core::Store::new(&conn);
    store
        .get_report_schedule()
        .map_err(|e| AppError::Internal(format!("Failed to load report schedule: {e}")))
        .map(|opt| opt.unwrap_or_default())
}

/// Save the report schedule configuration.
#[tauri::command]
pub async fn save_report_schedule(
    session_token: String,
    state: State<'_, AppState>,
    config: oz_core::export::ReportScheduleConfig,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = state.db.lock().await;
    let store = oz_core::Store::new(&conn);
    store
        .save_report_schedule(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save report schedule: {e}")))
}

/// Session-scoped variant of [`get_report_schedule`].
#[tauri::command]
pub async fn get_report_schedule_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<oz_core::export::ReportScheduleConfig, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::REPORTS_SCHEDULE).await?;
    get_report_schedule(state).await
}

#[cfg(test)]
#[path = "email_tests.rs"]
mod tests;
