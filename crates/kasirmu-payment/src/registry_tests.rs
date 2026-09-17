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
