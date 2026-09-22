//! Business-date resolution in a location's IANA timezone.
//!
//! ADR #48 (Decision 3) defines `as_of` for tax and exchange-rate lookups as
//! a business date (YYYY-MM-DD) resolved in the *location's* IANA zone, not a raw
//! UTC instant. Indonesia launches on three IANA zones - Asia/Jakarta (+07, WIB),
//! Asia/Makassar (+08, WITA) and Asia/Jayapura (+09, WIT) - that have never
//! observed DST, so a fixed-offset lookup is correct and needs no `chrono-tz`
//! dependency. An unknown or empty zone name falls back to UTC, matching the
//! existing `resolve_now_in_timezone` precedent in `export::email_sender`.

use chrono::{DateTime, FixedOffset, Utc};

/// The `locations.timezone` values [`offset_for_zone`] actually maps: its
/// match arms other than the `_` fallback. A name outside this list resolves
/// to UTC *through that fallback arm*, so a caller that must tell "this is
/// UTC" from "this could not be resolved" asks here instead of comparing
/// offsets.
///
/// Kept in step with the arms of [`offset_for_zone`] — the two state the same
/// decision, twice, because that function's body is contract-frozen.
const KNOWN_ZONES: &[&str] = &[
    "utc",
    "gmt",
    "asia/jakarta",
    "asia/pontianak",
    "asia/makassar",
    "asia/jayapura",
];

/// Whether `tz_name` is a value [`offset_for_zone`] resolves rather than
/// falls back on. Case-insensitive, compared exactly as [`offset_for_zone`]
/// compares it; an unrecognised *or empty* name is `false`.
pub(crate) fn is_known_zone(tz_name: &str) -> bool {
    KNOWN_ZONES.contains(&tz_name.to_ascii_lowercase().as_str())
}

/// Resolve the fixed UTC offset for a stored IANA zone name.
///
/// Returns UTC for the empty string, `utc`/`gmt`, or any unrecognised name.
/// Indonesia's three launch zones carry stable offsets (no DST), so a constant
/// lookup is sufficient; future zones extend this match.
pub(crate) fn offset_for_zone(tz_name: &str) -> FixedOffset {
    match tz_name.to_ascii_lowercase().as_str() {
        "" | "utc" | "gmt" => {
            // SAFETY: 00:00 is a compile-time constant inside chrono's +/-23:59:59 range.
            FixedOffset::east_opt(0).unwrap()
        }
        "asia/jakarta" | "asia/pontianak" => {
            // SAFETY: +07:00 is a compile-time constant inside chrono's +/-23:59:59 range.
            FixedOffset::east_opt(7 * 3600).unwrap()
        }
        "asia/makassar" => {
            // SAFETY: +08:00 is a compile-time constant inside chrono's +/-23:59:59 range.
            FixedOffset::east_opt(8 * 3600).unwrap()
        }
        "asia/jayapura" => {
            // SAFETY: +09:00 is a compile-time constant inside chrono's +/-23:59:59 range.
            FixedOffset::east_opt(9 * 3600).unwrap()
        }
        _ => {
            // Unknown zone: fall back to UTC rather than inventing an offset. A
            // corrupt or missing `locations.timezone` must never resolve a money
            // question to the wrong day.
            // SAFETY: 00:00 is a compile-time constant inside chrono's +/-23:59:59
            // range, so east_opt(0) is always Some.
            FixedOffset::east_opt(0).unwrap()
        }
    }
}

/// The business date (YYYY-MM-DD) at `instant` in the given IANA zone.
///
/// `instant` is the UTC source (typically `Utc::now()`); the location's IANA
/// zone is applied and the local calendar date is taken as `as_of`. Unknown
/// zones fall back to the UTC date so a corrupt or missing timezone never picks a
/// wrong day.
#[must_use]
pub fn business_date_in_zone(instant: DateTime<Utc>, tz_name: &str) -> String {
    instant
        .with_timezone(&offset_for_zone(tz_name))
        .format("%Y-%m-%d")
        .to_string()
}

#[cfg(test)]
#[path = "timezone_tests.rs"]
mod tests;
