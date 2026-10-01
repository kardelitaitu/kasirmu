import { loggedInvoke } from '@/utils/logged-invoke';

/** Daily revenue aggregate for a date range. */
export interface DailyRevenueRow {
  date: string;
  total_minor: number;
  currency: string;
  sale_count: number;
  /** Cost of goods sold in minor units (HPP × qty over completed lines). */
  cogs_minor: number;
  /** Gross profit in minor units: revenue − COGS. */
  gross_profit_minor: number;
  /** Gross margin as a percentage of revenue. */
  gross_margin_percent: number;
  /** Refunds processed on this date, minor units, same currency (REP-04). */
  refund_minor?: number;
  /** Net revenue: gross − refunds; negative on refund-only days (REP-04). */
  net_revenue_minor?: number;
}

/** Weekly revenue aggregate for a date range. */
export interface WeeklyRevenueRow {
  week_start: string;
  total_minor: number;
  currency: string;
  sale_count: number;
  /** Cost of goods sold in minor units (HPP × qty over completed lines). */
  cogs_minor: number;
  /** Gross profit in minor units: revenue − COGS. */
  gross_profit_minor: number;
  /** Gross margin as a percentage of revenue. */
  gross_margin_percent: number;
  /** Refunds processed in this week, minor units, same currency (REP-04). */
  refund_minor?: number;
  /** Net revenue: gross − refunds (REP-04). */
  net_revenue_minor?: number;
}

/** Monthly revenue aggregate for a date range. */
export interface MonthlyRevenueRow {
  month: string;
  total_minor: number;
  currency: string;
  sale_count: number;
  /** Cost of goods sold in minor units (HPP × qty over completed lines). */
  cogs_minor: number;
  /** Gross profit in minor units: revenue − COGS. */
  gross_profit_minor: number;
  /** Gross margin as a percentage of revenue. */
  gross_margin_percent: number;
  /** Refunds processed in this month, minor units, same currency (REP-04). */
  refund_minor?: number;
  /** Net revenue: gross − refunds (REP-04). */
  net_revenue_minor?: number;
}

/** Top-selling product within a date range. */
export interface TopProductRow {
  /** ISO-4217 code — rows are per product AND currency (REP-06). */
  currency: string;
  product_id: string;
  sku: string;
  name: string;
  total_qty: number;
  total_minor: number;
  cogs_minor: number;
  gross_profit_minor: number;
  gross_margin_percent: number;
}

/** Sales volume by day-of-week and hour for heatmap visualisation. */
export interface HourlyHeatmapRow {
  /** ISO-4217 code — one row per cell AND currency (REP-06). */
  currency: string;
  day_of_week: number;
  hour: number;
  total_minor: number;
  sale_count: number;
}

/** A product whose stock has fallen below the configured threshold. */
export interface LowStockAlert {
  product_id: string;
  sku: string;
  name: string;
  current_qty: number;
  threshold: number;
  currency: string;
  /** Selling price per unit in minor units. */
  price_minor: number;
  /** Cost (HPP) per unit in minor units. */
  cost_minor: number;
}

/** Sales breakdown by product category. */
export interface CategoryBreakdownRow {
  /** ISO-4217 code; `percentage` normalizes within it (REP-06). */
  currency: string;
  category_id: string | null;
  category_name: string;
  total_minor: number;
  sale_count: number;
  percentage: number;
}

/** A per-category next-period demand forecast derived from the trend series. */
export interface CategoryForecastRow {
  /** Category id; empty string for uncategorized products. */
  category_id: string;
  /** Category name; `null` for uncategorized. */
  category_name: string | null;
  /** Predicted units sold in the next period (never negative). */
  forecast_units: number;
  /** Fitted trend — units per period; 0 when fewer than 2 points. */
  trend_per_period: number;
  /** Baseline — mean units per period over the recent series. */
  recent_avg_units: number;
}

/** One (period, category) point of the popularity trend series. */
export interface CategoryTrendPoint {
  /** Period bucket start: `YYYY-MM-DD` (daily/weekly) or `YYYY-MM` (monthly). */
  period_start: string;
  /** Category id; empty string for uncategorized products. */
  category_id: string;
  /** Category name; `null` for uncategorized. */
  category_name: string | null;
  /** Period popularity score (same scale as `popularity_score`). */
  score: number;
  units_sold: number;
  distinct_transactions: number;
  searches: number;
  edits: number;
}

/** One product inside a category's popularity leaderboard. */
export interface CategoryTopProduct {
  sku: string;
  name: string;
  /** Materialized popularity score (category-smoothed). */
  popularity_score: number;
  /** 1-based rank within the category by score. */
  rank: number;
  /** Category-relative standing: 1.0 = most popular, 0.0 = least. */
  percentile: number;
}

/** Per-category popularity standings (ADR #37 per-category evolution). */
export interface CategoryPopularityRow {
  /** Category id; empty string for uncategorized products. */
  category_id: string;
  /** Category name; `null` for uncategorized. */
  category_name: string | null;
  product_count: number;
  /** Mean popularity score across the category's products. */
  mean_score: number;
  /** `mean_score` relative to the catalog mean (1.0 = average). */
  catalog_ratio: number;
  /** The category's most popular products, ranked by score. */
  top_products: CategoryTopProduct[];
}

