/*
last audited 25-07-26 by RSA-Agent (kasirmu-notification slice A: verified)
crate: kasirmu-notification | status: SAFE | lint: CLEAN
findings: clean — mock unwraps are test-support locks only. SAFETY-hygiene fix 2026-10-04 (PAY-10 class): the 13 `// SAFETY:` comments here annotated SAFE `.lock().unwrap()` calls on a Mutex, not `unsafe` blocks — `SAFETY` is the convention for `unsafe`, so they polluted the `grep SAFETY` unsafe audit. Reworded to `// INVARIANT: lock poison is the intended failure signal in a test double.` — `INVARIANT` is an accepted marker for scripts/scan-unwrap-panic.py (ADR #33), so the panic inventory stays documented while `grep SAFETY` finds only real unsafe. (The sibling kasirmu-payment reword dropped the marker word entirely and reddened that gate; repaired there too.)
next: none | perf: N/A
*/
//! Mock notification client for testing.
//!
//! Records all sent messages in memory and returns configurable responses.
//! Use this in unit and integration tests to verify notification behavior
//! without hitting the real WhatsApp API.

use async_trait::async_trait;
use std::sync::Mutex;

use crate::{
    NotificationClient, NotificationError, NotificationResult, NotificationStatus,
    TemplateParameter,
};

/// A recorded notification that was "sent" through the mock client.
#[derive(Debug, Clone, PartialEq)]
pub struct MockNotification {
    /// Recipient phone number.
    pub to: String,
    /// Template name or "text" for free-form messages.
    pub template_name: String,
    /// JSON-serialized parameters.
    pub parameters_json: String,
    /// Language code (if any).
    pub language: Option<String>,
    /// Whether the send was accepted.
    pub accepted: bool,
}

/// Mock notification client that records all sends in memory.
///
/// By default all sends succeed. Call `set_should_fail(true)` to simulate
/// API failures, and `sent_messages()` to inspect recorded sends.
#[derive(Debug)]
pub struct MockNotificationClient {
    /// Recorded sent messages.
    messages: Mutex<Vec<MockNotification>>,
    /// If true, all sends return an error.
    should_fail: Mutex<bool>,
    /// Custom error message when `should_fail` is true.
    fail_message: Mutex<String>,
}

impl MockNotificationClient {
    /// Create a new mock client with all sends succeeding by default.
    pub fn new() -> Self {
        Self {
            messages: Mutex::new(Vec::new()),
            should_fail: Mutex::new(false),
            fail_message: Mutex::new("mock failure".into()),
        }
    }

    /// Set whether subsequent sends should fail.
    pub fn set_should_fail(&self, fail: bool) {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        *self.should_fail.lock().unwrap() = fail;
    }

    /// Set the error message returned when sends fail.
    pub fn set_fail_message(&self, msg: impl Into<String>) {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        *self.fail_message.lock().unwrap() = msg.into();
    }

    /// Get all recorded sent messages.
    pub fn sent_messages(&self) -> Vec<MockNotification> {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        self.messages.lock().unwrap().clone()
    }

    /// Get the count of sent messages.
    pub fn sent_count(&self) -> usize {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        self.messages.lock().unwrap().len()
    }

    /// Clear all recorded messages.
    pub fn clear(&self) {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        self.messages.lock().unwrap().clear();
    }
}

impl Default for MockNotificationClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NotificationClient for MockNotificationClient {
    async fn send_template(
        &self,
        to: &str,
        template_name: &str,
        parameters: &[TemplateParameter],
        language: Option<&str>,
    ) -> NotificationResult<NotificationStatus> {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        if *self.should_fail.lock().unwrap() {
            // INVARIANT: lock poison is the intended failure signal in a test double.
            return Err(NotificationError::Api(
                // INVARIANT: lock poison is the intended failure signal in a test double.
                self.fail_message.lock().unwrap().clone(),
            ));
        }

        let params_json = serde_json::to_string(parameters).unwrap_or_default();

        // INVARIANT: lock poison is the intended failure signal in a test double.
        self.messages.lock().unwrap().push(MockNotification {
            to: to.to_string(),
            template_name: template_name.to_string(),
            parameters_json: params_json,
            language: language.map(|s| s.to_string()),
            accepted: true,
        });

        Ok(NotificationStatus {
            message_id: Some(format!("mock-msg-{}", self.sent_count())),
            accepted: true,
            status: "accepted".into(),
        })
    }

    async fn send_text(&self, to: &str, body: &str) -> NotificationResult<NotificationStatus> {
        // INVARIANT: lock poison is the intended failure signal in a test double.
        if *self.should_fail.lock().unwrap() {
            // INVARIANT: lock poison is the intended failure signal in a test double.
            return Err(NotificationError::Api(
                // INVARIANT: lock poison is the intended failure signal in a test double.
                self.fail_message.lock().unwrap().clone(),
            ));
        }

        // INVARIANT: lock poison is the intended failure signal in a test double.
        self.messages.lock().unwrap().push(MockNotification {
            to: to.to_string(),
            template_name: "text".into(),
            parameters_json: body.to_string(),
            language: None,
            accepted: true,
        });

        Ok(NotificationStatus {
            message_id: Some(format!("mock-msg-{}", self.sent_count())),
            accepted: true,
            status: "accepted".into(),
        })
    }

    fn verify_webhook_signature(
        &self,
        _payload: &[u8],
        _signature_header: &str,
    ) -> NotificationResult<bool> {
        // Mock always returns true for signature verification
        Ok(true)
    }
}

#[cfg(test)]
#[path = "mock_tests.rs"]
mod tests;
