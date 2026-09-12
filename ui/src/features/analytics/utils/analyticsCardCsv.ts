//! Per-card CSV exporters for the analytics grid.
//!
//! Extracted from `AnalyticsCardContent.tsx` (R37 analytics-kpi split). Each
//! exporter is typed against its own card's row shape, which is why they live
//! together here rather than in the screen's `utils/analyticsExport.ts` — that
//! module owns the heatmap download only.

import { downloadCsv } from '@/utils/export-csv';
import type { MenuEngineeringRow } from '@/api/reports';
import type {
  Bucket,
  CategoryBreakdownRow,
  CustomerSplitRow,
  DiscountsSummaryRow,
  LowStockAlert,
  PaymentMethodRow,
  StaffAnalyticsRow,
  TableOccupancy,
  TopProductRow,
  VoidedItemRow,
  VoidedSummaryRow,
} from '../analytics-data';
import { PAYMENT_NAMES } from '../cards/shared/constants';

function staffCsvColumns(getString: (id: string) => string) {
  return [
    { key: 'display_name', label: getString('analytics-export-col-name') },
    { key: 'shift_count', label: getString('analytics-export-col-shifts') },
    { key: 'closed_shift_count', label: getString('analytics-export-col-closed') },
    { key: 'sale_count', label: getString('analytics-export-col-orders') },
    { key: 'sale_total', label: getString('analytics-export-col-sales') },
    { key: 'shift_sales', label: getString('analytics-export-col-shift-sales') },
  ];
}

/** Download a staff card's rows as CSV, ranked like the on-screen list. */
export function exportStaffCsv(
  cardKey: string,
  staff: StaffAnalyticsRow[],
  from: string,
  to: string,
  fmt: (minor: number) => string,
  getString: (id: string) => string,
  rankBy: 'sales' | 'covers' = 'sales',
) {
  const ranked = [...staff].sort((a, b) =>
    rankBy === 'covers' ? b.sale_count - a.sale_count : b.sale_total_minor - a.sale_total_minor,
  );
  downloadCsv(
    `${cardKey}-${from}-to-${to}.csv`,
    staffCsvColumns(getString),
    ranked.map((r) => ({
      display_name: r.display_name,
      shift_count: String(r.shift_count),
      closed_shift_count: String(r.closed_shift_count),
      sale_count: String(r.sale_count),
      sale_total: fmt(r.sale_total_minor),
      shift_sales: fmt(r.shift_sales_minor),
    })),
  );
}

/** Download a top-items card's rows as CSV (retail products / restaurant menu). */
export function exportTopItemsCsv(
  raw: (TopProductRow | MenuEngineeringRow)[],
  from: string,
  to: string,
  fmt: (minor: number) => string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `top-items-${from}-to-${to}.csv`,
    [
      { key: 'name', label: getString('analytics-export-col-name') },
      { key: 'sku', label: getString('analytics-export-col-sku') },
      { key: 'units', label: getString('analytics-export-col-units') },
      { key: 'revenue', label: getString('analytics-export-col-revenue') },
    ],
    raw.map((r) => ('total_qty' in r
      ? { name: r.name, sku: r.sku, units: String(r.total_qty), revenue: fmt(r.total_minor) }
      : { name: r.name, sku: r.sku, units: String(r.total_volume), revenue: fmt(r.total_revenue_minor) })),
  );
}

/** Download the payment-method breakdown as CSV. */
export function exportPaymentsCsv(
  rows: PaymentMethodRow[],
  from: string,
  to: string,
  fmt: (minor: number) => string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `payments-${from}-to-${to}.csv`,
    [
      { key: 'method', label: getString('analytics-export-col-method') },
      { key: 'sales', label: getString('analytics-export-col-sales') },
      { key: 'orders', label: getString('analytics-export-col-orders') },
    ],
    rows.map((r) => ({
      method: PAYMENT_NAMES[r.payment_method] ? getString(PAYMENT_NAMES[r.payment_method]!) : r.payment_method,
      sales: fmt(r.total_minor),
      orders: String(r.sale_count),
    })),
  );
}

/** Download the sales-by-category breakdown as CSV. */
export function exportCategoryCsv(
  rows: CategoryBreakdownRow[],
  from: string,
  to: string,
  fmtIn: (minor: number, code: string) => string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `category-${from}-to-${to}.csv`,
    [
      { key: 'category', label: getString('analytics-export-col-category') },
      // REP-06a: rows carry their own currency — an unlabelled amount
      // column across currencies is unreadable.
      { key: 'currency', label: getString('analytics-csv-col-currency') },
      { key: 'sales', label: getString('analytics-export-col-sales') },
      { key: 'orders', label: getString('analytics-export-col-orders') },
      { key: 'share', label: getString('analytics-export-col-share') },
    ],
    rows.map((r) => ({
      category: r.category_name,
      currency: r.currency,
      sales: fmtIn(r.total_minor, r.currency),
      orders: String(r.sale_count),
      share: String(Math.round(r.percentage)),
    })),
  );
}

