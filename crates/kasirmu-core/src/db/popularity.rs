//! Popularity recompute methods (ADR #37 D3).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 closeout)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean — format!-SQL interpolates only the whitelisted period-expression trio (verified injection-safe, closes the B5-part-6 flag); full pass is 4 grouped queries (no N+1) with atomic score writes in one tx; category-smoothed means per ADR #37 D6 documented; day buckets UTC (COR-21 family); record_product_search is fire-and-forget by documented contract
next: none | perf: grouped single-pass recompute
*/
//!
//! The sales signal is read straight from `sale_lines` (already the durable
//! ledger); search and edit signals come from the `product_activity` ledger
//! (migration 133). Each contributing event triggers a single-SKU recompute;
//! a full-catalog pass recomputes every score and refreshes the catalog means
//! cached in `settings`. Scores and the ledger are local-only (ADR #37 D4).

use std::collections::HashMap;

use rusqlite::params;

use crate::error::CoreError;
use crate::popularity::{DayCount, compute_score, decayed_sum, total_events};

use super::Store;
use super::reports::{check_date_bound, parse_utc_offset};

/// Settings keys caching the catalog means computed by the last full pass.
const MEAN_SALES: &str = "popularity.mean.sales";
const MEAN_SEARCH: &str = "popularity.mean.search";
const MEAN_EDITS: &str = "popularity.mean.edits";
/// Settings key caching per-category means as JSON
/// (`{"<category_id>": {"sales": s, "search": q, "edits": e}, "": {…}}`,
/// where the `""` entry is the global fallback for uncategorized products).
/// Per-category popularity (ADR #37 D6): each product is smoothed toward its
/// own category's mean so a quiet category's products are not drowned by a
/// hot one — the retail grid's popularity sort becomes fair within a
/// selected category.
const CATEGORY_MEANS: &str = "popularity.category_means";

/// One product's full-pass raw signals: `(sku, category_id, sales_raw,
/// sales_votes, search_raw, search_votes, edits_raw, edits_votes)`.
type ProductSignals = (String, Option<String>, f64, f64, f64, f64, f64, f64);

/// A category's forecast input: name + chronological (period date, units).
type ForecastSeries = (Option<String>, Vec<(chrono::NaiveDate, f64)>);

/// One product inside a category's popularity leaderboard.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryTopProduct {
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Materialized popularity score (category-smoothed, ADR #37 D6).
    pub popularity_score: f64,
    /// 1-based rank within the category by score (descending, SKU tiebreak).
    pub rank: i64,
    /// Category-relative standing: 1.0 = most popular in the category,
    /// 0.0 = least, evenly spaced; 1.0 for single-product categories.
    pub percentile: f64,
}

/// A per-category next-period demand forecast derived from the trend series.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryForecastRow {
    /// Category id; empty string for uncategorized products.
    pub category_id: String,
    /// Category name; `None` for uncategorized (the UI localizes the label).
    pub category_name: Option<String>,
    /// Predicted units sold in the next period (never negative).
    pub forecast_units: i64,
    /// Fitted trend — units per period; 0 when fewer than 2 points.
    pub trend_per_period: f64,
    /// Baseline — mean units per period over the recent series.
    pub recent_avg_units: f64,
}

/// One (period, category) point of the popularity trend series.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryTrendPoint {
    /// Period bucket start: `YYYY-MM-DD` (daily/weekly) or `YYYY-MM` (monthly).
    pub period_start: String,
    /// Category id; empty string for uncategorized products.
    pub category_id: String,
    /// Category name; `None` for uncategorized (the UI localizes the label).
    pub category_name: Option<String>,
    /// Period popularity score — the ADR #37 blend evaluated over the
    /// period's raw signals, smoothed toward the cached category means, so
    /// the series is on the same scale as the current `popularity_score`.
    pub score: f64,
    /// Units sold in the period (completed sales).
    pub units_sold: i64,
    /// Distinct transactions in the period (breadth input).
    pub distinct_transactions: i64,
    /// Acted-upon searches in the period.
    pub searches: i64,
    /// Edit events in the period.
    pub edits: i64,
}

