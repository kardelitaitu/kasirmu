use super::*;
use crate::drivers::mock::MockCashDrawer;

#[tokio::test]
async fn default_is_open_returns_disconnected() {
    let d = MockCashDrawer::new();
    let result = d.is_open().await;
    assert!(matches!(result, Err(HalError::Disconnected)));
}
