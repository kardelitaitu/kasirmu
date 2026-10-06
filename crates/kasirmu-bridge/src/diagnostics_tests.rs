use super::*;

#[test]
fn test_sanitize_log_text_redacts_tokens_and_passwords() {
    let raw = r#"
2026-10-07T03:00:00Z INFO User logged in with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret
2026-10-07T03:00:01Z DEBUG Payload received: {"pin": "5678", "user_id": "u1"}
2026-10-07T03:00:02Z DEBUG Config updated: {"password": "admin_master_pwd", "host": "localhost"}
2026-10-07T03:00:03Z INFO Session active: {"session_token": "tok_super_secret_session_token"}
2026-10-07T03:00:04Z INFO Normal event occurred successfully
"#;

    let sanitized = sanitize_log_text(raw);

    assert!(!sanitized.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret"));
    assert!(sanitized.contains("Bearer [REDACTED]"));

    assert!(!sanitized.contains("5678"));
    assert!(sanitized.contains(r#""pin": "[REDACTED]""#));

    assert!(!sanitized.contains("admin_master_pwd"));
    assert!(sanitized.contains(r#""password": "[REDACTED]""#));

    assert!(!sanitized.contains("tok_super_secret_session_token"));
    assert!(sanitized.contains(r#""session_token": "[REDACTED]""#));

    assert!(sanitized.contains("Normal event occurred successfully"));
}

#[test]
fn test_validate_output_path_rejects_traversal() {
    assert!(validate_output_path("../escape.zip").is_err());
    assert!(validate_output_path("backups/../../escape.zip").is_err());
    assert!(validate_output_path("normal_export.zip").is_ok());
    assert!(validate_output_path("/var/log/diagnostics.zip").is_ok());
}

#[test]
fn test_write_crash_report_entry_sanitizes_pii_and_appends() {
    let temp_dir = std::env::temp_dir().join(format!("crash_test_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&temp_dir);

    let report = CrashReport {
        timestamp: "2026-10-07T03:30:00Z".to_string(),
        kind: "unhandled_rejection".to_string(),
        message: "Failed auth with Bearer my_secret_token_123".to_string(),
        stack: Some("Error at login with {\"password\": \"supersecret\"}".to_string()),
        component_stack: Some("at Component with {\"pin\": \"9999\"}".to_string()),
        location: Some("App.tsx:42:10".to_string()),
        app_version: Some("0.0.41".to_string()),
        shell: Some("desktop".to_string()),
    };

    let res = write_crash_report_entry(Some(&temp_dir), &report);
    assert!(res.is_ok());

    let crash_file = temp_dir.join("crash_telemetry.log");
    assert!(crash_file.is_file());

    let content = std::fs::read_to_string(&crash_file).expect("read crash file");
    assert!(!content.contains("my_secret_token_123"));
    assert!(!content.contains("supersecret"));
    assert!(!content.contains("9999"));

    let decoded: CrashReport = serde_json::from_str(content.trim()).expect("parse json");
    assert_eq!(decoded.message, "Failed auth with Bearer [REDACTED]");
    assert!(decoded.stack.unwrap().contains(r#""password": "[REDACTED]""#));
    assert!(decoded.component_stack.unwrap().contains(r#""pin": "[REDACTED]""#));

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
}

