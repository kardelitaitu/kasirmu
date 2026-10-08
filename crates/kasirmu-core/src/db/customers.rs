//! Customer CRUD — list, get, create, update, delete.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 3)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: clean CRUD; PII-bounded search per CUST-06 (server-side LIKE with ESCAPE, clamped page [1,100], count for pagination); store soft-scoping documented (migration 069/117); single-statement writes rely on SQLite statement atomicity (crate-wide RUST-08 convention); COR-23 CLOSED 26-09-26 — and one correction to how it was first stated: it read "hard-deletes regardless of sales history / loyalty account — dangling references possible", which is NOT what happens. `sales.customer_id` and `loyalty_accounts.customer_id` are NO ACTION and `foreign_keys` is ON on every connection path, so the FK rejects the delete outright and a dangling reference is impossible (CUST-11 intends exactly that). The real gap was reporting, not safety: the refusal reached the client as `CoreError::Db` with a raw "FOREIGN KEY constraint failed", naming neither the customer nor the blocker, so a UI could only show a storage fault. Now mapped to `Validation { field: "customer_id", .. }` with a message that says what holds the row and what to do
next: none | perf: N/A
*/

use rusqlite::params;

use foundation::{Email, Phone};

use crate::Customer;
use crate::error::CoreError;

use super::Store;

/// Normalise the optional contact fields of a customer row to what the API
/// reports (MSL-44).
///
/// An unparseable address becomes `None` — the same answer the read path
/// (`row_to_customer`) and the return-value builders already give, via
/// `Email::new(..).ok()`. The bug was that the WRITE disagreed with both: it
/// bound the caller's raw string straight into the INSERT/UPDATE, so the column
/// held `Some("not-an-email")` while every API surface reported `email: None`.
/// Measured before the fix:
///
/// ```text
/// create returns        = None
/// stored in the column  = Some("not-an-email")     <- the disagreement
/// read-back returns     = None
/// ```
///
/// The value was therefore invisible through the type system and permanent in
/// storage: `create_customer_invalid_email_saved_as_none` names the intended
/// behaviour precisely, and it is the COLUMN that was not honouring it. Any
/// future reader of the raw column — a report, an export, a sync push — would
/// have picked up what every caller believed was absent.
///
/// Returning `None` here (rather than rejecting) keeps the contract the suite
/// already pins, so callers that validate first are unaffected either way.
fn normalise_contact_field(raw: Option<&str>, valid: impl Fn(&str) -> bool) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() || !valid(trimmed) {
        return None;
    }
    Some(trimmed.to_owned())
}

