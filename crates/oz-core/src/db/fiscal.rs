//! Fiscalization and statutory numbering (regional slice 5).
//!
//! Owns the two legal-entity-scoped tables from `20260923_fiscal_numbering.sql`:
//!
//! * [`FiscalScheme`] — `fiscal_schemes`, the entity's statutory-configuration
//!   anchor (multi-row-per-entity; one row per market/document regime). The
//!   `parameters` JSON is a bag: statutory parameters land with the consumer
//!   slices that read them, and no tax math lives here (the tax box owns it).
//! * [`DocumentNumberSequence`] — `document_number_sequences`, the statutory
//!   series (ONE per entity per document kind, UNIQUE-guarded): prefix +
//!   counter + optional period reset + zero-padding.
//!
//! The counter only ever moves through [`Store::claim_document_number_in_tx`],
//! whose single `UPDATE … RETURNING` statement is the whole concurrency
//! story: there is no SELECT-then-UPDATE anywhere on the path, so two
//! concurrent claims can never observe the same number, and a claim made
//! inside a rolled-back transaction (e.g. a failed checkout) consumes
//! nothing — statutory numbering cannot race or gap.
//!
//! RLS posture: both tables carry `tenant_id` (schema-stamped, DEFAULT
//! 'default') but sit in the PG generator's RLS_EXEMPT list — the only
//! write paths are desktop-local, and the parent `legal_entities` is itself
//! exempt pending the cloud-sync decision. Covering them later is a
//! list-move in the generator, not a migration.

use crate::error::CoreError;
use rusqlite::OptionalExtension;
use rusqlite::params;
use serde::Serialize;

/// A legal entity's fiscal-configuration scheme (one of several per entity).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalScheme {
    /// Primary key.
    pub id: String,
    /// The owning legal entity.
    pub legal_entity_id: String,
    /// Stable scheme identifier within the entity (e.g. `id-faktur-pajak`).
    pub scheme_code: String,
    /// Human-readable name.
    pub name: String,
    /// JSON bag of scheme parameters (consumer slices define the keys).
    pub parameters: String,
    /// Whether the scheme is active.
    pub is_active: bool,
    /// Creation timestamp (RFC 3339).
    pub created_at: String,
    /// Last update timestamp (RFC 3339).
    pub updated_at: String,
}

/// A statutory document-number series: prefix + counter + reset policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNumberSequence {
    /// Primary key.
    pub id: String,
    /// The owning legal entity.
    pub legal_entity_id: String,
    /// The document kind this series numbers (e.g. `receipt`, `invoice`).
    pub document_kind: String,
    /// Statutory prefix, emitted verbatim before the number.
    pub prefix: String,
    /// The last issued ordinal (0 = nothing issued yet).
    pub current_value: i64,
    /// When the counter restarts at 1: `never`, `daily`, `monthly`, `yearly`.
    pub reset_period: String,
    /// The period bucket the current `current_value` belongs to (empty for
    /// `never`).
    pub period_key: String,
    /// Zero-pad width for the issued ordinal (0 = no padding).
    pub padding: i64,
    /// Creation timestamp (RFC 3339).
    pub created_at: String,
    /// Last update timestamp (RFC 3339).
    pub updated_at: String,
}

/// The reset policy for a sequence's counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetPeriod {
    /// One series forever (period key stays empty).
    Never,
    /// Restart at 1 each calendar day.
    Daily,
    /// Restart at 1 each calendar month.
    Monthly,
    /// Restart at 1 each calendar year.
    Yearly,
}

impl ResetPeriod {
    /// Parse the stored keyword (case-insensitive); unknown values are
    /// rejected — the write path validates before persisting.
    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        match raw.to_ascii_lowercase().as_str() {
            "never" => Ok(Self::Never),
            "daily" => Ok(Self::Daily),
            "monthly" => Ok(Self::Monthly),
            "yearly" => Ok(Self::Yearly),
            other => Err(CoreError::Validation {
                field: "reset_period".into(),
                message: format!(
                    "reset_period must be never, daily, monthly or yearly; got {other:?}"
                ),
            }),
        }
    }

    /// The period bucket the RFC-3339 timestamp `now` belongs to (empty for
    /// [`ResetPeriod::Never`]). Derived from the timestamp's date part — the
    /// caller passes the business timestamp, and the checkout path passes the
    /// sale's own timestamp so the bucket matches the sale's business day.
    #[must_use]
    pub fn period_key_for(self, now: &str) -> String {
        match self {
            Self::Never => String::new(),
            Self::Daily => now.get(..10).unwrap_or("").to_owned(),
            Self::Monthly => now.get(..7).unwrap_or("").to_owned(),
            Self::Yearly => now.get(..4).unwrap_or("").to_owned(),
        }
    }

    /// The stored keyword.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Daily => "daily",
            Self::Monthly => "monthly",
            Self::Yearly => "yearly",
        }
    }
}

