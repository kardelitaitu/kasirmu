use super::*;

#[test]
fn core_display() {
    let err = AppError::Core {
        sub_kind: CoreErrorKind::Db,
        message: "connection lost".into(),
    };
    assert_eq!(err.to_string(), "core error: connection lost");
}

#[test]
fn hardware_display() {
    let err = AppError::Hardware {
        sub_kind: HalErrorKind::NotFound,
        message: "printer not found".into(),
    };
    assert_eq!(err.to_string(), "hardware error: printer not found");
}

#[test]
fn invalid_display() {
    let err = AppError::Invalid("missing field 'label'".into());
    assert_eq!(err.to_string(), "invalid request: missing field 'label'");
}

#[test]
fn permission_denied_display() {
    let err = AppError::PermissionDenied("admin required".into());
    assert_eq!(err.to_string(), "permission denied: admin required");
}

#[test]
fn internal_display() {
    let err = AppError::Internal("unexpected panic".into());
    assert_eq!(err.to_string(), "internal error: unexpected panic");
}

#[test]
fn debug_output() {
    let err = AppError::Invalid("test".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("Invalid"));
}

#[test]
fn serde_json_core_variant() {
    let err = AppError::Core {
        sub_kind: CoreErrorKind::Db,
        message: "test".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "core");
    assert_eq!(json["message"], "test");
}

#[test]
fn serde_json_hardware_variant() {
    let err = AppError::Hardware {
        sub_kind: HalErrorKind::NotFound,
        message: "printer offline".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "hardware");
    assert_eq!(json["message"], "printer offline");
}

#[test]
fn implements_std_error() {
    let err: Box<dyn std::error::Error> = Box::new(AppError::Internal("test".into()));
    let _ = err.to_string();
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AppError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!(
        "{:?}",
        AppError::Core {
            sub_kind: CoreErrorKind::Db,
            message: "a".into()
        }
    );
    let b = format!(
        "{:?}",
        AppError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            message: "b".into()
        }
    );
    let c = format!("{:?}", AppError::Invalid("c".into()));
    let d = format!("{:?}", AppError::PermissionDenied("d".into()));
    let e = format!("{:?}", AppError::Internal("e".into()));
    assert_ne!(a, b);
    assert_ne!(a, c);
    assert_ne!(a, d);
    assert_ne!(a, e);
    assert_ne!(b, c);
    assert_ne!(b, d);
    assert_ne!(b, e);
    assert_ne!(c, d);
    assert_ne!(c, e);
    assert_ne!(d, e);
}

#[test]
fn from_rusqlite_error() {
    let e: AppError = rusqlite::Error::InvalidParameterName("test".into()).into();
    match e {
        AppError::Core { sub_kind, .. } => {
            assert_eq!(format!("{sub_kind:?}"), "Db");
        }
        _ => panic!("expected Core variant"),
    }
}

// ── From<modules_currency::CurrencyError> (R2 Phase 1) ──────

#[test]
fn from_currency_error_to_app_error() {
    let currency_err =
        modules_currency::CurrencyError::validation("rate_millionths", "rate must be positive");
    let app_err: AppError = currency_err.into();
    match app_err {
        AppError::Core { sub_kind, message } => {
            assert_eq!(format!("{sub_kind:?}"), "Validation");
            assert!(message.contains("rate_millionths"));
            assert!(message.contains("rate must be positive"));
        }
        other => panic!("expected Core variant, got {other:?}"),
    }
}

#[test]
fn from_currency_error_not_found_to_app_error() {
    let currency_err = modules_currency::CurrencyError::NotFound {
        entity: "exchange_rate",
        id: "missing-id".into(),
    };
    let app_err: AppError = currency_err.into();
    match app_err {
        AppError::Core { sub_kind, message } => {
            assert_eq!(format!("{sub_kind:?}"), "NotFound");
            assert!(message.contains("missing-id"));
        }
        other => panic!("expected Core variant, got {other:?}"),
    }
}
