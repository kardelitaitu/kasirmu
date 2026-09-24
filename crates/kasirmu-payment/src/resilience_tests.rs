use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use foundation::Money;
use kasirmu_hal::types::DeviceInfo;

use super::*;
use crate::error::PaymentError;
use crate::processor::PaymentProcessor;

use crate::types::{PaymentReceipt, PaymentRequest, PaymentResult};

struct FlakyMockProcessor {
    call_count: AtomicU32,
    fail_until_attempt: u32,
    fail_with: PaymentError,
    /// The gateway key each `authorize` call was handed, in order.
    ///
    /// Recorded because §2's rule is about what the DRIVER receives, not about
    /// the decorator's eventual return: two attempts carrying different keys are
    /// two charges that happen to be reported as one operation.
    keys_seen: std::sync::Mutex<Vec<Option<String>>>,
}

impl FlakyMockProcessor {
    fn new(fail_until_attempt: u32, fail_with: PaymentError) -> Self {
        Self {
            call_count: AtomicU32::new(0),
            fail_until_attempt,
            fail_with,
            keys_seen: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> u32 {
        self.call_count.load(Ordering::SeqCst)
    }

    /// The gateway key of every `authorize` attempt, in call order.
    fn keys_seen(&self) -> Vec<Option<String>> {
        self.keys_seen.lock().expect("mock poisoned").clone()
    }
    fn usd() -> foundation::Currency {
        "USD".parse().unwrap()
    }
}

#[async_trait]
impl PaymentProcessor for FlakyMockProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.keys_seen
            .lock()
            .expect("mock poisoned")
            .push(request.idempotency_key.clone());
        let count = self.call_count.fetch_add(1, Ordering::SeqCst) + 1;
        if count <= self.fail_until_attempt {
            match &self.fail_with {
                PaymentError::Network(msg) => Err(PaymentError::Network(msg.clone())),
                PaymentError::Timeout(ms) => Err(PaymentError::Timeout(*ms)),
                PaymentError::Declined(msg) => Err(PaymentError::Declined(msg.clone())),
                other => Err(PaymentError::Unsupported(other.to_string())),
            }
        } else {
            Ok(PaymentResult {
                success: true,
                transaction_id: Some("tx_123".into()),
                auth_code: Some("auth_ok".into()),
                amount_charged: Money::from_major(10, Self::usd()).unwrap(),
                message: Some("approved".into()),
            })
        }
    }

    async fn capture(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: Some("tx_123".into()),
            auth_code: None,
            amount_charged: Money::from_major(10, Self::usd()).unwrap(),
            message: Some("captured".into()),
        })
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
        _idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: Some("tx_ref".into()),
            auth_code: None,
            amount_charged: Money::from_major(10, Self::usd()).unwrap(),
            message: Some("refunded".into()),
        })
    }

    async fn void(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: None,
            auth_code: None,
            amount_charged: Money::zero(Self::usd()),
            message: Some("voided".into()),
        })
    }

    async fn receipt(&self, _transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        Err(PaymentError::Unsupported("receipt not implemented".into()))
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Mock", "Flaky", "0000")
    }
}

/// **Amended 2026-09-25 under §2** (`payment-resilience-design.md:99`): this test
/// used `idempotency_key: None` and asserted that a transient failure was retried
/// until it succeeded. Under §2 that is not a retry but a **second charge** — the
/// driver mints a fresh gateway key per attempt — so the case it described is now
/// covered by `keyless_money_moving_call_is_not_retried`, which asserts the
/// OPPOSITE outcome. This test keeps its subject (the retry-with-backoff
/// mechanism) by supplying the key that makes a retry legitimate; the keyless half
/// lives in the pair below rather than being deleted, because both halves are the
/// rule.
#[tokio::test]
async fn resilient_processor_retries_transient_error_and_succeeds() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        2, // fails first 2 calls, succeeds on 3rd
        PaymentError::Network("temporary connection drop".into()),
    ));

    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        // §2: a key is what MAKES the retry below legitimate. Without it this
        // same call is single-shot, which `keyless_money_moving_call_is_not_retried`
        // asserts.
        idempotency_key: Some("retry-test-key".into()),
    };

    let res = resilient
        .authorize(&req)
        .await
        .expect("should succeed on retry");
    assert!(res.success);
    assert_eq!(flaky.calls(), 3); // attempt 0 (fail), retry 1 (fail), retry 2 (success)
}

