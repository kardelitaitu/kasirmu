use super::*;

/// Build a minimal vars map for testing — no env var access needed.
fn vars(entries: &[(&str, &str)]) -> HashMap<String, String> {
    entries
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// An empty map simulates a clean environment with no config vars set.
fn empty_vars() -> HashMap<String, String> {
    HashMap::new()
}

#[test]
fn valid_port_accepted() {
    let v = vars(&[("OZ_API_PORT", "3099")]);
    assert!(validate_config_with(&v).is_ok());
}

#[test]
fn port_zero_rejected() {
    let v = vars(&[("OZ_API_PORT", "0")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_API_PORT" && e.message.contains("0"))
    );
}

#[test]
fn privileged_port_warns() {
    let v = vars(&[("OZ_API_PORT", "80")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_API_PORT" && e.message.contains("privileged"))
    );
}

#[test]
fn non_numeric_port_rejected() {
    let v = vars(&[("OZ_API_PORT", "abc")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_API_PORT" && e.message.contains("valid port number"))
    );
}

#[test]
fn empty_database_url_rejected() {
    let v = vars(&[("DATABASE_URL", "")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "DATABASE_URL" && e.message.contains("empty"))
    );
}

#[test]
fn bad_database_url_prefix_rejected() {
    let v = vars(&[("DATABASE_URL", "mysql://localhost/db")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "DATABASE_URL" && e.message.contains("postgresql"))
    );
}

#[test]
fn valid_postgres_url_accepted() {
    let v = vars(&[(
        "DATABASE_URL",
        "postgresql://user:pass@localhost:5432/ozpos",
    )]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "DATABASE_URL"));
    }
}

#[test]
fn empty_license_key_rejected() {
    let v = vars(&[("OZ_LICENSE_PRIVATE_KEY", "")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_LICENSE_PRIVATE_KEY" && e.message.contains("empty"))
    );
}

#[test]
fn non_pem_license_key_warns() {
    let v = vars(&[("OZ_LICENSE_PRIVATE_KEY", "not-a-real-key")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_LICENSE_PRIVATE_KEY" && e.message.contains("PEM"))
    );
}

#[test]
fn valid_pem_license_key_accepted() {
    let pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n-----END PRIVATE KEY-----";
    let v = vars(&[("OZ_LICENSE_PRIVATE_KEY", pem)]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "OZ_LICENSE_PRIVATE_KEY"));
    }
}

#[test]
fn license_key_fallback_to_oz_license_key() {
    // OZ_LICENSE_KEY is checked as a fallback when OZ_LICENSE_PRIVATE_KEY is absent
    let pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
    let v = vars(&[("OZ_LICENSE_KEY", pem)]);
    let result = validate_config_with(&v);
    assert!(result.is_ok());
}

#[test]
fn bad_stripe_key_rejected() {
    let v = vars(&[("STRIPE_SECRET_KEY", "not-a-stripe-key")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "STRIPE_SECRET_KEY" && e.message.contains("sk_"))
    );
}

#[test]
fn valid_stripe_test_key_accepted() {
    let v = vars(&[("STRIPE_SECRET_KEY", "sk_test_abc123")]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "STRIPE_SECRET_KEY"));
    }
}

#[test]
fn bad_midtrans_key_rejected() {
    let v = vars(&[("MIDTRANS_SERVER_KEY", "not-midtrans")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "MIDTRANS_SERVER_KEY" && e.message.contains("Mid-server-"))
    );
}

#[test]
fn valid_midtrans_sandbox_key_accepted() {
    let v = vars(&[("MIDTRANS_SERVER_KEY", "SB-Mid-server-test123")]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "MIDTRANS_SERVER_KEY"));
    }
}

#[test]
fn empty_midtrans_key_rejected() {
    let v = vars(&[("MIDTRANS_SERVER_KEY", "")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "MIDTRANS_SERVER_KEY" && e.message.contains("empty"))
    );
}

#[test]
fn redirect_url_without_redirect_only_rejected() {
    let v = vars(&[
        ("OZ_SYNC_REDIRECT_URL", "https://new-server.example.com"),
        ("OZ_REDIRECT_ONLY", ""),
    ]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "OZ_SYNC_REDIRECT_URL" && e.message.contains("OZ_REDIRECT_ONLY"))
    );
}

