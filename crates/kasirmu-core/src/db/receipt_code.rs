//! Index ids for the receipt hierarchy code.
//!
//! An index id is an immutable badge allocated once, at registration, and
//! printed as dynamic-width Base62 characters inside the receipt code
//! (`01-02-260929-10a-000123`). It is deliberately NOT "the Nth location":
//! a value is never reused, because a retired `02` reissued to a new
//! location would make every historic receipt naming `02` resolve to the
//! wrong store — and with a tax number on the receipt that is
//! falsification, not a cosmetic bug.
//!
//! Allocation is monotonic, driven by `entity_index_cursors`, so even a row
//! deleted without a tombstone cannot hand its index to the next entity.
//! `0` is never allocated: `"00"` is the display sentinel for "no staff"
//! (kiosk and system sales). The ceiling is `14,776,335` ($62^4 - 1$) — four
//! Base62 digits is all the field can express — and the allocator refuses
//! rather than wraps, because a wrap would reissue live codes.
//!
//! Design and decisions: docs/plans/receipt-hierarchy-code.md

use chrono::{DateTime, FixedOffset};
use rusqlite::{OptionalExtension, params};

use crate::CoreError;

/// Largest index id the 4-digit Base62 field can express: 62^4 - 1 = 14,776,335.
pub const INDEX_ID_MAX: i64 = 14_776_335;

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

/// Base62 character table: 0–9 (0..9), a–z (10..35), A–Z (36..61).
pub const BASE62_ALPHABET: &[u8; 62] =
    b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// Format an index id as a dynamic-width Base62 string (minimum 2 characters).
///
/// - `value <= 0`: `"00"` (the [`INDEX_ID_NONE`] sentinel)
/// - `1..=3843` (< 62^2): padded to 2 characters (`01`–`zz`)
/// - `3844..=238327` (< 62^3): 3 characters (`100`–`zzz`)
/// - `238328..=14776335` (< 62^4): 4 characters (`1000`–`zzzz`)
#[must_use]
pub fn format_base62_index(value: i64) -> String {
    if value <= 0 {
        return "00".to_string();
    }
    let mut n = value as u64;
    let mut digits = Vec::new();
    while n > 0 {
        let rem = (n % 62) as usize;
        digits.push(BASE62_ALPHABET[rem] as char);
        n /= 62;
    }
    digits.reverse();
    if digits.len() < 2 {
        format!("0{}", digits.into_iter().collect::<String>())
    } else {
        digits.into_iter().collect()
    }
}

/// Parse a Base62 index string back into its numeric index id.
///
/// Returns `None` if the string contains invalid characters, is empty,
/// or exceeds [`INDEX_ID_MAX`].
#[must_use]
pub fn parse_base62_index(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut acc: u64 = 0;
    for &b in s.as_bytes() {
        let val = match b {
            b'0'..=b'9' => (b - b'0') as u64,
            b'a'..=b'z' => (b - b'a' + 10) as u64,
            b'A'..=b'Z' => (b - b'A' + 36) as u64,
            _ => return None,
        };
        acc = acc.checked_mul(62)?.checked_add(val)?;
    }
    let signed = i64::try_from(acc).ok()?;
    if signed > INDEX_ID_MAX {
        return None;
    }
    Some(signed)
}

/// Legacy alias for [`format_base62_index`].
#[must_use]
pub fn index_hex(value: i64) -> String {
    format_base62_index(value)
}

