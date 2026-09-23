//! Accounts Payable (Hutang) repository — the persistence behind the
//! "received stock, not yet paid the supplier" ledger (Phase 4 of
//! `docs/plans/payment-methods-plan.md`).
//!
//! Owns the `payables` and `payable_payments` tables. Every read/write is
//! tenant-scoped (`WHERE tenant_id = ?`). The repository enforces DATA
//! invariants (positive amounts, no over-payment, valid state transitions);
//! AUTHORIZATION (who may raise / settle / write off a payable) is the scoped
//! IPC command's gate, mirroring how the memo store separates persistence
//! from permission.
//!
//! Money is fixed-point [`Money`] (i64 minor units). A payment is a
//! two-row write (insert a `payable_payments` history row + accumulate
//! `payables.paid_minor`) and runs in one transaction, so a crash can never
//! record a payment that the payable does not reflect. Creation is atomic in
//! the same way: the amount/supplier checks and the INSERT share one
//! transaction, so a row exists only if every check passed (see
//! [`Store::create_payable`]).

use rusqlite::{OptionalExtension, params};

use crate::error::CoreError;
use crate::money::Currency;
use crate::payable::{NewPayable, Payable, PayablePayment, PayableStatus};
use crate::{Money, Store};

/// Current UTC time in the schema's canonical ISO-8601 millisecond form.
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Store<'_> {
    /// Create a payable (a debt owed to a supplier). The id, timestamps,
    /// `status = open`, and `paid = 0` are assigned here; the caller supplies
    /// the commercial facts via [`NewPayable`].
    ///
    /// The checks and the INSERT are ONE unit: the transaction is opened
    /// before the first check, so a payable row can only exist if every check
    /// passed, and a refused create leaves nothing behind (no row, no open
    /// transaction). Callers that already hold a transaction on this
    /// connection MUST use [`Self::create_payable_in_tx`] instead to avoid a
    /// nested `BEGIN` (same split as `update_user`/`update_user_in_tx`).
    pub fn create_payable(&self, input: &NewPayable) -> Result<Payable, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let payable = Store::new(&tx).create_payable_in_tx(input)?;
        tx.commit()?;
        Ok(payable)
    }

    /// The body of [`Self::create_payable`], writing on `self.conn` WITHOUT
    /// opening a transaction — the caller must already hold one on this
    /// connection.
    pub fn create_payable_in_tx(&self, input: &NewPayable) -> Result<Payable, CoreError> {
        if input.tenant_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "tenant_id",
                message: "must not be empty".into(),
            });
        }
        if input.supplier_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "supplier_id",
                message: "must not be empty".into(),
            });
        }
        if input.amount.minor_units <= 0 {
            return Err(CoreError::Validation {
                field: "amount",
                message: "payable amount must be positive".into(),
            });
        }
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_iso();
        let currency = input.amount.currency.to_string();
        let source = {
            let s = input.source.trim();
            if s.is_empty() {
                "manual".to_string()
            } else {
                s.to_string()
            }
        };
        self.conn.execute(
            "INSERT INTO payables
                (id, tenant_id, supplier_id, po_id, source, reference,
                 amount_minor, paid_minor, currency, due_date, status, note,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, 'open', ?10, ?11, ?11)",
            params![
                id,
                input.tenant_id,
                input.supplier_id,
                input.po_id,
                source,
                input.reference,
                input.amount.minor_units,
                currency,
                input.due_date,
                input.note,
                now,
            ],
        )?;
        self.get_payable(&input.tenant_id, &id)?
            .ok_or_else(|| CoreError::Internal("payable vanished after insert".into()))
    }

    /// Fetch one payable scoped to its tenant.
    pub fn get_payable(
        &self,
        tenant_id: &str,
        payable_id: &str,
    ) -> Result<Option<Payable>, CoreError> {
        self.conn
            .query_row(
                "SELECT id, tenant_id, supplier_id, po_id, source, reference,
                        amount_minor, paid_minor, currency, due_date, status, note,
                        created_at, updated_at, settled_at, written_off_at
                 FROM payables WHERE tenant_id = ?1 AND id = ?2",
                params![tenant_id, payable_id],
                Self::row_to_payable,
            )
            .optional()
            .map_err(CoreError::from)
    }

    /// List payables for a tenant, newest first. `status = Some(s)` filters to
    /// one lifecycle state; `None` returns all.
    pub fn list_payables(
        &self,
        tenant_id: &str,
        status: Option<PayableStatus>,
    ) -> Result<Vec<Payable>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, supplier_id, po_id, source, reference,
                    amount_minor, paid_minor, currency, due_date, status, note,
                    created_at, updated_at, settled_at, written_off_at
             FROM payables
             WHERE tenant_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY created_at DESC",
        )?;
        let status_str = status.map(|s| s.as_str());
        let rows = stmt.query_map(params![tenant_id, status_str], Self::row_to_payable)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Payables still owed (`open`/`partial`) whose due date is strictly
    /// before `today` (ISO `YYYY-MM-DD`). Open-ended payables (no due date)
    /// are never overdue. Oldest-due first (most overdue leading).
    pub fn list_overdue_payables(
        &self,
        tenant_id: &str,
        today: &str,
    ) -> Result<Vec<Payable>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, supplier_id, po_id, source, reference,
                    amount_minor, paid_minor, currency, due_date, status, note,
                    created_at, updated_at, settled_at, written_off_at
             FROM payables
             WHERE tenant_id = ?1
               AND status IN ('open','partial')
               AND due_date IS NOT NULL
               AND due_date < ?2
             ORDER BY due_date ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id, today], Self::row_to_payable)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Total still-owed balance (sum of `amount - paid` over open/partial
    /// payables) in minor units, for a tenant. Zero when nothing is owed.
    pub fn outstanding_payable_total(&self, tenant_id: &str) -> Result<i64, CoreError> {
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(amount_minor - paid_minor), 0)
             FROM payables WHERE tenant_id = ?1 AND status IN ('open','partial')",
            params![tenant_id],
            |r| r.get(0),
        )?;
        Ok(total)
    }

    /// Record a payment toward a payable, supporting partial settlement.
    ///
    /// Inserts a `payable_payments` history row and accumulates
    /// `payables.paid_minor`, recomputing status (`open → partial → paid`)
    /// and stamping `settled_at` on full settlement. Rejects non-positive
    /// amounts, currency mismatch, and over-payment beyond the outstanding
    /// balance. The UPDATE carries a `status IN ('open','partial')` race
    /// guard and its affected-row count is checked (the `revise_memo`
    /// lesson): if a concurrent settle/write-off moved the row out from under
    /// us, the transaction rolls back and the payment is not recorded.
    #[allow(clippy::too_many_arguments)]
    pub fn record_payable_payment(
        &self,
        tenant_id: &str,
        payable_id: &str,
        amount: Money,
        method: &str,
        recorded_by: Option<&str>,
        note: &str,
    ) -> Result<(Payable, PayablePayment), CoreError> {
        let payable =
            self.get_payable(tenant_id, payable_id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "payable",
                    id: payable_id.into(),
                })?;
        if payable.status.is_terminal() {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot pay a payable in state '{}'",
                    payable.status.as_str()
                ),
            });
        }
        if amount.minor_units <= 0 {
            return Err(CoreError::Validation {
                field: "amount",
                message: "payment must be positive".into(),
            });
        }
        if amount.currency != payable.amount.currency {
            return Err(CoreError::Validation {
                field: "currency",
                message: format!(
                    "payment currency {} does not match payable currency {}",
                    amount.currency, payable.amount.currency
                ),
            });
        }
        let new_paid = payable.paid.minor_units + amount.minor_units;
        if new_paid > payable.amount.minor_units {
            return Err(CoreError::Validation {
                field: "amount",
                message: format!(
                    "payment of {paid} exceeds outstanding balance {balance}",
                    paid = amount.minor_units,
                    balance = payable.balance_minor()
                ),
            });
        }
        let new_status = PayableStatus::from_amounts(new_paid, payable.amount.minor_units);
        let paid_at = now_iso();
        let settled_at = if new_status == PayableStatus::Paid {
            Some(paid_at.clone())
        } else {
            None
        };
        let payment_id = uuid::Uuid::now_v7().to_string();
        let currency = amount.currency.to_string();

        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE payables
             SET paid_minor = ?2, status = ?3, settled_at = ?4, updated_at = ?5
             WHERE tenant_id = ?1 AND id = ?6 AND status IN ('open','partial')",
            params![
                tenant_id,
                new_paid,
                new_status.as_str(),
                settled_at,
                paid_at,
                payable_id
            ],
        )?;
        if changed == 0 {
            // The row left open/partial between the read and this write; drop
            // the tx (rollback) rather than record an orphaned payment.
            return Err(CoreError::Validation {
                field: "status",
                message: "payable was settled or written off concurrently; payment not recorded"
                    .into(),
            });
        }
        tx.execute(
            "INSERT INTO payable_payments
                (id, tenant_id, payable_id, amount_minor, currency, method, paid_at, recorded_by, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                payment_id,
                tenant_id,
                payable_id,
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
            .get_payable(tenant_id, payable_id)?
            .ok_or_else(|| CoreError::Internal("payable vanished after payment".into()))?;
        let payment = PayablePayment {
            id: payment_id,
            tenant_id: tenant_id.to_string(),
            payable_id: payable_id.to_string(),
            amount,
            method: method.to_string(),
            paid_at,
            recorded_by: recorded_by.map(str::to_string),
            note: note.to_string(),
        };
        Ok((updated, payment))
    }

    /// Write off a payable (forgive the remaining balance without payment).
    /// A money-destruction event: terminal, and the caller is expected to
    /// audit-log it. The paid portion is left recorded; only the status and
    /// `written_off_at` change. Race-guarded like [`Store::record_payable_payment`].
    pub fn write_off_payable(
        &self,
        tenant_id: &str,
        payable_id: &str,
    ) -> Result<Payable, CoreError> {
        let payable =
            self.get_payable(tenant_id, payable_id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "payable",
                    id: payable_id.into(),
                })?;
        if !PayableStatus::can_transition(payable.status, PayableStatus::WrittenOff) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot write off a payable in state '{}'",
                    payable.status.as_str()
                ),
            });
        }
        let now = now_iso();
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE payables
             SET status = 'written_off', written_off_at = ?2, updated_at = ?2
             WHERE tenant_id = ?1 AND id = ?3 AND status IN ('open','partial')",
            params![tenant_id, now, payable_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "status",
                message: "payable was settled or written off concurrently; write-off not applied"
                    .into(),
            });
        }
        tx.commit()?;
        self.get_payable(tenant_id, payable_id)?
            .ok_or_else(|| CoreError::Internal("payable vanished after write-off".into()))
    }

    /// The payment history for a payable, oldest first.
    pub fn list_payable_payments(
        &self,
        tenant_id: &str,
        payable_id: &str,
    ) -> Result<Vec<PayablePayment>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, payable_id, amount_minor, currency, method,
                    paid_at, recorded_by, note
             FROM payable_payments
             WHERE tenant_id = ?1 AND payable_id = ?2
             ORDER BY paid_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id, payable_id], Self::row_to_payable_payment)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Map a `payables` row (all 16 columns, in the SELECT order used above).
    fn row_to_payable(row: &rusqlite::Row<'_>) -> Result<Payable, rusqlite::Error> {
        let cur_str: String = row.get("currency")?;
        let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(Payable {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            supplier_id: row.get("supplier_id")?,
            po_id: row.get("po_id")?,
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
            status: PayableStatus::from_db(&row.get::<_, String>("status")?),
            note: row.get("note")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            settled_at: row.get("settled_at")?,
            written_off_at: row.get("written_off_at")?,
        })
    }

    /// Map a `payable_payments` row.
    fn row_to_payable_payment(row: &rusqlite::Row<'_>) -> Result<PayablePayment, rusqlite::Error> {
        let cur_str: String = row.get("currency")?;
        let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(PayablePayment {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            payable_id: row.get("payable_id")?,
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
}

#[cfg(test)]
#[path = "payables_tests.rs"]
mod tests;
