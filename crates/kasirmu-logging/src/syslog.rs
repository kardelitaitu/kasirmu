/*
last audited 19-07-26 by RSA-Agent
crate: oz-logging | status: SAFE | lint: CLEAN
findings: 2 unsafe blocks (openlog, syslog) — both with SAFETY comments. Valid CString + facility constant verified.
next: none | perf: N/A
*/

//! Linux syslog output for `oz-logging`.
//!
//! This module provides a function to write log records to the system
//! syslog daemon (at `/dev/log`). It uses the standard `syslog` C
//! library via `libc` FFI bindings.
//!
//! # Usage
//!
//! Call [`init_syslog`] **instead of** [`crate::init`] or
//! [`crate::init_json`] to set up a subscriber that writes both
//! to stdout (human-readable) and to syslog.
//!
//! ```no_run
//! kasirmu_logging::syslog::init_syslog("oz-pos", "local0").ok();
//! ```

use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::LoggingError;
use crate::visitor::MessageVisitor;

/// Resolve a syslog facility name to its libc constant.
///
/// Pure and side-effect free so the mapping is unit-testable without
/// touching the FFI. Returns `None` for unknown facility names.
fn facility_code(facility: &str) -> Option<i32> {
    Some(match facility {
        "auth" => libc::LOG_AUTH,
        "authpriv" => libc::LOG_AUTHPRIV,
        "cron" => libc::LOG_CRON,
        "daemon" => libc::LOG_DAEMON,
        "ftp" => libc::LOG_FTP,
        "kern" => libc::LOG_KERN,
        "local0" => libc::LOG_LOCAL0,
        "local1" => libc::LOG_LOCAL1,
        "local2" => libc::LOG_LOCAL2,
        "local3" => libc::LOG_LOCAL3,
        "local4" => libc::LOG_LOCAL4,
        "local5" => libc::LOG_LOCAL5,
        "local6" => libc::LOG_LOCAL6,
        "local7" => libc::LOG_LOCAL7,
        "lpr" => libc::LOG_LPR,
        "mail" => libc::LOG_MAIL,
        "news" => libc::LOG_NEWS,
        "syslog" => libc::LOG_SYSLOG,
        "user" => libc::LOG_USER,
        "uucp" => libc::LOG_UUCP,
        _ => return None,
    })
}

/// Initialise syslog logging for Linux systems.
///
/// Opens a connection to the syslog daemon and registers a combined
/// subscriber that writes human-readable log records to both stdout
/// AND syslog.
///
/// Reads `RUST_LOG` from the environment; falls back to `info` if unset.
///
/// Call this **instead of** [`crate::init`] or [`crate::init_json`].
/// If you have already called one of those, calling this function
/// will panic (the global subscriber is already set).
///
/// # Errors
///
/// Returns `LoggingError::InvalidLevel` if the facility name is
/// unknown.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
pub fn init_syslog(ident: &str, facility: &str) -> Result<(), LoggingError> {
    let Some(facility_code) = facility_code(facility) else {
        return Err(LoggingError::InvalidLevel(format!(
            "unknown syslog facility: {facility}"
        )));
    };

    let c_ident = std::ffi::CString::new(ident)
        .map_err(|_| LoggingError::InvalidLevel("ident contains null byte".into()))?;

    // SAFETY: openlog is safe with a valid CString and facility constant.
    unsafe {
        libc::openlog(
            c_ident.as_ptr(),
            libc::LOG_PID | libc::LOG_NOWAIT,
            facility_code,
        );
    }

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .with(SyslogLayer)
        .init();

    Ok(())
}

/// A `tracing` subscriber layer that writes events to syslog.
use tracing_subscriber::layer::{Context, Layer};

struct SyslogLayer;

impl<S: tracing::Subscriber> Layer<S> for SyslogLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let priority = match *event.metadata().level() {
            tracing::Level::ERROR => libc::LOG_ERR,
            tracing::Level::WARN => libc::LOG_WARNING,
            tracing::Level::INFO => libc::LOG_INFO,
            tracing::Level::DEBUG => libc::LOG_DEBUG,
            tracing::Level::TRACE => libc::LOG_DEBUG,
        };

        let mut message = String::new();
        let mut visitor = MessageVisitor(&mut message);
        event.record(&mut visitor);

        let c_message = match std::ffi::CString::new(message.as_str()) {
            Ok(m) => m,
            Err(_) => return,
        };

        // SAFETY: syslog is safe with a valid CString.
        unsafe {
            libc::syslog(priority, c"%s".as_ptr(), c_message.as_ptr());
        }
    }
}

#[cfg(test)]
#[path = "syslog_tests.rs"]
mod tests;
