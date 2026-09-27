//! Product cloud-read/write serving layer for the cloud Postgres replica.
//!
//! Products are authored in the local SQLite store and mirrored into cloud
//! Postgres so terminals can read the tenant catalogue without a local copy.
//! This module owns the shared `PRODUCT_SELECT` projection, the row mapper
//! that turns it into `ProductWithDetails`, and the image-attachment pass that
//! runs inside the same transaction.
//!
//! Main functions: [`list_products`], [`get_product`], [`create_product`],
//! [`adjust_stock`], [`list_missing_hashes`].
//!
//! Invariant: every statement runs inside one transaction that has already
//! set `oz.tenant_id` LOCAL, exactly like the rest of the `pg` module.

use deadpool_postgres::Pool;

use kasirmu_core::{Currency, Money, Product, ProductWithDetails, Sku};

use super::{
    CANONICAL_DEFAULT_LOCATION_UUID, PG_IN_CHUNK, PG_LEAD_PARAMS, PgError, bump_snapshot_version,
    currency_str, is_unique_violation, now_rfc3339, pg_bool, pg_placeholders,
};

const PRODUCT_SELECT: &str = "SELECT p.id, p.sku, p.name, p.price_minor, p.currency, \
     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at, \
     p.track_serial, p.product_type, p.version, \
     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit, \
     p.is_active, p.default_supplier_id, p.popularity_score, p.image_hash, \
     c.name AS category_name, \
     COALESCE((SELECT SUM(ss.qty)::bigint FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty \
     FROM products p \
     LEFT JOIN categories c ON p.category_id = c.id \
     LEFT JOIN inventory i ON p.id = i.product_id";

