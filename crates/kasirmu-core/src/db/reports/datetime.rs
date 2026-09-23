//! REP-03 datetime contract shared by every date-bucketed report query.
//!
//! The store-timezone plumbing: [`parse_utc_offset`] resolves the value
//! `locations.timezone` holds — an explicit fixed offset (`'+HH:MM'` /
//! `'-HH:MM'`), the literal `'UTC'`, or an IANA zone name delegated to
//! [`crate::timezone::offset_for_zone`] — and [`Store::tz_modifier`] resolves
//! the primary store's offset for SQLite date modifiers. [`check_date_bound`]
//! rejects malformed range boundaries at the door. These are the two free
//! functions the sibling `analytics` / `popularity` modules import through
//! `db::reports`.
//!
//! C6 (23-09-26): IANA names used to be rejected here while every *writer* of
//! `locations.timezone` stores one (the setup wizard hardcodes `Asia/Jakarta`;
//! the bridge accepts only the three Indonesian zones plus `UTC`), so the read
//! path bucketed a WIB store's revenue in UTC. Resolution now goes through the
//! crate's single zone resolver — the same mapping the tax path uses — and the
//! remaining `'+00:00'` fallback is logged instead of silent.
//!
//! Split from `db/reports.rs` 13-09-26: pure module decomposition, no logic
//! edits. The C6 slice above is the first logic change since that split.

use crate::db::Store;
use crate::error::CoreError;

/// Parse the REP-03 timezone contract into a SQLite date modifier.
///
/// Accepts, in order: a fixed UTC offset string (`'+HH:MM'` / `'-HH:MM'`),
/// the literal `'UTC'` (normalized to `'+00:00'`), or an IANA zone name
/// ([`crate::timezone::is_known_zone`]) which resolves through
/// [`crate::timezone::offset_for_zone`] to the `±HH:MM` shape.
///
/// Returns `None` for anything else — an unknown zone, an empty value, a
/// shape that is neither an offset nor a zone. `None` means *unresolvable*,
/// not *UTC*: a caller that wants to report the fallback must treat it as
/// such. A real UTC store returns `Some("+00:00")`.
///
/// The normalization to `'+00:00'` is deliberate: SQLite's `'UTC'`
/// *modifier* is not a no-op on bare values (in 3.45 `DATE('now','UTC')`
/// reinterprets the UTC `now` as local time and can shift a whole day;
/// 3.50 changed the behavior). A `±HH:MM` offset is pure arithmetic and
/// version-stable — which is why an IANA name is resolved to an offset here
/// rather than passed to SQLite as a zone name.
pub(crate) fn parse_utc_offset(raw: &str) -> Option<String> {
    if let Some(fixed) = parse_fixed_offset(raw) {
        return Some(fixed);
    }
    // Not an explicit offset: try the crate's IANA zone resolver, so reports
    // bucket on the same business day the tax path resolves (ADR #48).
    // `is_known_zone` is what keeps "this store is on UTC" distinguishable
    // from "this value could not be resolved": `offset_for_zone` answers
    // +00:00 for both, so the offset alone cannot tell the caller which one
    // it got — and only the second should warn.
    let zone = raw.trim();
    if crate::timezone::is_known_zone(zone) {
        // `Display for FixedOffset` is `±HH:MM` (zero-padded, seconds omitted
        // at :00), the exact shape the fixed branch below produces and the
        // only thing the callers may embed in `format!`-built SQL.
        return Some(crate::timezone::offset_for_zone(zone).to_string());
    }
    None
}

/// The literal-and-shape half of [`parse_utc_offset`], unchanged since
/// REP-03: `'UTC'` or a six-byte `±HH:MM` with in-range digits.
fn parse_fixed_offset(raw: &str) -> Option<String> {
    if raw == "UTC" {
        return Some("+00:00".into());
    }
    let b = raw.as_bytes();
    if b.len() != 6 || !matches!(b[0], b'+' | b'-') || b[3] != b':' {
        return None;
    }
    if !(b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[4].is_ascii_digit()
        && b[5].is_ascii_digit())
    {
        return None;
    }
    let hh = (b[1] - b'0') * 10 + (b[2] - b'0');
    let mm = (b[4] - b'0') * 10 + (b[5] - b'0');
    if hh > 23 || mm > 59 {
        return None;
    }
    Some(raw.to_string())
}

/// Validate a report date boundary as a strict `YYYY-MM-DD` calendar-ish
/// string (REP-03). SQLite date functions silently return NULL for
/// garbage, which would make a mistyped boundary vanish rows without an
/// error — so malformed input is rejected at the door instead.
pub(crate) fn check_date_bound(field: &'static str, v: &str) -> Result<(), CoreError> {
    let bad = |msg: String| CoreError::Validation {
        field,
        message: msg,
    };
    let b = v.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || ![0, 1, 2, 3, 5, 6, 8, 9]
            .iter()
            .all(|&i| b[i].is_ascii_digit())
    {
        return Err(bad(format!("expected YYYY-MM-DD, got {v:?}")));
    }
    let month: u8 = v[5..7].parse().map_err(|_| bad(String::new()))?;
    let day: u8 = v[8..10].parse().map_err(|_| bad(String::new()))?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(bad(format!("month must be 01-12 and day 01-31, got {v:?}")));
    }
    Ok(())
}

impl Store<'_> {
    /// Resolve the primary store's fixed UTC offset for SQLite date
    /// modifiers (REP-03). Shared by every date-bucketed query in the
    /// `db` module tree (analytics, popularity, sales, shifts).
    ///
    /// Contract: `locations.timezone` holds `'+HH:MM'` / `'-HH:MM'` /
    /// `'UTC'` / an IANA zone name — the last resolved through
    /// [`crate::timezone::offset_for_zone`], so reports and the tax path
    /// agree on the business day. A value that resolves to neither still
    /// falls back to UTC (the pre-REP-03 semantics) rather than guess, but
    /// the fallback is now logged: silently bucketing a day's revenue in the
    /// wrong zone is exactly the failure this warn exists to surface.
    ///
    /// The returned string is always `±HH:MM` — validated by
    /// [`parse_utc_offset`] on the way out — so embedding it in
    /// `format!`-built SQL cannot inject anything beyond a date modifier.
    pub(crate) fn tz_modifier(&self) -> String {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT timezone FROM locations WHERE is_primary = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        match raw.as_deref().and_then(parse_utc_offset) {
            Some(offset) => offset,
            None => {
                tracing::warn!(
                    timezone = raw.as_deref().unwrap_or("<no primary location>"),
                    "unresolvable locations.timezone — report bucketing falls back to UTC (+00:00)"
                );
                "+00:00".into()
            }
        }
    }
}

#[cfg(test)]
#[path = "datetime_tests.rs"]
mod tests;