/// Per-category popularity summary (ADR #37 — the per-category evolution:
/// the smoothing means are used for scoring, and this query surfaces the
/// resulting category standings for the reporting layer).
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryPopularityRow {
    /// Category id; empty string for uncategorized products.
    pub category_id: String,
    /// Category name; `None` for uncategorized (the UI localizes the label).
    pub category_name: Option<String>,
    /// Number of products in the category.
    pub product_count: i64,
    /// Mean popularity score across the category's products.
    pub mean_score: f64,
    /// `mean_score` relative to the catalog-wide mean (1.0 = average,
    /// 2.0 = twice as popular as the catalog average; 0.0 when no scores).
    pub catalog_ratio: f64,
    /// The category's most popular products, ranked by score.
    pub top_products: Vec<CategoryTopProduct>,
}

/// Days between an ISO date and today; out-of-range becomes `i64::MAX` so the
/// formula window filters it out.
fn days_ago(day: &str) -> i64 {
    match chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d") {
        Ok(d) => {
            let today = chrono::Utc::now().date_naive();
            (today - d).num_days()
        }
        Err(_) => i64::MAX,
    }
}

fn window_modifier() -> String {
    format!("-{} days", crate::popularity::WINDOW_DAYS)
}

/// Accepted granularities for [`Store::category_popularity_trend`].
pub const TREND_GRANULARITIES: [&str; 3] = ["daily", "weekly", "monthly"];

