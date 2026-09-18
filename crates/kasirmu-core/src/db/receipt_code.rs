//! Index ids for the receipt hierarchy code.
//!
//! An index id is an immutable badge allocated once, at registration, and
//! printed as two uppercase hex digits inside the receipt code
//! (`01-02-260918-01-000123`). It is deliberately NOT "the Nth location":
//! a value is never reused, because a retired `02` reissued to a new
//! location would make every historic receipt naming `02` resolve to the
//! wrong store — and with a tax number on the receipt that is
//! falsification, not a cosmetic bug.
//!
//! Allocation is monotonic, driven by `entity_index_cursors`, so even a row
//! deleted without a tombstone cannot hand its index to the next entity.
//! `0x00` is never allocated: it is the display sentinel for "no staff"
//! (kiosk and system sales). The ceiling is `0xFF` — two hex digits is all
//! the field can express — and the allocator refuses rather than wraps,
//! because a wrap would reissue live codes.
//!
//! Design and decisions: docs/plans/receipt-hierarchy-code.md

use chrono::{DateTime, FixedOffset};
use rusqlite::{OptionalExtension, params};

use crate::CoreError;

/// Largest index id the two-hex-digit field can express.
pub const INDEX_ID_MAX: i64 = 0xFF;

/// Display sentinel for "no entity" — a kiosk sale has no staff.
pub const INDEX_ID_NONE: i64 = 0x00;

/// The per-tenant axis an index id belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityIndexKind {
    /// `locations.index_id`.
    Location,
    /// `terminals.index_id`.
    Terminal,
    /// `users.index_id`.
    User,
}

impl EntityIndexKind {
    /// The value stored in `entity_kind`, CHECK-constrained by the schema.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Location => "location",
            Self::Terminal => "terminal",
            Self::User => "user",
        }
    }
}

/// Render an index id as the two uppercase hex digits used in the code.
#[must_use]
pub fn index_hex(value: i64) -> String {
    format!("{value:02X}")
}

