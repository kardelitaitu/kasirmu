use super::*;
use tracing_subscriber::registry;

#[test]
fn write_debug_string_empty_message() {
    // Should not panic with an empty string.
    write_debug_string("");
}

#[test]
fn write_debug_string_ascii_message() {
    write_debug_string("[INF] OZ-POS: test message");
}

#[test]
fn write_debug_string_unicode_message() {
    write_debug_string("[INF] OZ-POS: café €10 — símbolos");
}

#[test]
fn write_debug_string_long_message() {
    let long = "a".repeat(10000);
    write_debug_string(&long);
}

#[test]
fn eventlog_layer_formats_info_event() {
    let layer = EventLogLayer {
        source: "TEST".into(),
    };
    let subscriber = registry().with(layer);
    // Should not panic.
    tracing::subscriber::with_default(subscriber, || {
        tracing::info!("hello from test");
    });
}

#[test]
fn eventlog_layer_formats_all_levels() {
    let layer = EventLogLayer {
        source: "OZ-POS".into(),
    };
    let subscriber = registry().with(layer);
    tracing::subscriber::with_default(subscriber, || {
        tracing::error!("error event");
        tracing::warn!("warn event");
        tracing::info!("info event");
        tracing::debug!("debug event");
        tracing::trace!("trace event");
    });
}

#[test]
fn eventlog_layer_formats_with_fields() {
    let layer = EventLogLayer {
        source: "TEST".into(),
    };
    let subscriber = registry().with(layer);
    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(sku = "ABC", qty = 5, "stock updated");
    });
}
