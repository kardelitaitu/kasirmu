use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use foundation::Money;
use kasirmu_hal::types::DeviceInfo;

use super::*;
use crate::error::PaymentError;
use crate::processor::PaymentProcessor;

use crate::types::{PaymentPhase, PaymentReceipt, PaymentRequest, PaymentResult};

struct FlakyMockProcessor {
    call_count: AtomicU32,
    /// Counts for the keyless-parameter methods, which have no key to key on.
    capture_count: AtomicU32,
    void_count: AtomicU32,
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
            capture_count: AtomicU32::new(0),
            void_count: AtomicU32::new(0),
            fail_until_attempt,
            fail_with,
            keys_seen: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> u32 {
        self.call_count.load(Ordering::SeqCst)
    }

    /// How many times `capture` reached the driver.
    fn captures(&self) -> u32 {
        self.capture_count.load(Ordering::SeqCst)
    }

    /// How many times `void` reached the driver.
    fn voids(&self) -> u32 {
        self.void_count.load(Ordering::SeqCst)
    }

    /// The shared failure decision for a method with no key parameter.
    ///
    /// Reuses the same attempt budget as `authorize` so a decorator that retried
    /// `capture` would be visible as extra driver calls rather than as a different
    /// error.
    fn maybe_fail(&self) -> Result<(), PaymentError> {
        let count = self.call_count.fetch_add(1, Ordering::SeqCst) + 1;
        if count > self.fail_until_attempt {
            return Ok(());
        }
        // `PaymentError` is not `Clone`, so the variant is rebuilt exactly as
        // `authorize` above does it — the same conversion, not a second one.
        match &self.fail_with {
            PaymentError::Network(msg) => Err(PaymentError::Network(msg.clone())),
            PaymentError::Timeout(ms) => Err(PaymentError::Timeout(*ms)),
            PaymentError::Declined(msg) => Err(PaymentError::Declined(msg.clone())),
            other => Err(PaymentError::Unsupported(other.to_string())),
        }
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
                phase: PaymentPhase::Confirmed,
                transaction_id: Some("tx_123".into()),
                auth_code: Some("auth_ok".into()),
                amount_charged: Money::from_major(10, Self::usd()).unwrap(),
                message: Some("approved".into()),
            })
        }
    }

    async fn capture(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.capture_count.fetch_add(1, Ordering::SeqCst);
        self.maybe_fail()?;
        Ok(PaymentResult {
            success: true,
            phase: PaymentPhase::Confirmed,
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
            phase: PaymentPhase::Confirmed,
            transaction_id: Some("tx_ref".into()),
            auth_code: None,
            amount_charged: Money::from_major(10, Self::usd()).unwrap(),
            message: Some("refunded".into()),
        })
    }

    async fn void(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.void_count.fetch_add(1, Ordering::SeqCst);
        self.maybe_fail()?;
        Ok(PaymentResult {
            success: true,
            phase: PaymentPhase::Confirmed,
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
        // Two failed OPERATIONS trip the breaker. With §2 in force each keyless
        // operation is one call, so this is also a call count of two.
        failure_threshold: 2,
        cooldown_duration: Duration::from_millis(50),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    // Op 1: ONE call, because §2 makes a keyless money-mover single-shot — the
    // `max_retries: 1` above is deliberately unreachable on this request. That
    // retry/attempt distinction used to be invisible here (the comments claimed
    // "1 try + 1 retry = 2 calls"), which is worth pinning rather than describing:
    // a test whose comments disagree with its arithmetic is the same defect the
    // design doc names at `:177`, a green test that does not test what it says.
    let _ = resilient.authorize(&req).await;
    assert_eq!(
        flaky.calls(),
        1,
        "a keyless charge is forwarded once even with retries configured"
    );
    assert_eq!(resilient.breaker().state().await, CircuitState::Closed);

    // Op 2: one more call -> failure count 2 >= threshold -> trips Open.
    let _ = resilient.authorize(&req).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::Open);
    assert_eq!(flaky.calls(), 2, "one call per operation, two operations");

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
    assert!(
        success.allow_request().await.is_ok(),
        "the probe is admitted"
    );
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
    assert!(
        failed.allow_request().await.is_ok(),
        "the probe is admitted"
    );
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

// ── §8 row 3: capture and void are single-shot ────────────────────────

/// `capture` reaches the driver exactly ONCE even on a transient failure.
///
/// **Red-first, per the design doc's §8 row *"`capture`/`void` are single-shot"***
/// (`docs/plans/_active/payment-resilience-design.md:219`), marked **failing
/// today**.
///
/// `capture` takes a bare `transaction_id` and has **no key parameter**, so a
/// retry after a timeout has nothing the gateway could dedupe on — it would
/// capture the same authorisation twice. The doc names this consequence at `:117`
/// and calls the resulting behaviour change a REDUCTION rather than an
/// improvement, which is why it is worth an assertion instead of a comment.
///
/// The count is the evidence: a test asserting only `is_err()` would pass on a
/// decorator that captured twice and reported the second failure.
#[tokio::test]
async fn capture_is_single_shot_even_on_a_transient_failure() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        5,
        PaymentError::Network("connection dropped mid-capture".into()),
    ));
    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };
    let resilient = ResilientProcessor::with_config(flaky.clone(), config);

    let res = resilient.capture("tx_123").await;
    assert!(matches!(res, Err(PaymentError::Network(_))));
    assert_eq!(
        flaky.captures(),
        1,
        "a keyless capture must not be retried: a second attempt can double-capture"
    );
}