/** Get daily revenue aggregates for a date range in the active store. */
export const getDailyRevenue = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<DailyRevenueRow[]> =>
  loggedInvoke<DailyRevenueRow[]>('get_daily_revenue_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Get weekly revenue aggregates for a date range in the active store. */
export const getWeeklyRevenue = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<WeeklyRevenueRow[]> =>
  loggedInvoke<WeeklyRevenueRow[]>('get_weekly_revenue_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Get monthly revenue aggregates for a date range in the active store. */
export const getMonthlyRevenue = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<MonthlyRevenueRow[]> =>
  loggedInvoke<MonthlyRevenueRow[]>('get_monthly_revenue_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Get top-selling products for a date range in the active store, ranked by
 * `orderBy` — `'revenue'` (default) or `'profit'` (gross profit). */
export const getTopProducts = (
  startDate: string,
  endDate: string,
  limit: number,
  sessionToken: string,
  orderBy: 'revenue' | 'profit' = 'revenue',
): Promise<TopProductRow[]> =>
  loggedInvoke<TopProductRow[]>('get_top_products_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
    limit,
    orderBy,
  });

/** Get per-category popularity standings for the active store: each
 * category's mean score, its ratio to the catalog average, and its top
 * `topPerCategory` products ranked by popularity. */
export const getCategoryPopularity = (
  sessionToken: string,
  topPerCategory = 3,
): Promise<CategoryPopularityRow[]> =>
  loggedInvoke<CategoryPopularityRow[]>('get_category_popularity_scoped', {
    sessionToken: sessionToken ?? '',
    topPerCategory,
  });

/** Get the next-period demand forecast per top category (simple linear fit
 * over the popularity trend series' recent units), bucketed by
 * `granularity` over `startDate..=endDate`. */
export const getCategoryForecast = (
  sessionToken: string,
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly',
  topCategories = 5,
): Promise<CategoryForecastRow[]> =>
  loggedInvoke<CategoryForecastRow[]>('get_category_forecast_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
    granularity,
    topCategories,
  });

/** Get the per-period popularity trend for the top `topCategories`
 * categories, bucketed by `granularity` (`'daily'` | `'weekly'` |
 * `'monthly'`) over `startDate..=endDate`. */
export const getCategoryPopularityTrend = (
  sessionToken: string,
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly',
  topCategories = 5,
): Promise<CategoryTrendPoint[]> =>
  loggedInvoke<CategoryTrendPoint[]>('get_category_popularity_trend_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
    granularity,
    topCategories,
  });

