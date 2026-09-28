//! Tests for the loopback EDC simulator.
//!
//! **One test per behaviour the ruling names**, so a variant added to
//! [`EdcBehaviour`] without a case here is a gap a reader can see rather than
//! infer. The cases are the counter's, not the type's: a charge that goes
//! quiet, a retry that must be distinguishable, a cancel after the money
//! moved, a truncated frame.

use super::*;

fn idr(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: kasirmu_core::Currency(*b"IDR"),
    }
}

/// The default simulator approves, and each attempt is a DISTINCT transaction.
///
/// Distinctness matters beyond tidiness: a retry that returns the first
/// attempt's id is indistinguishable from the network replaying an old
/// answer, which is the failure mode a real terminal's transaction ids exist
/// to prevent.
#[tokio::test]
async fn default_simulator_approves_with_distinct_transaction_ids() {
    let t = LoopbackEdcTerminal::new();
    let first = t.sale(idr(15000)).await.expect("armed simulator approves");
    let second = t.sale(idr(15000)).await.expect("armed simulator approves");
    assert!(first.success && second.success);
    assert_ne!(
        first.transaction_id, second.transaction_id,
        "two charges must not share a transaction id"
    );
    assert_eq!(t.attempts(), 2);
}

/// A declined card is a RESULT, not an error: the terminal answered.
///
/// The distinction is load-bearing for the caller — an error means retry or
/// reconcile, a decline means ask for another card — so a simulator that
/// reported a decline as `Err` would let a caller's wrong branch pass.
#[tokio::test]
async fn decline_returns_an_unsuccessful_result_not_an_error() {
    let t = LoopbackEdcTerminal::with_script(
        vec![EdcBehaviour::Decline {
            reason: "insufficient funds".into(),
        }],
        EdcBehaviour::Approve,
    );
    let r = t.sale(idr(15000)).await.expect("a decline is an answer");
    assert!(!r.success);
    assert_eq!(r.message, "insufficient funds");
    assert!(
        r.transaction_id.is_none(),
        "a declined sale has no transaction"
    );
}

/// The terminal goes quiet AFTER the charge — the case that must not be
/// retried blindly.
///
/// This is the whole reason the ruling wanted a state-machine simulator: a
/// timeout carries no information about whether the card was charged, so the
/// only safe caller behaviour is to reconcile. The error kind is asserted, not
/// just the failure, because `Timeout` is what tells the bridge to reconcile
/// while `NotFound` would tell it the terminal is absent.
#[tokio::test]
async fn timeout_after_charge_is_a_timeout_and_not_a_silent_success() {
    let t = LoopbackEdcTerminal::with_script(
        vec![EdcBehaviour::TimeoutAfterCharge],
        EdcBehaviour::Approve,
    );
    let r = t.sale(idr(15000)).await;
    assert!(
        matches!(r, Err(HalError::Timeout(_))),
        "a quiet terminal must surface as a timeout, got {r:?}"
    );
    // And the NEXT call still works: a timeout is not a poisoned terminal.
    assert!(t.sale(idr(15000)).await.is_ok());
}

/// A truncated frame fails closed, as `Protocol`, rather than reading as an
/// approval.
///
/// The ruling calls this out by name ("fail-closed on an incomplete read").
/// Bytes did arrive, so a caller that treated "some bytes" as "an answer"
/// would walk an approved-payment path on a half-written record.
#[tokio::test]
async fn truncated_response_fails_closed() {
    let t = LoopbackEdcTerminal::with_script(
        vec![EdcBehaviour::TruncatedResponse],
        EdcBehaviour::Approve,
    );
    let r = t.sale(idr(15000)).await;
    assert!(
        matches!(r, Err(HalError::Protocol(_))),
        "an incomplete read must fail closed, got {r:?}"
    );
}