/// `void` likewise reaches the driver exactly once.
///
/// The companion to the capture case, and separate because they are separate
/// methods with separate call sites: a fix applied to one is not evidence about
/// the other, and this is the pair that would catch a future edit routing one of
/// them back through the retry budget.
#[tokio::test]
async fn void_is_single_shot_even_on_a_transient_failure() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        5,
        PaymentError::Network("connection dropped mid-void".into()),
    ));
    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };
    let resilient = ResilientProcessor::with_config(flaky.clone(), config);

    let res = resilient.void("tx_123").await;
    assert!(matches!(res, Err(PaymentError::Network(_))));
    assert_eq!(
        flaky.voids(),
        1,
        "a keyless void must not be retried: a second attempt can re-void a settled sale"
    );
}

// ── §8 row 5: two decorators over one gateway share one breaker ────────

/// Two decorators built with one breaker TRIP TOGETHER.
///
/// **Red-first, per the design doc's §8 row *"two decorators over one gateway
/// share one breaker"*** (`docs/plans/_active/payment-resilience-design.md:221`),
/// marked **failing today** — `with_config` built its own, so the doc's §4 says the
/// API "actively prevents the right design" (`:161`). `with_shared_breaker` is that
/// seam.
///
/// **Why the sharing is the requirement and not a convenience.** A breaker is a
/// statement about ONE gateway's health. If two decorators fronting the same
/// gateway keep private counters, each needs `failure_threshold` failures before
/// either fails fast — so a gateway that is genuinely down takes twice as long to
/// stop being hammered, and the second decorator keeps sending traffic into a
/// known-bad endpoint. The threshold stops meaning what §4 says it means.
///
/// Asserted from the OUTSIDE, through the public `breaker()` handle: a test that
/// reached into private state would still pass if the two decorators shared a
/// counter but not the state machine the callers consult.
#[tokio::test]
async fn two_decorators_over_one_gateway_share_one_breaker() {
    let config = ResilientProcessorConfig {
        max_retries: 0,
        initial_backoff_ms: 1,
        max_backoff_ms: 2,
        failure_threshold: 2,
        cooldown_duration: Duration::from_secs(10),
    };
    let shared = Arc::new(CircuitBreaker::new(
        config.failure_threshold,
        config.cooldown_duration,
    ));

    let a = ResilientProcessor::with_shared_breaker(
        Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1))),
        config.clone(),
        shared.clone(),
    );
    let b = ResilientProcessor::with_shared_breaker(
        Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1))),
        config,
        shared.clone(),
    );

    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: Some("shared-key".into()),
    };

    // One failure each — two in total, which is the SHARED threshold.
    let _ = a.authorize(&req).await;
    assert_eq!(
        a.breaker().state().await,
        CircuitState::Closed,
        "one failure is below the shared threshold"
    );
    let _ = b.authorize(&req).await;

    // Both now see Open: B's failure carried A over the line, which can only
    // happen if the counter is shared.
    assert_eq!(
        a.breaker().state().await,
        CircuitState::Open,
        "A must observe the failure B contributed — a private breaker would still read Closed"
    );
    assert_eq!(b.breaker().state().await, CircuitState::Open);
}