/// Build a [`ProductWithDetails`] from a Postgres row (mirrors the SQLite
/// `row_to_product_with_details` mapper, including the `BIGINT` → `bool`
/// conversion for the boolean-ish columns).
fn pg_row_to_product_with_details(
    row: &tokio_postgres::Row,
) -> Result<ProductWithDetails, PgError> {
    let sku_str: String = row.try_get("sku").map_err(|e| PgError::Db(e.to_string()))?;
    let cur_str: String = row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let barcode_raw: Option<String> = row
        .try_get("barcode")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let product_type_str: String = row
        .try_get("product_type")
        .map_err(|e| PgError::Db(e.to_string()))?;
    // Keep serving the row on a failed parse and let the helper warn (its docs
    // carry why the Retail fallback is ambiguous; the column has no CHECK
    // constraint in either engine). Parsed here rather than in the literal below
    // so the warning names `sku_str` before it moves into `Sku::new`, instead of
    // re-reading the column.
    let product_type = kasirmu_core::ProductType::parse_stored_or_default(
        Some(product_type_str.as_str()),
        &sku_str,
        "pg_row_to_product_with_details",
    );

    let product = Product {
        id: row.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
        sku: Sku::new(sku_str),
        name: row
            .try_get("name")
            .map_err(|e| PgError::Db(e.to_string()))?,
        price: Money {
            minor_units: row
                .try_get("price_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency: cur_str
                .parse::<Currency>()
                .map_err(|e| PgError::Db(e.to_string()))?,
        },
        category_id: row
            .try_get("category_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // products.barcode is free text in both stores — a legacy or hand-edited
        // row can hold a value Barcode::new rejects. Degrading to None costs a
        // scan target, not a wrong fact, so the fallback stays — but None is
        // ambiguous between "no barcode" and "unreadable barcode", and the
        // warning is how you tell them apart.
        barcode: barcode_raw.and_then(|s| match foundation::Barcode::new(&s) {
            Ok(b) => Some(b),
            Err(_) => {
                // sku_str was moved into Sku::new above; re-read the row
                // identifier for the log line (NOT NULL column, cannot fail).
                let row_sku: String = row.try_get("sku").unwrap_or_default();
                tracing::warn!(
                    sku = %row_sku,
                    raw = %s,
                    "unparseable barcode on products row; serving the row without it"
                );
                None
            }
        }),
        created_at: row
            .try_get("created_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        price_updated_at: row
            .try_get("price_updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        track_serial: pg_bool(row, "track_serial")?,
        product_type,
        version: row
            .try_get("version")
            .map_err(|e| PgError::Db(e.to_string()))?,
        cost_minor: row
            .try_get("cost_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        brand: row
            .try_get("brand")
            .map_err(|e| PgError::Db(e.to_string()))?,
        rack_location: row
            .try_get("rack_location")
            .map_err(|e| PgError::Db(e.to_string()))?,
        notes: row
            .try_get("notes")
            .map_err(|e| PgError::Db(e.to_string()))?,
        unit: row
            .try_get("unit")
            .map_err(|e| PgError::Db(e.to_string()))?,
        is_active: pg_bool(row, "is_active")?,
        default_supplier_id: row
            .try_get("default_supplier_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // products.image_hash is nullable by design (a product may have no
        // image), so Ok(None) is a legitimate answer; only a type drift errors.
        // Keep the None fallback — a missing thumbnail link is a degraded
        // feature, not a wrong fact — but None is ambiguous between "no image"
        // and "unreadable column", and the warning is how you tell them apart.
        image_hash: match row.try_get::<_, Option<String>>("image_hash") {
            Ok(h) => h,
            Err(e) => {
                // sku_str was moved into Sku::new above; re-read the row
                // identifier for the log line (NOT NULL column, cannot fail).
                let row_sku: String = row.try_get("sku").unwrap_or_default();
                tracing::warn!(
                    sku = %row_sku,
                    error = %e,
                    "image_hash column unreadable on products row; serving the row without the image link"
                );
                None
            }
        },
    };

    Ok(ProductWithDetails {
        product,
        category_name: row
            .try_get("category_name")
            .map_err(|e| PgError::Db(e.to_string()))?,
        stock_qty: row
            .try_get("stock_qty")
            .map_err(|e| PgError::Db(e.to_string()))?,
        popularity_score: row
            .try_get("popularity_score")
            .map_err(|e| PgError::Db(e.to_string()))?,
        images: Vec::new(), // populated by the list/get loaders
    })
}

/// Load product image assignments for the given product IDs and attach
/// them to the respective `ProductWithDetails` (spec 0046b §3.4).
async fn attach_product_images(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
    products: &mut [ProductWithDetails],
) -> Result<(), PgError> {
    if products.is_empty() {
        return Ok(());
    }
    let ids: Vec<&str> = products.iter().map(|p| p.product.id.as_str()).collect();
    // THE CHUNK LOOP. `ids` carries one entry per product being listed, so its
    // length is a tenant's catalog size and not a fixed schema width —
    // `list_products` has no LIMIT. Chunks are DISJOINT by product_id and every
    // product lands in exactly one chunk, so one query per chunk computes the same
    // map as one query over the whole list (`ORDER BY slot` orders within a
    // product, so chunking cannot reorder it either). The loop runs inside the
    // CALLER's transaction — both `list_products` and `get_product` commit after
    // this returns — so splitting the read across statements changes no atomicity.
    // Nothing here falls back to an unscoped sweep when the list is long; that is
    // the hole PG_IN_CHUNK exists to close.
    let mut rows: Vec<tokio_postgres::Row> = Vec::new();
    for chunk in ids.chunks(PG_IN_CHUNK) {
        let sql = format!(
            "SELECT product_id, slot, hash, position FROM product_images \
             WHERE product_id IN ({}) ORDER BY slot ASC",
            pg_placeholders(1, chunk.len())
        );
        let stmt = tx
            .prepare(&sql)
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = chunk
            .iter()
            .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();
        let chunk_rows = tx
            .query(&stmt, &params)
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        rows.extend(chunk_rows);
    }
    let mut by_product: std::collections::HashMap<
        String,
        Vec<kasirmu_core::db::products::ProductImage>,
    > = std::collections::HashMap::new();
    for row in rows {
        let product_id: String = row
            .try_get("product_id")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let slot: i32 = row
            .try_get("slot")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let hash: String = row
            .try_get("hash")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let position: i32 = row
            .try_get("position")
            .map_err(|e| PgError::Db(e.to_string()))?;
        by_product
            .entry(product_id)
            .or_default()
            .push(kasirmu_core::db::products::ProductImage {
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
    let _ = tenant_id; // RLS scoping already applied on the transaction
    Ok(())
}

/// Compute the `missing_hashes` set-difference for a tenant (spec 0046b
/// §3.4/§3.7): candidate hashes that the tenant references but the cloud's
/// `image_refs` spine has no active (refcount > 0) row for. The desktop
/// pushes exactly these first.
pub async fn list_missing_hashes(
    pool: &Pool,
    tenant_id: &str,
    candidates: &[String],
) -> Result<Vec<String>, PgError> {
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // THE CHUNK LOOP, and the ACCUMULATOR the chunks feed. `candidates` is a
    // caller-supplied list — `?hashes=a,b,c` on GET /api/v1/images:missing, or
    // every distinct image hash in a tenant's catalog from `list_products` — so
    // its length is unbounded and each value costs one parameter. Chunks are
    // DISJOINT by hash and this query is a pure filter, so the union of the
    // per-chunk hits is exactly the set one query over the whole list returns.
    // The loop sits inside the transaction this function already opens and commits
    // below, so splitting the read across statements changes no atomicity.
    //
    // The hash list starts at $2, NOT $1: $1 is the tenant id, which `params`
    // binds first. Numbering it from $1 both collided with the tenant value and
    // left one MORE parameter than the statement declared, which PostgreSQL
    // rejects at Bind time ("bind message supplies N+1 parameters, but prepared
    // statement requires N") — so every non-empty call here failed, and both
    // callers swallow the error into an empty `missing_hashes`.
    let mut present: std::collections::HashSet<String> = std::collections::HashSet::new();
    for chunk in candidates.chunks(PG_IN_CHUNK) {
        let sql = format!(
            "SELECT hash FROM image_refs WHERE tenant_id = $1 AND hash IN ({}) AND refcount > 0",
            pg_placeholders(1 + PG_LEAD_PARAMS, chunk.len())
        );
        let stmt = tx
            .prepare(&sql)
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
            Vec::with_capacity(chunk.len() + PG_LEAD_PARAMS);
        params.push(&tenant_id as &(dyn tokio_postgres::types::ToSql + Sync));
        for c in chunk {
            params.push(c);
        }
        let rows = tx
            .query(&stmt, &params)
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        present.extend(rows.iter().map(|r| r.get::<_, String>("hash")));
    }
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(candidates
        .iter()
        .filter(|c| !present.contains(*c))
        .cloned()
        .collect())
}

/// List a tenant's products, ordered by name, with category name and stock.
pub async fn list_products(
    pool: &Pool,
    tenant_id: &str,
) -> Result<Vec<ProductWithDetails>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let rows = tx
        .query(
            &format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name"),
            &[&tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut result: Vec<ProductWithDetails> = rows
        .iter()
        .map(pg_row_to_product_with_details)
        .collect::<Result<_, _>>()?;
    attach_product_images(&tx, tenant_id, &mut result).await?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(result)
}

/// Get a single product by SKU (tenant-scoped), including category name and
/// stock. SKUs are unique per tenant, so the lookup must be scoped.
pub async fn get_product(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
) -> Result<Option<ProductWithDetails>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let row = tx
        .query_opt(
            &format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.sku = $2"),
            &[&tenant_id, &sku],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut result = row.map(|r| pg_row_to_product_with_details(&r)).transpose();
    // Attach images for the single product.
    if let Ok(Some(ref mut p)) = result {
        let slice = std::slice::from_mut(p);
        attach_product_images(&tx, tenant_id, slice).await?;
    }
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Create a product (scoped to `tenant_id`), mirroring the SQLite path:
/// the product row plus — for `initial_stock > 0` — the `inventory`,
/// `stock_movements` ledger, and `stock_summary` rows in one transaction.
#[allow(clippy::too_many_arguments)]
pub async fn create_product(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
    name: &str,
    price: Money,
    category_id: Option<&str>,
    barcode: Option<&str>,
    initial_stock: i64,
) -> Result<ProductWithDetails, PgError> {
    if sku.trim().is_empty() {
        return Err(PgError::Validation("SKU must not be empty".into()));
    }
    if sku.len() > 50 {
        return Err(PgError::Validation(format!(
            "SKU must not exceed 50 characters, got {}",
            sku.len()
        )));
    }
    if name.trim().is_empty() {
        return Err(PgError::Validation("name must not be empty".into()));
    }
    // COR-12, cloud half: the same 255-char ceiling the SQLite branch of this
    // route enforces via `Store::create_product`. Both branches serve
    // `POST /api/v1/products`, so without this the cloud accepted a name the
    // embedded/local branch refused. The PG column is plain TEXT (no length
    // constraint), so this check is the whole rule on both sides.
    if name.len() > 255 {
        return Err(PgError::Validation(format!(
            "name must not exceed 255 characters, got {}",
            name.len()
        )));
    }
    if price.minor_units < 0 {
        return Err(PgError::Validation("price must be ≥ 0".into()));
    }
    if initial_stock < 0 {
        return Err(PgError::Validation("initial_stock must be ≥ 0".into()));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    let cur_str = currency_str(&price.currency)?;

    if let Err(e) = tx
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, \
             created_at, updated_at, price_updated_at, track_serial, product_type, version, \
             cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, 0, 'retail', 1, 0, NULL, NULL, NULL, NULL, 1, NULL, $9)",
            &[
                &id,
                &sku.trim(),
                &name.trim(),
                &price.minor_units,
                &cur_str,
                &category_id,
                &barcode,
                &now,
                &tenant_id,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        return Err(PgError::Db(e.to_string()));
    }

    if initial_stock > 0 {
        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES ($1, $2, $3)",
            &[&id, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
        let movement_id = uuid::Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason, source_terminal_id, source_user_id, created_at)
             VALUES ($1, $2, $3, 'initial-stock', NULL, NULL, $4)",
            &[&movement_id, &id, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
        tx.execute(
            "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
            &[&id, &CANONICAL_DEFAULT_LOCATION_UUID, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(ProductWithDetails {
        product: Product {
            id,
            sku: Sku::new(sku.trim()),
            name: name.trim().to_owned(),
            price,
            category_id: category_id.map(str::to_owned),
            barcode: barcode.and_then(|s| foundation::Barcode::new(s).ok()),
            created_at: now.clone(),
            updated_at: now.clone(),
            price_updated_at: now,
            track_serial: false,
            product_type: kasirmu_core::ProductType::Retail,
            version: 1,
            cost_minor: 0,
            brand: None,
            rack_location: None,
            notes: None,
            unit: None,
            is_active: true,
            default_supplier_id: None,
            image_hash: None,
        },
        category_name: None,
        stock_qty: if initial_stock > 0 {
            Some(initial_stock)
        } else {
            None
        },
        popularity_score: 0.0,
        images: Vec::new(),
    })
}

/// Outcome of a stock adjustment.
#[derive(Debug, Clone, Copy)]
pub struct StockAdjustment {
    /// Stock before the adjustment.
    pub previous_qty: i64,
    /// Stock after the adjustment.
    pub new_qty: i64,
}

/// Adjust stock by SKU, mirroring the SQLite `adjust_stock` path: read the
/// previous quantity, reject negative stock, and write the `stock_movements`
/// ledger + `inventory` + `stock_summary` rows in one transaction.
///
/// The whole read-modify-write runs inside the transaction with the product
/// row locked (`SELECT … FOR UPDATE`), so concurrent adjustments to the same
/// SKU serialize instead of losing updates — SQLite's single-writer
/// semantics made the read-outside-tx shape safe there, Postgres does not.
pub async fn adjust_stock(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
    delta: i64,
) -> Result<StockAdjustment, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // Lock the product row first: every adjustment to this SKU contends on
    // the same row lock, so the inventory read below always sees the latest
    // committed quantity (and the `inventory` row, when missing, is created
    // by the first locker before the second reads it).
    let product_id: Option<String> = tx
        .query_opt(
            "SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE",
            &[&tenant_id, &sku],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get(0));
    let product_id = match product_id {
        Some(id) => id,
        None => return Err(PgError::NotFound),
    };

    let previous_qty: i64 = tx
        .query_opt(
            "SELECT qty FROM inventory WHERE product_id = $1",
            &[&product_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get::<_, i64>(0))
        .unwrap_or(0);

    let new_qty = previous_qty
        .checked_add(delta)
        .filter(|&v| v >= 0)
        .ok_or_else(|| {
            PgError::Validation(format!(
                "adjustment would cause negative stock (previous: {previous_qty}, delta: {delta})"
            ))
        })?;

    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO stock_movements (id, item_id, delta, reason, source_terminal_id, source_user_id, created_at)
         VALUES ($1, $2, $3, NULL, NULL, NULL, $4)",
        &[&uuid::Uuid::now_v7().to_string(), &product_id, &delta, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO inventory (product_id, qty, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (product_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
        &[&product_id, &new_qty, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
        &[&product_id, &CANONICAL_DEFAULT_LOCATION_UUID, &new_qty, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(StockAdjustment {
        previous_qty,
        new_qty,
    })
}
