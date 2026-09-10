//! Sale row CRUD and query helpers.
//!
//! Key functions: `create_sale` / `create_sale_in_tx`, the `list_sales*`
//! family (history cap, store, user, customer scopes), `get_sale` and
//! `update_sale_status`, with the shared `validate_sale_money` /
//! `insert_sale_with_lines` helpers and the `row_to_sale_line` row
//! mapper.
//!
//! Invariants: money and quantities are i64 minor units validated by
//! the MONEY-06/07 rules; all writes run in explicit transactions.

use super::*;
use crate::SaleStatus;
use rusqlite::OptionalExtension;

/// Validate the non-negative money/qty class guarded by MONEY-06/MONEY-07
/// (shared by `create_sale` and `create_sale_in_tx`).
fn validate_sale_money(sale: &Sale) -> Result<(), CoreError> {
    for line in &sale.lines {
        if line.qty < 0 {
            return Err(CoreError::Validation {
                field: "qty",
                message: format!("sale line quantity must be positive, got {}", line.qty),
            });
        }
        if line.line_total.minor_units < 0 {
            return Err(CoreError::Validation {
                field: "line_total",
                message: format!(
                    "sale line total must be non-negative, got {}",
                    line.line_total.minor_units
                ),
            });
        }
        if line.tax_amount.minor_units < 0 {
            return Err(CoreError::Validation {
                field: "tax_amount",
                message: format!(
                    "sale line tax must be non-negative, got {}",
                    line.tax_amount.minor_units
                ),
            });
        }
    }
    if sale.total.minor_units < 0 {
        return Err(CoreError::Validation {
            field: "total",
            message: format!(
                "sale total must be non-negative, got {}",
                sale.total.minor_units
            ),
        });
    }
    if sale.subtotal.minor_units < 0 {
        return Err(CoreError::Validation {
            field: "subtotal",
            message: format!(
                "sale subtotal must be non-negative, got {}",
                sale.subtotal.minor_units
            ),
        });
    }
    if sale.tax_total.minor_units < 0 {
        return Err(CoreError::Validation {
            field: "tax_total",
            message: format!(
                "sale tax total must be non-negative, got {}",
                sale.tax_total.minor_units
            ),
        });
    }
    if let Some(tendered) = sale.tendered_minor
        && tendered < 0
    {
        return Err(CoreError::Validation {
            field: "tendered_minor",
            message: format!("tendered amount must be non-negative, got {tendered}"),
        });
    }
    Ok(())
}

/// Insert the sale row plus its line rows inside the caller's transaction
/// (shared by `create_sale` and `create_sale_in_tx`).
fn insert_sale_with_lines(
    tx: &rusqlite::Transaction<'_>,
    sale: &Sale,
    cur_str: &str,
    status_str: &str,
) -> Result<(), CoreError> {
    tx.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, tendered_minor,
                            discount_percent, discount_label, user_id, created_at, updated_at,
                            subtotal_minor, tax_total_minor, customer_id, version, tenant_id,
                            base_currency, base_total_minor, tender_rate_millionths,
                            tip_minor, service_charge_minor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, 'default',
                 ?16, ?17, ?18, ?19, ?20)",
        params![
            sale.id, sale.total.minor_units, cur_str, sale.line_count,
            status_str, sale.payment_method, sale.tendered_minor,
            sale.discount_percent, sale.discount_label, sale.user_id,
            sale.created_at, sale.updated_at,
            sale.subtotal.minor_units, sale.tax_total.minor_units,
            sale.customer_id,
            sale.base_currency, sale.base_total_minor, sale.tender_rate_millionths,
            sale.tip_minor, sale.service_charge_minor,
        ],
    )?;

    for line in &sale.lines {
        insert_sale_line(tx, line)?;
    }
    Ok(())
}

// ── Sale CRUD ────────────────────────────────────────────────────

