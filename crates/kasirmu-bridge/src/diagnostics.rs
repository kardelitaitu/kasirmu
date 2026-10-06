//! System diagnostic log and health export command bodies.
//!
//! Provides one-click diagnostic archive generation for customer support and self-service
//! troubleshooting (Phase 2.2). Collects sanitized system telemetry, sync engine queue
//! statistics, audit checkpoint status, and recent rolling logs into an encrypted/deflated
//! `.zip` package.
//!
//! Key functions:
//! - [`export_diagnostics`]: Validates permissions, extracts health/sync info, sanitizes logs,
//!   and writes the diagnostic `.zip` archive.
//! - [`sanitize_log_text`]: Redacts authorization tokens, bearer headers, PINs, and passwords.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use kasirmu_core::permissions;
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Wire payload for diagnostic export result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResult {
    /// Absolute destination path of the generated `.zip` archive.
    pub path: String,
    /// Total archive size in bytes.
    pub size_bytes: u64,
    /// List of file entries packed into the archive.
    pub files_included: Vec<String>,
}

/// System and platform runtime overview for diagnostics.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfoDiagnostic {
    pub app_name: String,
    pub app_version: String,
    pub rust_version: String,
    pub target: String,
    pub exported_at: String,
    pub terminal_id: Option<String>,
    pub storage_available_bytes: u64,
    pub storage_total_bytes: u64,
    pub is_low_space: bool,
}

/// Offline queue sync telemetry.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncDiagnosticReport {
    pub pending_count: u64,
    pub synced_count: u64,
    pub failed_count: u64,
    pub recent_failures: Vec<SyncFailureItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFailureItem {
    pub id: String,
    pub action: String,
    pub retry_count: i64,
    pub created_at: String,
}

/// Audit verification high-level checkpoint.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditDiagnosticReport {
    pub total_events: u64,
    pub last_event_at: Option<String>,
}

/// Redact sensitive secrets from log lines before packaging.
pub fn sanitize_log_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        let mut clean = line.to_string();

        // Bearer tokens: "Bearer <token>"
        if let Some(idx) = clean.to_lowercase().find("bearer ") {
            let start = idx + 7;
            let end = clean[start..]
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .map(|offset| start + offset)
                .unwrap_or(clean.len());
            clean.replace_range(start..end, "[REDACTED]");
        }

        // JSON PIN: "pin": "..."
        if let Some(idx) = clean.to_lowercase().find("\"pin\"") {
            if let Some(colon) = clean[idx..].find(':') {
                let after_colon = idx + colon + 1;
                let trimmed = clean[after_colon..].trim_start();
                let start = after_colon + (clean[after_colon..].len() - trimmed.len());
                if trimmed.starts_with('"') {
                    if let Some(end_quote) = clean[start + 1..].find('"') {
                        clean.replace_range((start + 1)..(start + 1 + end_quote), "[REDACTED]");
                    }
                }
            }
        }

        // JSON Password: "password": "..."
        if let Some(idx) = clean.to_lowercase().find("\"password\"") {
            if let Some(colon) = clean[idx..].find(':') {
                let after_colon = idx + colon + 1;
                let trimmed = clean[after_colon..].trim_start();
                let start = after_colon + (clean[after_colon..].len() - trimmed.len());
                if trimmed.starts_with('"') {
                    if let Some(end_quote) = clean[start + 1..].find('"') {
                        clean.replace_range((start + 1)..(start + 1 + end_quote), "[REDACTED]");
                    }
                }
            }
        }

        // JSON Session Token: "session_token" or "sessionToken"
        for key in &["\"session_token\"", "\"sessiontoken\""] {
            if let Some(idx) = clean.to_lowercase().find(key) {
                if let Some(colon) = clean[idx..].find(':') {
                    let after_colon = idx + colon + 1;
                    let trimmed = clean[after_colon..].trim_start();
                    let start = after_colon + (clean[after_colon..].len() - trimmed.len());
                    if trimmed.starts_with('"') {
                        if let Some(end_quote) = clean[start + 1..].find('"') {
                            clean.replace_range((start + 1)..(start + 1 + end_quote), "[REDACTED]");
                        }
                    }
                }
            }
        }

        out.push_str(&clean);
        out.push('\n');
    }
    out
}

/// Reject paths with parent directory traversal `..`.
fn validate_output_path(path: &str) -> Result<(), BridgeError> {
    let p = Path::new(path);
    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(BridgeError::Invalid(format!(
                "path traversal rejected: '..' not allowed in '{path}'"
            )));
        }
    }
    Ok(())
}

