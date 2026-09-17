//! REP-03 datetime contract shared by every date-bucketed report query.
//!
//! The store-timezone plumbing: [`parse_utc_offset`] validates the fixed
//! `'+HH:MM'`/`'-HH:MM'`/`'UTC'` shape `locations.timezone` holds,
//! [`Store::tz_modifier`] resolves the primary store's offset for SQLite
//! date modifiers, and [`check_date_bound`] rejects malformed range
//! boundaries at the door. These are the two free functions the sibling
//! `analytics` / `popularity` modules import through `db::reports`.
//!
//! Split from `db/reports.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits.

use crate::db::Store;
use crate::error::CoreError;

/// Parse the REP-03 timezone contract: a fixed UTC offset string
/// (`'+HH:MM'` / `'-HH:MM'`) or the literal `'UTC'`, normalized to
/// `'+00:00'`. Anything else — including IANA zone names — returns
/// `None` so the caller falls back to UTC semantics.
///
/// The normalization to `'+00:00'` is deliberate: SQLite's `'UTC'`
/// *modifier* is not a no-op on bare values (in 3.45 `DATE('now','UTC')`
/// reinterprets the UTC `now` as local time and can shift a whole day;
/// 3.50 changed the behavior). A `±HH:MM` offset is pure arithmetic and
/// version-stable.
pub(crate) fn parse_utc_offset(raw: &str) -> Option<String> {
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
    /// `'UTC'`. IANA names are deliberately NOT interpreted — core carries
    /// no tzdata dependency, and a misconfigured store must fall back to
    /// UTC (the pre-REP-03 semantics) rather than guess. The returned
    /// string is validated by [`parse_utc_offset`], so embedding it in
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
        raw.as_deref()
            .and_then(parse_utc_offset)
            .unwrap_or_else(|| "+00:00".into())
    }
}