impl crate::db::Store<'_> {
    /// Allocate the next index id for `(tenant_id, kind)`.
    ///
    /// Monotonic and never reused. The claim is one statement — the
    /// increment reads the row's own `next_value` at write time — so two
    /// interleaved allocations can never observe the same ordinal.
    ///
    /// Must be called inside a transaction. On exhaustion the caller is
    /// expected to roll back, which is what stops a refused allocation
    /// from consuming an index anyway.
    pub fn allocate_entity_index(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        kind: EntityIndexKind,
        now: &str,
    ) -> Result<i64, CoreError> {
        // Seed 2, read `next_value - 1`: the stored cursor then always
        // means "the next id to hand out", including on the very first
        // insert, which no conflict branch ever touches.
        let allocated: i64 = tx.query_row(
            "INSERT INTO entity_index_cursors (tenant_id, entity_kind, next_value, updated_at)
             VALUES (?1, ?2, 2, ?3)
             ON CONFLICT(tenant_id, entity_kind)
                 DO UPDATE SET next_value = next_value + 1, updated_at = ?3
             RETURNING next_value - 1",
            params![tenant_id, kind.as_str(), now],
            |row| row.get(0),
        )?;

        if allocated > INDEX_ID_MAX {
            return Err(CoreError::Validation {
                field: "index_id",
                message: format!(
                    "index id exhausted: {} for tenant '{}' has reached {INDEX_ID_MAX} \
                     (0xFF); the two-hex-digit field cannot express another",
                    kind.as_str(),
                    tenant_id
                ),
            });
        }
        Ok(allocated)
    }

    /// Record what a retired index id *was*, so historic codes resolve.
    ///
    /// Append-only and idempotent: re-retiring the same index is a no-op.
    /// This does not free the index — only `entity_index_cursors` decides
    /// what gets handed out, and it never goes backwards.
    pub fn retire_entity_index(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        kind: EntityIndexKind,
        index_id: i64,
        entity_id: &str,
        label: &str,
        now: &str,
    ) -> Result<(), CoreError> {
        tx.execute(
            "INSERT INTO entity_index_tombstones
                 (tenant_id, entity_kind, index_id, entity_id, label, retired_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(tenant_id, entity_kind, index_id) DO NOTHING",
            params![tenant_id, kind.as_str(), index_id, entity_id, label, now],
        )?;
        Ok(())
    }

    /// What an index id resolved to, for a code that outlived its row.
    ///
    /// Returns the tombstone label when the entity was retired, or `None`
    /// when this tenant never issued that index.
    pub fn retired_entity_label(
        &self,
        tenant_id: &str,
        kind: EntityIndexKind,
        index_id: i64,
    ) -> Result<Option<String>, CoreError> {
        self.conn
            .query_row(
                "SELECT label FROM entity_index_tombstones
                  WHERE tenant_id = ?1 AND entity_kind = ?2 AND index_id = ?3",
                params![tenant_id, kind.as_str(), index_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }
}

/// Smallest sequence the 6-digit tail can express — the first receipt of a
/// fiscal year.
pub const SEQUENCE_MIN: i64 = 1;

/// Largest sequence the 6-digit tail can express. The series is continuous
/// per terminal per fiscal year, so this is the per-terminal annual ceiling
/// (999,999 ≈ 2,739/day). Per §4.6 the claim refuses rather than wraps.
pub const SEQUENCE_MAX: i64 = 999_999;

/// Assemble the frozen 22-character receipt code.
///
/// Pure: it takes the already-resolved indices and the store-local date, so
/// it is trivially testable and the same code that freezes at checkout also
/// renders in a reprint six months later. The caller passes
/// [`INDEX_ID_NONE`] (0x00) for `staff_idx` when the sale has no staff
/// (`sales.user_id` is null — kiosk / system sale), so the code never
/// prints a staff index that was never assigned.
///
/// Format: `{loc:02X}-{term:02X}-{YYMMDD}-{staff:02X}-{seq:06}`
#[must_use]
pub fn assemble_receipt_code(
    loc_idx: i64,
    term_idx: i64,
    yymmdd: &str,
    staff_idx: i64,
    seq: i64,
) -> String {
    format!(
        "{}-{}-{}-{}-{}",
        index_hex(loc_idx),
        index_hex(term_idx),
        yymmdd,
        index_hex(staff_idx),
        format!("{seq:06}")
    )
}

impl crate::db::Store<'_> {
    /// Claim the next continuous receipt sequence for `(tenant_id, terminal_idx,
    /// fiscal_year)`.
    ///
    /// The whole concurrency contract is one statement — `INSERT ... ON CONFLICT
    /// DO UPDATE ... RETURNING`. The first claim of a (tenant, terminal, year)
    /// seeds `counter = 1`; every later claim in the same year increments it.
    /// The series is continuous, so a terminal re-bound to another location keeps
    /// its number rather than restarting — the location segment still differs, so
    /// `01-02-…-000123` and `03-02-…-000124` are distinct strings.
    ///
    /// Must be called inside the checkout transaction, beside the statutory
    /// claim, so a rolled-back sale consumes no number. On reaching
    /// [`SEQUENCE_MAX`] the caller is expected to roll back — that is what stops
    /// a refused claim from advancing the counter.
    pub fn claim_receipt_sequence(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        terminal_idx: &str,
        fiscal_year: &str,
    ) -> Result<i64, CoreError> {
        let claimed: i64 = tx.query_row(
        "INSERT INTO receipt_number_counters (tenant_id, terminal_idx, fiscal_year, counter, updated_at)
         VALUES (?1, ?2, ?3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(tenant_id, terminal_idx, fiscal_year)
             DO UPDATE SET counter = receipt_number_counters.counter + 1,
                           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         RETURNING counter",
        params![tenant_id, terminal_idx, fiscal_year],
        |row| row.get(0),
    )?;

        if claimed > SEQUENCE_MAX {
            return Err(CoreError::Validation {
                field: "receipt_sequence",
                message: format!(
                    "receipt sequence exhausted for terminal '{terminal_idx}' fiscal year '{fiscal_year}': \
                 reached {claimed}, the 6-digit tail cannot exceed {SEQUENCE_MAX}",
                ),
            });
        }
        Ok(claimed)
    }
}

/// Parse a stored `locations.timezone` value (`'+HH:MM'` / `'-HH:MM'` /
/// `'UTC'` / `'Z'`) into a total offset in seconds, or `None` when the value
/// is not a fixed offset core can interpret (e.g. an IANA name). Mirrors the
/// contract enforced by [`crate::db::reports::datetime::tz_modifier`].
fn offset_seconds(tz: &str) -> Option<i64> {
    let tz = tz.trim();
    if tz.is_empty() || tz.eq_ignore_ascii_case("UTC") || tz.eq_ignore_ascii_case("Z") {
        return Some(0);
    }
    let (sign, rest) = match tz.strip_prefix('+') {
        Some(r) => (1i64, r),
        None => match tz.strip_prefix('-') {
            Some(r) => (-1i64, r),
            None => return None,
        },
    };
    let (h, m) = rest.split_once(':')?;
    let h: i64 = h.parse().ok()?;
    let m: i64 = m.parse().ok()?;
    if !(0..=14).contains(&h) || !(0..=59).contains(&m) {
        return None;
    }
    Some(sign * (h * 3600 + m * 60))
}

/// Resolve the store-local date for a receipt issued at `now_utc` by the
/// location whose `timezone` string is `location_timezone`.
///
/// Returns `(YYMMDD, YYYY)` — the issue date printed in the code and the
/// fiscal year the sequence belongs to. Per §4.4 the offset is the
/// *location's* own, not the primary store's, so a non-primary location's
/// day-end is honoured; a multi-offset chain no longer stamps two receipts
/// with the same number on the wrong midnight.
///
/// The conversion is done in Rust with `chrono` (a fixed offset, no tzdata),
/// so it does not depend on SQLite's timezone-modifier quirks and is fully
/// deterministic. A value core cannot interpret (an IANA name) falls back to
/// UTC, matching the documented contract.
pub fn resolve_receipt_date(
    now_utc: &str,
    location_timezone: &str,
) -> Result<(String, String), CoreError> {
    let utc = DateTime::parse_from_rfc3339(now_utc).map_err(|e| CoreError::Validation {
        field: "receipt_date",
        message: format!("invalid UTC timestamp '{now_utc}': {e}"),
    })?;
    let secs = offset_seconds(location_timezone).unwrap_or(0);
    let offset = FixedOffset::east_opt(secs as i32).ok_or_else(|| CoreError::Validation {
        field: "receipt_date",
        message: format!("timezone offset out of range: {secs}s"),
    })?;
    let local = utc.with_timezone(&offset);
    Ok((
        local.format("%y%m%d").to_string(),
        local.format("%Y").to_string(),
    ))
}

#[cfg(test)]
#[path = "receipt_code_tests.rs"]
mod tests;
