//! Customer CRUD — list, get, create, update, delete.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 3)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean CRUD; PII-bounded search per CUST-06 (server-side LIKE with ESCAPE, clamped page [1,100], count for pagination); store soft-scoping documented (migration 069/117); COR-23 INFO: delete_customer hard-deletes regardless of sales history / loyalty account — dangling references possible; single-statement writes rely on SQLite statement atomicity (crate-wide RUST-08 convention)
next: consider soft-delete or referential guard on delete_customer (COR-23) | perf: N/A
*/

use rusqlite::params;

use foundation::{Email, Phone};

use crate::Customer;
use crate::error::CoreError;

use super::Store;

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
        if name.len() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "customer name must not exceed 255 characters, got {}",
                    name.len()
                ),
            });
        }

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
        if name.len() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "customer name must not exceed 255 characters, got {}",
                    name.len()
                ),
            });
        }

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

    /// Delete a customer by id.
    pub fn delete_customer(&self, id: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM customers WHERE id = ?1", params![id])?;
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
