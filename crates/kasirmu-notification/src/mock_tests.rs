use super::*;

#[tokio::test]
async fn mock_sends_and_records() {
    let client = MockNotificationClient::new();
    assert_eq!(client.sent_count(), 0);

    let status = client
        .send_template(
            "+6281234567890",
            "order_confirmed",
            &[TemplateParameter::text("Coffee")],
            Some("id"),
        )
        .await
        .unwrap();

    assert!(status.accepted);
    assert!(status.message_id.is_some());
    assert_eq!(client.sent_count(), 1);

    let msgs = client.sent_messages();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].to, "+6281234567890");
    assert_eq!(msgs[0].template_name, "order_confirmed");
    assert_eq!(msgs[0].language, Some("id".into()));
}

#[tokio::test]
async fn mock_send_text_records_as_text() {
    let client = MockNotificationClient::new();
    client
        .send_text("+6281234567890", "Your order is ready!")
        .await
        .unwrap();

    let msgs = client.sent_messages();
    assert_eq!(msgs[0].template_name, "text");
    assert!(msgs[0].parameters_json.contains("order is ready"));
}

#[tokio::test]
async fn mock_should_fail_returns_error() {
    let client = MockNotificationClient::new();
    client.set_should_fail(true);
    client.set_fail_message("invalid auth token");

    let result = client
        .send_template("+6281234567890", "order_confirmed", &[], None)
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("invalid auth token"));
    assert_eq!(client.sent_count(), 0);
}

#[tokio::test]
async fn mock_clear_removes_messages() {
    let client = MockNotificationClient::new();
    client.send_text("+621", "msg1").await.unwrap();
    client.send_text("+622", "msg2").await.unwrap();
    assert_eq!(client.sent_count(), 2);

    client.clear();
    assert_eq!(client.sent_count(), 0);
}

#[tokio::test]
async fn mock_verify_webhook_always_ok() {
    let client = MockNotificationClient::new();
    assert!(
        client
            .verify_webhook_signature(b"payload", "sha256=abc")
            .unwrap()
    );
}

#[tokio::test]
async fn mock_multiple_templates() {
    let client = MockNotificationClient::new();
    client
        .send_template(
            "+621",
            "order_confirmed",
            &[
                TemplateParameter::text("Order #1"),
                TemplateParameter::currency("IDR", 50000),
            ],
            Some("id"),
        )
        .await
        .unwrap();

    client
        .send_template(
            "+622",
            "payment_receipt",
            &[TemplateParameter::text("Receipt #42")],
            None,
        )
        .await
        .unwrap();

    let msgs = client.sent_messages();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].template_name, "order_confirmed");
    assert_eq!(msgs[1].template_name, "payment_receipt");
}
