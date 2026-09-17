//! Promotion CRUD — list, get, create, update, delete, and application recording.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean CRUD; update_promotion validates only the name while create also validates promo_type/value_minor/min_order_minor (COR-12-class asymmetry, INFO); window query uses SQLite strftime now()
next: extend update validation | perf: N/A
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::sale::Sale;
use crate::{Promotion, PromotionApplication};

use super::Store;

/// Validate a promotion before it reaches the database (create and
/// update — the previous create-only, name-only asymmetry was COR-12
/// class). Rules (PROMO-8):
/// - `name` must not be blank; `promo_type` must parse as a
///   [`PromotionType`]
/// - `value_minor` must not be negative; for `percentage` and
///   `buy_x_get_y` it is a percent and must be `1..=100`
/// - `min_order_minor` must not be negative
/// - `buy_x_get_y` requires a non-empty `trigger_sku` and, when set,
///   `min_qty >= 1` and `reward_qty >= 1`
fn validate_promotion(promo: &Promotion) -> Result<(), CoreError> {
    if promo.name.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "name",
            message: "promotion name must not be empty".into(),
        });
    }
    let promo_type = crate::PromotionType::from_str(promo.promo_type.trim()).ok_or_else(|| {
        CoreError::Validation {
            field: "promo_type",
            message: "invalid promotion type".into(),
        }
    })?;
    if promo.value_minor < 0 {
        return Err(CoreError::Validation {
            field: "value_minor",
            message: "value_minor must not be negative".into(),
        });
    }
    if promo.min_order_minor < 0 {
        return Err(CoreError::Validation {
            field: "min_order_minor",
            message: "min_order_minor must not be negative".into(),
        });
    }
    match promo_type {
        crate::PromotionType::Percentage | crate::PromotionType::BuyXGetY => {
            if promo.value_minor < 1 || promo.value_minor > 100 {
                return Err(CoreError::Validation {
                    field: "value_minor",
                    message: format!(
                        "{} value_minor is a percent and must be between 1 and 100",
                        promo_type.as_str()
                    ),
                });
            }
        }
        crate::PromotionType::FixedAmount => {}
    }
    if promo_type == crate::PromotionType::BuyXGetY {
        if promo
            .trigger_sku
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            return Err(CoreError::Validation {
                field: "trigger_sku",
                message: "buy_x_get_y promotion requires a trigger_sku".into(),
            });
        }
        if promo.min_qty.is_some_and(|min_qty| min_qty < 1) {
            return Err(CoreError::Validation {
                field: "min_qty",
                message: "buy_x_get_y min_qty must be at least 1".into(),
            });
        }
        if promo.reward_qty.is_some_and(|reward_qty| reward_qty < 1) {
            return Err(CoreError::Validation {
                field: "reward_qty",
                message: "buy_x_get_y reward_qty must be at least 1".into(),
            });
        }
    }
    Ok(())
}

