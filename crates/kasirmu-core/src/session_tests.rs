use super::*;

#[test]
fn session_context_creation() {
    let ctx = SessionContext::new(
        "user-1".into(),
        "role-staff".into(),
        "term-1".into(),
        "store-downtown".into(),
        "default-restaurant-pos".into(),
        "restaurant-pos".into(),
        Some(9999999999), // far future, never expires
        100,
    );
    assert_eq!(ctx.user_id, "user-1");
    assert_eq!(ctx.role_id, "role-staff");
    assert_eq!(ctx.terminal_id, "term-1");
    assert_eq!(ctx.store_id, "store-downtown");
    assert_eq!(ctx.instance_id, "default-restaurant-pos");
    assert_eq!(ctx.type_key, "restaurant-pos");
    assert_eq!(ctx.expires_at, Some(9999999999));
    assert_eq!(ctx.created_at, 100);
    assert!(!ctx.is_expired());
}

#[test]
fn session_context_clone() {
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "type1".into(),
        None,
        0,
    );
    let cloned = ctx.clone();
    assert_eq!(cloned.store_id, ctx.store_id);
    assert_eq!(cloned.user_id, ctx.user_id);
    assert_eq!(cloned.role_id, ctx.role_id);
    assert_eq!(cloned.expires_at, None);
    assert_eq!(cloned.created_at, 0);
}

#[test]
fn session_context_debug_output() {
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "restaurant-pos".into(),
        Some(42),
        7,
    );
    let debug = format!("{:?}", ctx);
    assert!(debug.contains("u1"));
    assert!(debug.contains("s1"));
    assert!(debug.contains("restaurant-pos"));
    assert!(debug.contains("42"));
    assert!(debug.contains("7"));
}

#[test]
fn session_context_empty_strings_accepted() {
    let ctx = SessionContext::new(
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        None,
        0,
    );
    assert_eq!(ctx.user_id, "");
    assert_eq!(ctx.store_id, "");
    assert_eq!(ctx.type_key, "");
    assert_eq!(ctx.expires_at, None);
    assert_eq!(ctx.created_at, 0);
}

#[test]
fn session_context_different_stores_are_independent() {
    let store_a = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "store-a".into(),
        "i1".into(),
        "pos".into(),
        None,
        0,
    );
    let store_b = SessionContext::new(
        "u2".into(),
        "r2".into(),
        "t2".into(),
        "store-b".into(),
        "i2".into(),
        "pos".into(),
        None,
        1,
    );
    assert_ne!(store_a.store_id, store_b.store_id);
    assert_ne!(store_a.user_id, store_b.user_id);
    assert_ne!(store_a.instance_id, store_b.instance_id);
}

#[test]
fn session_context_all_fields_accessible() {
    let ctx = SessionContext::new(
        "user-42".into(),
        "role-admin".into(),
        "term-front".into(),
        "store-main".into(),
        "default-pos".into(),
        "restaurant-pos".into(),
        None,
        42,
    );
    assert_eq!(ctx.user_id, "user-42");
    assert_eq!(ctx.role_id, "role-admin");
    assert_eq!(ctx.terminal_id, "term-front");
    assert_eq!(ctx.store_id, "store-main");
    assert_eq!(ctx.instance_id, "default-pos");
    assert_eq!(ctx.type_key, "restaurant-pos");
    assert_eq!(ctx.expires_at, None);
    assert_eq!(ctx.created_at, 42);
}

#[test]
fn session_context_expired_returns_true_when_past_expiry() {
    // expires_at = 1 (epoch + 1 second) — always expired.
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "pos".into(),
        Some(1),
        0,
    );
    assert!(ctx.is_expired());
}

#[test]
fn session_context_no_expiry_never_expired() {
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "pos".into(),
        None,
        0,
    );
    assert!(!ctx.is_expired());
}

#[test]
fn session_context_future_expiry_not_expired() {
    // 9999999999 is epoch + ~317 years — always in the future.
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "pos".into(),
        Some(9999999999),
        0,
    );
    assert!(!ctx.is_expired());
}