impl crate::db::Store<'_> {
    /// Allocate the lowest available index id for `(tenant_id, kind)`.
    ///
    /// Finds the lowest positive integer (1, 2, 3...) not currently in use by
    /// an active entity in the tenant's database. When an entity (location,
    /// terminal, staff) is deleted, its index id is reclaimed and recycled for
    /// the next new entity.
    ///
    /// Must be called inside a transaction.
    pub fn allocate_entity_index(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        kind: EntityIndexKind,
        now: &str,
    ) -> Result<i64, CoreError> {
        self.allocate_entity_index_with_ceiling(tx, tenant_id, kind, now, INDEX_ID_MAX)
    }

    pub(crate) fn allocate_entity_index_with_ceiling(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        kind: EntityIndexKind,
        _now: &str,
        ceiling: i64,
    ) -> Result<i64, CoreError> {
        let (table, extra_where) = match kind {
            EntityIndexKind::Location => ("locations", ""),
            EntityIndexKind::Terminal => ("terminals", ""),
            EntityIndexKind::User => ("users", "AND deleted_at IS NULL"),
        };

        let query = format!(
            "SELECT CASE 
                WHEN NOT EXISTS (
                    SELECT 1 FROM {table} 
                    WHERE tenant_id = ?1 AND index_id = 1 {extra_where}
                ) THEN 1
                ELSE COALESCE(
                    (
                        SELECT t1.index_id + 1
                        FROM {table} t1
                        WHERE t1.tenant_id = ?1 AND t1.index_id IS NOT NULL {extra_where}
                          AND NOT EXISTS (
                              SELECT 1 FROM {table} t2
                              WHERE t2.tenant_id = ?1 AND t2.index_id = t1.index_id + 1 {extra_where}
                          )
                        ORDER BY t1.index_id ASC
                        LIMIT 1
                    ),
                    1
                )
            END"
        );

        let allocated: i64 = tx.query_row(&query, params![tenant_id], |row| row.get(0))?;

        if allocated > ceiling {
            return Err(CoreError::Validation {
                field: "index_id",
                message: format!(
                    "index id exhausted: {} for tenant '{}' has reached {ceiling}; \
                     the 4-digit Base62 field cannot express another",
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
    // One argument over clippy's default, deliberately: the list mirrors the
    // `entity_index_tombstones` row it inserts — tenant, kind, index, entity,
    // label, retired_at — plus `tx` and `now`. Grouping them into a struct
    // would hide the correspondence that is this method's whole point.
    #[allow(clippy::too_many_arguments)]
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

/// Assemble the frozen receipt code.
///
/// Pure: it takes the already-resolved indices and the store-local date, so
/// it is trivially testable and the same code that freezes at checkout also
/// renders in a reprint six months later. The caller passes
/// [`INDEX_ID_NONE`] (0) for `staff_idx` when the sale has no staff
/// (`sales.user_id` is null — kiosk / system sale), so the code prints "00".
///
/// Format: `{loc_base62}-{term_base62}-{YYMMDD}-{staff_base62}-{seq:06}`
///
/// Length:
/// - 22 characters for standard operations (all indices < 3,844).
/// - 23–25 characters with 3-digit indices.
/// - 24–28 characters with 4-digit indices.
#[must_use]
pub fn assemble_receipt_code(
    loc_idx: i64,
    term_idx: i64,
    yymmdd: &str,
    staff_idx: i64,
    seq: i64,
) -> String {
    format!(
        "{}-{}-{}-{}-{:06}",
        format_base62_index(loc_idx),
        format_base62_index(term_idx),
        yymmdd,
        format_base62_index(staff_idx),
        seq
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

    /// Get an entity's `index_id`, allocating it lazily (once, never reused)
    /// when a legacy row still lacks one.
    ///
    /// Used at checkout so the receipt hierarchy code works on data created
    /// before indices were allocated, without a separate backfill step. The
    /// read-then-allocate runs inside the caller's transaction, so a
    /// rolled-back sale consumes no index. `table` is a compile-time constant
    /// (`locations` / `terminals` / `users`), never caller input.
    fn ensure_entity_index(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        kind: EntityIndexKind,
        table: &str,
        entity_id: &str,
        now: &str,
    ) -> Result<i64, CoreError> {
        let existing: Option<i64> = tx
            .query_row(
                &format!("SELECT index_id FROM {table} WHERE id = ?1 AND tenant_id = ?2"),
                params![entity_id, tenant_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        if let Some(idx) = existing {
            return Ok(idx);
        }
        let idx = self.allocate_entity_index(tx, tenant_id, kind, now)?;
        tx.execute(
            &format!("UPDATE {table} SET index_id = ?1 WHERE id = ?2"),
            params![idx, entity_id],
        )?;
        Ok(idx)
    }

    /// Mint the frozen receipt hierarchy code for a sale, or return
    /// `None` when it cannot be formed.
    ///
    /// Returns `(display_code, terminal_id)` — `terminal_id` is the raw
    /// terminal id (for `sales.terminal_id`), `display_code` is the assembled
    /// string. When no terminal is known the code cannot be formed, so both
    /// are `None` and the caller keeps today's behaviour (no code). A code
    /// that cannot be formed is *not* an error: the sale must still complete.
    ///
    /// Indices are resolved (and allocated lazily when missing) and the
    /// sequence is claimed inside `tx`, so the whole mint is atomic with the
    /// sale — a voided sale consumes neither an index nor a number.
    pub fn mint_receipt_code(
        &self,
        tx: &rusqlite::Transaction<'_>,
        tenant_id: &str,
        location_id: &str,
        terminal_id: Option<&str>,
        staff_user_id: &str,
        now_utc: &str,
    ) -> Result<(Option<String>, Option<String>), CoreError> {
        let terminal_id = terminal_id.map(str::to_string);
        // Staff index: an empty user (kiosk / system sale) is the 00 sentinel.
        let staff_idx = if staff_user_id.is_empty() {
            INDEX_ID_NONE
        } else {
            self.ensure_entity_index(
                tx,
                tenant_id,
                EntityIndexKind::User,
                "users",
                staff_user_id,
                now_utc,
            )?
        };
        let loc_idx = self.ensure_entity_index(
            tx,
            tenant_id,
            EntityIndexKind::Location,
            "locations",
            location_id,
            now_utc,
        )?;
        let Some(term_id) = terminal_id.as_deref() else {
            return Ok((None, None));
        };
        let term_idx = self.ensure_entity_index(
            tx,
            tenant_id,
            EntityIndexKind::Terminal,
            "terminals",
            term_id,
            now_utc,
        )?;

        let tz: Option<String> = tx
            .query_row(
                "SELECT timezone FROM locations WHERE id = ?1",
                params![location_id],
                |r| r.get(0),
            )
            .optional()?;
        let (yymmdd, fiscal_year) = resolve_receipt_date(now_utc, tz.as_deref().unwrap_or("UTC"))?;
        let seq = self.claim_receipt_sequence(
            tx,
            tenant_id,
            &format_base62_index(term_idx),
            &fiscal_year,
        )?;
        let code = assemble_receipt_code(loc_idx, term_idx, &yymmdd, staff_idx, seq);
        Ok((Some(code), terminal_id))
    }
}

/// Parse a stored `locations.timezone` value into a total offset in seconds, or
/// `None` when the value cannot be resolved at all.
///
/// MSL-29: this used to parse ONLY the numeric forms (`'+HH:MM'` / `'-HH:MM'` /
/// `'UTC'` / `'Z'`), so an IANA zone name — a value the model SUPPORTS and the
/// reports path resolves — fell to UTC here. A store set to `Asia/Jakarta` got
/// reports bucketed at +07 (`tz_modifier` -> `parse_utc_offset` ->
/// `offset_for_zone`) while its RECEIPT NUMBERS were dated at +00, and the date
/// feeds both the printed `yymmdd` and the `fiscal_year` that selects the
/// sequence: the receipt could land in the wrong fiscal year with no trace
/// (`receipt_code.rs` has zero `tracing::` calls, while `tz_modifier` warns on
/// its own fallback).
///
/// It now delegates to the same resolver `tz_modifier` uses, so the two paths
/// cannot disagree on one stored value. The shared helper returns a `±HH:MM`
/// string, which is also why an IANA name is resolved rather than passed on.
fn offset_seconds(tz: &str) -> Option<i64> {
    // `Z` is the one spelling `parse_fixed_offset` does not carry, and it means
    // UTC — the same answer, so normalise it before delegating.
    let raw = tz.trim();
    if raw.eq_ignore_ascii_case("Z") {
        return Some(0);
    }
    let offset = crate::db::reports::parse_utc_offset(raw)?;
    // `parse_utc_offset` is the single source of the `±HH:MM` shape, so this
    // split cannot see a third form; an unparsable result is unresolvable.
    let (sign, rest) = match offset.strip_prefix('+') {
        Some(r) => (1i64, r),
        None => (-1i64, offset.strip_prefix('-')?),
    };
    let (h, m) = rest.split_once(':')?;
    let h: i64 = h.parse().ok()?;
    let m: i64 = m.parse().ok()?;
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
    // `i32::try_from` rather than `as i32`: the `ok_or_else` below already
    // treats an out-of-range offset as a validation failure, so the narrowing
    // should BE that check rather than a silent wrap in front of it. With
    // `as`, an offset beyond `i32` would wrap to a plausible-looking value and
    // the error branch could never fire.
    let offset_i32 = i32::try_from(secs).map_err(|_| CoreError::Validation {
        field: "receipt_date",
        message: format!("timezone offset out of range: {secs}s"),
    })?;
    let offset = FixedOffset::east_opt(offset_i32).ok_or_else(|| CoreError::Validation {
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