#[test]
fn redirect_url_with_redirect_only_accepted() {
    let v = vars(&[
        ("OZ_SYNC_REDIRECT_URL", "https://new.example.com"),
        ("OZ_REDIRECT_ONLY", "true"),
    ]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "OZ_SYNC_REDIRECT_URL"));
    }
}

#[test]
fn bad_redis_url_rejected() {
    let v = vars(&[("REDIS_URL", "mysql://localhost")]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.key == "REDIS_URL" && e.message.contains("redis://"))
    );
}

#[test]
fn valid_redis_url_accepted() {
    let v = vars(&[("REDIS_URL", "redis://localhost:6379")]);
    let result = validate_config_with(&v);
    if let Err(errs) = &result {
        assert!(!errs.iter().any(|e| e.key == "REDIS_URL"));
    }
}

#[test]
fn no_env_vars_is_clean() {
    let result = validate_config_with(&empty_vars());
    assert!(result.is_ok(), "empty config should validate cleanly");
}

#[test]
fn collects_multiple_errors() {
    let v = vars(&[
        ("OZ_API_PORT", "0"),
        ("DATABASE_URL", ""),
        ("MIDTRANS_SERVER_KEY", ""),
    ]);
    let errs = validate_config_with(&v).unwrap_err();
    assert!(
        errs.len() >= 3,
        "should collect all errors, got {}",
        errs.len()
    );
}

#[test]
fn error_display_format() {
    let err = ConfigValidationError {
        key: "TEST_KEY",
        message: "is broken".into(),
        fix: Some("try fixing it".into()),
    };
    let display = err.to_string();
    assert!(display.contains("TEST_KEY"));
    assert!(display.contains("is broken"));
    assert!(display.contains("try fixing it"));
}

#[test]
fn error_display_without_fix() {
    let err = ConfigValidationError {
        key: "TEST_KEY",
        message: "is broken".into(),
        fix: None,
    };
    let display = err.to_string();
    assert!(display.contains("TEST_KEY"));
    assert!(display.contains("is broken"));
}

#[test]
fn truncate_prefix_short() {
    assert_eq!(truncate_prefix("hello", 10), "hello");
}

#[test]
fn truncate_prefix_long() {
    let long = "postgresql://user:verylongpassword@localhost:5432/dbname";
    let truncated = truncate_prefix(long, 40);
    assert!(truncated.len() <= 43); // 40 chars + '...'
    assert!(truncated.ends_with("..."));
}

#[test]
fn redact_url_removes_userinfo() {
    assert_eq!(
        redact_url("postgresql://user:secret@localhost:5432/db"),
        "postgresql://[redacted]@localhost:5432/db"
    );
}

#[test]
fn redact_url_no_userinfo_passthrough() {
    let url = "postgresql://localhost:5432/db";
    assert_eq!(redact_url(url), url);
}

#[test]
fn redact_url_no_scheme_truncates() {
    let url = "not-a-url-without-scheme";
    assert_eq!(redact_url(url), url);
}

#[test]
fn validator_errors_do_not_leak_credentials() {
    // COR-3: the DATABASE_URL / REDIS_URL error messages must never
    // embed userinfo (user:password@) — those land in long-retained logs.
    let v = vars(&[("DATABASE_URL", "mysql://admin:hunter2@localhost/db")]);
    let errs = validate_config_with(&v).unwrap_err();
    let msg = errs
        .iter()
        .find(|e| e.key == "DATABASE_URL")
        .map(|e| e.message.as_str())
        .unwrap_or("");
    assert!(
        !msg.contains("hunter2"),
        "DATABASE_URL error leaked password: {msg}"
    );
    assert!(msg.contains("[redacted]"));

    let v = vars(&[("REDIS_URL", "mysql://admin:hunter2@localhost")]);
    let errs = validate_config_with(&v).unwrap_err();
    let msg = errs
        .iter()
        .find(|e| e.key == "REDIS_URL")
        .map(|e| e.message.as_str())
        .unwrap_or("");
    assert!(
        !msg.contains("hunter2"),
        "REDIS_URL error leaked password: {msg}"
    );
    assert!(msg.contains("[redacted]"));
}

#[test]
fn validate_config_live_does_not_panic() {
    // Production entry point — must never panic even in messy environments.
    let _ = validate_config();
}
