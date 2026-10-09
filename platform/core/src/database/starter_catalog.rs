//! Starter-catalog replication from the global identity DB into a store DB.
//!
//! THE DEFECT THIS EXISTS FOR (F14a, measured on the tablet 2026-10-09):
//! `provision_device` seeds five sample products, but it writes the GLOBAL
//! identity database. The restaurant POS reads the STORE database
//! (`list_products_scoped` -> `resolve_scope` -> `db_manager.open_store`).
//! Nothing copied `products` between them, so a freshly provisioned
//! restaurant terminal rendered an EMPTY MENU it could not fill:
//!
//! ```text
//! kasir.db (global, where the seed landed)      products: 5
//! store-loc-...sqlite (what the POS reads)      products: 0
//! ```
//!
//! The empty state is indistinguishable from a legitimately empty catalog
//! (`useProducts` renders 'Menu is empty' with no error and no Retry), so the
//! operator gets no signal and every restaurant beta script has to begin by
//! hand-adding a product.
//!
//! WHY HERE. The seed CANNOT run in `provision_device`: at provisioning time
//! the store DB does not exist and its id is not known (the file is created by
//! `open_store` on first use, `store_id` is caller-supplied to
//! `create_session`). This module runs from `create_session`, immediately after
//! `open_store` has created-and-migrated the file, which is the earliest moment
//! a store DB exists. It is the same seam, and the same reasoning, as the
//! session-user replication beside it in this directory.
//!
//! SCOPE, DELIBERATELY NARROW. Only the catalog the provisioning seed itself
//! writes is replicated, and only rows that are still shaped like samples:
//! every `SMPL-<TYPE>-NN` sku that the global DB still holds. That is not a
//! general global->store copy and must not become one: the CLI's
//! `copy_reference_data` copies ALL rows of seven tables, which is right for a
//! demo seeder and wrong at session time, where it would re-inject rows an
//! operator had deliberately changed or deleted.
//!
//! It runs ONCE per store: every sample row is inserted only when the store
//! holds no products at all, so a store whose catalog was emptied on purpose
//! is left alone rather than refilled on the next login.

use crate::error::PlatformError;
use rusqlite::Connection;

/// SKU prefix that marks a row as provisioning's own starter catalog.
///
/// `provisioning.rs` writes `SMPL-REST-01..05` for the restaurant preset and
/// `SMPL-RETAIL-01..05` for retail. Matching the prefix rather than a
/// hard-coded list keeps this correct if the seeder gains a sixth sample.
const SAMPLE_SKU_PREFIX: &str = "SMPL-";

/// Copy provisioning's starter catalog from the global DB into a store DB.
///
/// Returns the number of product rows inserted, or `Ok(0)` when there is
/// nothing to do. Three independent conditions can make that zero, and all of
/// them are non-errors: the store already holds products (so the catalog is
/// the operator's, not ours), the global DB has no sample rows (provisioning
/// ran with the seed unchecked), or the store already holds that sku.
///
/// The writes run in ONE transaction. A half-seeded catalog would leave a
/// menu that is wrong in a way nothing reports, which is the failure mode
/// this whole module exists to remove.
pub fn ensure_starter_catalog_in_store(
    global: &Connection,
    store: &Connection,
) -> Result<usize, PlatformError> {
    // Bail before touching the store when it already has a catalog. This is
    // the guard that keeps a deliberate deletion deleted, so it is checked
    // first and against `products` as a whole rather than against our skus: a
    // store holding even one real product has been used and is not a fresh
    // install.
    let existing: i64 = store
        .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .map_err(|e| PlatformError::Internal(format!("counting store products: {e}")))?;
    if existing > 0 {
        return Ok(0);
    }

    let samples = read_sample_products(global)?;
    if samples.is_empty() {
        return Ok(0);
    }

    let tx = store
        .unchecked_transaction()
        .map_err(|e| PlatformError::Internal(format!("store db transaction: {e}")))?;
    let mut inserted = 0usize;
    for row in &samples {
        tx.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, product_type, is_active, store_id, tenant_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?10)
             ON CONFLICT DO NOTHING",
            rusqlite::params![
                row.id,
                row.sku,
                row.name,
                row.price_minor,
                row.currency,
                row.category_id,
                row.product_type,
                row.is_active,
                row.tenant_id,
                row.created_at
            ],
        )
        .map_err(|e| PlatformError::Internal(format!("store db product insert: {e}")))?;
        inserted += 1;
    }

    tx.commit()
        .map_err(|e| PlatformError::Internal(format!("store db commit: {e}")))?;
    Ok(inserted)
}

