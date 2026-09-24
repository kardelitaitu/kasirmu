//! Payment processor registry — tests.
//!
//! The registry itself is functional (register/lookup); only
//! `build_from_config` is a stub.

use std::sync::Arc;

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
        idempotency_key: None,
    };

    let res = reg
        .execute_with_fallback("qris", |proc| {
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
        .execute_with_fallback("qris", |proc| {
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
        .execute_with_fallback("qris", |proc| {
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
        .execute_with_fallback("qris", |proc| {
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
