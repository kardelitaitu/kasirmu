//! Sale checkout via ADR-19 location-aware stock deduction.
//!
//! Key functions: `complete_sale_deduction` (single-location fast path)
//! and `complete_sale_deduction_with_locations` (topology-aware,
//! multi-location allocation), plus the `batch_lookup_products` and
//! `stock_at_locations` helpers used only by this flow.
//!
//! Invariants: stock checks, deductions, sale + line persistence, and
//! deduction provenance all run inside one `BEGIN IMMEDIATE`
//! transaction; money paths use checked arithmetic (MONEY-01..07).

use super::*;
use crate::SaleStatus;
use std::collections::HashMap;

fn stock_at_locations(
    tx: &rusqlite::Transaction<'_>,
    product_id: &str,
    locations: &[crate::inventory::LocationId],
) -> Result<Vec<crate::sale_deduction::LocationStock>, CoreError> {
    locations
        .iter()
        .map(|location_id| {
            let qty: i64 = tx
                .query_row(
                    "SELECT COALESCE(qty, 0) FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
                    rusqlite::params![product_id, location_id.as_str()],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let location_name: String = tx
                .query_row(
                    "SELECT name FROM inventory_locations WHERE id = ?1",
                    rusqlite::params![location_id.as_str()],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| location_id.as_str().to_owned());
            Ok(crate::sale_deduction::LocationStock {
                location_id: location_id.clone(),
                location_name,
                qty_available: qty,
            })
        })
        .collect()
}

impl Store<'_> {
    /// Complete a sale with location-aware stock deduction (ADR-19 §6).
    ///
    /// This is the shared implementation used by both desktop and tablet
    /// POS commands. It performs the following inside a single `BEGIN IMMEDIATE`:
    ///
    /// 1. Creates an `inventory_transaction` audit session (§9a).
    /// 2. Resolves the primary deduction location via
    ///    [`resolve_primary_location`](crate::location_resolver::resolve_primary_location)
    ///    (tier 1 → explicit override, tier 2 → single-binding, tier 3 →
    ///    multi-binding primary, tier 4 → canonical default).
    /// 3. For each sale line, checks stock at the resolved(primary) location.
    ///    Collects ALL shortfalls before any writes.
    /// 4. If ANY shortfalls exist: ROLLBACK, return
    ///    [`PartialStockResult`](crate::sale_deduction::PartialStockResult)
    ///    with per-SKU shortfall details and available alternatives.
    /// 5. If ALL lines sufficed: calls [`adjust_stock_batch`](crate::db::Store::adjust_stock_batch)
    ///    atomically, creates the sale + payments, writes `deduction_locations`
    ///    JSON on the `sales` row with status = 'pending', COMMIT.
    ///
    /// The `workspace_instance_id` is used to resolve the primary location.
    /// Pass `None` for legacy single-location deployments — the canonical
    /// default UUID is used.
    #[allow(clippy::too_many_arguments)]
    pub fn complete_sale_deduction(
        &self,
        sale: &Sale,
        workspace_instance_id: Option<&str>,
        payment_splits: &[crate::PaymentSplitArg],
        staff_user_id: &str,
        terminal_id: Option<&str>,
    ) -> Result<crate::sale_deduction::CompleteSaleResult, CoreError> {
        let location = crate::location_resolver::resolve_primary_location(
            self.conn,
            workspace_instance_id.unwrap_or("default"),
            None,
        )
        .unwrap_or_else(|_| crate::location_resolver::get_default_location_id());
        self.complete_sale_deduction_with_locations(
            sale,
            workspace_instance_id,
            &[location],
            payment_splits,
            staff_user_id,
            terminal_id,
            &[],
        )
    }
}

