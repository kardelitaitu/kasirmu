use super::*;

#[test]
fn db_display() {
    let err = ReportingError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    assert!(err.to_string().contains("database error:"));
}

#[test]
fn db_source() {
    let err = ReportingError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    assert!(std::error::Error::source(&err).is_some());
}

#[test]
fn invalid_window_display() {
    let err = ReportingError::InvalidWindow("end before start".into());
    assert_eq!(err.to_string(), "invalid time window: end before start");
}

#[test]
fn io_display_and_source() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
    let err = ReportingError::Io(io);
    assert!(err.to_string().contains("i/o error:"));
    assert!(std::error::Error::source(&err).is_some());
}

#[test]
fn debug_output() {
    let err = ReportingError::InvalidWindow("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn implements_std_error() {
    let err = ReportingError::InvalidWindow("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ReportingError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", ReportingError::InvalidWindow("x".into()));
    let b = format!(
        "{:?}",
        ReportingError::Db(rusqlite::Error::InvalidParameterName("x".into()))
    );
    assert_ne!(a, b);
}

// ── Boundary / invariant tests for ReportingError ─────────────────

/// `From<rusqlite::Error>` produces a `Db` variant whose Display
/// starts with "database error:" — the prefix audit log scrapers
/// grep for. Security-sensitive: PCI logging depends on it.
#[test]
fn from_rusqlite_error_conversion() {
    let sqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let reporting_err: ReportingError = sqlite_err.into();
    assert!(
        matches!(reporting_err, ReportingError::Db(_)),
        "From<rusqlite::Error> must yield Db variant"
    );
    assert!(
        reporting_err.to_string().starts_with("database error:"),
        "got: {:?}",
        reporting_err
    );
    // Source chain preserved (#[from] preserves the inner cause).
    use std::error::Error as _;
    assert!(reporting_err.source().is_some());
}

/// Inside the crate, `ReportingError` is exhaustively matchable
/// despite `#[non_exhaustive]`. Pins the contract that the
/// `match` arms cover every variant the crate currently produces.
#[test]
fn internal_exhaustive_match_all_variants() {
    let label = |e: &ReportingError| -> &'static str {
        match e {
            ReportingError::Db(_) => "db",
            ReportingError::InvalidWindow(_) => "window",
            ReportingError::Io(_) => "io",
        }
    };
    assert_eq!(
        label(&ReportingError::Db(rusqlite::Error::InvalidParameterName(
            "p".into()
        ))),
        "db"
    );
    assert_eq!(label(&ReportingError::InvalidWindow("p".into())), "window");
    assert_eq!(
        label(&ReportingError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "p"
        ))),
        "io"
    );
}

/// `InvalidWindow` Display passes the inner reason verbatim — no
/// truncation, no redaction. Critical for PCI-DSS audit logging:
/// losing the reason text can hide the real cause from incident
/// reviewers (e.g., a regulator sees "invalid time window" with
/// no specifics and refuses to sign off).
#[test]
fn invalid_window_preserves_verbatim_reason() {
    let err =
        ReportingError::InvalidWindow("end precedes start by 1 year with timezone shift".into());
    assert_eq!(
        err.to_string(),
        "invalid time window: end precedes start by 1 year with timezone shift"
    );
}