impl crate::db::Store<'_> {
    /// Create (or replace the configuration of) a statutory-number series.
    ///
    /// The `(legal_entity_id, document_kind)` pair is UNIQUE-guarded by the
    /// schema, so this is an UPSERT: re-calling with the same pair rewrites
    /// prefix/reset policy/padding but deliberately KEEPS the counter — a
    /// policy tweak must never reissue numbers already spent.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_document_number_sequence(
        &self,
        legal_entity_id: &str,
        document_kind: &str,
        prefix: &str,
        reset_period: ResetPeriod,
        padding: i64,
        now: &str,
    ) -> Result<(), CoreError> {
        if padding < 0 {
            return Err(CoreError::Validation {
                field: "padding".into(),
                message: format!("padding must not be negative, got {padding}"),
            });
        }
        let initial_period_key = reset_period.period_key_for(now);
        self.conn.execute(
            "INSERT INTO document_number_sequences
                 (id, tenant_id, legal_entity_id, document_kind, prefix,
                  current_value, reset_period, period_key, padding, created_at, updated_at)
             VALUES (?1, 'default', ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT (legal_entity_id, document_kind) DO UPDATE SET
                 prefix = excluded.prefix,
                 reset_period = excluded.reset_period,
                 padding = excluded.padding,
                 updated_at = excluded.updated_at",
            params![
                uuid::Uuid::now_v7().to_string(),
                legal_entity_id,
                document_kind,
                prefix,
                reset_period.as_str(),
                initial_period_key,
                padding,
                now,
            ],
        )?;
        Ok(())
    }

    /// Read the series for one entity/kind, if configured.
    #[must_use]
    pub fn document_number_sequence(
        &self,
        legal_entity_id: &str,
        document_kind: &str,
    ) -> Result<Option<DocumentNumberSequence>, CoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT id, legal_entity_id, document_kind, prefix, current_value,
                        reset_period, period_key, padding, created_at, updated_at
                 FROM document_number_sequences
                 WHERE legal_entity_id = ?1 AND document_kind = ?2",
                params![legal_entity_id, document_kind],
                |row| {
                    Ok(DocumentNumberSequence {
                        id: row.get(0)?,
                        legal_entity_id: row.get(1)?,
                        document_kind: row.get(2)?,
                        prefix: row.get(3)?,
                        current_value: row.get(4)?,
                        reset_period: row.get(5)?,
                        period_key: row.get(6)?,
                        padding: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Issue the next statutory number for one entity/kind and stamp it onto
    /// the given sale row — INSIDE the caller's transaction.
    ///
    /// This is the slice-5 checkout contract: the claim and the sale row
    /// commit or roll back together, so a failed sale never consumes a
    /// statutory number (no gaps) and a committed sale always has one when a
    /// sequence is configured.
    ///
    /// # Atomicity (the concurrency contract)
    ///
    /// The counter advances through exactly ONE statement:
    ///
    /// ```sql
    /// UPDATE document_number_sequences
    /// SET current_value = CASE WHEN period_key = ?bucket
    ///                           THEN current_value + 1 ELSE 1 END,
    ///     period_key = ?bucket, updated_at = ?now
    /// WHERE id = ?row_id
    /// RETURNING current_value, prefix, padding
    /// ```
    ///
    /// There is no SELECT-then-UPDATE on the counter anywhere: the
    /// increment-vs-reset decision reads the row state INSIDE the write
    /// statement, so two interleaved claims can never observe the same
    /// ordinal, and a period rollover resets atomically with the first
    /// claim of the new period.
    ///
    /// Returns `None` when the entity has no series for `document_kind` —
    /// an unconfigured deployment keeps today's behavior
    /// (`sales.statutory_number` stays NULL) — or when the sale's location
    /// has no legal entity to number for.
    pub fn claim_statutory_number_for_sale(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
        location_id: &str,
        document_kind: &str,
        now: &str,
    ) -> Result<Option<String>, CoreError> {
        let entity_id: Option<String> = tx
            .query_row(
                "SELECT legal_entity_id FROM locations WHERE id = ?1",
                params![location_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(entity_id) = entity_id else {
            return Ok(None);
        };

        let Some(series) = self.document_number_sequence(&entity_id, document_kind)? else {
            return Ok(None);
        };

        let reset = ResetPeriod::parse(&series.reset_period)?;
        let bucket = reset.period_key_for(now);

        // The whole concurrency contract is this one statement — see the
        // doc comment above. The CASE reads the row's OWN period_key at
        // write time, so a rollover restarts at 1 atomically with the first
        // claim of the new period.
        let claimed = tx
            .query_row(
                "UPDATE document_number_sequences
                 SET current_value = CASE WHEN period_key = ?1
                                           THEN current_value + 1 ELSE 1 END,
                     period_key = ?1, updated_at = ?2
                 WHERE id = ?3
                 RETURNING current_value, prefix, padding",
                params![bucket, now, series.id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((value, prefix, padding)) = claimed else {
            return Ok(None);
        };

        // Issue format: prefix + optional period bucket + zero-padded
        // ordinal. `never` series carry no bucket segment; a 0 padding means
        // the ordinal prints bare.
        let number = if reset == ResetPeriod::Never {
            format!("{prefix}{:0>width$}", value, width = padding as usize)
        } else {
            format!(
                "{prefix}{bucket}/{:0>width$}",
                value,
                width = padding as usize
            )
        };

        tx.execute(
            "UPDATE sales SET statutory_number = ?1 WHERE id = ?2",
            params![number, sale_id],
        )?;

        Ok(Some(number))
    }
}

#[cfg(test)]
#[path = "fiscal_tests.rs"]
mod tests;
