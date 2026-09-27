/*
last audited 2026-09-25 by DSH-Agent
crate: kasirmu-hal | status: NEW | lint: CLEAN
findings: built under R8(iii) (owner, 2026-09-20) — the loopback terminal simulator, which needs no vendor. 11 tests, one per scripted behaviour. The FIRST draft was wrong in a way worth keeping on the record: it relied on the trait's default `sale()` (authorize + capture), so a scripted Decline was consumed by `authorize` and then approved by `capture` — a decline read as a successful sale. Two tests caught it; `sale()` is now overridden. A one-flag mock could not have expressed the difference, which is why the script is per-operation.
next: none while option (i) is blocked; the vendor codecs stay stubs until a spec or a capture exists for one named model.
perf: N/A — no I/O, no transport, no device.
*/
//! Loopback EDC terminal simulator — a card terminal with no vendor behind it.
//!
//! **Why this exists.** R8 (owner, 2026-09-20; `done-todo-owner-rulings.md:228`)
//! ruled option (iii): build the loopback simulator *now*, because it covers the
//! state machine — timeout, retry, cancel, receipt, and fail-closed on an
//! incomplete read — with no vendor at all. Option (i), a real codec, stays
//! blocked on a named model's spec or a single captured byte trace, and the
//! ruling is explicit that inventing framing from a plausible reading of a
//! third-party document is not an acceptable substitute: *"an invented codec
//! passes its own tests and fails at a counter."*
//!
//! **What it is NOT.** It is not a protocol codec and it does not pretend to
//! speak Telium, Verix or DCC. It models the *terminal* side of the
//! [`EdcTerminal`] trait, so the layers above it — the bridge's registry
//! lookup, the tender flow, the receipt path — can be driven end to end
//! without hardware. The vendor codecs in `super::protocol` remain stubs and
//! this module does not make them any less stubbed.
//!
//! **Why a script rather than a single armed flag.** The existing
//! `MockEdcTerminal` answers "does this path handle success" and "does it
//! handle failure". It cannot answer the questions a counter actually raises:
//! what happens when the terminal goes quiet mid-transaction, when the
//! operator retries the same sale, when a cancel arrives after the card was
//! already charged, or when the response is truncated. Those need a terminal
//! that can be told to behave badly in a *specific* way, which is what the
//! script below is.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use kasirmu_core::Money;

use crate::error::HalError;
use crate::traits::edc::{EdcPaymentResult, EdcTerminal, TerminalStatus};
use crate::types::DeviceInfo;

/// How one call against the simulator should behave.
///
/// Deliberately small and explicit: each variant is a case a real counter
/// produces, not a general-purpose mocking framework.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EdcBehaviour {
    /// Approve, with a transaction and auth code derived from the attempt
    /// number so a retry is visibly a different transaction.
    Approve,
    /// Decline with a reason, the way an issuer does.
    Decline {
        /// Human-readable reason.
        reason: String,
    },
    /// Charge successfully but never answer — the terminal went quiet. The
    /// caller's only correct move is to reconcile, not to retry blindly.
    TimeoutAfterCharge,
    /// Answer, but with a truncated frame. This is the case the ruling calls
    /// fail-closed on an incomplete read: bytes arrived, so a caller that
    /// treats "some bytes" as "an answer" would read a half-written record as
    /// an approval.
    TruncatedResponse,
    /// Report a hardware fault from the terminal itself.
    HardwareFault {
        /// Vendor-style error code.
        code: u32,
        /// Human-readable description.
        message: String,
    },
    /// Be unreachable — cable out, terminal off.
    Offline,
}

/// A scriptable card terminal with no vendor behind it.
///
/// Holds a queue of [`EdcBehaviour`]s consumed one per operation. When the
/// queue empties, behaviour falls back to the script's default, so a test can
/// script only the interesting call and let the rest be normal.
pub struct LoopbackEdcTerminal {
    info: DeviceInfo,
    script: Mutex<Vec<EdcBehaviour>>,
    default_behaviour: EdcBehaviour,
    attempts: AtomicUsize,
}

impl LoopbackEdcTerminal {
    /// A simulator that approves everything.
    #[must_use]
    pub fn new() -> Self {
        Self::with_script(Vec::new(), EdcBehaviour::Approve)
    }

    /// A simulator that plays `script` in order, then falls back to
    /// `default_behaviour`.
    #[must_use]
    pub fn with_script(script: Vec<EdcBehaviour>, default_behaviour: EdcBehaviour) -> Self {
        Self {
            info: DeviceInfo::new("loopback", "LoopbackEDC", "LOOPBACK-0000"),
            script: Mutex::new(script),
            default_behaviour,
            attempts: AtomicUsize::new(0),
        }
    }

    /// Append one behaviour to the end of the script.
    pub fn push(&self, behaviour: EdcBehaviour) {
        // INVARIANT: poisoned-mutex panic only — the mock convention in this
        // crate (see drivers/mock.rs), so a panicking test cannot leave a
        // simulator silently reporting a different plan than it was given.
        self.script
            .lock()
            .expect("loopback script poisoned")
            .push(behaviour);
    }

    /// How many operations have been attempted, including the ones that failed.
    ///
    /// Retry behaviour is the point of half this type's cases, and a caller
    /// cannot reason about a retry without knowing whether one happened.
    #[must_use]
    pub fn attempts(&self) -> usize {
        self.attempts.load(Ordering::SeqCst)
    }

    fn next_behaviour(&self) -> EdcBehaviour {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        // INVARIANT: the mutex guards a `Vec` push/remove only; no code path
        // can panic while holding it, so poisoning is impossible in practice.
        let mut script = self.script.lock().expect("loopback script poisoned");
        if script.is_empty() {
            self.default_behaviour.clone()
        } else {
            script.remove(0)
        }
    }

