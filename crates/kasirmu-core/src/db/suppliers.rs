//! Supplier CRUD — list, get, create, update, delete.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean CRUD; length checks (255/50) present in BOTH create and update (unlike products.rs — see COR-12)
next: none | perf: N/A
*/

use rusqlite::params;

use crate::Supplier;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// List all suppliers, ordered by name.
    pub fn list_suppliers(&self) -> Result<Vec<Supplier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, code, name, contact_person, phone, email, address, tax_id,
                    payment_terms, notes, status, created_at, updated_at
             FROM suppliers ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Supplier {
                id: row.get("id")?,
                code: row.get("code")?,
                name: row.get("name")?,
                contact_person: row.get("contact_person")?,
                phone: row.get("phone")?,
                email: row.get("email")?,
                address: row.get("address")?,
                tax_id: row.get("tax_id")?,
                payment_terms: row.get("payment_terms")?,
                notes: row.get("notes")?,
                status: row.get("status")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a single supplier by id.
    pub fn get_supplier(&self, id: &str) -> Result<Option<Supplier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, code, name, contact_person, phone, email, address, tax_id,
                    payment_terms, notes, status, created_at, updated_at
             FROM suppliers WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(Supplier {
                id: row.get("id")?,
                code: row.get("code")?,
                name: row.get("name")?,
                contact_person: row.get("contact_person")?,
                phone: row.get("phone")?,
                email: row.get("email")?,
                address: row.get("address")?,
                tax_id: row.get("tax_id")?,
                payment_terms: row.get("payment_terms")?,
                notes: row.get("notes")?,
                status: row.get("status")?,
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

    /// Insert a new supplier.
    #[allow(clippy::too_many_arguments)]
    pub fn create_supplier(
        &self,
        code: &str,
        name: &str,
        contact_person: &str,
        phone: &str,
        email: &str,
        address: &str,
        tax_id: &str,
        payment_terms: &str,
        notes: &str,
    ) -> Result<Supplier, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "supplier name must not be empty".into(),
            });
        }
        if name.len() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "supplier name must not exceed 255 characters, got {}",
                    name.len()
                ),
            });
        }
        if code.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "code",
                message: "supplier code must not be empty".into(),
            });
        }
        if code.len() > 50 {
            return Err(CoreError::Validation {
                field: "code",
                message: format!(
                    "supplier code must not exceed 50 characters, got {}",
                    code.len()
                ),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        self.conn.execute(
            "INSERT INTO suppliers (id, code, name, contact_person, phone, email, address, tax_id,
                                    payment_terms, notes, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?12)",
            params![
                id,
                code.trim(),
                name.trim(),
                contact_person,
                phone,
                email,
                address,
                tax_id,
                payment_terms,
                notes,
                now,
                now
            ],
        )?;

        Ok(Supplier {
            id,
            code: code.trim().to_owned(),
            name: name.trim().to_owned(),
            contact_person: contact_person.to_owned(),
            phone: phone.to_owned(),
            email: email.to_owned(),
            address: address.to_owned(),
            tax_id: tax_id.to_owned(),
            payment_terms: payment_terms.to_owned(),
            notes: notes.to_owned(),
            status: "active".into(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update an existing supplier.
    #[allow(clippy::too_many_arguments)]
    pub fn update_supplier(
        &self,
        id: &str,
        code: &str,
        name: &str,
        contact_person: &str,
        phone: &str,
        email: &str,
        address: &str,
        tax_id: &str,
        payment_terms: &str,
        notes: &str,
        status: &str,
    ) -> Result<Supplier, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "supplier name must not be empty".into(),
            });
        }
        if name.len() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "supplier name must not exceed 255 characters, got {}",
                    name.len()
                ),
            });
        }
        if code.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "code",
                message: "supplier code must not be empty".into(),
            });
        }
        if code.len() > 50 {
            return Err(CoreError::Validation {
                field: "code",
                message: format!(
                    "supplier code must not exceed 50 characters, got {}",
                    code.len()
                ),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE suppliers SET code=?1, name=?2, contact_person=?3, phone=?4, email=?5,
                                  address=?6, tax_id=?7, payment_terms=?8, notes=?9,
                                  status=?10, updated_at=?11
             WHERE id=?12",
            params![
                code.trim(),
                name.trim(),
                contact_person,
                phone,
                email,
                address,
                tax_id,
                payment_terms,
                notes,
                status,
                now,
                id
            ],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "supplier",
                id: id.to_owned(),
            });
        }

        self.get_supplier(id)?.ok_or(CoreError::NotFound {
            entity: "supplier",
            id: id.to_owned(),
        })
    }

    /// Delete a supplier by id.
    pub fn delete_supplier(&self, id: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM suppliers WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "supplier",
                id: id.to_owned(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "suppliers_tests.rs"]
mod tests;
