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

use super::PgError;
use super::helpers::{
    CANONICAL_DEFAULT_LOCATION_UUID, PG_IN_CHUNK, PG_LEAD_PARAMS, bump_snapshot_version,
    currency_str, is_unique_violation, now_rfc3339, pg_bool, pg_placeholders,
};

/// Maximum number of products one page of [`list_products_page`] returns when
/// the caller asks for none, or asks for too many (debt entry O-H12).
///
/// A bound is only honest when the caller is TOLD it applied — see
/// [`ProductPage::has_more`], which is derived by fetching one row PAST this
/// cap rather than by comparing the page length to it.
pub const DEFAULT_PRODUCT_PAGE_LIMIT: usize = 100;

/// Ceiling on a caller-supplied page size for [`list_products_page`]. A
/// request above it is CLAMPED, not rejected, and `has_more` still tells the
/// truth about whether a continuation row exists.
pub const MAX_PRODUCT_PAGE_LIMIT: usize = 500;

/// One keyset page of a tenant's catalogue.
///
/// Keyset — not OFFSET — because the catalogue changes while a client walks
/// it: an OFFSET page means "skip N rows of whatever the ORDER BY produces at
/// read time", so a product renamed or inserted mid-walk is served twice or
/// skipped entirely. A keyset page resumes from the last row actually
/// delivered, so it can neither repeat a product nor jump over one whose
/// `(name, sku)` did not change. A product RE-keyed between two pages can
/// still be missed — the standard keyset caveat, and strictly smaller than
/// OFFSET's.
#[derive(Debug, Clone)]
pub struct ProductPage {
    /// The rows of this page, in `(name, sku)` order, each product once.
    pub products: Vec<ProductWithDetails>,
    /// The `sku` to pass back as `after` for the next page, or `None` when
    /// this page is the last one. Never present when `products` is empty.
    ///
    /// `Some` here is the EXPLICIT signal that the response was bounded: a
    /// client that ignores it has been told it did not receive everything,
    /// which is the difference between a bounded read and a silent
    /// truncation.
    pub next_after: Option<String>,
    /// Whether more products exist beyond this page. **Derived from a row the
    /// response does not contain**, not from `products.len() == limit`: a
    /// catalogue whose size is an exact multiple of the page size otherwise
    /// advertises one page more than exists.
    pub has_more: bool,
}

/// Relational form of one product's stock, as the projection derives it.
///
/// The projection reads `COALESCE(SUM(stock_summary.qty), inventory.qty)`, so
/// a product with no `stock_summary` row falls back to the legacy
/// `inventory.qty` aggregate. The two cases are separated here, rather than
/// left in SQL, so a plain Rust test can pin the semantics without Postgres.
///
/// Invariant: this must stay the ONLY place that decides which qty wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductStock {
    /// No `stock_summary` row at all: report the aggregate, including a NULL
    /// one (a product with neither table row has unknown stock, not zero).
    NoLocationRows(Option<i64>),
    /// At least one `stock_summary` row: report their sum.
    LocationRows(i64),
}

/// Resolve [`ProductStock`] into the `stock_qty` a `ProductWithDetails` carries.
fn product_stock_qty(stock: ProductStock) -> Option<i64> {
    match stock {
        ProductStock::NoLocationRows(aggregate) => aggregate,
        ProductStock::LocationRows(sum) => Some(sum),
    }
}

