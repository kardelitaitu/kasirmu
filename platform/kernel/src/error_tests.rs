//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn duplicate_module_display() {
    let err = KernelError::DuplicateModule("sales");
    assert_eq!(err.to_string(), "module 'sales' is already registered");
}

#[test]
fn duplicate_module_debug() {
    let err = KernelError::DuplicateModule("test");
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn missing_dependency_display() {
    let err = KernelError::MissingDependency {
        module: "sales",
        dep: "inventory",
    };
    let msg = err.to_string();
    assert!(
        msg.contains("sales"),
        "msg should contain 'sales', got: {msg}"
    );
    assert!(
        msg.contains("inventory"),
        "msg should contain 'inventory', got: {msg}"
    );
    assert!(
        msg.contains("depends"),
        "msg should contain 'depends', got: {msg}"
    );
}

#[test]
fn circular_dependency_display() {
    let err = KernelError::CircularDependency("a, b, c".into());
    let msg = err.to_string();
    assert!(
        msg.contains("circular"),
        "msg should contain 'circular', got: {msg}"
    );
    assert!(
        msg.contains("a, b, c"),
        "msg should contain 'a, b, c', got: {msg}"
    );
}

#[test]
fn manifest_parse_error_display() {
    let err = KernelError::ManifestParseError {
        module: "sales".into(),
        message: "invalid JSON".into(),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("sales"),
        "msg should contain 'sales', got: {msg}"
    );
    assert!(
        msg.contains("invalid JSON"),
        "msg should contain 'invalid JSON', got: {msg}"
    );
    assert!(
        msg.contains("manifest"),
        "msg should contain 'manifest', got: {msg}"
    );
}

#[test]
fn lifecycle_error_display() {
    let err = KernelError::LifecycleError {
        module: "inventory",
        operation: "start",
        source: anyhow::anyhow!("disk full"),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("inventory"),
        "msg should contain 'inventory', got: {msg}"
    );
    assert!(
        msg.contains("start"),
        "msg should contain 'start', got: {msg}"
    );
    assert!(
        msg.contains("disk full"),
        "msg should contain 'disk full', got: {msg}"
    );
}

#[test]
fn lifecycle_error_source() {
    let inner = anyhow::anyhow!("underlying cause");
    let err = KernelError::LifecycleError {
        module: "test",
        operation: "load",
        source: inner,
    };
    let source = std::error::Error::source(&err);
    assert!(source.is_some(), "LifecycleError should have a source");
    assert_eq!(source.unwrap().to_string(), "underlying cause");
}

#[test]
fn service_error_display() {
    let err = KernelError::ServiceError {
        service: "sync-engine",
        operation: "stop",
        source: anyhow::anyhow!("timeout"),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("sync-engine"),
        "msg should contain 'sync-engine', got: {msg}"
    );
    assert!(
        msg.contains("stop"),
        "msg should contain 'stop', got: {msg}"
    );
    assert!(
        msg.contains("timeout"),
        "msg should contain 'timeout', got: {msg}"
    );
}

#[test]
fn service_error_source() {
    let inner = anyhow::anyhow!("connection refused");
    let err = KernelError::ServiceError {
        service: "api",
        operation: "start",
        source: inner,
    };
    let source = std::error::Error::source(&err);
    assert!(source.is_some(), "ServiceError should have a source");
}

#[test]
fn no_modules_registered_display() {
    let err = KernelError::NoModulesRegistered;
    assert_eq!(err.to_string(), "no modules registered");
}

#[test]
fn internal_error_display() {
    let err = KernelError::Internal("something broke".into());
    assert_eq!(err.to_string(), "internal error: something broke");
}

#[test]
fn kernel_error_debug() {
    let err = KernelError::NoModulesRegistered;
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn kernel_error_variants_distinct() {
    let a = format!("{:?}", KernelError::NoModulesRegistered);
    let b = format!("{:?}", KernelError::Internal("x".into()));
    assert_ne!(a, b);
}

#[test]
fn kernel_error_implements_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<KernelError>();
}

#[test]
fn missing_dependency_fields() {
    let err = KernelError::MissingDependency {
        module: "a",
        dep: "b",
    };
    if let KernelError::MissingDependency { module, dep } = &err {
        assert_eq!(*module, "a");
        assert_eq!(*dep, "b");
    } else {
        panic!("expected MissingDependency");
    }
}
