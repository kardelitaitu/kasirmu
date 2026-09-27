//! Payment processor registry — tests.
//!
//! The registry itself is functional (register/lookup); only
//! `build_from_config` is a stub.

use std::sync::Arc;
use std::time::Duration;

use crate::PaymentProcessorRegistry;
use crate::drivers::mock::MockPaymentProcessor;

#[tokio::test]
async fn register_and_lookup_roundtrip() {
    let reg = PaymentProcessorRegistry::new();
    let proc: Arc<dyn crate::PaymentProcessor> = Arc::new(MockPaymentProcessor::new());
    reg.register("mock", proc.clone()).await;

    let found = reg.processor("mock").await.expect("registered");
    assert!(Arc::ptr_eq(&found, &proc));

    let names = reg.processor_names().await;
    assert_eq!(names, vec!["mock"]);
}

#[tokio::test]
async fn missing_processor_returns_none() {
    let reg = PaymentProcessorRegistry::new();
    assert!(reg.processor("stripe").await.is_none());
}

#[tokio::test]
async fn build_from_config_is_stub() {
    let reg = PaymentProcessorRegistry::new();
    let result = reg.build_from_config("stripe").await;
    assert!(
        matches!(result, Err(crate::PaymentError::Unsupported(_))),
        "expected Unsupported error"
    );
}

#[tokio::test]
async fn method_fallback_chain_registration_and_execution() {
    let reg = PaymentProcessorRegistry::new();

    let primary: Arc<dyn crate::PaymentProcessor> = Arc::new(
        MockPaymentProcessor::builder()
            .simulate_timeout(true)
            .build(),
    );
    let secondary: Arc<dyn crate::PaymentProcessor> = Arc::new(MockPaymentProcessor::new());

    reg.register_method_fallback("qris", vec![primary.clone(), secondary.clone()])
        .await;

    let chain = reg.method_processors("qris").await;
    assert_eq!(chain.len(), 2);

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        // O-H24: a key is REQUIRED for the chain to advance past the
        // timeout. Without it the fall-through would be a second charge
        // rather than a replay, and the chain stops — see
        // `keyless_transient_does_not_advance_the_chain`.
        idempotency_key: Some("fallback-key".into()),
    };

    let res = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await
        .expect("fallback should succeed on secondary");

    assert!(res.success);
}

#[tokio::test]
async fn method_fallback_chain_stops_on_terminal_error() {
    let reg = PaymentProcessorRegistry::new();

    let primary: Arc<dyn crate::PaymentProcessor> =
        Arc::new(MockPaymentProcessor::builder().decline_next(true).build());
    let secondary: Arc<dyn crate::PaymentProcessor> = Arc::new(MockPaymentProcessor::new());

    reg.register_method_fallback("qris", vec![primary.clone(), secondary.clone()])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;

    assert!(matches!(res, Err(crate::PaymentError::Declined(_))));
}

// ── The fallback chain's exception to the terminal-stop rule ──────────

/// An UNIMPLEMENTED processor does not stop the chain: the next one is tried.
///
/// **Pins `execute_with_fallback`'s carve-out** (`registry.rs:107`):
///
/// ```text
/// if class == ErrorClass::Terminal && !matches!(err, PaymentError::Unsupported(_))
/// ```
///
/// `Unsupported` is classified `Terminal` (`error.rs:77`), and every other
/// terminal error stops the chain — a declined card must not be silently
/// re-presented to a second acquirer. `Unsupported` is the deliberate
/// exception, because it means *this driver has not been built*, not *this card
/// was refused*. Without the carve-out, the shipped stubs would make the whole
/// chain fail on the first unimplemented member, so a merchant with two
/// gateways configured could not charge through the working one.
///
/// **Untested until now, and it was not reachable by any mock**: the double
/// exposes only `decline_next` and `simulate_timeout`, neither of which is
/// `Unsupported`. The `unsupported` builder mode added with this test is what
/// makes the exception observable rather than merely asserted in a comment.
#[tokio::test]
async fn fallback_chain_continues_past_an_unimplemented_processor() {
    let reg = PaymentProcessorRegistry::new();

    // Keep the TYPED handle for counting; the trait object goes into the chain.
    let stub_mock = Arc::new(MockPaymentProcessor::builder().unsupported(true).build());
    let unimplemented: Arc<dyn crate::PaymentProcessor> = stub_mock.clone();
    let working: Arc<dyn crate::PaymentProcessor> = Arc::new(MockPaymentProcessor::new());

    reg.register_method_fallback("qris", vec![unimplemented, working])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await
        .expect("the working processor must be reached");

    assert!(res.success);
    // The distinguishing evidence: the chain REACHED both, so it neither
    // stopped at the stub nor skipped past a working member.
    assert_eq!(
        stub_mock.authorize_calls(),
        1,
        "the stub was tried first"
    );
}

