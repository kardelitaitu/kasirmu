//! Products domain core - enriched/ledger DTOs, ADR #36 attributes, variants.
//!
//! F-011 split: the big impl-Store groups moved to sibling part modules
//! (`products_crud`, `products_categories`, `products_stock_query`,
//! `products_stock_adjust`), declared below; the crate public API and
//! every downstream path are unchanged. This parent keeps the shared
//! types (`ProductWithDetails`, `StockMovement`), the canonical
//! `upsert_stock_summary_in_tx` helper (ADR-19 section 3), the ADR #36
//! attribute structs, and the product-variant impl.
//!
//! Invariant: stock is an immutable delta ledger (`stock_movements`)
//! with `stock_summary` upserts routed through the shared helper; money
//! stays i64 minor units.

/*
last audited 26-09-26 by DSH (COR-14 CLOSED)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: money/stock paths sound (update_product has REAL version CAS -> Conflict; create_product idempotent-with-payload-compare for sync replay, ON CONFLICT(tenant_id,sku) backstop; adjust_stock_batch precheck-then-execute with checked_add + typed InsufficientStockAtLocation; allow_negative lookup fails safe to deny); COR-12 CLOSED 26-09-26 (update_product now applies the same 255-char ceiling as the create path, and the cloud `pg::create_product` branch of the same route applies it too — pinned by `update_product_refuses_the_name_length_the_create_path_already_did`); COR-14 CLOSED 26-09-26 — `row_to_product_variant` no longer discards the reason for an unrepresentable stored value. Two arms, not one: the barcode (`.ok()` swallowing `Barcode::new`'s rejection) and the ADJACENT currency arm at the same site, which the original filing did not mention — an unparseable `product_variants.currency` also became a silent `None`, rendering the variant as having no price. Both now `warn!` naming the SKU while preserving the existing `None` contract (no caller changes). Both columns are unconstrained TEXT with no CHECK, and the write paths validate only in Rust, so an import, a sync payload or the per-tenant-uniqueness migration can carry an unusable value in; the loss is now visible instead of vanishing. Deprecated adjust_stock_with_reason self-documents its ADR-19 §3.4 stale-source foot-gun (tracked, no new finding).
next: none for COR-14. | perf: batch SKU lookups; upsert_stock_summary_in_tx canonical per ADR-19 §3
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::money::Currency;
use crate::{Money, Product, ProductVariant, Sku};

use super::{Store, row_to_product};

// F-011 split: cohesive impl-Store groups moved to sibling part files;
// child-module wiring below keeps every downstream path unchanged.
#[path = "products_crud.rs"]
mod products_crud;

#[path = "products_categories.rs"]
mod products_categories;

#[path = "products_stock_query.rs"]
mod products_stock_query;

#[path = "products_stock_adjust.rs"]
mod products_stock_adjust;

#[path = "products_images.rs"]
mod products_images;

pub use products_images::ProductImage;

// ── Enriched product type ────────────────────────────────────────────

/// A [`Product`] enriched with category name and stock quantity from
/// LEFT JOINs on `categories` and `inventory`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ProductWithDetails {
    /// The core product fields (flattened into the parent JSON).
    #[serde(flatten)]
    pub product: Product,
    /// Display name from `categories.name`, if linked.
    pub category_name: Option<String>,
    /// Current stock — SUM of `stock_summary.qty` across locations, falling
    /// back to the legacy `inventory.qty` when no ledger rows exist (ADR #36).
    pub stock_qty: Option<i64>,
    /// Materialized popularity score (ADR #37) — sort key for the retail grid.
    #[serde(default)]
    pub popularity_score: f64,
    /// Content-addressed image assignments (slots 1..5) from
    /// `product_images` (spec 0046b §3.4 — rides the catalog snapshot).
    #[serde(default)]
    pub images: Vec<ProductImage>,
}

fn row_to_product_with_details(row: &rusqlite::Row) -> rusqlite::Result<ProductWithDetails> {
    let product = row_to_product(row)?;
    Ok(ProductWithDetails {
        product,
        category_name: row.get("category_name")?,
        stock_qty: row.get("stock_qty")?,
        popularity_score: row.get("popularity_score")?,
        images: Vec::new(), // populated by the list/get loaders
    })
}

/// An immutable row in the stock movements delta ledger (ADR #6).
///
/// Each row records a single stock change (+N or -N) with audit
/// metadata. The current stock is computed as `SUM(delta)` across
/// all rows for a given `item_id`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StockMovement {
    /// Unique UUID v7 identifier.
    pub id: String,
    /// Product ID this movement applies to.
    pub item_id: String,
    /// Quantity change: positive = restock, negative = removal.
    pub delta: i64,
    /// Human-readable reason: 'sale', 'restock', 'correction', etc.
    pub reason: Option<String>,
    /// Terminal that performed the operation (for audit/sync).
    pub source_terminal_id: Option<String>,
    /// User who performed the operation (for audit/sync).
    pub source_user_id: Option<String>,
    /// Store where the movement originated (ADR #6 cross-store routing).
    pub store_id: String,
    /// ISO-8601 timestamp of the movement.
    pub created_at: String,
}

/// Upsert a single `(item_id, location_id, qty)` row into `stock_summary`.
///
/// **ADR-19 §3**: post-migration-089's composite PRIMARY KEY
/// `(item_id, location_id)` requires every insert to specify BOTH columns
/// AND target BOTH columns in the conflict clause. Older single-column
/// callsites (`ON CONFLICT(item_id)`) now fail with SQLite error
/// `"ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"`
/// — the cascade broke 46 cargo tests across KDS, products, purchase_orders,
/// reports, sales, stock_transfers, workspaces modules. This helper is the
/// canonical replacement and is used by `create_product`,
/// `adjust_stock_with_reason`, and any future single-row ops.
///
/// Accepts `&rusqlite::Connection` (NOT `&mut self`) so it works transparently
/// inside `unchecked_transaction()` blocks via `Transaction`'s `Deref<Target = Connection>`
/// behaviour — callers pass `&tx`.
fn upsert_stock_summary_in_tx(
    conn: &rusqlite::Connection,
    item_id: &str,
    location_id: &str,
    qty: i64,
    updated_at: &str,
) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(item_id, location_id) DO UPDATE SET qty = excluded.qty,
                                                      updated_at = excluded.updated_at",
        rusqlite::params![item_id, location_id, qty, updated_at],
    )?;
    Ok(())
}

// ── ADR #36 product attributes ───────────────────────────────────────

/// Product attributes beyond the base create fields (ADR #36).
///
/// [`Store::create_product`] delegates with the default so legacy callers
/// are unaffected; commands that carry the new fields call
/// [`Store::create_product_with_attributes`].
#[derive(Debug, Clone)]
pub struct CreateProductAttributes {
    /// Purchase/cost price in minor units (local-only).
    pub cost_minor: i64,
    /// Brand (free text).
    pub brand: Option<String>,
    /// Rack position code.
    pub rack_location: Option<String>,
    /// Free-text notes.
    pub notes: Option<String>,
    /// Unit of measure.
    pub unit: Option<String>,
    /// Active/sellable status (default: active).
    pub is_active: bool,
    /// Default supplier FK (local-only).
    pub default_supplier_id: Option<String>,
}

impl Default for CreateProductAttributes {
    fn default() -> Self {
        Self {
            cost_minor: 0,
            brand: None,
            rack_location: None,
            notes: None,
            unit: None,
            is_active: true,
            default_supplier_id: None,
        }
    }
}

/// ADR #36 attribute patch for [`Store::update_product_attributes`].
///
/// PATCH semantics: `None` = keep, `Some(None)` = clear (set NULL),
/// `Some(Some(v))` = set. `cost_minor`/`is_active` are plain `Option` —
/// `Some` updates, `None` keeps.
#[derive(Debug, Clone, Default)]
pub struct UpdateProductAttributes {
    /// Updated cost in minor units.
    pub cost_minor: Option<i64>,
    /// Updated brand (None keeps, Some(None) clears).
    pub brand: Option<Option<String>>,
    /// Updated rack position code.
    pub rack_location: Option<Option<String>>,
    /// Updated notes.
    pub notes: Option<Option<String>>,
    /// Updated unit of measure.
    pub unit: Option<Option<String>>,
    /// Updated active status.
    pub is_active: Option<bool>,
    /// Updated default supplier.
    pub default_supplier_id: Option<Option<String>>,
}
// ── Product Variants ─────────────────────────────────────────

impl Store<'_> {
    /// List all variants for a given parent SKU, ordered by sort_order.
    pub fn list_product_variants(
        &self,
        parent_sku: &str,
    ) -> Result<Vec<ProductVariant>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_sku, name, sku, price_minor, currency, barcode,
                    sort_order, is_active, created_at, updated_at
             FROM product_variants
             WHERE parent_sku = ?1
             ORDER BY sort_order ASC, name ASC",
        )?;
        let rows = stmt.query_map(params![parent_sku], Self::row_to_product_variant)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get a single variant by its own SKU.
    pub fn get_product_variant(&self, sku: &str) -> Result<Option<ProductVariant>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_sku, name, sku, price_minor, currency, barcode,
                    sort_order, is_active, created_at, updated_at
             FROM product_variants WHERE sku = ?1",
        )?;
        let result = stmt.query_row(params![sku], Self::row_to_product_variant);
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Create a new product variant.
    pub fn create_product_variant(&self, variant: &ProductVariant) -> Result<(), CoreError> {
        let (price_minor, currency_str) = match &variant.price {
            Some(m) => (
                Some(m.minor_units),
                Some(
                    std::str::from_utf8(&m.currency.0)
                        .unwrap_or("USD")
                        .to_owned(),
                ),
            ),
            None => (None, None),
        };

        // C18 P1.13: join-or-own (SQLite has no nested BEGIN), the `log_audit`
        // idiom. Transaction SHAPE only — no tenant is stamped here. Desktop is
        // single-tenant by construction and `check_tenant_integrity` refuses to
        // boot on a foreign-tenant products row (owner decision D9), so this
        // deliberately does not touch tenant_id.
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            Self::create_product_variant_on(&tx, variant, price_minor, currency_str.as_deref())?;
            let audit = crate::AuditEntry::new(
                "system",
                "product.update",
                Some("product"),
                Some(&variant.parent_sku),
                Some(
                    serde_json::json!({
                        "action": "create_variant",
                        "parent_sku": variant.parent_sku,
                        "variant_sku": variant.sku,
                        "variant_name": variant.name,
                    })
                    .to_string(),
                ),
                "success",
            );
            Self::log_audit_in_tx(&tx, &audit)?;
            tx.commit()?;
            Ok(())
        } else {
            Self::create_product_variant_on(
                self.conn,
                variant,
                price_minor,
                currency_str.as_deref(),
            )?;
            let audit = crate::AuditEntry::new(
                "system",
                "product.update",
                Some("product"),
                Some(&variant.parent_sku),
                Some(
                    serde_json::json!({
                        "action": "create_variant",
                        "parent_sku": variant.parent_sku,
                        "variant_sku": variant.sku,
                        "variant_name": variant.name,
                    })
                    .to_string(),
                ),
                "success",
            );
            self.log_audit(&audit)?;
            Ok(())
        }
    }

    /// The single INSERT, on a connection OR a caller-owned transaction.
    fn create_product_variant_on(
        conn: &rusqlite::Connection,
        variant: &ProductVariant,
        price_minor: Option<i64>,
        currency_str: Option<&str>,
    ) -> Result<(), CoreError> {
        // MSL-48: name the missing parent rather than leaking the raw FK failure —
        // the same mapping the bundle-item writer applies to its identical
        // `REFERENCES products(sku)` column. The parent SKU is free text in the
        // variant editor and the bridge only checks it is non-empty
        // (`product_variants.rs:271`), so a typo would otherwise read as a
        // storage fault with no field to correct.
        let result = conn.execute(
            "INSERT INTO product_variants (id, parent_sku, name, sku, price_minor, currency, barcode,
                                           sort_order, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                variant.id, variant.parent_sku, variant.name, variant.sku,
                price_minor, currency_str, variant.barcode.as_ref().map(foundation::Barcode::as_str),
                variant.sort_order, i64::from(variant.is_active),
                variant.created_at, variant.updated_at,
            ],
        );
        match result {
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Err(CoreError::NotFound {
                    entity: "product",
                    id: variant.parent_sku.clone(),
                })
            }
            Err(e) => Err(e.into()),
            Ok(_) => Ok(()),
        }
    }

    /// Update an existing product variant (matched by SKU).
    pub fn update_product_variant(&self, variant: &ProductVariant) -> Result<(), CoreError> {
        let (price_minor, currency_str) = match &variant.price {
            Some(m) => (
                Some(m.minor_units),
                Some(
                    std::str::from_utf8(&m.currency.0)
                        .unwrap_or("USD")
                        .to_owned(),
                ),
            ),
            None => (None, None),
        };

        // C18 P1.13: join-or-own, same shape and same tenant caution as
        // `create_product_variant` above.
        let affected = if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            let affected = Self::update_product_variant_on(
                &tx,
                variant,
                price_minor,
                currency_str.as_deref(),
            )?;
            if affected == 0 {
                tx.rollback()?;
            } else {
                let audit = crate::AuditEntry::new(
                    "system",
                    "product.update",
                    Some("product"),
                    Some(&variant.parent_sku),
                    Some(
                        serde_json::json!({
                            "action": "update_variant",
                            "parent_sku": variant.parent_sku,
                            "variant_sku": variant.sku,
                            "variant_name": variant.name,
                        })
                        .to_string(),
                    ),
                    "success",
                );
                Self::log_audit_in_tx(&tx, &audit)?;
                tx.commit()?;
            }
            affected
        } else {
            let affected = Self::update_product_variant_on(
                self.conn,
                variant,
                price_minor,
                currency_str.as_deref(),
            )?;
            if affected > 0 {
                let audit = crate::AuditEntry::new(
                    "system",
                    "product.update",
                    Some("product"),
                    Some(&variant.parent_sku),
                    Some(
                        serde_json::json!({
                            "action": "update_variant",
                            "parent_sku": variant.parent_sku,
                            "variant_sku": variant.sku,
                            "variant_name": variant.name,
                        })
                        .to_string(),
                    ),
                    "success",
                );
                self.log_audit(&audit)?;
            }
            affected
        };
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "product_variant",
                id: variant.sku.clone(),
            });
        }
        Ok(())
    }

    /// The single UPDATE, on a connection OR a caller-owned transaction.
    fn update_product_variant_on(
        conn: &rusqlite::Connection,
        variant: &ProductVariant,
        price_minor: Option<i64>,
        currency_str: Option<&str>,
    ) -> Result<usize, CoreError> {
        Ok(conn.execute(
            "UPDATE product_variants SET name = ?1, price_minor = ?2, currency = ?3,
                                          barcode = ?4, sort_order = ?5, is_active = ?6,
                                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE sku = ?7",
            params![
                variant.name,
                price_minor,
                currency_str,
                variant.barcode.as_ref().map(foundation::Barcode::as_str),
                variant.sort_order,
                i64::from(variant.is_active),
                variant.sku
            ],
        )?)
    }

    /// Delete a product variant by its own SKU.
    pub fn delete_product_variant(&self, sku: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let affected = tx.execute("DELETE FROM product_variants WHERE sku = ?1", params![sku])?;
        if affected == 0 {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "product_variant",
                id: sku.to_owned(),
            });
        }
        let audit = crate::AuditEntry::new(
            "system",
            "product.update",
            Some("product_variant"),
            Some(sku),
            Some(
                serde_json::json!({
                    "action": "delete_variant",
                    "variant_sku": sku,
                })
                .to_string(),
            ),
            "success",
        );
        Self::log_audit_in_tx(&tx, &audit)?;
        tx.commit()?;
        Ok(())
    }

    fn row_to_product_variant(row: &rusqlite::Row) -> rusqlite::Result<ProductVariant> {
        let price_minor: Option<i64> = row.get("price_minor")?;
        let currency_str: Option<String> = row.get("currency")?;
        let price = match (price_minor, currency_str) {
            (Some(minor), Some(cur)) => match cur.parse::<Currency>() {
                Ok(currency) => Some(Money {
                    minor_units: minor,
                    currency,
                }),
                // COR-14 (currency arm, same shape as the barcode one below):
                // the column is unconstrained TEXT, so a row written by an
                // import or carried through a migration can hold a code this
                // build does not know. Dropping it silently rendered the
                // variant as "no price" with no signal that a value was lost.
                Err(e) => {
                    tracing::warn!(
                        sku = row.get::<_, String>("sku").as_deref().unwrap_or("?"),
                        currency = %cur,
                        error = %e,
                        "product_variants.currency is not a valid currency code; \
                         the variant will report no price"
                    );
                    None
                }
            },
            _ => None,
        };

        // COR-14: `.ok()` here discarded the reason. `Barcode::new` rejects only
        // empty/whitespace-only input, so a `None` in the output means the STORED
        // column held an unusable value — data that exists and is being hidden.
        // `product_variants.barcode` is unconstrained `TEXT` (only the Rust
        // write paths validate), so sync payloads, imports and the
        // per-tenant-uniqueness migration can all carry one in. Warn rather than
        // vanish: the caller sees the same `None`, but the loss is now visible.
        let barcode_raw: Option<String> = row.get("barcode")?;
        let sku: String = row.get("sku")?;
        let barcode = match barcode_raw {
            Some(raw) => match foundation::Barcode::new(&raw) {
                Ok(b) => Some(b),
                Err(e) => {
                    tracing::warn!(
                        sku = %sku,
                        error = %e.message,
                        "product_variants.barcode holds a value this build cannot \
                         represent; the variant will report no barcode"
                    );
                    None
                }
            },
            None => None,
        };

        Ok(ProductVariant {
            id: row.get("id")?,
            parent_sku: row.get("parent_sku")?,
            name: row.get("name")?,
            sku,
            price,
            barcode,
            sort_order: row.get("sort_order")?,
            is_active: row.get::<_, i64>("is_active")? != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
