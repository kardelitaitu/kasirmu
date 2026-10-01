//! Indonesian e-Faktur compliance repository (DJP Coretax / PER-11/PJ/2025).
//!
//! Under PER-11/PJ/2025 Pasal 37, a Faktur Pajak number is a 17-digit string:
//! - 2 digits: Kode Transaksi (`01`–`10`, fixed by DJP)
//! - 2 digits: Kode Status (`00` = normal, `01`/`02`/... = faktur pengganti ke-1, ke-2)
//! - 13 digits: Nomor Seri Faktur Pajak (NSFP, 2-digit year + 11-digit sequence, issued by DJP)
//!
//! The NSFP is assigned by DJP when an e-Faktur is uploaded and approved in Coretax
//! (i.e. *after* checkout settlement). A *faktur pengganti* retains the original NSFP
//! and increments the kode status.
//!
//! Key types:
//! - [`FakturPajakInfo`](crate::db::faktur_pajak::FakturPajakInfo): Parsed and
//!   formatted 17-digit DJP invoice metadata. Fully-qualified because a
//!   module-level `//!` doc resolves links in the ENCLOSING scope, where this
//!   module's own items are not yet in scope — the same shape as
//!   `db/fiscal.rs:5` and `db/audit_security.rs:12`. The bare label and the
//!   `self::` form both fail `rustdoc::broken_intra_doc_links`, which the
//!   `rust-doc` gate raises to an error. The three `Store::` links below need no
//!   qualifier: `Store` is defined in the parent `db` module and IS in scope here.
//! - [`Store::get_faktur_pajak`]: Query e-Faktur metadata for a completed sale.
//! - [`Store::stamp_faktur_pajak`]: Post-checkout stamping of DJP-approved NSFP.
//! - [`Store::create_faktur_pengganti`]: Increment kode status for replacement invoices.

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// Valid transaction codes fixed by DJP under PER-11/PJ/2025.
pub const VALID_KODE_TRANSAKSI: &[&str] = &[
    "01", // Penyerahan BKP/JKP kepada selain Pemungut PPN
    "02", // Penyerahan BKP/JKP kepada Pemungut Instansi Pemerintah
    "03", // Penyerahan BKP/JKP kepada Pemungut BUMN/Badan Tertentu
    "04", // Penyerahan BKP/JKP menggunakan DPP Nilai Lain
    "05", // Penyerahan BKP/JKP menggunakan Besaran Tertentu
    "06", // Penyerahan Lainnya (turis asing dsb.)
    "07", // Penyerahan yang PPN/PPnBM-nya Tidak Dipungut
    "08", // Penyerahan yang Dibebaskan dari Pengenaan PPN
    "09", // Penyerahan Aktiva Pasal 16D UU PPN
    "10", // Penyerahan Lainnya dalam ketentuan Coretax
];

/// Maximum revision count for a Faktur Pengganti (`00` to `99`).
pub const MAX_PENGGANTI_STATUS: u32 = 99;

/// DJP e-Faktur Pajak compliance metadata for a sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakturPajakInfo {
    /// 13-digit NSFP issued by DJP (e.g. `"2600000000123"`).
    pub nsfp: String,
    /// 2-digit DJP transaction code (`"01"`..`"10"`, default `"01"`).
    pub kode_transaksi: String,
    /// 2-digit status code (`"00"` = normal, `"01"`..`"99"` = pengganti).
    pub status: String,
    /// Complete 17-digit DJP Faktur Pajak string (`{kode_transaksi}{status}{nsfp}`).
    pub formatted: String,
}

/// Validate that an NSFP string matches the 13-digit DJP format.
pub fn validate_nsfp(nsfp: &str) -> Result<(), CoreError> {
    let trimmed = nsfp.trim();
    if trimmed.len() != 13 || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CoreError::Validation {
            field: "faktur_pajak_nsfp",
            message: format!(
                "invalid NSFP '{nsfp}': must be exactly 13 numeric digits (PER-11/PJ/2025)"
            ),
        });
    }
    Ok(())
}

/// Validate that a transaction code is recognized under PER-11/PJ/2025 (`"01"` through `"10"`).
pub fn validate_kode_transaksi(kode: &str) -> Result<(), CoreError> {
    let trimmed = kode.trim();
    if !VALID_KODE_TRANSAKSI.contains(&trimmed) {
        return Err(CoreError::Validation {
            field: "faktur_pajak_kode_transaksi",
            message: format!(
                "invalid kode transaksi '{kode}': must be one of 01..10 under PER-11/PJ/2025"
            ),
        });
    }
    Ok(())
}

/// Format the complete 17-digit DJP Faktur Pajak string.
#[must_use]
pub fn format_faktur_pajak_17(kode_transaksi: &str, status: &str, nsfp: &str) -> String {
    format!("{kode_transaksi}{status}{nsfp}")
}