/// The projection shared by every product read, WITHOUT the `WHERE` and
/// `ORDER BY` the caller adds.
///
/// **The stock column is a lateral aggregate, not a correlated subquery and
/// not a plain join.** Each alternative fails on this schema partway through
/// a catalogue walk:
///
/// * bare `LEFT JOIN stock_summary ss ON ss.item_id = p.id` — WRONG. The key
///   is `(item_id, location_id)` (ADR-18), so a product stocked at three
///   locations yields three rows: page 1 contains duplicates of it, each with
///   a PARTIAL quantity.
/// * `LEFT JOIN (SELECT item_id, SUM(qty) FROM stock_summary GROUP BY
///   item_id)` — wrong for PAGING. With no predicate on `item_id` the planner
///   may aggregate EVERY tenant's `stock_summary` before serving page 1, so
///   page 1 costs as much as the whole catalogue and a walk costs N times a
///   full scan — worse than the subquery it replaces.
/// * `LEFT JOIN LATERAL (SELECT … FROM stock_summary WHERE item_id = p.id) ON
///   TRUE` — one aggregate per ROW, answered by `stock_summary_pkey` on
///   `(item_id, location_id)`, and exactly one output row always. An
///   aggregate with no matching row yields NULL, not zero rows, so a product
///   with NO `stock_summary` rows survives the join; `COALESCE(sk.ss_qty,
///   i.qty)` then falls back to the legacy `inventory.qty` exactly as the
///   subquery did.
///
/// Tenant scope comes for free: `stock_summary` and `inventory` key on
/// `products.id`, and `p` is already restricted to `tenant_id = $1`.
const PRODUCT_SELECT: &str = "SELECT p.id, p.sku, p.name, p.price_minor, p.currency, \
     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at, \
     p.track_serial, p.product_type, p.version, \
     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit, \
     p.is_active, p.default_supplier_id, p.popularity_score, p.image_hash, \
     c.name AS category_name, \
     COALESCE(sk.ss_qty, i.qty) AS stock_qty, \
     sk.ss_has_rows AS stock_has_location_rows, \
     sk.ss_qty AS ss_qty \
     FROM products p \
     LEFT JOIN categories c ON p.category_id = c.id \
     LEFT JOIN inventory i ON p.id = i.product_id \
     LEFT JOIN LATERAL ( \
         SELECT bool_or(true) AS ss_has_rows, SUM(ss.qty)::bigint AS ss_qty \
         FROM stock_summary ss WHERE ss.item_id = p.id \
     ) sk ON TRUE";

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
        // Which qty wins is decided ONCE, in `product_stock_qty` — the row
        // carries the two facts, not the merged answer, so the rule is a
        // plain Rust function a test can pin (see `products_tests.rs`).
        //
        // `ss_qty` is NULL whenever `ss_has_rows` is NULL (the lateral
        // aggregate returned its single all-NULL row), which is why the two
        // are read together and resolved here rather than in SQL.
        stock_qty: product_stock_qty({
            let has_location_rows: Option<bool> = row
                .try_get("stock_has_location_rows")
                .map_err(|e| PgError::Db(e.to_string()))?;
            let ss_qty: Option<i64> = row
                .try_get("ss_qty")
                .map_err(|e| PgError::Db(e.to_string()))?;
            match has_location_rows {
                Some(true) => ProductStock::LocationRows(ss_qty.unwrap_or(0)),
                _ => ProductStock::NoLocationRows(
                    row.try_get("stock_qty")
                        .map_err(|e| PgError::Db(e.to_string()))?,
                ),
            }
        }),
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

