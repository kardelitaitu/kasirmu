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
    let debug = format!("{ctx:?}");
    assert!(debug.contains("u1"));
    assert!(debug.contains("s1"));
    assert!(debug.contains("restaurant-pos"));
    assert!(debug.contains("42"));
    assert!(debug.contains('7'));
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

/// The expiry comparison must never answer "live" for an unreadable clock.
///
/// `is_expired` read the clock with `.unwrap_or_default()`, so a pre-epoch clock
/// produced `now = 0` and `0 >= ts` was false for every real expiry — the session
/// read as LIVE. The gate that consumes this is
/// `Some(ctx) if !ctx.is_expired() => return Ok(ctx.clone())` in each shell's
/// `state.rs`, so the wrong answer handed back an expired context as valid: a
/// pre-epoch clock left every expired bearer token usable. The old comment called
/// this covering "the pre-epoch case"; it covered it in the direction that must
/// never be reached.
///
/// HONEST SCOPE: this pin does NOT cover the fix. The pre-epoch branch is not
/// constructible here — a test cannot move the system clock — and restoring the
/// old `.unwrap_or_default()` leaves this test GREEN, verified. What it covers is
/// the comparison the failure branch feeds into: a past expiry reads expired, an
/// absent one reads live, a far-future one stays live. It would catch a regression
/// that inverted that comparison; the clock branch's correctness rests on reading,
/// and is not asserted here.
#[test]
fn expiry_never_reports_live_for_a_timestamp_it_cannot_rank() {
    let ctx = |expires_at: Option<i64>| {
        SessionContext::new(
            "u1".into(),
            "r1".into(),
            "t1".into(),
            "s1".into(),
            "i1".into(),
            "pos".into(),
            expires_at,
            0,
        )
    };

    // Past expiry -> expired (the ordinary case the gate relies on).
    assert!(ctx(Some(1)).is_expired(), "a past expiry must read expired");
    // No expiry -> live, and that is the ONE legitimate live answer.
    assert!(
        !ctx(None).is_expired(),
        "a session with no expiry is never expired"
    );
    // A far-future expiry stays live.
    assert!(
        !ctx(Some(9_999_999_999)).is_expired(),
        "an expiry centuries away must not read as expired"
    );
    // NOTE on what is NOT asserted here. An earlier version of this pin claimed
    // `ctx(Some(i64::MAX))` must read EXPIRED as "unrankable". That was wrong and
    // the test caught it: `i64::MAX` seconds is a genuine timestamp ~292 billion
    // years out, so `now >= ts` is legitimately false and the session IS live.
    // The fail-closed rule belongs to the CLOCK READ, not to the comparison, and
    // the clock cannot be moved from a test.
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