/// A DECLINED card stops the chain, and that is the other half of the same rule.
///
/// Deliberate companion to the test above: the carve-out is for `Unsupported`
/// alone. If a future edit widened it — treating any `Terminal` error as
/// "try the next gateway" — a refused card would be re-presented to a second
/// acquirer, which is how one decline becomes two authorisations against the
/// customer's account. The existing `method_fallback_chain_stops_on_terminal_error`
/// covers the outcome; this covers the CONSEQUENCE, by asserting the second
/// processor was never called.
#[tokio::test]
async fn fallback_chain_does_not_reach_the_second_processor_after_a_decline() {
    let reg = PaymentProcessorRegistry::new();

    let declining: Arc<dyn crate::PaymentProcessor> =
        Arc::new(MockPaymentProcessor::builder().decline_next(true).build());
    let second_mock = Arc::new(MockPaymentProcessor::new());
    let second: Arc<dyn crate::PaymentProcessor> = second_mock.clone();

    reg.register_method_fallback("qris", vec![declining, second])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;

    assert!(matches!(res, Err(crate::PaymentError::Declined(_))));
    assert_eq!(
        second_mock.authorize_calls(),
        0,
        "a declined card must NOT be re-presented to the next gateway"
    );
}

// ── §8 row 6: the chain escalates past a breaker that is OPEN ──────────

/// A processor whose breaker is `Open` fails fast, and the chain moves on.
///
/// **This is the design doc's §8 row 6** (`payment-resilience-design.md:222`),
/// marked *"**yes** — not wired at all"*. The wiring itself is §4's decision, but
/// the row's *claim* is testable without it: a decorated member of a chain must
/// not stop the chain when its breaker is open, or one unhealthy gateway takes the
/// whole method down and the second processor — the reason the chain exists — is
/// never reached.
///
/// **Why it works, and why that is worth pinning rather than assuming.** §1.2(a) of
/// the doc names the mechanism: the chain *"escalates to the next processor unless
/// the class is `Terminal`"*, and an open breaker returns `PaymentError::Network`
/// (`resilience.rs`), which classifies `Transient` (`error.rs:71`). So the two
/// mechanisms compose correctly — but only by virtue of a classification that
/// neither file states as a contract with the other. A future edit reclassifying
/// the fail-fast error as `Terminal` would make every open breaker fatal to its
/// whole chain, and nothing would say so.
///
/// This is the guard for that coupling.
#[tokio::test]
async fn chain_escalates_past_a_processor_whose_breaker_is_open() {
    let reg = PaymentProcessorRegistry::new();

    let inner: Arc<dyn crate::PaymentProcessor> = Arc::new(
        MockPaymentProcessor::builder().simulate_timeout(true).build(),
    );
    let config = crate::resilience::ResilientProcessorConfig {
        max_retries: 0,
        initial_backoff_ms: 1,
        max_backoff_ms: 2,
        failure_threshold: 1,
        cooldown_duration: Duration::from_secs(60),
    };
    let decorated: Arc<dyn crate::PaymentProcessor> = Arc::new(
        crate::resilience::ResilientProcessor::with_config(inner.clone(), config),
    );
    let healthy: Arc<dyn crate::PaymentProcessor> = Arc::new(MockPaymentProcessor::new());

    reg.register_method_fallback("qris", vec![decorated.clone(), healthy.clone()])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: Some("chain-key".into()),
    };

    // First call: the decorator's inner times out, its breaker trips at threshold 1.
    let first = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;
    assert!(
        first.is_ok(),
        "the healthy second processor must be reached on the first call: {first:?}"
    );

    // The breaker is now OPEN, so the decorator fails fast WITHOUT calling its
    // inner. The chain must still escalate — this is the row's actual subject.
    let second = reg
        .execute_with_fallback("qris", req.idempotency_key.as_deref(), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;
    assert!(
        second.is_ok(),
        "an OPEN breaker must not take the whole chain down: {second:?}"
    );
}

