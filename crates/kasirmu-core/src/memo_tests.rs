use super::*;
use chrono::{TimeZone, Utc};

// ── Scope ───────────────────────────────────────────────────────────

#[test]
fn scope_from_location_ids() {
    let empty: Vec<String> = vec![];
    assert_eq!(
        MemoScope::from_location_ids(&empty),
        MemoScope::Organization,
        "the empty targeting set is an Organization memo"
    );
    assert_eq!(
        MemoScope::from_location_ids(&["loc-1".to_string()]),
        MemoScope::Location
    );
    assert_eq!(
        MemoScope::from_location_ids(&["loc-1".to_string(), "loc-2".to_string()]),
        MemoScope::Location,
        "a multi-location memo is still a Location memo"
    );
}

// ── Memo status: TEXT round-trip + fail-closed parse ────────────────

#[test]
fn memo_status_text_roundtrip() {
    for s in [
        MemoStatus::Draft,
        MemoStatus::Published,
        MemoStatus::Expired,
        MemoStatus::Stopped,
        MemoStatus::Archived,
    ] {
        assert_eq!(MemoStatus::parse(s.as_str()), Some(s), "round-trip {s:?}");
    }
}

#[test]
fn memo_status_parse_unknown_is_none() {
    assert_eq!(MemoStatus::parse("sent"), None);
    assert_eq!(MemoStatus::parse(""), None);
    assert_eq!(
        MemoStatus::parse("PUBLISHED"),
        None,
        "parse is case-sensitive"
    );
}

#[test]
fn memo_status_active_and_terminal() {
    assert!(MemoStatus::Published.is_active());
    for s in [
        MemoStatus::Draft,
        MemoStatus::Expired,
        MemoStatus::Stopped,
        MemoStatus::Archived,
    ] {
        assert!(!s.is_active(), "{s:?} must not display");
    }
    assert!(MemoStatus::Archived.is_terminal());
    assert!(
        !MemoStatus::Expired.is_terminal(),
        "expired can still archive"
    );
}

#[test]
fn memo_status_valid_transitions() {
    use MemoStatus::*;
    assert!(MemoStatus::can_transition(Draft, Published));
    assert!(
        MemoStatus::can_transition(Draft, Archived),
        "a draft can be discarded"
    );
    assert!(MemoStatus::can_transition(Published, Expired));
    assert!(MemoStatus::can_transition(Published, Stopped));
    assert!(MemoStatus::can_transition(Expired, Archived));
    assert!(MemoStatus::can_transition(Stopped, Archived));
}

#[test]
fn memo_status_rejects_illegal_transitions() {
    use MemoStatus::*;
    // Ending a live memo is an explicit Stop, never a silent Archive.
    assert!(
        !MemoStatus::can_transition(Published, Archived),
        "published must not skip to archived without stop/expire"
    );
    // No re-opening a finished memo.
    assert!(!MemoStatus::can_transition(Expired, Published));
    assert!(!MemoStatus::can_transition(Stopped, Published));
    assert!(!MemoStatus::can_transition(Archived, Published));
    assert!(!MemoStatus::can_transition(Archived, Draft));
    // Draft cannot jump to expired/stopped (it was never live).
    assert!(!MemoStatus::can_transition(Draft, Expired));
    assert!(!MemoStatus::can_transition(Draft, Stopped));
    // Self-transitions are not "transitions".
    assert!(!MemoStatus::can_transition(Published, Published));
}

// ── Delivery status ─────────────────────────────────────────────────

#[test]
fn delivery_status_roundtrip_and_parse() {
    for s in [
        DeliveryStatus::Pending,
        DeliveryStatus::Delivered,
        DeliveryStatus::Acknowledged,
    ] {
        assert_eq!(DeliveryStatus::parse(s.as_str()), Some(s));
    }
    assert_eq!(DeliveryStatus::parse("read"), None);
}

#[test]
fn delivery_status_monotonic_transitions() {
    use DeliveryStatus::*;
    assert!(DeliveryStatus::can_transition(Pending, Delivered));
    assert!(DeliveryStatus::can_transition(Delivered, Acknowledged));
    assert!(
        DeliveryStatus::can_transition(Pending, Acknowledged),
        "an ack proves delivery (online terminal)"
    );
    // Never backwards.
    assert!(!DeliveryStatus::can_transition(Acknowledged, Delivered));
    assert!(!DeliveryStatus::can_transition(Acknowledged, Pending));
    assert!(!DeliveryStatus::can_transition(Delivered, Pending));
    assert!(!DeliveryStatus::can_transition(Pending, Pending));
}

// ── Duration & expiry ───────────────────────────────────────────────

#[test]
fn duration_default_is_24h() {
    assert_eq!(DEFAULT_MEMO_DURATION, MemoDuration::Hours24);
}

#[test]
fn duration_text_roundtrip_and_seconds() {
    assert_eq!(MemoDuration::ALL.len(), 5);
    for d in MemoDuration::ALL {
        let s = d.as_str();
        assert_eq!(s.parse::<MemoDuration>().ok(), Some(d), "round-trip {s}");
    }
    assert_eq!(MemoDuration::Hours12.seconds(), 12 * 3600);
    assert_eq!(MemoDuration::Days3.seconds(), 3 * 86_400);
    assert_eq!(MemoDuration::Days30.seconds(), 30 * 86_400);
}

#[test]
fn duration_parse_rejects_unknown() {
    assert!("1h".parse::<MemoDuration>().is_err());
    assert!("".parse::<MemoDuration>().is_err());
    assert!("24H".parse::<MemoDuration>().is_err());
}

#[test]
fn duration_expiry_boundary_is_exclusive() {
    let published = Utc.with_ymd_and_hms(2026, 9, 6, 0, 0, 0).unwrap();
    let d = MemoDuration::Hours24;
    let expires = d.expires_at(published);
    assert_eq!(expires, Utc.with_ymd_and_hms(2026, 9, 7, 0, 0, 0).unwrap());
    // One second before expiry: still active.
    assert!(!d.is_expired(published, expires - ChronoDuration::seconds(1)));
    // Exactly at expiry: expired (>= boundary).
    assert!(d.is_expired(published, expires));
    // After: expired.
    assert!(d.is_expired(published, expires + ChronoDuration::seconds(1)));
}

// ── Cadence constants ───────────────────────────────────────────────

#[test]
fn kds_interval_is_double_the_base() {
    assert_eq!(NOTIFICATION_BASE_INTERVAL_SECS, 15 * 60);
    assert_eq!(NOTIFICATION_CYCLE_SECS, 30);
    assert_eq!(
        kds_notification_interval_secs(),
        NOTIFICATION_BASE_INTERVAL_SECS * 2,
        "KDS is 2× base, derived not hardcoded"
    );
    assert_eq!(kds_notification_interval_secs(), 30 * 60);
}
