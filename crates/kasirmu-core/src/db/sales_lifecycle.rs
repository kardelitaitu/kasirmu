//! Sale lifecycle transitions after checkout.
//!
//! Key functions: `finalize_sale` / `finalize_sale_in_tx` (pending to
//! completed), `complete_sale_with_resolved_shortfalls` (shortfall
//! recovery), `void_pending_sale` and `void_sale`, plus stale-pending
//! detection and reaping (`find_stale_pending_sales`,
//! `reap_stale_pending_sales`).
//!
//! Invariants: every status transition bumps `version` inside a
//! transaction; voiding never adjusts inventory; voids write audit
//! entries.

use super::*;
use crate::AuditEntry;
use crate::SaleStatus;
use rusqlite::{Transaction, TransactionBehavior};

/// LOY-06: award loyalty points at the moment a sale reaches `completed`.
///
/// Deliberately NON-FATAL: a captured payment must never be rolled back
/// because the loyalty ledger had a problem (missing account, tier
/// misconfiguration, …). Failures are logged and the completion proceeds;
/// the award is idempotent per sale, so a later manual earn (or a future
/// reconciliation) can recover it.
///
/// Earns on the BASE total when the CUR-02 snapshot is present: the
/// points formula is currency-naive (`total_minor * points_per_unit /
/// 100`), so charging in a low-exponent currency would otherwise
/// multiply the reward by the exchange rate.
fn apply_customer_stats_on_completion(conn: &rusqlite::Connection, sale_id: &str) {
    let sale_row = conn.query_row(
        "SELECT customer_id, base_total_minor, total_minor FROM sales WHERE id = ?1",
        rusqlite::params![sale_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    );
    let (customer_id, base_total_minor, total_minor) = match sale_row {
        Ok((Some(cid), base, total)) => (cid, base, total),
        // No customer attached (or row vanished): nothing to award.
        Ok((None, _, _)) => return,
        Err(e) => {
            tracing::warn!(error = %e, sale_id, "loyalty award: sale lookup failed (non-fatal)");
            return;
        }
    };
    let earn_total = base_total_minor.unwrap_or(total_minor);
    // CRM-06: accrue lifetime spend in the SAME base-currency amount the
    // award uses. Statement-level atomic increment (no read-modify-write
    // race); SQLite raises on i64 overflow, which is logged non-fatal
    // below. The old owner — the event-bus CrmHistoryHandler — had no
    // idempotency guard and no currency validation; its subscription
    // was removed in platform/startup so this is the single writer.
    if let Err(e) = conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![
            earn_total,
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            customer_id
        ],
    ) {
        tracing::warn!(error = %e, sale_id, "customer spend accrual failed (non-fatal)");
    }
    match crate::db::loyalty::earn_points_with_conn(conn, &customer_id, sale_id, earn_total) {
        Ok(Some(t)) => {
            tracing::debug!(
                sale_id,
                points = t.points,
                "loyalty points awarded on completion"
            );
        }
        // Total too small to earn — expected for near-zero sales.
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(error = %e, sale_id, "loyalty award failed (non-fatal)");
        }
    }
}

