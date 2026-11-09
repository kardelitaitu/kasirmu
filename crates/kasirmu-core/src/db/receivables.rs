//! Accounts Receivable (Piutang / Jual Tempo / Kasbon) repository — the persistence
//! behind customer debts and deferred payments (Phase 3 of `docs/plans/_done/done-payment-methods-plan.md`).
//!
//! Owns the `receivables` and `receivable_payments` tables. Every read/write is
//! tenant-scoped (`WHERE tenant_id = ?`). The repository enforces DATA
//! invariants (positive amounts, no over-payment, valid state transitions);
//! AUTHORIZATION (who may raise / collect / write off a receivable) is the scoped
//! IPC command's gate, mirroring how the payables store separates persistence
//! from permission.
//!
//! Money is fixed-point [`Money`] (i64 minor units). A payment is a
//! two-row write (insert a `receivable_payments` history row + accumulate
//! `receivables.paid_minor`) and runs in one transaction, so a crash can never
//! record a payment that the receivable does not reflect. Creation is atomic in
//! the same way: the amount/customer checks and the INSERT share one
//! transaction, so a row exists only if every check passed (see
//! [`Store::create_receivable`]).

use rusqlite::{OptionalExtension, params};

use crate::error::CoreError;
use crate::money::Currency;
use crate::receivable::{
    CustomerAgingRow, NewReceivable, Receivable, ReceivableAgingBucket, ReceivableAgingReport,
    ReceivablePayment, ReceivableStatus,
};
use crate::{Money, Store};

