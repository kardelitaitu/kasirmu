/*
last audited 25-07-26 by RSA-Agent (modules-crm slice A: repository verified)
crate: modules-crm | status: SAFE | lint: CLEAN
findings: clean parameterized customer queries
next: none | perf: N/A
*/
//! CRM Repository — database persistence for customer profiles.

use crate::error::CrmError;
use crate::models::Customer;
use foundation::{Email, Phone};
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::{Connection, Transaction};

/// The crm module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("crm");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// Database repository for customer records.
///
/// Phase 3 P3.2: reads and writes go through a [`NamespacedStore`] scoped to the
/// `crm` namespace rather than a bare `&Connection`, so every statement is
/// checked against `modules/ownership.json` before it runs. `crm` owns
/// `customers` and declares no foreign read, so its embedded manifest
/// (Phase 4 P4.1) yields no grant.
pub struct CrmRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> CrmRepository<'a> {
    /// Create a new `CrmRepository` over the module's own namespace.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(Store::new(conn), OWNER, Grants::from_manifest_json(OWNER, MANIFEST)),
        }
    }

    /// Retrieve a customer by ID.
    pub fn get_customer(&self, id: &str) -> Result<Option<Customer>, CrmError> {
        let rows = self.ns.own().query(
            "SELECT id, name, email, phone, loyalty_points, total_spent_minor, currency, notes, created_at, updated_at
             FROM customers WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                let email_str: Option<String> = row.get(2)?;
                let email = email_str.and_then(|e| Email::new(e).ok());

                let phone_str: Option<String> = row.get(3)?;
                let phone = phone_str.and_then(|p| Phone::new(p).ok());

                Ok(Customer {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email,
                    phone,
                    loyalty_points: row.get(4)?,
                    total_spent_minor: row.get(5)?,
                    currency: row.get(6)?,
                    notes: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }

    /// Insert a customer inside a transaction.
    pub fn create_customer_tx(
        &self,
        tx: &Transaction,
        customer: &Customer,
    ) -> Result<(), CrmError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // The transaction is a property of the connection, not this handle: a
        // store over the same transaction writes inside it. We build the store
        // from the passed `tx` so the statement is namespace-checked in exactly
        // the same way as `get_customer`.
        let ns = NamespacedStore::new(Store::new(tx), OWNER, Grants::from_manifest_json(OWNER, MANIFEST));
        ns.own().execute(
            "INSERT INTO customers (id, name, email, phone, loyalty_points, total_spent_minor, currency, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                customer.id,
                customer.name,
                customer.email.as_ref().map(|e| e.as_str()),
                customer.phone.as_ref().map(|p| p.as_str()),
                customer.loyalty_points,
                customer.total_spent_minor,
                customer.currency,
                customer.notes,
                if customer.created_at.is_empty() { &now } else { &customer.created_at },
                if customer.updated_at.is_empty() { &now } else { &customer.updated_at },
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
