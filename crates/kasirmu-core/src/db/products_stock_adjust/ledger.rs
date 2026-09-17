//! Ledger reads and the scoped, self-healing summary rebuild (part of
//! the `products_stock_adjust` module).
//!
//! Key functions: `get_stock_from_ledger`, `rebuild_stock_summary`
//! (wrapper over every product the rebuild can touch) and
//! `rebuild_stock_summary_for` (scoped rebuild that first closes legacy
//! ledger shortfalls with one deterministic `legacy-backfill` movement
//! per shortfall before rebuilding from the ledger).
//!
//! Invariants: the delta ledger is authoritative once healed; chunked
//! id binding keeps every statement inside the SQLITE_MAX_VARIABLE_NUMBER
//! ceiling; an empty scope rebuilds nothing.

use super::*;

impl Store<'_> {
    /// Compute the current stock quantity from the delta ledger (ADR #6).
    ///
    /// Returns `SUM(delta)` from `stock_movements` for the given product.
    /// Falls back to `inventory.qty` if the ledger table has no rows yet
    /// (backward compatibility with pre-migration databases).
    pub fn get_stock_from_ledger(&self, product_id: &str) -> Result<i64, CoreError> {
        let result = self.conn.query_row(
            "SELECT SUM(delta) FROM stock_movements WHERE item_id = ?1",
            params![product_id],
            |row| row.get::<_, Option<i64>>(0),
        );

        match result {
            Ok(Some(sum)) => Ok(sum),
            Ok(None) => {
                // No deltas yet — fall back to inventory table.
                self.get_stock(product_id)
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Rebuild the materialised `stock_summary` and `inventory` tables from the
    /// delta ledger (ADR #6 + ADR-18 §2c + ADR-19 §1).
    ///
    /// After ADR-18 migration 089, `stock_summary` has a composite PRIMARY
    /// KEY (item_id, location_id). The rebuild MUST aggregate the delta ledger
    /// by BOTH columns — not by `item_id` alone — otherwise per-location stock
    /// is silently funneled into the canonical default UUID and the §9 alert
    /// system queries return aggregated cross-location totals instead of
    /// per-location vectors. This is ADR-19 §15 criterion 19-1.
    ///
    /// `inventory` still has a single-PK on `product_id` (ADR-18 §2a's
    /// composite-PK rebuild is deferred), so it aggregates per product across
    /// all locations. Per-location authoritative stock now lives in
    /// `stock_summary`. Legacy `inventory` is preserved here as a sum-of-all
    /// locations approximation for backward-compat callers.
    ///
    /// This is called after a sync cycle receives new deltas from other
    /// registers or the cloud, ensuring the materialised cache is consistent
    /// with the authoritative ledger. Runs in a single transaction for atomicity.
    ///
    /// **Returns** the number of `(item_id, location_id)` tuples rebuilt —
    /// NOT the number of distinct products. Post-refactor the count is
    /// higher for products stored across multiple locations.
    /// Rebuild the materialised caches for EVERY product the rebuild can
    /// touch — the operator/tooling surface. Thin wrapper over
    /// [`Store::rebuild_stock_summary_for`]; see that function for the healing
    /// step and for why the scope is what it is.
    ///
    /// The scope is `DISTINCT item_id FROM stock_movements` UNION `DISTINCT
    /// item_id FROM stock_summary` — exactly the set the old table-wide
    /// `DELETE FROM stock_summary` (no WHERE) could reach: every product the
    /// ledger can rebuild, plus every product whose stale summary rows must be
    /// cleared. The two `platform_sync` daemon callers are therefore unchanged
    /// in semantics; they gain the healing, they do not lose the sweep.
    pub fn rebuild_stock_summary(&self) -> Result<usize, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT item_id FROM stock_movements \
             UNION SELECT DISTINCT item_id FROM stock_summary",
        )?;
        let product_ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<String>, _>>()?;
        drop(stmt);
        self.rebuild_stock_summary_for(&product_ids)
    }

    /// Rebuild the materialised `stock_summary` and `inventory` caches for
    /// exactly the named products, FIRST closing any legacy ledger shortfall.
    ///
    /// THE HOLE THIS HEALS. `stock_summary` is derived from `stock_movements`,
    /// and stock that predates ADR #6 (or the demo seed) sits in `inventory`
    /// with NO movement behind it. A rebuild re-derives from the ledger, so
    /// those units are destroyed — and the legacy-aware fallback
    /// ([`Store::product_has_location_rows`]) cannot save them, because it
    /// fires only while a product has NO summary rows, which is precisely what
    /// a rebuild removes. The guard stops firing on exactly the products it was
    /// protecting.
    ///
    /// THE FIX, scoped and self-healing, with no migration anywhere: inside the
    /// supplied scope, close each POSITIVE ledger shortfall by writing ONE
    /// compensating movement, then rebuild from the ledger as before. The
    /// ledger becomes complete, so every FUTURE rebuild — scoped or not — stays
    /// a pure function of the CRDT state.
    ///
    /// THE PREDICATE. Backfill ONLY where `inventory.qty` exceeds
    /// `COALESCE(SUM(stock_movements.delta), 0)` AND either the product has no
    /// summary rows OR its summary total equals its `inventory` row. The second
    /// clause is what excludes the stale-inventory false positive: when
    /// `allow_negative` skips the inventory write, the summary sits BELOW the
    /// ledger and a backfill would invent units that never existed. "Product
    /// has no summary rows" alone is NOT the predicate — the legacy bridge in
    /// this same module already materialises summary rows out of `inventory`
    /// with no movement behind them, so on any install that ran db4106e52 that
    /// test reads false while the ledger is still short.
    ///
    /// SYNC SAFETY: no exclusion mechanism is needed, and one would be wrong.
    /// Push reads ONLY `offline_queue`; nothing scans `stock_movements`, and
    /// `sync_pull` has zero references to `stock_movements`, `stock_summary` or
    /// `inventory` — a locally-written movement never leaves the device. The
    /// deterministic id is belt-and-braces, not load-bearing.
    ///
    /// The compensating row is user-visible in [`Store::list_stock_movements`]
    /// and in any audit export, so it is logged once at `info!` with the sku
    /// when — and only when — something was healed. This is not the hot path:
    /// it runs at the end of a sync cycle, never per write.
    ///
    /// An EMPTY `product_ids` rebuilds NOTHING and returns 0. That is a hard
    /// guarantee, not a convenience: `WHERE item_id IN ()` is a syntax error,
    /// and the tempting "skip the filter when the list is empty" degradation is
    /// exactly how the scoping would quietly undo itself back into the
    /// table-wide sweep this replaces.
    ///
    /// **Returns** the number of `(item_id, location_id)` tuples rebuilt.
    pub fn rebuild_stock_summary_for(&self, product_ids: &[String]) -> Result<usize, CoreError> {
        if product_ids.is_empty() {
            return Ok(0);
        }
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // ADR-18 §13-36 frozen canonical default-location UUID (see
        // `crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID`). This is also the
        // column DEFAULT on `stock_movements.location_id` (migration 080) and
        // `inventory.location_id` (migration 079), so legacy pre-790 rows
        // uniformly land here and the rebuild stays backward-compatible. The
        // compensating movement is written here too: an unbacked opening balance
        // has no location to attribute to, and every other legacy row got this
        // attribution already.
        let canonical_default_loc = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
        // Params for a scoped statement: the id list first (?1..?n), then
        // whatever tail the statement needs (?n+1 ...). Built per chunk rather
        // than through a closure, which cannot name the tail's lifetime.
        fn scoped_args<'a>(
            ids: &'a [Box<dyn rusqlite::ToSql>],
            tail: &[&'a dyn rusqlite::ToSql],
        ) -> Vec<&'a dyn rusqlite::ToSql> {
            let mut args: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|a| a.as_ref()).collect();
            args.extend(tail.iter().copied());
            args
        }
        let tx = self.conn.unchecked_transaction()?;
        let mut rebuilt = 0usize;
        // THE CHUNK LOOP. Chunks are DISJOINT by item_id, so running the six
        // statements once per chunk is the same computation as one pass over the
        // whole scope — and the loop sits INSIDE the single transaction, so the
        // rebuild stays atomic. Nothing here falls back to a table-wide
        // statement when the list is long; that is the hole this fn closes.
        for chunk in product_ids.chunks(REBUILD_SCOPE_CHUNK) {
            let n = chunk.len();
            let placeholders = (1..=n)
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ");
            let id_args: Vec<Box<dyn rusqlite::ToSql>> = chunk
                .iter()
                .map(|id| Box::new(id.clone()) as Box<dyn rusqlite::ToSql>)
                .collect();
            let ids_only = || rusqlite::params_from_iter(id_args.iter().map(|a| a.as_ref()));

            // 1. HEAL — find every product in scope whose aggregate is ahead of its
            //    ledger WHILE the per-location cache still agrees with that
            //    aggregate. Both clauses are required; see THE PREDICATE above.
            let heal_sql = format!(
                "SELECT i.product_id, i.qty - COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.item_id = i.product_id), 0), COALESCE(p.sku, i.product_id) FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.product_id IN ({placeholders}) AND i.qty > COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.item_id = i.product_id), 0) AND (NOT EXISTS (SELECT 1 FROM stock_summary s WHERE s.item_id = i.product_id) OR COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss WHERE ss.item_id = i.product_id), 0) = i.qty)"
            );
            let mut stmt = tx.prepare(&heal_sql)?;
            let shortfalls = stmt
                .query_map(ids_only(), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<(String, i64, String)>, _>>()?;
            drop(stmt);

            // 2. ONE compensating movement per shortfall. The id is DETERMINISTIC
            //    (`legacy-backfill:` + product id) so a re-run cannot append a second
            //    copy of the same healing; the row is a derived placeholder, not an
            //    event, so its delta is updated in place if the shortfall moves again.
            for (product_id, shortfall, sku) in shortfalls {
                let insert_sql = "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET delta = excluded.delta, created_at = excluded.created_at";
                tx.execute(
                    insert_sql,
                    params![
                        format!("{LEGACY_BACKFILL_REASON}:{product_id}"),
                        product_id,
                        canonical_default_loc,
                        shortfall,
                        LEGACY_BACKFILL_REASON,
                        now,
                    ],
                )?;
                tracing::info!(
                    sku = %sku,
                    product_id = %product_id,
                    delta = shortfall,
                    reason = LEGACY_BACKFILL_REASON,
                    "rebuild_stock_summary: closed a legacy ledger shortfall with one compensating movement — this stock predates the ADR #6 ledger and has no movement behind it, so it is visible in the movement history by design"
                );
            }

            // 3. Clear the materialised cache FOR THE SCOPE ONLY — the scoped form
            //    of the old table-wide `DELETE FROM stock_summary`.
            tx.execute(
                &format!("DELETE FROM stock_summary WHERE item_id IN ({placeholders})"),
                ids_only(),
            )?;

            // 4. Rebuild stock_summary from the delta ledger. MUST group by BOTH
            //    (item_id, location_id) per ADR-18 migration 089's composite PK —
            //    without this, multi-location data silently collapses to one row at
            //    the canonical default UUID (ADR-19 §15 criterion 19-1).
            let rebuild_sql = format!(
                "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) SELECT item_id, location_id, SUM(delta), ?{} FROM stock_movements WHERE item_id IN ({placeholders}) GROUP BY item_id, location_id",
                n + 1
            );
            let rebuilt_rows = tx.execute(
                &rebuild_sql,
                rusqlite::params_from_iter(scoped_args(&id_args, &[&now])),
            )?;
            rebuilt += rebuilt_rows;

            // 5. Rebuild the legacy `inventory` aggregate (single-PK preserved):
            //    sums ALL location deltas per product and pins location_id to the
            //    canonical default, matching how `adjust_stock_with_reason` writes.
            let agg_sql = format!(
                "INSERT INTO inventory (product_id, location_id, qty, updated_at) SELECT item_id, ?{}, SUM(delta), ?{} FROM stock_movements WHERE item_id IN ({placeholders}) GROUP BY item_id ON CONFLICT(product_id) DO UPDATE SET qty = excluded.qty, location_id = excluded.location_id, updated_at = excluded.updated_at",
                n + 1,
                n + 2
            );
            tx.execute(
                &agg_sql,
                rusqlite::params_from_iter(scoped_args(&id_args, &[&canonical_default_loc, &now])),
            )?;

            // 6. Zero out inventory for products IN SCOPE whose ledger SUM is 0 or
            //    negative (e.g. all stock was sold) — the INSERT … ON CONFLICT above
            //    only handles items present in stock_movements. Scoped to match every
            //    statement above: an unscoped UPDATE here would zero aggregates for
            //    products this call was never asked to touch.
            let zero_sql = format!(
                "UPDATE inventory SET qty = 0, updated_at = ?{} WHERE product_id IN (SELECT item_id FROM stock_movements WHERE item_id IN ({placeholders}) GROUP BY item_id HAVING SUM(delta) <= 0)",
                n + 1
            );
            tx.execute(
                &zero_sql,
                rusqlite::params_from_iter(scoped_args(&id_args, &[&now])),
            )?;
        }

        tx.commit()?;
        Ok(rebuilt)
    }
}
