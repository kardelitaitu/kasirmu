//! Sale serving layer for the cloud Postgres replica.
//!
//! Owns the sale header + line insert (one transaction), the idempotency
//! claim/release pair, the unguarded-record path, and the read/status-update
//! functions the REST surface dispatches to when a PG pool is configured.
//!
//! Main functions: [`create_sale`], [`claim_sale_idempotency`],
//! [`release_sale_idempotency`], [`record_unguarded_sale`], [`get_sale`],
//! [`update_sale_status`].
//!
//! Invariant: every statement runs inside one transaction that has already
//! set `oz.tenant_id` LOCAL, exactly like the rest of the `pg` module.

use deadpool_postgres::Pool;

use kasirmu_core::{Currency, Money, Sale, SaleLine, SaleStatus};

use super::PgError;
use super::helpers::{currency_str, now_rfc3339};

/// Persist a sale header + lines in one transaction, mirroring the SQLite
/// `Store::create_sale` (including the same negative-value rejections and
/// the frozen `cost_minor` snapshot on each line). The per-line cost freeze
/// looks the product up within `tenant_id` (SKUs are unique per tenant).
pub async fn create_sale(pool: &Pool, tenant_id: &str, sale: &Sale) -> Result<(), PgError> {
    for line in &sale.lines {
        if line.qty < 0 {
            return Err(PgError::Validation(format!(
                "sale line quantity must be positive, got {}",
                line.qty
            )));
        }
        if line.line_total.minor_units < 0 {
            return Err(PgError::Validation(
                "sale line total must be non-negative".into(),
            ));
        }
        if line.tax_amount.minor_units < 0 {
            return Err(PgError::Validation(
                "sale line tax must be non-negative".into(),
            ));
        }
    }
    if sale.total.minor_units < 0 || sale.subtotal.minor_units < 0 || sale.tax_total.minor_units < 0
    {
        return Err(PgError::Validation(
            "sale totals must be non-negative".into(),
        ));
    }
    if let Some(tendered) = sale.tendered_minor
        && tendered < 0
    {
        return Err(PgError::Validation(
            "tendered amount must be non-negative".into(),
        ));
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

    let cur_str = currency_str(&sale.currency)?;
    let status_str = sale.status.as_stored_str();
    tx.execute(
        // CUR-02 cloud gap: the tender metadata (base currency/total/rate)
        // and tip/service amounts must be written here — `get_sale` below
        // already reads all five columns, so omitting them made every
        // cloud-side sale show NULL tender info and lost the tip/service
        // amounts for reconciliation.
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, tendered_minor,
                            discount_percent, discount_label, user_id, created_at, updated_at,
                            subtotal_minor, tax_total_minor, customer_id, version, tenant_id,
                            base_currency, base_total_minor, tender_rate_millionths,
                            tip_minor, service_charge_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16,
                 $17, $18, $19, $20, $21)",
        &[
            &sale.id,
            &sale.total.minor_units,
            &cur_str,
            &sale.line_count,
            &status_str,
            &sale.payment_method,
            &sale.tendered_minor,
            &sale.discount_percent,
            &sale.discount_label,
            &sale.user_id,
            &sale.created_at,
            &sale.updated_at,
            &sale.subtotal.minor_units,
            &sale.tax_total.minor_units,
            &sale.customer_id,
            &tenant_id,
            &sale.base_currency,
            &sale.base_total_minor,
            &sale.tender_rate_millionths,
            &sale.tip_minor,
            &sale.service_charge_minor,
        ],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;

    for line in &sale.lines {
        let line_cur = currency_str(&line.unit_price.currency)?;
        // Freeze the product cost at write time (ADR #36 reporting) and
        // the product identity (REP-05): renaming a product, moving it
        // between categories, or reusing a deleted sku must never
        // relabel historical revenue in the email reports.
        let (cost_minor, product_id, product_name, category_id): (Option<i64>, Option<String>, Option<String>, Option<String>) = tx
            .query_opt(
                "SELECT cost_minor, id, name, category_id FROM products WHERE tenant_id = $1 AND sku = $2",
                &[&tenant_id, &line.sku],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
            .map(|r| {
                (
                    Some(r.get::<_, i64>(0)).filter(|&v| v > 0),
                    r.get::<_, Option<String>>(1),
                    r.get::<_, Option<String>>(2),
                    r.get::<_, Option<String>>(3),
                )
            })
            .unwrap_or_default();
        tx.execute(
            // tenant_id is written explicitly (not via column default) so
            // every line row lands in the caller's tenant — the header's
            // set_config scopes RLS, but the column default would still
            // stamp 'default' into the row itself.
            "INSERT INTO sale_lines (id, sale_id, tenant_id, sku, qty, unit_minor, line_minor, currency, line_position,
                                     tax_minor, tax_rate_id, tax_breakdown_json,
                                     serial_number, course, modifiers_json, cost_minor,
                                     product_id, product_name, category_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
            &[
                &line.id,
                &line.sale_id,
                &tenant_id,
                &line.sku,
                &line.qty,
                &line.unit_price.minor_units,
                &line.line_total.minor_units,
                &line_cur,
                &line.line_position,
                &line.tax_amount.minor_units,
                &line.tax_rate_id,
                &line.tax_breakdown_json,
                &line.serial_number,
                &line.course,
                &line.modifiers_json,
                &cost_minor,
                &product_id,
                &product_name,
                &category_id,
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Build a [`SaleLine`] from a Postgres row.
fn pg_row_to_sale_line(row: &tokio_postgres::Row) -> Result<SaleLine, PgError> {
    let cur_str: String = row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let currency = cur_str
        .parse::<Currency>()
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(SaleLine {
        id: row.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
        sale_id: row
            .try_get("sale_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        sku: row.try_get("sku").map_err(|e| PgError::Db(e.to_string()))?,
        qty: row.try_get("qty").map_err(|e| PgError::Db(e.to_string()))?,
        unit_price: Money {
            minor_units: row
                .try_get("unit_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_total: Money {
            minor_units: row
                .try_get("line_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_position: row
            .try_get("line_position")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tax_amount: Money {
            minor_units: row
                .try_get("tax_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        tax_rate_id: row
            .try_get("tax_rate_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tax_breakdown_json: row
            .try_get("tax_breakdown_json")
            .map_err(|e| PgError::Db(e.to_string()))?,
        serial_number: row
            .try_get("serial_number")
            .map_err(|e| PgError::Db(e.to_string()))?,
        course: row
            .try_get("course")
            .map_err(|e| PgError::Db(e.to_string()))?,
        modifiers_json: row
            .try_get("modifiers_json")
            .map_err(|e| PgError::Db(e.to_string()))?,
    })
}

// ────────────────────── Sale idempotency guard ───────────────────

/// Verdict of a claim attempt on one (tenant_id, key) slot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaleClaim {
    /// This request holds the slot for the sale id it supplied, so it must go
    /// on and write that sale.
    Held,
    /// An earlier request already holds the slot. The payload is the ORIGINAL
    /// sale id, which the caller reads back and returns as the receipt.
    Replay(String),
}

/// Claim (tenant_id, key) on behalf of sale_id, BEFORE any ledger write.
///
/// Insert-first, then read the row back: a concurrent loser's
/// ON CONFLICT (tenant_id, key) DO NOTHING waits on the winner's unique-index
/// entry, affects zero rows, and then SELECTs the WINNER's sale id. That is why
/// 23505 (unique_violation) never reaches PgError::Db here, and why exactly one
/// of two racing submits answers 201 while the other answers 200 with the same
/// sale body. The key is the client's opaque string, matched by exact equality
/// only; nothing here parses it, and a request with no usable key never calls
/// this function at all.
///
/// RLS: sale_idempotency is a covered table, so the pair runs inside one
/// transaction with set_config('oz.tenant_id', …, true) exactly like every
/// other tenant-scoped helper in this module — one tenant can neither resolve
/// nor block another tenant's slot.
pub async fn claim_sale_idempotency(
    pool: &Pool,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<SaleClaim, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let claimed = tx
        .execute(
            "INSERT INTO sale_idempotency (tenant_id, key, sale_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, key) DO NOTHING",
            &[&tenant_id, &key, &sale_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let verdict = if claimed == 1 {
        SaleClaim::Held
    } else {
        match tx
            .query_opt(
                "SELECT sale_id FROM sale_idempotency WHERE tenant_id = $1 AND key = $2",
                &[&tenant_id, &key],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
        {
            Some(row) => SaleClaim::Replay(row.get::<_, String>(0)),
            // A conflicting slot rolled back between the two statements leaves
            // nothing to replay; inventing a sale is not this function's call.
            None => return Err(PgError::Db("idempotency slot vanished mid-race".into())),
        }
    };
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(verdict)
}

/// Drop a slot this request held but could not turn into a sale.
///
/// Called when the create behind a Held claim failed: leaving the slot bound to
/// a sale id that was never written would make every later retry resolve to a
/// receipt with no sale behind it. The delete is narrowed to our own sale_id,
/// so a concurrent winner's slot is never touched.
pub async fn release_sale_idempotency(
    pool: &Pool,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "DELETE FROM sale_idempotency WHERE tenant_id = $1 AND key = $2 AND sale_id = $3",
        &[&tenant_id, &key, &sale_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Record an UNGUARDED sale — one whose request carried no usable key — as a
/// row with a NULL key.
///
/// NULL is distinct in a SQL unique index in both engines, so these rows can
/// never resolve or block a later request: an unbounded number of unguarded
/// sales per tenant stays legal, which is the whole point of the nullable
/// column. This is bookkeeping, never a guard, and its failure must not turn an
/// already-written sale into an error response.
pub async fn record_unguarded_sale(
    pool: &Pool,
    tenant_id: &str,
    sale_id: &str,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO sale_idempotency (tenant_id, key, sale_id) VALUES ($1, NULL, $2)",
        &[&tenant_id, &sale_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Get a single sale by id, including line items.
pub async fn get_sale(pool: &Pool, tenant_id: &str, id: &str) -> Result<Option<Sale>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let sale_row = tx
        .query_opt(
            "SELECT id, total_minor, currency, line_count, status, payment_method, tendered_minor,
                    discount_percent, discount_label, user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales WHERE id = $1",
            &[&id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let Some(sale_row) = sale_row else {
        return Ok(None);
    };
    let cur_str: String = sale_row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let currency = cur_str
        .parse::<Currency>()
        .map_err(|e| PgError::Db(e.to_string()))?;
    let status_str: String = sale_row
        .try_get("status")
        .map_err(|e| PgError::Db(e.to_string()))?;

    let mut sale = Sale {
        id: sale_row
            .try_get("id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // sales.status has no CHECK constraint: a writer from a newer build can
        // store a value from_stored_str does not know. Keep serving the row —
        // failing the whole read over a label costs the sale — but Pending is
        // itself a legitimate stored value, so the fallback is ambiguous between
        // "genuinely pending" and "unmapped status", and the warning is how you
        // tell them apart.
        status: match SaleStatus::from_stored_str(&status_str) {
            Some(s) => s,
            None => {
                // id is TEXT PRIMARY KEY (20260813_init.pg.sql:1006), so this
                // re-read cannot fail.
                let row_id: String = sale_row.try_get("id").unwrap_or_default();
                tracing::warn!(
                    sale_id = %row_id,
                    raw = %status_str,
                    "unmapped sale status on sales row; falling back to Pending"
                );
                SaleStatus::Pending
            }
        },
        total: Money {
            minor_units: sale_row
                .try_get("total_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_count: sale_row
            .try_get("line_count")
            .map_err(|e| PgError::Db(e.to_string()))?,
        currency,
        payment_method: sale_row
            .try_get("payment_method")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tendered_minor: sale_row
            .try_get("tendered_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        discount_percent: sale_row
            .try_get::<_, i64>("discount_percent")
            .map_err(|e| PgError::Db(e.to_string()))?,
        discount_label: sale_row
            .try_get("discount_label")
            .map_err(|e| PgError::Db(e.to_string()))?,
        user_id: sale_row
            .try_get("user_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        created_at: sale_row
            .try_get("created_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        updated_at: sale_row
            .try_get("updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        lines: Vec::new(),
        subtotal: Money {
            minor_units: sale_row
                .try_get("subtotal_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        tax_total: Money {
            minor_units: sale_row
                .try_get("tax_total_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        customer_id: sale_row
            .try_get("customer_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        version: sale_row
            .try_get("version")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // CUR-02: multi-currency tender fields (nullable — None for
        // single-currency sales, matching the migration defaults).
        base_currency: sale_row
            .try_get("base_currency")
            .map_err(|e| PgError::Db(e.to_string()))?,
        base_total_minor: sale_row
            .try_get("base_total_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tender_rate_millionths: sale_row
            .try_get("tender_rate_millionths")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // CUR-02 charge fields: BIGINT NOT NULL DEFAULT 0 in PG
        // (20260813_init.pg.sql:1028) and INTEGER NOT NULL DEFAULT 0 in SQLite
        // (20260822_sale_charges.sql:5-6), so a failed read here is a type
        // drift, never a legitimate empty tip. Unlike the fallbacks above, 0 is
        // a real answer on a receipt that nothing downstream can tell apart
        // from a drifted read — the one swallow in this set that must fail the
        // read instead of serving a wrong number.
        tip_minor: sale_row
            .try_get("tip_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        service_charge_minor: sale_row
            .try_get("service_charge_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
    };

    let line_rows = tx
        .query(
            "SELECT id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position,
                    tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course, modifiers_json
             FROM sale_lines WHERE sale_id = $1 AND tenant_id = $2 ORDER BY line_position",
            &[&id, &tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    for row in &line_rows {
        sale.lines.push(pg_row_to_sale_line(row)?);
    }

    let result = Ok(Some(sale));
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Transition a sale's status, validating the state machine first.
///
/// The UPDATE is a compare-and-swap (`WHERE id = $1 AND status = $2`) so
/// two concurrent transitions cannot both validate against the same stale
/// status and double-apply (the loser re-reads and reports the current
/// state).
pub async fn update_sale_status(
    pool: &Pool,
    tenant_id: &str,
    id: &str,
    to: SaleStatus,
) -> Result<Sale, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let current_str: Option<String> = tx
        .query_opt("SELECT status FROM sales WHERE id = $1", &[&id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get(0));
    let current_str = match current_str {
        Some(s) => s,
        None => return Err(PgError::NotFound),
    };

    let current = SaleStatus::from_stored_str(&current_str)
        .ok_or_else(|| PgError::Validation(format!("invalid stored status: {current_str}")))?;
    if !SaleStatus::can_transition_to(current, to) {
        return Err(PgError::Validation(format!(
            "cannot transition from {current:?} to {to:?}"
        )));
    }

    let now = now_rfc3339();
    let updated = tx
        .execute(
            "UPDATE sales SET status = $1, updated_at = $2, version = version + 1 \
                 WHERE id = $3 AND status = $4",
            &[&to.as_stored_str(), &now, &id, &current_str],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    if updated == 0 {
        // Lost the race to a concurrent transition — re-read to report the
        // status we actually saw, rather than silently succeeding.
        let now_str: Option<String> = tx
            .query_opt("SELECT status FROM sales WHERE id = $1", &[&id])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
            .map(|r| r.get(0));
        return match now_str {
            None => Err(PgError::NotFound),
            Some(s) => Err(PgError::Validation(format!(
                "cannot transition from {s:?} to {to:?}"
            ))),
        };
    }

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    match get_sale(pool, tenant_id, id).await? {
        Some(sale) => Ok(sale),
        None => Err(PgError::NotFound),
    }
}