/// Generate a complete diagnostic `.zip` archive containing system telemetry,
/// sync statistics, and sanitized recent rolling logs.
#[allow(clippy::too_many_arguments)]
pub async fn export_diagnostics(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    output_path: &str,
    db_path: &Path,
    log_dir: Option<&Path>,
    app_name: &str,
    app_version: &str,
    rust_version: &str,
    target: &str,
) -> Result<DiagnosticExportResult, BridgeError> {
    validate_output_path(output_path)?;

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ).await?;

    let out_file = Path::new(output_path);
    if let Some(parent) = out_file.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                BridgeError::Internal(format!("failed to create output parent directory: {e}"))
            })?;
        }
    }

    let file = File::create(out_file).map_err(|e| {
        BridgeError::Internal(format!("failed to create diagnostic zip file at '{output_path}': {e}"))
    })?;

    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut files_included = Vec::new();

    // 1. system_info.json
    let space = platform_instance_guard::get_disk_space(db_path).unwrap_or(platform_instance_guard::DiskSpace {
        available_bytes: 0,
        total_bytes: 0,
    });
    let is_low_space = space.available_bytes < platform_instance_guard::LOW_STORAGE_THRESHOLD_BYTES;
    let terminal_id = ctx.terminal_id.lock().await.clone();

    let sys_info = SystemInfoDiagnostic {
        app_name: app_name.to_string(),
        app_version: app_version.to_string(),
        rust_version: rust_version.to_string(),
        target: target.to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        terminal_id,
        storage_available_bytes: space.available_bytes,
        storage_total_bytes: space.total_bytes,
        is_low_space,
    };
    let sys_bytes = serde_json::to_vec_pretty(&sys_info)
        .map_err(|e| BridgeError::Internal(format!("serializing system info: {e}")))?;
    zip.start_file::<&str, ()>("system_info.json", options)
        .map_err(|e| BridgeError::Internal(format!("writing system_info.json: {e}")))?;
    zip.write_all(&sys_bytes)
        .map_err(|e| BridgeError::Internal(format!("writing system_info bytes: {e}")))?;
    files_included.push("system_info.json".to_string());

    // 2. sync_diagnostics.json
    {
        let db = ctx.lock_global().await;
        let mut pending_count: u64 = 0;
        let mut synced_count: u64 = 0;
        let mut failed_count: u64 = 0;
        let mut recent_failures = Vec::new();

        if let Ok(mut stmt) = db.prepare(
            "SELECT status, COUNT(*) FROM offline_queue GROUP BY status"
        ) {
            let mut rows = stmt.query([]).map_err(BridgeError::from)?;
            while let Ok(Some(row)) = rows.next() {
                let status: String = row.get(0).unwrap_or_default();
                let count: i64 = row.get(1).unwrap_or(0);
                match status.as_str() {
                    "pending" => pending_count = count.max(0) as u64,
                    "synced" => synced_count = count.max(0) as u64,
                    "failed" => failed_count = count.max(0) as u64,
                    _ => {}
                }
            }
        }

        if let Ok(mut stmt) = db.prepare(
            "SELECT id, action, retry_count, created_at FROM offline_queue WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20"
        ) {
            let mut rows = stmt.query([]).map_err(BridgeError::from)?;
            while let Ok(Some(row)) = rows.next() {
                recent_failures.push(SyncFailureItem {
                    id: row.get(0).unwrap_or_default(),
                    action: row.get(1).unwrap_or_default(),
                    retry_count: row.get(2).unwrap_or(0),
                    created_at: row.get(3).unwrap_or_default(),
                });
            }
        }

        let sync_rep = SyncDiagnosticReport {
            pending_count,
            synced_count,
            failed_count,
            recent_failures,
        };
        let sync_bytes = serde_json::to_vec_pretty(&sync_rep)
            .map_err(|e| BridgeError::Internal(format!("serializing sync diagnostics: {e}")))?;
        zip.start_file::<&str, ()>("sync_diagnostics.json", options)
            .map_err(|e| BridgeError::Internal(format!("writing sync_diagnostics.json: {e}")))?;
        zip.write_all(&sync_bytes)
            .map_err(|e| BridgeError::Internal(format!("writing sync diagnostics bytes: {e}")))?;
        files_included.push("sync_diagnostics.json".to_string());

        // 3. audit_summary.json
        let total_events: u64 = db.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap_or(0);
        let last_event_at: Option<String> = db.query_row("SELECT created_at FROM audit_log ORDER BY id DESC LIMIT 1", [], |r| r.get(0)).ok();
        let audit_rep = AuditDiagnosticReport {
            total_events,
            last_event_at,
        };
        let audit_bytes = serde_json::to_vec_pretty(&audit_rep)
            .map_err(|e| BridgeError::Internal(format!("serializing audit summary: {e}")))?;
        zip.start_file::<&str, ()>("audit_summary.json", options)
            .map_err(|e| BridgeError::Internal(format!("writing audit_summary.json: {e}")))?;
        zip.write_all(&audit_bytes)
            .map_err(|e| BridgeError::Internal(format!("writing audit summary bytes: {e}")))?;
        files_included.push("audit_summary.json".to_string());
    }

    // 4. app_logs
    if let Some(dir) = log_dir {
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                let mut log_files: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_file() && e.path().extension().and_then(|s| s.to_str()) == Some("log"))
                    .collect();

                // Sort by modified descending (newest first)
                log_files.sort_by(|a, b| {
                    let ma = a.metadata().and_then(|m| m.modified()).ok();
                    let mb = b.metadata().and_then(|m| m.modified()).ok();
                    mb.cmp(&ma)
                });

                // Package the top 3 newest log files
                for entry in log_files.into_iter().take(3) {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let archive_name = format!("logs/{file_name}");
                    if let Ok(raw_content) = std::fs::read_to_string(entry.path()) {
                        let sanitized = sanitize_log_text(&raw_content);
                        zip.start_file::<&str, ()>(&archive_name, options)
                            .map_err(|e| BridgeError::Internal(format!("starting zip entry for {archive_name}: {e}")))?;
                        zip.write_all(sanitized.as_bytes())
                            .map_err(|e| BridgeError::Internal(format!("writing log content: {e}")))?;
                        files_included.push(archive_name);
                    }
                }
            }
        }
    }

    zip.finish().map_err(|e| {
        BridgeError::Internal(format!("finalizing zip archive: {e}"))
    })?;

    let size_bytes = std::fs::metadata(out_file).map(|m| m.len()).unwrap_or(0);

    Ok(DiagnosticExportResult {
        path: output_path.to_string(),
        size_bytes,
        files_included,
    })
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;
