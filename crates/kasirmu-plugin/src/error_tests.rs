use super::*;

#[test]
fn manifest_display() {
    let err = PluginError::Manifest("invalid JSON".into());
    assert_eq!(err.to_string(), "plugin manifest error: invalid JSON");
}

#[test]
fn io_error_display_and_source() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
    let err = PluginError::Io(io);
    assert!(err.to_string().contains("I/O error:"));
    assert!(std::error::Error::source(&err).is_some());
}

#[test]
fn lua_display() {
    let err = PluginError::Lua("syntax error".into());
    assert_eq!(err.to_string(), "Lua error: syntax error");
}

#[test]
fn not_found_display() {
    let err = PluginError::NotFound("plugin-x".into());
    assert_eq!(err.to_string(), "plugin not found: plugin-x");
}

#[test]
fn permission_denied_display() {
    let err = PluginError::PermissionDenied("admin only".into());
    assert_eq!(err.to_string(), "permission denied: admin only");
}

#[test]
fn debug_output() {
    let err = PluginError::NotFound("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn implements_std_error() {
    let err = PluginError::Manifest("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PluginError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", PluginError::Manifest("x".into()));
    let b = format!("{:?}", PluginError::NotFound("x".into()));
    assert_ne!(a, b);
}
