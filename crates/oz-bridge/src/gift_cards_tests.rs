use super::*;

// ── Existing tests (preserved) ────────────────────────────────────

#[test]
fn balance_result_debug() {
    let result = BalanceResult {
        balance_minor: 1500,
        currency: "USD".into(),
        status: "active".into(),
    };
    let d = format!("{result:?}");
    assert!(d.contains("1500"));
}

#[test]
fn balance_result_serialize() {
    let result = BalanceResult {
        balance_minor: 2500,
        currency: "IDR".into(),
        status: "active".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["balance_minor"], 2500);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn balance_result_zero_and_empty() {
    let result = BalanceResult {
        balance_minor: 0,
        currency: "".into(),
        status: "".into(),
    };
    assert_eq!(result.balance_minor, 0);
}

// ── Helper ────────────────────────────────────────────────────────

// ── CRUD tests ────────────────────────────────────────────────────
