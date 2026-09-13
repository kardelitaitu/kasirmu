//! Location-aware stock adjustment and ledger maintenance.
//!
//! Key functions: `adjust_stock_at_location_with_reason` (ADR-19
//! canonical adjust - every sale/refund/void/transfer routes here),
//! `adjust_stock_batch` (precheck-then-execute with checked arithmetic),
//! `adjust_stock_with_reason`, `check_stock_threshold_and_alert_in_tx`,
//! `get_stock_from_ledger`, `rebuild_stock_summary`,
//! `rebuild_stock_summary_for` (scoped, self-healing), `list_stock_movements`,
//! `archive_stock_movements`.
//!
//! Invariants: batch precheck avoids partial deductions; stock math
//! uses checked_add/sub; adjustments upsert `stock_summary` per
//! location.
use super::*;

/// The `reason` tag and id prefix on the compensating movement written by
/// [`Store::rebuild_stock_summary_for`] when it heals a legacy ledger shortfall.
///
/// Named, not inlined, because it is user-visible: it appears in
/// [`Store::list_stock_movements`] and in any audit export, and it is what an
/// operator greps for to find every unit the rebuild had to invent a movement
/// for. The row is a derived placeholder standing in for stock that predates
/// the ADR #6 ledger — not a claim that someone moved something on this date.
const LEGACY_BACKFILL_REASON: &str = "legacy-backfill";

/// How many product ids one scoped rebuild statement may bind at a time.
///
/// Every statement in [`Store::rebuild_stock_summary_for`] binds ONE PARAMETER
/// PER ID (`WHERE item_id IN (?1..?n)`), and SQLite caps the variables per
/// statement at `SQLITE_MAX_VARIABLE_NUMBER` — 32 766 on the bundled 3.4x,
/// 999 on any older build. [`Store::rebuild_stock_summary`] passes EVERY ledger
/// and summary id, so an unchunked scope turns a large catalog into a
/// `too many SQL variables` error on the sync path, where the old parameterless
/// table-wide statement could not fail. 900 stays under even the historical
/// 999 ceiling; see `rebuild_scope_survives_a_catalog_larger_than_the_chunk`.
///
/// This is a CHUNK SIZE, never a threshold that switches the scope off: a long
/// id list is processed in more chunks, not in a table-wide sweep.
const REBUILD_SCOPE_CHUNK: usize = 900;

