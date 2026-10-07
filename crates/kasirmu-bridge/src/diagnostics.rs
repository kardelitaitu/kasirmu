//! System diagnostic log and health export command bodies.
//!
//! Provides one-click diagnostic archive generation for customer support and self-service
//! troubleshooting (Phase 2.2). Collects sanitized system telemetry, sync engine queue
//! statistics, audit checkpoint status, and recent rolling logs into an encrypted/deflated
//! `.zip` package.
//!
//! Key functions:
//! - [`export_diagnostics`](crate::diagnostics::export_diagnostics): Validates permissions,
//!   extracts health/sync info, sanitizes logs, and writes the diagnostic `.zip` archive.
//! - [`sanitize_log_text`](crate::diagnostics::sanitize_log_text): Redacts authorization tokens,
//!   bearer headers, PINs, and passwords.

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
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;

    let out_file = Path::new(output_path);
    if let Some(parent) = out_file.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                BridgeError::Internal(format!("failed to create output parent directory: {e}"))
            })?;
        }
    }

    let file = File::create(out_file).map_err(|e| {
        BridgeError::Internal(format!(
            "failed to create diagnostic zip file at '{output_path}': {e}"
        ))
    })?;

    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut files_included = Vec::new();

    // 1. system_info.json
    let space = platform_instance_guard::get_disk_space(db_path).unwrap_or(
        platform_instance_guard::DiskSpace {
            available_bytes: 0,
            total_bytes: 0,
        },
    );
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

        if let Ok(mut stmt) =
            db.prepare("SELECT status, COUNT(*) FROM offline_queue GROUP BY status")
        {
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
        let total_events: u64 = db
            .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
            .unwrap_or(0);
        let last_event_at: Option<String> = db
            .query_row(
                "SELECT created_at FROM audit_log ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
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
                    .filter(|e| {
                        e.path().is_file()
                            && e.path().extension().and_then(|s| s.to_str()) == Some("log")
                    })
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
                            .map_err(|e| {
                                BridgeError::Internal(format!(
                                    "starting zip entry for {archive_name}: {e}"
                                ))
                            })?;
                        zip.write_all(sanitized.as_bytes()).map_err(|e| {
                            BridgeError::Internal(format!("writing log content: {e}"))
                        })?;
                        files_included.push(archive_name);
                    }
                }
            }
        }

        // 5. Always include crash_telemetry.log if present in log_dir
        let crash_log = dir.join("crash_telemetry.log");
        let archive_name = "logs/crash_telemetry.log".to_string();
        if crash_log.is_file() && !files_included.contains(&archive_name) {
            if let Ok(raw_content) = std::fs::read_to_string(&crash_log) {
                let sanitized = sanitize_log_text(&raw_content);
                if zip.start_file::<&str, ()>(&archive_name, options).is_ok() {
                    let _ = zip.write_all(sanitized.as_bytes());
                    files_included.push(archive_name);
                }
            }
        }
    }

    zip.finish()
        .map_err(|e| BridgeError::Internal(format!("finalizing zip archive: {e}")))?;

    let size_bytes = std::fs::metadata(out_file).map(|m| m.len()).unwrap_or(0);

    Ok(DiagnosticExportResult {
        path: output_path.to_string(),
        size_bytes,
        files_included,
    })
}

/// Wire payload for crash telemetry report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    /// UTC timestamp of the crash incident.
    pub timestamp: String,
    /// Origin category: "panic", "unhandled_rejection", "window_error", or "react_error_boundary".
    pub kind: String,
    /// Human-readable panic or error description.
    pub message: String,
    /// Optional stack trace.
    #[serde(default)]
    pub stack: Option<String>,
    /// Optional renderer component hierarchy trace.
    #[serde(default)]
    pub component_stack: Option<String>,
    /// Source file, line, and column coordinates.
    #[serde(default)]
    pub location: Option<String>,
    /// Application semantic version.
    #[serde(default)]
    pub app_version: Option<String>,
    /// Platform shell ("desktop" or "tablet").
    #[serde(default)]
    pub shell: Option<String>,
}

static PANIC_LOG_DIR: std::sync::RwLock<Option<std::path::PathBuf>> = std::sync::RwLock::new(None);
static PANIC_HOOK_INSTALLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Record a sanitized crash telemetry entry to the active log directory.
pub fn write_crash_report_entry(
    log_dir: Option<&Path>,
    report: &CrashReport,
) -> Result<(), BridgeError> {
    let sanitized_msg = sanitize_log_text(&report.message).trim_end().to_string();
    let sanitized_stack = report
        .stack
        .as_deref()
        .map(|s| sanitize_log_text(s).trim_end().to_string());
    let sanitized_component_stack = report
        .component_stack
        .as_deref()
        .map(|s| sanitize_log_text(s).trim_end().to_string());

    let sanitized_report = CrashReport {
        timestamp: report.timestamp.clone(),
        kind: report.kind.clone(),
        message: sanitized_msg,
        stack: sanitized_stack,
        component_stack: sanitized_component_stack,
        location: report.location.clone(),
        app_version: report.app_version.clone(),
        shell: report.shell.clone(),
    };

    if let Some(dir) = log_dir {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("[crash_telemetry] failed to create log directory: {e}");
        }
        let crash_file = dir.join("crash_telemetry.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&crash_file)
        {
            if let Ok(json_line) = serde_json::to_string(&sanitized_report) {
                let _ = writeln!(file, "{json_line}");
            }
        }
    } else {
        // Fallback: log warning to stderr
        if let Ok(json_line) = serde_json::to_string(&sanitized_report) {
            eprintln!("[crash_telemetry] {json_line}");
        }
    }

    Ok(())
}

/// Asynchronous wrapper for recording crash reports via Tauri IPC.
pub async fn record_crash_report(
    log_dir: Option<&Path>,
    report: CrashReport,
) -> Result<(), BridgeError> {
    write_crash_report_entry(log_dir, &report)
}

/// Install global unhandled panic hook that logs sanitized panic reports.
pub fn install_panic_hook(log_dir: Option<std::path::PathBuf>) {
    if let Ok(mut guard) = PANIC_LOG_DIR.write() {
        *guard = log_dir;
    }

    if !PANIC_HOOK_INSTALLED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let prev_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            let timestamp = chrono::Utc::now().to_rfc3339();
            let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "Box<dyn Any>".to_string()
            };
            let location = panic_info
                .location()
                .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()));
            let thread_name = std::thread::current()
                .name()
                .unwrap_or("unnamed")
                .to_string();
            let backtrace = format!("{:?}", std::backtrace::Backtrace::capture());

            let report = CrashReport {
                timestamp,
                kind: "panic".to_string(),
                message: format!("[thread '{thread_name}'] {payload}"),
                stack: Some(backtrace),
                component_stack: None,
                location,
                app_version: None,
                shell: None,
            };

            let dir = PANIC_LOG_DIR.read().ok().and_then(|g| g.clone());
            let _ = write_crash_report_entry(dir.as_deref(), &report);

            prev_hook(panic_info);
        }));
    }
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;
