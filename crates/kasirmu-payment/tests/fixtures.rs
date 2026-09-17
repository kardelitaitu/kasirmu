//! Shared test fixtures for kasirmu-payment integration tests.
//!
//! # Fixture recording/replay (P5-4)
//!
//! [`load_scenario`] loads pre-recorded HTTP request/response pairs from JSON
//! files in `tests/fixtures/<driver>/<scenario>.json`. [`start_replay_server`]
//! configures a wiremock server with those responses for deterministic tests.
//!
//! ## Recording (one-time, requires sandbox API keys)
//!
//! To record a new fixture (e.g. after a gateway API change):
//! 1. Set `OZ_RECORD_FIXTURES_DIR` to a writable output path
//! 2. Run the sandbox test manually against the real gateway
//! 3. Copy the captured `RecordedExchange` JSON to `tests/fixtures/<driver>/<name>.json`
//!
//! ## Replay (CI, no sandbox keys required)
//!
//! All replay tests use [`start_replay_server`] which configures wiremock
//! from fixture data. No external HTTP calls are made.
//!
//! ## Limitations
//!
//! - Wiremock does not support sequence-based matching. If a scenario has
//!   multiple exchanges with the same HTTP method + path (e.g., two POST
//!   requests to the same endpoint), the last-mounted mock will match all.
//!   Design multi-exchange scenarios with distinct paths per step.

use kasirmu_payment::drivers::stripe::StripePaymentProcessor;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

/// Default test secret key for Stripe processor.
#[allow(dead_code)]
pub const TEST_SECRET_KEY: &str = "sk_test_shared_fixture";

/// Creates a StripePaymentProcessor pointing at the given endpoint.
#[allow(dead_code)]
pub fn stripe_processor(uri: &str, card_present: bool) -> StripePaymentProcessor {
    StripePaymentProcessor::new_with_endpoint(TEST_SECRET_KEY, uri, card_present)
}

/// A single recorded HTTP request/response pair.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecordedExchange {
    /// HTTP method (GET, POST, etc.)
    pub method: String,
    /// URL path (e.g. "/payment_intents")
    pub path: String,
    /// HTTP status code of the response.
    pub status: u16,
    /// JSON response body.
    pub response_body: serde_json::Value,
}

/// A collection of recorded exchanges for a single payment gateway scenario.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaymentScenario {
    /// Human-readable scenario name (e.g. "success", "decline", "timeout").
    pub name: String,
    /// The payment gateway driver name (e.g. "stripe", "square", "qris").
    pub driver: String,
    /// Ordered list of recorded HTTP exchanges (supports multi-step flows
    /// like authorize + capture for the `sale` method).
    pub exchanges: Vec<RecordedExchange>,
}

/// Load a [`PaymentScenario`] from a JSON file in `tests/fixtures/<driver>/<name>.json`.
///
/// Panics if the file cannot be read or parsed (test helper).
pub fn load_scenario(driver: &str, name: &str) -> PaymentScenario {
    let path = format!(
        "{}/tests/fixtures/{}/{}.json",
        env!("CARGO_MANIFEST_DIR"),
        driver,
        name
    );
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"));
    serde_json::from_str(&content).unwrap_or_else(|e| panic!("failed to parse fixture {path}: {e}"))
}

/// Start a wiremock server pre-configured with the exchanges from a scenario.
///
/// Each exchange is mounted on the mock server so it will respond in order.
/// Returns the `MockServer` handle (must be kept alive for the test duration).
pub async fn start_replay_server(scenario: &PaymentScenario) -> MockServer {
    let mock_server = MockServer::start().await;

    for exchange in &scenario.exchanges {
        let method_matcher = match exchange.method.to_uppercase().as_str() {
            "GET" => method("GET"),
            "POST" => method("POST"),
            "PUT" => method("PUT"),
            "DELETE" => method("DELETE"),
            _ => method("POST"),
        };

        Mock::given(method_matcher)
            .and(path(&exchange.path))
            .respond_with(
                ResponseTemplate::new(exchange.status)
                    .set_body_json(exchange.response_body.clone()),
            )
            .mount(&mock_server)
            .await;
    }

    mock_server
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_stripe_success_fixture_exists() {
        let scenario = load_scenario("stripe", "success");
        assert_eq!(scenario.driver, "stripe");
        assert_eq!(scenario.name, "success");
        assert!(
            !scenario.exchanges.is_empty(),
            "fixture must have exchanges"
        );
    }

    #[test]
    fn load_square_success_fixture_exists() {
        let scenario = load_scenario("square", "success");
        assert_eq!(scenario.driver, "square");
        assert!(!scenario.exchanges.is_empty());
    }

    #[test]
    fn load_qris_success_fixture_exists() {
        let scenario = load_scenario("qris", "success");
        assert_eq!(scenario.driver, "qris");
        assert!(!scenario.exchanges.is_empty());
    }

    #[tokio::test]
    async fn replay_server_responds_with_fixture_data() {
        let scenario = load_scenario("stripe", "success");
        let mock_server = start_replay_server(&scenario).await;

        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let first = &scenario.exchanges[0];
        let url = format!("{}{}", mock_server.uri(), first.path);

        let resp = match first.method.to_uppercase().as_str() {
            "GET" => client.get(&url).send().await.unwrap(),
            _ => client.post(&url).send().await.unwrap(),
        };

        assert_eq!(resp.status().as_u16(), first.status);

        let body: serde_json::Value = resp.json().await.unwrap();
        for (key, value) in first.response_body.as_object().unwrap() {
            assert_eq!(
                body.get(key),
                Some(value),
                "key {key} mismatch in replayed response"
            );
        }
    }
}
