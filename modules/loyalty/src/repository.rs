/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: repository verified)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: clean parameterized loyalty/gift-card read queries
next: none | perf: N/A
*/
//! Loyalty & Gift Card Repository — database persistence layer.

use crate::error::LoyaltyError;
use crate::models::{GiftCard, LoyaltyAccount};
use rusqlite::{Connection, params};

/// Database access repository for loyalty accounts and gift cards.
pub struct LoyaltyRepository<'a> {
    conn: &'a Connection,
}

impl<'a> LoyaltyRepository<'a> {
    /// Create a new `LoyaltyRepository`.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Retrieve loyalty account by customer ID.
    pub fn get_account_by_customer(
        &self,
        customer_id: &str,
    ) -> Result<Option<LoyaltyAccount>, LoyaltyError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, customer_id, points, lifetime_points, tier_id, updated_at, created_at
             FROM loyalty_accounts WHERE customer_id = ?1",
        )?;

        let mut rows = stmt.query(params![customer_id])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        Ok(Some(LoyaltyAccount {
            id: row.get(0)?,
            customer_id: row.get(1)?,
            points: row.get(2)?,
            lifetime_points: row.get(3)?,
            tier_id: row.get(4)?,
            updated_at: row.get(5)?,
            created_at: row.get(6)?,
        }))
    }

    /// Retrieve gift card by card number.
    pub fn get_gift_card_by_number(
        &self,
        card_number: &str,
    ) -> Result<Option<GiftCard>, LoyaltyError> {
        // namespace: cross-vertical read gift_cards granted (loyalty redeems gift cards but giftcards owns the table; Phase 4 replaces this with a store read API)
        let mut stmt = self.conn.prepare(
            "SELECT id, card_number, initial_balance_minor, current_balance_minor, currency, status, issued_to, issue_date, expiry_date, created_by, updated_at
             FROM gift_cards WHERE card_number = ?1",
        )?;

        let mut rows = stmt.query(params![card_number])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        Ok(Some(GiftCard {
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
        }))
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