impl Store<'_> {
    /// Adjust stock with an explicit reason at a specific location (ADR-19 §3.1 canonical API).
    ///
    /// This is the **canonical core function** that all sale deduction / void /
    /// refund / transfer / purchase-order flows route through. It performs the
    /// following writes inside the caller-provided `&Transaction` (no internal BEGIN —
    /// the caller is responsible for `BEGIN IMMEDIATE` atomicity per ADR-19 §5.2):
    ///
    /// 1. One **immutable delta row** in `stock_movements` (CRDT ledger — ADR #6 +
    ///    ADR-19 §3.2 audit trail: item_id, location_id, delta, reason,
    ///    inventory_transaction_id?, source_terminal_id?, source_user_id?, created_at).
    /// 2. **Upsert** `stock_summary` at the composite PRIMARY KEY
    ///    `(item_id, location_id)` introduced by migration 089. The
    ///    schema's `CHECK (qty >= 0)` constraint is Layer 2 negative-stock guard.
    /// 3. **Upsert** the legacy `inventory` table at the single-PK
    ///    `(product_id)` for backward-compat callers (ADR-18 §2a's full
    ///    composite-PK inventory rebuild is deferred).
    ///
    /// **Two-layer negative-stock protection** (ADR-19 §3.3):
    /// - **Layer 1 (Rust)**: pre-check `current_qty + delta >= 0` before any
    ///   write, returning [`CoreError::InsufficientStockAtLocation`] with the
    ///   exact available qty if the deduction would underflow. This keeps
    ///   `PartialStockResult` aggregation O(1) without a SELECT-after-failure.
    /// - **Layer 2 (SQLite)**: `SqliteFailure(extended_code=787)` on the
    ///   `stock_summary` upsert is translated to the same variant (defence
    ///   in depth against any Rust-side race in Layer 1).
    ///
    /// Returns the **post-update qty at the location** so the caller can
    /// detect post-commit state without a separate SELECT.
    /// The ONE "does this product already track per-location stock" predicate.
    ///
    /// Deliberately scoped to `item_id` ALONE, never to `(item_id, location_id)`:
    /// those two questions have opposite answers and conflating them is the bug.
    /// A product that HAS summary rows but none at location L genuinely holds 0
    /// at L — inventing a fallback there would double-count. A product with NO
    /// summary rows anywhere is a legacy install whose stock lives only in the
    /// single-PK `inventory` table, and reading 0 there destroys the aggregate.
    ///
    /// Every reader that must tell the two apart calls this: the Layer-1
    /// pre-check and the batch Phase-1 pre-read (via
    /// [`Store::legacy_aware_location_qty`]), the legacy bridge gate below, and
    /// the sync dispatcher in `platform_sync::queue`. Public so that last one
    /// can reach it: the alternative was a fourth copy of the same EXISTS.
    pub fn product_has_location_rows(
        tx: &rusqlite::Transaction<'_>,
        product_id: &str,
    ) -> Result<bool, CoreError> {
        let exists: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM stock_summary WHERE item_id = ?1)",
            rusqlite::params![product_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    /// Current qty at `(product_id, location_id)`, legacy-aware.
    ///
    /// The per-location SUM of `stock_summary` for that product and location —
    /// except when the product has NO summary rows at all
    /// ([`Store::product_has_location_rows`]), where the stock is still only in
    /// the legacy single-PK `inventory` table and reading the SUM would return
    /// 0. In that one case the legacy aggregate is returned, so the caller's
    /// write lands on top of the real number instead of replacing it.
    ///
    /// The fallback is a GUESS about attribution: on a legacy install the
    /// aggregate moves to whichever location writes first. That is the only
    /// place in the system that guesses, so it logs at info! (sku, location,
    /// qty — never on the hot path where rows exist).
    pub(crate) fn legacy_aware_location_qty(
        &self,
        tx: &rusqlite::Transaction<'_>,
        product_id: &str,
        location_id: &str,
    ) -> Result<i64, CoreError> {
        let qty: i64 = tx.query_row(
            "SELECT COALESCE(SUM(qty), 0) FROM stock_summary \
             WHERE item_id = ?1 AND location_id = ?2",
            rusqlite::params![product_id, location_id],
            |row| row.get(0),
        )?;
        if Self::product_has_location_rows(tx, product_id)? {
            return Ok(qty);
        }
        let legacy_qty: Option<i64> = tx
            .query_row(
                "SELECT qty FROM inventory WHERE product_id = ?1",
                rusqlite::params![product_id],
                |row| row.get(0),
            )
            .ok();
        match legacy_qty {
            Some(legacy) if legacy != 0 => {
                let sku: String = self
                    .conn()
                    .query_row(
                        "SELECT sku FROM products WHERE id = ?1",
                        rusqlite::params![product_id],
                        |row| row.get(0),
                    )
                    .unwrap_or_else(|_| product_id.to_owned());
                tracing::info!(
                    sku = %sku,
                    location_id = %location_id,
                    qty = legacy,
                    "legacy inventory fallback: no stock_summary rows for this product, \
                     attributing its inventory.qty aggregate to this location"
                );
                Ok(legacy)
            }
            _ => Ok(qty),
        }
    }

    #[allow(clippy::too_many_arguments)]
    /// Adjust stock with an explicit reason at a specific location (ADR-19 §3.1 canonical API).
    ///
    /// This is the **canonical core function** that all sale deduction / void /
    /// refund / transfer / purchase-order flows route through. It performs the
    /// following writes inside the caller-provided `&Transaction` (no internal BEGIN —
    /// the caller is responsible for `BEGIN IMMEDIATE` atomicity per ADR-19 §5.2):
    ///
    /// 1. One **immutable delta row** in `stock_movements` (CRDT ledger — ADR #6 +
    ///    ADR-19 §3.2 audit trail: item_id, location_id, delta, reason,
    ///    inventory_transaction_id?, source_terminal_id?, source_user_id?, created_at).
    /// 2. **Upsert** `stock_summary` at the composite PRIMARY KEY
    ///    `(item_id, location_id)` introduced by migration 089. The
    ///    schema's `CHECK (qty >= 0)` constraint is Layer 2 negative-stock guard.
    /// 3. **Upsert** the legacy `inventory` table at the single-PK
    ///    `(product_id)` for backward-compat callers (ADR-18 §2a's full
    ///    composite-PK inventory rebuild is deferred).
    ///
    /// **Two-layer negative-stock protection** (ADR-19 §3.3):
    /// - **Layer 1 (Rust)**: pre-check `current_qty + delta >= 0` before any
    ///   write, returning [`CoreError::InsufficientStockAtLocation`] with the
    ///   exact available qty if the deduction would underflow. This keeps
    ///   `PartialStockResu    #[allow(clippy::too_many_arguments)]
    pub fn adjust_stock_at_location_with_reason(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sku: &str,
        delta: i64,
        location_id: &crate::inventory::LocationId,
        reason: Option<&str>,
        inventory_transaction_id: Option<&crate::inventory_transaction::InventoryTransactionId>,
        terminal_id: Option<&crate::terminal::TerminalId>,
        source_user_id: Option<&crate::user::UserId>,
    ) -> Result<i64, CoreError> {
        let product_id = self
            .product_id_by_sku(sku)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            })?;

        // Layer 1: read current qty at THIS (item_id, location_id) — uses
        // stock_summary.composite-PK via the per-location index from
        // migration 089. Falls back to 0 when no prior movements exist
        // (forward-compatible with pre-079 seed data).
        //
        // Explicit match guards against DB errors: QueryReturnedNoRows → 0
        // (no stock at this location), any other error → propagate.
        // Legacy-aware: the per-location SUM, falling back to inventory.qty ONLY
        // when the product has no summary rows anywhere. Reading the bare SUM
        // here made a first-touch positive delta REPLACE the legacy aggregate
        // instead of adding to it, and inventory (recomputed as SUM below) became
        // the delta — the whole class of silent stock loss.
        let current_qty = self.legacy_aware_location_qty(tx, &product_id, location_id.as_str())?;

        let mut allow_negative = false;
        if let Some(t_id) = terminal_id
            && let Ok(ws_id) = tx.query_row(
                "SELECT workspace_instance_id FROM terminals WHERE id = ?1",
                rusqlite::params![t_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            && let Ok(allowed) = tx.query_row(
                "SELECT COALESCE(allow_negative_stock, 0) FROM workspace_inventory_locations \
                     WHERE instance_id = ?1 AND location_id = ?2",
                rusqlite::params![ws_id, location_id.as_str()],
                |row| row.get::<_, i64>(0),
            )
        {
            allow_negative = allowed == 1;
        }

        let new_qty = if allow_negative {
            current_qty
                .checked_add(delta)
                .ok_or_else(|| CoreError::Validation {
                    field: "qty",
                    message: "overflow".into(),
                })?
        } else {
            current_qty
                .checked_add(delta)
                .filter(|&v| v >= 0)
                .ok_or_else(|| CoreError::InsufficientStockAtLocation {
                    sku: sku.to_owned(),
                    location_id: location_id.clone(),
                    requested_delta: delta,
                    available_qty: current_qty,
                })?
        };

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let movement_id = uuid::Uuid::now_v7().to_string();

        // 1. Audit-trail delta row (ADR #6 + ADR-19 §3.2).
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, location_id, delta, reason,
                                          inventory_transaction_id,
                                          source_terminal_id, source_user_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                movement_id,
                product_id,
                location_id.as_str(),
                delta,
                reason,
                inventory_transaction_id.map(|id| id.as_str()),
                terminal_id.map(|id| id.as_str()),
                source_user_id.map(|id| id.as_str()),
                now,
            ],
        )?;

        // 2. Per-location stock_summary upsert (Layer-2 negative-stock guard).
        let summary_res = tx.execute(
            "INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(item_id, location_id) DO UPDATE SET
                qty = excluded.qty,
                updated_at = excluded.updated_at",
            rusqlite::params![product_id, location_id.as_str(), new_qty, now],
        );
        if let Err(rusqlite::Error::SqliteFailure(ref e, _)) = summary_res
            && e.code == rusqlite::ErrorCode::ConstraintViolation
        {
            return Err(CoreError::InsufficientStockAtLocation {
                sku: sku.to_owned(),
                location_id: location_id.clone(),
                requested_delta: delta,
                available_qty: current_qty,
            });
        }
        summary_res?;

        // 3. Legacy inventory table — ADR-18 §2a composite-PK rebuild deferred.
        // When `allow_negative` is true, the CHECK (qty >= 0) constraint on the
        // `inventory` table would reject a negative qty. We catch that error and
        // log a warning instead of propagating it, because the stock_summary table
        // (step 2) is the canonical source of truth for per-location stock.
        // Aggregate write: the inventory table has PRIMARY KEY (product_id) and
        // holds the cross-location total, so qty MUST be recomputed as the SUM
        // over the per-location stock_summary rows (the same value the
        // product-grid reader derives at query time) — never overwritten with
        // this one location's qty, which destroys the aggregate. location_id is
        // left untouched on conflict so it stops tracking whichever location
        // wrote last; it is only set on the initial INSERT.
        let inventory_res = tx.execute(
            "INSERT INTO inventory (product_id, location_id, qty, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(product_id) DO UPDATE SET
                qty = COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss
                                WHERE ss.item_id = excluded.product_id),
                               excluded.qty),
                updated_at = excluded.updated_at",
            rusqlite::params![product_id, location_id.as_str(), new_qty, now],
        );
        if let Err(rusqlite::Error::SqliteFailure(ref e, _)) = inventory_res
            && e.code == rusqlite::ErrorCode::ConstraintViolation
            && allow_negative
        {
            // Expected when qty < 0 and allow_negative_stock is enabled.
            // The `stock_summary` table already has the accurate count.
            tracing::warn!(
                "negative stock (qty={}) not written to legacy inventory table; stock_summary is canonical",
                new_qty
            );
        } else {
            inventory_res?;
        }

        // 4. Synchronous threshold check (ADR-18 §9e-ii).
        // Errors are silent — threshold alerts are advisory and should not
        // block the stock adjustment transaction.
        let _ = self.check_stock_threshold_and_alert_in_tx(
            tx,
            &product_id,
            location_id.as_str(),
            new_qty,
            &now,
        );

        if let Some(cache) = &self.cache {
            cache.invalidate_inventory(&product_id);
            cache.publish_inventory_change(&product_id, sku, new_qty, self.terminal_id.as_deref());
        }

        // 5. stock.negative warning event (ADR-18 §4).
        // Emitted when allow_negative_stock is enabled and the resulting qty
        // is negative — the deduction went below zero.
        if allow_negative
            && new_qty < 0
            && let Some(cache) = &self.cache
        {
            cache.publish_negative_stock_event(
                &product_id,
                sku,
                location_id.as_str(),
                delta,
                new_qty,
                self.terminal_id.as_deref(),
            );
        }

        Ok(new_qty)
    }

    /// Bridge a legacy inventory-only aggregate into the per-location
    /// `stock_summary` table inside the caller's transaction (the §3.4
    /// interim step documented on the stock-transfer module).
    ///
    /// Legacy writers (and legacy seed data) populate only the single-PK
    /// `inventory` table, while the canonical adjust fn pre-checks and writes
    /// `stock_summary` at a composite `(item_id, location_id)` key — a
    /// product with no `stock_summary` rows would read as phantom zero stock.
    /// When the product has NO per-location rows but a non-zero legacy
    /// `inventory.qty`, that aggregate is materialised once at the frozen
    /// canonical default location (the column DEFAULT shared by
    /// `inventory.location_id` and `stock_movements.location_id`), matching
    /// `rebuild_stock_summary` semantics. Products that already have
    /// per-location rows are left untouched. No `stock_movements` row is
    /// written: this materialises existing state, it is not a new delta.
    pub(crate) fn bridge_legacy_inventory_into_stock_summary_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        product_id: &str,
    ) -> Result<(), CoreError> {
        if Self::product_has_location_rows(tx, product_id)? {
            return Ok(());
        }
        let legacy_qty: Option<i64> = tx
            .query_row(
                "SELECT qty FROM inventory WHERE product_id = ?1",
                rusqlite::params![product_id],
                |row| row.get(0),
            )
            .ok();
        let legacy_qty = match legacy_qty {
            Some(q) if q != 0 => q,
            _ => return Ok(()),
        };
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute(
            "INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(item_id, location_id) DO UPDATE SET
                qty = excluded.qty,
                updated_at = excluded.updated_at",
            rusqlite::params![
                product_id,
                crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                legacy_qty,
                now
            ],
        )?;
        Ok(())
    }

    /// Check stock thresholds for a product at a location after a stock change
    /// and INSERT / UPDATE `stock_alert_events` accordingly.
    ///
    /// Lookup order (ADR-18 §9e-i):
    /// 1. Product+location specific threshold
    /// 2. Product+global threshold (location_id IS NULL)
    /// 3. No threshold configured → skip (no alert)
    ///
    /// If stock is below threshold: INSERT alert with `status = 'active'`
    /// (deduped — no duplicate active alerts per threshold_id).
    /// If stock recovers above threshold: UPDATE any active/acknowledged
    /// alerts to `status = 'resolved'` (auto-resolve).
    fn check_stock_threshold_and_alert_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        product_id: &str,
        location_id: &str,
        new_qty: i64,
        now: &str,
    ) -> Result<(), CoreError> {
        // Lookup: product+location specific, then product+global.
        let threshold_row: Option<(String, i64)> = tx
            .query_row(
                "SELECT id, threshold FROM stock_thresholds \
                 WHERE product_id = ?1 AND location_id = ?2 AND enabled = 1 \
                 LIMIT 1",
                rusqlite::params![product_id, location_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok()
            .or_else(|| {
                tx.query_row(
                    "SELECT id, threshold FROM stock_thresholds \
                     WHERE product_id = ?1 AND location_id IS NULL AND enabled = 1 \
                     LIMIT 1",
                    rusqlite::params![product_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .ok()
            });

        let (threshold_id, threshold) = match threshold_row {
            Some(row) => row,
            None => return Ok(()), // No threshold configured — skip.
        };

        // Check if stock went below threshold.
        if new_qty < threshold {
            // Dedup: don't insert if there's already an active alert for this threshold.
            let existing: bool = tx
                .query_row(
                    "SELECT 1 FROM stock_alert_events \
                     WHERE threshold_id = ?1 AND status IN ('active', 'acknowledged') \
                     LIMIT 1",
                    rusqlite::params![threshold_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !existing {
                let alert_id = uuid::Uuid::now_v7().to_string();
                tx.execute(
                    "INSERT INTO stock_alert_events \
                     (id, threshold_id, product_id, location_id, current_qty, threshold, status, triggered_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7)",
                    rusqlite::params![alert_id, threshold_id, product_id, location_id, new_qty, threshold, now],
                )?;
            }
        } else {
            // Stock recovered above threshold — auto-resolve active alerts.
            tx.execute(
                "UPDATE stock_alert_events \
                 SET status = 'resolved', resolved_at = ?1 \
                 WHERE threshold_id = ?2 AND status IN ('active', 'acknowledged')",
                rusqlite::params![now, threshold_id],
            )?;
        }

        Ok(())
    }

    /// Atomically deduct from multiple locations for one or more SKUs
    /// inside the caller's transaction (ADR-19 §3).
    ///
    /// All deductions happen inside the caller-provided `&Transaction` —
    /// no internal BEGIN/COMMIT. Used by the split-fulfillment flow (§6b)
    /// where one line item is deducted from 2+ locations simultaneously.
    ///
    /// 1. Pre-check every deduction against current stock at its location.
    ///    If ANY deduction would cause negative stock at its location, the
    ///    function returns [`CoreError::InsufficientStockAtLocation`] for
    ///    the **first** shortfall encountered (the caller should have
    ///    already validated all deductions before calling).
    /// 2. Execute all deductions — each is a single call to
    ///    [`adjust_stock_at_location_with_reason`](Self::adjust_stock_at_location_with_reason).
    ///
    /// The caller is responsible for `BEGIN IMMEDIATE` and COMMIT/ROLLBACK.
    pub fn adjust_stock_batch(
        &self,
        tx: &rusqlite::Transaction<'_>,
        deductions: &[crate::sale_deduction::StockDeduction],
        reason: Option<&str>,
        inventory_transaction_id: Option<&crate::inventory_transaction::InventoryTransactionId>,
        terminal_id: Option<&crate::terminal::TerminalId>,
        source_user_id: Option<&crate::user::UserId>,
    ) -> Result<(), CoreError> {
        if deductions.is_empty() {
            return Ok(());
        }

        // Phase 1: pre-check all deductions against current stock.
        for d in deductions {
            let product_id =
                self.product_id_by_sku(&d.sku)?
                    .ok_or_else(|| CoreError::NotFound {
                        entity: "product",
                        id: d.sku.clone(),
                    })?;

            // Distinguish QueryReturnedNoRows (no stock at this location → 0)
            // from real DB errors (corruption, lock → propagate).
            // Same legacy-aware read as the canonical adjust; Phase 1 and
            // Phase 2 must agree or the pre-check green-lights a deduction the
            // writer then refuses (or vice versa).
            let current_qty =
                self.legacy_aware_location_qty(tx, &product_id, d.location_id.as_str())?;

            let mut allow_negative = false;
            if let Some(t_id) = terminal_id
                && let Ok(ws_id) = tx.query_row(
                    "SELECT workspace_instance_id FROM terminals WHERE id = ?1",
                    rusqlite::params![t_id.as_str()],
                    |row| row.get::<_, String>(0),
                )
                && let Ok(allowed) = tx.query_row(
                    "SELECT COALESCE(allow_negative_stock, 0) FROM workspace_inventory_locations \
                         WHERE instance_id = ?1 AND location_id = ?2",
                    rusqlite::params![ws_id, d.location_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
            {
                allow_negative = allowed == 1;
            }

            if !allow_negative {
                let _new_qty = current_qty
                    .checked_add(d.delta)
                    .filter(|&v| v >= 0)
                    .ok_or_else(|| CoreError::InsufficientStockAtLocation {
                        sku: d.sku.clone(),
                        location_id: d.location_id.clone(),
                        requested_delta: d.delta,
                        available_qty: current_qty,
                    })?;
            }
        }

        // Phase 2: execute all deductions (all pre-checks passed).
        for d in deductions {
            self.adjust_stock_at_location_with_reason(
                tx,
                &d.sku,
                d.delta,
                &d.location_id,
                reason,
                inventory_transaction_id,
                terminal_id,
                source_user_id,
            )?;
        }

        Ok(())
    }

    /// Adjust stock with an explicit reason for the delta ledger (ADR #6).
    ///
    /// **ADR-19 §3.4** (deferred): this function is preserved verbatim from the
    /// pre-ADR-19 v0.0.10 baseline. The §3.4 demotion to a wrapper around
    /// [`adjust_stock_at_location_with_reason`](Self::adjust_stock_at_location_with_reason)
    /// is **deferred to v0.1.0** because the wrapper's contract (NULL
    /// location_id → canonical-default via column-DFT, single-PK inventory
    /// upsert) is depended on by 8+ downstream cargo tests across
    /// `db::products`, `db::purchase_orders`, `db::stock_transfers`, and
    /// `db::workspaces`. Routing it through the canonical fn during the
    /// v0.0.10 transition would require updating those tests + the
    /// production callsites in `app/*/commands/products.rs` +
    /// `modules/inventory/src/handlers.rs` — out of scope for Criterion
    /// 19-2 (which delivers the new canonical API surface, not the
    /// migration of existing callers).
    ///
    /// **Layer-1 stale-source note for §3.4 follow-up**: this wrapper reads
    /// `previous_qty` from the **legacy `inventory` table** via
    /// `self.get_stock(&product_id)`. The canonical §3.1 fn reads from
    /// `stock_summary` (post-ADR-18 §3 authoritative per-location surface).
    /// A future test or production flow that seeds ONLY `stock_summary`
    /// (not `inventory`) will pass the §3.1 path but fail this wrapper with
    /// phantom zero stock — a §3.4 migration foot-gun. The §3.4 follow-up
    /// should explicitly migrate Layer-1 reads to `stock_summary`.
    #[deprecated(note = "use adjust_stock_at_location_with_reason instead")]
    pub fn adjust_stock_with_reason(
        &self,
        sku: &str,
        delta: i64,
        reason: Option<&str>,
        source_terminal_id: Option<&str>,
        source_user_id: Option<&str>,
    ) -> Result<i64, CoreError> {
        let product_id = self
            .product_id_by_sku(sku)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            })?;

        let previous_qty = self.get_stock(&product_id)?;

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
        let movement_id = uuid::Uuid::now_v7().to_string();

        let tx = self.conn.unchecked_transaction()?;

        // 1. Write the immutable delta row (CRDT ledger — ADR #6).
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason,
                                          source_terminal_id, source_user_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                movement_id,
                product_id,
                delta,
                reason,
                source_terminal_id,
                source_user_id,
                now
            ],
        )?;

        // 2. Update the materialised inventory table (backward compat).
        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(product_id) DO UPDATE SET qty = excluded.qty,
                                                     updated_at = excluded.updated_at",
            params![product_id, new_qty, now],
        )?;

        // 3. Update the stock_summary materialised view (perf — ADR #6 + ADR-19 §3).
        // Uses the canonical default location UUID per ADR-18 §13-36 frozen seed.
        // The helper targets the composite PRIMARY KEY (item_id, location_id)
        // introduced by migration 089 — pre-refactor single-column
        // ON CONFLICT(item_id) raise "ON CONFLICT clause does not match any
        // PRIMARY KEY or UNIQUE constraint" and cascade-fail 46+ tests.
        upsert_stock_summary_in_tx(
            &tx,
            &product_id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            new_qty,
            &now,
        )?;

        tx.commit()?;

        if let Some(cache) = &self.cache {
            cache.invalidate_inventory(&product_id);
            cache.publish_inventory_change(&product_id, sku, new_qty, self.terminal_id.as_deref());
        }

        Ok(new_qty)
    }

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

    /// List all stock movement rows for a product, ordered by time (ADR #6).
    ///
    /// Returns the complete immutable delta ledger for audit and sync.
    pub fn list_stock_movements(
        &self,
        product_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<StockMovement>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, item_id, delta, reason, source_terminal_id, source_user_id,
                    store_id, created_at
             FROM stock_movements
             WHERE item_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![product_id, limit, offset], |row| {
            Ok(StockMovement {
                id: row.get(0)?,
                item_id: row.get(1)?,
                delta: row.get(2)?,
                reason: row.get(3)?,
                source_terminal_id: row.get(4)?,
                source_user_id: row.get(5)?,
                store_id: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Archive stock movements older than `older_than_days` days.
    ///
    /// Uses archive-rollup consolidation (ADR #6 Q4 / P-1 Ledger Retention):
    ///
    /// 1. Copies old rows to `stock_movements_archive` for audit compliance.
    /// 2. Inserts a single rollup row per product — `SUM(delta)` of all
    ///    archived rows, with `reason: 'archive-rollup'`.
    /// 3. Deletes old rows from the live table.
    ///
    /// Rollup rows are excluded from future archiving via `WHERE reason != 'archive-rollup'`.
    /// Each item_id group is processed in its own transaction so concurrent
    /// `adjust_stock` calls are never blocked for long.
    ///
    /// Capped at `max_groups` item_id groups per call to bound runtime
    /// (subsequent calls pick up remaining groups — idempotent).
    ///
    /// Returns the number of item groups that were archived.
    pub fn archive_stock_movements(
        &self,
        older_than_days: i64,
        max_groups: usize,
    ) -> Result<usize, CoreError> {
        // Compute the cutoff timestamp (now minus older_than_days).
        let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days);
        let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        // Find item_ids that have archivable rows (excluding rollup rows).
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT item_id
             FROM stock_movements
             WHERE created_at < ?1
               AND reason != 'archive-rollup'
             LIMIT ?2",
        )?;
        let item_ids: Vec<String> = stmt
            .query_map(params![cutoff_str, max_groups as i64], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        if item_ids.is_empty() {
            return Ok(0);
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut groups_archived = 0usize;

        for item_id in &item_ids {
            let tx = self.conn.unchecked_transaction()?;

            // 1. Copy old rows to archive (skip previous rollup rows). Post
            //    ADR-18 §2b + migration 080 stock_movements_archive gained
            //    a `location_id` column (NOT NULL DEFAULT canonical UUID);
            //    post ADR-18 §9c + migration 085 it also gained a nullable
            //    `inventory_transaction_id` FK column. The select-list below
            //    must enumerate ALL 10 columns in the same order as the
            //    CREATE TABLE from migration 072 + ALTERs from 080/085,
            //    otherwise SQLite rejects with "X columns but Y values
            //    were supplied" and the archive transaction rolls back.
            tx.execute(
                "INSERT INTO stock_movements_archive
                 SELECT id, item_id, delta, reason,
                        source_terminal_id, source_user_id,
                        store_id, created_at,
                        location_id, inventory_transaction_id
                 FROM stock_movements
                 WHERE item_id = ?1
                   AND created_at < ?2
                   AND reason != 'archive-rollup'",
                params![item_id, cutoff_str],
            )?;

            // 2. Insert a rollup row consolidating all archived deltas.
            //    Post migration 080 location_id is NOT NULL DEFAULT canonical
            //    UUID on stock_movements, so we anchor the rollup to the
            //    canonical default explicitly (the COALESCE would otherwise
            //    surface a NULL on pre-080 stock_movements rows). Post
            //    migration 085 inventory_transaction_id is NULLABLE; the
            //    rollup row has no original inventory_transaction session
            //    because it consolidates multiple sessions — NULL is correct.
            let rollup_id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO stock_movements
                     (id, item_id, delta, reason, store_id, created_at,
                      location_id, inventory_transaction_id)
                 SELECT ?1, ?2, COALESCE(SUM(delta), 0), 'archive-rollup',
                        '', ?3,
                        '01926b3a-0000-7000-8000-000000000001', NULL
                 FROM stock_movements
                 WHERE item_id = ?2
                   AND created_at < ?4
                   AND reason != 'archive-rollup'",
                params![rollup_id, item_id, now, cutoff_str],
            )?;

            // 3. Delete old rows from the live table.
            tx.execute(
                "DELETE FROM stock_movements
                 WHERE item_id = ?1
                   AND created_at < ?2
                   AND reason != 'archive-rollup'",
                params![item_id, cutoff_str],
            )?;

            tx.commit()?;
            groups_archived += 1;
        }

        // Run incremental vacuum once after all groups to reclaim disk space.
        self.conn
            .execute_batch("PRAGMA incremental_vacuum(50)")
            .map_err(|e| CoreError::Internal(format!("incremental_vacuum failed: {e}")))?;

        Ok(groups_archived)
    }
}

#[cfg(test)]
#[path = "products_stock_adjust_tests.rs"]
mod tests;
