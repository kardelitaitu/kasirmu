//! Canonical ADR-19 §3.1 location-aware stock adjustment (part of the
//! `products_stock_adjust` module).
//!
//! Key functions: `adjust_stock_at_location_with_reason` — the single
//! stock writer every sale/refund/void/transfer routes through — with
//! the location predicates `product_has_location_rows` /
//! `legacy_aware_location_qty`, the legacy bridge
//! `bridge_legacy_inventory_into_stock_summary_in_tx`, and the private
//! threshold/alert writer `check_stock_threshold_and_alert_in_tx` kept
//! beside its only caller.
//!
//! Invariants: no internal BEGIN (the caller owns the transaction);
//! two-layer negative-stock protection; the legacy `inventory` upsert
//! recomputes the aggregate as the SUM over per-location rows.

use super::*;

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
    ///    `(item_id, location_id)` introduced by migration 089. Layer 2 lives
    ///    in the schema as the CONDITIONAL trigger pair
    ///    `stock_summary_qty_nonnegative_{insert,update}`
    ///    (`20261012_stock_summary_qty_nonnegative.sql`), which refuses a
    ///    negative qty ONLY when the location's binding has not set
    ///    `allow_negative_stock = 1`. There is deliberately NO
    ///    `CHECK (qty >= 0)` on this table: an unconditional constraint would
    ///    refuse the negative this function writes on the opt-in path, and so
    ///    silently re-enable Layer 1 — the very guard that flag exists to opt
    ///    out of (owner decision D11).
    /// 3. **Upsert** the legacy `inventory` table at the single-PK
    ///    `(product_id)` for backward-compat callers (ADR-18 §2a's full
    ///    composite-PK inventory rebuild is deferred).
    ///
    /// **Two-layer negative-stock protection** (ADR-19 §3.3):
    /// - **Layer 1 (Rust)**: pre-check `current_qty + delta >= 0` before any
    ///   write, returning [`CoreError::InsufficientStockAtLocation`] with the
    ///   exact available qty if the deduction would underflow. This keeps
    ///   `PartialStockResult` aggregation O(1) without a SELECT-after-failure.
    /// - **Layer 2 (SQLite)**: a `ConstraintViolation` on the `stock_summary`
    ///   upsert is translated to the same variant (defence in depth against
    ///   any Rust-side race in Layer 1). It is raised by the CONDITIONAL
    ///   trigger pair `stock_summary_qty_nonnegative_{insert,update}`
    ///   (`20261012`), which fires only when this location's binding has NOT
    ///   opted into `allow_negative_stock` — so it never fights the opt-in
    ///   path. The match is on the PRIMARY code
    ///   ([`rusqlite::ErrorCode::ConstraintViolation`], 19), which covers the
    ///   trigger's `SQLITE_CONSTRAINT_TRIGGER` (1811) as well as a CHECK's
    ///   787; no `CHECK (qty >= 0)` exists on this table.
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
    ///    `(item_id, location_id)` introduced by migration 089. Layer 2 lives
    ///    in the schema as the CONDITIONAL trigger pair
    ///    `stock_summary_qty_nonnegative_{insert,update}`
    ///    (`20261012_stock_summary_qty_nonnegative.sql`), which refuses a
    ///    negative qty ONLY when the location's binding has not set
    ///    `allow_negative_stock = 1`. There is deliberately NO
    ///    `CHECK (qty >= 0)` on this table: an unconditional constraint would
    ///    refuse the negative this function writes on the opt-in path, and so
    ///    silently re-enable Layer 1 — the very guard that flag exists to opt
    ///    out of (owner decision D11).
    /// 3. **Upsert** the legacy `inventory` table at the single-PK
    ///    `(product_id)` for backward-compat callers (ADR-18 §2a's full
    ///    composite-PK inventory rebuild is deferred).
    ///
    /// **Two-layer negative-stock protection** (ADR-19 §3.3):
    /// - **Layer 1 (Rust)**: pre-check `current_qty + delta >= 0` before any
    ///   write, returning [`CoreError::InsufficientStockAtLocation`] with the
    ///   exact available qty if the deduction would underflow. This keeps
    ///   `PartialStockResult` aggregation O(1) without a SELECT-after-failure.
    /// - **Layer 2 (SQLite)**: a `ConstraintViolation` on the `stock_summary`
    ///   upsert is translated to the same variant (defence in depth against
    ///   any Rust-side race in Layer 1). It is raised by the CONDITIONAL
    ///   trigger pair `stock_summary_qty_nonnegative_{insert,update}`
    ///   (`20261012`), which fires only when this location's binding has NOT
    ///   opted into `allow_negative_stock` — so it never fights the opt-in
    ///   path. The match is on the PRIMARY code
    ///   ([`rusqlite::ErrorCode::ConstraintViolation`], 19), which covers the
    ///   trigger's `SQLITE_CONSTRAINT_TRIGGER` (1811) as well as a CHECK's
    ///   787; no `CHECK (qty >= 0)` exists on this table.
    ///
    #[allow(clippy::too_many_arguments)]
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
}
