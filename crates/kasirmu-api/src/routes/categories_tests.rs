use super::*;
use axum::http::StatusCode;

// ── store_error_response ────────────────────────────────────

/// categories.rs mirrors the granular CoreError→status mapping used by the
/// sibling handlers (products.rs, sales.rs, users.rs): validation → 400,
/// conflict → 409, not-found → 404, everything else → 500.
#[test]
fn store_error_response_maps_validation_to_400() {
    let resp = store_error_response(CoreError::Validation {
        field: "name",
        message: "required".into(),
    });
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn store_error_response_maps_conflict_to_409() {
    let resp = store_error_response(CoreError::Conflict {
        entity: "category",
        field: "name",
    });
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[test]
fn store_error_response_maps_not_found_to_404() {
    let resp = store_error_response(CoreError::NotFound {
        entity: "category",
        id: "nope".into(),
    });
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[test]
fn store_error_response_maps_unknown_to_500() {
    for err in [
        CoreError::Internal("db fail".into()),
        CoreError::Db(rusqlite::Error::InvalidParameterName("x".into())),
        CoreError::MoneyOverflow {
            left: 1,
            right: 1,
            currency: "USD".into(),
        },
        CoreError::CurrencyMismatch("USD".into(), "EUR".into()),
    ] {
        assert_eq!(
            store_error_response(err).status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "unmapped CoreError variants should still return 500"
        );
    }
}
