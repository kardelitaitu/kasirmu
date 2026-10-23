use std::sync::Arc;
use std::time::Duration;

use kasirmu_core::Money;

use super::*;
use crate::drivers::edc::loopback::{EdcBehaviour, LoopbackEdcTerminal};

fn idr(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: kasirmu_core::Currency(*b"IDR"),
    }
}

fn fast_config(threshold: u32, cooldown_ms: u64, timeout_ms: u64) -> ResilientEdcConfig {
    ResilientEdcConfig {
        failure_threshold: threshold,
        cooldown_duration: Duration::from_millis(cooldown_ms),
        timeout_duration: Duration::from_millis(timeout_ms),
    }
}

#[tokio::test]
async fn normal_sale_approval_passes_through() {
    let sim = Arc::new(LoopbackEdcTerminal::new());
    let resilient = ResilientEdcTerminal::new(sim);

    let res = resilient.sale(idr(50000), Some("INV-001")).await;
    assert!(res.is_ok(), "normal sale should succeed");
    let result = res.unwrap();
    assert!(result.success);
    assert_eq!(result.transaction_id, Some("LOOPBACK-INV-001".into()));
    assert_eq!(resilient.state().await, CircuitState::Closed);
}

#[tokio::test]
async fn business_decline_does_not_trip_breaker() {
    let sim = Arc::new(LoopbackEdcTerminal::with_script(
        vec![],
        EdcBehaviour::Decline {
            reason: "insufficient funds".into(),
        },
    ));
    let resilient = ResilientEdcTerminal::with_config(sim, fast_config(3, 100, 100));

    // Execute 5 declined sales
    for _ in 0..5 {
        let res = resilient.sale(idr(50000), None).await;
        assert!(res.is_ok(), "business decline returns Ok(EdcPaymentResult)");
        let result = res.unwrap();
        assert!(!result.success);
        assert_eq!(result.message, "insufficient funds");
    }

    // Circuit breaker remains Closed because declines are valid business outcomes, not communication errors
    assert_eq!(resilient.state().await, CircuitState::Closed);
}

#[tokio::test]
async fn consecutive_timeouts_trip_circuit_breaker_to_open_and_fail_fast() {
    let sim = Arc::new(LoopbackEdcTerminal::with_script(
        vec![],
        EdcBehaviour::TimeoutAfterCharge,
    ));
    let resilient = ResilientEdcTerminal::with_config(sim, fast_config(3, 150, 100));

    // First failure
    let err1 = resilient.sale(idr(10000), None).await.unwrap_err();
    assert!(matches!(err1, HalError::Timeout(_)));
    assert_eq!(resilient.state().await, CircuitState::Closed);

    // Second failure
    let err2 = resilient.sale(idr(10000), None).await.unwrap_err();
    assert!(matches!(err2, HalError::Timeout(_)));
    assert_eq!(resilient.state().await, CircuitState::Closed);

    // Third failure -> trips breaker
    let err3 = resilient.sale(idr(10000), None).await.unwrap_err();
    assert!(matches!(err3, HalError::Timeout(_)));
    assert_eq!(resilient.state().await, CircuitState::Open);

    // Fourth call fails fast immediately
    let start = std::time::Instant::now();
    let err4 = resilient.sale(idr(10000), None).await.unwrap_err();
    let elapsed = start.elapsed();

    assert!(matches!(err4, HalError::Timeout(0)));
    assert!(
        elapsed < Duration::from_millis(20),
        "Open breaker must fail fast without waiting for timeout window"
    );
}

#[tokio::test]
async fn cooldown_transitions_to_half_open_and_single_probe_recovers() {
    let sim = Arc::new(LoopbackEdcTerminal::with_script(
        vec![
            EdcBehaviour::TimeoutAfterCharge,
            EdcBehaviour::TimeoutAfterCharge,
        ],
        EdcBehaviour::Approve,
    ));
    let resilient = ResilientEdcTerminal::with_config(sim.clone(), fast_config(2, 60, 50));

    // Trip breaker to Open
    let _ = resilient.sale(idr(10000), None).await;
    let _ = resilient.sale(idr(10000), None).await;
    assert_eq!(resilient.state().await, CircuitState::Open);

    // Wait for cooldown window
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(resilient.state().await, CircuitState::HalfOpen);

    // Probe call succeeds -> closes breaker
    let res = resilient.sale(idr(10000), None).await;
    assert!(res.is_ok());
    assert_eq!(resilient.state().await, CircuitState::Closed);
}

#[tokio::test]
async fn failed_probe_immediately_reopens_breaker() {
    let sim = Arc::new(LoopbackEdcTerminal::with_script(
        vec![],
        EdcBehaviour::TimeoutAfterCharge,
    ));
    let resilient = ResilientEdcTerminal::with_config(sim, fast_config(2, 60, 50));

    // Trip breaker
    let _ = resilient.sale(idr(10000), None).await;
    let _ = resilient.sale(idr(10000), None).await;
    assert_eq!(resilient.state().await, CircuitState::Open);

    // Wait for cooldown
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(resilient.state().await, CircuitState::HalfOpen);

    // Probe call fails -> immediately re-opens breaker
    let res = resilient.sale(idr(10000), None).await;
    assert!(res.is_err());
    assert_eq!(resilient.state().await, CircuitState::Open);
}

#[tokio::test]
async fn timeout_wrapping_slow_terminal_operation() {
    let sim = Arc::new(LoopbackEdcTerminal::new());
    // Artificial latency of 200ms
    sim.set_delay(Some(Duration::from_millis(200)));

    // Timeout ceiling of 50ms
    let resilient = ResilientEdcTerminal::with_config(sim, fast_config(3, 100, 50));

    let err = resilient.sale(idr(10000), None).await.unwrap_err();
    assert!(matches!(err, HalError::Timeout(50)));
}