/// List EVERY product of a tenant, ordered by `(name, sku)`, with category
/// name and stock.
///
/// This is the UNBOUNDED read — it materialises the whole catalogue into one
/// `Vec` and streams it back in one response. It still exists because several
/// callers legitimately need the complete set; every one of them is named in
/// the body's comment. A new caller that only needs A page must use
/// [`list_products_page`] instead.
///
/// Debt entry O-H12: this function must never again be reachable from a
/// plain `GET /api/v1/products` with no bound — the route uses
/// [`list_products_page`] and reports `has_more`.
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
    // `ORDER BY (p.name, p.sku)` — the SAME total order the keyset pages
    // walk, so an unbounded read and a concatenation of pages agree row for
    // row. `idx_products_tenant_sku` on `(tenant_id, sku)` makes the tiebreak
    // free; without it `p.sku` is the tiebreak that keeps the keyset
    // comparison total (a name alone is not unique).
    let rows = tx
        .query(
            &format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name, p.sku"),
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

/// One keyed page of a tenant's products, ordered by `(name, sku)`.
///
/// `limit` is clamped to `1..=MAX_PRODUCT_PAGE_LIMIT`, so the read is always
/// bounded even when the caller passes nothing or passes `usize::MAX`.
/// `after` is the `sku` of the last product the previous page delivered
/// (i.e. [`ProductPage::next_after`]); `None` starts at the first product.
///
/// The continuation key is the SKU but the comparison is on the whole
/// `(name, sku)` pair, resolved to that SKU's row inside the same
/// STABLE-snapshot transaction: the keyset must compare the SAME tuple the
/// `ORDER BY` sorts on, or a product would be skipped. Carrying the whole
/// pair in the token instead was rejected because a SKU may contain any
/// character a name can, so a client-built `(name, sku)` token is
/// ambiguous to split — and a SKU delimiter is a data-corruption waiting to
/// happen. An `after` that matches no row of this tenant (a product deleted
/// mid-walk) simply starts from the beginning; that is unreachable through a
/// token this function issued, and failing closed there would break a walk
/// for no benefit.
pub async fn list_products_page(
    pool: &Pool,
    tenant_id: &str,
    limit: Option<usize>,
    after: Option<&str>,
) -> Result<ProductPage, PgError> {
    let limit = limit
        .unwrap_or(DEFAULT_PRODUCT_PAGE_LIMIT)
        .clamp(1, MAX_PRODUCT_PAGE_LIMIT);
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // One row PAST the page is fetched, and that row is what `has_more`
    // reports on. Comparing `rows.len() == limit` instead would report a
    // final page as "has more" whenever the catalogue size is an exact
    // multiple of the page size — the client would then follow `next_after`
    // into an empty page and, if it stopped on `products.is_empty()`, still be
    // correct but waste a round trip; if it displayed a page counter, wrong.
    let probe_limit = limit.saturating_add(1) as i64;
    let rows = match after {
        Some(cursor) => {
            let stmt = tx
                .prepare(&format!(
                    "{PRODUCT_SELECT} \
                     WHERE p.tenant_id = $1 \
                       AND (p.name, p.sku) > (SELECT p2.name, p2.sku FROM products p2 \
                                               WHERE p2.tenant_id = $1 AND p2.sku = $2) \
                     ORDER BY p.name, p.sku \
                     LIMIT $3"
                ))
                .await
                .map_err(|e| PgError::Db(e.to_string()))?;
            tx.query(&stmt, &[&tenant_id, &cursor, &probe_limit])
                .await
                .map_err(|e| PgError::Db(e.to_string()))?
        }
        None => {
            let stmt = tx
                .prepare(&format!(
                    "{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name, p.sku LIMIT $2"
                ))
                .await
                .map_err(|e| PgError::Db(e.to_string()))?;
            tx.query(&stmt, &[&tenant_id, &probe_limit])
                .await
                .map_err(|e| PgError::Db(e.to_string()))?
        }
    };

    let has_more = rows.len() > limit;
    let mut page: Vec<ProductWithDetails> = rows
        .iter()
        .take(limit)
        .map(pg_row_to_product_with_details)
        .collect::<Result<_, _>>()?;
    let next_after = if has_more {
        page.last().map(|p| p.product.sku.as_str().to_owned())
    } else {
        None
    };
    // Images are attached for the PAGE only — bounded like the rest of this
    // read, and the chunk loop in `attach_product_images` now sees at most
    // `MAX_PRODUCT_PAGE_LIMIT` ids per call.
    attach_product_images(&tx, tenant_id, &mut page).await?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(ProductPage {
        products: page,
        next_after,
        has_more,
    })
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
    if sku.chars().count() > 50 {
        return Err(PgError::Validation(format!(
            "SKU must not exceed 50 characters, got {}",
            sku.chars().count()
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
    if name.chars().count() > 255 {
        return Err(PgError::Validation(format!(
            "name must not exceed 255 characters, got {}",
            name.chars().count()
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

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