impl crate::db::Store<'_> {
    /// Query e-Faktur metadata for a single sale.
    ///
    /// Returns `None` if the sale has not yet been stamped with an approved NSFP.
    pub fn get_faktur_pajak(&self, sale_id: &str) -> Result<Option<FakturPajakInfo>, CoreError> {
        let row: Option<(Option<String>, String, String)> = self
            .conn
            .query_row(
                "SELECT faktur_pajak_nsfp, faktur_pajak_kode_transaksi, faktur_pajak_status
                 FROM sales WHERE id = ?1",
                params![sale_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        let Some((maybe_nsfp, kode_transaksi, status)) = row else {
            return Ok(None);
        };

        let Some(nsfp) = maybe_nsfp else {
            return Ok(None);
        };

        if nsfp.trim().is_empty() {
            return Ok(None);
        }

        let formatted = format_faktur_pajak_17(&kode_transaksi, &status, &nsfp);
        Ok(Some(FakturPajakInfo {
            nsfp,
            kode_transaksi,
            status,
            formatted,
        }))
    }

    /// Batch read of e-Faktur metadata for a list of sale ids in a single statement.
    ///
    /// Returns a map keyed by sale id for all rows that have an approved NSFP stamped.
    pub fn get_faktur_pajak_map(
        &self,
        ids: &[String],
    ) -> Result<std::collections::HashMap<String, FakturPajakInfo>, CoreError> {
        if ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!(
            "SELECT id, faktur_pajak_nsfp, faktur_pajak_kode_transaksi, faktur_pajak_status
             FROM sales
             WHERE id IN ({placeholders}) AND faktur_pajak_nsfp IS NOT NULL"
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let id: String = row.get(0)?;
            let nsfp: Option<String> = row.get(1)?;
            let kode: String = row.get(2)?;
            let status: String = row.get(3)?;
            Ok((id, nsfp, kode, status))
        })?;

        let mut map = std::collections::HashMap::new();
        for r in rows {
            let (id, maybe_nsfp, kode, status) = r?;
            if let Some(nsfp) = maybe_nsfp
                && !nsfp.trim().is_empty()
            {
                let formatted = format_faktur_pajak_17(&kode, &status, &nsfp);
                map.insert(
                    id,
                    FakturPajakInfo {
                        nsfp,
                        kode_transaksi: kode,
                        status,
                        formatted,
                    },
                );
            }
        }
        Ok(map)
    }

    /// Stamp a DJP-approved NSFP onto a completed sale.
    ///
    /// Validates NSFP format (13 digits) and transaction code (`01`..`10`, defaulting
    /// to `"01"` if omitted). Initializes `faktur_pajak_status` to `"00"` (normal).
    ///
    /// Runs atomically inside an unchecked transaction.
    pub fn stamp_faktur_pajak(
        &self,
        sale_id: &str,
        nsfp: &str,
        kode_transaksi: Option<&str>,
    ) -> Result<FakturPajakInfo, CoreError> {
        let nsfp_trimmed = nsfp.trim();
        validate_nsfp(nsfp_trimmed)?;

        let kode = kode_transaksi.unwrap_or("01").trim();
        validate_kode_transaksi(kode)?;

        let tx = self.conn.unchecked_transaction()?;

        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sales WHERE id = ?1)",
                params![sale_id],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Err(CoreError::NotFound {
                entity: "sale",
                id: sale_id.to_string(),
            });
        }

        tx.execute(
            "UPDATE sales
             SET faktur_pajak_nsfp = ?1,
                 faktur_pajak_kode_transaksi = ?2,
                 faktur_pajak_status = '00'
             WHERE id = ?3",
            params![nsfp_trimmed, kode, sale_id],
        )?;

        tx.commit()?;

        let formatted = format_faktur_pajak_17(kode, "00", nsfp_trimmed);
        Ok(FakturPajakInfo {
            nsfp: nsfp_trimmed.to_string(),
            kode_transaksi: kode.to_string(),
            status: "00".to_string(),
            formatted,
        })
    }

    /// Create a *Faktur Pengganti* for a sale with an existing e-Faktur.
    ///
    /// Under PER-11/PJ/2025, a replacement faktur retains the original NSFP and
    /// increments the 2-digit status code (`00` -> `01` -> `02`...).
    ///
    /// Errors if the sale has no approved NSFP stamped, or if revisions exceed 99.
    /// Runs atomically inside an unchecked transaction.
    pub fn create_faktur_pengganti(&self, sale_id: &str) -> Result<FakturPajakInfo, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        let row: Option<(Option<String>, String, String)> = tx
            .query_row(
                "SELECT faktur_pajak_nsfp, faktur_pajak_kode_transaksi, faktur_pajak_status
                 FROM sales WHERE id = ?1",
                params![sale_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        let Some((maybe_nsfp, kode_transaksi, status_str)) = row else {
            return Err(CoreError::NotFound {
                entity: "sale",
                id: sale_id.to_string(),
            });
        };

        let Some(nsfp) = maybe_nsfp else {
            return Err(CoreError::Validation {
                field: "faktur_pajak",
                message: format!(
                    "cannot create faktur pengganti for sale '{sale_id}': sale has no approved NSFP"
                ),
            });
        };

        if nsfp.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "faktur_pajak",
                message: format!(
                    "cannot create faktur pengganti for sale '{sale_id}': NSFP is empty"
                ),
            });
        }

        let current_status: u32 = status_str.parse().map_err(|_| CoreError::Validation {
            field: "faktur_pajak_status",
            message: format!("invalid stored status code '{status_str}'"),
        })?;

        if current_status >= MAX_PENGGANTI_STATUS {
            return Err(CoreError::Validation {
                field: "faktur_pajak_status",
                message: format!(
                    "faktur pengganti status exhausted for sale '{sale_id}': maximum {MAX_PENGGANTI_STATUS} revisions reached"
                ),
            });
        }

        let new_status = current_status + 1;
        let new_status_str = format!("{new_status:02}");

        tx.execute(
            "UPDATE sales
             SET faktur_pajak_status = ?1
             WHERE id = ?2",
            params![new_status_str, sale_id],
        )?;

        tx.commit()?;

        let formatted = format_faktur_pajak_17(&kode_transaksi, &new_status_str, &nsfp);
        Ok(FakturPajakInfo {
            nsfp,
            kode_transaksi,
            status: new_status_str,
            formatted,
        })
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "faktur_pajak_tests.rs"]
mod tests;
