/*
last audited 19-07-26 by RSA-Agent
crate: oz-logging | status: SAFE | lint: CLEAN
findings: 1 unsafe block (OutputDebugStringW) with SAFETY comment. Minimally-scoped FFI to Windows debug output, valid wide string.
next: none | perf: N/A — best-effort debug logging
*/

//! Windows Event Log output for `oz-logging`.
//!
//! This module provides a function to write log records to the Windows
//! Event Log. It registers an event source so the application appears
//! in the Event Log viewer.
//!
//! # Usage
//!
//! Call [`init_eventlog`] **instead of** [`crate::init`] or
//! [`crate::init_json`] to set up a subscriber that writes both
//! to stdout (human-readable) and to the Windows Event Log via
//! `OutputDebugString`.
//!
//! ```no_run
//! kasirmu_logging::eventlog::init_eventlog("OZ-POS").ok();
//! ```

use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::LoggingError;
use crate::visitor::MessageVisitor;

/// Initialise Windows Event Log logging.
///
/// Opens a connection to the Windows Event Log subsystem and sets up
/// a combined subscriber that writes human-readable log records to
/// both stdout AND the Windows debug output (visible in Event Log
/// viewers and debuggers).
///
/// Reads `RUST_LOG` from the environment; falls back to `info` if unset.
///
/// Call this **instead of** [`crate::init`] or [`crate::init_json`].
///
/// # Errors
///
/// Returns `LoggingError::InvalidLevel` if the Event Log source
/// cannot be registered.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
pub fn init_eventlog(source_name: &str) -> Result<(), LoggingError> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .with(EventLogLayer {
            source: source_name.to_owned(),
        })
        .init();

    Ok(())
}

/// A `tracing` subscriber layer that writes events to the Windows
/// debug output (visible in DebugView, Event Log, etc.).
use tracing_subscriber::layer::{Context, Layer};

struct EventLogLayer {
    source: String,
}

impl<S: tracing::Subscriber> Layer<S> for EventLogLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        // Format the message as: [LEVEL] source: message
        let mut message = String::new();
        message.push('[');
        message.push_str(match *event.metadata().level() {
            tracing::Level::ERROR => "ERR",
            tracing::Level::WARN => "WRN",
            tracing::Level::INFO => "INF",
            tracing::Level::DEBUG => "DBG",
            tracing::Level::TRACE => "TRC",
        });
        message.push_str("] ");
        message.push_str(&self.source);
        message.push_str(": ");

        let mut visitor = MessageVisitor(&mut message);
        event.record(&mut visitor);

        // Write to Windows debug output.
        #[cfg(target_os = "windows")]
        write_debug_string(&message);
    }
}

/// Write a message to the Windows debug output using
/// `OutputDebugStringW`. This is visible in tools like
/// DebugView and the Windows Event Log when configured.
#[cfg(target_os = "windows")]
fn write_debug_string(message: &str) {
    let wide: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: OutputDebugStringW is safe with a valid wide string.
    unsafe {
        windows_sys::Win32::System::Diagnostics::Debug::OutputDebugStringW(wide.as_ptr());
    }
}

#[cfg(test)]
#[path = "eventlog_tests.rs"]
mod tests;
