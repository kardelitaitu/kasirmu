use super::*;

#[test]
fn log_dir_unusable_display() {
    let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
    let err = LoggingError::LogDirUnusable(io);
    assert!(err.to_string().contains("could not prepare log directory:"));
}

#[test]
fn log_dir_unusable_source() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
    let err = LoggingError::LogDirUnusable(io);
    assert!(std::error::Error::source(&err).is_some());
}

#[test]
fn invalid_level_display() {
    let err = LoggingError::InvalidLevel("TRACE".into());
    assert_eq!(err.to_string(), "invalid log level: TRACE");
}

#[test]
fn debug_output() {
    let err = LoggingError::InvalidLevel("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn implements_std_error() {
    let err = LoggingError::InvalidLevel("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn init_failed_display() {
    let err = LoggingError::InitFailed("already set".into());
    assert!(err.to_string().contains("already initialised"));
    assert!(err.to_string().contains("already set"));
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<LoggingError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", LoggingError::InvalidLevel("x".into()));
    let b = format!(
        "{:?}",
        LoggingError::LogDirUnusable(std::io::Error::other("x"))
    );
    assert_ne!(a, b);
}