/// The counter-evidence: decorators built the ordinary way do NOT share.
///
/// Without this, the test above could pass on an implementation that made every
/// breaker global — which would be worse than the defect, because then ONE
/// tenant's revoked credential would fail fast for every tenant on the platform
/// (the exact scenario §4 is written to prevent). Pinning the isolation half keeps
/// the sharing a deliberate opt-in.
#[tokio::test]
async fn separately_built_decorators_do_not_share_a_breaker() {
    let config = ResilientProcessorConfig {
        max_retries: 0,
        initial_backoff_ms: 1,
        max_backoff_ms: 2,
        failure_threshold: 2,
        cooldown_duration: Duration::from_secs(10),
    };
    let a = ResilientProcessor::with_config(
        Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1))),
        config.clone(),
    );
    let b = ResilientProcessor::with_config(
        Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1))),
        config,
    );

    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: Some("isolated-key".into()),
    };

    let _ = a.authorize(&req).await;
    let _ = b.authorize(&req).await;
    assert_eq!(
        a.breaker().state().await,
        CircuitState::Closed,
        "each decorator counts its own failures: one each is below a threshold of two"
    );
    assert_eq!(b.breaker().state().await, CircuitState::Closed);
}

// ── The two §2 rules must agree end to end ─────────────────────────────

/// A DERIVED key is retryable, and a blank one is not — the composition.
///
/// **Why this test exists.** §2's rule is enforced in two places that were written
/// at different times: `policy_for_key` here decides retryability from the key the
/// request carries, and `payment_api.rs` decides what key a charge carries at all
/// (deriving `qris-{tenant}-{sale_id}` when the caller sends none OR a blank).
/// Each is tested alone. Nothing tested them **together**, and the failure mode if
/// they disagree is silent: a key the API derives but this file classifies as
/// blank would be single-shot (losing a safe retry), and a blank the API forwards
/// while this file classified it as keyed would be retried (a second charge).
///
/// The derived shape is reproduced literally from `payment_api.rs` rather than
/// imported, because the two crates are separate and the point is the SHAPE the
/// derivation produces. If the format changes there without changing here, this
/// test is what says so.
#[test]
fn a_derived_gateway_key_is_retryable_and_a_blank_one_is_not() {
    // The shape `payment_api.rs` builds: `qris-{tenant}-{sale_id}`.
    let derived = format!("qris-{}-{}", "tenant-A", "sale-1");
    assert_eq!(
        policy_for_key(Some(&derived)),
        RetryPolicy::Keyed,
        "a key the charge endpoint DERIVES must be retryable, or the derivation buys nothing"
    );
    // And the caller's own key, which the endpoint prefers when non-blank.
    assert_eq!(policy_for_key(Some("caller-key")), RetryPolicy::Keyed);
    // The three ways a key can be absent, all single-shot.
    assert_eq!(policy_for_key(None), RetryPolicy::SingleShot);
    assert_eq!(policy_for_key(Some("")), RetryPolicy::SingleShot);
    assert_eq!(
        policy_for_key(Some("   ")),
        RetryPolicy::SingleShot,
        "whitespace is absent: the driver sanitises it to an empty order_id"
    );
    // The derived shape is never blank, which is the property the pair relies on.
    assert!(!derived.trim().is_empty());
}
