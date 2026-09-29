/*
last audited 2026-09-29 by Antigravity
crate: kasirmu-hal | status: VERIFIED | lint: CLEAN
findings: built under R8(iii) and updated under R7 — the loopback terminal simulator.
Supports URI-based configuration (from_address), programmable status simulation (set_status),
artificial processing latency (set_delay), and wire protocol frame codec verification via LoopbackCodec.
next: vendor-specific codecs
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
use std::time::Duration;

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

/// Parse a simulator address URI into an initial behaviour, status, and delay.
fn parse_loopback_uri(
    address: &str,
) -> (EdcBehaviour, Option<TerminalStatus>, Option<Duration>) {
    let trimmed = address.trim();
    let without_prefix = trimmed
        .strip_prefix("loopback://")
        .or_else(|| trimmed.strip_prefix("loopback:"))
        .unwrap_or(trimmed);

    let (path, query) = match without_prefix.split_once('?') {
        Some((p, q)) => (p.trim_matches('/'), Some(q)),
        None => (without_prefix.trim_matches('/'), None),
    };

    let mut reason = "card declined".to_string();
    let mut code = 42u32;
    let mut message = "terminal hardware fault".to_string();
    let mut delay = None;

    if let Some(q) = query {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                let decoded_v = v.replace('+', " ").replace("%20", " ").replace('_', " ");
                match k.trim() {
                    "reason" => reason = decoded_v,
                    "code" => {
                        if let Ok(c) = decoded_v.parse::<u32>() {
                            code = c;
                        }
                    }
                    "msg" | "message" => message = decoded_v,
                    "delay_ms" => {
                        if let Ok(ms) = decoded_v.parse::<u64>() {
                            delay = Some(Duration::from_millis(ms));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let (behaviour, status) = match path.to_ascii_lowercase().as_str() {
        "decline" => (EdcBehaviour::Decline { reason }, None),
        "timeout" => (EdcBehaviour::TimeoutAfterCharge, None),
        "offline" => (EdcBehaviour::Offline, Some(TerminalStatus::Offline)),
        "fault" => (EdcBehaviour::HardwareFault { code, message }, None),
        "truncated" => (EdcBehaviour::TruncatedResponse, None),
        "busy" => (EdcBehaviour::Approve, Some(TerminalStatus::Busy)),
        "paper_error" | "paper" => (EdcBehaviour::Approve, Some(TerminalStatus::PaperError)),
        _ => (EdcBehaviour::Approve, None),
    };

    (behaviour, status, delay)
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
    forced_status: Mutex<Option<TerminalStatus>>,
    delay: Mutex<Option<Duration>>,
}

impl LoopbackEdcTerminal {
    /// A simulator that approves everything.
    #[must_use]
    pub fn new() -> Self {
        Self::with_script(Vec::new(), EdcBehaviour::Approve)
    }

    /// Construct a simulator from a configuration address string (URI).
    ///
    /// Supports:
    /// - `"loopback"` or `"loopback://"` or `"loopback://approve"`: default approving terminal.
    /// - `"loopback://decline"` or `"loopback://decline?reason=..."`: declines card payments.
    /// - `"loopback://timeout"`: times out after charging (simulates quiet terminal).
    /// - `"loopback://offline"`: reports offline status and rejects operations.
    /// - `"loopback://fault"` or `"loopback://fault?code=42&message=..."`: reports hardware fault.
    /// - `"loopback://truncated"`: returns truncated response frame.
    /// - `"loopback://busy"`: reports busy status.
    /// - Optional query parameter `delay_ms`: artificial processing latency in milliseconds.
    #[must_use]
    pub fn from_address(address: &str) -> Self {
        let (behaviour, status, delay) = parse_loopback_uri(address);
        let terminal = Self::with_script(Vec::new(), behaviour);
        terminal.set_status(status);
        terminal.set_delay(delay);
        terminal
    }

    /// A simulator that plays `script` in order, then falls back to
    /// `default_behaviour`.
    #[must_use]
    pub fn with_script(script: Vec<EdcBehaviour>, default_behaviour: EdcBehaviour) -> Self {
        let initial_status = if default_behaviour == EdcBehaviour::Offline {
            Some(TerminalStatus::Offline)
        } else {
            None
        };
        Self {
            info: DeviceInfo::new("loopback", "LoopbackEDC", "LOOPBACK-0000"),
            script: Mutex::new(script),
            default_behaviour,
            attempts: AtomicUsize::new(0),
            forced_status: Mutex::new(initial_status),
            delay: Mutex::new(None),
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

    /// Force [`status`](Self::status) to report `Some(status)` regardless of
    /// scripted behaviour; pass `None` to revert to derived behaviour.
    pub fn set_status(&self, status: Option<TerminalStatus>) {
        *self.forced_status.lock().expect("loopback status lock poisoned") = status;
    }

    /// Set an artificial delay before operations complete to simulate cardholder
    /// interactions or network latency.
    pub fn set_delay(&self, delay: Option<Duration>) {
        *self.delay.lock().expect("loopback delay lock poisoned") = delay;
    }

    /// Access the standard framing codec for wire protocol testing.
    #[must_use]
    pub fn codec(&self) -> super::protocol::LoopbackCodec {
        super::protocol::LoopbackCodec
    }

    async fn apply_delay(&self) {
        let d = *self.delay.lock().expect("loopback delay lock poisoned");
        if let Some(duration) = d {
            tokio::time::sleep(duration).await;
        }
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
        self.apply_delay().await;
        if let Some(forced) = *self.forced_status.lock().expect("loopback status lock poisoned") {
            return Ok(forced);
        }
        if self.default_behaviour == EdcBehaviour::Offline {
            return Ok(TerminalStatus::Offline);
        }
        Ok(TerminalStatus::Ready)
    }

    async fn authorize(&self, _amount: Money) -> Result<String, HalError> {
        self.apply_delay().await;
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
        self.apply_delay().await;
        self.result()
    }

    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.apply_delay().await;
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
        self.apply_delay().await;
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
        self.apply_delay().await;
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
        self.apply_delay().await;
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