impl Store<'_> {
    /// List all customers, ordered by name.
    pub fn list_customers(&self) -> Result<Vec<Customer>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email, phone, loyalty_points, total_spent_minor, currency,
                    notes, created_at, updated_at
             FROM customers ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            let email_raw: Option<String> = row.get("email")?;
            let phone_raw: Option<String> = row.get("phone")?;
            Ok(Customer {
                id: row.get("id")?,
                name: row.get("name")?,
                email: email_raw.and_then(|s| Email::new(&s).ok()),
                phone: phone_raw.and_then(|s| Phone::new(&s).ok()),
                loyalty_points: row.get("loyalty_points")?,
                total_spent_minor: row.get("total_spent_minor")?,
                currency: row.get("currency")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List customers visible to one store (soft-scoping layer, migration
    /// 069/117), ordered by name.
    ///
    /// A store sees the shared global customer base (`store_id IS NULL`)
    /// plus its own tagged rows — never another store's rows. In the
    /// per-store database model every row is NULL, so this degenerates to
    /// the global list; it is the enforcement surface for shared/cloud
    /// databases where `store_id` is the soft-scoping column.
    pub fn list_customers_for_store(&self, store_id: &str) -> Result<Vec<Customer>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email, phone, loyalty_points, total_spent_minor, currency,
                    notes, created_at, updated_at
             FROM customers
             WHERE store_id IS NULL OR store_id = ?1
             ORDER BY name",
        )?;
        let rows = stmt.query_map(params![store_id], |row| {
            let email_raw: Option<String> = row.get("email")?;
            let phone_raw: Option<String> = row.get("phone")?;
            Ok(Customer {
                id: row.get("id")?,
                name: row.get("name")?,
                email: email_raw.and_then(|s| Email::new(&s).ok()),
                phone: phone_raw.and_then(|s| Phone::new(&s).ok()),
                loyalty_points: row.get("loyalty_points")?,
                total_spent_minor: row.get("total_spent_minor")?,
                currency: row.get("currency")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Search customers by name, email, or phone with a bounded page.
    ///
    /// CUST-06: keeps the PII surface delivered to the renderer bounded —
    /// the query runs server-side with an explicit sort order and a caller-
    /// supplied page size (clamped to `[1, 100]`). Returns the matching
    /// rows plus the total match count for pagination.
    pub fn search_customers(
        &self,
        query: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(Vec<Customer>, u64), CoreError> {
        let trimmed = query.trim();
        let bounded = limit.clamp(1, 100);
        // Escape the LIKE wildcards so user input with literal % or _ does
        // not broaden the match beyond intent (e.g. searching "50%" must not
        // match every row).
        let escaped = trimmed
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        // ESCAPE '\' so user input with literal % or _ does not broaden the
        // match beyond intent.
        let filter = "(name LIKE ?1 ESCAPE '\\' OR COALESCE(email, '') LIKE ?1 ESCAPE '\\' OR COALESCE(phone, '') LIKE ?1 ESCAPE '\\')";

        let total: u64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM customers WHERE {filter}"),
            params![pattern],
            |row| row.get(0),
        )?;

        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, name, email, phone, loyalty_points, total_spent_minor, currency,
                    notes, created_at, updated_at
             FROM customers WHERE {filter} ORDER BY name LIMIT ?2 OFFSET ?3"
        ))?;
        let rows = stmt.query_map(params![pattern, bounded, offset], |row| {
            let email_raw: Option<String> = row.get("email")?;
            let phone_raw: Option<String> = row.get("phone")?;
            Ok(Customer {
                id: row.get("id")?,
                name: row.get("name")?,
                email: email_raw.and_then(|s| Email::new(&s).ok()),
                phone: phone_raw.and_then(|s| Phone::new(&s).ok()),
                loyalty_points: row.get("loyalty_points")?,
                total_spent_minor: row.get("total_spent_minor")?,
                currency: row.get("currency")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        let items = rows
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;
        Ok((items, total))
    }

    /// Look up a single customer by id.
    pub fn get_customer(&self, id: &str) -> Result<Option<Customer>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email, phone, loyalty_points, total_spent_minor, currency,
                    notes, created_at, updated_at
             FROM customers WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            let email_raw: Option<String> = row.get("email")?;
            let phone_raw: Option<String> = row.get("phone")?;
            Ok(Customer {
                id: row.get("id")?,
                name: row.get("name")?,
                email: email_raw.and_then(|s| Email::new(&s).ok()),
                phone: phone_raw.and_then(|s| Phone::new(&s).ok()),
                loyalty_points: row.get("loyalty_points")?,
                total_spent_minor: row.get("total_spent_minor")?,
                currency: row.get("currency")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        });
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Insert a new customer.
    pub fn create_customer(
        &self,
        name: &str,
        email: Option<&str>,
        phone: Option<&str>,
        notes: Option<&str>,
    ) -> Result<Customer, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "customer name must not be empty".into(),
            });
        }
        if name.chars().count() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "customer name must not exceed 255 characters, got {}",
                    name.chars().count()
                ),
            });
        }
        // MSL-44: bind what the API reports, not the raw caller string.
        let email = normalise_contact_field(email, |s| Email::new(s).is_ok());
        let phone = normalise_contact_field(phone, |s| Phone::new(s).is_ok());

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        self.conn.execute(
            "INSERT INTO customers (id, name, email, phone, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                name.trim(),
                email,
                phone,
                notes.unwrap_or_default(),
                now,
                now
            ],
        )?;

        Ok(Customer {
            id,
            name: name.trim().to_owned(),
            email: email.and_then(|s| Email::new(s).ok()),
            phone: phone.and_then(|s| Phone::new(s).ok()),
            loyalty_points: 0,
            total_spent_minor: 0,
            currency: "USD".into(),
            notes: notes.unwrap_or_default().to_owned(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update an existing customer.
    pub fn update_customer(
        &self,
        id: &str,
        name: &str,
        email: Option<&str>,
        phone: Option<&str>,
        notes: Option<&str>,
    ) -> Result<Customer, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "customer name must not be empty".into(),
            });
        }
        if name.chars().count() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "customer name must not exceed 255 characters, got {}",
                    name.chars().count()
                ),
            });
        }

        // MSL-44: bind what the API reports, not the raw caller string.
        let email = normalise_contact_field(email, |s| Email::new(s).is_ok());
        let phone = normalise_contact_field(phone, |s| Phone::new(s).is_ok());

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE customers SET name = ?1, email = ?2, phone = ?3, notes = ?4, updated_at = ?5 WHERE id = ?6",
            params![name.trim(), email, phone, notes.unwrap_or_default(), now, id],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "customer",
                id: id.to_owned(),
            });
        }

        self.get_customer(id)?.ok_or(CoreError::NotFound {
            entity: "customer",
            id: id.to_owned(),
        })
    }

    /// Accrue a completed sale's base-currency total into the customer's
    /// lifetime spend, inside the caller's transaction (Phase 5 P5.3).
    ///
    /// `customers` is owned by the `crm` module (`modules/ownership.json`); this
    /// is the core-owned surface that module's data is written through, and the
    /// single writer of `total_spent_minor`. The sale lifecycle calls it instead
    /// of issuing the `UPDATE` itself, so the column has one entry point.
    ///
    /// Statement-level atomic increment (no read-modify-write race): SQLite
    /// raises on i64 overflow, which the caller logs non-fatal. Returns the
    /// number of rows touched (0 when the customer vanished).
    ///
    /// # Errors
    ///
    /// Returns `CoreError::Db` when the statement itself fails.
    pub fn accrue_lifetime_spend_in_tx(
        tx: &rusqlite::Connection,
        customer_id: &str,
        amount_minor: i64,
    ) -> Result<usize, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = tx.execute(
            "UPDATE customers SET total_spent_minor = total_spent_minor + ?1, updated_at = ?2 \
             WHERE id = ?3",
            params![amount_minor, now, customer_id],
        )?;
        Ok(rows)
    }

    /// Project the authoritative `loyalty_accounts.points` balance onto
    /// `customers.loyalty_points`, inside the caller's transaction (Phase 5
    /// P5.3, MSL-4).
    ///
    /// `customers` is crm-owned; this is the second core-owned writer of a
    /// `customers` column, paired with [`Self::accrue_lifetime_spend_in_tx`], so
    /// all core writes to the table live here rather than in the loyalty ledger.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::Db` when the statement fails.
    pub fn project_loyalty_points_in_tx(
        tx: &rusqlite::Connection,
        customer_id: &str,
    ) -> Result<usize, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = tx.execute(
            "UPDATE customers SET loyalty_points = \
                (SELECT points FROM loyalty_accounts WHERE customer_id = ?1), \
             updated_at = ?2 WHERE id = ?1",
            params![customer_id, now],
        )?;
        Ok(rows)
    }

    /// Project the ledger balance onto `customers.loyalty_points`, resolving the
    /// customer from the loyalty ACCOUNT id (Phase 5 P5.3, MSL-4 refund-reversal
    /// shape). Same single-writer contract as
    /// [`Self::project_loyalty_points_in_tx`], for the path that has no customer
    /// id in hand.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::Db` when the statement fails.
    pub fn project_loyalty_points_for_account_in_tx(
        conn: &rusqlite::Connection,
        account_id: &str,
    ) -> Result<usize, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = conn.execute(
            "UPDATE customers SET loyalty_points = \
                (SELECT points FROM loyalty_accounts WHERE id = ?1), \
             updated_at = ?2 WHERE id = (SELECT customer_id FROM loyalty_accounts WHERE id = ?1)",
            params![account_id, now],
        )?;
        Ok(rows)
    }

    /// Reverse part of a customer's lifetime spend on refund, inside the caller's
    /// transaction (Phase 5 P5.3). The mirror of
    /// [`Self::accrue_lifetime_spend_in_tx`]: clamps at zero (`MAX(..., 0)`) so a
    /// refund can never drive the lifetime total negative, and takes the timestamp
    /// so the caller's existing clock is used.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::Db` when the statement fails.
    pub fn reverse_lifetime_spend_in_tx(
        conn: &rusqlite::Connection,
        customer_id: &str,
        amount_minor: i64,
        at: &str,
    ) -> Result<usize, CoreError> {
        let rows = conn.execute(
            "UPDATE customers SET total_spent_minor = MAX(total_spent_minor - ?1, 0), \
             updated_at = ?2 WHERE id = ?3",
            params![amount_minor, at, customer_id],
        )?;
        Ok(rows)
    }

    /// Delete a customer by id.
    pub fn delete_customer(&self, id: &str) -> Result<(), CoreError> {
        // COR-23: the referential guard is the FK itself (`sales.customer_id`
        // and `loyalty_accounts.customer_id`, both NO ACTION), which is the
        // INTENDED design — CUST-11 blocks the delete so no orphaned child rows
        // can be left behind. What was missing is only the NAME of the failure:
        // a bare `DELETE` met `FOREIGN KEY constraint failed`, which reaches the
        // client as `CoreError::Db` and names neither the customer nor what is
        // holding it. Mapped to `Validation` rather than `Conflict`: the
        // customer EXISTS, so `NotFound` would be a lie, and the shared
        // `Conflict` message is written for a uniqueness collision ("already
        // exists") which reads as a failed CREATE here. `Validation` carries a
        // free-form message, so the refusal can say what holds the row and what
        // to do — and `field: "customer_id"` names the column both referrers
        // share.
        let deleted = self
            .conn
            .execute("DELETE FROM customers WHERE id = ?1", params![id]);
        if let Err(rusqlite::Error::SqliteFailure(e, _)) = &deleted
            && e.code == rusqlite::ErrorCode::ConstraintViolation
        {
            return Err(CoreError::Validation {
                field: "customer_id",
                message: "this customer still has sales or a loyalty account; those rows \
                          reference it and must be removed or reassigned before the customer \
                          can be deleted"
                    .to_owned(),
            });
        }
        let rows = deleted?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "customer",
                id: id.to_owned(),
            });
        }
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "customers_tests.rs"]
mod tests;