/** Download a trend card's time-bucketed rows as CSV (period + value). */
export function exportTrendCsv(
  cardKey: string,
  valueLabel: string,
  buckets: Bucket[],
  from: string,
  to: string,
  getString: (id: string) => string,
  fmtValue: (v: number) => string,
) {
  downloadCsv(
    `${cardKey}-${from}-to-${to}.csv`,
    [
      { key: 'period', label: getString('analytics-export-col-period') },
      { key: 'value', label: valueLabel },
    ],
    buckets.map((b) => ({ period: b.label, value: fmtValue(b.value) })),
  );
}

/** Download the new-vs-returning customer split as CSV (two segments). */
export function exportCustomersCsv(
  split: CustomerSplitRow,
  from: string,
  to: string,
  getString: (id: string) => string,
) {
  const total = split.new_count + split.returning_count;
  const share = (n: number) => (total > 0 ? String(Math.round((n / total) * 100)) : '0');
  downloadCsv(
    `customers-${from}-to-${to}.csv`,
    [
      { key: 'segment', label: getString('analytics-export-col-segment') },
      { key: 'customers', label: getString('analytics-export-col-customers') },
      { key: 'share', label: getString('analytics-export-col-share') },
    ],
    [
      { segment: getString('analytics-card-customers-new'), customers: String(split.new_count), share: share(split.new_count) },
      { segment: getString('analytics-card-customers-returning'), customers: String(split.returning_count), share: share(split.returning_count) },
    ],
  );
}

/** Download the discount-code redemption list as CSV. */
export function exportDiscountsCsv(
  summary: DiscountsSummaryRow,
  from: string,
  to: string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `discounts-${from}-to-${to}.csv`,
    [
      { key: 'code', label: getString('analytics-export-col-code') },
      { key: 'redemptions', label: getString('analytics-export-col-redemptions') },
    ],
    summary.codes.map((c) => ({ code: c.label, redemptions: String(c.redeemed_count) })),
  );
}

/** Download the refunds/voids summary as CSV — one row per currency (REP-06). */
export function exportRefundsCsv(
  rows: VoidedSummaryRow[],
  from: string,
  to: string,
  fmtIn: (minor: number, code: string) => string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `refunds-${from}-to-${to}.csv`,
    [
      { key: 'currency', label: getString('analytics-csv-col-currency') },
      { key: 'count', label: getString('analytics-card-refunds-count') },
      { key: 'amount', label: getString('analytics-card-refunds-amount') },
      { key: 'average', label: getString('analytics-card-refunds-avg') },
    ],
    rows.map((r) => ({
      currency: r.currency,
      count: String(r.void_count),
      amount: fmtIn(r.void_total_minor, r.currency),
      average: fmtIn(r.void_count > 0 ? Math.round(r.void_total_minor / r.void_count) : 0, r.currency),
    })),
  );
}

/** Download voided/refund item rows as CSV (name + quantity). */
export function exportVoidedItemsCsv(
  cardKey: string,
  items: VoidedItemRow[],
  from: string,
  to: string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `${cardKey}-${from}-to-${to}.csv`,
    [
      { key: 'name', label: getString('analytics-export-col-name') },
      { key: 'qty', label: getString('analytics-export-col-qty') },
    ],
    items.map((it) => ({ name: it.name, qty: String(it.qty) })),
  );
}

/** Download the low-stock alert list as CSV (name, SKU, stock, reorder, cost). */
export function exportLowStockCsv(
  alerts: LowStockAlert[],
  from: string,
  to: string,
  fmt: (minor: number) => string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `low-stock-${from}-to-${to}.csv`,
    [
      { key: 'name', label: getString('analytics-export-col-name') },
      { key: 'sku', label: getString('analytics-export-col-sku') },
      { key: 'stock', label: getString('analytics-export-col-stock') },
      { key: 'reorder', label: getString('analytics-export-col-reorder') },
      { key: 'cost', label: getString('analytics-export-col-restock-cost') },
    ],
    alerts.map((a) => {
      const reorder = Math.max(0, a.threshold - a.current_qty);
      return {
        name: a.name,
        sku: a.sku,
        stock: String(a.current_qty),
        reorder: String(reorder),
        cost: fmt(reorder * a.cost_minor),
      };
    }),
  );
}

/** Download the occupancy hourly curve as CSV (hour, orders, occupancy %). */
export function exportOccupancyCsv(
  occ: TableOccupancy,
  from: string,
  to: string,
  getString: (id: string) => string,
) {
  downloadCsv(
    `occupancy-${from}-to-${to}.csv`,
    [
      { key: 'hour', label: getString('analytics-export-col-hour') },
      { key: 'orders', label: getString('analytics-export-col-orders') },
      { key: 'occupancy', label: getString('analytics-export-col-occupancy') },
    ],
    occ.hourly.map((h) => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, orders: String(h.table_orders), occupancy: `${h.pct}%` })),
  );
}

/**
 * Small delta pill (▲/▼ %). The "vs previous period" suffix renders only
 * in compare mode — off-mode chips are in-period trends (first→last
 * bucket), so labeling them as period-over-period would be a lie.
 */
