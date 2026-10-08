//! Unit tests for EDC payment-terminal multi-terminal routing and CRUD.

use super::*;
use crate::testing::TestBridge;
use kasirmu_hal::drivers::mock::MockEdcTerminal;
use kasirmu_hal::{HalErrorKind, TerminalStatus};
use std::sync::Arc;

#[tokio::test]
async fn unconfigured_terminal_fails_closed_with_not_found() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();

    let err = edc_terminal_status(&ctx, None).await.unwrap_err();
    assert!(matches!(
        err,
        BridgeError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            ..
        }
    ));

    let err_custom = edc_terminal_status(&ctx, Some("non-existent"))
        .await
        .unwrap_err();
    assert!(matches!(
        err_custom,
        BridgeError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            ..
        }
    ));
}

#[tokio::test]
async fn multi_terminal_explicit_routing_and_default_fallback() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();

    // Register terminal-a as default, and terminal-b explicitly
    let driver_a = Arc::new(MockEdcTerminal::new());
    driver_a.set_status(Some(TerminalStatus::Ready));

    let driver_b = Arc::new(MockEdcTerminal::new());
    driver_b.set_status(Some(TerminalStatus::Busy));

    ctx.registry
        .register_terminal("default", driver_a.clone())
        .await;
    ctx.registry.register_terminal("term-a", driver_a).await;
    ctx.registry.register_terminal("term-b", driver_b).await;

    // None or empty string resolves default (term-a) -> Ready
    let status_default = edc_terminal_status(&ctx, None).await.unwrap();
    assert_eq!(status_default.status, TerminalStatus::Ready);

    let status_empty = edc_terminal_status(&ctx, Some("")).await.unwrap();
    assert_eq!(status_empty.status, TerminalStatus::Ready);

    // Explicit term-b -> Busy
    let status_b = edc_terminal_status(&ctx, Some("term-b")).await.unwrap();
    assert_eq!(status_b.status, TerminalStatus::Busy);

    // Non-existent terminal -> NotFound
    let err_c = edc_terminal_status(&ctx, Some("term-c")).await.unwrap_err();
    assert!(matches!(
        err_c,
        BridgeError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            ..
        }
    ));
}

#[tokio::test]
async fn sale_permission_and_routing() {
    let tb = TestBridge::new();
    let token = tb
        .token_granting(kasirmu_core::permissions::SALES_PROCESS)
        .await;
    let ctx = tb.ctx();

    let driver = Arc::new(MockEdcTerminal::new());
    driver.set_success();
    ctx.registry.register_terminal("bca-01", driver).await;

    // Fails closed if terminal not found
    let err_missing = edc_sale(&ctx, &token, 50000, "IDR", Some("mandiri-01"), None)
        .await
        .unwrap_err();
    assert!(matches!(
        err_missing,
        BridgeError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            ..
        }
    ));

    // Succeeds when routing to bca-01 with reference
    let result = edc_sale(&ctx, &token, 50000, "IDR", Some("bca-01"), Some("INV-001"))
        .await
        .unwrap();
    assert!(result.success);
    assert!(result.transaction_id.is_some());
}

#[tokio::test]
async fn edc_terminals_crud_and_dynamic_registration() {
    let tb = TestBridge::new();
    let token_settings = tb
        .token_granting(kasirmu_core::permissions::SETTINGS_EDIT)
        .await;
    let token_cashier = tb
        .token_granting(kasirmu_core::permissions::SALES_PROCESS)
        .await;
    let ctx = tb.ctx();

    // 1. Initial listing is empty
    let list = list_edc_terminals_scoped(&ctx, &token_cashier)
        .await
        .unwrap();
    assert!(list.is_empty());

    // 2. Create terminal 1 (wired serial)
    let created1 = create_edc_terminal_scoped(
        &ctx,
        &token_settings,
        CreateEdcTerminalArgs {
            name: "Counter 1 EDC".into(),
            connection_type: "wired".into(),
            transport: "serial".into(),
            address: "COM3".into(),
            vendor: Some("ingenico".into()),
            model: Some("iPP320".into()),
            is_active: Some(true),
        },
    )
    .await
    .unwrap();

    assert_eq!(created1.name, "Counter 1 EDC");
    assert!(created1.is_active);

    // Verified: Driver registered in registry under UUID AND "default"
    assert!(ctx.registry.terminal(&created1.id).await.is_some());
    assert!(ctx.registry.terminal("default").await.is_some());

    // 3. Create terminal 2 (wireless tcp)
    let created2 = create_edc_terminal_scoped(
        &ctx,
        &token_settings,
        CreateEdcTerminalArgs {
            name: "Mobile Pax A920".into(),
            connection_type: "wireless".into(),
            transport: "tcp".into(),
            address: "192.168.1.150:9000".into(),
            vendor: Some("pax".into()),
            model: Some("A920".into()),
            is_active: Some(true),
        },
    )
    .await
    .unwrap();

    // Both terminals exist
    assert!(ctx.registry.terminal(&created2.id).await.is_some());
    let list_after = list_edc_terminals_scoped(&ctx, &token_cashier)
        .await
        .unwrap();
    assert_eq!(list_after.len(), 2);

    // 4. Update terminal 1: deactivate it
    let updated1 = update_edc_terminal_scoped(
        &ctx,
        &token_settings,
        UpdateEdcTerminalArgs {
            id: created1.id.clone(),
            name: created1.name.clone(),
            connection_type: created1.connection_type.clone(),
            transport: created1.transport.clone(),
            address: created1.address.clone(),
            vendor: created1.vendor.clone(),
            model: created1.model.clone(),
            is_active: false,
        },
    )
    .await
    .unwrap();
    assert!(!updated1.is_active);

    // Unregistered from registry, and default alias shifts to created2
    assert!(ctx.registry.terminal(&created1.id).await.is_none());
    assert!(ctx.registry.terminal("default").await.is_some());

    // 5. Delete terminal 2
    delete_edc_terminal_scoped(&ctx, &token_settings, &created2.id)
        .await
        .unwrap();

    assert!(ctx.registry.terminal(&created2.id).await.is_none());
    // Since no active terminals remain, default is also unregistered
    assert!(ctx.registry.terminal("default").await.is_none());

    let final_list = list_edc_terminals_scoped(&ctx, &token_cashier)
        .await
        .unwrap();
    assert_eq!(final_list.len(), 1);
    assert!(!final_list[0].is_active);
}