#[tokio::test]
async fn resilient_processor_does_not_retry_terminal_error() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        5,
        PaymentError::Declined("card stolen".into()),
    ));

    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = resilient.authorize(&req).await;
    assert!(matches!(res, Err(PaymentError::Declined(_))));
    assert_eq!(flaky.calls(), 1); // no retries for terminal errors
}

#[tokio::test]
async fn circuit_breaker_trips_and_fails_fast() {
    let flaky = Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1000)));

    let config = ResilientProcessorConfig {
        max_retries: 1,
        initial_backoff_ms: 1,
        max_backoff_ms: 2,
        failure_threshold: 2, // 2 failed operations trip the breaker
        cooldown_duration: Duration::from_millis(50),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    // Op 1: 1 try + 1 retry = 2 calls to flaky -> fails operation -> failure count = 1
    let _ = resilient.authorize(&req).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::Closed);

    // Op 2: 1 try + 1 retry = 2 calls to flaky -> fails operation -> failure count = 2 >= threshold -> trips Open
    let _ = resilient.authorize(&req).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::Open);

    let calls_before_open = flaky.calls();

    // Op 3: fails fast without touching inner processor
    let res = resilient.authorize(&req).await;
    assert!(matches!(res, Err(PaymentError::Network(_))));
    assert_eq!(flaky.calls(), calls_before_open);

    // Wait for cooldown
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::HalfOpen);
}

// ── §5: half-open must admit exactly ONE probe ────────────────────────

/// During `HalfOpen`, exactly one caller is admitted; the rest fail fast.
///
/// **Red-first, per the design doc's §8 row *"concurrent callers during
/// `HalfOpen`: exactly one probe"*** (`docs/plans/_active/payment-resilience-design.md:223`),
/// which the doc marks as **failing today**.
///
/// **The defect this pins.** `CircuitBreaker::allow_request` returns `Ok(())` for
/// BOTH `Closed` and `HalfOpen`, and the `Open` -> `HalfOpen` transition happens
/// inside `state()` on a time check. So the moment `cooldown_duration` elapses,
/// EVERY concurrent caller is admitted as a trial. On a POS during a lunch rush
/// that is a thundering herd against a gateway that has just come back — the
/// classic way a half-open breaker turns one outage into two.
///
/// **Why the existing test cannot see it.** `circuit_breaker_trips_and_fails_fast`
/// drives the breaker strictly sequentially, and a sequential driver cannot
/// observe a concurrency defect. It is green today and would stay green with the
/// fix reverted — the same green-but-blind shape R20 found in the Tools parity
/// test, which the design doc calls out at `:177`.
///
/// Asserted on `allow_request` rather than through a processor, because the probe
/// RULE lives in the breaker: routing this through a decorator would also need a
/// gate to hold the probe open, and a test that fails for a helper's reason is
/// not a test of the rule.
#[tokio::test]
async fn half_open_admits_exactly_one_probe() {
    let breaker = CircuitBreaker::new(1, Duration::from_millis(20));

    // Trip it: one transient failure at threshold 1 opens the breaker.
    breaker.record_failure(true).await;
    assert_eq!(breaker.state().await, CircuitState::Open);
    assert!(
        breaker.allow_request().await.is_err(),
        "an OPEN breaker must fail fast"
    );

    // Cooldown elapses -> HalfOpen.
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(breaker.state().await, CircuitState::HalfOpen);

    // The first caller takes the probe.
    assert!(
        breaker.allow_request().await.is_ok(),
        "the probe caller must be admitted"
    );

    // Every subsequent caller, while that probe is unresolved, must fail fast.
    let mut admitted = 0;
    for _ in 0..19 {
        if breaker.allow_request().await.is_ok() {
            admitted += 1;
        }
    }
    assert_eq!(
        admitted, 0,
        "{admitted} extra callers were admitted during HalfOpen: a half-open breaker that admits every concurrent caller is the thundering herd §5 exists to prevent"
    );
}

