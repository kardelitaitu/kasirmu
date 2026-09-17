use super::*;

#[test]
fn validate_phone_accepts_valid_number() {
    assert!(WhatsAppClient::validate_phone("+6281234567890").is_ok());
    assert!(WhatsAppClient::validate_phone("+1234567890").is_ok());
}

#[test]
fn validate_phone_rejects_empty() {
    let err = WhatsAppClient::validate_phone("").unwrap_err();
    assert!(err.to_string().contains("international format"));
}

#[test]
fn validate_phone_rejects_no_plus() {
    let err = WhatsAppClient::validate_phone("6281234567890").unwrap_err();
    assert!(err.to_string().contains("international format"));
}

#[test]
fn validate_phone_rejects_too_short() {
    let err = WhatsAppClient::validate_phone("+123").unwrap_err();
    assert!(err.to_string().contains("too few digits"));
}

#[test]
#[serial_test::serial]
fn from_env_missing_vars_returns_config_error() {
    // Save original values so we can restore after the test.
    // SAFETY: serial_test::serial serializes access to this test,
    // preventing races with other tests that read these env vars.
    let saved_phone_id = std::env::var("WHATSAPP_PHONE_NUMBER_ID").ok();
    let saved_access_token = std::env::var("WHATSAPP_ACCESS_TOKEN").ok();
    let saved_app_secret = std::env::var("WHATSAPP_APP_SECRET").ok();

    // Clear env vars to simulate missing config
    unsafe {
        std::env::remove_var("WHATSAPP_PHONE_NUMBER_ID");
        std::env::remove_var("WHATSAPP_ACCESS_TOKEN");
        std::env::remove_var("WHATSAPP_APP_SECRET");
    }

    let result = WhatsAppClient::from_env();
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("WHATSAPP_PHONE_NUMBER_ID"));

    // Restore env vars to their previous state.
    // SAFETY: serialize_test::serial ensures exclusive access;
    // restoring prevents leakage to other tests in the same process.
    unsafe {
        if let Some(val) = saved_phone_id {
            std::env::set_var("WHATSAPP_PHONE_NUMBER_ID", val);
        }
        if let Some(val) = saved_access_token {
            std::env::set_var("WHATSAPP_ACCESS_TOKEN", val);
        }
        if let Some(val) = saved_app_secret {
            std::env::set_var("WHATSAPP_APP_SECRET", val);
        }
    }
}

#[test]
fn new_client_has_correct_base_url() {
    let client = WhatsAppClient::new("123456", "token");
    assert!(client.messages_url().contains("123456"));
    assert!(client.messages_url().contains("v21.0"));
}

#[test]
fn webhook_verification_requires_app_secret() {
    let client = WhatsAppClient::new("123456", "token");
    let result = client.verify_webhook_signature(b"payload", "sha256=abc");
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("APP_SECRET"));
}

#[test]
fn webhook_verification_with_valid_signature() {
    let secret = "test-secret-key";
    let payload = b"{\"object\":\"whatsapp_business_account\"}";

    // Compute valid HMAC
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload);
    let signature = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));

    let client = WhatsAppClient::new("123456", "token").with_app_secret(secret);
    assert!(
        client
            .verify_webhook_signature(payload, &signature)
            .unwrap()
    );
}

#[test]
fn webhook_verification_with_invalid_signature() {
    let client = WhatsAppClient::new("123456", "token").with_app_secret("secret");

    assert!(
        !client
            .verify_webhook_signature(b"payload", "sha256=deadbeef")
            .unwrap()
    );
}
