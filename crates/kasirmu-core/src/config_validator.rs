/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: collect-all-failures design, testable inner function; COR-3 MEDIUM: error messages embed DATABASE_URL prefix (may contain user:password) and full REDIS_URL (may embed credentials) — leaks into retained logs on misconfiguration
next: redact userinfo before embedding URLs in messages (COR-3) | perf: N/A
*/
//! Startup configuration validator.
//!
//! Validates environment variables and configuration at application startup
//! with structured, operator-friendly error messages. Catches misconfigurations
//! before the application attempts to use them.
//!
//! # Usage
//!
//! ```no_run
//! use kasirmu_core::config_validator::{validate_config, ConfigValidationError};
//!
//! match validate_config() {
//!     Ok(()) => tracing::info!("configuration validated"),
//!     Err(errors) => {
//!         for err in &errors {
//!             tracing::error!(%err, "configuration error");
//!         }
//!         std::process::exit(1);
//!     }
//! }
//! ```

use std::collections::HashMap;
use std::fmt;

/// A single configuration validation failure.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfigValidationError {
    /// The environment variable or config key that failed.
    pub key: &'static str,
    /// Human-readable description of the problem.
    pub message: String,
    /// Suggested fix for the operator.
    pub fix: Option<String>,
}

impl fmt::Display for ConfigValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.key, self.message)?;
        if let Some(ref fix) = self.fix {
            write!(f, " ({fix})")?;
        }
        Ok(())
    }
}

/// Validate all known configuration variables from the live environment.
/// Returns a list of errors (empty list means all checks passed).
///
/// This function is designed to be called at startup — it collects *all*
/// failures rather than short-circuiting on the first one, so the operator
/// can fix everything in one pass.
pub fn validate_config() -> Result<(), Vec<ConfigValidationError>> {
    let vars: HashMap<String, String> = std::env::vars().collect();
    validate_config_inner(&vars)
}

/// Validate configuration from a caller-supplied map of key-value pairs.
/// Useful for testing without touching the real environment.
pub fn validate_config_with(
    vars: &HashMap<String, String>,
) -> Result<(), Vec<ConfigValidationError>> {
    validate_config_inner(vars)
}