impl Store<'_> {
    /// List all promotions, ordered by name.
    pub fn list_promotions(&self) -> Result<Vec<Promotion>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, promo_type, value_minor,
                    min_qty, trigger_sku, reward_sku, reward_qty,
                    starts_at, ends_at, min_order_minor, category_id,
                    active, created_at, updated_at
             FROM promotions
             ORDER BY name",
        )?;
        let rows = stmt.query_map([], row_to_promotion)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a single promotion by id.
    pub fn get_promotion(&self, id: &str) -> Result<Option<Promotion>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, promo_type, value_minor,
                    min_qty, trigger_sku, reward_sku, reward_qty,
                    starts_at, ends_at, min_order_minor, category_id,
                    active, created_at, updated_at
             FROM promotions
             WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], row_to_promotion);
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Insert a new promotion.
    pub fn create_promotion(&self, promo: &Promotion) -> Result<Promotion, CoreError> {
        validate_promotion(promo)?;
        self.conn.execute(
            "INSERT INTO promotions (id, name, description, promo_type, value_minor,
                                     min_qty, trigger_sku, reward_sku, reward_qty,
                                     starts_at, ends_at, min_order_minor, category_id,
                                     active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                promo.id,
                promo.name,
                promo.description,
                promo.promo_type,
                promo.value_minor,
                promo.min_qty,
                promo.trigger_sku,
                promo.reward_sku,
                promo.reward_qty,
                promo.starts_at,
                promo.ends_at,
                promo.min_order_minor,
                promo.category_id,
                promo.active as i64,
                promo.created_at,
                promo.updated_at,
            ],
        )?;
        Ok(promo.clone())
    }

    /// Update an existing promotion by id.
    pub fn update_promotion(&self, promo: &Promotion) -> Result<Promotion, CoreError> {
        validate_promotion(promo)?;
        let rows = self.conn.execute(
            "UPDATE promotions
             SET name = ?1, description = ?2, promo_type = ?3, value_minor = ?4,
                 min_qty = ?5, trigger_sku = ?6, reward_sku = ?7, reward_qty = ?8,
                 starts_at = ?9, ends_at = ?10, min_order_minor = ?11, category_id = ?12,
                 active = ?13, updated_at = ?14
             WHERE id = ?15",
            params![
                promo.name,
                promo.description,
                promo.promo_type,
                promo.value_minor,
                promo.min_qty,
                promo.trigger_sku,
                promo.reward_sku,
                promo.reward_qty,
                promo.starts_at,
                promo.ends_at,
                promo.min_order_minor,
                promo.category_id,
                promo.active as i64,
                promo.updated_at,
                promo.id,
            ],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "promotion",
                id: promo.id.clone(),
            });
        }
        Ok(promo.clone())
    }

    /// Delete a promotion by id.
    pub fn delete_promotion(&self, id: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM promotions WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "promotion",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// List all currently active promotions.
    ///
    /// A promotion is active when `active = 1` AND (`starts_at` IS NULL OR
    /// `starts_at` <= current time) AND (`ends_at` IS NULL OR `ends_at` >
    /// current time).
    pub fn get_active_promotions(&self) -> Result<Vec<Promotion>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, promo_type, value_minor,
                    min_qty, trigger_sku, reward_sku, reward_qty,
                    starts_at, ends_at, min_order_minor, category_id,
                    active, created_at, updated_at
             FROM promotions
             WHERE active = 1
               AND (ends_at IS NULL OR ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
               AND (starts_at IS NULL OR starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ORDER BY name",
        )?;
        let rows = stmt.query_map([], row_to_promotion)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Record a promotion application against a sale.
    pub fn record_promotion_application(
        &self,
        app: &PromotionApplication,
    ) -> Result<PromotionApplication, CoreError> {
        if app.discount_minor < 0 {
            return Err(CoreError::Validation {
                field: "discount_minor",
                message: "discount_minor must not be negative".into(),
            });
        }
        self.conn.execute(
            "INSERT INTO promotion_applications (id, promotion_id, sale_id, discount_minor, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                app.id,
                app.promotion_id,
                app.sale_id,
                app.discount_minor,
                app.description,
                app.created_at,
            ],
        )?;
        Ok(app.clone())
    }

    /// Atomically apply a promotion to a pending sale: compute the
    /// discount via the promotion engine, record the application row,
    /// and reduce the sale's payable total — all in one transaction
    /// (PROMO-3: the recorded discount now changes what the customer
    /// actually pays).
    ///
    /// Guards (PROMO-4): a second application of the same promotion to
    /// the same sale is rejected, and only `pending` (modifiable) sales
    /// accept promotions.
    ///
    /// `now` is injected so callers and tests control the clock.
    pub fn apply_promotion_to_sale(
        &self,
        sale_id: &str,
        promotion_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<PromotionApplication, CoreError> {
        let promo = self
            .get_promotion(promotion_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "promotion",
                id: promotion_id.to_owned(),
            })?;
        let sale = self.get_sale(sale_id)?.ok_or_else(|| CoreError::NotFound {
            entity: "sale",
            id: sale_id.to_owned(),
        })?;

        // Category scope resolution: SKU -> product category. Only
        // consulted when the promotion carries a category_id.
        let category_of = |sku: &str| {
            self.get_product(sku)
                .ok()
                .flatten()
                .and_then(|p| p.product.category_id)
        };
        let discount_minor = crate::compute_discount(&promo, &sale, now, category_of)?;

        let app = PromotionApplication {
            id: uuid::Uuid::now_v7().to_string(),
            promotion_id: promotion_id.to_owned(),
            sale_id: sale_id.to_owned(),
            discount_minor,
            description: format!(
                "{}: {} off",
                promo.name,
                crate::format_minor(discount_minor, sale.currency)
            ),
            created_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        };

        let tx = self.conn.unchecked_transaction()?;
        let dup: i64 = tx.query_row(
            "SELECT COUNT(*) FROM promotion_applications
             WHERE sale_id = ?1 AND promotion_id = ?2",
            params![app.sale_id, app.promotion_id],
            |r| r.get(0),
        )?;
        if dup > 0 {
            return Err(CoreError::Validation {
                field: "promotion_id",
                message: "promotion already applied to this sale".into(),
            });
        }

        let (status, stored_total): (String, i64) = tx.query_row(
            "SELECT status, total_minor FROM sales WHERE id = ?1",
            params![app.sale_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if status != "pending" {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: format!("sale is not modifiable (status: {status})"),
            });
        }
        if stored_total < discount_minor {
            return Err(CoreError::Validation {
                field: "discount_minor",
                message: "sale total changed below the discount amount".into(),
            });
        }

        tx.execute(
            "INSERT INTO promotion_applications (id, promotion_id, sale_id, discount_minor, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                app.id,
                app.promotion_id,
                app.sale_id,
                app.discount_minor,
                app.description,
                app.created_at,
            ],
        )?;
        let changed = tx.execute(
            "UPDATE sales SET total_minor = total_minor - ?1, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND status = 'pending' AND total_minor >= ?1",
            params![discount_minor, app.created_at, app.sale_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "sale is no longer modifiable".into(),
            });
        }
        tx.commit()?;
        Ok(app)
    }

    /// List all promotion applications for a given sale.
    pub fn get_promotion_applications_for_sale(
        &self,
        sale_id: &str,
    ) -> Result<Vec<PromotionApplication>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, promotion_id, sale_id, discount_minor, description, created_at
             FROM promotion_applications
             WHERE sale_id = ?1
             ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![sale_id], row_to_promotion_application)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Engine-apply the given promotions to an in-memory checkout sale.
    ///
    /// Checkout integration (Phase-2 promotion work): the caller builds the
    /// post-tax sale, calls this BEFORE constructing payment splits, and
    /// passes the returned applications into the checkout method so the
    /// rows persist inside the checkout transaction. Each promotion is
    /// computed against the progressively reduced total (stacking), the
    /// same engine semantics as `apply_promotion_to_sale`, and `sale.total`
    /// is reduced in place.
    ///
    /// Guards: unknown promotion → NotFound; a duplicate id in
    /// `promotion_ids` → Validation; a computed discount that would underflow
    /// the total → Validation (the engine already clamps to the base).
    pub fn compute_checkout_promotions(
        &self,
        sale: &mut Sale,
        promotion_ids: &[String],
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<PromotionApplication>, CoreError> {
        let mut applications = Vec::with_capacity(promotion_ids.len());
        let mut applied: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for promotion_id in promotion_ids {
            if !applied.insert(promotion_id.as_str()) {
                return Err(CoreError::Validation {
                    field: "promotion_id",
                    message: "promotion already selected for this checkout".into(),
                });
            }
            let promo = self
                .get_promotion(promotion_id)?
                .ok_or_else(|| CoreError::NotFound {
                    entity: "promotion",
                    id: promotion_id.to_owned(),
                })?;

            // Category scope resolution: SKU -> product category. Only
            // consulted when the promotion carries a category_id.
            let category_of = |sku: &str| {
                self.get_product(sku)
                    .ok()
                    .flatten()
                    .and_then(|p| p.product.category_id)
            };
            let discount_minor = crate::compute_discount(&promo, sale, now, category_of)?;

            let remaining = sale
                .total
                .minor_units
                .checked_sub(discount_minor)
                .ok_or_else(|| CoreError::Validation {
                    field: "discount_minor",
                    message: "promotion discount overflows the sale total".into(),
                })?;
            sale.total = crate::foundation::Money {
                minor_units: remaining,
                currency: sale.total.currency,
            };

            applications.push(PromotionApplication {
                id: uuid::Uuid::now_v7().to_string(),
                promotion_id: promotion_id.to_owned(),
                sale_id: sale.id.clone(),
                discount_minor,
                description: format!(
                    "{}: {} off",
                    promo.name,
                    crate::format_minor(discount_minor, sale.total.currency)
                ),
                created_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            });
        }
        Ok(applications)
    }
}