/** Get hourly sales heatmap data for a date range in the active store. */
export const getHourlyHeatmap = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<HourlyHeatmapRow[]> =>
  loggedInvoke<HourlyHeatmapRow[]>('get_hourly_heatmap_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Get products with stock levels below a given threshold in the active store. */
export const getLowStockAlerts = (
  threshold: number,
  sessionToken: string,
): Promise<LowStockAlert[]> =>
  loggedInvoke<LowStockAlert[]>('get_low_stock_alerts_scoped', {
    sessionToken: sessionToken ?? '',
    threshold,
  });

/** Get sales breakdown by product category for a date range in the active store. */
export const getCategoryBreakdown = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<CategoryBreakdownRow[]> =>
  loggedInvoke<CategoryBreakdownRow[]>('get_category_breakdown_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Revenue split by payment method for a date range in the active store. */
export interface PaymentMethodRow {
  /** ISO-4217 code — one row per method AND currency (REP-06). */
  currency: string;
  payment_method: string;
  total_minor: number;
  sale_count: number;
}

export const getPaymentMethodBreakdown = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<PaymentMethodRow[]> =>
  loggedInvoke<PaymentMethodRow[]>('get_payment_method_breakdown_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Voided-sale totals for a date range in the active store. */
export interface VoidedSummaryRow {
  /** ISO-4217 code — one row per currency (REP-06). */
  currency: string;
  void_count: number;
  void_total_minor: number;
}

export const getVoidedSalesSummary = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<VoidedSummaryRow[]> =>
  loggedInvoke<VoidedSummaryRow[]>('get_voided_sales_summary_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** One product line found on voided sales. */
export interface VoidedItemRow {
  name: string;
  qty: number;
}

export const getVoidedItems = (
  startDate: string,
  endDate: string,
  sessionToken: string,
  limit = 5,
): Promise<VoidedItemRow[]> =>
  loggedInvoke<VoidedItemRow[]>('get_voided_items_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
    limit,
  });

/** Average basket size for a date range in the active store. */
export interface BasketSizeRow {
  sale_count: number;
  avg_line_count: number;
}

export const getBasketSize = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<BasketSizeRow> =>
  loggedInvoke<BasketSizeRow>('get_basket_size_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Basket size (mean line count) for one completed-sales day. */
export interface BasketTrendRow {
  date: string;
  sale_count: number;
  avg_line_count: number;
}

export const getBasketSizeTrend = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<BasketTrendRow[]> =>
  loggedInvoke<BasketTrendRow[]>('get_basket_size_trend_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** New vs returning customer counts for a date range in the active store. */
export interface CustomerSplitRow {
  new_count: number;
  returning_count: number;
}

export const getCustomerSplit = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<CustomerSplitRow> =>
  loggedInvoke<CustomerSplitRow>('get_customer_split_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** One discount code's redemption count. */
export interface DiscountCodeRow {
  label: string;
  redeemed_count: number;
}

/** Discount usage summary for a date range in the active store. */
export interface DiscountsSummaryRow {
  sale_count: number;
  discounted_sale_count: number;
  share_percent: number;
  codes: DiscountCodeRow[];
}

export const getDiscountsSummary = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<DiscountsSummaryRow> =>
  loggedInvoke<DiscountsSummaryRow>('get_discounts_summary_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Stock-turnover snapshot for the active store at one location. */
export interface InventoryTurnoverRow {
  units_sold: number;
  stock_on_hand: number;
  sku_count: number;
  range_days: number;
}

export const getInventoryTurnover = (
  startDate: string,
  endDate: string,
  sessionToken: string,
  locationId: string,
): Promise<InventoryTurnoverRow> =>
  loggedInvoke<InventoryTurnoverRow>('get_inventory_turnover_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
    locationId,
  });

/** Units sold per day (inventory trend line) for the active store. */
export interface InventoryTrendRow {
  date: string;
  units_sold: number;
}

export const getInventoryTrend = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<InventoryTrendRow[]> =>
  loggedInvoke<InventoryTrendRow[]>('get_inventory_trend_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Completed table-bound orders per day (restaurant table turnover). */
export interface TableTurnoverRow {
  date: string;
  table_orders: number;
}

export const getTableTurnover = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<TableTurnoverRow[]> =>
  loggedInvoke<TableTurnoverRow[]>('get_table_turnover_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** Completed table-bound orders per hour of day (restaurant occupancy curve). */
export interface HourlyOccupancyRow {
  hour: number;
  table_orders: number;
}

export const getHourlyOccupancy = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<HourlyOccupancyRow[]> =>
  loggedInvoke<HourlyOccupancyRow[]>('get_hourly_occupancy_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

/** A single product row in the menu engineering report. */
export interface MenuEngineeringRow {
  product_id: string;
  sku: string;
  name: string;
  /**
   * ISO-4217 code the money fields below are denominated in (C22).
   *
   * Rows are grouped per (product, currency), so the same SKU can appear more
   * than once in one report. Format with THIS code, never the workspace
   * default — that is what previously labelled a USD row as Rp.
   */
  currency: string;
  total_volume: number;
  unit_price_minor: number;
  unit_cost_minor: number;
  margin_per_unit: number;
  total_margin_minor: number;
  total_revenue_minor: number;
}

/** Menu engineering quadrant classification based on volume and margin. */
export type MenuQuadrant = 'Star' | 'Plowhorse' | 'Puzzle' | 'Dog';

/** Menu engineering result with rows and median values for quadrant classification. */
export interface MenuEngineeringResult {
  rows: MenuEngineeringRow[];
  median_volume: number;
  median_margin: number;
}

/** Get menu engineering data for the active store and date range. */
export const getMenuEngineering = (
  startDate: string,
  endDate: string,
  sessionToken: string,
): Promise<MenuEngineeringResult> =>
  loggedInvoke<MenuEngineeringResult>('get_menu_engineering_scoped', {
    sessionToken: sessionToken ?? '',
    startDate,
    endDate,
  });

// ── Per-sale-line margin (HPP exposure) ────────────────────────────

/** One enriched sale line with cost and margin figures (HPP). */
export interface SaleLineMarginDto {
  sale_line_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price_minor: number;
  line_total_minor: number;
  unit_cost_minor: number;
  margin_minor: number;
  margin_percent: number;
}

/** Get per-line cost and margin for a single sale (ADR #36 HPP exposure). */
export const getSaleLineMarginsScoped = (
  sessionToken: string,
  saleId: string,
): Promise<SaleLineMarginDto[]> =>
  loggedInvoke<SaleLineMarginDto[]>('get_sale_line_margins_scoped', {
    sessionToken: sessionToken ?? '',
    saleId,
  });

// ── Custom Report Builder (P24) ──────────────────────────────────

/** Request payload for the custom report builder. */
export interface CustomReportRequest {
  dataset: string;
  columns: string[];
  start_date: string | null;
  end_date: string | null;
  limit?: number | null;
  offset?: number | null;
}

/** Response from the custom report builder — generic grid for table/CSV. */
export interface CustomReportResponse {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

/** Build a custom report for the active store. */
export const buildCustomReport = (
  request: CustomReportRequest,
  sessionToken: string,
): Promise<CustomReportResponse> =>
  loggedInvoke<CustomReportResponse>('build_custom_report_scoped', {
    sessionToken: sessionToken ?? '',
    request,
  });
