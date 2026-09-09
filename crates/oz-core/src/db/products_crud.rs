//! Product CRUD - list/get/create/update/delete.
//!
//! Key functions: `list_products` (plus store/warehouse/location
//! scopes), `get_product`, barcode lookup with details, `create_product`
//! (idempotent-with-payload-compare for sync replay) and
//! `create_product_with_attributes`, `update_product` (version CAS),
//! `update_product_attributes`, `set_product_track_serial`,
//! `delete_product`.
//!
//! Invariants: SKU uniqueness per tenant; money fields are i64 minor
//! units; writes run inside transactions; version CAS returns Conflict.
use super::*;
use crate::downgrade::QuotaDimension;
use crate::subscription::{QuotaError, SubscriptionTier};

// ── Product CRUD ─────────────────────────────────────────────────────

impl Store<'_> {
    /// List all products, ordered by name, with category and stock.
    pub fn list_products(&self) -> Result<Vec<ProductWithDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN inventory i ON p.id = i.product_id
             ORDER BY p.name",
        )?;
        let rows = stmt.query_map([], row_to_product_with_details)?;
        let mut products: Vec<ProductWithDetails> = rows.collect::<Result<Vec<_>, _>>()?;
        self.attach_images(&mut products)?;
        Ok(products)
    }

    /// List products visible to one store (soft-scoping layer, migration
    /// 069/117), ordered by name, with category and stock.
    ///
    /// A store sees the shared global catalog (`store_id IS NULL`) plus its
    /// own tagged rows — never another store's rows. In the per-store
    /// database model every row is NULL, so this degenerates to the global
    /// catalog; it is the enforcement surface for shared/cloud databases
    /// where `store_id` is the soft-scoping column. The strict
    /// `store_id = ?1` predicate would return nothing there (all rows are
    /// NULL), which is why the NULL arm is included.
    pub fn list_products_for_store(
        &self,
        store_id: &str,
    ) -> Result<Vec<ProductWithDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.store_id IS NULL OR p.store_id = ?1
             ORDER BY p.name",
        )?;
        let rows = stmt.query_map(params![store_id], row_to_product_with_details)?;
        let mut products: Vec<ProductWithDetails> = rows.collect::<Result<Vec<_>, _>>()?;
        self.attach_images(&mut products)?;
        Ok(products)
    }

    /// List inventory-tracked products only, ordered by name, with category
    /// and stock. Excludes service-type products (e.g. "car wash") that have
    /// no physical stock. Used by the warehouse/inventory workspace.
    pub fn list_warehouse_products(&self) -> Result<Vec<ProductWithDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.product_type != 'service'
             ORDER BY p.name",
        )?;
        let rows = stmt.query_map([], row_to_product_with_details)?;
        let mut products: Vec<ProductWithDetails> = rows.collect::<Result<Vec<_>, _>>()?;
        self.attach_images(&mut products)?;
        Ok(products)
    }

    /// List inventory-tracked products with stock at a specific location.
    ///
    /// Like [`list_warehouse_products`] but reads `stock_summary.qty` for
    /// the given `location_id` instead of summing across all locations.
    /// Returns 0 for products with no stock row at this location.
    pub fn list_warehouse_products_at_location(
        &self,
        location_id: &str,
    ) -> Result<Vec<ProductWithDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT ss.qty FROM stock_summary ss WHERE ss.item_id = p.id AND ss.location_id = ?1), 0) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.product_type != 'service'
             ORDER BY p.name",
        )?;
        let rows = stmt.query_map(params![location_id], row_to_product_with_details)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a single product by SKU, including category and stock.
    ///
    /// Checks the cache first; on cache miss, queries the database and
    /// populates the cache.
    pub fn get_product(&self, sku: &str) -> Result<Option<ProductWithDetails>, CoreError> {
        if let Some(cache) = &self.cache
            && let Some(product) = cache.get_product(sku)
        {
            return Ok(Some(product));
        }

        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.sku = ?1",
        )?;
        let result = stmt.query_row(params![sku], row_to_product_with_details);
        let mut product = match result {
            Ok(p) => Some(p),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.into()),
        };

        // Attach the product's image assignments (spec 0046b §3.4).
        if let Some(p) = &mut product {
            self.attach_images(std::slice::from_mut(p))?;
        }

        if let (Some(cache), Some(p)) = (&self.cache, &product) {
            cache.set_product(sku, p);
        }

        Ok(product)
    }

    /// Look up a single product by barcode, including category and stock.
    pub fn lookup_product_with_details_by_barcode(
        &self,
        barcode: &str,
    ) -> Result<Option<ProductWithDetails>, CoreError> {
        if barcode.trim().is_empty() {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.sku, p.name, p.price_minor, p.currency,
                     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at,
                     p.track_serial, p.product_type, p.version,
                     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit,
                     p.is_active, p.default_supplier_id, p.popularity_score,
                     p.image_hash,
                     c.name AS category_name,
                     COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.barcode = ?1",
        )?;
        let result = stmt.query_row(params![barcode.trim()], row_to_product_with_details);
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Enforce the subscription tier's product/menu-item limit before
    /// creating a product (subscription-tiers.md §Numeric Limits —
    /// Free 200 / Plus 500 / Pro 1,000 / Premium 10,000 / Enterprise
    /// unlimited). The count runs against the products table of the
    /// database this [`Store`] wraps (per-location catalog).
    ///
    /// When the tier's `max_products()` cap is reached, returns
    /// [`QuotaError::ProductLimit`] (surfaced as
    /// `SubscriptionLimitExceeded`, which the UI maps to an upgrade CTA).
    /// Unlimited tiers (`None`) pass.
    pub fn enforce_product_quota(&self, tier: &SubscriptionTier) -> Result<(), CoreError> {
        // W4-S1: decision centralized in `quota_gate`; same limit source
        // (`max_products`), same products count (`count_products`), same
        // `ProductLimit` error.
        self.enforce_creation_quota(QuotaDimension::Products, tier)
    }

    /// Insert a new product and optionally an inventory row.
    /// `product_type` defaults to `"retail"` when `None`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_product(
        &self,
        sku: &str,
        name: &str,
        price: Money,
        category_id: Option<&str>,
        barcode: Option<&str>,
        initial_stock: i64,
        product_type: Option<&str>,
    ) -> Result<Product, CoreError> {
        self.create_product_with_attributes(
            sku,
            name,
            price,
            category_id,
            barcode,
            initial_stock,
            product_type,
            &CreateProductAttributes::default(),
        )
    }

    /// Create a product with the ADR #36 attributes.
    ///
    /// [`Store::create_product`] delegates here with default attributes so the
    /// ~100 legacy call sites are untouched.
    #[allow(clippy::too_many_arguments)]
    pub fn create_product_with_attributes(
        &self,
        sku: &str,
        name: &str,
        price: Money,
        category_id: Option<&str>,
        barcode: Option<&str>,
        initial_stock: i64,
        product_type: Option<&str>,
        attrs: &CreateProductAttributes,
    ) -> Result<Product, CoreError> {
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

        let product_type = product_type.unwrap_or("retail");
        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let cur_str = std::str::from_utf8(&price.currency.0)
            .map_err(|e| CoreError::Validation {
                field: "currency",
                message: format!("invalid UTF-8 in currency bytes: {e}"),
            })?
            .to_owned();

        let tx = self.conn.unchecked_transaction()?;

        let result = tx.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, track_serial, product_type, version, cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                id,
                sku.trim(),
                name.trim(),
                price.minor_units,
                cur_str,
                category_id,
                barcode,
                now,
                now,
                now,
                0i32,
                product_type,
                attrs.cost_minor,
                attrs.brand,
                attrs.rack_location,
                attrs.notes,
                attrs.unit,
                attrs.is_active as i64,
                attrs.default_supplier_id,
            ],
        );

        match result {
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                return Err(CoreError::Conflict {
                    entity: "product",
                    field: "sku or barcode",
                });
            }
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }

        // Service products never get inventory rows — they have unlimited stock.
        if initial_stock > 0 && product_type != "service" {
            tx.execute(
                "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, ?3)",
                params![id, initial_stock, now],
            )?;
            // ADR #6: Record initial stock in the delta ledger.
            let movement_id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO stock_movements (id, item_id, delta, reason,
                                              source_terminal_id, source_user_id, created_at)
                 VALUES (?1, ?2, ?3, 'initial-stock', NULL, NULL, ?4)",
                params![movement_id, id, initial_stock, now],
            )?;
            upsert_stock_summary_in_tx(
                &tx,
                &id,
                crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                initial_stock,
                &now,
            )?;
        }

        tx.commit()?;

        if let Some(cache) = &self.cache {
            cache.invalidate_product(sku.trim());
        }

        let parsed_pt = crate::ProductType::parse_str(product_type).unwrap_or_default();
        Ok(Product {
            id,
            sku: Sku::new(sku.trim()),
            name: name.trim().to_owned(),
            price,
            category_id: category_id.map(|s| s.to_owned()),
            barcode: barcode.and_then(|s| foundation::Barcode::new(s).ok()),
            created_at: now.clone(),
            updated_at: now.clone(),
            price_updated_at: now,
            track_serial: false,
            product_type: parsed_pt,
            version: 1,
            cost_minor: attrs.cost_minor,
            brand: attrs.brand.clone(),
            rack_location: attrs.rack_location.clone(),
            notes: attrs.notes.clone(),
            unit: attrs.unit.clone(),
            is_active: attrs.is_active,
            default_supplier_id: attrs.default_supplier_id.clone(),
            image_hash: None,
        })
    }

    /// Apply ADR #36 attribute changes to a product identified by SKU.
    ///
    /// PATCH semantics (see [`UpdateProductAttributes`]). Records an edit
    /// activity event and refreshes the popularity score in the same
    /// transaction (ADR #37 D2/D3). Returns [`CoreError::NotFound`] when the
    /// SKU does not exist and no-op when the patch is empty.
    pub fn update_product_attributes(
        &self,
        sku: &str,
        attrs: &UpdateProductAttributes,
    ) -> Result<(), CoreError> {
        let mut sets: Vec<String> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // Set-or-clear helper for clearable text columns.
        macro_rules! set_clearable {
            ($col:expr, $opt:expr) => {
                match &$opt {
                    Some(Some(val)) => {
                        sets.push(format!("{} = ?", $col));
                        values.push(Box::new(val.clone()));
                    }
                    Some(None) => sets.push(format!("{} = NULL", $col)),
                    None => {}
                }
            };
        }

        if let Some(cost) = attrs.cost_minor {
            sets.push("cost_minor = ?".into());
            values.push(Box::new(cost));
        }
        set_clearable!("brand", attrs.brand);
        set_clearable!("rack_location", attrs.rack_location);
        set_clearable!("notes", attrs.notes);
        set_clearable!("unit", attrs.unit);
        set_clearable!("default_supplier_id", attrs.default_supplier_id);
        if let Some(active) = attrs.is_active {
            sets.push("is_active = ?".into());
            values.push(Box::new(active as i64));
        }

        if sets.is_empty() {
            return Ok(());
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;

        sets.push("updated_at = ?".into());
        values.push(Box::new(now.clone()));
        let sql = format!("UPDATE products SET {} WHERE sku = ?", sets.join(", "));
        values.push(Box::new(sku.to_string()));

        let rows = tx.execute(&sql, rusqlite::params_from_iter(values))?;
        if rows == 0 {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            });
        }

        // ADR #37 D2: every product update is an edit signal.
        tx.execute(
            "INSERT INTO product_activity (id, sku, event_type) VALUES (?1, ?2, 'edit')",
            params![crate::new_id(), sku],
        )?;
        tx.commit()?;

        self.recompute_popularity(sku)?;
        if let Some(cache) = &self.cache {
            cache.invalidate_product(sku);
        }
        Ok(())
    }

    /// Update an existing product identified by SKU.
    ///
    /// Uses optimistic concurrency (ADR #6): when `expected_version` is
    /// `Some`, includes `version` in the WHERE clause and increments it
    /// on success. Returns [`CoreError::Conflict`] if another process
    /// modified the product concurrently. When `None`, the update is
    /// performed unconditionally (backward-compat for callers that do
    /// not track versions).
    #[allow(clippy::too_many_arguments)]
    pub fn update_product(
        &self,
        sku: &str,
        name: &str,
        price: Money,
        category_id: Option<&str>,
        barcode: Option<&str>,
        product_type: Option<&str>,
        expected_version: Option<i64>,
    ) -> Result<Product, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "name must not be empty".into(),
            });
        }
        if price.minor_units < 0 {
            return Err(CoreError::Validation {
                field: "price",
                message: "price must be ≥ 0".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let cur_str = std::str::from_utf8(&price.currency.0)
            .map_err(|e| CoreError::Validation {
                field: "currency",
                message: format!("invalid UTF-8 in currency bytes: {e}"),
            })?
            .to_owned();

        let rows = if let Some(ver) = expected_version {
            self.conn.execute(
                "UPDATE products
                 SET name = ?1, price_minor = ?2, currency = ?3,
                     category_id = ?4, barcode = ?5, updated_at = ?6,
                     product_type = COALESCE(?7, product_type),
                     price_updated_at = CASE WHEN price_minor <> ?2 OR currency <> ?3 THEN ?6 ELSE price_updated_at END,
                     version = version + 1
                 WHERE sku = ?8 AND version = ?9",
                params![
                    name.trim(),
                    price.minor_units,
                    cur_str,
                    category_id,
                    barcode,
                    now,
                    product_type,
                    sku,
                    ver,
                ],
            )?
        } else {
            self.conn.execute(
                "UPDATE products
                 SET name = ?1, price_minor = ?2, currency = ?3,
                     category_id = ?4, barcode = ?5, updated_at = ?6,
                     product_type = COALESCE(?7, product_type),
                     price_updated_at = CASE WHEN price_minor <> ?2 OR currency <> ?3 THEN ?6 ELSE price_updated_at END,
                     version = version + 1
                 WHERE sku = ?8",
                params![
                    name.trim(),
                    price.minor_units,
                    cur_str,
                    category_id,
                    barcode,
                    now,
                    product_type,
                    sku,
                ],
            )?
        };

        if rows == 0 {
            if expected_version.is_some() {
                // Determine if it's a version conflict or a not-found.
                let exists: bool = self.conn.query_row(
                    "SELECT COUNT(*) > 0 FROM products WHERE sku = ?1",
                    params![sku],
                    |r| r.get(0),
                )?;
                if exists {
                    return Err(CoreError::Conflict {
                        entity: "product",
                        field: "version",
                    });
                }
            }
            return Err(CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            });
        }

        if let Some(cache) = &self.cache {
            cache.invalidate_product(sku);
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, track_serial, product_type, version, cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, popularity_score, image_hash
             FROM products WHERE sku = ?1",
        )?;
        let product = stmt.query_row(params![sku], row_to_product)?;
        Ok(product)
    }

    /// Look up a product by barcode (without enrichment).
    pub fn get_product_by_barcode(&self, barcode: &str) -> Result<Option<Product>, CoreError> {
        if barcode.trim().is_empty() {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, track_serial, product_type, version, cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, popularity_score, image_hash
             FROM products WHERE barcode = ?1",
        )?;
        let result = stmt.query_row(params![barcode.trim()], row_to_product);
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Set the `track_serial` flag for a product identified by SKU.
    pub fn set_product_track_serial(&self, sku: &str, track_serial: bool) -> Result<(), CoreError> {
        let rows = self.conn.execute(
            "UPDATE products SET track_serial = ?1 WHERE sku = ?2",
            params![track_serial as i64, sku],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            });
        }
        if let Some(cache) = &self.cache {
            cache.invalidate_product(sku);
        }
        Ok(())
    }

    /// Delete a product by SKU.
    pub fn delete_product(&self, sku: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM products WHERE sku = ?1", params![sku])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            });
        }

        if let Some(cache) = &self.cache {
            cache.invalidate_product(sku);
        }

        self.persist_over_quota_markers()?;
        Ok(())
    }

    /// Load all product images for the given product IDs and attach them
    /// to the respective `ProductWithDetails` (in place).
    pub(crate) fn attach_images(
        &self,
        products: &mut [ProductWithDetails],
    ) -> Result<(), CoreError> {
        let ids: Vec<&str> = products.iter().map(|p| p.product.id.as_str()).collect();
        if ids.is_empty() {
            return Ok(());
        }
        // Build a parameterised query with placeholders
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT product_id, slot, hash, position FROM product_images \
             WHERE product_id IN ({}) ORDER BY slot ASC",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut param_refs: Vec<&dyn rusqlite::types::ToSql> = Vec::new();
        for id in &ids {
            param_refs.push(id);
        }
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
            ))
        })?;
        let mut by_product: std::collections::HashMap<
            String,
            Vec<crate::db::products::ProductImage>,
        > = std::collections::HashMap::new();
        for row in rows {
            let (product_id, slot, hash, position) = row?;
            by_product
                .entry(product_id)
                .or_default()
                .push(crate::db::products::ProductImage {
                    slot,
                    hash,
                    position,
                });
        }
        for p in products.iter_mut() {
            if let Some(imgs) = by_product.remove(&p.product.id) {
                p.images = imgs;
            }
        }
        Ok(())
    }
}
