//! EDC command DTO and fail-closed tests.
//!
//! The DTO conversions and serialisation are unit-tested here. The status
//! labels are pinned against `ui/src/api/edc.ts`, because the commands used
//! to build them with a hand-written match that could silently miss a
//! variant.

use super::{DEFAULT_TERMINAL_ID, EdcResultDto, EdcStatusDto};
use kasirmu_hal::{EdcPaymentResult, TerminalStatus};

fn result() -> EdcPaymentResult {
    EdcPaymentResult {
        success: true,
        transaction_id: Some("mock-txn-001".into()),
        auth_code: Some("MOCKAUTH".into()),
        card_scheme: Some("Visa".into()),
        card_last4: Some("1111".into()),
        message: "approved".into(),
    }
}

#[test]
fn every_status_serializes_to_the_label_the_front_end_declares() {
    // ui/src/api/edc.ts:10-15 lists exactly these five strings. The old code
    // produced them with a match; now serde does, so this is the only thing
    // standing between a renamed variant and a silently broken tender screen.
    let cases = [
        (TerminalStatus::Ready, "ready"),
        (TerminalStatus::Busy, "busy"),
        (TerminalStatus::Offline, "offline"),
        (TerminalStatus::PaperError, "paperError"),
        (TerminalStatus::Error, "error"),
    ];
    for (status, label) in cases {
        let json = serde_json::to_value(EdcStatusDto { status }).unwrap();
        assert_eq!(json["status"], label, "{status:?} must emit {label:?}");
    }
}

#[test]
fn status_round_trips_so_the_ui_can_send_it_back() {
    let json = serde_json::to_value(TerminalStatus::PaperError).unwrap();
    assert_eq!(
        serde_json::from_value::<TerminalStatus>(json).unwrap(),
        TerminalStatus::PaperError
    );
}

#[test]
fn result_dto_from_payment_result() {
    let dto: EdcResultDto = result().into();
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["success"], true);
    assert_eq!(json["transactionId"], "mock-txn-001");
    assert_eq!(json["authCode"], "MOCKAUTH");
    assert_eq!(json["cardScheme"], "Visa");
    assert_eq!(json["cardLast4"], "1111");
    assert_eq!(json["message"], "approved");
}

#[test]
fn result_dto_failure_shape() {
    let dto: EdcResultDto = EdcPaymentResult {
        success: false,
        transaction_id: None,
        auth_code: None,
        card_scheme: None,
        card_last4: None,
        message: "declined".into(),
    }
    .into();
    assert!(!dto.success);
    assert!(dto.transaction_id.is_none());
    assert_eq!(dto.message, "declined");
}

#[tokio::test]
async fn a_fresh_registry_has_no_terminal_so_the_tender_fails_closed() {
    // The precondition every EDC command depends on. Before this change the
    // commands read an AppState field holding an armed mock, so this state
    // produced a fake approval instead of an error.
    let registry = kasirmu_hal::DriverRegistry::default();
    assert!(
        registry.terminal(DEFAULT_TERMINAL_ID).await.is_none(),
        "an unconfigured register must not resolve a card terminal"
    );
}

#[tokio::test]
async fn the_profile_bootstrap_alone_never_invents_a_card_terminal() {
    // register_hardware reads TerminalProfile, which has no EDC fields. A
    // terminal must come from an edc_terminals row, so the printer path
    // working must not be enough to make the tender resolve.
    let registry = kasirmu_hal::DriverRegistry::default();
    let profile = serde_json::from_str::<platform_core::terminal_profile::TerminalProfile>(
        r#"{"printer_connection":"network","printer_device_path":"10.0.0.5:9100"}"#,
    )
    .unwrap();
    let report = platform_startup::hardware::register_hardware(&registry, &profile).await;
    assert!(report.ok(), "{report}");
    assert!(registry.printer(DEFAULT_TERMINAL_ID).await.is_some());
    assert!(registry.terminal_ids().await.is_empty());
}

#[test]
fn the_default_terminal_id_matches_the_one_the_bootstrap_binds() {
    // Two crates declare the same string: the command looks it up, the
    // startup bootstrap binds it. A rename on one side would silently turn
    // every configured terminal back into NotFound, which is exactly the
    // class of bug this whole change was about.
    assert_eq!(
        DEFAULT_TERMINAL_ID,
        platform_startup::hardware::DEFAULT_TERMINAL_ID
    );
}

#[tokio::test]
async fn a_configured_terminal_row_makes_the_tender_resolve() {
    // End-to-end for the configuration path: an edc_terminals row reaches
    // the id the commands ask for. Reachable is not the same as working —
    // the driver is still a stub, so it must fail closed rather than
    // approve a card.
    let registry = kasirmu_hal::DriverRegistry::default();
    let rows = [kasirmu_core::db::edc_terminals::EdcTerminalConfig {
        id: "row-1".into(),
        name: "Front counter".into(),
        connection_type: "wired".into(),
        transport: "serial".into(),
        address: "COM3".into(),
        vendor: Some("ingenico".into()),
        model: Some("iPP320".into()),
        is_active: true,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    }];
    let report = platform_startup::hardware::register_card_terminals(&registry, &rows).await;
    assert!(report.ok(), "{report}");

    let terminal = registry
        .terminal(DEFAULT_TERMINAL_ID)
        .await
        .expect("a configured terminal must resolve");
    let money = foundation::Money {
        minor_units: 1_000,
        currency: "USD".parse::<foundation::Currency>().unwrap(),
    };
    assert!(matches!(
        terminal.authorize(money).await,
        Err(kasirmu_hal::HalError::Unsupported(_))
    ));
}
