//! Loyalty program CRUD — points, tiers, redemption.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B1: loyalty deep read; MSL-4 projection fix 25-07-26)
crate: oz-core | status: SAFE | lint: CLEAN
findings: MSL-4 FIXED here — earn_points and redeem_points now maintain customers.loyalty_points as a projection of the authoritative loyalty_accounts balance inside their transactions (single writer; tier-multiplied; redemption-mirrored), so the CRM counter can no longer diverge. Prior verified positives: earn/redeem idempotency via unique projection index + pre-check, tier multiplier math, server-side sale binding, tx-wrapped balance guards
next: none | perf: projection UPDATE is one indexed row per mutation
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::loyalty::{LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction};
use crate::{Currency, format_minor};

use super::Store;

/// Parse a stored currency code for `format_minor`, falling back to USD
/// (exp 2) if the code is somehow malformed — transaction descriptions
/// must never fail to render. Mirrors `export::email_report::format_amount`.
fn parse_currency(code: &str) -> Currency {
    code.parse::<Currency>().unwrap_or(Currency(*b"USD"))
}

/// Fixed conversion: 100 points = 100 minor units ($1.00).
const POINTS_TO_MINOR_RATIO: i64 = 1;

/// Exact points computation (LOYALTY-01): `round_half_up(base ×
/// multiplier_millionths / (100 × 1_000_000))` in i128 — no floats
/// anywhere. The old `(base as f64)/100.0 × multiplier` mis-rounded every
/// product landing on an exact .5 boundary (a $22.50 sale at
/// points_per_unit=1 with a 1.4× tier earned 31 where decimal gives 32).
/// Half-up is defined toward +∞, the house convention shared with
/// `refunds.rs` (CRM-06). Inputs are non-negative in practice (sale
/// totals × positive points_per_unit); the floor-division normalization
/// keeps the rule uniform for any sign.
pub(crate) fn compute_points(base: i64, multiplier_millionths: i64) -> i64 {
    const DEN: i128 = 100 * 1_000_000;
    let num = i128::from(base) * i128::from(multiplier_millionths);
    let mut q = num / DEN;
    let mut r = num % DEN;
    if r < 0 {
        q -= 1;
        r += DEN;
    }
    if r * 2 >= DEN {
        q += 1;
    }
    i64::try_from(q).unwrap_or(i64::MAX)
}

fn validate_tier_config(
    name: &str,
    min_points: i64,
    points_per_unit: i64,
    earn_multiplier_millionths: i64,
    colour: &str,
) -> Result<(), CoreError> {
    if name.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "name",
            message: "tier name must not be empty".into(),
        });
    }
    if min_points < 0 {
        return Err(CoreError::Validation {
            field: "min_points",
            message: "tier threshold must not be negative".into(),
        });
    }
    if points_per_unit <= 0 {
        return Err(CoreError::Validation {
            field: "points_per_unit",
            message: "points per unit must be positive".into(),
        });
    }
    if earn_multiplier_millionths <= 0 {
        return Err(CoreError::Validation {
            field: "earn_multiplier_millionths",
            message: "earn multiplier must be a positive number of millionths".into(),
        });
    }
    let valid_colour = colour.len() == 7
        && colour.starts_with('#')
        && colour[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit());
    if !valid_colour {
        return Err(CoreError::Validation {
            field: "colour",
            message: "colour must be a # followed by six hexadecimal digits".into(),
        });
    }
    Ok(())
}

