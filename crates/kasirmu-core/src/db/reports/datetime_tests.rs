//! Tests for the REP-03 store-timezone contract (C6 slice).
//!
//! Covers the three resolutions [`parse_utc_offset`] must keep distinct: an
//! explicit fixed offset, the literal `'UTC'`, and an IANA zone name resolved
//! through [`crate::timezone::offset_for_zone`]. The unknown-zone case is
//! asserted at the level that is observable without a log subscriber —
//! `parse_utc_offset` returns `None` (*unresolvable*), which is what makes the
//! `tz_modifier` warning fire; the warn call itself is covered by review.

use super::*;

#[test]
fn explicit_positive_offset_is_kept_verbatim() {
    assert_eq!(parse_utc_offset("+05:30").as_deref(), Some("+05:30"));
    assert_eq!(parse_utc_offset("+07:00").as_deref(), Some("+07:00"));
    assert_eq!(parse_utc_offset("-05:00").as_deref(), Some("-05:00"));
}

#[test]
fn utc_literal_normalizes_to_a_fixed_offset() {
    // Not `'UTC'`: SQLite's `'UTC'` modifier is not a no-op on bare values.
    assert_eq!(parse_utc_offset("UTC").as_deref(), Some("+00:00"));
}

#[test]
fn jakarta_resolves_to_plus_seven_so_a_local_day_is_the_bucket() {
    // The C6 bug: the wizard writes `Asia/Jakarta`, and the report read path
    // used to answer `None` -> `+00:00`, so a 00:30 WIB sale (17:30Z the day
    // before) was bucketed on the UTC day. +07:00 is what puts it back.
    assert_eq!(parse_utc_offset("Asia/Jakarta").as_deref(), Some("+07:00"));
    assert_eq!(parse_utc_offset("asia/jakarta").as_deref(), Some("+07:00"));
}

#[test]
fn the_other_indonesian_launch_zones_resolve_through_the_same_resolver() {
    assert_eq!(parse_utc_offset("Asia/Makassar").as_deref(), Some("+08:00"));
    assert_eq!(parse_utc_offset("Asia/Jayapura").as_deref(), Some("+09:00"));
    assert_eq!(
        parse_utc_offset("Asia/Pontianak").as_deref(),
        Some("+07:00")
    );
}

#[test]
fn unknown_zone_is_unresolvable_not_silently_utc() {
    // `None`, not `Some("+00:00")` — the difference is what makes the
    // `tz_modifier` fallback visible instead of indistinguishable from a real
    // UTC store.
    for unknown in ["Not/A-Zone", "Mars/Olympus", "", "   ", "Asia/Nowhere"] {
        assert_eq!(parse_utc_offset(unknown), None, "{unknown:?}");
    }
}

#[test]
fn malformed_shapes_stay_rejected() {
    // The pre-existing shape rules must not be loosened by the IANA branch.
    for bad in [
        "", "UTC+7", "+7:00", "+05:5", "+0530", "25:00", "+05:60", "junk",
    ] {
        assert_eq!(parse_utc_offset(bad), None, "{bad:?}");
    }
}

#[test]
fn every_known_zone_resolves_to_a_sqlite_safe_offset_shape() {
    // Whatever the resolver returns is embedded in `format!`-built SQL, so it
    // must always be the `±HH:MM` shape — never a zone name, never `UTC`.
    for zone in ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] {
        let got = parse_utc_offset(zone).unwrap_or_else(|| panic!("{zone} must resolve"));
        let b = got.as_bytes();
        assert_eq!(got.len(), 6, "{zone} -> {got:?} is not a 6-byte offset");
        assert!(
            matches!(b[0], b'+' | b'-'),
            "{zone} -> {got:?} lost its sign"
        );
        assert_eq!(b[3], b':', "{zone} -> {got:?} lost its colon");
    }
}

#[test]
fn date_bound_validation_is_unchanged() {
    assert!(check_date_bound("start", "2026-07-11").is_ok());
    assert!(check_date_bound("start", "2026-7-11").is_err());
    assert!(check_date_bound("start", "2026-13-01").is_err());
    assert!(check_date_bound("start", "2026-07-32").is_err());
}
