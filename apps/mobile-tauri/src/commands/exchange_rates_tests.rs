use super::*;
use tauri::Manager as _;

fn args(from: &str, to: &str, effective_date: Option<&str>) -> CreateExchangeRateArgs {
    CreateExchangeRateArgs {
        from_currency: from.into(),
        to_currency: to.into(),
        rate_millionths: 920_000,
        source: None,
        effective_date: effective_date.map(String::from),
    }
}

// ── CUR-05: field-level validation on create_exchange_rate ──

#[tokio::test]
async fn create_exchange_rate_rejects_same_currency_pair() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();
    let err = create_exchange_rate(args("USD", "USD", None), app.state())
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        AppError::Invalid(msg) if msg.contains("from_currency")
    ));
}

#[tokio::test]
async fn create_exchange_rate_rejects_non_iso_currency_code() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();
    let err = create_exchange_rate(args("US1", "IDR", None), app.state())
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        AppError::Invalid(msg) if msg.contains("from_currency")
    ));
}

#[tokio::test]
async fn create_exchange_rate_rejects_malformed_effective_date() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();
    let err = create_exchange_rate(args("USD", "IDR", Some("2026-02-30")), app.state())
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        AppError::Invalid(msg) if msg.contains("effective_date")
    ));
}

#[tokio::test]
async fn create_exchange_rate_accepts_valid_input() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    let dto = create_exchange_rate(args("USD", "IDR", Some("2026-08-11")), app.state())
        .await
        .unwrap();
    assert_eq!(dto.from_currency, "USD");
    assert_eq!(dto.to_currency, "IDR");
    assert_eq!(dto.rate_millionths, 920_000);
}