/// The probe's OUTCOME settles the breaker, and it settles it once.
///
/// Companion to the test above: admitting exactly one probe is only half the rule.
/// A success must close the breaker (traffic resumes) and a failure must re-open it
/// (traffic keeps failing fast), and after either the next cooldown admits a fresh
/// probe. Without this, a fix could satisfy "one probe" by never letting traffic
/// through again — which is an outage that reports itself as protection.
#[tokio::test]
async fn probe_success_closes_and_probe_failure_reopens() {
    // Success path.
    let success = CircuitBreaker::new(1, Duration::from_millis(20));
    success.record_failure(true).await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(success.allow_request().await.is_ok(), "the probe is admitted");
    success.record_success().await;
    assert_eq!(success.state().await, CircuitState::Closed);
    assert!(
        success.allow_request().await.is_ok(),
        "a closed breaker admits traffic normally"
    );

    // Failure path: the probe fails, so the breaker re-opens and does NOT
    // immediately hand out another probe.
    let failed = CircuitBreaker::new(1, Duration::from_millis(20));
    failed.record_failure(true).await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(failed.allow_request().await.is_ok(), "the probe is admitted");
    failed.record_failure(true).await;
    assert_eq!(failed.state().await, CircuitState::Open);
    assert!(
        failed.allow_request().await.is_err(),
        "a failed probe must re-open the breaker rather than admit more callers"
    );
}
// ── §2: retry is only safe behind a gateway key ────────────────────────

/// A KEYLESS money-moving call is forwarded ONCE and the error surfaced.
///
/// **Red-first, per the design doc's §8 row **"a keyless money-moving call is
/// not retried"** (`docs/plans/_active/payment-resilience-design.md:217`), which
/// the doc marks **failing today**. The rule the doc states at `:99`:
///
/// > `ResilientProcessor` may retry a money-moving operation **only when that
/// > operation carries a caller-supplied gateway key**. With no key it forwards
/// > the call **once** and surfaces the error unchanged.
///
/// **Why the current behaviour is not a retry.** A `Transient` error is by
/// definition the class where the request *may have reached the gateway* — a
/// timeout, a dropped connection, a 502 after the gateway committed. With no key
/// the driver mints a fresh one per call (`drivers/qris.rs:338-352`,
/// `drivers/square.rs:341`), so the second attempt is a **second charge**, not a
/// repeat of the first. `processor.rs:78-80` names this in its own words.
///
/// The count is the assertion, not just the failure: a test that only checked the
/// eventual `Err` would pass on a decorator that charged twice and then reported
/// the second failure.
#[tokio::test]
async fn keyless_money_moving_call_is_not_retried() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        5,
        PaymentError::Network("connection dropped mid-charge".into()),
    ));
    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };
    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = resilient.authorize(&req).await;
    assert!(matches!(res, Err(PaymentError::Network(_))));
    assert_eq!(
        flaky.calls(),
        1,
        "a keyless charge must be forwarded exactly once: retrying it mints a second gateway key and therefore a second charge"
    );
}

/// The SAME call WITH a key IS retried, and the driver sees one key both times.
///
/// The pair to the test above: the rule is conditional, not "never retry". Pinned
/// on the KEY the driver received rather than on the outcome, which is the
/// convention the doc asks for at `:226` — *"the retry test must assert that the
/// driver received the same key twice, not merely that the call eventually
/// succeeded. A test that only checks the outcome passes on a double charge that
/// happens to return `Ok`."*
#[tokio::test]
async fn keyed_call_is_retried_and_the_driver_sees_one_key() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        1,
        PaymentError::Network("transient".into()),
    ));
    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };
    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: Some("charge-key-1".into()),
    };

    let res = resilient
        .authorize(&req)
        .await
        .expect("a keyed transient failure is safe to retry");
    assert!(res.success);
    assert_eq!(flaky.calls(), 2, "one failure, one successful retry");
    assert_eq!(
        flaky.keys_seen(),
        vec![Some("charge-key-1".to_string()); 2],
        "both attempts must carry the SAME gateway key, or the retry is a second charge"
    );
}