impl Store<'_> {
    /// Get or create a loyalty account for a customer.
    /// If the account already exists, it is returned as-is.
    /// Otherwise a new account is created with the default tier (Bronze).
    pub fn get_or_create_loyalty_account(
        &self,
        customer_id: &str,
    ) -> Result<LoyaltyAccount, CoreError> {
        // Check if customer exists.
        let customer_exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM customers WHERE id = ?1",
                params![customer_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !customer_exists {
            return Err(CoreError::NotFound {
                entity: "customer",
                id: customer_id.to_owned(),
            });
        }

        // INSERT OR IGNORE makes creation atomic with respect to the
        // UNIQUE(customer_id) constraint. A concurrent caller may win the
        // insert; both callers then read the same canonical account below.
        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT OR IGNORE INTO loyalty_accounts (id, customer_id, tier_id, updated_at, created_at)
             VALUES (?1, ?2, 'tier-bronze', ?3, ?4)",
            params![id, customer_id, now, now],
        )?;

        self.get_loyalty_account_raw(customer_id)?.ok_or_else(|| {
            CoreError::Internal(format!(
                "loyalty account insert was ignored but account {customer_id} was not found"
            ))
        })
    }

    fn get_loyalty_transaction_for_sale(
        &self,
        account_id: &str,
        sale_id: &str,
        txn_type: &str,
    ) -> Result<Option<LoyaltyTransaction>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, sale_id, points, txn_type, description, created_at
             FROM loyalty_transactions
             WHERE account_id = ?1 AND sale_id = ?2 AND txn_type = ?3
             LIMIT 1",
        )?;
        match stmt.query_row(params![account_id, sale_id, txn_type], |row| {
            Ok(LoyaltyTransaction {
                id: row.get("id")?,
                account_id: row.get("account_id")?,
                sale_id: row.get("sale_id")?,
                points: row.get("points")?,
                txn_type: row.get("txn_type")?,
                description: row.get("description")?,
                created_at: row.get("created_at")?,
            })
        }) {
            Ok(transaction) => Ok(Some(transaction)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn get_loyalty_account_raw(
        &self,
        customer_id: &str,
    ) -> Result<Option<LoyaltyAccount>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, customer_id, points, lifetime_points, tier_id, updated_at, created_at
             FROM loyalty_accounts WHERE customer_id = ?1",
        )?;
        let result = stmt.query_row(params![customer_id], |row| {
            Ok(LoyaltyAccount {
                id: row.get("id")?,
                customer_id: row.get("customer_id")?,
                points: row.get("points")?,
                lifetime_points: row.get("lifetime_points")?,
                tier_id: row.get("tier_id")?,
                updated_at: row.get("updated_at")?,
                created_at: row.get("created_at")?,
            })
        });
        match result {
            Ok(a) => Ok(Some(a)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get full loyalty account details for a customer (with tier info and recent transactions).
    pub fn get_loyalty_account(
        &self,
        customer_id: &str,
    ) -> Result<Option<LoyaltyAccountWithDetails>, CoreError> {
        let account = match self.get_loyalty_account_raw(customer_id)? {
            Some(a) => a,
            None => return Ok(None),
        };

        let tier = if let Some(ref tid) = account.tier_id {
            self.get_loyalty_tier(tid)?
        } else {
            None
        };

        let tiers = self.list_tiers()?;
        let next_tier = tiers
            .iter()
            .filter(|t| t.min_points > account.lifetime_points)
            .min_by_key(|t| t.min_points)
            .cloned();

        let points_to_next_tier = next_tier
            .as_ref()
            .map(|t| t.min_points - account.lifetime_points)
            .unwrap_or(0);

        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, sale_id, points, txn_type, description, created_at
             FROM loyalty_transactions WHERE account_id = ?1
             ORDER BY created_at DESC LIMIT 20",
        )?;
        let recent_transactions: Vec<LoyaltyTransaction> = stmt
            .query_map(params![account.id], |row| {
                Ok(LoyaltyTransaction {
                    id: row.get("id")?,
                    account_id: row.get("account_id")?,
                    sale_id: row.get("sale_id")?,
                    points: row.get("points")?,
                    txn_type: row.get("txn_type")?,
                    description: row.get("description")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;

        Ok(Some(LoyaltyAccountWithDetails {
            account,
            tier,
            recent_transactions,
            next_tier,
            points_to_next_tier,
        }))
    }

    /// List all loyalty accounts with details for management.
    pub fn list_loyalty_accounts(&self) -> Result<Vec<LoyaltyAccountWithDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, customer_id, points, lifetime_points, tier_id, updated_at, created_at
             FROM loyalty_accounts ORDER BY lifetime_points DESC",
        )?;
        let accounts: Vec<LoyaltyAccount> = stmt
            .query_map([], |row| {
                Ok(LoyaltyAccount {
                    id: row.get("id")?,
                    customer_id: row.get("customer_id")?,
                    points: row.get("points")?,
                    lifetime_points: row.get("lifetime_points")?,
                    tier_id: row.get("tier_id")?,
                    updated_at: row.get("updated_at")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;

        let tiers = self.list_tiers()?;
        let mut all_tiers = tiers;
        all_tiers.sort_by_key(|t| t.min_points);

        let mut results = Vec::new();
        for account in accounts {
            let tier = account
                .tier_id
                .as_ref()
                .and_then(|tid| all_tiers.iter().find(|t| t.id == *tid))
                .cloned();

            let next_tier = all_tiers
                .iter()
                .filter(|t| t.min_points > account.lifetime_points)
                .min_by_key(|t| t.min_points)
                .cloned();

            let points_to_next_tier = next_tier
                .as_ref()
                .map(|t| t.min_points - account.lifetime_points)
                .unwrap_or(0);

            let mut txn_stmt = self.conn.prepare(
                "SELECT id, account_id, sale_id, points, txn_type, description, created_at
                 FROM loyalty_transactions WHERE account_id = ?1
                 ORDER BY created_at DESC LIMIT 5",
            )?;
            let recent_transactions: Vec<LoyaltyTransaction> = txn_stmt
                .query_map(params![account.id], |row| {
                    Ok(LoyaltyTransaction {
                        id: row.get("id")?,
                        account_id: row.get("account_id")?,
                        sale_id: row.get("sale_id")?,
                        points: row.get("points")?,
                        txn_type: row.get("txn_type")?,
                        description: row.get("description")?,
                        created_at: row.get("created_at")?,
                    })
                })?
                .map(|r| Ok(r?))
                .collect::<Result<Vec<_>, CoreError>>()?;

            results.push(LoyaltyAccountWithDetails {
                account,
                tier,
                recent_transactions,
                next_tier,
                points_to_next_tier,
            });
        }

        Ok(results)
    }

    /// Earn points for a purchase.
    /// points_earned = round_half_up(total_minor * tier.points_per_unit
    ///                               × tier.earn_multiplier_millionths
    ///                               / (100 × 1_000_000))   — exact i128
    ///
    /// Thin transactional wrapper over [`earn_points_with_conn`]; kept for
    /// the standalone IPC path. `Ok(None)` (total too small) maps to the
    /// historical `Validation` error for this public entry point.
    pub fn earn_points(
        &self,
        customer_id: &str,
        sale_id: &str,
        total_minor: i64,
    ) -> Result<LoyaltyTransaction, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        match earn_points_with_conn(&tx, customer_id, sale_id, total_minor) {
            Ok(Some(t)) => {
                tx.commit()?;
                Ok(t)
            }
            Ok(None) => {
                tx.rollback()?;
                Err(CoreError::Validation {
                    field: "total_minor",
                    message: "purchase total too small to earn points".into(),
                })
            }
            Err(e) => {
                tx.rollback()?;
                Err(e)
            }
        }
    }

    /// Redeem points at checkout.
    /// Returns the transaction and the monetary value of redeemed points.
    /// Conversion: 100 points = 100 minor units ($1.00).
    pub fn redeem_points(
        &self,
        customer_id: &str,
        points: i64,
        sale_id: &str,
    ) -> Result<(LoyaltyTransaction, i64), CoreError> {
        let account = match self.get_loyalty_account_raw(customer_id)? {
            Some(a) => a,
            None => {
                return Err(CoreError::NotFound {
                    entity: "loyalty_account",
                    id: customer_id.to_owned(),
                });
            }
        };

        if points <= 0 {
            return Err(CoreError::Validation {
                field: "points",
                message: "points must be positive".into(),
            });
        }

        // Redemption is only valid for the customer's completed sale. The
        // sale lookup is deliberately server-side; callers cannot bind points
        // to an unrelated or still-pending sale.
        let (sale_customer_id, sale_total_minor, sale_status, sale_currency): (
            Option<String>,
            i64,
            String,
            String,
        ) = self
            .conn
            .query_row(
                "SELECT customer_id, total_minor, status, currency FROM sales WHERE id = ?1",
                params![sale_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "sale",
                    id: sale_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        if sale_customer_id.as_deref() != Some(customer_id) {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "sale does not belong to this customer".into(),
            });
        }
        if sale_status != "completed" {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "loyalty points can only be redeemed on a completed sale".into(),
            });
        }
        if sale_total_minor < 0 {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "sale total must not be negative".into(),
            });
        }

        // A retry of the same checkout is idempotent. This check must happen
        // before the balance check below: the first redemption has already
        // reduced the balance, so a retry may no longer have `points` available.
        if let Some(existing) =
            self.get_loyalty_transaction_for_sale(&account.id, sale_id, "redeem")?
        {
            return Ok((existing.clone(), existing.points.saturating_abs()));
        }

        if account.points < points {
            return Err(CoreError::Validation {
                field: "points",
                message: format!(
                    "insufficient points: have {}, requested {}",
                    account.points, points
                ),
            });
        }

        let discount_minor =
            points
                .checked_mul(POINTS_TO_MINOR_RATIO)
                .ok_or_else(|| CoreError::Validation {
                    field: "points",
                    message: "discount value overflowed".into(),
                })?;
        if discount_minor > sale_total_minor {
            return Err(CoreError::Validation {
                field: "points",
                message: "redemption cannot exceed the sale total".into(),
            });
        }

        let txn_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;

        if let Err(error) = tx.execute(
            "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
             VALUES (?1, ?2, ?3, ?4, 'redeem', ?5, ?6)",
            params![
                txn_id,
                account.id,
                sale_id,
                -points,
                format!(
                    "Redeemed {} points for {} discount",
                    points,
                    format_minor(discount_minor, parse_currency(&sale_currency)),
                ),
                now,
            ],
        ) {
            tx.rollback()?;
            if matches!(
                &error,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::ConstraintViolation
            ) {
                return self
                    .get_loyalty_transaction_for_sale(&account.id, sale_id, "redeem")?
                    .map(|existing| {
                        let discount = existing.points.saturating_abs();
                        (existing, discount)
                    })
                    .ok_or_else(|| CoreError::Db(error));
            }
            return Err(error.into());
        }

        let changed = tx.execute(
            "UPDATE loyalty_accounts
             SET points = points - ?1, updated_at = ?2
             WHERE id = ?3 AND points >= ?1",
            params![points, now, account.id],
        )?;
        if changed != 1 {
            tx.rollback()?;
            return Err(CoreError::Validation {
                field: "points",
                message: "insufficient points".into(),
            });
        }

        // MSL-4 fix: mirror the redemption into the customers.loyalty_points
        // projection inside the same transaction (see earn_points).
        tx.execute(
            "UPDATE customers SET loyalty_points =
                (SELECT points FROM loyalty_accounts WHERE customer_id = ?1),
             updated_at = ?2 WHERE id = ?1",
            params![customer_id, now],
        )?;

        tx.commit()?;

        Ok((
            LoyaltyTransaction {
                id: txn_id,
                account_id: account.id,
                sale_id: Some(sale_id.to_owned()),
                points: -points,
                txn_type: "redeem".into(),
                description: format!(
                    "Redeemed {} points for {} discount",
                    points,
                    format_minor(discount_minor, parse_currency(&sale_currency)),
                ),
                created_at: now,
            },
            discount_minor,
        ))
    }

    /// List all loyalty tiers.
    pub fn list_tiers(&self) -> Result<Vec<LoyaltyTier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, min_points, points_per_unit, earn_multiplier_millionths, colour, sort_order, created_at
             FROM loyalty_tiers ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LoyaltyTier {
                id: row.get("id")?,
                name: row.get("name")?,
                min_points: row.get("min_points")?,
                points_per_unit: row.get("points_per_unit")?,
                earn_multiplier_millionths: row.get("earn_multiplier_millionths")?,
                colour: row.get("colour")?,
                sort_order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    fn get_loyalty_tier(&self, id: &str) -> Result<Option<LoyaltyTier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, min_points, points_per_unit, earn_multiplier_millionths, colour, sort_order, created_at
             FROM loyalty_tiers WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(LoyaltyTier {
                id: row.get("id")?,
                name: row.get("name")?,
                min_points: row.get("min_points")?,
                points_per_unit: row.get("points_per_unit")?,
                earn_multiplier_millionths: row.get("earn_multiplier_millionths")?,
                colour: row.get("colour")?,
                sort_order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
            })
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Update a loyalty tier.
    pub fn update_tier(
        &self,
        id: &str,
        name: &str,
        min_points: i64,
        points_per_unit: i64,
        earn_multiplier_millionths: i64,
        colour: &str,
    ) -> Result<LoyaltyTier, CoreError> {
        let tier_exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM loyalty_tiers WHERE id = ?1",
                params![id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !tier_exists {
            return Err(CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            });
        }

        validate_tier_config(
            name,
            min_points,
            points_per_unit,
            earn_multiplier_millionths,
            colour,
        )?;

        let duplicate_threshold: bool = self.conn.query_row(
            "SELECT EXISTS(
                    SELECT 1 FROM loyalty_tiers
                    WHERE id <> ?1 AND min_points = ?2
                )",
            params![id, min_points],
            |row| row.get(0),
        )?;
        if duplicate_threshold {
            return Err(CoreError::Validation {
                field: "min_points",
                message: "tier thresholds must be unique".into(),
            });
        }

        if min_points > 0 {
            let has_zero_threshold: bool = self.conn.query_row(
                "SELECT EXISTS(
                        SELECT 1 FROM loyalty_tiers
                        WHERE id <> ?1 AND min_points = 0
                    )",
                params![id],
                |row| row.get(0),
            )?;
            if !has_zero_threshold {
                return Err(CoreError::Validation {
                    field: "min_points",
                    message: "at least one tier must start at zero points".into(),
                });
            }
        }

        let rows = self.conn.execute(
            "UPDATE loyalty_tiers SET name = ?1, min_points = ?2, points_per_unit = ?3,
             earn_multiplier_millionths = ?4, colour = ?5 WHERE id = ?6",
            params![
                name,
                min_points,
                points_per_unit,
                earn_multiplier_millionths,
                colour,
                id
            ],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            });
        }

        self.get_loyalty_tier(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            })
    }

    /// Convert points to monetary value (minor units).
    pub fn get_points_value(&self, points: i64) -> Result<i64, CoreError> {
        if points < 0 {
            return Err(CoreError::Validation {
                field: "points",
                message: "points must not be negative".into(),
            });
        }
        points
            .checked_mul(POINTS_TO_MINOR_RATIO)
            .ok_or_else(|| CoreError::Validation {
                field: "points",
                message: "points value overflowed".into(),
            })
    }
}

