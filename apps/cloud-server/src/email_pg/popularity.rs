//! Popularity and forecast queries for the Postgres analytics bundle.
//!
//! The Postgres mirror of `oz_core::db::popularity`: per-category
//! standings, the trend query with the ADR #37 blend evaluated by the
//! shared `score_from_raw`, cached smoothing means read through the scoped
//! settings store, and the next-period forecast. Split from `email_pg.rs`
//! on 13-09-26; behaviour unchanged.

use deadpool_postgres::Pool;

use oz_core::db::popularity::{
    CategoryForecastRow, CategoryPopularityRow, CategoryTopProduct, CategoryTrendPoint,
};
use oz_core::popularity::{linear_forecast, score_from_raw, seasonal_daily_forecast};

use super::analytics::parse_date;
use super::settings_store::get_setting_scoped_pg;
/// Per-category popularity standings (Postgres mirror of
/// `oz_core::db::popularity::Store::category_popularity`).
pub async fn category_popularity_pg(
    pool: &Pool,
    top_per_category: i64,
    tenant: &str,
) -> Result<Vec<CategoryPopularityRow>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let catalog_mean: f64 = client
        .query_one(
            "SELECT AVG(popularity_score)::float8 FROM products WHERE tenant_id = $1",
            &[&tenant],
        )
        .await
        .map(|r| r.get::<_, Option<f64>>(0).unwrap_or(0.0))
        .unwrap_or(0.0);

    // Per-category aggregates: count + mean score.
    let mut cats: std::collections::HashMap<String, CategoryPopularityRow> =
        std::collections::HashMap::new();
    {
        let rows = client
            .query(
                "SELECT p.category_id, c.name, COUNT(*) AS cnt, AVG(p.popularity_score)::float8 AS mean
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE p.tenant_id = $1
                 GROUP BY p.category_id, c.name",
                &[&tenant],
            )
            .await
            .map_err(|e| format!("DB error: {e}"))?;
        for row in rows {
            let category: Option<String> = row.get(0);
            let name: Option<String> = row.get(1);
            let cnt: i64 = row.get(2);
            let mean: f64 = row.get(3);
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
    let mut per_cat: std::collections::HashMap<String, Vec<(String, String, f64)>> =
        std::collections::HashMap::new();
    {
        let rows = client
            .query(
                "SELECT p.category_id, p.sku, p.name, p.popularity_score
                 FROM products p
                 WHERE p.tenant_id = $1
                 ORDER BY p.category_id, p.popularity_score DESC, p.sku ASC",
                &[&tenant],
            )
            .await
            .map_err(|e| format!("DB error: {e}"))?;
        for row in rows {
            let category: Option<String> = row.get(0);
            let sku: String = row.get(1);
            let name: String = row.get(2);
            let score: f64 = row.get(3);
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

/// Per-period popularity trend for the top categories — the raw-signal
/// queries of `oz_core::db::popularity::Store::category_popularity_trend`
/// against Postgres, with the ADR #37 blend evaluated by the shared
/// `score_from_raw` helper.
async fn category_popularity_trend_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    granularity: &str,
    top_categories: i64,
    tenant: &str,
) -> Result<Vec<CategoryTrendPoint>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;

    // Period expressions per granularity (same shapes the SQLite version
    // produced: YYYY-MM-DD daily/weekly, YYYY-MM monthly; weekly is
    // Sunday-start via the date_trunc('week') Monday minus one).
    let (s_period, a_period) = match granularity {
        "weekly" => (
            "to_char(date_trunc('week', s.created_at::date)::date - 1, 'YYYY-MM-DD')",
            "to_char(date_trunc('week', a.created_at::date)::date - 1, 'YYYY-MM-DD')",
        ),
        "monthly" => ("LEFT(s.created_at, 7)", "LEFT(a.created_at, 7)"),
        _ => (
            "to_char(s.created_at::date, 'YYYY-MM-DD')",
            "to_char(a.created_at::date, 'YYYY-MM-DD')",
        ),
    };

    // The most popular categories by current mean score.
    let top: Vec<(String, Option<String>)> = {
        let rows = client
            .query(
                "SELECT p.category_id, c.name
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE p.tenant_id = $2
                 GROUP BY p.category_id, c.name
                 ORDER BY AVG(p.popularity_score) DESC, p.category_id ASC
                 LIMIT $1",
                &[&top_categories.max(1), &tenant],
            )
            .await
            .map_err(|e| format!("DB error: {e}"))?;
        rows.iter()
            .map(|r| {
                (
                    r.get::<_, Option<String>>(0).unwrap_or_default(),
                    r.get::<_, Option<String>>(1),
                )
            })
            .collect()
    };
    if top.is_empty() {
        return Ok(Vec::new());
    }
    let rank: std::collections::HashMap<String, usize> = top
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (id.clone(), i))
        .collect();

    // (period, category) → raw signals.
    let mut agg: std::collections::HashMap<(String, String), (i64, i64, i64, i64)> =
        std::collections::HashMap::new();
    {
        // Sales: units + distinct transactions per (period, category).
        let sql = format!(
            "SELECT {s_period} AS period_start, p.category_id,
                    SUM(sl.qty)::bigint AS units, COUNT(DISTINCT sl.sale_id) AS txns
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             JOIN products p ON p.sku = sl.sku AND p.tenant_id = s.tenant_id
             WHERE s.status = 'completed'
               AND s.tenant_id = $3
               AND s.created_at::date BETWEEN $1 AND $2
             GROUP BY {s_period}, p.category_id"
        );
        let rows = client
            .query(&sql, &[&start, &end, &tenant])
            .await
            .map_err(|e| format!("DB error: {e}"))?;
        for row in rows {
            let period_start: String = row.get(0);
            let cat: String = row.get::<_, Option<String>>(1).unwrap_or_default();
            let units: i64 = row.get(2);
            let txns: i64 = row.get(3);
            let e = agg.entry((period_start, cat)).or_insert((0, 0, 0, 0));
            e.0 += units;
            e.1 += txns;
        }
    }
    {
        // Search + edit events per (period, category).
        let sql = format!(
            "SELECT {a_period} AS period_start, p.category_id, a.event_type, COUNT(*) AS cnt
             FROM product_activity a
             JOIN products p ON p.sku = a.sku AND p.tenant_id = a.tenant_id
             WHERE a.tenant_id = $3
               AND a.created_at::date BETWEEN $1 AND $2
             GROUP BY {a_period}, p.category_id, a.event_type"
        );
        let rows = client
            .query(&sql, &[&start, &end, &tenant])
            .await
            .map_err(|e| format!("DB error: {e}"))?;
        for row in rows {
            let period_start: String = row.get(0);
            let cat: String = row.get::<_, Option<String>>(1).unwrap_or_default();
            let etype: String = row.get(2);
            let cnt: i64 = row.get(3);
            let e = agg.entry((period_start, cat)).or_insert((0, 0, 0, 0));
            if etype == "search" {
                e.2 += cnt;
            } else {
                e.3 += cnt;
            }
        }
    }

    let (ms, mq, me) = category_means_pg(pool, "", tenant)
        .await?
        .unwrap_or((0.0, 0.0, 0.0));
    let mut points: Vec<CategoryTrendPoint> = Vec::new();
    for ((period_start, cat), (units, txns, searches, edits)) in agg {
        if !rank.contains_key(&cat) {
            continue;
        }
        let (ms, mq, me) = category_means_pg(pool, &cat, tenant)
            .await?
            .unwrap_or((ms, mq, me));
        let score = score_from_raw(
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

/// Read the cached smoothing means for a category from the settings table
/// (falls back to `None` — the SQLite path defaults to `(0,0,0)`).
async fn category_means_pg(
    pool: &Pool,
    category: &str,
    tenant: &str,
) -> Result<Option<(f64, f64, f64)>, String> {
    let raw = match get_setting_scoped_pg(pool, "popularity.category_means", tenant).await? {
        Some(v) => v,
        None => return Ok(None),
    };
    let map: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    let entry = map.get(category).or_else(|| map.get(""));
    let Some(entry) = entry else {
        return Ok(None);
    };
    Ok(Some((
        entry.get("sales").and_then(|v| v.as_f64()).unwrap_or(0.0),
        entry.get("search").and_then(|v| v.as_f64()).unwrap_or(0.0),
        entry.get("edits").and_then(|v| v.as_f64()).unwrap_or(0.0),
    )))
}

/// Next-period demand forecast per category — the Postgres mirror of
/// `oz_core::db::popularity::Store::category_forecast`, reusing the shared
/// `linear_forecast` / `seasonal_daily_forecast` fits.
pub async fn category_forecast_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    granularity: &str,
    top_categories: i64,
    tenant: &str,
) -> Result<Vec<CategoryForecastRow>, String> {
    const MAX_SERIES_POINTS: usize = 14;

    let points = category_popularity_trend_pg(
        pool,
        start_date,
        end_date,
        granularity,
        top_categories,
        tenant,
    )
    .await?;
    #[allow(clippy::type_complexity)]
    let mut groups: std::collections::HashMap<
        String,
        (Option<String>, Vec<(chrono::NaiveDate, f64)>),
    > = std::collections::HashMap::new();
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
        let f = if granularity == "daily" && tail.len() >= 7 {
            let next = tail
                .last()
                .map(|(d, _)| *d + chrono::Duration::days(1))
                .unwrap_or_else(|| chrono::Utc::now().date_naive());
            seasonal_daily_forecast(&tail, next)
        } else {
            let units: Vec<f64> = tail.iter().map(|(_, u)| *u).collect();
            linear_forecast(&units)
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