/// An unreachable terminal is `NotFound`, which is what makes the bridge
/// report `Hardware`, not a payment failure.
#[tokio::test]
async fn offline_terminal_is_not_found() {
    let t = LoopbackEdcTerminal::with_script(vec![EdcBehaviour::Offline], EdcBehaviour::Approve);
    let r = t.sale(idr(15000)).await;
    assert!(matches!(r, Err(HalError::NotFound(_))), "got {r:?}");
}

/// A hardware fault is a terminal-reported failure, carrying its code.
#[tokio::test]
async fn hardware_fault_reports_the_terminal_code() {
    let t = LoopbackEdcTerminal::with_script(
        vec![EdcBehaviour::HardwareFault {
            code: 42,
            message: "printer jam".into(),
        }],
        EdcBehaviour::Approve,
    );
    let r = t.sale(idr(15000)).await.expect("a fault is an answer");
    assert!(!r.success);
    assert!(
        r.message.contains("42") && r.message.contains("printer jam"),
        "the fault code and message must both survive, got {:?}",
        r.message
    );
}

/// Cancel after the money moved: the script runs in ORDER, so a timeout
/// followed by a void is a cancel of a sale the terminal never confirmed.
#[tokio::test]
async fn script_runs_in_order_so_a_cancel_follows_the_timeout_it_cancels() {
    let t = LoopbackEdcTerminal::with_script(
        vec![EdcBehaviour::TimeoutAfterCharge, EdcBehaviour::Approve],
        EdcBehaviour::Approve,
    );
    assert!(matches!(
        t.sale(idr(15000)).await,
        Err(HalError::Timeout(_))
    ));
    let void = t
        .void("LOOPBACK-0001")
        .await
        .expect("void reaches the terminal");
    assert!(void.success);
    assert_eq!(t.attempts(), 2, "both operations consumed a scripted step");
}

/// The script drains and then the default takes over, so a test scripts only
/// the interesting call.
#[tokio::test]
async fn script_drains_then_default_applies() {
    let t = LoopbackEdcTerminal::with_script(vec![EdcBehaviour::Offline], EdcBehaviour::Approve);
    assert!(t.sale(idr(1000)).await.is_err(), "scripted step");
    assert!(t.sale(idr(1000)).await.is_ok(), "default after drain");
    assert!(t.sale(idr(1000)).await.is_ok(), "default persists");
}

/// Capture and refund refuse an empty transaction id.
///
/// Capturing a transaction that does not exist is how a sale is charged
/// twice, so this is the one guard in the type that is about money rather
/// than about fidelity to a vendor.
#[tokio::test]
async fn capture_and_refund_require_a_transaction_id() {
    let t = LoopbackEdcTerminal::new();
    assert!(matches!(t.capture("").await, Err(HalError::Unsupported(_))));
    assert!(matches!(
        t.refund("", None).await,
        Err(HalError::Unsupported(_))
    ));
    assert!(matches!(t.void("").await, Err(HalError::Unsupported(_))));
}

/// The receipt is raw bytes naming the transaction, per the trait contract.
#[tokio::test]
async fn receipt_is_raw_bytes_for_the_transaction() {
    let t = LoopbackEdcTerminal::new();
    let bytes = t.print_receipt("LOOPBACK-0007").await.expect("prints");
    let text = String::from_utf8(bytes).expect("the simulator emits UTF-8");
    assert!(text.contains("LOOPBACK-0007"), "got {text:?}");
}

/// `status` is always `Ready`, and is deliberately NOT scripted.
///
/// If status could be scripted, a test could assert a terminal is ready while
/// the next charge is scripted to time out — a contradiction the type should
/// not be able to express.
#[tokio::test]
async fn status_is_always_ready_and_not_scriptable() {
    let t = LoopbackEdcTerminal::with_script(vec![EdcBehaviour::Offline], EdcBehaviour::Approve);
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);
    assert_eq!(t.attempts(), 0, "status must not consume a scripted step");
}