/// Persist checkout promotion applications inside the caller's sale
/// transaction. Shared by both completion paths
/// (`complete_sale_deduction_with_locations` and
/// `complete_sale_with_resolved_shortfalls`) so the audit rows commit
/// atomically with the sale row they reference — inserted after it so
/// the `promotion_applications → sales` foreign key resolves.
///
/// Guards: an application pointing at a different sale is a caller
/// wiring bug and fails closed. The per-`(sale_id, promotion_id)`
/// duplicate check is defence in depth, not the primary dedupe — the
/// real one is the `HashSet` in
/// [`Store::compute_checkout_promotions`]; a fresh sale row cannot have
/// prior applications, so this only fires if an already-completed sale
/// id is ever replayed into a checkout.
pub(crate) fn persist_checkout_applications(
    tx: &rusqlite::Transaction<'_>,
    sale_id: &str,
    checkout_applications: &[PromotionApplication],
) -> Result<(), CoreError> {
    for app in checkout_applications {
        if app.sale_id != sale_id {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "checkout application references a different sale".into(),
            });
        }
        let dup: i64 = tx.query_row(
            "SELECT COUNT(*) FROM promotion_applications
             WHERE sale_id = ?1 AND promotion_id = ?2",
            params![app.sale_id, app.promotion_id],
            |r| r.get(0),
        )?;
        if dup > 0 {
            return Err(CoreError::Validation {
                field: "promotion_id",
                message: "promotion already applied to this sale".into(),
            });
        }
        tx.execute(
            "INSERT INTO promotion_applications (id, promotion_id, sale_id, discount_minor, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                app.id,
                app.promotion_id,
                app.sale_id,
                app.discount_minor,
                app.description,
                app.created_at,
            ],
        )?;
    }
    Ok(())
}

fn row_to_promotion(row: &rusqlite::Row) -> rusqlite::Result<Promotion> {
    Ok(Promotion {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        promo_type: row.get("promo_type")?,
        value_minor: row.get("value_minor")?,
        min_qty: row.get("min_qty")?,
        trigger_sku: row.get("trigger_sku")?,
        reward_sku: row.get("reward_sku")?,
        reward_qty: row.get("reward_qty")?,
        starts_at: row.get("starts_at")?,
        ends_at: row.get("ends_at")?,
        min_order_minor: row.get("min_order_minor")?,
        category_id: row.get("category_id")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_promotion_application(row: &rusqlite::Row) -> rusqlite::Result<PromotionApplication> {
    Ok(PromotionApplication {
        id: row.get("id")?,
        promotion_id: row.get("promotion_id")?,
        sale_id: row.get("sale_id")?,
        discount_minor: row.get("discount_minor")?,
        description: row.get("description")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
#[path = "promotions_tests.rs"]
mod tests;
