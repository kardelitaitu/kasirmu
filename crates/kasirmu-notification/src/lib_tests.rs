use super::*;

#[test]
fn template_parameter_text() {
    let p = TemplateParameter::text("Hello World");
    assert_eq!(p.param_type, "text");
    assert_eq!(p.text, Some("Hello World".into()));
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["type"], "text");
    assert_eq!(json["text"], "Hello World");
}

#[test]
fn template_parameter_currency() {
    let p = TemplateParameter::currency("IDR", 50000);
    assert_eq!(p.param_type, "currency");
    // N-1: code and amount are carried on the struct, not stubbed.
    assert_eq!(p.currency_code.as_deref(), Some("IDR"));
    assert_eq!(p.amount_1000, Some(50_000_000));
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["type"], "currency");
    assert_eq!(json["currency_code"], "IDR");
    assert_eq!(json["amount_1000"], 50_000_000);
}

#[test]
fn template_parameter_text_has_no_currency_fields() {
    let p = TemplateParameter::text("Coffee");
    assert_eq!(p.currency_code, None);
    assert_eq!(p.amount_1000, None);
}

#[test]
fn notification_error_display() {
    let err = NotificationError::Api("invalid token".into());
    assert!(err.to_string().contains("invalid token"));

    let err = NotificationError::RateLimited {
        retry_after_seconds: 30,
        message: "too many requests".into(),
    };
    assert!(err.to_string().contains("30"));
    assert!(err.to_string().contains("too many requests"));
}

#[test]
fn notification_error_config() {
    let err = NotificationError::Config("WHATSAPP_ACCESS_TOKEN not set".into());
    assert!(err.to_string().contains("WHATSAPP_ACCESS_TOKEN"));
}

#[test]
fn notification_status_serialization() {
    let status = NotificationStatus {
        message_id: Some("wamid.abc123".into()),
        accepted: true,
        status: "accepted".into(),
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["message_id"], "wamid.abc123");
    assert_eq!(json["accepted"], true);
}