    fn approved(&self, attempt: usize) -> EdcPaymentResult {
        EdcPaymentResult {
            success: true,
            transaction_id: Some(format!("LOOPBACK-{attempt:04}")),
            auth_code: Some(format!("{:06}", 100000 + attempt)),
            card_scheme: Some("Visa".into()),
            card_last4: Some("4242".into()),
            message: "approved".into(),
        }
    }

    /// The shared outcome logic for a charge, so `authorize` and any caller
    /// cannot disagree about what a scripted behaviour means.
    fn result(&self) -> Result<EdcPaymentResult, HalError> {
        match self.next_behaviour() {
            EdcBehaviour::Approve => Ok(self.approved(self.attempts.load(Ordering::SeqCst))),
            EdcBehaviour::Decline { reason } => Ok(EdcPaymentResult {
                success: false,
                transaction_id: None,
                auth_code: None,
                card_scheme: None,
                card_last4: None,
                message: reason,
            }),
            // 30s mirrors the ordering flow's own wait; the point of the case is
            // the KIND, not the figure — `Timeout` is what tells the bridge to
            // reconcile rather than to retry.
            EdcBehaviour::TimeoutAfterCharge => Err(HalError::Timeout(30_000)),
            EdcBehaviour::TruncatedResponse => Err(HalError::Protocol(
                "loopback: response frame truncated — bytes arrived but the record is incomplete"
                    .into(),
            )),
            EdcBehaviour::HardwareFault { code, message } => Ok(EdcPaymentResult {
                success: false,
                transaction_id: None,
                auth_code: None,
                card_scheme: None,
                card_last4: None,
                message: format!("terminal fault {code}: {message}"),
            }),
            EdcBehaviour::Offline => Err(HalError::NotFound(
                "loopback terminal is unreachable".into(),
            )),
        }
    }
}

impl Default for LoopbackEdcTerminal {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl EdcTerminal for LoopbackEdcTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        // Status is not scripted: it is the one call an operator makes BEFORE
        // committing to a sale, and a scriptable status would let a test prove
        // a terminal is ready while the next charge is scripted to go quiet —
        // a contradiction the type should not be able to express.
        Ok(TerminalStatus::Ready)
    }

    async fn authorize(&self, _amount: Money) -> Result<String, HalError> {
        self.result().map(|r| {
            r.transaction_id
                .unwrap_or_else(|| "LOOPBACK-unknown".into())
        })
    }

    /// A native one-step sale, overriding the trait's `authorize` + `capture`
    /// default.
    ///
    /// **This override is load-bearing, and its absence was a real bug in the
    /// first draft of this file.** The default `sale` calls `authorize()` and
    /// then `capture()`, so a scripted `Decline` or `HardwareFault` was consumed
    /// by `authorize` — which returned a declined / faulted RESULT rather than
    /// an error — and `capture` then approved whatever transaction id it was
    /// handed. A scripted decline came back as a successful sale. Two tests
    /// caught it (`decline_returns_an_unsuccessful_result_not_an_error`,
    /// `hardware_fault_reports_the_terminal_code`), which is the whole reason
    /// the script drives per-operation behaviour rather than per-call arming:
    /// a one-flag mock cannot express "this sale declines" distinctly from
    /// "this capture succeeds", so it would have hidden the bug.
    async fn sale(&self, _amount: Money) -> Result<EdcPaymentResult, HalError> {
        self.result()
    }

    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        // Capture completes an authorisation the terminal already granted, so
        // it does not consume a scripted step and cannot be declined: the
        // expected outcome was settled when the authorisation was granted.
        // A capture with no authorisation fails closed, because capturing a
        // transaction that does not exist is how a sale gets charged twice.
        if transaction_id.is_empty() {
            return Err(HalError::Unsupported(
                "capture requires a transaction id from authorize()".into(),
            ));
        }
        Ok(self.approved(self.attempts.load(Ordering::SeqCst)))
    }

    async fn refund(
        &self,
        transaction_id: &str,
        _amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        if transaction_id.is_empty() {
            return Err(HalError::Unsupported(
                "refund requires a transaction id".into(),
            ));
        }
        match self.next_behaviour() {
            EdcBehaviour::Offline => Err(HalError::NotFound(
                "loopback terminal is unreachable".into(),
            )),
            EdcBehaviour::HardwareFault { code, message } => Ok(EdcPaymentResult {
                success: false,
                transaction_id: Some(transaction_id.to_owned()),
                auth_code: None,
                card_scheme: None,
                card_last4: None,
                message: format!("terminal fault {code}: {message}"),
            }),
            _ => Ok(self.approved(self.attempts.load(Ordering::SeqCst))),
        }
    }

    async fn void(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        if transaction_id.is_empty() {
            return Err(HalError::Unsupported(
                "void requires a transaction id".into(),
            ));
        }
        match self.next_behaviour() {
            EdcBehaviour::Offline => Err(HalError::NotFound(
                "loopback terminal is unreachable".into(),
            )),
            _ => Ok(EdcPaymentResult {
                success: true,
                transaction_id: Some(transaction_id.to_owned()),
                auth_code: None,
                card_scheme: None,
                card_last4: None,
                message: "voided".into(),
            }),
        }
    }

    async fn print_receipt(&self, transaction_id: &str) -> Result<Vec<u8>, HalError> {
        // Raw bytes, matching the trait's contract: shaping a customer-facing
        // receipt is kasirmu-payment's job. The prefix makes it obvious in a
        // failing assertion that these came from the simulator.
        Ok(format!("LOOPBACK-RECEIPT {transaction_id}\n").into_bytes())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "loopback_tests.rs"]
mod tests;