/// Core validation logic — reads values from the given map instead of
/// the process environment. This keeps the logic testable without `unsafe`
/// env-var manipulation.
fn validate_config_inner(vars: &HashMap<String, String>) -> Result<(), Vec<ConfigValidationError>> {
    let mut errors = Vec::new();

    /// Helper: look up a key in the supplied map, returning `None` if absent.
    fn get<'a>(vars: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
        vars.get(key).map(|s| s.as_str())
    }

    // ── OZ_API_PORT ──────────────────────────────────────────────
    if let Some(port_str) = get(vars, "OZ_API_PORT") {
        match port_str.parse::<u16>() {
            Ok(0) => errors.push(ConfigValidationError {
                key: "OZ_API_PORT",
                message: "port cannot be 0".into(),
                fix: Some("set OZ_API_PORT to a value between 1024 and 65535".into()),
            }),
            Ok(p) if p < 1024 => errors.push(ConfigValidationError {
                key: "OZ_API_PORT",
                message: "privileged port — requires root/admin".into(),
                fix: Some("set OZ_API_PORT to a value >= 1024".into()),
            }),
            Err(_) => errors.push(ConfigValidationError {
                key: "OZ_API_PORT",
                message: format!("'{port_str}' is not a valid port number"),
                fix: Some("set OZ_API_PORT to a value between 1024 and 65535".into()),
            }),
            _ => {} // valid port
        }
    }

    // ── DATABASE_URL ─────────────────────────────────────────────
    if let Some(db_url) = get(vars, "DATABASE_URL") {
        if db_url.is_empty() {
            errors.push(ConfigValidationError {
                key: "DATABASE_URL",
                message: "DATABASE_URL is set but empty".into(),
                fix: Some(
                    "set DATABASE_URL to a valid connection string, or unset it to use SQLite"
                        .into(),
                ),
            });
        } else if !db_url.starts_with("postgresql://") && !db_url.starts_with("postgres://") {
            errors.push(ConfigValidationError {
                key: "DATABASE_URL",
                message: format!(
                    "DATABASE_URL must start with 'postgresql://' or 'postgres://', got '{}'",
                    redact_url(db_url)
                ),
                fix: Some("set DATABASE_URL to a valid PostgreSQL connection string".into()),
            });
        }
    }

    // ── OZ_LICENSE_KEY / OZ_LICENSE_PRIVATE_KEY ──────────────────
    let license_key = get(vars, "OZ_LICENSE_PRIVATE_KEY").or_else(|| get(vars, "OZ_LICENSE_KEY"));

    if let Some(key) = license_key {
        if key.is_empty() {
            errors.push(ConfigValidationError {
                key: "OZ_LICENSE_PRIVATE_KEY",
                message: "license key is set but empty".into(),
                fix: Some("set OZ_LICENSE_PRIVATE_KEY to a PEM-encoded private key".into()),
            });
        } else if !key.contains("BEGIN") && !key.contains("PRIVATE KEY") {
            errors.push(ConfigValidationError {
                key: "OZ_LICENSE_PRIVATE_KEY",
                message: "does not appear to be a PEM-encoded private key".into(),
                fix: Some(
                    "ensure OZ_LICENSE_PRIVATE_KEY contains '-----BEGIN PRIVATE KEY-----'".into(),
                ),
            });
        }
    }

    // ── STRIPE_SECRET_KEY ────────────────────────────────────────
    if let Some(stripe_key) = get(vars, "STRIPE_SECRET_KEY")
        && !stripe_key.is_empty()
        && !stripe_key.starts_with("sk_")
    {
        errors.push(ConfigValidationError {
            key: "STRIPE_SECRET_KEY",
            message: "should start with 'sk_' (Stripe secret keys are prefixed with 'sk_')".into(),
            fix: Some("check your Stripe dashboard for the correct secret key".into()),
        });
    }

    // ── MIDTRANS_SERVER_KEY ──────────────────────────────────────
    if let Some(midtrans_key) = get(vars, "MIDTRANS_SERVER_KEY") {
        if midtrans_key.is_empty() {
            errors.push(ConfigValidationError {
                key: "MIDTRANS_SERVER_KEY",
                message: "Midtrans server key is set but empty".into(),
                fix: Some(
                    "set MIDTRANS_SERVER_KEY to your Midtrans server key from the dashboard".into(),
                ),
            });
        } else if !midtrans_key.starts_with("Mid-server-")
            && !midtrans_key.starts_with("SB-Mid-server-")
        {
            errors.push(ConfigValidationError {
                key: "MIDTRANS_SERVER_KEY",
                message:
                    "should start with 'Mid-server-' (production) or 'SB-Mid-server-' (sandbox)"
                        .into(),
                fix: Some(
                    "check your Midtrans dashboard → Settings → Access Keys for the correct server key"
                        .into(),
                ),
            });
        }
    }

    // ── OZ_SYNC_REDIRECT_URL requires OZ_REDIRECT_ONLY ──────────
    if get(vars, "OZ_SYNC_REDIRECT_URL").is_some() && get(vars, "OZ_REDIRECT_ONLY") != Some("true")
    {
        errors.push(ConfigValidationError {
            key: "OZ_SYNC_REDIRECT_URL",
            message: "OZ_SYNC_REDIRECT_URL is set but OZ_REDIRECT_ONLY is not 'true'".into(),
            fix: Some(
                "set OZ_REDIRECT_ONLY=true to run in redirect-only mode, or unset OZ_SYNC_REDIRECT_URL"
                    .into(),
            ),
        });
    }

    // ── REDIS_URL validity check ─────────────────────────────────
    if let Some(redis_url) = get(vars, "REDIS_URL")
        && !redis_url.is_empty()
        && !redis_url.starts_with("redis://")
        && !redis_url.starts_with("rediss://")
    {
        errors.push(ConfigValidationError {
            key: "REDIS_URL",
            message: format!(
                "should start with 'redis://' or 'rediss://', got '{}'",
                redact_url(redis_url)
            ),
            fix: Some("set REDIS_URL to a valid Redis connection string".into()),
        });
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Truncate a string to `max_len` characters, keeping the beginning.
fn truncate_prefix(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

/// Redact userinfo from a connection URL for safe logging.
///
/// Returns `"<scheme>://[redacted]@<host>[:port]"` when userinfo is present,
/// or the original URL truncated to 80 chars if the scheme is unrecognised.
fn redact_url(url: &str) -> String {
    let scheme_end = url.find("://");
    let Some(scheme_end) = scheme_end else {
        return truncate_prefix(url, 80);
    };
    let after_scheme = &url[scheme_end + 3..];
    let Some(at_pos) = after_scheme.find('@') else {
        // No userinfo — the URL already has no credentials to redact.
        return truncate_prefix(url, 80);
    };
    let host_part = &after_scheme[at_pos + 1..];
    let scheme = &url[..scheme_end];
    format!("{scheme}://[redacted]@{host_part}")
}

#[cfg(test)]
#[path = "config_validator_tests.rs"]
mod tests;
