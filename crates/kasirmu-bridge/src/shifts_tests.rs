//! Unit tests for the shift command bodies (Wave-D test relocation:
//! moved out of `apps/desktop-tauri/src/commands/shifts_tests.rs`).
//!
//! Mounted at the foot of `shifts.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and args directly. The desktop file
//! exercised session validation through `AppState`; here the same
//! rejection goes through the bridge context's shared session map. DTO
//! and serde assertions are verbatim.

use super::*;
use crate::testing::TestBridge;

#[test]
fn shifts_scoped_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// -- DTO struct tests --

#[test]
fn shift_dto_debug() {
    let dto = ShiftDto {
        id: "s1".into(),
        user_id: "u1".into(),
        terminal_id: None,
        opened_at: "2025-01-01".into(),
        closed_at: None,
        opening_balance_minor: 500,
        closing_balance_minor: None,
        expected_cash_minor: None,
        cash_difference_minor: None,
        total_sales_minor: 0,
        total_cash_minor: 0,
        total_card_minor: 0,
        total_other_minor: 0,
        total_voids_minor: 0,
        total_refunds_minor: 0,
        total_payouts_minor: 0,
        notes: String::new(),
        status: "open".into(),
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("s1"));
}

#[test]
fn shift_dto_serialize() {
    let dto = ShiftDto {
        id: "s2".into(),
        user_id: "u2".into(),
        terminal_id: Some("t1".into()),
        opened_at: "2025-02-01".into(),
        closed_at: Some("2025-02-01".into()),
        opening_balance_minor: 1000,
        closing_balance_minor: Some(2000),
        expected_cash_minor: Some(1500),
        cash_difference_minor: Some(500),
        total_sales_minor: 5000,
        total_cash_minor: 3000,
        total_card_minor: 2000,
        total_other_minor: 0,
        total_voids_minor: 0,
        total_refunds_minor: 0,
        total_payouts_minor: 0,
        notes: "Good shift".into(),
        status: "closed".into(),
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["status"], "closed");
    assert_eq!(json["totalSalesMinor"], 5000);
}

#[test]
fn open_shift_args_deserialize() {
    let json = r##"{"userId":"u1","openingBalanceMinor":500}"##;
    let args: OpenShiftArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.user_id, "u1");
    assert_eq!(args.opening_balance_minor, 500);
    assert_eq!(args.terminal_id, None);
}

#[test]
fn open_shift_args_debug() {
    let args = OpenShiftArgs {
        user_id: "u".into(),
        terminal_id: None,
        opening_balance_minor: 100,
    };
    let d = format!("{args:?}");
    assert!(d.contains("u"));
}

#[test]
fn close_shift_args_deserialize() {
    let json = r##"{"userId":"u1","id":"s1","closingBalanceMinor":2000}"##;
    let args: CloseShiftArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "s1");
    assert_eq!(args.closing_balance_minor, 2000);
    assert_eq!(args.notes, None);
}

#[test]
fn close_shift_args_debug() {
    let args = CloseShiftArgs {
        user_id: "u".into(),
        id: "s".into(),
        closing_balance_minor: 0,
        notes: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("s"));
}

#[test]
fn cash_payout_dto_serialize() {
    let dto = CashPayoutDto {
        id: "cp1".into(),
        shift_id: "s1".into(),
        amount_minor: 1000,
        reason: "Safe drop".into(),
        created_at: "2025-01-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["amountMinor"], 1000);
    assert_eq!(json["reason"], "Safe drop");
}

#[test]
fn cash_payout_dto_debug() {
    let dto = CashPayoutDto {
        id: "cp2".into(),
        shift_id: "s2".into(),
        amount_minor: 500,
        reason: "Test".into(),
        created_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("cp2"));
}

#[test]
fn create_cash_payout_args_deserialize() {
    let json = r##"{"shiftId":"s1","amountMinor":1000,"reason":"Safe drop"}"##;
    let args: CreateCashPayoutArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.shift_id, "s1");
    assert_eq!(args.amount_minor, 1000);
}

#[test]
fn create_cash_payout_args_debug() {
    let args = CreateCashPayoutArgs {
        shift_id: "s".into(),
        amount_minor: 100,
        reason: "R".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("R"));
}
