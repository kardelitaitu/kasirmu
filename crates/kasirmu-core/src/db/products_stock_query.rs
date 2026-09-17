//! Stock queries and movement writes (ADR #6 delta ledger).
//!
//! Key functions: `get_stock`, the SKU/id/type lookup helpers,
//! `insert_stock_movement`(+`_in_tx`), `create_product_if_absent_in_tx`
//! (idempotent sync replay), `adjust_stock_in_tx` (deprecated
//! single-column path) and `adjust_stock` (deprecated; routes to
//! `adjust_stock_with_reason`).
//!
//! Invariants: movement rows are append-only; `stock_summary` upserts
//! go through the parent `upsert_stock_summary_in_tx` (ADR-19 section 3).
use super::*;

// ── Inventory helpers ─────────────────────────────────────────────────

impl Store<'_> {
    /// Read the current stock quantity for a product.
    ///
    /// Checks the cache first; on cache miss, queries the database and
    /// populates the cache.
    pub fn get_stock(&self, product_id: &str) -> Result<i64, CoreError> {
        if let Some(cache) = &self.cache
            && let Some(qty) = cache.get_inventory(product_id)
        {
            return Ok(qty);
        }

        let result = self.conn.query_row(
            "SELECT qty FROM inventory WHERE product_id = ?1",
            params![product_id],
            |row| row.get(0),
        );
        let qty = match result {
            Ok(q) => q,
            Err(rusqlite::Error::QueryReturnedNoRows) => 0,
            Err(e) => return Err(e.into()),
        };

        if let Some(cache) = &self.cache {
            cache.set_inventory(product_id, qty);
        }

        Ok(qty)
    }

    /// Look up a product id by SKU.
    pub fn product_id_by_sku(&self, sku: &str) -> Result<Option<String>, CoreError> {
        let result = self.conn.query_row(
            "SELECT id FROM products WHERE sku = ?1",
            params![sku],
            |row| row.get(0),
        );
        match result {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Look up a product SKU by product ID.
    pub fn product_sku_by_id(&self, product_id: &str) -> Result<Option<String>, CoreError> {
        let result = self.conn.query_row(
            "SELECT sku FROM products WHERE id = ?1",
            params![product_id],
            |row| row.get(0),
        );
        match result {
            Ok(sku) => Ok(Some(sku)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Look up a product's `product_type` by product ID.
    pub fn product_type_by_id(&self, product_id: &str) -> Result<Option<String>, CoreError> {
        let result = self.conn.query_row(
            "SELECT product_type FROM products WHERE id = ?1",
            params![product_id],
            |row| row.get(0),
        );
        match result {
            Ok(pt) => Ok(Some(pt)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Insert a stock movement delta row directly into the ledger.
    ///
    /// This is the low-level insert used by the sync layer to apply
    /// incoming remote deltas without triggering inventory or stock_summary
    /// updates (those are reconciled later via `rebuild_stock_summary`).
    ///
    /// The `store_id` identifies which store the delta originated from
    /// for cross-store routing (ADR #6).
    #[allow(clippy::too_many_arguments)]
    pub fn insert_stock_movement(
        &self,
        id: &str,
        item_id: &str,
        delta: i64,
        reason: Option<&str>,
        source_terminal_id: Option<&str>,
        source_user_id: Option<&str>,
        store_id: &str,
        created_at: &str,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason,
                                          source_terminal_id, source_user_id,
                                          store_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                item_id,
                delta,
                reason,
                source_terminal_id,
                source_user_id,
                store_id,
                created_at,
            ],
        )?;
        Ok(())
    }

    /// Insert a stock movement using a caller-owned transaction.
    ///
    /// Sync replay handling uses this form so the immutable ledger row and
    /// its remote receipt can commit or roll back together.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_stock_movement_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        id: &str,
        item_id: &str,
        delta: i64,
        reason: Option<&str>,
        source_terminal_id: Option<&str>,
        source_user_id: Option<&str>,
        store_id: &str,
        created_at: &str,
    ) -> Result<(), CoreError> {
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason,
                                          source_terminal_id, source_user_id,
                                          store_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                item_id,
                delta,
                reason,
                source_terminal_id,
                source_user_id,
                store_id,
                created_at,
            ],
        )?;
        Ok(())
    }

    /// Create a product and its initial stock inside a caller-owned
    /// transaction, unless the SKU already exists.
    ///
    /// Returns `true` when a row was inserted and `false` when the SKU was
    /// already present. The operation is intentionally idempotent by SKU so
    /// a replay after a commit-before-receipt crash cannot create a duplicate.
    #[allow(clippy::too_many_arguments)]
    pub fn create_product_if_absent_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sku: &str,
        name: &str,
        price: Money,
        category_id: Option<&str>,
        barcode: Option<&str>,
        initial_stock: i64,
        product_type: &str,
    ) -> Result<bool, CoreError> {
        if sku.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "sku",
                message: "SKU must not be empty".into(),
            });
        }
        if sku.len() > 50 {
            return Err(CoreError::Validation {
                field: "sku",
                message: format!("SKU must not exceed 50 characters, got {}", sku.len()),
            });
        }
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "name must not be empty".into(),
            });
        }
        if name.len() > 255 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!("name must not exceed 255 characters, got {}", name.len()),
            });
        }
        if price.minor_units < 0 {
            return Err(CoreError::Validation {
                field: "price",
                message: "price must be ≥ 0".into(),
            });
        }
        if initial_stock < 0 {
            return Err(CoreError::Validation {
                field: "initial_stock",
                message: "initial_stock must be ≥ 0".into(),
            });
        }

        let cur_str = std::str::from_utf8(&price.currency.0)
            .map_err(|e| CoreError::Validation {
                field: "currency",
                message: format!("invalid UTF-8 in currency bytes: {e}"),
            })?
            .to_owned();

        // A repeated SKU is only idempotent when it describes the same
        // product. Silently accepting a different payload would record a
        // receipt while discarding a legitimate remote catalog conflict.
        {
            use rusqlite::OptionalExtension;
            // Existing-product row for the idempotency comparison (clippy
            // type_complexity — factored into a named type).
            type ExistingRow = (String, i64, String, Option<String>, Option<String>, String);
            let existing: Option<ExistingRow> = tx
                .query_row(
                    "SELECT p.name, p.price_minor, p.currency, p.category_id, p.barcode,
                            p.product_type
                     FROM products p
                     WHERE p.sku = ?1",
                    params![sku.trim()],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((
                existing_name,
                existing_price,
                existing_currency,
                existing_category,
                existing_barcode,
                existing_type,
            )) = existing
            {
                let same = existing_name == name.trim()
                    && existing_price == price.minor_units
                    && existing_currency == cur_str
                    && existing_category.as_deref() == category_id
                    && existing_barcode.as_deref() == barcode
                    && existing_type == product_type;
                // `initial_stock` is write-once creation metadata. Current
                // inventory is mutable, so it is intentionally not compared
                // when recognizing a replay of an already-existing SKU.
                if !same {
                    return Err(CoreError::Conflict {
                        entity: "product",
                        field: "sku",
                    });
                }
                return Ok(false);
            }
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let inserted = tx.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode,
                                   created_at, updated_at, price_updated_at, track_serial,
                                   product_type, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8, 0, ?9, 1)
             ON CONFLICT (tenant_id, sku) DO NOTHING",
            params![
                id,
                sku.trim(),
                name.trim(),
                price.minor_units,
                cur_str,
                category_id,
                barcode,
                now,
                product_type,
            ],
        )?;

        if inserted == 0 || initial_stock == 0 || product_type == "service" {
            return Ok(inserted == 1);
        }

        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, ?3)",
            params![id, initial_stock, now],
        )?;
        let movement_id = uuid::Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason,
                                          source_terminal_id, source_user_id, created_at)
             VALUES (?1, ?2, ?3, 'initial-stock', NULL, NULL, ?4)",
            params![movement_id, id, initial_stock, now],
        )?;
        upsert_stock_summary_in_tx(
            tx,
            &id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            initial_stock,
            &now,
        )?;

        Ok(true)
    }

    /// Adjust stock for a product by SKU inside a caller-owned transaction.
    ///
    /// This compatibility path mirrors [`Store::adjust_stock`] while allowing
    /// sync replay to commit the stock mutation and remote receipt together.
    /// New checkout code should use the location-aware canonical API below.
    #[deprecated(note = "use adjust_stock_at_location_with_reason instead")]
    pub fn adjust_stock_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sku: &str,
        delta: i64,
    ) -> Result<i64, CoreError> {
        let product_id: String = tx
            .query_row(
                "SELECT id FROM products WHERE sku = ?1",
                params![sku],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "product",
                    id: sku.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        let previous_qty: i64 = match tx.query_row(
            "SELECT qty FROM inventory WHERE product_id = ?1",
            params![product_id],
            |row| row.get(0),
        ) {
            Ok(qty) => qty,
            Err(rusqlite::Error::QueryReturnedNoRows) => 0,
            Err(error) => return Err(CoreError::Db(error)),
        };
        let new_qty = previous_qty
            .checked_add(delta)
            .filter(|&v| v >= 0)
            .ok_or_else(|| CoreError::Validation {
                field: "delta",
                message: format!(
                    "adjustment would cause negative stock (previous: {previous_qty}, delta: {delta})"
                ),
            })?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason, created_at)
             VALUES (?1, ?2, ?3, 'remote-sync', ?4)",
            params![uuid::Uuid::now_v7().to_string(), product_id, delta, now],
        )?;
        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(product_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
            params![product_id, new_qty, now],
        )?;
        upsert_stock_summary_in_tx(
            tx,
            &product_id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            new_qty,
            &now,
        )?;
        Ok(new_qty)
    }

    /// Adjust stock for a product by SKU inside a transaction.
    ///
    /// Writes a delta row to the `stock_movements` ledger (ADR #6)
    /// and updates the materialised `inventory` and `stock_summary` tables.
    /// The `reason` parameter is recorded in the ledger for audit purposes.
    /// Multi-terminal: stock adjustments are store-scoped and shared across all
    /// terminals. The CHECK (qty >= 0) constraint on stock_summary prevents
    /// concurrent last-unit oversells from producing negative inventory.
    #[deprecated(note = "use adjust_stock_at_location_with_reason instead")]
    #[allow(deprecated)]
    pub fn adjust_stock(&self, sku: &str, delta: i64) -> Result<i64, CoreError> {
        self.adjust_stock_with_reason(sku, delta, None, None, None)
    }
}
