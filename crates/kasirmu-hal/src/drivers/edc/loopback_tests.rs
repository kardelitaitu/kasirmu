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
    let first = t.sale(idr(15000), None).await.expect("armed simulator approves");
    let second = t.sale(idr(15000), None).await.expect("armed simulator approves");
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
    let r = t.sale(idr(15000), None).await.expect("a decline is an answer");
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
    let r = t.sale(idr(15000), None).await;
    assert!(
        matches!(r, Err(HalError::Timeout(_))),
        "a quiet terminal must surface as a timeout, got {r:?}"
    );
    // And the NEXT call still works: a timeout is not a poisoned terminal.
    assert!(t.sale(idr(15000), None).await.is_ok());
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
    let r = t.sale(idr(15000), None).await;
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
    let r = t.sale(idr(15000), None).await;
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
    let r = t.sale(idr(15000), None).await.expect("a fault is an answer");
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
        t.sale(idr(15000), None).await,
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
    assert!(t.sale(idr(1000), None).await.is_err(), "scripted step");
    assert!(t.sale(idr(1000), None).await.is_ok(), "default after drain");
    assert!(t.sale(idr(1000), None).await.is_ok(), "default persists");
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

/// `status` is `Ready` by default when default_behaviour is Approve.
#[tokio::test]
async fn status_is_always_ready_and_not_scriptable() {
    let t = LoopbackEdcTerminal::with_script(vec![EdcBehaviour::Offline], EdcBehaviour::Approve);
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);
    assert_eq!(t.attempts(), 0, "status must not consume a scripted step");
}

/// from_address parses default "loopback" as an approving simulator.
#[tokio::test]
async fn from_address_default_approves() {
    let t = LoopbackEdcTerminal::from_address("loopback");
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);
    let r = t.sale(idr(50000), None).await.expect("approves");
    assert!(r.success);
}

/// from_address parses decline with reason query parameter.
#[tokio::test]
async fn from_address_decline_with_reason() {
    let t = LoopbackEdcTerminal::from_address("loopback://decline?reason=card_expired");
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);
    let r = t.sale(idr(50000), None).await.expect("decline is a response");
    assert!(!r.success);
    assert_eq!(r.message, "card expired");
}

/// from_address parses timeout simulation.
#[tokio::test]
async fn from_address_timeout() {
    let t = LoopbackEdcTerminal::from_address("loopback://timeout");
    let r = t.sale(idr(10000), None).await;
    assert!(matches!(r, Err(HalError::Timeout(_))));
}

/// from_address parses offline terminal.
#[tokio::test]
async fn from_address_offline() {
    let t = LoopbackEdcTerminal::from_address("loopback://offline");
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Offline);
    let r = t.sale(idr(10000), None).await;
    assert!(matches!(r, Err(HalError::NotFound(_))));
}

/// from_address parses hardware fault with code and message.
#[tokio::test]
async fn from_address_hardware_fault() {
    let t = LoopbackEdcTerminal::from_address("loopback://fault?code=88&msg=sensor_broken");
    let r = t.sale(idr(10000), None).await.expect("fault is a response");
    assert!(!r.success);
    assert!(r.message.contains("88"));
    assert!(r.message.contains("sensor broken"));
}

/// from_address parses busy status.
#[tokio::test]
async fn from_address_busy() {
    let t = LoopbackEdcTerminal::from_address("loopback://busy");
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Busy);
}

/// set_status dynamically forces a status report.
#[tokio::test]
async fn dynamic_status_override() {
    let t = LoopbackEdcTerminal::new();
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);

    t.set_status(Some(TerminalStatus::PaperError));
    assert_eq!(t.status().await.unwrap(), TerminalStatus::PaperError);

    t.set_status(Some(TerminalStatus::Busy));
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Busy);

    t.set_status(None);
    assert_eq!(t.status().await.unwrap(), TerminalStatus::Ready);
}

/// Artificial latency delay slows down execution.
#[tokio::test]
async fn artificial_delay_slows_execution() {
    let t = LoopbackEdcTerminal::new();
    t.set_delay(Some(std::time::Duration::from_millis(30)));

    let start = tokio::time::Instant::now();
    let _ = t.sale(idr(1000), None).await;
    assert!(start.elapsed() >= std::time::Duration::from_millis(25));
}

/// Loopback terminal supports batch settlement and transaction inquiry.
#[tokio::test]
async fn loopback_settle_and_inquiry_support() {
    let t = LoopbackEdcTerminal::new();
    // 1. Settle
    let settle_res = t.settle().await.expect("settlement succeeds");
    assert!(settle_res.success);
    assert!(settle_res.batch_number.is_some());
    assert_eq!(settle_res.message, "settlement ok");

    // 2. Inquiry with invoice
    let inq_res = t.inquiry("INV-2026-001").await.expect("inquiry succeeds");
    assert!(inq_res.success);
    assert_eq!(
        inq_res.transaction_id.as_deref(),
        Some("LOOPBACK-INQ-INV-2026-001")
    );
    assert_eq!(inq_res.message, "approved");

    // 3. Inquiry fails on empty invoice
    let empty_inq = t.inquiry("").await;
    assert!(matches!(empty_inq, Err(HalError::Unsupported(_))));
}

