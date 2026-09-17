/*
last audited 25-07-26 by RSA-Agent (oz-hal slice C: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unsafe. Covers all 6 HAL traits as of the EDC move (31-08-26): barcode, printer, drawer, display, scale, edc, so the mandatory-mock rule in AGENTS.md still holds crate-wide. MockEdcTerminal fails closed until set_success(): an unarmed mock cannot exercise an approved-payment path, which is the property worth having on a money device. The lock().expect("mock poisoned") calls are the only panic paths and are confined to test doubles, matching the pre-existing style here.
next: none | perf: N/A — test doubles only
*/
//! Mock implementations of every HAL trait.
//!
//! Mocks are **stateful** and **programmable**: tests push inputs, then
//! assert what the rest of the system did with them. Call counters
//! (`connect_calls`, `poll_calls`, …) make assertions trivial.
//!
//! Mocks implement the same trait as the real driver — no special
//! "mock mode" in business code.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use oz_core::Money;

use crate::error::HalError;
use crate::traits::barcode::BarcodeScanner;
use crate::traits::cash_drawer::CashDrawer;
use crate::traits::customer_display::{CustomerDisplay, DisplayContent};
use crate::traits::edc::{EdcPaymentResult, EdcTerminal, TerminalStatus};
use crate::traits::printer::{PaperStatus, PrinterStatus, ReceiptPrinter};
use crate::traits::weight_scale::{WeightReading, WeightScale};
use crate::types::{Barcode, DeviceInfo};

// --- Barcode scanner mock -----------------------------------------------

/// Programmable mock for `BarcodeScanner`. Tests push scans into the
/// queue; the mock returns them in order.
#[derive(Clone)]
pub struct MockBarcodeScanner {
    queue: Arc<Mutex<VecDeque<Barcode>>>,
    /// Number of times `connect` has been called.
    pub connect_calls: Arc<AtomicUsize>,
    /// Number of times `poll` has been called.
    pub poll_calls: Arc<AtomicUsize>,
    /// Number of times `cancel` has been called.
    pub cancel_calls: Arc<AtomicUsize>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
}

impl MockBarcodeScanner {
    /// Construct a mock with default identity `("mock", "MockBarcode", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockBarcode", "0000"))
    }

    /// Construct a mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            connect_calls: Arc::new(AtomicUsize::new(0)),
            poll_calls: Arc::new(AtomicUsize::new(0)),
            cancel_calls: Arc::new(AtomicUsize::new(0)),
            info,
        }
    }

    /// Queue a barcode to be returned by the next `poll`.
    pub fn push(&self, code: Barcode) {
        self.queue
            .lock()
            .expect("mock queue poisoned") // SAFETY: mock driver — lock poison is the intended failure signal; data behind it is irrelevant in a test double
            .push_back(code);
    }

    /// Number of queued scans (for assertions).
    #[must_use]
    pub fn queue_len(&self) -> usize {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        self.queue.lock().expect("mock queue poisoned").len()
    }
}

impl Default for MockBarcodeScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BarcodeScanner for MockBarcodeScanner {
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        self.connect_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(self.clone()))
    }

    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        self.poll_calls.fetch_add(1, Ordering::SeqCst);
        // Honour timeout by short-circuiting when the queue is empty.
        // A real driver would block on a USB/BT channel.
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        if self.queue.lock().expect("mock queue poisoned").is_empty() {
            if timeout_ms == 0 {
                return Ok(None);
            }
            let sleep_ms = u64::from(timeout_ms.min(50));
            tokio::time::sleep(std::time::Duration::from_millis(sleep_ms)).await;
        }
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        Ok(self.queue.lock().expect("mock queue poisoned").pop_front())
    }

    async fn cancel(&self) -> Result<(), HalError> {
        self.cancel_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// --- Receipt printer mock -----------------------------------------------

/// Programmable mock for `ReceiptPrinter`. Captures every printed body
/// so tests can assert what the system tried to print.
#[derive(Clone)]
pub struct MockReceiptPrinter {
    /// Captured receipt body strings from `print_receipt` calls.
    pub printed: Arc<Mutex<Vec<String>>>,
    /// Captured raw bytes from `print_raw` calls.
    pub printed_raw: Arc<Mutex<Vec<Vec<u8>>>>,
    /// Number of times `cut` has been called.
    pub cut_calls: Arc<AtomicUsize>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
    /// If set, every `print_receipt` returns this error instead of Ok.
    pub fail_with: Arc<Mutex<Option<HalError>>>,
    /// Programmable printer status returned by `get_status()`.
    /// Defaults to `PrinterStatus { paper: Ok, cover_open: false, drawer_open: false }`.
    pub status: Arc<Mutex<PrinterStatus>>,
}

impl MockReceiptPrinter {
    /// Construct a mock with default identity `("mock", "MockPrinter", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockPrinter", "0000"))
    }

    /// Construct a mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            printed: Arc::new(Mutex::new(Vec::new())),
            printed_raw: Arc::new(Mutex::new(Vec::new())),
            cut_calls: Arc::new(AtomicUsize::new(0)),
            info,
            fail_with: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(PrinterStatus {
                paper: PaperStatus::Ok,
                cover_open: false,
                drawer_open: false,
            })),
        }
    }

    /// Program the next `print_receipt` to return `err` (and any
    /// subsequent calls until cleared).
    pub fn set_next_error(&self, err: HalError) {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.fail_with.lock().expect("poisoned") = Some(err);
    }

    /// Set the printer status returned by `get_status()`.
    pub fn set_status(&self, status: PrinterStatus) {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.status.lock().expect("poisoned") = status;
    }
}