/// Current UTC time in the schema's canonical ISO-8601 millisecond form.
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Store<'_> {
    /// Create a receivable (money a customer owes the store). The id, timestamps,
    /// `status = open`, and `paid = 0` are assigned here; the caller supplies
    /// the commercial facts via [`NewReceivable`].
    ///
    /// The checks and the INSERT are ONE unit: the transaction is opened
    /// before the first check, so a receivable row can only exist if every check
    /// passed, and a refused create leaves nothing behind (no row, no open
    /// transaction). Callers that already hold a transaction on this
    /// connection MUST use [`Self::create_receivable_in_tx`] instead to avoid a
    /// nested `BEGIN`.
    pub fn create_receivable(&self, input: &NewReceivable) -> Result<Receivable, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let receivable = Store::new(&tx).create_receivable_in_tx(input)?;
        tx.commit()?;
        Ok(receivable)
    }

    /// The body of [`Self::create_receivable`], writing on `self.conn` WITHOUT
    /// opening a transaction — the caller must already hold one on this
    /// connection.
    pub fn create_receivable_in_tx(&self, input: &NewReceivable) -> Result<Receivable, CoreError> {
        if input.tenant_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "tenant_id",
                message: "must not be empty".into(),
            });
        }
        if input.customer_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "customer_id",
                message: "must not be empty".into(),
            });
        }
        if input.amount.minor_units <= 0 {
            return Err(CoreError::Validation {
                field: "amount",
                message: "receivable amount must be positive".into(),
            });
        }
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_iso();
        let currency = input.amount.currency.to_string();
        let source = {
            let s = input.source.trim();
            if s.is_empty() {
                "pos".to_string()
            } else {
                s.to_string()
            }
        };
        self.conn.execute(
            "INSERT INTO receivables
                (id, tenant_id, customer_id, sale_id, source, reference,
                 amount_minor, paid_minor, currency, due_date, status, note,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, 'open', ?10, ?11, ?11)",
            params![
                id,
                input.tenant_id,
                input.customer_id,
                input.sale_id,
                source,
                input.reference,
                input.amount.minor_units,
                currency,
                input.due_date,
                input.note,
                now,
            ],
        )?;
        self.get_receivable(&input.tenant_id, &id)?
            .ok_or_else(|| CoreError::Internal("receivable vanished after insert".into()))
    }

    /// Fetch one receivable scoped to its tenant.
    pub fn get_receivable(
        &self,
        tenant_id: &str,
        receivable_id: &str,
    ) -> Result<Option<Receivable>, CoreError> {
        self.conn
            .query_row(
                "SELECT id, tenant_id, customer_id, sale_id, source, reference,
                        amount_minor, paid_minor, currency, due_date, status, note,
                        created_at, updated_at, settled_at, written_off_at
                 FROM receivables WHERE tenant_id = ?1 AND id = ?2",
                params![tenant_id, receivable_id],
                Self::row_to_receivable,
            )
            .optional()
            .map_err(CoreError::from)
    }

    /// List receivables for a tenant, newest first. `status = Some(s)` filters to
    /// one lifecycle state; `None` returns all.
    pub fn list_receivables(
        &self,
        tenant_id: &str,
        status: Option<ReceivableStatus>,
    ) -> Result<Vec<Receivable>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, customer_id, sale_id, source, reference,
                    amount_minor, paid_minor, currency, due_date, status, note,
                    created_at, updated_at, settled_at, written_off_at
             FROM receivables
             WHERE tenant_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY created_at DESC",
        )?;
        let status_str = status.map(|s| s.as_str());
        let rows = stmt.query_map(params![tenant_id, status_str], Self::row_to_receivable)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// List receivables for a specific customer, newest first.
    pub fn list_receivables_by_customer(
        &self,
        tenant_id: &str,
        customer_id: &str,
        status: Option<ReceivableStatus>,
    ) -> Result<Vec<Receivable>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, customer_id, sale_id, source, reference,
                    amount_minor, paid_minor, currency, due_date, status, note,
                    created_at, updated_at, settled_at, written_off_at
             FROM receivables
             WHERE tenant_id = ?1 AND customer_id = ?2 AND (?3 IS NULL OR status = ?3)
             ORDER BY created_at DESC",
        )?;
        let status_str = status.map(|s| s.as_str());
        let rows = stmt.query_map(
            params![tenant_id, customer_id, status_str],
            Self::row_to_receivable,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Receivables still owed (`open`/`partial`) whose due date is strictly
    /// before `today` (ISO `YYYY-MM-DD`). Open-ended receivables (no due date)
    /// are never overdue. Oldest-due first (most overdue leading).
    pub fn list_overdue_receivables(
        &self,
        tenant_id: &str,
        today: &str,
    ) -> Result<Vec<Receivable>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, customer_id, sale_id, source, reference,
                    amount_minor, paid_minor, currency, due_date, status, note,
                    created_at, updated_at, settled_at, written_off_at
             FROM receivables
             WHERE tenant_id = ?1
               AND status IN ('open','partial')
               AND due_date IS NOT NULL
               AND due_date < ?2
             ORDER BY due_date ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id, today], Self::row_to_receivable)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Total still-owed balance (sum of `amount - paid` over open/partial
    /// receivables) in minor units, for a tenant. Zero when nothing is owed.
    pub fn outstanding_receivable_total(&self, tenant_id: &str) -> Result<i64, CoreError> {
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(amount_minor - paid_minor), 0)
             FROM receivables WHERE tenant_id = ?1 AND status IN ('open','partial')",
            params![tenant_id],
            |r| r.get(0),
        )?;
        Ok(total)
    }

    /// Total still-owed balance for a single customer (sum of `amount - paid`
    /// over open/partial receivables) in minor units. Zero when nothing is owed.
    pub fn customer_outstanding_total(
        &self,
        tenant_id: &str,
        customer_id: &str,
    ) -> Result<i64, CoreError> {
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(amount_minor - paid_minor), 0)
             FROM receivables
             WHERE tenant_id = ?1 AND customer_id = ?2 AND status IN ('open','partial')",
            params![tenant_id, customer_id],
            |r| r.get(0),
        )?;
        Ok(total)
    }

    /// Record a payment collected toward a receivable, supporting partial settlement.
    ///
    /// Inserts a `receivable_payments` history row and accumulates
    /// `receivables.paid_minor`, recomputing status (`open → partial → paid`)
    /// and stamping `settled_at` on full settlement. Rejects non-positive
    /// amounts, currency mismatch, and over-payment beyond the outstanding
    /// balance. The UPDATE carries a `status IN ('open','partial')` race
    /// guard and its affected-row count is checked: if a concurrent settle/write-off
    /// moved the row out from under us, the transaction rolls back and the payment is not recorded.
    #[allow(clippy::too_many_arguments)]
    pub fn record_receivable_payment(
        &self,
        tenant_id: &str,
        receivable_id: &str,
        amount: Money,
        method: &str,
        recorded_by: Option<&str>,
        note: &str,
    ) -> Result<(Receivable, ReceivablePayment), CoreError> {
        let receivable = self
            .get_receivable(tenant_id, receivable_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "receivable",
                id: receivable_id.into(),
            })?;
        if receivable.status.is_terminal() {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot collect payment for a receivable in state '{}'",
                    receivable.status.as_str()
                ),
            });
        }
        if amount.minor_units <= 0 {
            return Err(CoreError::Validation {
                field: "amount",
                message: "payment must be positive".into(),
            });
        }
        if amount.currency != receivable.amount.currency {
            return Err(CoreError::Validation {
                field: "currency",
                message: format!(
                    "payment currency {} does not match receivable currency {}",
                    amount.currency, receivable.amount.currency
                ),
            });
        }
        let new_paid = receivable
            .paid
            .minor_units
            .checked_add(amount.minor_units)
            .ok_or_else(|| CoreError::Validation {
                field: "amount",
                message: "payment overflows the paid total".into(),
            })?;
        if new_paid > receivable.amount.minor_units {
            return Err(CoreError::Validation {
                field: "amount",
                message: format!(
                    "payment of {paid} exceeds outstanding balance {balance}",
                    paid = amount.minor_units,
                    balance = receivable.balance_minor()
                ),
            });
        }
        let new_status = ReceivableStatus::from_amounts(new_paid, receivable.amount.minor_units);
        let paid_at = now_iso();
        let settled_at = if new_status == ReceivableStatus::Paid {
            Some(paid_at.clone())
        } else {
            None
        };
        let payment_id = uuid::Uuid::now_v7().to_string();
        let currency = amount.currency.to_string();

        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE receivables
             SET paid_minor = ?2, status = ?3, settled_at = ?4, updated_at = ?5
             WHERE tenant_id = ?1 AND id = ?6 AND status IN ('open','partial')",
            params![
                tenant_id,
                new_paid,
                new_status.as_str(),
                settled_at,
                paid_at,
                receivable_id
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "status",
                message: "receivable was settled or written off concurrently; payment not recorded"
                    .into(),
            });
        }
        tx.execute(
            "INSERT INTO receivable_payments
                (id, tenant_id, receivable_id, amount_minor, currency, method, paid_at, recorded_by, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                payment_id,
                tenant_id,
                receivable_id,
                amount.minor_units,
                currency,
                method,
                paid_at,
                recorded_by,
                note,
            ],
        )?;
        tx.commit()?;

        let updated = self
            .get_receivable(tenant_id, receivable_id)?
            .ok_or_else(|| CoreError::Internal("receivable vanished after payment".into()))?;
        let payment = ReceivablePayment {
            id: payment_id,
            tenant_id: tenant_id.to_string(),
            receivable_id: receivable_id.to_string(),
            amount,
            method: method.to_string(),
            paid_at,
            recorded_by: recorded_by.map(str::to_string),
            note: note.to_string(),
        };
        Ok((updated, payment))
    }

    /// Write off a receivable (forgive the remaining balance without payment).
    /// A money-destruction event: terminal, and the caller is expected to
    /// audit-log it. The paid portion is left recorded; only the status and
    /// `written_off_at` change.
    pub fn write_off_receivable(
        &self,
        tenant_id: &str,
        receivable_id: &str,
    ) -> Result<Receivable, CoreError> {
        let receivable = self
            .get_receivable(tenant_id, receivable_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "receivable",
                id: receivable_id.into(),
            })?;
        if !ReceivableStatus::can_transition(receivable.status, ReceivableStatus::WrittenOff) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot write off a receivable in state '{}'",
                    receivable.status.as_str()
                ),
            });
        }
        let now = now_iso();
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE receivables
             SET status = 'written_off', written_off_at = ?2, updated_at = ?2
             WHERE tenant_id = ?1 AND id = ?3 AND status IN ('open','partial')",
            params![tenant_id, now, receivable_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "status",
                message:
                    "receivable was settled or written off concurrently; write-off not applied"
                        .into(),
            });
        }
        tx.commit()?;
        self.get_receivable(tenant_id, receivable_id)?
            .ok_or_else(|| CoreError::Internal("receivable vanished after write-off".into()))
    }

    /// The payment history for a receivable, oldest first.
    pub fn list_receivable_payments(
        &self,
        tenant_id: &str,
        receivable_id: &str,
    ) -> Result<Vec<ReceivablePayment>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, receivable_id, amount_minor, currency, method,
                    paid_at, recorded_by, note
             FROM receivable_payments
             WHERE tenant_id = ?1 AND receivable_id = ?2
             ORDER BY paid_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(
            params![tenant_id, receivable_id],
            Self::row_to_receivable_payment,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Map a `receivables` row.
    fn row_to_receivable(row: &rusqlite::Row<'_>) -> Result<Receivable, rusqlite::Error> {
        let cur_str: String = row.get("currency")?;
        let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(Receivable {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            customer_id: row.get("customer_id")?,
            sale_id: row.get("sale_id")?,
            source: row.get("source")?,
            reference: row.get("reference")?,
            amount: Money {
                minor_units: row.get("amount_minor")?,
                currency,
            },
            paid: Money {
                minor_units: row.get("paid_minor")?,
                currency,
            },
            due_date: row.get("due_date")?,
            status: ReceivableStatus::from_db(&row.get::<_, String>("status")?),
            note: row.get("note")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            settled_at: row.get("settled_at")?,
            written_off_at: row.get("written_off_at")?,
        })
    }

    /// Map a `receivable_payments` row.
    fn row_to_receivable_payment(
        row: &rusqlite::Row<'_>,
    ) -> Result<ReceivablePayment, rusqlite::Error> {
        let cur_str: String = row.get("currency")?;
        let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(ReceivablePayment {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            receivable_id: row.get("receivable_id")?,
            amount: Money {
                minor_units: row.get("amount_minor")?,
                currency,
            },
            method: row.get("method")?,
            paid_at: row.get("paid_at")?,
            recorded_by: row.get("recorded_by")?,
            note: row.get("note")?,
        })
    }

    /// Calculate accounts receivable aging report as of `as_of_date` (defaults to current UTC date `YYYY-MM-DD`).
    /// Buckets receivables by days elapsed since creation (0-30, 31-60, 61-90, 90+ days)
    /// across all open/partial receivables, aggregated per customer.
    pub fn get_ar_aging_report(
        &self,
        tenant_id: &str,
        as_of_date: Option<&str>,
    ) -> Result<ReceivableAgingReport, CoreError> {
        let date_str = match as_of_date {
            Some(d) if !d.trim().is_empty() => d.trim().to_string(),
            _ => chrono::Utc::now().format("%Y-%m-%d").to_string(),
        };

        let currency =
            crate::Settings::get_default_currency(self.conn)?.unwrap_or_else(|| "IDR".to_string());

        let mut stmt = self.conn.prepare(
            "SELECT
                COALESCE(c.id, r.customer_id),
                COALESCE(c.name, 'Unknown Customer'),
                c.phone,
                COALESCE(SUM(CASE WHEN CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) <= 30 THEN r.amount_minor - r.paid_minor ELSE 0 END), 0) AS current_minor,
                COALESCE(SUM(CASE WHEN CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) > 30 AND CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) <= 60 THEN r.amount_minor - r.paid_minor ELSE 0 END), 0) AS days_31_60_minor,
                COALESCE(SUM(CASE WHEN CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) > 60 AND CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) <= 90 THEN r.amount_minor - r.paid_minor ELSE 0 END), 0) AS days_61_90_minor,
                COALESCE(SUM(CASE WHEN CAST(julianday(?2) - julianday(DATE(r.created_at)) AS INTEGER) > 90 THEN r.amount_minor - r.paid_minor ELSE 0 END), 0) AS days_over_90_minor,
                COALESCE(SUM(r.amount_minor - r.paid_minor), 0) AS total_minor,
                COUNT(r.id) AS open_count
             FROM receivables r
             LEFT JOIN customers c ON r.customer_id = c.id
             WHERE r.tenant_id = ?1 AND r.status IN ('open', 'partial')
             GROUP BY COALESCE(c.id, r.customer_id), c.name, c.phone
             ORDER BY total_minor DESC",
        )?;

        let rows = stmt.query_map(params![tenant_id, date_str], |row| {
            Ok(CustomerAgingRow {
                customer_id: row.get(0)?,
                customer_name: row.get(1)?,
                customer_phone: row.get(2)?,
                current_minor: row.get(3)?,
                days_31_60_minor: row.get(4)?,
                days_61_90_minor: row.get(5)?,
                days_over_90_minor: row.get(6)?,
                total_minor: row.get(7)?,
                open_count: row.get(8)?,
            })
        })?;

        let mut customers = Vec::new();
        let mut summary = ReceivableAgingBucket {
            current_minor: 0,
            days_31_60_minor: 0,
            days_61_90_minor: 0,
            days_over_90_minor: 0,
            total_outstanding_minor: 0,
        };

        for row in rows {
            let c = row?;
            summary.current_minor += c.current_minor;
            summary.days_31_60_minor += c.days_31_60_minor;
            summary.days_61_90_minor += c.days_61_90_minor;
            summary.days_over_90_minor += c.days_over_90_minor;
            summary.total_outstanding_minor += c.total_minor;
            customers.push(c);
        }

        Ok(ReceivableAgingReport {
            as_of_date: date_str,
            currency,
            summary,
            customers,
        })
    }
}

#[cfg(test)]
#[path = "receivables_tests.rs"]
mod tests;
