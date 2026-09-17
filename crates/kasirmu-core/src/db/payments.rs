/*
last audited 25-07-26 by RSA-Agent (oz-core slice B1)
crate: oz-core | status: SAFE | lint: CLEAN
findings: idempotency-key dedup (check-then-return) runs inside the transaction and UNIQUE idx_payments_idempotency_key (init.sql:1204) closes the concurrent-insert race — the db layer is idempotency-correct; PAY-2 remains driver-side only; cosmetic: ToSqlConversionFailure reused for read-side currency parse errors
next: none | perf: per-split dedup query is indexed
*/
//! Payment CRUD — split-payment support for completed sales.
//!
//! Each payment record represents one tender against a sale. Most sales
//! have a single payment (the legacy `payment_method` column), but split
//! payments produce multiple rows in `payments`.

use crate::Store;
use crate::error::CoreError;
use crate::money::{Currency, Money};
use crate::payment::{Payment, PaymentSplitArg};
use rusqlite::OptionalExtension;
use rusqlite::params;

impl Store<'_> {
    /// Insert one or more payment records for a sale inside a transaction.
    ///
    /// Each [`PaymentSplitArg`] produces a single row in the `payments`
    /// table. The caller is responsible for ensuring the total of all
    /// splits equals the sale total (enforced at the application layer).
    pub fn create_payments(
        &self,
        sale_id: &str,
        splits: &[PaymentSplitArg],
        currency: &Currency,
        created_at: &str,
    ) -> Result<Vec<Payment>, CoreError> {
        let mut payments = Vec::with_capacity(splits.len());
        let tx = self.conn.unchecked_transaction()?;

        let cur_str = std::str::from_utf8(&currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;

        for split in splits {
            let id = uuid::Uuid::now_v7().to_string();

            // If the split has an idempotency key, check whether a payment
            // with this key already exists — if so, return the existing
            // payment instead of creating a duplicate.
            if let Some(ref key) = split.idempotency_key {
                let existing: Option<String> = tx
                    .query_row(
                        "SELECT id FROM payments WHERE idempotency_key = ?1",
                        params![key],
                        |row| row.get(0),
                    )
                    .optional()?
                    .flatten();
                if let Some(existing_id) = existing {
                    // Return the existing payment record — no duplicate created.
                    let existing_payment = tx.query_row(
                        "SELECT id, sale_id, method, amount_minor, currency, created_at,
                                gateway_reference, gateway_status, gateway_response, idempotency_key
                         FROM payments WHERE id = ?1",
                        params![existing_id],
                        |row| {
                            let cur_str: String = row.get("currency")?;
                            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                                rusqlite::Error::ToSqlConversionFailure(
                                    std::io::Error::new(
                                        std::io::ErrorKind::InvalidData,
                                        e.to_string(),
                                    )
                                    .into(),
                                )
                            })?;
                            Ok(Payment {
                                id: row.get("id")?,
                                sale_id: row.get("sale_id")?,
                                method: row.get("method")?,
                                amount: Money {
                                    minor_units: row.get("amount_minor")?,
                                    currency,
                                },
                                created_at: row.get("created_at")?,
                                gateway_reference: row.get("gateway_reference")?,
                                gateway_status: row.get("gateway_status")?,
                                gateway_response: row.get("gateway_response")?,
                                idempotency_key: row.get("idempotency_key")?,
                            })
                        },
                    )?;
                    payments.push(existing_payment);
                    continue;
                }
            }

            tx.execute(
                "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at,
                                       gateway_reference, gateway_status, gateway_response, idempotency_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    id,
                    sale_id,
                    split.method,
                    split.amount_minor,
                    cur_str,
                    created_at,
                    split.gateway_reference,
                    split.gateway_status,
                    split.gateway_response,
                    split.idempotency_key,
                ],
            )?;
            payments.push(Payment {
                id,
                sale_id: sale_id.to_string(),
                method: split.method.clone(),
                amount: Money {
                    minor_units: split.amount_minor,
                    currency: *currency,
                },
                created_at: created_at.to_string(),
                gateway_reference: split.gateway_reference.clone(),
                gateway_status: split.gateway_status.clone(),
                gateway_response: split.gateway_response.clone(),
                idempotency_key: split.idempotency_key.clone(),
            });
        }

        tx.commit()?;
        Ok(payments)
    }

    /// Retrieve all payment records for a given sale.
    pub fn list_payments_for_sale(&self, sale_id: &str) -> Result<Vec<Payment>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sale_id, method, amount_minor, currency, created_at,
                    gateway_reference, gateway_status, gateway_response, idempotency_key
             FROM payments WHERE sale_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![sale_id], |row| {
            let cur_str: String = row.get("currency")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            Ok(Payment {
                id: row.get("id")?,
                sale_id: row.get("sale_id")?,
                method: row.get("method")?,
                amount: Money {
                    minor_units: row.get("amount_minor")?,
                    currency,
                },
                created_at: row.get("created_at")?,
                gateway_reference: row.get("gateway_reference")?,
                gateway_status: row.get("gateway_status")?,
                gateway_response: row.get("gateway_response")?,
                idempotency_key: row.get("idempotency_key")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up the sale that a checkout attempt already paid for.
    ///
    /// This is the read-side counterpart to the UNIQUE guard on
    /// `idempotency_key`. A replayed submission must return the receipt that
    /// already exists rather than ring up a second sale — but the caller
    /// cannot know the sale id, because the response it is replaying is
    /// precisely the thing that was lost. The attempt key is therefore the
    /// only handle back to the original sale.
    ///
    /// `key` is the idempotency key of any one split in the attempt; callers
    /// normally pass the first. Returns `None` for a key that was never
    /// stored. Keys written before COR-7 are SQL `NULL` and never match,
    /// which is correct: SQLite treats each NULL as distinct from every
    /// other, so unkeyed legacy payments cannot be replayed by accident.
    pub fn find_sale_by_idempotency_key(&self, key: &str) -> Result<Option<String>, CoreError> {
        let sale_id: Option<String> = self
            .conn
            .query_row(
                "SELECT sale_id FROM payments WHERE idempotency_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(sale_id)
    }
}

#[cfg(test)]
#[path = "payments_tests.rs"]
mod tests;
