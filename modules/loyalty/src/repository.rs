/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: repository verified)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: clean parameterized loyalty/gift-card read queries
next: none | perf: N/A
*/
//! Loyalty & Gift Card Repository — database persistence layer.

use crate::error::LoyaltyError;
use crate::models::{GiftCard, LoyaltyAccount};
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::Connection;

/// The loyalty module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("loyalty");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// The module whose table loyalty reads across the vertical seam (P3.3).
/// Kept as a named constant for the read handle; the grant itself comes from
/// the embedded manifest (Phase 4 P4.1).
const GIFTCARDS: ModuleId = ModuleId("giftcards");

/// Database access repository for loyalty accounts and gift cards.
///
/// Phase 3 P3.2/P3.3, tightened in Phase 4 P4.1: reaches the database through a
/// [`NamespacedStore`] scoped to the `loyalty` namespace. `loyalty_accounts` is
/// its own table, so its read goes through `ns.own()`; `gift_cards` belongs to
/// the `giftcards` module, so that read goes through a granted
/// [`read`](NamespacedStore::read) handle in the `ReadOnly` posture. The grant
/// set is derived from the embedded manifest, so a code-level grant the
/// manifest does not declare (or a missing one it does) cannot drift:
/// `giftcards` is in `capabilities` and `dependencies`.
pub struct LoyaltyRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> LoyaltyRepository<'a> {
    /// Create a new `LoyaltyRepository` over the module's own namespace.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(Store::new(conn), OWNER, Grants::from_manifest_json(OWNER, MANIFEST)),
        }
    }

    /// Retrieve loyalty account by customer ID.
    pub fn get_account_by_customer(
        &self,
        customer_id: &str,
    ) -> Result<Option<LoyaltyAccount>, LoyaltyError> {
        let rows = self.ns.own().query_try(
            "SELECT id, customer_id, points, lifetime_points, tier_id, updated_at, created_at
             FROM loyalty_accounts WHERE customer_id = ?1",
            rusqlite::params![customer_id],
            |row| -> Result<LoyaltyAccount, LoyaltyError> {
                Ok(LoyaltyAccount {
                    id: row.get(0)?,
                    customer_id: row.get(1)?,
                    points: row.get(2)?,
                    lifetime_points: row.get(3)?,
                    tier_id: row.get(4)?,
                    updated_at: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }

    /// Retrieve gift card by card number.
    pub fn get_gift_card_by_number(
        &self,
        card_number: &str,
    ) -> Result<Option<GiftCard>, LoyaltyError> {
        // namespace: cross-vertical read gift_cards granted (loyalty redeems gift cards but giftcards owns the table; Phase 4 replaces this with a store read API)
        let rows = self.ns.read(GIFTCARDS)?.query_try(
            "SELECT id, card_number, initial_balance_minor, current_balance_minor, currency, status, issued_to, issue_date, expiry_date, created_by, updated_at
             FROM gift_cards WHERE card_number = ?1",
            rusqlite::params![card_number],
            |row| -> Result<GiftCard, LoyaltyError> {
                Ok(GiftCard {
                    id: row.get(0)?,
                    card_number: row.get(1)?,
                    initial_balance_minor: row.get(2)?,
                    current_balance_minor: row.get(3)?,
                    currency: row.get(4)?,
                    status: row.get(5)?,
                    issued_to: row.get(6)?,
                    issue_date: row.get(7)?,
                    expiry_date: row.get(8)?,
                    created_by: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
