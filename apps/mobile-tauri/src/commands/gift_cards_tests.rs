use super::*;

#[test]
fn balance_result_debug() {
    let r = BalanceResult {
        balance_minor: 50000,
        currency: "IDR".into(),
        status: "active".into(),
    };
    let debug = format!("{:?}", r);
    assert!(debug.contains("50000"));
}

#[test]
fn balance_result_serialize() {
    let r = BalanceResult {
        balance_minor: 100000,
        currency: "USD".into(),
        status: "active".into(),
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["balance_minor"], 100000);
    assert_eq!(json["currency"], "USD");
    assert_eq!(json["status"], "active");
}

#[test]
fn balance_result_zero_balance() {
    let r = BalanceResult {
        balance_minor: 0,
        currency: "USD".into(),
        status: "exhausted".into(),
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["balance_minor"], 0);
    assert_eq!(json["status"], "exhausted");
}
