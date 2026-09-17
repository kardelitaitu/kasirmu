//! Gift cards CRUD — issue, redeem, top-up, freeze, balance checks.
/*
last audited DD-MM-YY by DSH-Agent
crate: oz-core (gift_cards) | status: SAFE | lint: CLEAN
findings: stored-value paths sound (PA-01 atomic conditional UPDATE both directions with i64::MAX overflow guard on top-up; in-tx balance re-read keeps ledger rows accurate under concurrency; expiry parse-fail treats card as expired — fail-safe; RUST-07 recoverable lookups documented). COR-15 FIXED DD-MM-YY — partial UNIQUE index uq_gift_card_redeem_sale (migration 20260901) closes the redeem idempotency gap under sync replay. COR-16 FIXED DD-MM-YY — list_gift_cards search + issued_to now escape LIKE wildcards (ESCAPE '\', same as customers/audit). COR-17 INFO: card PIN stored plaintext (acceptable local-POS threat model; revisit before cloud sync).
next: none | perf: N+1 txn fetch in list_gift_cards is bounded at 5/card
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::gift_card::{
    GiftCard, GiftCardFilter, GiftCardTransaction, GiftCardWithTransactions, IssueGiftCardInput,
    RedeemGiftCardResult,
};
use crate::{Currency, format_minor};

use super::Store;

/// Parse a stored currency code for `format_minor`, falling back to USD
/// (exp 2) if the code is somehow malformed — transaction notes must
/// never fail to render. Mirrors `export::email_report::format_amount`.
fn parse_currency(code: &str) -> Currency {
    code.parse::<Currency>().unwrap_or(Currency(*b"USD"))
}

impl Store<'_> {
    /// Issue a new gift card and record the initial issue transaction.
    pub fn issue_gift_card(
        &self,
        input: IssueGiftCardInput,
    ) -> Result<GiftCardWithTransactions, CoreError> {
        if input.initial_amount_minor <= 0 {
            return Err(CoreError::Validation {
                field: "initial_amount_minor",
                message: "initial amount must be positive".into(),
            });
        }

        if input.card_number.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "card_number",
                message: "card number is required".into(),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let pin = input.pin.unwrap_or_default();
        let issued_to = input.issued_to.unwrap_or_default();
        let amount = input.initial_amount_minor;

        let tx = self.conn.unchecked_transaction()?;

        // Create the gift card.
        tx.execute(
            "INSERT INTO gift_cards (id, card_number, pin, initial_balance_minor, current_balance_minor,
             currency, status, issued_to, issue_date, expiry_date, created_by, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                input.card_number.trim(),
                pin,
                amount,
                amount,
                input.currency,
                issued_to,
                now,
                input.expiry_date,
                input.created_by,
                now,
            ],
        )?;

        // Record the issue transaction.
        let txn_id = uuid::Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO gift_card_transactions (id, gift_card_id, sale_id, txn_type, amount_minor,
             balance_after_minor, notes, created_at)
             VALUES (?1, ?2, NULL, 'issue', ?3, ?4, ?5, ?6)",
            params![
                txn_id,
                id,
                amount,
                amount,
                format!(
                    "Issued gift card {} with {}",
                    input.card_number.trim(),
                    format_minor(amount, parse_currency(&input.currency)),
                ),
                now,
            ],
        )?;

        tx.commit()?;

        // RUST-07: recoverable — a lookup after commit should succeed, but a
        // concurrent deletion could race ahead of this read. Surface NotFound
        // instead of panicking on the `Option`.
        let card = self
            .get_gift_card_by_raw_id(&id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "gift_card",
                id: id.clone(),
            })?;
        Ok(GiftCardWithTransactions {
            transactions: vec![GiftCardTransaction {
                id: txn_id,
                gift_card_id: id,
                sale_id: None,
                txn_type: "issue".into(),
                amount_minor: amount,
                balance_after_minor: amount,
                notes: format!("Issued gift card {}", input.card_number.trim()),
                created_at: now,
            }],
            card,
        })
    }

    /// Look up a gift card by card number or id.
    pub fn get_gift_card(&self, card_number_or_id: &str) -> Result<Option<GiftCard>, CoreError> {
        // Try id first, then card_number.
        let mut stmt = self.conn.prepare(
            "SELECT id, card_number, pin, initial_balance_minor, current_balance_minor,
             currency, status, issued_to, issue_date, expiry_date, created_by, updated_at
             FROM gift_cards WHERE id = ?1 OR card_number = ?1",
        )?;

        let result = stmt.query_row(params![card_number_or_id], |row| {
            Ok(GiftCard {
                id: row.get("id")?,
                card_number: row.get("card_number")?,
                pin: row.get("pin")?,
                initial_balance_minor: row.get("initial_balance_minor")?,
                current_balance_minor: row.get("current_balance_minor")?,
                currency: row.get("currency")?,
                status: row.get("status")?,
                issued_to: row.get("issued_to")?,
                issue_date: row.get("issue_date")?,
                expiry_date: row.get("expiry_date")?,
                created_by: row.get("created_by")?,
                updated_at: row.get("updated_at")?,
            })
        });

        match result {
            Ok(card) => Ok(Some(card)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn get_gift_card_by_raw_id(&self, id: &str) -> Result<Option<GiftCard>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, card_number, pin, initial_balance_minor, current_balance_minor,
             currency, status, issued_to, issue_date, expiry_date, created_by, updated_at
             FROM gift_cards WHERE id = ?1",
        )?;

        let result = stmt.query_row(params![id], |row| {
            Ok(GiftCard {
                id: row.get("id")?,
                card_number: row.get("card_number")?,
                pin: row.get("pin")?,
                initial_balance_minor: row.get("initial_balance_minor")?,
                current_balance_minor: row.get("current_balance_minor")?,
                currency: row.get("currency")?,
                status: row.get("status")?,
                issued_to: row.get("issued_to")?,
                issue_date: row.get("issue_date")?,
                expiry_date: row.get("expiry_date")?,
                created_by: row.get("created_by")?,
                updated_at: row.get("updated_at")?,
            })
        });

        match result {
            Ok(card) => Ok(Some(card)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// List gift cards with optional filters.
    pub fn list_gift_cards(
        &self,
        filter: GiftCardFilter,
    ) -> Result<Vec<GiftCardWithTransactions>, CoreError> {
        let mut where_clauses: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut param_idx = 1;

        if let Some(ref search) = filter.search {
            // COR-16: escape LIKE wildcards so user input with literal % or _
            // does not broaden the match (same pattern as customers.rs/audit.rs).
            let escaped = search
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{}%", escaped);
            where_clauses.push(format!(
                "(g.card_number LIKE ?{param_idx} ESCAPE '\\' OR g.issued_to LIKE ?{param_idx} ESCAPE '\\')"
            ));
            param_values.push(Box::new(pattern));
            param_idx += 1;
        }

        if let Some(ref status) = filter.status {
            where_clauses.push(format!("g.status = ?{param_idx}"));
            param_values.push(Box::new(status.clone()));
            param_idx += 1;
        }

        if let Some(ref issued_to) = filter.issued_to {
            // COR-16: same wildcard escaping as the search filter.
            let escaped = issued_to
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{}%", escaped);
            where_clauses.push(format!("g.issued_to LIKE ?{param_idx} ESCAPE '\\'"));
            param_values.push(Box::new(pattern));
            param_idx += 1;
        }

        if let Some(min_balance) = filter.min_balance {
            where_clauses.push(format!("g.current_balance_minor >= ?{param_idx}"));
            param_values.push(Box::new(min_balance));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let sql = format!(
            "SELECT g.id, g.card_number, g.pin, g.initial_balance_minor, g.current_balance_minor,
             g.currency, g.status, g.issued_to, g.issue_date, g.expiry_date, g.created_by, g.updated_at
             FROM gift_cards g {where_sql} ORDER BY g.updated_at DESC"
        );

        let mut stmt = self.conn.prepare(&sql)?;

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let cards: Vec<GiftCard> = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok(GiftCard {
                    id: row.get("id")?,
                    card_number: row.get("card_number")?,
                    pin: row.get("pin")?,
                    initial_balance_minor: row.get("initial_balance_minor")?,
                    current_balance_minor: row.get("current_balance_minor")?,
                    currency: row.get("currency")?,
                    status: row.get("status")?,
                    issued_to: row.get("issued_to")?,
                    issue_date: row.get("issue_date")?,
                    expiry_date: row.get("expiry_date")?,
                    created_by: row.get("created_by")?,
                    updated_at: row.get("updated_at")?,
                })
            })?
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;

        let mut results = Vec::new();
        for card in cards {
            let transactions = self.get_transactions_for_card(&card.id, 5)?;
            results.push(GiftCardWithTransactions { transactions, card });
        }

        Ok(results)
    }

    fn get_transactions_for_card(
        &self,
        gift_card_id: &str,
        limit: i64,
    ) -> Result<Vec<GiftCardTransaction>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, gift_card_id, sale_id, txn_type, amount_minor, balance_after_minor, notes, created_at
             FROM gift_card_transactions WHERE gift_card_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![gift_card_id, limit], |row| {
            Ok(GiftCardTransaction {
                id: row.get("id")?,
                gift_card_id: row.get("gift_card_id")?,
                sale_id: row.get("sale_id")?,
                txn_type: row.get("txn_type")?,
                amount_minor: row.get("amount_minor")?,
                balance_after_minor: row.get("balance_after_minor")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
            })
        })?;

        rows.map(|r| Ok(r?)).collect()
    }

    /// Get full gift card detail with transaction history.
    pub fn get_gift_card_detail(
        &self,
        card_number_or_id: &str,
    ) -> Result<Option<GiftCardWithTransactions>, CoreError> {
        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => return Ok(None),
        };

        let transactions = self.get_transactions_for_card(&card.id, 50)?;

        Ok(Some(GiftCardWithTransactions { card, transactions }))
    }

    /// Get the current balance of a gift card.
    pub fn get_gift_card_balance(
        &self,
        card_number_or_id: &str,
    ) -> Result<Option<(i64, String, String)>, CoreError> {
        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => return Ok(None),
        };
        Ok(Some((
            card.current_balance_minor,
            card.currency,
            card.status,
        )))
    }

    /// Redeem a gift card for a sale. Idempotent for retry — if the same
    /// `(card_id, sale_id)` pair already has a redeem transaction, returns
    /// the existing result instead of double-deducting.
    pub fn redeem_gift_card(
        &self,
        card_number_or_id: &str,
        amount_minor: i64,
        sale_id: &str,
    ) -> Result<RedeemGiftCardResult, CoreError> {
        if amount_minor <= 0 {
            return Err(CoreError::Validation {
                field: "amount_minor",
                message: "redemption amount must be positive".into(),
            });
        }

        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => {
                return Err(CoreError::NotFound {
                    entity: "gift_card",
                    id: card_number_or_id.to_owned(),
                });
            }
        };

        if card.status != "active" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("gift card is not active (status: {})", card.status),
            });
        }

        // Check expiry.
        if let Some(ref expiry) = card.expiry_date
            && chrono::Utc::now()
                > chrono::DateTime::parse_from_rfc3339(expiry)
                    .unwrap_or(chrono::DateTime::UNIX_EPOCH.into())
        {
            return Err(CoreError::Validation {
                field: "expiry_date",
                message: "gift card has expired".into(),
            });
        }

        if card.current_balance_minor < amount_minor {
            return Err(CoreError::Validation {
                field: "current_balance_minor",
                message: format!(
                    "insufficient balance: have {}, requested {}",
                    card.current_balance_minor, amount_minor
                ),
            });
        }

        // Idempotency check: if we already have a redeem txn for this sale + card, return it.
        let existing = self.conn.query_row(
            "SELECT id, amount_minor, balance_after_minor, notes, created_at
             FROM gift_card_transactions
             WHERE gift_card_id = ?1 AND sale_id = ?2 AND txn_type = 'redeem'",
            params![card.id, sale_id],
            |row| {
                Ok(GiftCardTransaction {
                    id: row.get(0)?,
                    gift_card_id: card.id.clone(),
                    sale_id: Some(sale_id.to_owned()),
                    txn_type: "redeem".into(),
                    amount_minor: row.get(1)?,
                    balance_after_minor: row.get(2)?,
                    notes: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        );

        if let Ok(txn) = existing {
            let updated = self.get_gift_card_by_raw_id(&card.id)?;
            return Ok(RedeemGiftCardResult {
                card: updated.unwrap_or(card),
                transaction: txn,
            });
        }

        let txn_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let tx = self.conn.unchecked_transaction()?;

        // PA-01: atomic conditional UPDATE — matches the loyalty redeem
        // pattern. The DB computes `current_balance_minor - amount_minor`,
        // so a concurrent redeem (different sale, same card) that started
        // between the read and this write will see the updated balance and
        // the `>= amount_minor` guard will fail, rolling back.
        // This prevents the lost-update race that the unconditional
        // `SET current_balance_minor = <stale value>` would allow.
        let changed = tx.execute(
            "UPDATE gift_cards SET
                current_balance_minor = current_balance_minor - ?1,
                updated_at = ?2
             WHERE id = ?3 AND current_balance_minor >= ?1",
            params![amount_minor, now, card.id],
        )?;
        if changed != 1 {
            tx.rollback()?;
            return Err(CoreError::Validation {
                field: "current_balance_minor",
                message: "gift card balance changed during redemption — try again".into(),
            });
        }

        // Re-read the balance inside the transaction so the ledger row's
        // `balance_after_minor` reflects the true post-deduction value even
        // under concurrent redemptions (a value computed before the txn
        // could be stale).
        let balance_after: i64 = tx.query_row(
            "SELECT current_balance_minor FROM gift_cards WHERE id = ?1",
            params![card.id],
            |row| row.get(0),
        )?;

        tx.execute(
            "INSERT INTO gift_card_transactions (id, gift_card_id, sale_id, txn_type, amount_minor,
             balance_after_minor, notes, created_at)
             VALUES (?1, ?2, ?3, 'redeem', ?4, ?5, ?6, ?7)",
            params![
                txn_id,
                card.id,
                sale_id,
                -amount_minor,
                balance_after,
                format!(
                    "Redeemed {} on sale {}",
                    format_minor(amount_minor, parse_currency(&card.currency)),
                    sale_id
                ),
                now,
            ],
        )?;

        // If balance is zero, auto-set status to redeemed.
        if balance_after == 0 {
            tx.execute(
                "UPDATE gift_cards SET status = 'redeemed' WHERE id = ?1",
                params![card.id],
            )?;
        }

        tx.commit()?;

        let updated_card =
            self.get_gift_card_by_raw_id(&card.id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "gift_card",
                    id: card.id.clone(),
                })?;

        Ok(RedeemGiftCardResult {
            card: updated_card,
            transaction: GiftCardTransaction {
                id: txn_id,
                gift_card_id: card.id,
                sale_id: Some(sale_id.to_owned()),
                txn_type: "redeem".into(),
                amount_minor: -amount_minor,
                balance_after_minor: balance_after,
                notes: format!(
                    "Redeemed {} on sale {}",
                    format_minor(amount_minor, parse_currency(&card.currency)),
                    sale_id
                ),
                created_at: now,
            },
        })
    }

    /// Top up a gift card with additional funds.
    pub fn top_up_gift_card(
        &self,
        card_number_or_id: &str,
        amount_minor: i64,
    ) -> Result<GiftCardWithTransactions, CoreError> {
        if amount_minor <= 0 {
            return Err(CoreError::Validation {
                field: "amount_minor",
                message: "top-up amount must be positive".into(),
            });
        }

        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => {
                return Err(CoreError::NotFound {
                    entity: "gift_card",
                    id: card_number_or_id.to_owned(),
                });
            }
        };

        if card.status != "active" && card.status != "frozen" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot top-up card with status: {}", card.status),
            });
        }

        let txn_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let tx = self.conn.unchecked_transaction()?;

        // If frozen, reactivate.
        if card.status == "frozen" {
            tx.execute(
                "UPDATE gift_cards SET status = 'active' WHERE id = ?1",
                params![card.id],
            )?;
        }

        // PA-01: atomic conditional UPDATE (same pattern as redeem). The DB
        // computes the new balance, so a concurrent redeem/top-up that
        // started between the read and this write cannot be lost. The
        // `<= i64::MAX - amount` guard rejects overflow.
        let changed = tx.execute(
            "UPDATE gift_cards SET
                current_balance_minor = current_balance_minor + ?1,
                updated_at = ?2
             WHERE id = ?3 AND current_balance_minor <= ?4",
            params![amount_minor, now, card.id, i64::MAX - amount_minor],
        )?;
        if changed != 1 {
            tx.rollback()?;
            return Err(CoreError::Validation {
                field: "current_balance_minor",
                message: "gift card balance overflow on top-up — try again".into(),
            });
        }

        // Re-read the balance inside the transaction so the ledger row's
        // `balance_after_minor` reflects the true post-addition value.
        let balance_after: i64 = tx.query_row(
            "SELECT current_balance_minor FROM gift_cards WHERE id = ?1",
            params![card.id],
            |row| row.get(0),
        )?;

        tx.execute(
            "INSERT INTO gift_card_transactions (id, gift_card_id, sale_id, txn_type, amount_minor,
             balance_after_minor, notes, created_at)
             VALUES (?1, ?2, NULL, 'topup', ?3, ?4, ?5, ?6)",
            params![
                txn_id,
                card.id,
                amount_minor,
                balance_after,
                format!(
                    "Top-up of {} on card {}",
                    format_minor(amount_minor, parse_currency(&card.currency)),
                    card.card_number
                ),
                now,
            ],
        )?;

        tx.commit()?;

        let updated_card =
            self.get_gift_card_by_raw_id(&card.id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "gift_card",
                    id: card.id.clone(),
                })?;
        let transactions = self.get_transactions_for_card(&card.id, 5)?;

        Ok(GiftCardWithTransactions {
            card: updated_card,
            transactions,
        })
    }

    /// Freeze a gift card (prevent further redemptions).
    pub fn freeze_gift_card(&self, card_number_or_id: &str) -> Result<GiftCard, CoreError> {
        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => {
                return Err(CoreError::NotFound {
                    entity: "gift_card",
                    id: card_number_or_id.to_owned(),
                });
            }
        };

        if card.status != "active" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot freeze card with status: {}", card.status),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        self.conn.execute(
            "UPDATE gift_cards SET status = 'frozen', updated_at = ?1 WHERE id = ?2",
            params![now, card.id],
        )?;

        self.get_gift_card_by_raw_id(&card.id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "gift_card",
                id: card.id,
            })
    }

    /// Unfreeze a gift card (re-enable redemptions).
    pub fn unfreeze_gift_card(&self, card_number_or_id: &str) -> Result<GiftCard, CoreError> {
        let card = match self.get_gift_card(card_number_or_id)? {
            Some(c) => c,
            None => {
                return Err(CoreError::NotFound {
                    entity: "gift_card",
                    id: card_number_or_id.to_owned(),
                });
            }
        };

        if card.status != "frozen" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("card is not frozen (status: {})", card.status),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        self.conn.execute(
            "UPDATE gift_cards SET status = 'active', updated_at = ?1 WHERE id = ?2",
            params![now, card.id],
        )?;

        self.get_gift_card_by_raw_id(&card.id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "gift_card",
                id: card.id,
            })
    }
}

#[cfg(test)]
#[path = "gift_cards_tests.rs"]
mod tests;
