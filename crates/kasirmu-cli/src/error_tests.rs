use super::*;

#[test]
fn subcommand_display() {
    let err = CliError::Subcommand("migrate", "connection refused".into());
    assert_eq!(
        err.to_string(),
        "subcommand `migrate` failed: connection refused"
    );
}

#[test]
fn args_display() {
    let err = CliError::Args("missing required argument".into());
    assert_eq!(
        err.to_string(),
        "invalid arguments: missing required argument"
    );
}

#[test]
fn open_database_display() {
    let err = CliError::OpenDatabase(rusqlite::Error::InvalidParameterName("bad".into()));
    let msg = err.to_string();
    assert!(msg.starts_with("could not open database:"));
    assert!(msg.len() > "could not open database: ".len());
}

#[test]
fn from_rusqlite_error() {
    let db_err = rusqlite::Error::InvalidParameterName("x".into());
    let cli_err: CliError = db_err.into();
    assert!(matches!(cli_err, CliError::OpenDatabase(_)));
    assert!(cli_err.to_string().contains("could not open database"));
}

#[test]
fn implements_std_error() {
    let err = CliError::Args("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn debug_output() {
    let err = CliError::Subcommand("backup", "disk full".into());
    let debug = format!("{:?}", err);
    assert!(debug.contains("Subcommand"));
    assert!(debug.contains("backup"));
    assert!(debug.contains("disk full"));
}

#[test]
fn empty_args() {
    let err = CliError::Args("".into());
    assert_eq!(err.to_string(), "invalid arguments: ");
}

// --- Tests migrated from the old lib.rs test block ---

#[test]
fn subcommand_error_display() {
    let err = CliError::Subcommand("migrate", "failed".into());
    assert_eq!(err.to_string(), "subcommand `migrate` failed: failed");
}

#[test]
fn open_database_error_display_lib() {
    let inner = rusqlite::Error::InvalidParameterName("x".into());
    let err = CliError::OpenDatabase(inner);
    assert!(err.to_string().contains("could not open database"));
}

#[test]
fn args_error_display_lib() {
    let err = CliError::Args("missing <sku>".into());
    assert_eq!(err.to_string(), "invalid arguments: missing <sku>");
}

#[test]
fn error_is_debug_lib() {
    let err = CliError::Args("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn open_database_from_rusqlite() {
    let inner = rusqlite::Error::InvalidParameterName("foo".into());
    let err: CliError = inner.into();
    assert!(err.to_string().contains("could not open database"));
}