impl Default for MockReceiptPrinter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ReceiptPrinter for MockReceiptPrinter {
    async fn print_receipt(&self, body: &str) -> Result<(), HalError> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        if let Some(err) = self.fail_with.lock().expect("poisoned").take() {
            return Err(err);
        }
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        self.printed.lock().expect("poisoned").push(body.to_owned());
        Ok(())
    }

    async fn print_raw(&self, data: &[u8]) -> Result<(), HalError> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        if let Some(err) = self.fail_with.lock().expect("poisoned").take() {
            return Err(err);
        }
        self.printed_raw
            .lock()
            .expect("poisoned") // SAFETY: mock driver — lock poison is the intended failure signal in a test double
            .push(data.to_vec());
        Ok(())
    }

    async fn cut(&self) -> Result<(), HalError> {
        self.cut_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn get_status(&self) -> Result<PrinterStatus, HalError> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        Ok(self.status.lock().expect("poisoned").clone())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// --- Customer display mock ---------------------------------------------

/// Programmable mock for `CustomerDisplay`. Records the last content
/// pushed and supports brightness control.
#[derive(Clone)]
pub struct MockCustomerDisplay {
    /// Number of times `show` has been called.
    pub show_calls: Arc<AtomicUsize>,
    /// Number of times `clear` has been called.
    pub clear_calls: Arc<AtomicUsize>,
    last_content: Arc<Mutex<Option<DisplayContent>>>,
    brightness: Arc<Mutex<f32>>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
}

impl MockCustomerDisplay {
    /// Construct a mock with default identity `("mock", "MockDisplay", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockDisplay", "0000"))
    }

    /// Construct a mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            show_calls: Arc::new(AtomicUsize::new(0)),
            clear_calls: Arc::new(AtomicUsize::new(0)),
            last_content: Arc::new(Mutex::new(None)),
            brightness: Arc::new(Mutex::new(1.0)),
            info,
        }
    }

    /// The last content that was shown on the display.
    pub fn last_content(&self) -> Option<DisplayContent> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        self.last_content.lock().expect("poisoned").clone()
    }

    /// Current brightness level.
    #[must_use]
    pub fn brightness(&self) -> f32 {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.brightness.lock().expect("poisoned")
    }
}

impl Default for MockCustomerDisplay {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CustomerDisplay for MockCustomerDisplay {
    async fn connect(&self) -> Result<Box<dyn CustomerDisplay>, HalError> {
        Ok(Box::new(self.clone()))
    }

    async fn show(&self, content: &DisplayContent) -> Result<(), HalError> {
        self.show_calls.fetch_add(1, Ordering::SeqCst);
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.last_content.lock().expect("poisoned") = Some(content.clone());
        Ok(())
    }

    async fn clear(&self) -> Result<(), HalError> {
        self.clear_calls.fetch_add(1, Ordering::SeqCst);
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.last_content.lock().expect("poisoned") = None;
        Ok(())
    }

    async fn set_brightness(&self, level: f32) -> Result<(), HalError> {
        let clamped = level.clamp(0.0, 1.0);
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.brightness.lock().expect("poisoned") = clamped;
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// --- Cash drawer mock ---------------------------------------------------

/// Programmable mock for `CashDrawer`. Counts `open` calls; can be
/// programmed to fail or to report drawer-open state.
#[derive(Clone)]
pub struct MockCashDrawer {
    /// Number of times `open` has been called.
    pub open_calls: Arc<AtomicUsize>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
    /// If set, the next `open` call returns this error.
    pub fail_with: Arc<Mutex<Option<HalError>>>,
    /// Programmable response for `is_open()`. `None` means "use the
    /// trait default" (which returns `Disconnected`). Set to
    /// `Some(Ok(true))` to simulate an open drawer, etc.
    is_open_response: Arc<Mutex<Option<Result<bool, HalError>>>>,
}

impl MockCashDrawer {
    /// Construct a mock with default identity `("mock", "MockDrawer", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockDrawer", "0000"))
    }

    /// Construct a mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            open_calls: Arc::new(AtomicUsize::new(0)),
            info,
            fail_with: Arc::new(Mutex::new(None)),
            is_open_response: Arc::new(Mutex::new(None)),
        }
    }