impl Store<'_> {
    /// Next-period demand forecast per top category (simple linear fit).
    ///
    /// Reuses [`Store::category_popularity_trend`] for the period series,
    /// then fits over each category's recent per-period units (last up-to-14
    /// points) to project the next period: day-of-week seasonality (via
    /// [`crate::popularity::seasonal_daily_forecast`]) for daily series of a
    /// full week or more, otherwise a plain linear fit
    /// ([`crate::popularity::linear_forecast`]). Categories with a single
    /// point fall back to their recent average; results sort by forecast
    /// descending. Prototype-level forecast — the demand-forecasting
    /// research (2026-07-20) may replace the fit with a learned model later.
    pub fn category_forecast(
        &self,
        start_date: &str,
        end_date: &str,
        granularity: &str,
        top_categories: i64,
    ) -> Result<Vec<CategoryForecastRow>, CoreError> {
        // Up to two weeks of history: enough for the daily seasonality fit
        // (which needs a full week minimum) while keeping the series recent.
        const MAX_SERIES_POINTS: usize = 14;

        let points =
            self.category_popularity_trend(start_date, end_date, granularity, top_categories)?;
        // (category_id) → (name, chronological (period date, units) series).
        let mut groups: HashMap<String, ForecastSeries> = HashMap::new();
        for p in points {
            let date = chrono::NaiveDate::parse_from_str(&p.period_start, "%Y-%m-%d").ok();
            let entry = groups
                .entry(p.category_id.clone())
                .or_insert((p.category_name, Vec::new()));
            if let Some(d) = date {
                entry.1.push((d, p.units_sold as f64));
            }
        }

        let mut out: Vec<CategoryForecastRow> = Vec::new();
        for (category_id, (name, series)) in groups {
            let tail = series
                .iter()
                .rev()
                .take(MAX_SERIES_POINTS)
                .copied()
                .collect::<Vec<(chrono::NaiveDate, f64)>>();
            let tail = tail
                .into_iter()
                .rev()
                .collect::<Vec<(chrono::NaiveDate, f64)>>();
            // Daily series of at least a full week get day-of-week
            // seasonality (weak Mondays, strong weekends); shorter or
            // weekly/monthly series use the plain linear fit.
            let f = if granularity == "daily" && tail.len() >= 7 {
                let next = tail
                    .last()
                    .map(|(d, _)| *d + chrono::Duration::days(1))
                    .unwrap_or_else(|| chrono::Utc::now().date_naive());
                crate::popularity::seasonal_daily_forecast(&tail, next)
            } else {
                let units: Vec<f64> = tail.iter().map(|(_, u)| *u).collect();
                crate::popularity::linear_forecast(&units)
            };
            out.push(CategoryForecastRow {
                category_id,
                category_name: name,
                forecast_units: f.forecast_units,
                trend_per_period: f.trend_per_period,
                recent_avg_units: f.recent_avg_units,
            });
        }
        out.sort_by(|a, b| {
            b.forecast_units
                .cmp(&a.forecast_units)
                .then_with(|| a.category_id.cmp(&b.category_id))
        });
        Ok(out)
    }

    /// Per-period popularity trend for the top `top_categories` categories.
    ///
    /// Buckets the sale/search/edit ledgers by `granularity` (`daily`,
    /// `weekly`, `monthly`; the weekly bucket mirrors `weekly_revenue`'s
    /// `DATE(created_at, 'weekday 0', '-7 days')`) over `[start_date,
    /// end_date]` and evaluates the ADR #37 blend per (period, category)
    /// with the raw period counts smoothed toward the cached category
    /// means — the same scale as the materialized `popularity_score`, so a
    /// category's trend line reads directly against its current standing.
    pub fn category_popularity_trend(
        &self,
        start_date: &str,
        end_date: &str,
        granularity: &str,
        top_categories: i64,
    ) -> Result<Vec<CategoryTrendPoint>, CoreError> {
        // REP-03: period buckets are store-local. The tz string is validated
        // by parse_utc_offset (contract in db::reports), so embedding it in
        // the period expressions cannot inject SQL. Popularity SCORING
        // windows below stay UTC — they are rolling decay windows, not
        // calendar buckets.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        debug_assert!(parse_utc_offset(&tz).is_some());
        // Qualified period expressions: the sales query joins `sales s` and
        // the activity query joins `products p` (which also has a
        // `created_at`), so the column must be explicit per query.
        let (s_period, a_period) = match granularity {
            "weekly" => (
                format!("DATE(s.created_at, '{tz}', 'weekday 0', '-7 days')"),
                format!("DATE(a.created_at, '{tz}', 'weekday 0', '-7 days')"),
            ),
            "monthly" => (
                format!("strftime('%Y-%m', s.created_at, '{tz}')"),
                format!("strftime('%Y-%m', a.created_at, '{tz}')"),
            ),
            _ => (
                format!("DATE(s.created_at, '{tz}')"),
                format!("DATE(a.created_at, '{tz}')"),
            ),
        };

        // The most popular categories by current mean score — the chart's
        // series (kept small so a line chart stays readable).
        let top: Vec<(String, Option<String>)> = {
            let mut stmt = self.conn.prepare(
                "SELECT p.category_id, c.name
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 GROUP BY p.category_id
                 ORDER BY AVG(p.popularity_score) DESC, p.category_id ASC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![top_categories.max(1)], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        };
        if top.is_empty() {
            return Ok(Vec::new());
        }
        // Order categories by their ranking index so points sort sensibly.
        let rank: HashMap<String, usize> = top
            .iter()
            .enumerate()
            .map(|(i, (id, _))| (id.clone(), i))
            .collect();

        // (period, category) → raw signals.
        let mut agg: HashMap<(String, String), (i64, i64, i64, i64)> = HashMap::new();
        {
            // Sales: units + distinct transactions per (period, category).
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {s_period} AS period_start, p.category_id,
                        SUM(sl.qty) AS units, COUNT(DISTINCT sl.sale_id) AS txns
                 FROM sale_lines sl
                 JOIN sales s ON sl.sale_id = s.id
                 JOIN products p ON sl.sku = p.sku
                 WHERE s.status = 'completed' AND DATE(s.created_at, '{tz}') BETWEEN ?1 AND ?2
                 GROUP BY period_start, p.category_id"
            ))?;
            let rows = stmt.query_map(params![start_date, end_date], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (period_start, cat, units, txns) = row?;
                let e = agg.entry((period_start, cat)).or_insert((0, 0, 0, 0));
                e.0 += units;
                e.1 += txns;
            }
        }
        {
            // Search + edit events per (period, category).
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {a_period} AS period_start, p.category_id, a.event_type, COUNT(*) AS cnt
                 FROM product_activity a
                 JOIN products p ON a.sku = p.sku
                 WHERE DATE(a.created_at, '{tz}') BETWEEN ?1 AND ?2
                 GROUP BY period_start, p.category_id, a.event_type"
            ))?;
            let rows = stmt.query_map(params![start_date, end_date], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (period_start, cat, etype, cnt) = row?;
                let e = agg.entry((period_start, cat)).or_insert((0, 0, 0, 0));
                if etype == "search" {
                    e.2 += cnt;
                } else {
                    e.3 += cnt;
                }
            }
        }

        // Only the top categories' points survive (the charts stay small).
        let mut points: Vec<CategoryTrendPoint> = Vec::new();
        for ((period_start, cat), (units, txns, searches, edits)) in agg {
            if !rank.contains_key(&cat) {
                continue;
            }
            let (ms, mq, me) = self.category_means(&cat).unwrap_or((0.0, 0.0, 0.0));
            let score = crate::popularity::score_from_raw(
                units as f64,
                units as f64,
                txns as f64,
                searches as f64,
                searches as f64,
                edits as f64,
                edits as f64,
                ms,
                mq,
                me,
            );
            let name = top
                .iter()
                .find(|(id, _)| *id == cat)
                .and_then(|(_, n)| n.clone());
            points.push(CategoryTrendPoint {
                period_start,
                category_id: cat,
                category_name: name,
                score,
                units_sold: units,
                distinct_transactions: txns,
                searches,
                edits,
            });
        }
        points.sort_by(|a, b| {
            a.period_start
                .cmp(&b.period_start)
                .then_with(|| rank[&a.category_id].cmp(&rank[&b.category_id]))
        });
        Ok(points)
    }

    /// Per-category popularity standings over the whole catalog.
    ///
    /// Returns every category (including the `""` bucket for uncategorized
    /// products) with its product count, mean materialized score, the mean
    /// relative to the catalog average, and the top `top_per_category`
    /// products ranked by score with their category-relative rank and
    /// percentile. Reads are O(catalog) against the materialized column, so
    /// it is cheap and never touches the ledgers.
    pub fn category_popularity(
        &self,
        top_per_category: i64,
    ) -> Result<Vec<CategoryPopularityRow>, CoreError> {
        let catalog_mean: f64 = self
            .conn
            .query_row("SELECT AVG(popularity_score) FROM products", [], |r| {
                r.get(0)
            })
            .unwrap_or(0.0);

        // Per-category aggregates: count + mean score.
        let mut cats: HashMap<String, CategoryPopularityRow> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT p.category_id, c.name, COUNT(*) AS cnt, AVG(p.popularity_score) AS mean
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 GROUP BY p.category_id",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })?;
            for row in rows {
                let (category, name, cnt, mean) = row?;
                let key = category.unwrap_or_default();
                cats.insert(
                    key.clone(),
                    CategoryPopularityRow {
                        category_id: key,
                        category_name: name,
                        product_count: cnt,
                        mean_score: mean,
                        catalog_ratio: if catalog_mean > 0.0 {
                            mean / catalog_mean
                        } else {
                            0.0
                        },
                        top_products: Vec::new(),
                    },
                );
            }
        }

        // Ranked products per category (score desc, SKU tiebreak).
        let mut per_cat: HashMap<String, Vec<(String, String, f64)>> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT p.category_id, p.sku, p.name, p.popularity_score
                 FROM products p
                 ORDER BY p.category_id, p.popularity_score DESC, p.sku ASC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })?;
            for row in rows {
                let (category, sku, name, score) = row?;
                per_cat
                    .entry(category.unwrap_or_default())
                    .or_default()
                    .push((sku, name, score));
            }
        }

        for (key, rows) in per_cat {
            let count = rows.len() as f64;
            let top: Vec<CategoryTopProduct> = rows
                .into_iter()
                .take(top_per_category.max(0) as usize)
                .enumerate()
                .map(|(i, (sku, name, score))| CategoryTopProduct {
                    sku,
                    name,
                    popularity_score: score,
                    rank: i as i64 + 1,
                    // Linear spread: best = 1.0, worst = 0.0 (1.0 when the
                    // category holds a single product).
                    percentile: if count > 1.0 {
                        (count - 1.0 - i as f64) / (count - 1.0)
                    } else {
                        1.0
                    },
                })
                .collect();
            if let Some(cat) = cats.get_mut(&key) {
                cat.top_products = top;
            }
        }

        let mut out: Vec<CategoryPopularityRow> = cats.into_values().collect();
        out.sort_by(|a, b| {
            b.mean_score
                .partial_cmp(&a.mean_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.category_id.cmp(&b.category_id))
        });
        Ok(out)
    }

    /// Daily completed-sale unit counts for one SKU over the window.
    fn sale_day_counts(&self, sku: &str) -> Result<Vec<DayCount>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT strftime('%Y-%m-%d', s.created_at) AS day, SUM(sl.qty) AS qty
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             WHERE sl.sku = ?1 AND s.status = 'completed'
               AND s.created_at >= datetime('now', ?2)
             GROUP BY day",
        )?;
        let rows = stmt.query_map(params![sku, window_modifier()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (day, qty) = row?;
            out.push(DayCount {
                days_ago: days_ago(&day),
                count: qty,
            });
        }
        Ok(out)
    }

    /// Distinct completed transactions containing a SKU inside the window —
    /// the breadth input to the sales signal (ADR #37 D6: reach over
    /// one-customer bulk).
    fn sale_distinct_transactions(&self, sku: &str) -> Result<i64, CoreError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT sl.sale_id)
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             WHERE sl.sku = ?1 AND s.status = 'completed'
               AND s.created_at >= datetime('now', ?2)",
            params![sku, window_modifier()],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Daily counts of one activity type for a SKU over the window.
    fn activity_day_counts(&self, sku: &str, event_type: &str) -> Result<Vec<DayCount>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT strftime('%Y-%m-%d', created_at) AS day, COUNT(*) AS cnt
             FROM product_activity
             WHERE sku = ?1 AND event_type = ?2
               AND created_at >= datetime('now', ?3)
             GROUP BY day",
        )?;
        let rows = stmt.query_map(params![sku, event_type, window_modifier()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (day, cnt) = row?;
            out.push(DayCount {
                days_ago: days_ago(&day),
                count: cnt,
            });
        }
        Ok(out)
    }

    /// Read a raw `settings` value (None when absent).
    fn read_setting(&self, key: &str) -> Option<String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get::<_, String>(0),
            )
            .ok()
    }

    /// Read a cached catalog mean from `settings` (0.0 when absent).
    fn read_mean(&self, key: &str) -> f64 {
        self.read_setting(key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0)
    }

    /// Look up the cached smoothing means for a product's category.
    ///
    /// Returns the category's means when the per-category map (written by
    /// the last full pass) has an entry for it; falls back to the `""`
    /// global entry, then to the legacy `MEAN_*` keys (fresh DB).
    fn category_means(&self, category: &str) -> Option<(f64, f64, f64)> {
        let raw = self.read_setting(CATEGORY_MEANS)?;
        let map: serde_json::Value = serde_json::from_str(&raw).ok()?;
        let entry = map.get(category).or_else(|| map.get(""))?;
        Some((
            entry.get("sales").and_then(|v| v.as_f64()).unwrap_or(0.0),
            entry.get("search").and_then(|v| v.as_f64()).unwrap_or(0.0),
            entry.get("edits").and_then(|v| v.as_f64()).unwrap_or(0.0),
        ))
    }

    /// Smoothing means for a single SKU: its category's cached means, else
    /// the global fallback.
    fn sku_means(&self, sku: &str) -> (f64, f64, f64) {
        let category: Option<String> = self
            .conn
            .query_row(
                "SELECT category_id FROM products WHERE sku = ?1",
                params![sku],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        if let Some(means) = category.as_deref().and_then(|cat| self.category_means(cat)) {
            return means;
        }
        (
            self.read_mean(MEAN_SALES),
            self.read_mean(MEAN_SEARCH),
            self.read_mean(MEAN_EDITS),
        )
    }

    /// Cache a raw `settings` value (JSON or number string).
    fn write_setting(&self, key: &str, value: &str) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    /// Cache a catalog mean in `settings`.
    fn write_mean(&self, key: &str, value: f64) -> Result<(), CoreError> {
        self.write_setting(key, &value.to_string())
    }

    /// Record an acted-upon search (ADR #37 D2) and refresh the SKU's score.
    ///
    /// Fire-and-forget by callers: a dropped event costs one popularity tick.
    pub fn record_product_search(&self, sku: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT INTO product_activity (id, sku, event_type) VALUES (?1, ?2, 'search')",
            params![crate::new_id(), sku],
        )?;
        self.recompute_popularity(sku)
    }

    /// Recompute the materialized `popularity_score` for a single SKU.
    ///
    /// Uses the catalog means cached by the last full pass; absent means
    /// (fresh DB) are 0.0, which shrinks low-evidence scores toward zero until
    /// [`Store::recompute_all_popularity`] runs.
    pub fn recompute_popularity(&self, sku: &str) -> Result<(), CoreError> {
        let sales = self.sale_day_counts(sku)?;
        let distinct = self.sale_distinct_transactions(sku)?;
        let searches = self.activity_day_counts(sku, "search")?;
        let edits = self.activity_day_counts(sku, "edit")?;
        let (mean_sales, mean_search, mean_edits) = self.sku_means(sku);
        let score = compute_score(
            &sales,
            distinct,
            &searches,
            &edits,
            mean_sales,
            mean_search,
            mean_edits,
        );
        self.conn.execute(
            "UPDATE products SET popularity_score = ?1 WHERE sku = ?2",
            params![score, sku],
        )?;
        Ok(())
    }

    /// Full-catalog popularity pass: recompute every product's score and
    /// refresh the cached catalog means.
    ///
    /// Called at store open so the retail grid's default popularity sort is
    /// meaningful from day one (sales history backfills immediately; search
    /// and edit signals accumulate from zero).
    pub fn recompute_all_popularity(&self) -> Result<(), CoreError> {
        // ── Per-SKU signals in one pass each ──────────────────────────
        let mut sales: HashMap<String, Vec<DayCount>> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT sl.sku, strftime('%Y-%m-%d', s.created_at) AS day, SUM(sl.qty) AS qty
                 FROM sale_lines sl JOIN sales s ON sl.sale_id = s.id
                 WHERE s.status = 'completed' AND s.created_at >= datetime('now', ?1)
                 GROUP BY sl.sku, day",
            )?;
            let rows = stmt.query_map(params![window_modifier()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (sku, day, qty) = row?;
                sales.entry(sku).or_default().push(DayCount {
                    days_ago: days_ago(&day),
                    count: qty,
                });
            }
        } // Distinct transactions per SKU inside the window (breadth input).
        let mut distinct: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT sl.sku, COUNT(DISTINCT sl.sale_id)
                 FROM sale_lines sl
                 JOIN sales s ON sl.sale_id = s.id
                 WHERE s.status = 'completed' AND s.created_at >= datetime('now', ?1)
                 GROUP BY sl.sku",
            )?;
            let rows = stmt.query_map(params![window_modifier()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?;
            for row in rows {
                let (sku, cnt) = row?;
                distinct.insert(sku, cnt);
            }
        }

        let mut searches: HashMap<String, Vec<DayCount>> = HashMap::new();
        let mut edits: HashMap<String, Vec<DayCount>> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT sku, event_type, strftime('%Y-%m-%d', created_at) AS day, COUNT(*) AS cnt
                 FROM product_activity
                 WHERE created_at >= datetime('now', ?1)
                 GROUP BY sku, event_type, day",
            )?;
            let rows = stmt.query_map(params![window_modifier()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (sku, etype, day, cnt) = row?;
                let dc = DayCount {
                    days_ago: days_ago(&day),
                    count: cnt,
                };
                if etype == "search" {
                    searches.entry(sku).or_default().push(dc);
                } else if etype == "edit" {
                    edits.entry(sku).or_default().push(dc);
                }
            }
        }

        // ── Per-product raw + votes, grouped by category ───────────────
        let mut products: Vec<ProductSignals> = Vec::new();
        {
            let mut stmt = self.conn.prepare("SELECT sku, category_id FROM products")?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })?;
            for row in rows {
                let (sku, category) = row?;
                let s_events = sales.get(&sku).map(Vec::as_slice).unwrap_or(&[]);
                let q_events = searches.get(&sku).map(Vec::as_slice).unwrap_or(&[]);
                let e_events = edits.get(&sku).map(Vec::as_slice).unwrap_or(&[]);
                products.push((
                    sku,
                    category,
                    decayed_sum(s_events),
                    total_events(s_events),
                    decayed_sum(q_events),
                    total_events(q_events),
                    decayed_sum(e_events),
                    total_events(e_events),
                ));
            }
        }

        // Global means — the fallback for uncategorized products and the
        // `""` entry of the per-category cache. The sales mean is computed
        // over breadth-scaled raws so the smoothing scale always matches the
        // scaled raw inside `score_from_raw`.
        let n = products.len() as f64;
        let mean_sales = if n > 0.0 {
            products
                .iter()
                .map(|p| {
                    p.2 * crate::popularity::breadth_factor(
                        distinct.get(&p.0).copied().unwrap_or(0),
                    )
                })
                .sum::<f64>()
                / n
        } else {
            0.0
        };
        let mean_search = if n > 0.0 {
            products.iter().map(|p| p.4).sum::<f64>() / n
        } else {
            0.0
        };
        let mean_edits = if n > 0.0 {
            products.iter().map(|p| p.6).sum::<f64>() / n
        } else {
            0.0
        };

        // Per-category means (ADR #37 D6): each product is smoothed toward
        // its own category's mean, so a quiet category is not drowned by a
        // hot one. `""` = uncategorized bucket, kept in the map as the
        // explicit global entry.
        let mut cat_sums: HashMap<String, (f64, f64, f64, f64)> = HashMap::new();
        for p in &products {
            let key = p.1.clone().unwrap_or_default();
            let entry = cat_sums.entry(key).or_insert((0.0, 0.0, 0.0, 0.0));
            entry.0 +=
                p.2 * crate::popularity::breadth_factor(distinct.get(&p.0).copied().unwrap_or(0));
            entry.1 += p.4;
            entry.2 += p.6;
            entry.3 += 1.0;
        }
        let mut cat_means: HashMap<String, (f64, f64, f64)> = HashMap::new();
        for (cat, (sr, qr, er, count)) in cat_sums {
            if count > 0.0 {
                cat_means.insert(cat, (sr / count, qr / count, er / count));
            }
        }
        cat_means.insert(String::new(), (mean_sales, mean_search, mean_edits));

        // Persist the per-category cache as JSON, and keep the global
        // MEAN_* keys (single-SKU fallback before the first full pass).
        let mut cat_json = serde_json::Map::new();
        for (cat, (ms, mq, me)) in &cat_means {
            cat_json.insert(
                cat.clone(),
                serde_json::json!({ "sales": ms, "search": mq, "edits": me }),
            );
        }
        self.write_setting(
            CATEGORY_MEANS,
            &serde_json::Value::Object(cat_json).to_string(),
        )?;
        self.write_mean(MEAN_SALES, mean_sales)?;
        self.write_mean(MEAN_SEARCH, mean_search)?;
        self.write_mean(MEAN_EDITS, mean_edits)?;

        // ── Write scores (one transaction: the per-SKU updates are atomic) ─
        let tx = self.conn.unchecked_transaction()?;
        for (sku, category, sr, sv, qr, qv, er, ev) in products {
            let key = category.unwrap_or_default();
            let (ms, mq, me) =
                cat_means
                    .get(&key)
                    .copied()
                    .unwrap_or((mean_sales, mean_search, mean_edits));
            let distinct = distinct.get(&sku).copied().unwrap_or(0) as f64;
            let score =
                crate::popularity::score_from_raw(sr, sv, distinct, qr, qv, er, ev, ms, mq, me);
            tx.execute(
                "UPDATE products SET popularity_score = ?1 WHERE sku = ?2",
                params![score, sku],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "popularity_tests.rs"]
mod tests;
