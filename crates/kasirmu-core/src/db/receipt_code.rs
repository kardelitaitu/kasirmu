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

#[cfg(test)]
#[path = "receipt_code_tests.rs"]
mod tests;