    /// Program the next `open` to return `err` (consumed on first call).
    pub fn set_next_error(&self, err: HalError) {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.fail_with.lock().expect("poisoned") = Some(err);
    }

    /// Program what `is_open()` returns.
    ///
    /// Pass `None` to revert to the trait default (`Disconnected`).
    /// Pass `Some(Ok(true))` for an open drawer, `Some(Ok(false))` for
    /// a closed one, or `Some(Err(...))` to simulate a hardware error.
    pub fn set_is_open(&self, response: Option<Result<bool, HalError>>) {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        *self.is_open_response.lock().expect("poisoned") = response;
    }
}

impl Default for MockCashDrawer {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CashDrawer for MockCashDrawer {
    async fn open(&self) -> Result<(), HalError> {
        self.open_calls.fetch_add(1, Ordering::SeqCst);
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double
        if let Some(err) = self.fail_with.lock().expect("poisoned").take() {
            return Err(err);
        }
        Ok(())
    }

    async fn is_open(&self) -> Result<bool, HalError> {
        // SAFETY: mock driver — lock poison is the intended failure signal
        match self.is_open_response.lock().expect("poisoned").clone() {
            Some(response) => response,
            None => {
                // Fall through to the trait default: most drawers don't
                // report state, so this is the realistic default.
                Err(HalError::Disconnected)
            }
        }
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// --- Weight scale mock ---------------------------------------------------

/// Programmable mock for `WeightScale`. Always returns a stable zero reading.
#[derive(Clone)]
pub struct MockWeightScale {
    /// Number of times `read_weight` has been called.
    pub read_calls: Arc<AtomicUsize>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
}

impl MockWeightScale {
    /// Construct a mock with default identity `("mock", "MockScale", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockScale", "0000"))
    }

    /// Construct a mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            read_calls: Arc::new(AtomicUsize::new(0)),
            info,
        }
    }
}

impl Default for MockWeightScale {
    fn default() -> Self {
        Self::new()
    }
}