// ── O-H24: the fall-through is gated on the caller's gateway key ───────

/// A KEYLESS transient failure must NOT advance the chain.
///
/// **The double-charge class.** A `Transient` error — a timeout, a dropped
/// connection, a 502 — is precisely the class where the request *may have
/// reached the gateway*. Without a caller-supplied gateway key the driver
/// mints a fresh one per call, so advancing the chain does not repeat the
/// first attempt; it makes a **second charge** against a different acquirer,
/// with no key tying the two together.
///
/// The crate already states this rule for retries
/// (`resilience.rs:293-298`, `payment-resilience-design.md:99`); this test
/// pins the same rule for *fall-through*, which is a different path to the
/// same hazard.
///
/// The assertion that matters is `secondary.authorize_calls() == 0`: not
/// merely that the call failed, but that the second gateway was **never
/// reached**. A test that only checked `is_err()` would pass even if the
/// money had already moved.
#[tokio::test]
async fn keyless_transient_does_not_advance_the_chain() {
    let reg = PaymentProcessorRegistry::new();

    let timing_out: Arc<dyn crate::PaymentProcessor> = Arc::new(
        MockPaymentProcessor::builder()
            .simulate_timeout(true)
            .build(),
    );
    let second_mock = Arc::new(MockPaymentProcessor::new());
    let second: Arc<dyn crate::PaymentProcessor> = second_mock.clone();

    reg.register_method_fallback("qris", vec![timing_out, second])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = reg
        .execute_with_fallback("qris", None, |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;

    assert!(
        matches!(res, Err(crate::PaymentError::Timeout(_))),
        "the original error must surface unchanged: {res:?}"
    );
    assert_eq!(
        second_mock.authorize_calls(),
        0,
        "a keyless timeout must NOT be re-sent to a second gateway — \
         gateway #1 may already have committed, and the two attempts share no key"
    );
}

/// A BLANK key is treated as absent, matching `resilience::policy_for_key`.
///
/// The driver sanitises `Some("")` to an empty gateway id and mints a fresh
/// one, so a blank key carries the same double-charge hazard as `None`. If
/// this ever regressed to `is_some()`, a caller passing `Some("")` would
/// silently regain the double-charge path the test above closes.
#[tokio::test]
async fn blank_key_is_treated_as_keyless_and_does_not_advance_the_chain() {
    let reg = PaymentProcessorRegistry::new();

    let timing_out: Arc<dyn crate::PaymentProcessor> = Arc::new(
        MockPaymentProcessor::builder()
            .simulate_timeout(true)
            .build(),
    );
    let second_mock = Arc::new(MockPaymentProcessor::new());
    let second: Arc<dyn crate::PaymentProcessor> = second_mock.clone();

    reg.register_method_fallback("qris", vec![timing_out, second])
        .await;

    let currency = "USD".parse().unwrap();
    let req = crate::PaymentRequest {
        amount: foundation::Money::from_major(50, currency).unwrap(),
        reference: None,
        description: None,
        idempotency_key: Some("   ".into()),
    };

    let res = reg
        .execute_with_fallback("qris", Some("   "), |proc| {
            let req_clone = req.clone();
            async move { proc.authorize(&req_clone).await }
        })
        .await;

    assert!(matches!(res, Err(crate::PaymentError::Timeout(_))));
    assert_eq!(
        second_mock.authorize_calls(),
        0,
        "a whitespace-only key must be treated as keyless"
    );
}
