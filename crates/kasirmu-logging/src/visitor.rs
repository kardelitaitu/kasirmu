/*
last audited 25-07-26 by RSA-Agent (oz-logging slice A: verified)
crate: oz-logging | status: SAFE | lint: CLEAN
findings: clean — sibling tests per convention
next: none | perf: N/A
*/
//! Shared visitor for formatting `tracing` event fields into plain text.
//!
//! [`MessageVisitor`] collects all fields from a `tracing::Event` into
//! a plain-text string suitable for output channels that don't support
//! structured data (syslog, Windows Event Log).

/// Collects event fields into a plain-text message string.
///
/// The `message` field is formatted without quotes. Other fields are
/// appended as `name=value` pairs.
pub struct MessageVisitor<'a>(
    /// Output buffer — formatted event fields are appended into this string.
    pub &'a mut String,
);

impl<'a> tracing::field::Visit for MessageVisitor<'a> {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.0.push_str(value);
        } else {
            self.0.push_str(&format!(" {}={}", field.name(), value));
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            // Use debug formatting for the message field.
            self.0.push_str(&format!("{:?}", value));
        } else {
            self.0.push_str(&format!(" {}={:?}", field.name(), value));
        }
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.0.push_str(&format!(" {}={}", field.name(), value));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.0.push_str(&format!(" {}={}", field.name(), value));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.0.push_str(&format!(" {}={}", field.name(), value));
    }
}

#[cfg(test)]
#[path = "visitor_tests.rs"]
mod tests;
