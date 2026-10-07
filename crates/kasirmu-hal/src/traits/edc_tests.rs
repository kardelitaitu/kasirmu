use std::sync::Mutex;

use kasirmu_core::Currency;

use super::*;

fn usd(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "USD".parse::<Currency>().unwrap(),
    }
}

/// Minimal terminal that records the order it is called in, so the
/// trait's default `sale` chain can be asserted.
struct TestTerminal {
    info: DeviceInfo,
    calls: Mutex<Vec<String>>,
    fail_authorize: bool,
}

impl TestTerminal {
    fn new() -> Self {
        Self {
            info: DeviceInfo::new("Test", "EDC", "SN001"),
            calls: Mutex::new(Vec::new()),
            fail_authorize: false,
        }
    }

    fn failing_authorize() -> Self {
        Self {
            info: DeviceInfo::new("Test", "EDC", "SN001"),
            calls: Mutex::new(Vec::new()),
            fail_authorize: true,
        }
    }

    fn recorded(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

fn approved(id: &str) -> EdcPaymentResult {
    EdcPaymentResult {
        success: true,
        transaction_id: Some(id.to_owned()),
        auth_code: Some("001234".into()),
        card_scheme: Some("Visa".into()),
        card_last4: Some("1111".into()),
        message: "approved".into(),
    }
}

#[async_trait]
impl EdcTerminal for TestTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        Ok(TerminalStatus::Ready)
    }

    async fn authorize(&self, _amount: Money, reference: Option<&str>) -> Result<String, HalError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("authorize:{}", reference.unwrap_or("none")));
        if self.fail_authorize {
            Err(HalError::Unsupported("declined at auth".into()))
        } else {
            Ok("txn-42".into())
        }
    }

    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.calls.lock().unwrap().push("capture".into());
        Ok(approved(transaction_id))
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        Ok(approved("refund-1"))
    }

    async fn void(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        Ok(approved("void-1"))
    }

    async fn settle(&self) -> Result<EdcSettlementResult, HalError> {
        self.calls.lock().unwrap().push("settle".into());
        Ok(EdcSettlementResult {
            success: true,
            batch_number: Some("000001".into()),
            transaction_count: 5,
            total_amount: Some(usd(5000)),
            message: "settlement ok".into(),
        })
    }

    async fn inquiry(&self, invoice: &str) -> Result<EdcPaymentResult, HalError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("inquiry:{invoice}"));
        Ok(approved("inquiry-txn-42"))
    }

    async fn print_receipt(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Ok(vec![0x1B, 0x40])
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[tokio::test]
async fn default_sale_chains_authorize_then_capture() {
    let t = TestTerminal::new();
    let result = t.sale(usd(1000), Some("INV-001")).await.unwrap();
    assert_eq!(
        t.recorded(),
        vec!["authorize:INV-001".to_string(), "capture".to_string()],
        "sale must authorize with reference before capturing"
    );
    assert!(result.success);
    assert_eq!(result.transaction_id.as_deref(), Some("txn-42"));
}

#[tokio::test]
async fn default_sale_propagates_authorize_failure_without_capturing() {
    let t = TestTerminal::failing_authorize();
    let err = t.sale(usd(1000), None).await.unwrap_err();
    assert!(
        matches!(err, HalError::Unsupported(_)),
        "expected Unsupported, got {err:?}"
    );
    assert_eq!(
        t.recorded(),
        vec!["authorize:none".to_string()],
        "a failed authorization must never reach capture"
    );
}

#[tokio::test]
async fn settle_and_inquiry_methods_work() {
    let t = TestTerminal::new();
    let settle_res = t.settle().await.unwrap();
    assert!(settle_res.success);
    assert_eq!(settle_res.batch_number.as_deref(), Some("000001"));
    assert_eq!(settle_res.transaction_count, 5);

    let inq_res = t.inquiry("INV-999").await.unwrap();
    assert!(inq_res.success);
    assert_eq!(
        t.recorded(),
        vec!["settle".to_string(), "inquiry:INV-999".to_string()]
    );
}

#[tokio::test]
async fn unsupported_error_keeps_its_message_and_discriminant() {
    let t = TestTerminal::failing_authorize();
    let err = t.authorize(usd(100), None).await.unwrap_err();
    assert!(
        matches!(err.kind(), crate::error::HalErrorKind::Unsupported),
        "expected the Unsupported discriminant, got {:?}",
        err.kind()
    );
    assert!(
        err.to_string().contains("declined at auth"),
        "message must survive into Display: {err}"
    );
}

#[test]
fn terminal_status_serializes_camel_case_for_ipc() {
    // Mirrors EdcTerminalStatus in ui/src/api/edc.ts. The desktop command
    // used to hand-roll this mapping over five match arms.
    let enc = |s: TerminalStatus| serde_json::to_string(&s).unwrap();
    assert_eq!(enc(TerminalStatus::Ready), "\"ready\"");
    assert_eq!(enc(TerminalStatus::Busy), "\"busy\"");
    assert_eq!(enc(TerminalStatus::Offline), "\"offline\"");
    assert_eq!(enc(TerminalStatus::PaperError), "\"paperError\"");
    assert_eq!(enc(TerminalStatus::Error), "\"error\"");
}

#[test]
fn terminal_status_round_trips() {
    let json = serde_json::to_string(&TerminalStatus::PaperError).unwrap();
    let back: TerminalStatus = serde_json::from_str(&json).unwrap();
    assert_eq!(back, TerminalStatus::PaperError);
}

#[test]
fn edc_payment_result_serializes_camel_case_for_ipc() {
    let json = serde_json::to_string(&approved("txn-1")).unwrap();
    // Mirrors EdcResult in ui/src/api/edc.ts.
    assert!(json.contains("\"transactionId\":\"txn-1\""), "{json}");
    assert!(json.contains("\"authCode\":\"001234\""), "{json}");
    assert!(json.contains("\"cardScheme\":\"Visa\""), "{json}");
    assert!(json.contains("\"cardLast4\":\"1111\""), "{json}");
    assert!(json.contains("\"success\":true"), "{json}");
}

#[test]
fn is_available_only_when_ready() {
    assert!(TerminalStatus::Ready.is_available());
    assert!(!TerminalStatus::Busy.is_available());
    assert!(!TerminalStatus::Offline.is_available());
    assert!(!TerminalStatus::PaperError.is_available());
    assert!(!TerminalStatus::Error.is_available());
}

#[test]
fn device_info_returns_identity() {
    let t = TestTerminal::new();
    let info = t.device_info();
    assert_eq!(info.vendor, "Test");
    assert_eq!(info.model, "EDC");
    assert_eq!(info.serial, "SN001");
}