/** One sample product row, read from the global DB. */
struct SampleProduct {
    id: String,
    sku: String,
    name: String,
    price_minor: i64,
    currency: String,
    category_id: Option<String>,
    product_type: String,
    is_active: i64,
    tenant_id: String,
    created_at: String,
}

/// Read provisioning's sample products from the global DB.
///
/// The `store_id IS NULL` predicate is load-bearing: `provision_device` writes
/// its samples unscoped, so a row carrying a store id belongs to some store
/// already and is not ours to copy.
fn read_sample_products(global: &Connection) -> Result<Vec<SampleProduct>, PlatformError> {
    let mut stmt = global
        .prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, product_type, is_active, tenant_id, created_at
             FROM products
             WHERE sku LIKE ?1 AND store_id IS NULL
             ORDER BY sku",
        )
        .map_err(|e| PlatformError::Internal(format!("preparing sample product read: {e}")))?;

    let pattern = format!("{SAMPLE_SKU_PREFIX}%");
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SampleProduct {
                id: r.get(0)?,
                sku: r.get(1)?,
                name: r.get(2)?,
                price_minor: r.get(3)?,
                currency: r.get(4)?,
                category_id: r.get(5)?,
                product_type: r.get(6)?,
                is_active: r.get(7)?,
                tenant_id: r.get(8)?,
                created_at: r.get(9)?,
            })
        })
        .map_err(|e| PlatformError::Internal(format!("reading sample products: {e}")))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| PlatformError::Internal(format!("mapping sample products: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal slice of the real schema: the columns this module touches.
    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE products (
                id          TEXT PRIMARY KEY,
                sku         TEXT NOT NULL,
                name        TEXT NOT NULL,
                price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
                currency    TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                category_id TEXT,
                product_type TEXT NOT NULL DEFAULT 'retail',
                store_id    TEXT,
                tenant_id   TEXT NOT NULL DEFAULT 'default',
                is_active INTEGER NOT NULL DEFAULT 1
             );",
        )
        .unwrap();
    }

    fn insert_product(conn: &Connection, sku: &str, store_id: Option<&str>) {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, product_type, store_id, tenant_id, is_active)
             VALUES (?1, ?2, 'P', 15000, 'IDR', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'restaurant', ?3, 'default', 1)",
            rusqlite::params![format!("id-{sku}"), sku, store_id],
        )
        .unwrap();
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
            .unwrap()
    }

    /// The measured F14a state: five samples in global, nothing in store.
    #[test]
    fn seeds_a_fresh_store_from_the_global_samples() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        for i in 1..=5 {
            insert_product(&global, &format!("SMPL-REST-{i:02}"), None);
        }

        assert_eq!(
            ensure_starter_catalog_in_store(&global, &store).unwrap(),
            5,
            "all five provisioning samples must reach the store"
        );
        assert_eq!(count(&store), 5);
    }

    /// The guard that makes this safe on every login.
    #[test]
    fn leaves_a_store_that_already_has_products_alone() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        for i in 1..=5 {
            insert_product(&global, &format!("SMPL-REST-{i:02}"), None);
        }
        insert_product(&store, "REAL-01", None);

        assert_eq!(
            ensure_starter_catalog_in_store(&global, &store).unwrap(),
            0,
            "a store with a catalog must not be refilled"
        );
        assert_eq!(count(&store), 1, "the operator's row must be untouched");
    }

    #[test]
    fn is_idempotent_across_calls() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        for i in 1..=5 {
            insert_product(&global, &format!("SMPL-REST-{i:02}"), None);
        }

        assert_eq!(ensure_starter_catalog_in_store(&global, &store).unwrap(), 5);
        assert_eq!(
            ensure_starter_catalog_in_store(&global, &store).unwrap(),
            0,
            "the second call must find the store already stocked"
        );
        assert_eq!(count(&store), 5, "and must not duplicate");
    }

    #[test]
    fn copies_nothing_when_the_global_db_has_no_samples() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        insert_product(&global, "NOT-A-SAMPLE", None);

        assert_eq!(ensure_starter_catalog_in_store(&global, &store).unwrap(), 0);
        assert_eq!(count(&store), 0, "a non-sample must never be copied");
    }

    #[test]
    fn never_copies_a_sample_that_carries_a_store_id() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        insert_product(&global, "SMPL-REST-99", Some("store-other"));

        assert_eq!(ensure_starter_catalog_in_store(&global, &store).unwrap(), 0);
        assert_eq!(count(&store), 0, "a store-scoped row is not ours to copy");
    }
}