impl Store<'_> {
    fn row_to_sale_line(row: &rusqlite::Row) -> rusqlite::Result<SaleLine> {
        let unit_cur_str: String = row.get("currency")?;
        let currency: Currency = unit_cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(SaleLine {
            id: row.get("id")?,
            sale_id: row.get("sale_id")?,
            sku: row.get("sku")?,
            qty: row.get("qty")?,
            unit_price: Money {
                minor_units: row.get("unit_minor")?,
                currency,
            },
            line_total: Money {
                minor_units: row.get("line_minor")?,
                currency,
            },
            line_position: row.get("line_position")?,
            tax_amount: Money {
                minor_units: row.get("tax_minor")?,
                currency,
            },
            tax_rate_id: row.get("tax_rate_id")?,
            tax_breakdown_json: row.get("tax_breakdown_json")?,
            serial_number: row.get("serial_number")?,
            course: row.get("course")?,
            modifiers_json: row.get("modifiers_json")?,
        })
    }

    /// Persist a [`Sale`] (header + all line items) inside a single transaction.
    pub fn create_sale(&self, sale: &Sale) -> Result<(), CoreError> {
        // MONEY-07: this legacy global-db door deserializes a Sale straight from
        // import/CLI JSON (oz-cli) — CartLine::new's qty > 0 assert never runs.
        // Reject the same negative money/qty class MONEY-06 guards on the
        // complete_sale* entry points, or a hostile import writes negative
        // ledger rows. Zero-total (free) sales with empty lines stay legal.
        validate_sale_money(sale)?;

        let cur_str = std::str::from_utf8(&sale.currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;
        let status_str = sale.status.as_stored_str();

        let tx = self.conn.unchecked_transaction()?;

        insert_sale_with_lines(&tx, sale, cur_str, status_str)?;

        tx.commit()?;
        Ok(())
    }

    /// Tx-aware variant of [`Self::create_sale`] for callers already inside
    /// a transaction (CLI `.ozpkg` import — CLI-1 fix).
    ///
    /// The caller's transaction wraps the sale insert plus its line rows,
    /// so a multi-type import commits atomically and the pre-fix nested
    /// "cannot start a transaction within a transaction" failure is
    /// impossible.
    ///
    /// # Invariant
    ///
    /// `tx` must be an open transaction on the same connection this `Store`
    /// wraps. (`self` is not dereferenced — it exists so the method stays on
    /// the Store facade alongside `create_sale`.)
    pub fn create_sale_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sale: &Sale,
    ) -> Result<(), CoreError> {
        validate_sale_money(sale)?;

        let cur_str = std::str::from_utf8(&sale.currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;
        let status_str = sale.status.as_stored_str();

        insert_sale_with_lines(tx, sale, cur_str, status_str)
    }

    /// List all sales ordered by creation date (most recent first), without line items.
    pub fn list_sales(&self) -> Result<Vec<Sale>, CoreError> {
        self.list_sales_sql("FROM sales ORDER BY created_at DESC")
    }

    /// List sales, optionally restricted to the last `days` days (C1.2 Free-tier
    /// sales-history cap).
    ///
    /// Returns the sales plus whether the cap was applied (`days.is_some()`), so
    /// the caller can surface an upgrade teaser when history was truncated.
    /// `created_at` is stored as RFC-3339 text, so the lexicographic comparison
    /// `created_at >= date('now', '-N days')` keeps every sale on/after that
    /// day's midnight.
    pub fn list_sales_with_history_cap(
        &self,
        days: Option<i64>,
    ) -> Result<(Vec<Sale>, bool), CoreError> {
        let mut clause = String::from("FROM sales");
        if let Some(d) = days {
            clause.push_str(&format!(" WHERE created_at >= date('now', '-{d} days')"));
        }
        clause.push_str(" ORDER BY created_at DESC");
        Ok((self.list_sales_sql(&clause)?, days.is_some()))
    }

    /// Shared sale-list query: the given `FROM …` clause is appended to the
    /// standard sale column projection.
    fn list_sales_sql(&self, from_clause: &str) -> Result<Vec<Sale>, CoreError> {
        let sql = format!(
            "SELECT id, total_minor, currency, line_count, status,
                    payment_method, tendered_minor, discount_percent, discount_label,
                    user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             {from_clause}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let cur_str: String = row.get("currency")?;
            let status_str: String = row.get("status")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            let status = SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending);
            Ok(Sale {
                id: row.get("id")?,
                status,
                total: Money {
                    minor_units: row.get("total_minor")?,
                    currency,
                },
                line_count: row.get("line_count")?,
                currency,
                payment_method: row.get("payment_method")?,
                tendered_minor: row.get("tendered_minor")?,
                discount_percent: row
                    .get::<_, Option<i64>>("discount_percent")
                    .unwrap_or(Some(0))
                    .unwrap_or(0),
                discount_label: row.get("discount_label")?,
                user_id: row.get("user_id")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                lines: Vec::new(),
                subtotal: Money {
                    minor_units: row.get("subtotal_minor")?,
                    currency,
                },
                tax_total: Money {
                    minor_units: row.get("tax_total_minor")?,
                    currency,
                },
                customer_id: row.get("customer_id")?,
                base_currency: row.get("base_currency")?,
                base_total_minor: row.get("base_total_minor")?,
                tender_rate_millionths: row.get("tender_rate_millionths")?,
                tip_minor: row.get("tip_minor")?,
                service_charge_minor: row.get("service_charge_minor")?,
                version: row.get("version").unwrap_or(1),
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List sales visible to one store (soft-scoping layer, migration
    /// 069/117), most recent first, without line items.
    ///
    /// A store sees the shared global sales (`store_id IS NULL`) plus its
    /// own tagged rows — never another store's rows. In the per-store
    /// database model every row is NULL, so this degenerates to the global
    /// list; it is the enforcement surface for shared/cloud databases
    /// where `store_id` is the soft-scoping column.
    pub fn list_sales_for_store(&self, store_id: &str) -> Result<Vec<Sale>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, total_minor, currency, line_count, status,
                    payment_method, tendered_minor, discount_percent, discount_label,
                    user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales
             WHERE store_id IS NULL OR store_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![store_id], |row| {
            let cur_str: String = row.get("currency")?;
            let status_str: String = row.get("status")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            let status = SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending);
            Ok(Sale {
                id: row.get("id")?,
                status,
                total: Money {
                    minor_units: row.get("total_minor")?,
                    currency,
                },
                line_count: row.get("line_count")?,
                currency,
                payment_method: row.get("payment_method")?,
                tendered_minor: row.get("tendered_minor")?,
                discount_percent: row
                    .get::<_, Option<i64>>("discount_percent")
                    .unwrap_or(Some(0))
                    .unwrap_or(0),
                discount_label: row.get("discount_label")?,
                user_id: row.get("user_id")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                lines: Vec::new(),
                subtotal: Money {
                    minor_units: row.get("subtotal_minor")?,
                    currency,
                },
                tax_total: Money {
                    minor_units: row.get("tax_total_minor")?,
                    currency,
                },
                customer_id: row.get("customer_id")?,
                base_currency: row.get("base_currency")?,
                base_total_minor: row.get("base_total_minor")?,
                tender_rate_millionths: row.get("tender_rate_millionths")?,
                tip_minor: row.get("tip_minor")?,
                service_charge_minor: row.get("service_charge_minor")?,
                version: row.get("version").unwrap_or(1),
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List sales filtered by user_id (most recent first).
    ///
    /// Multi-terminal: when combined with the shifts table (which maps
    /// user_id + terminal_id), this enables terminal-grouped reporting.
    /// Example: SELECT terminal_id, SUM(total_minor) FROM sales JOIN shifts
    /// ON sales.user_id = shifts.user_id WHERE shifts.status = 'closed'
    /// GROUP BY terminal_id;
    pub fn list_sales_by_user(&self, user_id: &str) -> Result<Vec<Sale>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, total_minor, currency, line_count, status,
                    payment_method, tendered_minor, discount_percent, discount_label,
                    user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales
             WHERE user_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            let cur_str: String = row.get("currency")?;
            let status_str: String = row.get("status")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            let status = SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending);
            Ok(Sale {
                id: row.get("id")?,
                status,
                total: Money {
                    minor_units: row.get("total_minor")?,
                    currency,
                },
                line_count: row.get("line_count")?,
                currency,
                payment_method: row.get("payment_method")?,
                tendered_minor: row.get("tendered_minor")?,
                discount_percent: row.get("discount_percent")?,
                discount_label: row.get("discount_label")?,
                user_id: row.get("user_id")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                subtotal: Money {
                    minor_units: row.get("subtotal_minor")?,
                    currency,
                },
                tax_total: Money {
                    minor_units: row.get("tax_total_minor")?,
                    currency,
                },
                customer_id: row.get("customer_id")?,
                base_currency: row.get("base_currency")?,
                base_total_minor: row.get("base_total_minor")?,
                tender_rate_millionths: row.get("tender_rate_millionths")?,
                tip_minor: row.get("tip_minor")?,
                service_charge_minor: row.get("service_charge_minor")?,
                version: row.get("version")?,
                lines: vec![],
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List sales for one customer (most recent first), without line items.
    ///
    /// CUST-05: powers the customer history view. The result is bounded and
    /// sorted explicitly; the total count lets the caller paginate. Returns
    /// an empty vector (and total 0) when the customer has no sales yet.
    pub fn list_sales_for_customer(
        &self,
        customer_id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(Vec<Sale>, u64), CoreError> {
        let bounded = limit.clamp(1, 100);
        let total: u64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE customer_id = ?1",
            params![customer_id],
            |row| row.get(0),
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, total_minor, currency, line_count, status,
                    payment_method, tendered_minor, discount_percent, discount_label,
                    user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales WHERE customer_id = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![customer_id, bounded, offset], |row| {
            let cur_str: String = row.get("currency")?;
            let status_str: String = row.get("status")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            let status = SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending);
            Ok(Sale {
                id: row.get("id")?,
                status,
                total: Money {
                    minor_units: row.get("total_minor")?,
                    currency,
                },
                line_count: row.get("line_count")?,
                currency,
                payment_method: row.get("payment_method")?,
                tendered_minor: row.get("tendered_minor")?,
                discount_percent: row
                    .get::<_, Option<i64>>("discount_percent")
                    .unwrap_or(Some(0))
                    .unwrap_or(0),
                discount_label: row.get("discount_label")?,
                user_id: row.get("user_id")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                lines: Vec::new(),
                subtotal: Money {
                    minor_units: row.get("subtotal_minor")?,
                    currency,
                },
                tax_total: Money {
                    minor_units: row.get("tax_total_minor")?,
                    currency,
                },
                customer_id: row.get("customer_id")?,
                base_currency: row.get("base_currency")?,
                base_total_minor: row.get("base_total_minor")?,
                tender_rate_millionths: row.get("tender_rate_millionths")?,
                tip_minor: row.get("tip_minor")?,
                service_charge_minor: row.get("service_charge_minor")?,
                version: row.get("version").unwrap_or(1),
            })
        })?;
        let items = rows
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;
        Ok((items, total))
    }

    /// Look up a single sale by id, including all line items.
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, CoreError> {
        let mut sale_stmt = self.conn.prepare(
            "SELECT id, total_minor, currency, line_count, status,
                    payment_method, tendered_minor, discount_percent, discount_label,
                    user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales WHERE id = ?1",
        )?;

        let sale_result = sale_stmt.query_row(params![id], |row| {
            let cur_str: String = row.get("currency")?;
            let status_str: String = row.get("status")?;
            let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?;
            let status = SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending);
            Ok(Sale {
                id: row.get("id")?,
                status,
                total: Money {
                    minor_units: row.get("total_minor")?,
                    currency,
                },
                line_count: row.get("line_count")?,
                currency,
                payment_method: row.get("payment_method")?,
                tendered_minor: row.get("tendered_minor")?,
                discount_percent: row
                    .get::<_, Option<i64>>("discount_percent")
                    .unwrap_or(Some(0))
                    .unwrap_or(0),
                discount_label: row.get("discount_label")?,
                user_id: row.get("user_id")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                lines: Vec::new(),
                subtotal: Money {
                    minor_units: row.get("subtotal_minor")?,
                    currency,
                },
                tax_total: Money {
                    minor_units: row.get("tax_total_minor")?,
                    currency,
                },
                customer_id: row.get("customer_id")?,
                base_currency: row.get("base_currency")?,
                base_total_minor: row.get("base_total_minor")?,
                tender_rate_millionths: row.get("tender_rate_millionths")?,
                tip_minor: row.get("tip_minor")?,
                service_charge_minor: row.get("service_charge_minor")?,
                version: row.get("version").unwrap_or(1),
            })
        });

        let mut sale = match sale_result {
            Ok(s) => s,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let mut line_stmt = self.conn.prepare(
            "SELECT id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position,
                    tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course,
                    modifiers_json
             FROM sale_lines WHERE sale_id = ?1 ORDER BY line_position",
        )?;
        let line_rows = line_stmt.query_map(params![id], Self::row_to_sale_line)?;
        for line in line_rows {
            sale.lines.push(line?);
        }

        Ok(Some(sale))
    }

    /// The F2 audit stamp for one sale: the `tax_estimate_note` column core
    /// writes when the cart's tax was computed against a non-fresh estimate
    /// (client claim + core-verified delta, F2-5's JSON shape).
    ///
    /// A dedicated read accessor rather than a field on [`Sale`]: widening the
    /// domain struct would force `tax_estimate_note: None,` into every `Sale`
    /// literal across the kds/reports/tables/multi-terminal/promotions test
    /// corpora and the modules-sales mirror (~45 sites, 9 files) for a value
    /// only the history surface consumes — the same trade C2 made for
    /// `legal_entity_id` vs the location-profile struct. `None` = unstamped
    /// (legacy row, or the tax was computed live): absence is the honest
    /// answer and must never read as a claim.
    pub fn sale_tax_estimate_note(&self, sale_id: &str) -> Result<Option<String>, CoreError> {
        // Two independent absences to flatten: the OUTER Option is row
        // existence (no sale with that id — .optional()), the INNER is the
        // NULL column (an unstamped sale — rusqlite's Option<String> get).
        let note: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT tax_estimate_note FROM sales WHERE id = ?1",
                params![sale_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(note.flatten())
    }

    /// Update the status of a sale, validating the state machine transition.
    pub fn update_sale_status(&self, id: &str, to: SaleStatus) -> Result<Sale, CoreError> {
        let result = self.conn.query_row(
            "SELECT status FROM sales WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        );

        let current_str = match result {
            Ok(s) => s,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(CoreError::NotFound {
                    entity: "sale",
                    id: id.to_owned(),
                });
            }
            Err(e) => return Err(e.into()),
        };

        let current =
            SaleStatus::from_stored_str(&current_str).ok_or_else(|| CoreError::Validation {
                field: "status",
                message: format!("invalid stored status: {current_str}"),
            })?;

        if !SaleStatus::can_transition_to(current, to) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot transition from {:?} to {:?}", current, to),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let status_str = to.as_stored_str();
        let rows = self.conn.execute(
            "UPDATE sales SET status = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
            params![status_str, now, id],
        )?;
        if rows == 0 {
            return Err(CoreError::Conflict {
                entity: "sale",
                field: "version",
            });
        }

        self.get_sale(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "sale",
            id: id.to_owned(),
        })
    }
}