/// Sale with invoice reference attaches the reference to the transaction id.
#[tokio::test]
async fn sale_with_reference_attaches_invoice_to_transaction_id() {
    let t = LoopbackEdcTerminal::new();
    let res = t
        .sale(idr(25000), Some("BILL-777"))
        .await
        .expect("sale succeeds");
    assert!(res.success);
    assert_eq!(res.transaction_id.as_deref(), Some("LOOPBACK-BILL-777"));
}

/// LoopbackCodec frame encoding and decoding roundtrip.
#[test]
fn loopback_codec_frame_roundtrip() {
    use super::super::protocol::{LoopbackCodec, ProtocolCodec, ProtocolMessage};

    let codec = LoopbackCodec;
    assert_eq!(codec.vendor(), "loopback");

    // Test encode sale request
    let wire_sale = codec
        .encode_sale(idr(25000), "INV-1001")
        .expect("encodes sale");
    assert_eq!(wire_sale[0], 0x02, "must start with STX");
    assert_eq!(wire_sale[wire_sale.len() - 2], 0x03, "must end with ETX");
    // Verify LRC
    let expected_lrc = LoopbackCodec::calculate_lrc(&wire_sale[3..wire_sale.len() - 1]);
    assert_eq!(wire_sale[wire_sale.len() - 1], expected_lrc, "LRC check");

    // Test decode approval response
    let wire_resp = LoopbackCodec::encode_sale_approved("TXN-9999", "AUTH88", "Mastercard", "5555");
    let decoded = codec.decode(&wire_resp).expect("decodes approval");
    match decoded {
        ProtocolMessage::Authorised {
            transaction_id,
            auth_code,
            card_scheme,
            card_last4,
        } => {
            assert_eq!(transaction_id, "TXN-9999");
            assert_eq!(auth_code, "AUTH88");
            assert_eq!(card_scheme.as_deref(), Some("Mastercard"));
            assert_eq!(card_last4.as_deref(), Some("5555"));
        }
        other => panic!("expected Authorised, got {other:?}"),
    }

    // Test decode decline response
    let wire_dec = LoopbackCodec::encode_sale_declined("insufficient funds");
    let decoded_dec = codec.decode(&wire_dec).expect("decodes decline");
    match decoded_dec {
        ProtocolMessage::Declined { reason } => {
            assert_eq!(reason.as_deref(), Some("insufficient funds"));
        }
        other => panic!("expected Declined, got {other:?}"),
    }

    // Test decode error response
    let wire_err = LoopbackCodec::encode_error(104, "printer head overheat");
    let decoded_err = codec.decode(&wire_err).expect("decodes error");
    match decoded_err {
        ProtocolMessage::Error { code, message } => {
            assert_eq!(code, 104);
            assert_eq!(message, "printer head overheat");
        }
        other => panic!("expected Error, got {other:?}"),
    }

    // Test decode ready status response
    let wire_ready = LoopbackCodec::encode_ready();
    let decoded_ready = codec.decode(&wire_ready).expect("decodes ready");
    assert!(matches!(decoded_ready, ProtocolMessage::Ready));
}

/// LoopbackCodec fails closed on corrupted LRC checksum.
#[test]
fn loopback_codec_fails_on_corrupted_lrc() {
    use super::super::protocol::{LoopbackCodec, ProtocolCodec};

    let codec = LoopbackCodec;
    let mut frame = LoopbackCodec::encode_sale_approved("TXN-1", "A1", "Visa", "4242");
    let last = frame.len() - 1;
    frame[last] ^= 0xFF; // corrupt checksum

    let err = codec.decode(&frame).unwrap_err();
    assert!(matches!(err, HalError::Protocol(_)));
    assert!(err.to_string().contains("LRC checksum mismatch"));
}

/// LoopbackCodec fails closed on truncated frame.
#[test]
fn loopback_codec_fails_on_truncated_frame() {
    use super::super::protocol::{LoopbackCodec, ProtocolCodec};

    let codec = LoopbackCodec;
    let frame = LoopbackCodec::encode_sale_approved("TXN-1", "A1", "Visa", "4242");
    let truncated = &frame[..frame.len() - 5];

    let err = codec.decode(truncated).unwrap_err();
    assert!(matches!(err, HalError::Protocol(_)));
    assert!(err.to_string().contains("truncated"));
}

/// LoopbackCodec fails closed on invalid STX.
#[test]
fn loopback_codec_fails_on_invalid_stx() {
    use super::super::protocol::{LoopbackCodec, ProtocolCodec};

    let codec = LoopbackCodec;
    let mut frame = LoopbackCodec::encode_sale_approved("TXN-1", "A1", "Visa", "4242");
    frame[0] = 0xFF; // bad STX

    let err = codec.decode(&frame).unwrap_err();
    assert!(matches!(err, HalError::Protocol(_)));
    assert!(err.to_string().contains("invalid loopback framing"));
}