impl Store<'_> {
    /// Transition a pending sale's status to `completed` after payment capture is successful.
    pub fn finalize_sale(&self, sale_id: &str) -> Result<(), CoreError> {
        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE sales SET status = 'completed', updated_at = ?1, version = version + 1 \
             WHERE id = ?2 AND status = 'pending'",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                sale_id
            ],
        )?;
        // LOY-06: award loyalty points atomically with the transition.
        // `changed == 1` guarantees exactly one award per sale even if the
        // caller retries finalize.
        if changed == 1 {
            apply_customer_stats_on_completion(&tx, sale_id);
        }
        tx.commit()?;
        Ok(())
    }

    /// Same as [`Store::finalize_sale`] but inside a caller-owned transaction
    /// (used by the sync daemon's atomic remote-apply path — a nested
    /// `unchecked_transaction` there would fail with "cannot start a
    /// transaction within a transaction").
    pub fn finalize_sale_in_tx(
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
    ) -> Result<(), CoreError> {
        let changed = tx.execute(
            "UPDATE sales SET status = 'completed', updated_at = ?1, version = version + 1 \
             WHERE id = ?2 AND status = 'pending'",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                sale_id
            ],
        )?;
        // LOY-06: same atomic award inside the caller's transaction.
        if changed == 1 {
            apply_customer_stats_on_completion(tx, sale_id);
        }
        Ok(())
    }

    /// Complete a sale with cashier-resolved shortfalls (ADR-19 §6b).
    ///
    /// This is the second command in the two-command shortfall resolution flow.
    /// After [`complete_sale_deduction`](Self::complete_sale_deduction) returns a
    /// [`PartialStockResult`](crate::sale_deduction::PartialStockResult), the cashier
    /// resolves each shortfall via the Stock Shortfall dialog (pick alternative
    /// locations, split fulfillment, or manager override).
    ///
    /// The function:
    ///   1. Opens `BEGIN IMMEDIATE` (fresh transaction — the first attempt was rolled back).
    ///   2. Re-checks stock at ALL specified locations for each SKU in the resolutions.
    ///      If any location now has insufficient stock (another terminal sold the item
    ///      while the dialog was shown), returns [`CoreError::InsufficientStockAtLocation`].
    ///   3. Executes all deductions via [`adjust_stock_batch`](Self::adjust_stock_batch).
    ///   4. Writes `deduction_locations` JSON with per-line per-location breakdown.
    ///   5. Creates the sale row with `status = 'completed'` (SF-01: the
    ///      retry settles an already-captured payment, so it is terminal —
    ///      no pending window, no reaper exposure).
    ///   6. Creates payment records.
    ///   7. COMMIT.
    ///
    /// Returns [`CompleteSaleResult`](crate::sale_deduction::CompleteSaleResult) on success.
    #[allow(clippy::too_many_arguments)]
    pub fn complete_sale_with_resolved_shortfalls(
        &self,
        sale: &Sale,
        workspace_instance_id: Option<&str>,
        payment_splits: &[crate::PaymentSplitArg],
        staff_user_id: &str,
        terminal_id: Option<&str>,
        resolutions: &[crate::sale_deduction::ResolvedShortfall],
        checkout_applications: &[crate::PromotionApplication],
    ) -> Result<crate::sale_deduction::CompleteSaleResult, CoreError> {
        use crate::inventory_transaction::InventoryTransactionId;
        use crate::sale_deduction::ResolvedShortfall;

        // MONEY-03 follow-up: same negative-qty rejection as
        // complete_sale_deduction — a negative qty would credit stock.
        for line in &sale.lines {
            if line.qty < 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: format!("sale line quantity must be positive, got {}", line.qty),
                });
            }
        }

        // Enforce subscription offline grace period / read-only lock.
        self.enforce_pos_writable()?;

        // ── BEGIN IMMEDIATE ───────────────────────────────────────
        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;

        // ── Phase 1: Build deduction list from resolutions ────────
        let mut deductions: Vec<crate::sale_deduction::StockDeduction> = Vec::new();
        // Track per-line per-location breakdown for deduction_locations JSON
        let mut line_deductions: Vec<serde_json::Value> = Vec::with_capacity(sale.lines.len());

        // Build a lookup: sku → ResolvedShortfall
        let resolutions_by_sku: std::collections::HashMap<&str, &ResolvedShortfall> =
            resolutions.iter().map(|r| (r.sku.as_str(), r)).collect();

        // Resolve primary/default location once for non-resolution lines.
        let primary_location = crate::location_resolver::resolve_primary_location(
            &tx,
            workspace_instance_id.unwrap_or("default"),
            None,
        )
        .unwrap_or_else(|_| crate::location_resolver::get_default_location_id());

        for line in &sale.lines {
            // Check product info to determine if this line tracks inventory
            let product_info: Option<(String, String)> = match tx.query_row(
                "SELECT id, product_type FROM products WHERE sku = ?1",
                rusqlite::params![line.sku],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ) {
                Ok(val) => Some(val),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(CoreError::Db(e)),
            };

            // Same contract as the checkout path: this verdict decides whether
            // the line is deducted at all, and the fallback (Retail) tracks
            // inventory. The fallback stays so one bad row never fails the sale;
            // the helper warns.
            let tracks_inventory = product_info
                .as_ref()
                .map(|(_, pt)| {
                    crate::product::ProductType::parse_stored_or_default(
                        Some(pt.as_str()),
                        line.sku.as_str(),
                        "Store::complete_sale_with_resolved_shortfalls:sale_line",
                    )
                    .tracks_inventory()
                })
                .unwrap_or(false);

            let recipe = match product_info.as_ref() {
                Some((pid, _)) => self.get_recipe_ingredients(pid).unwrap_or_default(),
                None => vec![],
            };
            let has_recipe = !recipe.is_empty();

            let needs_stock = tracks_inventory || has_recipe;

            // If this line has a resolution, use the resolved allocations.
            // Otherwise, for tracked lines, deduct from the primary location.
            if let Some(resolution) = resolutions_by_sku.get(line.sku.as_str()) {
                // Validate allocation sums match requested qty
                let alloc_sum: i64 = resolution.allocations.iter().map(|a| a.qty).sum();
                if alloc_sum != line.qty {
                    tx.rollback()?;
                    return Err(CoreError::Validation {
                        field: "resolutions",
                        message: format!(
                            "SKU {}: allocation sum {} does not match requested qty {}",
                            line.sku, alloc_sum, line.qty
                        ),
                    });
                }

                // Check stock at each location and build deduction entries
                for alloc in &resolution.allocations {
                    if alloc.qty <= 0 {
                        continue;
                    }

                    // Resolve product_id from SKU
                    let product_id: String = tx
                        .query_row(
                            "SELECT id FROM products WHERE sku = ?1",
                            rusqlite::params![line.sku],
                            |row| row.get(0),
                        )
                        .map_err(|_| CoreError::NotFound {
                            entity: "product",
                            id: line.sku.clone(),
                        })?;

                    // Re-check availability at this location
                    let available: i64 = tx
                        .query_row(
                            "SELECT COALESCE(qty, 0) FROM stock_summary \
                             WHERE item_id = ?1 AND location_id = ?2",
                            rusqlite::params![product_id, alloc.location_id.as_str()],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);

                    if available < alloc.qty {
                        // Allow negative stock check: does this binding allow it?
                        let allow_neg = if let Some(ws_id) = workspace_instance_id {
                            tx.query_row(
                                "SELECT COALESCE(allow_negative_stock, 0) \
                                 FROM workspace_inventory_locations \
                                 WHERE instance_id = ?1 AND location_id = ?2",
                                rusqlite::params![ws_id, alloc.location_id.as_str()],
                                |row| row.get::<_, i64>(0),
                            )
                            .unwrap_or(0)
                                == 1
                        } else {
                            false
                        };

                        if !allow_neg {
                            tx.rollback()?;
                            return Err(CoreError::InsufficientStockAtLocation {
                                sku: line.sku.clone(),
                                location_id: alloc.location_id.clone(),
                                requested_delta: alloc.qty,
                                available_qty: available,
                            });
                        }
                    }

                    deductions.push(crate::sale_deduction::StockDeduction {
                        sku: line.sku.clone(),
                        location_id: alloc.location_id.clone(),
                        delta: -alloc.qty,
                    });
                }
            } else if needs_stock {
                // Lines NOT in resolutions but that track inventory still need
                // stock deduction because the entire first sale transaction was
                // rolled back. Deduct from the primary location.
                if tracks_inventory {
                    deductions.push(crate::sale_deduction::StockDeduction {
                        sku: line.sku.clone(),
                        location_id: primary_location.clone(),
                        delta: -line.qty,
                    });
                }

                // BOM ingredients for non-resolution lines
                if has_recipe {
                    for ingredient in recipe {
                        let ing_info: Option<(String, String)> = match tx.query_row(
                            "SELECT sku, product_type FROM products WHERE id = ?1",
                            rusqlite::params![ingredient.ingredient_product_id],
                            |row| Ok((row.get(0)?, row.get(1)?)),
                        ) {
                            Ok(val) => Some(val),
                            Err(rusqlite::Error::QueryReturnedNoRows) => None,
                            Err(e) => return Err(CoreError::Db(e)),
                        };

                        if let Some((ing_sku, ing_ptype_str)) = ing_info {
                            // Same contract as the sale-line parse above: an
                            // unmapped ingredient type deducts stock a Service
                            // ingredient does not keep.
                            let ing_ptype = crate::product::ProductType::parse_stored_or_default(
                                Some(ing_ptype_str.as_str()),
                                &ing_sku,
                                "Store::complete_sale_with_resolved_shortfalls:recipe_ingredient",
                            );
                            if ing_ptype.tracks_inventory() {
                                // MONEY-03: same overflow contract as the primary
                                // deduction path — the non-resolution BOM branch
                                // must reject an overflowing line qty up front.
                                let required_qty = line
                                    .qty
                                    .checked_mul(ingredient.quantity_required)
                                    .ok_or_else(|| CoreError::Validation {
                                        field: "qty",
                                        message: "ingredient deduction quantity overflow".into(),
                                    })?;
                                deductions.push(crate::sale_deduction::StockDeduction {
                                    sku: ing_sku,
                                    location_id: primary_location.clone(),
                                    delta: -required_qty,
                                });
                            }
                        }
                    }
                }
            }

            // Build deduction_locations entry for this line
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            if let Some(resolution) = resolutions_by_sku.get(line.sku.as_str()) {
                let deductions_entry: Vec<serde_json::Value> = resolution
                    .allocations
                    .iter()
                    .filter(|a| a.qty > 0)
                    .map(|a| {
                        serde_json::json!({
                            "location_id": a.location_id.as_str(),
                            "qty": a.qty,
                            "sold_at": now
                        })
                    })
                    .collect();

                line_deductions.push(serde_json::json!({
                    "sale_line_id": line.id,
                    "sku": line.sku,
                    "deductions": deductions_entry,
                }));
            } else {
                // Non-resolution lines: single-location deduction at primary
                line_deductions.push(serde_json::json!({
                    "sale_line_id": line.id,
                    "sku": line.sku,
                    "deductions": [{
                        "location_id": primary_location.as_str(),
                        "qty": line.qty,
                        "sold_at": now
                    }]
                }));
            }
        }

        // MONEY-04: same ledger-integrity contract as complete_sale_deduction.
        validate_payment_splits_cover_total(payment_splits, sale.total.minor_units)?;

        // ── Phase 2: Execute deductions ───────────────────────────
        let deduct_tx_id = InventoryTransactionId::new();
        let term_id = terminal_id.map(crate::terminal::TerminalId::from);
        let user_id = crate::user::UserId::from(staff_user_id.to_owned());
        self.adjust_stock_batch(
            &tx,
            &deductions,
            Some("sale"),
            None,
            term_id.as_ref(),
            Some(&user_id),
        )?;

        // ── Phase 3: Persist sale + payments ──────────────────────
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let cur_str = std::str::from_utf8(&sale.currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;

        let deduction_json = serde_json::json!({
            "version": 1,
            "lines": line_deductions,
        })
        .to_string();

        // ── Receipt hierarchy code (phase 3) ─────────────────────
        // Same mint as the main checkout door: resolve (and lazily allocate
        // when missing) the location/terminal/staff index ids, claim the
        // store-local sequence and freeze the 22-char nomor faktur inside the
        // settlement tx. When no terminal is known the code cannot be formed,
        // `display_code` stays NULL, and the sale still completes.
        let (display_code, terminal_id_val) = self.mint_receipt_code(
            &tx,
            "default",
            primary_location.as_str(),
            terminal_id,
            staff_user_id,
            &now,
        )?;

        // SF-01: the shortfall retry settles a payment that was already
        // captured before the first attempt — the sale is terminal on
        // write. Writing 'pending' here left retry sales invisible to
        // every report (they filter status='completed') and, once the
        // ADR-20 stale-pending reaper is wired, would auto-void paid
        // transactions 30 minutes later. No expiry window is needed.
        tx.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                                 tendered_minor, discount_percent, discount_label, user_id,
                                 created_at, updated_at, subtotal_minor, tax_total_minor,
                                 customer_id, deduction_locations, version,
                                 pending_expires_at, tenant_id,
                                 base_currency, base_total_minor, tender_rate_millionths,
                                 tip_minor, service_charge_minor, terminal_id, display_code)
             VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, NULL, 'default',
                     ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            rusqlite::params![
                sale.id, sale.total.minor_units, cur_str, sale.line_count,
                sale.payment_method, sale.tendered_minor,
                sale.discount_percent, sale.discount_label, sale.user_id,
                sale.created_at, now,
                sale.subtotal.minor_units, sale.tax_total.minor_units,
                sale.customer_id, deduction_json,
                sale.base_currency, sale.base_total_minor, sale.tender_rate_millionths,
                sale.tip_minor, sale.service_charge_minor,
                terminal_id_val, display_code,
            ],
        )?;

        // LOY-06: this is a completion path too — award points atomically,
        // exactly as finalize_sale does for the main two-step flow.
        apply_customer_stats_on_completion(&tx, &sale.id);

        for line in &sale.lines {
            insert_sale_line(&tx, line)?;
        }

        // ── TRANSACTIONAL OUTBOX (ADR-19 §6b shortfall-resolved path) ───────────────────
        // The sync row for this sale is written HERE, inside the settlement
        // transaction, not by an event handler afterwards. Sync for sales is
        // outbox-only and there is no reconciliation sweep in the tree, so the
        // old commit-then-publish order lost the row permanently on a crash or
        // a handler error in that window - silently, because the bus swallows
        // handler Err and panics (event_bus.rs:259-281), and invisibly to the
        // operator, because a sale that was never enqueued shows up as none of
        // pending / synced / failed / oldest-pending.
        //
        // SaleSyncEnqueuer still runs on the event and now skips the insert
        // when a pending row for this sale id already exists, so this lane
        // produces exactly one row. The legacy complete_sale door (lane one,
        // sales_crud.rs create_sale + two update_sale_status calls) has no
        // transaction spanning completion and is NOT wired - it keeps relying
        // on the handler. See the note there.
        Store::enqueue_sale_outbox_in_tx(&tx, sale, cur_str)?;

        // ── AUDIT LOG IN-TX (PCI 10.2.1) ──────────────────────────────
        // Same seat and same contract as the main checkout door
        // (sales_checkout.rs): the audit row enters the settlement
        // transaction after the sale rows and before the payment inserts,
        // so a payments.idempotency_key UNIQUE collision rolls it back with
        // the sale, and AuditLogHandler's has_audit_row_for probe keeps the
        // handler from doubling it after commit.
        //
        // ACTOR DIVERGENCE (deliberate, documented on both ends): this door
        // stamps the real actor from the sale (sale.user_id); the legacy
        // complete_sale lane keeps the handler's empty-string actor because
        // SaleCompleted carries no actor field. Same action, two actor
        // shapes in audit_log depending on the settling door.
        let audit_actor = sale.user_id.clone().unwrap_or_default();
        let audit_entry = crate::AuditEntry::new(
            audit_actor,
            "sale.completed",
            Some("sale"),
            Some(sale.id.clone()),
            Some(
                serde_json::json!({
                    "sale_id": sale.id.clone(),
                    "total_minor": sale.total.minor_units,
                    "currency": cur_str,
                    "line_count": sale.lines.len(),
                })
                .to_string(),
            ),
            "success",
        );
        Store::log_audit_in_tx(&tx, &audit_entry)?;

        if !payment_splits.is_empty() {
            for split in payment_splits {
                let payment_id = uuid::Uuid::now_v7().to_string();
                // COR-7: persist the split's idempotency key exactly as the
                // main checkout path does (sales_checkout.rs) — without it,
                // a shortfall-retry that commits but loses its response is
                // invisible to the replay lookup, and a re-tap would ring up
                // a second sale. UNIQUE idx_payments_idempotency_key makes
                // any colliding write fail the whole tx (fail closed).
                tx.execute(
                    "INSERT INTO payments (id, sale_id, method, amount_minor, currency,
                                           gateway_reference, gateway_status, gateway_response,
                                           created_at, idempotency_key)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        payment_id,
                        sale.id,
                        split.method,
                        split.amount_minor,
                        cur_str,
                        split.gateway_reference,
                        split.gateway_status,
                        split.gateway_response,
                        now,
                        split.idempotency_key,
                    ],
                )?;
                // ── TRANSACTIONAL OUTBOX (C4 S2, the producer) ────────
                // Same seat and same contract as the main checkout door
                // (sales_checkout.rs): one `payment.recorded` row PER SPLIT,
                // right after that split's INSERT, inside the settlement
                // transaction. A tender row on one door but not its sibling
                // would be the invented-inconsistency class.
                Store::enqueue_payment_recorded_outbox_in_tx(
                    &tx,
                    &payment_id,
                    &sale.id,
                    split,
                    cur_str,
                    &now,
                )?;
            }
        }

        // ── Persist promotion applications (same tx as the sale) ──
        // PROMO-3 checkout integration: the caller reduced sale.total via
        // compute_checkout_promotions; the audit rows commit atomically
        // with the sale (guards documented on the helper).
        crate::db::promotions::persist_checkout_applications(&tx, &sale.id, checkout_applications)?;

        // ── Statutory numbering (regional slice 5) ────────────────
        // Same in-transaction contract as complete_sale_deduction_with_locations:
        // this is the ADR-19 §6b sibling checkout path, and a statutory number
        // on one path but not its sibling would be the invented-inconsistency
        // class. Unconfigured entities stamp nothing.
        let statutory_number = self.claim_statutory_number_for_sale(
            &tx,
            &sale.id,
            primary_location.as_str(),
            "receipt",
            &now,
        )?;

        tx.commit()?;

        // ADR #37 D3: recompute popularity for every sold SKU — the sale
        // ledger rows are durable now, so the sales signal (decayed units)
        // reflects this transaction. Runs outside the tx (read-only pass).
        for line in &sale.lines {
            if let Err(e) = self.recompute_popularity(line.sku.as_str()) {
                tracing::warn!(sku = %line.sku, error = %e, "popularity recompute failed after sale");
            }
        }

        Ok(crate::sale_deduction::CompleteSaleResult {
            sale_id: sale.id.clone(),
            status: foundation::SaleStatus::Completed,
            // Prefer the frozen hierarchy code; fall back to the sale id when
            // no terminal was known (display_code stays NULL — see mint).
            receipt_number: display_code.clone().unwrap_or_else(|| sale.id.clone()),
            deduct_tx_id,
            statutory_number,
        })
    }

    /// Void a pending sale and restore the reserved/dedicated stock back to original locations.
    pub fn void_pending_sale(&self, sale_id: &str) -> Result<(), CoreError> {
        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;

        // NULL deduction_locations is a legal state: the import/CLI door
        // (create_sale, MONEY-07) never writes the column, so imported
        // pending sales have nothing deducted through the location system.
        // Skip-credit (do NOT default-credit: that would invent stock).
        // Malformed JSON stays fail-closed.
        let deduction_locations_json: Option<String> = tx
            .query_row(
                "SELECT deduction_locations FROM sales WHERE id = ?1 AND status = 'pending'",
                rusqlite::params![sale_id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "pending sale",
                    id: sale_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;

        match deduction_locations_json.as_deref() {
            None | Some("") | Some("null") => {
                tracing::info!(
                    sale_id,
                    "voiding pending sale without deduction_locations — no location credits to restore"
                );
            }
            Some(json) => {
                let v: serde_json::Value =
                    serde_json::from_str(json).map_err(|e| CoreError::Validation {
                        field: "deduction_locations",
                        message: e.to_string(),
                    })?;

                if let Some(lines) = v["lines"].as_array() {
                    for line in lines {
                        let sku = line["sku"].as_str().ok_or_else(|| CoreError::Validation {
                            field: "sku",
                            message: "missing sku in deduction_locations".into(),
                        })?;
                        if let Some(deductions) = line["deductions"].as_array() {
                            for d in deductions {
                                let loc_id = d["location_id"].as_str().ok_or_else(|| {
                                    CoreError::Validation {
                                        field: "location_id",
                                        message: "missing location_id in deductions".into(),
                                    }
                                })?;
                                let qty =
                                    d["qty"].as_i64().ok_or_else(|| CoreError::Validation {
                                        field: "qty",
                                        message: "missing qty in deductions".into(),
                                    })?;

                                // Credit stock back (positive delta)
                                self.adjust_stock_at_location_with_reason(
                                    &tx,
                                    sku,
                                    qty,
                                    &crate::inventory::LocationId::from(loc_id),
                                    Some("void_pending"),
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                    }
                }
            }
        }

        let rows = tx.execute(
            "UPDATE sales SET status = 'voided', updated_at = ?1, version = version + 1 \
             WHERE id = ?2 AND status = 'pending'",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                sale_id
            ],
        )?;
        // COR-8: if the sale was already voided, skip the audit and commit silently.
        if rows == 0 {
            tx.rollback()?;
            return Ok(());
        }

        // S3: cancel any KDS tickets already created for this sale (the
        // ticket can exist between checkout completion and finalize) so the
        // voided sale never leaves a ghost ticket on the kitchen board.
        self.cancel_kds_orders_for_sale_in_tx(&tx, sale_id)?;

        tx.commit()?;
        Ok(())
    }

    /// Find all pending sales whose `pending_expires_at` is in the past.
    ///
    /// ADR-20 §6: uses the partial index `idx_sales_pending_expires` (created
    /// by migration 096) for efficient lookups. A sale is considered "stale"
    /// when `pending_expires_at < datetime('now')` — the 30-min expiry window
    /// was set at creation time in `complete_sale_deduction`.
    /// Find all pending sales whose `pending_expires_at` is in the past.
    ///
    /// ADR-20 §6: uses the partial index `idx_sales_pending_expires` (created
    /// by migration 096) for efficient lookups. A sale is considered "stale"
    /// when `pending_expires_at < NOW` — the 30-min expiry window was set at
    /// creation time in `complete_sale_deduction`.
    ///
    /// The threshold is computed in Rust using the exact same format
    /// (`chrono::SecondsFormat::Millis`) as the stored `pending_expires_at`
    /// values, avoiding format mismatches with SQLite's `strftime`.
    pub fn find_stale_pending_sales(&self) -> Result<Vec<String>, CoreError> {
        let now_rfc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut stmt = self.conn.prepare(
            "SELECT id FROM sales \
             WHERE status = 'pending' \
               AND pending_expires_at IS NOT NULL \
               AND pending_expires_at < ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![now_rfc], |row| row.get(0))?;
        rows.map(|r| r.map_err(CoreError::from)).collect()
    }

    /// Auto-void all stale pending sales whose `pending_expires_at` has passed.
    ///
    /// ADR-20 §6: intended to be called every 60 seconds by a background
    /// worker. Each stale sale is voided via [`void_pending_sale`](Self::void_pending_sale)
    /// which credits stock back to original deduction locations.
    ///
    /// Returns the number of stale sales that were voided.
    ///
    /// # Errors
    ///
    /// - Returns `CoreError::Db` if the query fails.
    /// - Individual void failures are logged but do NOT abort the batch.
    pub fn reap_stale_pending_sales(&self) -> Result<u32, CoreError> {
        let stale = self.find_stale_pending_sales()?;
        let mut count = 0u32;
        for sale_id in &stale {
            if let Err(e) = self.void_pending_sale(sale_id) {
                // Log but don't abort — other stale sales may succeed.
                tracing::warn!("failed to void stale pending sale {}: {}", sale_id, e);
            } else {
                count += 1;
            }
        }
        Ok(count)
    }
}

// ── Void Sale ───────────────────────────────────────────────────────

impl Store<'_> {
    /// Void a sale — sets status to Voided and logs an audit entry.
    /// Does NOT adjust inventory; stock is managed independently.
    pub fn void_sale(&self, sale_id: &str, user_id: &str, reason: &str) -> Result<Sale, CoreError> {
        let sale = self.get_sale(sale_id)?.ok_or_else(|| CoreError::NotFound {
            entity: "sale",
            id: sale_id.to_owned(),
        })?;

        if sale.status != SaleStatus::Active {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "only active sales can be voided (current: {:?})",
                    sale.status
                ),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;

        // 1. Update status to Voided with optimistic concurrency (ADR #6).
        // The status predicate makes this a compare-and-set: the
        // pre-check above reads OUTSIDE this transaction, so a
        // concurrent finalize could complete the sale in between —
        // without the guard that completed (paid, points-awarded) sale
        // would be silently overwritten to voided.
        let rows = tx.execute(
            "UPDATE sales SET status = 'voided', updated_at = ?1, version = version + 1
             WHERE id = ?2 AND status = 'active'",
            rusqlite::params![now, sale_id],
        )?;
        if rows == 0 {
            tx.rollback()?;
            return Err(CoreError::Conflict {
                entity: "sale",
                field: "version",
            });
        }

        // 2. Audit log entry.
        let details = serde_json::json!({
            "reason": reason,
            "total_minor": sale.total.minor_units,
        })
        .to_string();
        let audit = AuditEntry::new(
            user_id,
            "sale.void",
            Some("sale"),
            Some(sale_id),
            Some(details),
            "success",
        );
        self.log_audit(&audit)?;

        // S3: cancel active KDS tickets in the same transaction — a voided
        // sale's tickets must not linger on the kitchen board.
        self.cancel_kds_orders_for_sale_in_tx(&tx, sale_id)?;

        // ── TRANSACTIONAL OUTBOX (C4 S2, the producer) ──────────────
        // The sync row for this void is written HERE, inside the void
        // transaction and after the compare-and-set above succeeded, so a void
        // made on one terminal actually reaches the others: until this seat
        // existed nothing in production enqueued `void_sale`, and the
        // pull-side arm was unreachable. The CAS is what makes the row
        // conditional - the `rows == 0` branch above rolls back before this
        // point, so a lost race writes no queue row.
        Store::enqueue_void_sale_outbox_in_tx(&tx, sale_id)?;

        tx.commit()?;

        self.get_sale(sale_id)?.ok_or_else(|| CoreError::NotFound {
            entity: "sale",
            id: sale_id.to_owned(),
        })
    }
}

#[cfg(test)]
#[path = "sales_lifecycle_tests.rs"]
mod tests;