/// Fetch the `earn` ledger row for a sale, if any (idempotency lookup).
fn fetch_earn_txn(
    conn: &rusqlite::Connection,
    account_id: &str,
    sale_id: &str,
) -> Result<Option<LoyaltyTransaction>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, sale_id, points, txn_type, description, created_at
         FROM loyalty_transactions
         WHERE account_id = ?1 AND sale_id = ?2 AND txn_type = 'earn'
         LIMIT 1",
    )?;
    let result = stmt.query_row(params![account_id, sale_id], |row| {
        Ok(LoyaltyTransaction {
            id: row.get("id")?,
            account_id: row.get("account_id")?,
            sale_id: row.get("sale_id")?,
            points: row.get("points")?,
            txn_type: row.get("txn_type")?,
            description: row.get("description")?,
            created_at: row.get("created_at")?,
        })
    });
    match result {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Connection-bound core of [`Store::earn_points`] (LOY-06).
///
/// Takes an explicit `&Connection` so a caller's in-flight transaction is
/// joined (rusqlite transactions borrow the connection `&self`; statements
/// on that same connection execute inside the open transaction). This is
/// what lets the sale-completion paths award points *atomically* with the
/// status transition — no orphaned award if the process dies mid-sale, no
/// missing award if the UI never gets to call a separate IPC.
///
/// Returns `Ok(None)` when the total is too small to earn any points —
/// completion-path callers treat that as a silent skip, while the public
/// [`Store::earn_points`] maps it to a `Validation` error.
///
/// Idempotent per sale: `SaleCompleted` can be delivered more than once
/// during retries or recovery, so a replay returns the original ledger row
/// instead of awarding again; the unique projection index (migration 128)
/// is the final concurrency guard.
pub(crate) fn earn_points_with_conn(
    conn: &rusqlite::Connection,
    customer_id: &str,
    sale_id: &str,
    total_minor: i64,
) -> Result<Option<LoyaltyTransaction>, CoreError> {
    // The account must belong to a real customer.
    let customer_exists: bool = conn
        .query_row(
            "SELECT 1 FROM customers WHERE id = ?1",
            params![customer_id],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !customer_exists {
        return Err(CoreError::NotFound {
            entity: "customer",
            id: customer_id.to_owned(),
        });
    }

    // Get-or-create the account. INSERT OR IGNORE is atomic with respect
    // to the UNIQUE(customer_id) constraint; concurrent callers then read
    // the same canonical account below.
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "INSERT OR IGNORE INTO loyalty_accounts (id, customer_id, tier_id, updated_at, created_at)
         VALUES (?1, ?2, 'tier-bronze', ?3, ?4)",
        params![uuid::Uuid::now_v7().to_string(), customer_id, now, now],
    )?;
    let account: LoyaltyAccount = conn.query_row(
        "SELECT id, customer_id, points, lifetime_points, tier_id, updated_at, created_at
         FROM loyalty_accounts WHERE customer_id = ?1",
        params![customer_id],
        |row| {
            Ok(LoyaltyAccount {
                id: row.get("id")?,
                customer_id: row.get("customer_id")?,
                points: row.get("points")?,
                lifetime_points: row.get("lifetime_points")?,
                tier_id: row.get("tier_id")?,
                updated_at: row.get("updated_at")?,
                created_at: row.get("created_at")?,
            })
        },
    )?;

    // Replay guard: return the original award, never a second one.
    if let Some(existing) = fetch_earn_txn(conn, &account.id, sale_id)? {
        return Ok(Some(existing));
    }

    // Tier formula (LOYALTY-01): exact integer arithmetic via
    // [`compute_points`] — the multiplier is fixed-point millionths, so
    // no float ever touches points. (The old f64 path mis-rounded every
    // exact .5 boundary.)
    let tier = account
        .tier_id
        .as_deref()
        .and_then(|tid| {
            conn.query_row(
                "SELECT points_per_unit, earn_multiplier_millionths FROM loyalty_tiers WHERE id = ?1",
                params![tid],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok()
        })
        .unwrap_or((10, 1_000_000));
    let base = total_minor.saturating_mul(tier.0);
    let points = compute_points(base, tier.1);
    if points <= 0 {
        return Ok(None);
    }

    let txn_id = uuid::Uuid::now_v7().to_string();
    let description = format!("Earned {points} points from purchase");
    if let Err(error) = conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES (?1, ?2, ?3, ?4, 'earn', ?5, ?6)",
        params![txn_id, account.id, sale_id, points, description, now],
    ) {
        if matches!(
            &error,
            rusqlite::Error::SqliteFailure(code, _)
                if code.code == rusqlite::ErrorCode::ConstraintViolation
        ) {
            // A concurrent replay lost the unique-index race: hand back
            // the winning row (statement-level auto-rollback keeps the
            // caller's transaction usable).
            let winner = fetch_earn_txn(conn, &account.id, sale_id)?;
            return match winner {
                Some(t) => Ok(Some(t)),
                None => Err(CoreError::Db(error)),
            };
        }
        return Err(error.into());
    }

    conn.execute(
        "UPDATE loyalty_accounts SET points = points + ?1, lifetime_points = lifetime_points + ?1,
         tier_id = (SELECT id FROM loyalty_tiers WHERE min_points <= lifetime_points + ?1
                    ORDER BY min_points DESC LIMIT 1),
         updated_at = ?2 WHERE id = ?3",
        params![points, now, account.id],
    )?;

    // MSL-4: maintain `customers.loyalty_points` as a projection of the
    // authoritative ledger balance, inside the same transaction.
    conn.execute(
        "UPDATE customers SET loyalty_points =
            (SELECT points FROM loyalty_accounts WHERE customer_id = ?1),
         updated_at = ?2 WHERE id = ?1",
        params![customer_id, now],
    )?;

    Ok(Some(LoyaltyTransaction {
        id: txn_id,
        account_id: account.id,
        sale_id: Some(sale_id.to_owned()),
        points,
        txn_type: "earn".into(),
        description,
        created_at: now,
    }))
}

/// LOY-03: proportionally reverse a sale's loyalty award on refund.
///
/// Deducts `round(award_points × refund_total / sale_total)`, capped at
/// the not-yet-reversed remainder of the award, so cumulative refunds
/// can never claw back more than was earned. The ledger row stores the
/// full proportional deduction (negative points, type
/// `'refund_reversal'` — same sign convention as `'redeem'`), while the
/// account balance floors at zero: points already spent are not dragged
/// negative. Lifetime points drop with it, so tier demotion recomputes
/// naturally.
///
/// Idempotent per refund: the deterministic primary key
/// (`loyalty-reversal-<refund_id>`) turns a retry into a no-op.
///
/// Runs on the CALLER's connection/transaction — like
/// [`earn_points_with_conn`] this must commit or roll back atomically
/// with the refund row itself.
pub(crate) fn reverse_loyalty_on_refund(
    conn: &rusqlite::Connection,
    sale_id: &str,
    refund_id: &str,
    refund_total_minor: i64,
    sale_total_minor: i64,
) -> Result<Option<LoyaltyTransaction>, CoreError> {
    // The award to reverse (LOY-06 wrote exactly one 'earn' row per sale).
    let earn: Option<(String, i64)> = conn
        .query_row(
            "SELECT account_id, points FROM loyalty_transactions
             WHERE sale_id = ?1 AND txn_type = 'earn'
             ORDER BY created_at ASC LIMIT 1",
            params![sale_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let Some((account_id, earned_points)) = earn else {
        // Legacy sale predating LOY-06 awarding, or a sale that earned nothing.
        return Ok(None);
    };

    // Cumulative cap: never reverse more than the award.
    let already_reversed: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(-points), 0) FROM loyalty_transactions
             WHERE sale_id = ?1 AND txn_type = 'refund_reversal'",
            params![sale_id],
            |row| row.get(0),
        )
        .map_err(CoreError::Db)?;
    let headroom = earned_points - already_reversed;
    // Integer round-half-up in i128 — the same no-floats-on-money
    // arithmetic as the CRM-06 base-currency conversion in refunds.rs.
    // (f64 would silently quantize beyond 2^53 and diverge from the
    // house policy that points, like money, never touch a float.)
    let proportional = if sale_total_minor > 0 && refund_total_minor > 0 {
        let num = i128::from(earned_points) * i128::from(refund_total_minor);
        let den = i128::from(sale_total_minor);
        ((num * 2 + den) / (den * 2)) as i64
    } else {
        0
    };
    let deduct = proportional.min(headroom).max(0);
    if deduct <= 0 {
        return Ok(None);
    }

    let txn_id = format!("loyalty-reversal-{refund_id}");
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let description = format!("Reversed {deduct} points for refund on sale");
    match conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES (?1, ?2, ?3, ?4, 'refund_reversal', ?5, ?6)",
        params![txn_id, account_id, sale_id, -deduct, description, now],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(ref code, _))
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // Replay of the same refund id: the first reversal stands.
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    }

    // Balance floors at zero; lifetime drops and the tier recomputes.
    conn.execute(
        "UPDATE loyalty_accounts
         SET points = MAX(points - ?1, 0),
             lifetime_points = MAX(lifetime_points - ?1, 0),
             tier_id = COALESCE((SELECT id FROM loyalty_tiers
                                 WHERE min_points <= MAX(lifetime_points - ?1, 0)
                                 ORDER BY min_points DESC LIMIT 1), tier_id),
             updated_at = ?2
         WHERE id = ?3",
        params![deduct, now, account_id],
    )?;

    // MSL-4: keep the customers.loyalty_points projection in step.
    conn.execute(
        "UPDATE customers SET loyalty_points =
            (SELECT points FROM loyalty_accounts WHERE id = ?1),
         updated_at = ?2 WHERE id = (SELECT customer_id FROM loyalty_accounts WHERE id = ?1)",
        params![account_id, now],
    )?;

    Ok(Some(LoyaltyTransaction {
        id: txn_id,
        account_id,
        sale_id: Some(sale_id.to_owned()),
        points: -deduct,
        txn_type: "refund_reversal".into(),
        description,
        created_at: now,
    }))
}

#[cfg(test)]
#[path = "loyalty_tests.rs"]
mod tests;
