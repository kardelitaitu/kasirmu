use super::*;

struct TestPrinter {
    info: DeviceInfo,
    last_body: std::sync::Mutex<Option<String>>,
}

impl TestPrinter {
    fn new() -> Self {
        Self {
            info: DeviceInfo::new("Test", "Printer", "SN001"),
            last_body: std::sync::Mutex::new(None),
        }
    }
}

#[async_trait]
impl ReceiptPrinter for TestPrinter {
    async fn print_receipt(&self, body: &str) -> Result<(), HalError> {
        *self.last_body.lock().unwrap() = Some(body.to_owned());
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[tokio::test]
async fn default_print_raw_converts_bytes_to_string_and_delegates() {
    let p = TestPrinter::new();
    let data: &[u8] = b"Hello, World!";
    p.print_raw(data).await.unwrap();
    let body = p.last_body.lock().unwrap().take().unwrap();
    assert_eq!(body, "Hello, World!");
}

#[tokio::test]
async fn default_print_raw_handles_utf8_lossy() {
    let p = TestPrinter::new();
    // Invalid UTF-8 bytes should be replaced lossily.
    let data: &[u8] = &[0x48, 0x65, 0x6C, 0x6C, 0x6F, 0xFF, 0xFE];
    p.print_raw(data).await.unwrap();
    let body = p.last_body.lock().unwrap().take().unwrap();
    assert!(
        body.starts_with("Hello"),
        "body should contain Hello: {body}"
    );
}

#[tokio::test]
async fn default_cut_is_no_op() {
    let p = TestPrinter::new();
    let result = p.cut().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn default_get_status_returns_ok() {
    // TestPrinter doesn't override get_status, so it uses the trait
    // default: paper Ok, cover closed, drawer closed.
    let p = TestPrinter::new();
    let status = p.get_status().await.unwrap();
    assert_eq!(status.paper, PaperStatus::Ok);
    assert!(!status.cover_open);
    assert!(!status.drawer_open);
    assert!(status.is_ready());
    assert!(!status.has_fault());
}

#[tokio::test]
async fn print_receipt_captures_body() {
    let p = TestPrinter::new();
    p.print_receipt("Test Receipt").await.unwrap();
    let body = p.last_body.lock().unwrap().take().unwrap();
    assert_eq!(body, "Test Receipt");
}

#[test]
fn device_info_returns_identity() {
    let p = TestPrinter::new();
    let info = p.device_info();
    assert_eq!(info.vendor, "Test");
    assert_eq!(info.model, "Printer");
    assert_eq!(info.serial, "SN001");
}
