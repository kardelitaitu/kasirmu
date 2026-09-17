use super::*;

#[test]
fn db_error_kind() {
    let err = CoreError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    assert!(matches!(err.kind(), CoreErrorKind::Db));
    assert!(err.to_string().contains("database error"));
}

#[test]
fn money_overflow_kind_and_display() {
    let err = CoreError::MoneyOverflow {
        left: 1_000_000,
        right: 500_000,
        currency: "IDR".into(),
    };
    assert!(matches!(err.kind(), CoreErrorKind::MoneyOverflow));
    let msg = err.to_string();
    assert!(msg.contains("money overflow"));
    assert!(msg.contains("IDR"));
    assert!(msg.contains("1000000"));
    assert!(msg.contains("500000"));
}

#[test]
fn currency_mismatch_kind_and_display() {
    let err = CoreError::CurrencyMismatch("USD".into(), "IDR".into());
    assert!(matches!(err.kind(), CoreErrorKind::CurrencyMismatch));
    let msg = err.to_string();
    assert!(msg.contains("currency mismatch"));
    assert!(msg.contains("USD"));
    assert!(msg.contains("IDR"));
}

#[test]
fn not_found_kind_and_display() {
    let err = CoreError::NotFound {
        entity: "product",
        id: "prod-1".into(),
    };
    assert!(matches!(err.kind(), CoreErrorKind::NotFound));
    let msg = err.to_string();
    assert!(msg.contains("not found"));
    assert!(msg.contains("product"));
    assert!(msg.contains("prod-1"));
}

#[test]
fn conflict_kind_and_display() {
    let err = CoreError::Conflict {
        entity: "category",
        field: "name",
    };
    assert!(matches!(err.kind(), CoreErrorKind::Conflict));
    let msg = err.to_string();
    assert!(msg.contains("conflict"));
    assert!(msg.contains("category"));
    assert!(msg.contains("name"));
}

#[test]
fn validation_kind_and_display() {
    let err = CoreError::Validation {
        field: "price",
        message: "must be positive".into(),
    };
    assert!(matches!(err.kind(), CoreErrorKind::Validation));
    let msg = err.to_string();
    assert!(msg.contains("validation error"));
    assert!(msg.contains("price"));
    assert!(msg.contains("must be positive"));
}

#[test]
fn internal_kind_and_display() {
    let err = CoreError::Internal("something went wrong".into());
    assert!(matches!(err.kind(), CoreErrorKind::Internal));
    let msg = err.to_string();
    assert!(msg.contains("internal error"));
    assert!(msg.contains("something went wrong"));
}

#[test]
fn platform_error_kind() {
    let err = CoreError::Platform(platform_core::PlatformError::Internal("test".into()));
    assert!(matches!(err.kind(), CoreErrorKind::Platform));
}

// ── Subscription / license variants ──

#[test]
fn subscription_limit_exceeded_kind_and_display() {
    let err = CoreError::SubscriptionLimitExceeded("max 5 terminals".into());
    assert!(matches!(
        err.kind(),
        CoreErrorKind::SubscriptionLimitExceeded
    ));
    let msg = err.to_string();
    assert!(msg.contains("subscription limit exceeded"));
    assert!(msg.contains("max 5 terminals"));
}

#[test]
fn invalid_subscription_signature_kind_and_display() {
    let err = CoreError::InvalidSubscriptionSignature("key mismatch".into());
    assert!(matches!(
        err.kind(),
        CoreErrorKind::InvalidSubscriptionSignature
    ));
    let msg = err.to_string();
    assert!(msg.contains("invalid subscription signature"));
    assert!(msg.contains("key mismatch"));
}

#[test]
fn subscription_upgrade_required_kind_and_display() {
    let err = CoreError::SubscriptionUpgradeRequired("tier: pro required".into());
    assert!(matches!(
        err.kind(),
        CoreErrorKind::SubscriptionUpgradeRequired
    ));
    let msg = err.to_string();
    assert!(msg.contains("subscription upgrade required"));
    assert!(msg.contains("pro required"));
}

#[test]
fn system_clock_tampered_kind_and_display() {
    let err = CoreError::SystemClockTampered("clock rolled back".into());
    assert!(matches!(err.kind(), CoreErrorKind::SystemClockTampered));
    let msg = err.to_string();
    assert!(msg.contains("system clock tampered"));
    assert!(msg.contains("clock rolled back"));
}

// ── CoreErrorKind serde ──

#[test]
fn core_error_kind_serde_camel_case() {
    let kinds = [
        CoreErrorKind::Db,
        CoreErrorKind::Platform,
        CoreErrorKind::MoneyOverflow,
        CoreErrorKind::CurrencyMismatch,
        CoreErrorKind::NotFound,
        CoreErrorKind::Conflict,
        CoreErrorKind::Validation,
        CoreErrorKind::Internal,
        CoreErrorKind::SubscriptionLimitExceeded,
        CoreErrorKind::InvalidSubscriptionSignature,
        CoreErrorKind::SubscriptionUpgradeRequired,
        CoreErrorKind::SystemClockTampered,
    ];
    for kind in &kinds {
        let json = serde_json::to_string(kind).unwrap();
        assert!(!json.is_empty(), "CoreErrorKind should serialize: {kind:?}");
    }
}

// ── Debug output ──

#[test]
fn core_error_debug_contains_variant_info() {
    let err = CoreError::NotFound {
        entity: "customer",
        id: "cust-99".into(),
    };
    let debug = format!("{err:?}");
    assert!(
        debug.contains("NotFound"),
        "debug should contain variant: {debug}"
    );
    assert!(
        debug.contains("cust-99"),
        "debug should contain id: {debug}"
    );
}

// ── From<CurrencyError> conversions (R2 Phase 1) ──

#[test]
fn from_currency_error_validation_to_core_validation() {
    let currency_err =
        modules_currency::CurrencyError::validation("rate_millionths", "rate must be positive");
    let core_err: CoreError = currency_err.into();
    assert!(matches!(
        core_err,
        CoreError::Validation {
            field: "rate_millionths",
            ..
        }
    ));
    let msg = core_err.to_string();
    assert!(msg.contains("validation error"));
    assert!(msg.contains("rate_millionths"));
}

#[test]
fn from_currency_error_not_found_to_core_not_found() {
    let currency_err = modules_currency::CurrencyError::NotFound {
        entity: "exchange_rate",
        id: "bad-id".into(),
    };
    let core_err: CoreError = currency_err.into();
    assert!(matches!(
        core_err,
        CoreError::NotFound {
            entity: "exchange_rate",
            ..
        }
    ));
    let msg = core_err.to_string();
    assert!(msg.contains("not found"));
    assert!(msg.contains("bad-id"));
}

#[test]
fn from_currency_error_db_to_core_db() {
    let currency_err = modules_currency::CurrencyError::Db(rusqlite::Error::QueryReturnedNoRows);
    let core_err: CoreError = currency_err.into();
    match core_err {
        CoreError::Db(ref e) => {
            assert!(
                matches!(e, rusqlite::Error::QueryReturnedNoRows),
                "inner rusqlite error should be preserved"
            );
        }
        other => panic!("expected CoreError::Db, got {other:?}"),
    }
    let msg = core_err.to_string();
    assert!(msg.contains("database error"));
}
