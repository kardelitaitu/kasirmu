//! Tests for business-date resolution in a location's IANA zone.

use super::*;
use chrono::TimeZone;
use chrono::Utc;

#[test]
fn utc_instant_stays_on_the_same_day_for_utc_zone() {
    // 2026-03-15T23:30:00Z is still the 15th in UTC.
    let instant = Utc.with_ymd_and_hms(2026, 3, 15, 23, 30, 0).unwrap();
    assert_eq!(business_date_in_zone(instant, "UTC"), "2026-03-15");
}

#[test]
fn jayapura_pushes_a_late_utc_instant_to_the_next_local_day() {
    // Asia/Jayapura is UTC+9. 2026-03-15T23:30:00Z is 2026-03-16T08:30 in Jayapura.
    let instant = Utc.with_ymd_and_hms(2026, 3, 15, 23, 30, 0).unwrap();
    assert_eq!(
        business_date_in_zone(instant, "Asia/Jayapura"),
        "2026-03-16"
    );
}

#[test]
fn jakarta_midday_utc_stays_on_the_same_local_day() {
    // Asia/Jakarta is UTC+7. 2026-03-15T10:00:00Z is 2026-03-15T17:00 in Jakarta.
    let instant = Utc.with_ymd_and_hms(2026, 3, 15, 10, 0, 0).unwrap();
    assert_eq!(business_date_in_zone(instant, "Asia/Jakarta"), "2026-03-15");
}

#[test]
fn unknown_zone_falls_back_to_utc_not_a_wrong_day() {
    let instant = Utc.with_ymd_and_hms(2026, 3, 15, 23, 30, 0).unwrap();
    assert_eq!(business_date_in_zone(instant, "Not/A-Zone"), "2026-03-15");
}
