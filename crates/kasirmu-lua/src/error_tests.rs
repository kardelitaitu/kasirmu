use super::*;

#[test]
fn init_display() {
    let err = LuaError::Init("VM crashed".into());
    assert_eq!(err.to_string(), "lua runtime init failed: VM crashed");
}

#[test]
fn script_display() {
    let err = LuaError::Script("syntax error".into());
    assert_eq!(err.to_string(), "lua script error: syntax error");
}

#[test]
fn unknown_binding_display() {
    let err = LuaError::UnknownBinding("nonexistent".into());
    assert_eq!(err.to_string(), "unknown binding: nonexistent");
}

#[test]
fn load_display() {
    let err = LuaError::Load("file not found".into());
    assert_eq!(err.to_string(), "lua script load failed: file not found");
}

#[test]
fn debug_output() {
    let err = LuaError::Script("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn implements_std_error() {
    let err = LuaError::Init("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<LuaError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", LuaError::Init("x".into()));
    let b = format!("{:?}", LuaError::Script("x".into()));
    assert_ne!(a, b);
}
