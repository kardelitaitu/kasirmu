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