#[tokio::test]
async fn loopback_terminal_dynamic_sync_and_payment_simulation() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();

    let token_settings = tb
        .token_granting(kasirmu_core::permissions::SETTINGS_EDIT)
        .await;
    let token_cashier = tb
        .token_granting(kasirmu_core::permissions::SALES_PROCESS)
        .await;

    // 1. Create a loopback terminal
    let term = create_edc_terminal_scoped(
        &ctx,
        &token_settings,
        CreateEdcTerminalArgs {
            name: "Simulator Terminal".into(),
            connection_type: "wired".into(),
            transport: "serial".into(),
            address: "loopback".into(),
            vendor: Some("loopback".into()),
            model: Some("Sim01".into()),
            is_active: Some(true),
        },
    )
    .await
    .unwrap();

    // Check status via scoped endpoint
    let status = edc_terminal_status_scoped(&ctx, &token_cashier, Some(&term.id))
        .await
        .unwrap();
    assert_eq!(status.status, TerminalStatus::Ready);

    // Perform sale on loopback terminal
    let sale_res = edc_sale(&ctx, &token_cashier, 25000, "IDR", Some(&term.id), None)
        .await
        .unwrap();
    assert!(sale_res.success);
    assert!(sale_res.transaction_id.is_some());
    assert_eq!(sale_res.message, "approved");

    // 2. Create a declining loopback terminal
    let decline_term = create_edc_terminal_scoped(
        &ctx,
        &token_settings,
        CreateEdcTerminalArgs {
            name: "Declining Simulator".into(),
            connection_type: "wired".into(),
            transport: "serial".into(),
            address: "loopback://decline?reason=lost_card".into(),
            vendor: Some("loopback".into()),
            model: Some("Sim02".into()),
            is_active: Some(true),
        },
    )
    .await
    .unwrap();

    let dec_res = edc_sale(
        &ctx,
        &token_cashier,
        15000,
        "IDR",
        Some(&decline_term.id),
        None,
    )
    .await
    .unwrap();
    assert!(!dec_res.success);
    assert_eq!(dec_res.message, "lost card");
}

#[tokio::test]
async fn edc_settle_and_inquiry_permission_and_execution() {
    let tb = TestBridge::new();
    let token_cashier = tb
        .token_granting(kasirmu_core::permissions::SALES_PROCESS)
        .await;
    let token_guest = tb
        .token_granting(kasirmu_core::permissions::SETTINGS_READ)
        .await;
    let ctx = tb.ctx();

    let driver = Arc::new(MockEdcTerminal::new());
    driver.set_success();
    ctx.registry.register_terminal("edc-pos1", driver).await;

    // 1. Permission checks
    let guest_settle = edc_settle(&ctx, &token_guest, Some("edc-pos1")).await;
    assert!(matches!(
        guest_settle,
        Err(BridgeError::PermissionDenied(_))
    ));

    let guest_inq = edc_inquiry(&ctx, &token_guest, "INV-100", Some("edc-pos1")).await;
    assert!(matches!(guest_inq, Err(BridgeError::PermissionDenied(_))));

    // 2. Settle execution
    let settle = edc_settle(&ctx, &token_cashier, Some("edc-pos1"))
        .await
        .unwrap();
    assert!(settle.success);
    assert_eq!(settle.batch_number.as_deref(), Some("000001"));
    assert_eq!(settle.message, "settlement approved");

    // 3. Inquiry execution
    let inq = edc_inquiry(&ctx, &token_cashier, "INV-100", Some("edc-pos1"))
        .await
        .unwrap();
    assert!(inq.success);
    assert_eq!(inq.transaction_id.as_deref(), Some("mock-inq-INV-100"));
}
