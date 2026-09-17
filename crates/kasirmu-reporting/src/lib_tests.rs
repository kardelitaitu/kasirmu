use super::*;

#[test]
fn db_error_display() {
    let inner = rusqlite::Error::InvalidParameterName("x".into());
    let err = ReportingError::Db(inner);
    assert!(err.to_string().contains("database error"));
}

#[test]
fn invalid_window_display() {
    let err = ReportingError::InvalidWindow("end before start".into());
    assert_eq!(err.to_string(), "invalid time window: end before start");
}

#[test]
fn io_error_display() {
    let inner = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
    let err = ReportingError::Io(inner);
    assert!(err.to_string().contains("i/o error"));
}

#[test]
fn error_is_debug() {
    let err = ReportingError::InvalidWindow("x".into());
    assert!(!format!("{err:?}").is_empty());
}