/// Batch-lookup product (id, product_type) for multiple SKUs in a single query.
///
/// Returns a `HashMap<SKU, (product_id, product_type)>`. SKUs not found
/// in the database are absent from the map (caller handles missing entries).
fn batch_lookup_products(
    conn: &rusqlite::Connection,
    skus: &[&str],
) -> Result<HashMap<String, (String, String)>, CoreError> {
    if skus.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders: Vec<String> = (0..skus.len()).map(|i| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT sku, id, product_type FROM products WHERE sku IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = skus
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (sku, id, ptype) = row?;
        map.insert(sku, (id, ptype));
    }
    Ok(map)
}

impl Store<'_> {
    /// Complete a sale by greedily allocating each tracked line across the
    /// topology-selected locations in route order. All stock checks,
    /// deductions, sale persistence, and deduction provenance remain inside
    /// one SQLite transaction; an underfunded route set rolls back entirely.
    ///
    /// `checkout_applications` carries promotion applications the caller
    /// computed via [`Store::compute_checkout_promotions`] — the sale's
    /// total is expected to already be reduced by their sum. Each row is
    /// persisted inside this same transaction (with a duplicate guard) so
    /// the audit trail commits atomically with the sale.
    #[allow(clippy::too_many_arguments)]
    pub fn complete_sale_deduction_with_locations(
        &self,
        sale: &Sale,
        workspace_instance_id: Option<&str>,
        stock_locations: &[crate::inventory::LocationId],
        payment_splits: &[crate::PaymentSplitArg],
        _staff_user_id: &str,
        _terminal_id: Option<&str>,
        checkout_applications: &[crate::PromotionApplication],
    ) -> Result<crate::sale_deduction::CompleteSaleResult, CoreError> {
        self.complete_sale_deduction_with_locations_and_estimate(
            sale,
            workspace_instance_id,
            stock_locations,
            payment_splits,
            _staff_user_id,
            _terminal_id,
            checkout_applications,
            false,
        )
    }

    /// F2-5: checkout with the client's tax-estimate CLAIM. The claim is a
    /// boolean only — the note's content is authored by core: at insert, in
    /// the same transaction as the sale, the stamp records
    /// `{"estimated":true,"computed_tax":<i64>}` where `computed_tax` is the
    /// tax core itself computed for the cart (the caller computed it via
    /// `compute_sale_tax_for_location` before this door; nothing client-side
    /// ever writes the number). D61 ruling 4: never silent-zero — the sale
    /// is flagged so history can flag it for recompute. `false` (or the
    /// legacy wrapper) stamps nothing: NULL = unstamped = no claim.
    #[allow(clippy::too_many_arguments)]
    pub fn complete_sale_deduction_with_locations_and_estimate(
        &self,
        sale: &Sale,
        workspace_instance_id: Option<&str>,
        stock_locations: &[crate::inventory::LocationId],
        payment_splits: &[crate::PaymentSplitArg],
        _staff_user_id: &str,
        _terminal_id: Option<&str>,
        checkout_applications: &[crate::PromotionApplication],
        tax_estimated: bool,
    ) -> Result<crate::sale_deduction::CompleteSaleResult, CoreError> {
        use crate::inventory_transaction::InventoryTransactionId;
        use crate::sale_deduction::{Shortfall, StockDeduction};

        // MONEY-03 follow-up: a negative line qty would record a negative
        // ledger total AND credit stock (the deduction delta is `-qty`, which
        // is positive when qty is negative). CartLine asserts qty > 0, but this
        // is the ledger boundary — reject hostile or hand-built sales up front.
        for line in &sale.lines {
            if line.qty < 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: format!("sale line quantity must be positive, got {}", line.qty),
                });
            }
        }

        // Enforce subscription offline grace period / read-only lock.
        // Once the grace period expires, the register cannot process sales.
        self.enforce_pos_writable()?;

        // ADR-19 §5.2: single transaction prevents two concurrent sales from
        // racing on the same inventory row. Same pattern as create_sale().
        let tx = self.conn.unchecked_transaction()?;

        // ── Resolve topology route order ──────────────────────────
        let default_location = crate::location_resolver::get_default_location_id();
        let stock_locations = if stock_locations.is_empty() {
            std::slice::from_ref(&default_location)
        } else {
            stock_locations
        };
        let primary_location = stock_locations[0].clone();

        // ── Phase 1: stock check + shortfall collection ────────────
        let mut deductions: Vec<StockDeduction> = Vec::with_capacity(sale.lines.len());
        let mut line_deductions: HashMap<String, Vec<crate::sale_deduction::LocationAllocation>> =
            HashMap::new();
        let mut shortfalls: Vec<Shortfall> = Vec::new();

        // Batch-lookup all SKUs in a single query (avoids N+1 per-line SELECT).
        let skus: Vec<&str> = sale.lines.iter().map(|l| l.sku.as_str()).collect();
        let product_map = batch_lookup_products(&tx, &skus)?;

        for line in &sale.lines {
            let Some((pid, ptype_str)) = product_map.get(line.sku.as_str()) else {
                shortfalls.push(Shortfall {
                    sku: line.sku.clone(),
                    product_name: line.sku.clone(),
                    requested_qty: line.qty,
                    primary_qty_available: 0,
                    deficit: line.qty,
                    primary_location_id: primary_location.clone(),
                    alternatives: vec![],
                });
                continue;
            };
            let ptype = crate::product::ProductType::parse_str(ptype_str).unwrap_or_default();
            let tracks_inventory = ptype.tracks_inventory();
            let recipe = self.get_recipe_ingredients(pid)?;
            let has_recipe = !recipe.is_empty();

            if !tracks_inventory && !has_recipe {
                // Skip checking stock for service products that do not have a recipe.
                continue;
            }

            // 1. Check composite product stock if it tracks inventory
            if tracks_inventory {
                let availability = stock_at_locations(&tx, pid, stock_locations)?;
                if let Some(allocations) =
                    crate::sale_deduction::allocate_stock_in_route_order(line.qty, &availability)
                {
                    deductions.extend(allocations.iter().map(|allocation| StockDeduction {
                        sku: line.sku.clone(),
                        location_id: allocation.location_id.clone(),
                        delta: -allocation.qty,
                    }));
                    line_deductions.insert(line.id.to_string(), allocations);
                } else {
                    let available = availability
                        .first()
                        .map(|location| location.qty_available)
                        .unwrap_or(0);
                    let alternatives = if stock_locations.len() > 1 {
                        availability
                            .into_iter()
                            .skip(1)
                            .filter(|a| a.qty_available > 0)
                            .collect()
                    } else if let Some(ws_id) = workspace_instance_id {
                        crate::location_resolver::resolve_location_chain_for_sku(
                            &tx, ws_id, &line.sku, line.qty,
                        )
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|a| a.location_id != primary_location)
                        .collect()
                    } else {
                        vec![]
                    };

                    shortfalls.push(Shortfall {
                        sku: line.sku.clone(),
                        product_name: line.sku.clone(),
                        requested_qty: line.qty,
                        primary_qty_available: available,
                        deficit: line.qty.saturating_sub(available),
                        primary_location_id: primary_location.clone(),
                        alternatives,
                    });
                }
            }

            // 2. Check BOM ingredients if has recipe
            if has_recipe {
                for ingredient in recipe {
                    // Load ingredient product details
                    let ing_info: Option<(String, String, String)> = match tx.query_row(
                        "SELECT sku, name, product_type FROM products WHERE id = ?1",
                        rusqlite::params![ingredient.ingredient_product_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    ) {
                        Ok(val) => Some(val),
                        Err(rusqlite::Error::QueryReturnedNoRows) => None,
                        Err(e) => return Err(CoreError::Db(e)),
                    };

                    if let Some((ing_sku, ing_name, ing_ptype_str)) = ing_info {
                        let ing_ptype = crate::product::ProductType::parse_str(&ing_ptype_str)
                            .unwrap_or_default();
                        if ing_ptype.tracks_inventory() {
                            // MONEY-03: line.qty arrives from untrusted IPC input
                            // and must use checked arithmetic like `compute_line_tax`
                            // (TAX-04). Dev/test builds disable overflow checks, so
                            // a bare `*` silently wraps and completes the sale with
                            // a corrupt stock delta.
                            let required_qty = line
                                .qty
                                .checked_mul(ingredient.quantity_required)
                                .ok_or_else(|| CoreError::Validation {
                                field: "qty",
                                message: "ingredient deduction quantity overflow".into(),
                            })?;
                            let availability = stock_at_locations(
                                &tx,
                                &ingredient.ingredient_product_id,
                                stock_locations,
                            )?;
                            if let Some(allocations) =
                                crate::sale_deduction::allocate_stock_in_route_order(
                                    required_qty,
                                    &availability,
                                )
                            {
                                deductions.extend(allocations.iter().map(|allocation| {
                                    StockDeduction {
                                        sku: ing_sku.clone(),
                                        location_id: allocation.location_id.clone(),
                                        delta: -allocation.qty,
                                    }
                                }));
                            } else {
                                let available = availability
                                    .first()
                                    .map(|location| location.qty_available)
                                    .unwrap_or(0);
                                let alternatives = if stock_locations.len() > 1 {
                                    availability
                                        .into_iter()
                                        .skip(1)
                                        .filter(|a| a.qty_available > 0)
                                        .collect()
                                } else if let Some(ws_id) = workspace_instance_id {
                                    crate::location_resolver::resolve_location_chain_for_sku(
                                        &tx,
                                        ws_id,
                                        &ing_sku,
                                        required_qty,
                                    )
                                    .unwrap_or_default()
                                    .into_iter()
                                    .filter(|a| a.location_id != primary_location)
                                    .collect()
                                } else {
                                    vec![]
                                };

                                shortfalls.push(Shortfall {
                                    sku: ing_sku,
                                    product_name: ing_name,
                                    requested_qty: required_qty,
                                    primary_qty_available: available,
                                    deficit: required_qty.saturating_sub(available),
                                    primary_location_id: primary_location.clone(),
                                    alternatives,
                                });
                            }
                        }
                    }
                }
            }
        }

        // ── Shortfall path: rollback, return PartialStockResult ───
        if !shortfalls.is_empty() {
            tx.rollback()?;
            // Return as PartialStockResult via a dedicated error type is
            // cleaner, but for now we use the standard result type pattern.
            // The caller (Tauri command) matches on the return variant.
            return Err(CoreError::Validation {
                field: "stock",
                message: serde_json::to_string(&crate::sale_deduction::PartialStockResult {
                    requires_resolution: true,
                    shortfalls,
                })
                .unwrap_or_else(|_| "shortfalls serialization failed".into()),
            });
        }

        // MONEY-04: validate payment splits against the ledger total AFTER
        // stock resolution (so the PartialStockResult dialog keeps precedence)
        // but BEFORE any write — the error path rolls the whole tx back.
        // The total is promotion-reduced when the caller applied checkout
        // promotions (PROMO-3 integration).
        validate_payment_splits_cover_total(payment_splits, sale.total.minor_units)?;

        // ── Phase 2: execute deductions ───────────────────────────
        let deduct_tx_id = InventoryTransactionId::new();
        let term_id = _terminal_id.map(crate::terminal::TerminalId::from);
        let user_id = crate::user::UserId::from(_staff_user_id.to_owned());
        self.adjust_stock_batch(
            &tx,
            &deductions,
            Some("sale"),
            None,
            term_id.as_ref(),
            Some(&user_id),
        )?;

        // ── Write deduction_locations JSON ────────────────────────
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let deduction_json = serde_json::json!({
            "version": 1,
            "lines": sale.lines.iter().map(|line| {
                let deductions = line_deductions
                    .get(&line.id.to_string())
                    .map(|allocations| {
                        allocations
                            .iter()
                            .map(|allocation| serde_json::json!({
                                "location_id": allocation.location_id.as_str(),
                                "qty": allocation.qty,
                                "sold_at": now,
                            }))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_else(|| vec![serde_json::json!({
                        "location_id": primary_location.as_str(),
                        "qty": line.qty,
                        "sold_at": now,
                    })]);
                serde_json::json!({
                    "sale_line_id": line.id,
                    "sku": line.sku,
                    "deductions": deductions,
                })
            }).collect::<Vec<_>>()
        })
        .to_string();

        // ── Persist sale + payments ───────────────────────────────
        let cur_str = std::str::from_utf8(&sale.currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;

        // F2-5: the estimate note is composed HERE, at insert, inside the
        // checkout transaction — the computed tax is core's own number, the
        // client only supplied the boolean claim.
        let tax_estimate_note: Option<String> = if tax_estimated {
            Some(
                serde_json::json!({
                    "estimated": true,
                    "computed_tax": sale.tax_total.minor_units,
                })
                .to_string(),
            )
        } else {
            None
        };

        // ADR-20 §6: pending_expires_at = NOW + 30 min for stale-reaper.
        let pending_expires_at = chrono::Utc::now()
            .checked_add_signed(chrono::Duration::minutes(30))
            .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_else(|| now.clone());

        tx.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                                 tendered_minor, discount_percent, discount_label, user_id,
                                 created_at, updated_at, subtotal_minor, tax_total_minor,
                                 customer_id, deduction_locations, version,
                                 pending_expires_at, tenant_id,
                                 base_currency, base_total_minor, tender_rate_millionths,
                                 tip_minor, service_charge_minor, tax_estimate_note)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16, 'default',
                     ?17, ?18, ?19, ?20, ?21, ?22)",
            rusqlite::params![
                sale.id, sale.total.minor_units, cur_str, sale.line_count,
                sale.payment_method, sale.tendered_minor,
                sale.discount_percent, sale.discount_label, sale.user_id,
                sale.created_at, now,
                sale.subtotal.minor_units, sale.tax_total.minor_units,
                sale.customer_id, deduction_json, pending_expires_at,
                sale.base_currency, sale.base_total_minor, sale.tender_rate_millionths,
                sale.tip_minor, sale.service_charge_minor, tax_estimate_note,
            ],
        )?;

        for line in &sale.lines {
            insert_sale_line(&tx, line)?;
        }

        // Create payment records.
        if !payment_splits.is_empty() {
            for split in payment_splits {
                let payment_id = uuid::Uuid::now_v7().to_string();
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
            }
        }

        // ── Persist promotion applications (same tx as the sale) ──
        // PROMO-3 checkout integration: the caller reduced sale.total via
        // compute_checkout_promotions; the audit rows commit atomically
        // with the sale (guards documented on the helper).
        crate::db::promotions::persist_checkout_applications(&tx, &sale.id, checkout_applications)?;

        // ── Statutory numbering (regional slice 5) ────────────────
        // The claim runs INSIDE this transaction (constraint: statutory
        // sequence writes must be atomic with the sale — a rolled-back
        // sale must not consume a number). Unconfigured entities stamp
        // nothing and keep today's behavior. The `now` timestamp drives
        // the period bucket, matching the sale's own business moment.
        let statutory_number = self.claim_statutory_number_for_sale(
            &tx,
            &sale.id,
            primary_location.as_str(),
            "receipt",
            &now,
        )?;

        tx.commit()?;

        Ok(crate::sale_deduction::CompleteSaleResult {
            sale_id: sale.id.clone(),
            status: SaleStatus::Pending,
            receipt_number: sale.id.clone(),
            deduct_tx_id,
            statutory_number,
        })
    }
}
