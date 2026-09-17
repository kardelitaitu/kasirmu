use super::*;
use crate::mock::MockNotificationClient;
use oz_core::events::SaleCompletedLine;
use tokio::time::Duration;

/// Poll the mock until it has sent at least `expected` messages, sleeping
/// 1 ms between checks, with a 2 s deadline. This is faster than a fixed
/// sleep (the spawned task often completes in <1 ms) and more robust on
/// loaded CI (a deadline instead of a blind wait).
async fn wait_for_messages(mock: &MockNotificationClient, expected: usize) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    loop {
        if mock.sent_count() >= expected {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

#[tokio::test]
async fn order_confirmation_sends_message() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = OrderConfirmationHandler::new(mock.clone(), Some("+6281234567890"));

    let event = SaleCompleted {
        sale_id: "sale-1".into(),
        store_id: None,
        line_items: vec![SaleCompletedLine {
            sku: "COFFEE".into(),
            qty: 2,
            unit_price_minor: 350,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 700,
        currency: "IDR".into(),
        customer_id: None,
    };

    handler.handle(&event).unwrap();

    wait_for_messages(&mock, 1).await;

    let msgs = mock.sent_messages();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].to, "+6281234567890");
    assert_eq!(msgs[0].template_name, "order_confirmed");
    assert!(msgs[0].parameters_json.contains("sale-1"));
    assert!(msgs[0].parameters_json.contains("IDR"));
}

#[tokio::test]
async fn order_confirmation_skips_when_no_phone() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = OrderConfirmationHandler::new(mock.clone(), None::<String>);

    let event = SaleCompleted {
        sale_id: "sale-no-phone".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 100,
        currency: "IDR".into(),
        customer_id: None,
    };

    // Should return Ok without sending anything.
    handler.handle(&event).unwrap();

    // No messages should have been sent.
    wait_for_messages(&mock, 0).await;
    assert_eq!(mock.sent_count(), 0);
}

#[tokio::test]
async fn stock_low_alert_sends_when_below_threshold() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = StockLowAlertHandler::new(mock.clone(), 5, "+6289876543210");

    let event = StockAdjusted {
        sku: "COFFEE".into(),
        delta: -1,
        new_qty: 3,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();
    wait_for_messages(&mock, 1).await;

    let msgs = mock.sent_messages();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].to, "+6289876543210");
    assert_eq!(msgs[0].template_name, "low_stock_alert");
    assert!(msgs[0].parameters_json.contains("COFFEE"));
    assert!(msgs[0].parameters_json.contains("3"));
}

#[tokio::test]
async fn stock_low_alert_skips_when_above_threshold() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = StockLowAlertHandler::new(mock.clone(), 5, "+62");

    let event = StockAdjusted {
        sku: "TEA".into(),
        delta: -2,
        new_qty: 98,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();
    wait_for_messages(&mock, 0).await;

    // No alert — stock is still plenty.
    assert_eq!(mock.sent_count(), 0);
}

#[tokio::test]
async fn stock_low_alert_at_exact_threshold() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = StockLowAlertHandler::new(mock.clone(), 5, "+62");

    let event = StockAdjusted {
        sku: "MILK".into(),
        delta: -95,
        new_qty: 5,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();
    wait_for_messages(&mock, 1).await;

    // At threshold (≤ 5), alert should fire.
    assert_eq!(mock.sent_count(), 1);
}

#[tokio::test]
async fn stock_low_alert_zero_stock_fires() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = StockLowAlertHandler::new(mock.clone(), 3, "+62");

    let event = StockAdjusted {
        sku: "SUGAR".into(),
        delta: -10,
        new_qty: 0,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();
    wait_for_messages(&mock, 1).await;

    let msgs = mock.sent_messages();
    assert_eq!(msgs.len(), 1);
    assert!(msgs[0].parameters_json.contains("OUT OF STOCK"));
}

#[tokio::test]
async fn payment_receipt_sends_message() {
    let mock = Arc::new(MockNotificationClient::new());
    let handler = PaymentReceiptHandler::new(mock.clone(), "+628111222333");

    let event = SaleCompleted {
        sale_id: "sale-receipt-1".into(),
        store_id: None,
        line_items: vec![SaleCompletedLine {
            sku: "LATTE".into(),
            qty: 1,
            unit_price_minor: 45000,
            tax_minor: 4500,
            tax_rate_id: Some("tax-ppn".into()),
        }],
        total_minor: 49500,
        currency: "IDR".into(),
        customer_id: Some("cust-1".into()),
    };

    handler.handle(&event).unwrap();
    wait_for_messages(&mock, 1).await;

    let msgs = mock.sent_messages();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].to, "+628111222333");
    assert_eq!(msgs[0].template_name, "payment_receipt");
    assert!(msgs[0].parameters_json.contains("sale-receipt-1"));
    assert!(msgs[0].parameters_json.contains("IDR"));
}

#[tokio::test]
async fn multiple_handlers_on_same_event() {
    let mock = Arc::new(MockNotificationClient::new());
    let order_handler = OrderConfirmationHandler::new(mock.clone(), Some("+628111111111"));
    let receipt_handler = PaymentReceiptHandler::new(mock.clone(), "+628222222222");

    let event = SaleCompleted {
        sale_id: "sale-multi".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 999,
        currency: "IDR".into(),
        customer_id: None,
    };

    order_handler.handle(&event).unwrap();
    receipt_handler.handle(&event).unwrap();
    wait_for_messages(&mock, 2).await;

    let msgs = mock.sent_messages();
    // Both handlers use the same mock, so 2 messages.
    assert_eq!(msgs.len(), 2);
    assert!(msgs.iter().any(|m| m.template_name == "order_confirmed"));
    assert!(msgs.iter().any(|m| m.template_name == "payment_receipt"));
}

#[tokio::test]
async fn handler_logs_error_when_client_fails() {
    let mock = Arc::new(MockNotificationClient::new());
    mock.set_should_fail(true);
    mock.set_fail_message("network timeout");

    let handler = OrderConfirmationHandler::new(mock.clone(), Some("+62"));

    let event = SaleCompleted {
        sale_id: "sale-fail".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 100,
        currency: "IDR".into(),
        customer_id: None,
    };

    // Handler itself returns Ok (fire-and-forget).
    handler.handle(&event).unwrap();

    // The spawned task will have logged the error — message not recorded.
    wait_for_messages(&mock, 0).await;
    assert_eq!(mock.sent_count(), 0);
}