impl WeightScale for MockWeightScale {
    fn read_weight(&self) -> Result<WeightReading, HalError> {
        self.read_calls.fetch_add(1, Ordering::SeqCst);
        Ok(WeightReading {
            weight_grams: 0.0,
            stable: true,
        })
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// --- EDC payment terminal mock --------------------------------------------

/// Programmable mock for `EdcTerminal`.
///
/// **Fails closed:** until [`set_success`](Self::set_success) is called,
/// every operation returns `HalError::Unsupported`. A test that forgets to
/// arm the mock therefore cannot accidentally walk an approved-payment path,
/// which is the property that matters for a money-accepting device.
///
/// [`set_status`](Self::set_status) forces a specific [`TerminalStatus`] so
/// the offline / paper-error / busy UI states can be exercised without
/// hardware.
#[derive(Clone)]
pub struct MockEdcTerminal {
    success: Arc<AtomicBool>,
    forced_status: Arc<Mutex<Option<TerminalStatus>>>,
    /// Number of times `authorize` has been called.
    pub authorize_calls: Arc<AtomicUsize>,
    /// Number of times `capture` has been called.
    pub capture_calls: Arc<AtomicUsize>,
    /// Number of times `sale` has been called.
    pub sale_calls: Arc<AtomicUsize>,
    /// Number of times `refund` has been called.
    pub refund_calls: Arc<AtomicUsize>,
    /// Number of times `void` has been called.
    pub void_calls: Arc<AtomicUsize>,
    /// Number of times `print_receipt` has been called.
    pub print_calls: Arc<AtomicUsize>,
    /// Device identity reported by `device_info()`.
    pub info: DeviceInfo,
}

impl MockEdcTerminal {
    /// Construct an unarmed mock (every operation fails closed) with default
    /// identity `("mock", "MockEDC", "0000")`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_info(DeviceInfo::new("mock", "MockEDC", "0000"))
    }

    /// Construct an unarmed mock with custom identity.
    #[must_use]
    pub fn with_info(info: DeviceInfo) -> Self {
        Self {
            success: Arc::new(AtomicBool::new(false)),
            forced_status: Arc::new(Mutex::new(None)),
            authorize_calls: Arc::new(AtomicUsize::new(0)),
            capture_calls: Arc::new(AtomicUsize::new(0)),
            sale_calls: Arc::new(AtomicUsize::new(0)),
            refund_calls: Arc::new(AtomicUsize::new(0)),
            void_calls: Arc::new(AtomicUsize::new(0)),
            print_calls: Arc::new(AtomicUsize::new(0)),
            info,
        }
    }

    /// Arm the mock: authorize, capture, sale, refund and void now succeed.
    pub fn set_success(&self) {
        self.success.store(true, Ordering::SeqCst);
    }

    /// Disarm the mock, returning it to the fail-closed default.
    pub fn set_failure(&self) {
        self.success.store(false, Ordering::SeqCst);
    }

    /// Whether the mock is armed.
    #[must_use]
    pub fn is_armed(&self) -> bool {
        self.success.load(Ordering::SeqCst)
    }

    /// Force [`status`](Self::status) to report `Some(status)` regardless of
    /// arming; pass `None` to go back to the derived behaviour.
    pub fn set_status(&self, status: Option<TerminalStatus>) {
        // INVARIANT: panics only on mutex poisoning, i.e. if another thread
        // panicked while writing an `Option<TerminalStatus>`. Deliberate: this
        // mock's lock semantics match the other `expect("mock poisoned")` sites
        // here, and silently adopting `into_inner()` on a poisoned lock would be
        // a behaviour change to a shipped driver.
        *self.forced_status.lock().expect("mock poisoned") = status;
    }

    fn approved(&self, id: &str, auth: &str, message: &str) -> EdcPaymentResult {
        EdcPaymentResult {
            success: true,
            transaction_id: Some(id.to_owned()),
            auth_code: Some(auth.to_owned()),
            card_scheme: Some("Visa".into()),
            card_last4: Some("1111".into()),
            message: message.to_owned(),
        }
    }

    fn unsupported(&self, method: &str) -> HalError {
        HalError::Unsupported(format!("mock EDC {method} — not armed; call set_success()"))
    }
}

impl Default for MockEdcTerminal {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl EdcTerminal for MockEdcTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        // INVARIANT: poisoned-mutex panic only; see `set_status` for why this
        // mock does not swallow it.
        if let Some(forced) = *self.forced_status.lock().expect("mock poisoned") {
            return Ok(forced);
        }
        if self.is_armed() {
            Ok(TerminalStatus::Ready)
        } else {
            Err(self.unsupported("status"))
        }
    }

    async fn authorize(&self, _amount: Money) -> Result<String, HalError> {
        self.authorize_calls.fetch_add(1, Ordering::SeqCst);
        if self.is_armed() {
            Ok("mock-txn-001".into())
        } else {
            Err(self.unsupported("authorize"))
        }
    }

    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.capture_calls.fetch_add(1, Ordering::SeqCst);
        if self.is_armed() {
            Ok(self.approved(transaction_id, "MOCKAUTH", "approved"))
        } else {
            Err(self.unsupported("capture"))
        }
    }

    async fn sale(&self, amount: Money) -> Result<EdcPaymentResult, HalError> {
        self.sale_calls.fetch_add(1, Ordering::SeqCst);
        let txn_id = self.authorize(amount).await?;
        self.capture(&txn_id).await
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        self.refund_calls.fetch_add(1, Ordering::SeqCst);
        if self.is_armed() {
            Ok(EdcPaymentResult {
                success: true,
                transaction_id: Some("mock-refund-001".into()),
                auth_code: Some("MOCKREF".into()),
                card_scheme: None,
                card_last4: None,
                message: "refund approved".into(),
            })
        } else {
            Err(self.unsupported("refund"))
        }
    }

    async fn void(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.void_calls.fetch_add(1, Ordering::SeqCst);
        if self.is_armed() {
            Ok(EdcPaymentResult {
                success: true,
                transaction_id: Some("mock-void-001".into()),
                auth_code: None,
                card_scheme: None,
                card_last4: None,
                message: "void approved".into(),
            })
        } else {
            Err(self.unsupported("void"))
        }
    }

    async fn print_receipt(&self, transaction_id: &str) -> Result<Vec<u8>, HalError> {
        self.print_calls.fetch_add(1, Ordering::SeqCst);
        if self.is_armed() {
            // ESC/POS init followed by the transaction id — a plausible raw
            // device receipt without pretending to model a printer.
            let mut buf = vec![0x1B, 0x40];
            buf.extend_from_slice(transaction_id.as_bytes());
            Ok(buf)
        } else {
            Err(self.unsupported("print_receipt"))
        }
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "mock_tests.rs"]
mod tests;
