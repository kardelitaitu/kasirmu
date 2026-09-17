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
fn topology_validation_serializes_structured_fields() {
    let err = AppError::TopologyValidation {
        code: "missing-location-input".into(),
        node_id: Some("ws-1".into()),
        wire_id: None,
        port_id: Some("location-in".into()),
        message: "workspace requires Location In".into(),
    };
    let value = serde_json::to_value(err).unwrap();
    assert_eq!(value["kind"], "topologyValidation");
    assert_eq!(value["code"], "missing-location-input");
    assert_eq!(value["nodeId"], "ws-1");
    assert!(value["wireId"].is_null());
    assert_eq!(value["portId"], "location-in");
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

// ── InvalidSession variant ────────────────────────────────

#[test]
fn invalid_session_display() {
    let err = AppError::InvalidSession;
    assert_eq!(err.to_string(), "invalid or expired session");
}

#[test]
fn invalid_session_serde() {
    let err = AppError::InvalidSession;
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "invalidSession");
}

#[test]
fn invalid_session_debug() {
    let err = AppError::InvalidSession;
    let debug = format!("{:?}", err);
    assert!(debug.contains("InvalidSession"));
}

// ── Invalid and PermissionDenied serde ───────────────────

#[test]
fn invalid_serde() {
    let err = AppError::Invalid("bad input".into());
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "invalid");
    assert_eq!(json["message"], "bad input");
}

#[test]
fn permission_denied_serde() {
    let err = AppError::PermissionDenied("no access".into());
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "permissionDenied");
    assert_eq!(json["message"], "no access");
}

#[test]
fn internal_serde() {
    let err = AppError::Internal("boom".into());
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "internal");
    assert_eq!(json["message"], "boom");
}

// ── Serde: sub_kind field on Core / Hardware ─────────────

#[test]
fn serde_core_includes_sub_kind() {
    let err = AppError::Core {
        sub_kind: CoreErrorKind::Validation,
        message: "name required".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["subKind"], "validation");
}

#[test]
fn serde_hardware_includes_sub_kind() {
    let err = AppError::Hardware {
        sub_kind: HalErrorKind::Timeout,
        message: "device not responding".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["subKind"], "timeout");
}

// ── From conversions ─────────────────────────────────────

#[test]
fn from_tauri_error() {
    // Tauri errors have complex construction; test via a string conversion
    let e: AppError = tauri::Error::AssetNotFound("test.txt".into()).into();
    match e {
        AppError::Internal(msg) => {
            assert!(msg.contains("test.txt"));
        }
        _ => panic!("expected Internal variant"),
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

// ── Multiple rusqlite error types ─────────────────────────

#[test]
fn from_rusqlite_error_message_includes_sqlite_prefix() {
    let e: AppError = rusqlite::Error::QueryReturnedNoRows.into();
    match e {
        AppError::Core { sub_kind, message } => {
            assert_eq!(format!("{sub_kind:?}"), "Db");
            assert!(message.starts_with("sqlite:"));
        }
        _ => panic!("expected Core variant"),
    }
}

#[test]
fn from_rusqlite_to_string() {
    let e: AppError = rusqlite::Error::InvalidQuery.into();
    let display = e.to_string();
    assert!(display.starts_with("core error:"));
    assert!(display.contains("sqlite:"));
}

// ── PermissionDenied / Internal Debug ──────────────────────

#[test]
fn permission_denied_debug() {
    let err = AppError::PermissionDenied("owner only".into());
    let debug = format!("{:?}", err);
    assert!(debug.contains("PermissionDenied"));
    assert!(debug.contains("owner only"));
}

// ── Internal Debug ────────────────────────────────────────

#[test]
fn internal_debug() {
    let err = AppError::Internal("catastrophic failure".into());
    let debug = format!("{:?}", err);
    assert!(debug.contains("Internal"));
    assert!(debug.contains("catastrophic failure"));
}
