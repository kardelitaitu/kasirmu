/**
 * Dev-mock handlers — Analytics domain.
 *
 * Revenue reports, product popularity, category forecasts, menu engineering,
 * hourly heatmaps, and export stubs. Extracted from  by the
 * agent-4 work order (, phase 4.2).
 */

import type { MockHandler } from '../core/mockDispatcher';
import { handlers } from '../core/mockDispatcher';
import { MOCK_PRODUCTS } from './catalog';
import { MOCK_CATEGORIES } from '../core/mockSeedData';

function isoDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The over-quota assessment fixture — one body shared by the unscoped and
 *  scoped command names (W6-C): the mock tenant is Premium with unlimited
 *  quotas, so nothing is over and no remediation row is legally possible. */
function getMockOverQuotaReport(): {
  tierKey: string;
  tierName: string;
  usages: { dimension: string; limit: number | null; current: number }[];
  markers: never[];
} {
  return {
    tierKey: 'premium',
    tierName: 'Premium',
    usages: [
      { dimension: 'locations', limit: null, current: 1 },
      { dimension: 'pos_registers', limit: null, current: 1 },
      { dimension: 'warehouses', limit: null, current: 0 },
      { dimension: 'staff', limit: null, current: 1 },
      { dimension: 'products', limit: null, current: 0 },
    ],
    // section J B3: per-location marker rows are empty HERE ON PURPOSE, not
    // omitted. This fixture reports the Premium tier, whose caps are unlimited
    // (max_kds_screens and max_warehouses are both None), so the real fan-out
    // cannot legally emit a single row: an unlimited cap never produces a
    // marker. A mock that invented one to make the section visible would be worse
    // than no preview, because it would demonstrate a state the product cannot
    // reach. To see the section, change tierKey/tierName above to 'pro' and give
    // the caps finite limits, then add rows whose resourceType is 'kds_screen' or
    // 'warehouse' and whose resourceId is a mock location id.
    markers: [],
  };
}
function mockRevenue(i: number): number {
  return 2_500_000 + ((i * 7919) % 4_500_000);
}

// ── User preferences (stateful mock) ─────────────────────────────

export const analyticsHandlers: Record<string, MockHandler> = {

  // Over-quota assessment (§J remediation): the mock tenant is Premium
  // with unlimited quotas, so nothing is over — mirrors the premium caps
  // above and keeps the remediation view renderable in browser mode.
  // W6-C: the UI now calls the SCOPED variant (real session-side tenant
  // resolution + fail-closed SETTINGS_READ re-check); both names share the
  // one fixture because the two commands return the same OverQuotaReport
  // serde (the scoped one being the path the UI actually drives).
  'get_over_quota_report': getMockOverQuotaReport,
  'get_over_quota_report_scoped': getMockOverQuotaReport,
  'get_report_schedule': () => ({
    enabled: false,
    cadence: 'daily',
    report_types: ['daily_revenue', 'top_products'],
    recipients: ['admin@example.com'],
    send_at_time: '08:00',
    timezone: 'UTC',
    lookback_days: 1,
  }),
  'save_report_schedule': () => null,
  'send_test_report': () => 'Email sent',

  // Sales, inventory and shift mocks now live in `handlers/`
  // (agent 2, phase 2.2): `sales.ts`, `inventory.ts`, `shifts.ts`.

  'export_daily_summary': () => [],
  'export_daily_summary_scoped': () => [],
  'export_sales_by_hour': () => [],
  'export_sales_by_hour_scoped': () => [],
  'export_eod_report': () => null,
  'export_eod_report_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // REPORTS
  // ═══════════════════════════════════════════════════════════════

  // Seeded with realistic rows (not empty arrays) so dashboard/report
  // charts actually render in browser-mode E2E. The screens guard .length
  // so empty arrays are safe, but the dashboard weekly chart is an empty
  // 0-height div ("hidden") when there are no rows.
  'get_daily_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-01-07');
    return days.map((date, i) => ({
      date,
      total_minor: mockRevenue(i),
      currency: 'IDR',
      sale_count: 6 + (i % 12),
    }));
  },
  'get_weekly_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-01-28');
    // One row per ISO week (Monday start) within the range.
    const weeks = new Map<string, { week_start: string; total_minor: number; sale_count: number }>();
    days.forEach((date, i) => {
      const d = new Date(`${date}T00:00:00`);
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      const key = monday.toISOString().slice(0, 10);
      const existing = weeks.get(key);
      const total = mockRevenue(i);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        weeks.set(key, { week_start: key, total_minor: total, sale_count: 1 });
      }
    });
    return [...weeks.values()].map((w) => ({ ...w, currency: 'IDR' }));
  },
  'get_monthly_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-06-01');
    const months = new Map<string, { month: string; total_minor: number; sale_count: number }>();
    days.forEach((date, i) => {
      const key = date.slice(0, 7); // YYYY-MM
      const total = mockRevenue(i);
      const existing = months.get(key);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        months.set(key, { month: key, total_minor: total, sale_count: 1 });
      }
    });
    return [...months.values()].map((m) => ({ ...m, currency: 'IDR' }));
  },
  'get_top_products': (args) => {
    const { orderBy } = (args ?? {}) as { orderBy?: 'revenue' | 'profit' };
    const rows = MOCK_PRODUCTS.slice(0, 5).map((p, i) => {
      const qty = 3 + (i * 7) % 30;
      const total_minor = p.price.minor_units * qty;
      const cogs_minor = (p.cost_minor ?? 0) * qty;
      return {
        product_id: p.sku,
        sku: p.sku,
        name: p.name,
        total_qty: qty,
        total_minor,
        cogs_minor,
        gross_profit_minor: total_minor - cogs_minor,
        gross_margin_percent: total_minor > 0
          ? ((total_minor - cogs_minor) / total_minor) * 100
          : 0,
      };
    });
    return orderBy === 'profit'
      ? rows.sort((a, b) => b.gross_profit_minor - a.gross_profit_minor)
      : rows;
  },
  'get_category_popularity': (args) => {
    const { topPerCategory } = (args ?? {}) as { topPerCategory?: number };
    const top = Math.max(1, Math.min(topPerCategory ?? 3, 20));
    // Deterministic pseudo-scores so the mock preview looks alive: earlier
    // products (higher stock) get higher popularity.
    const scored = MOCK_PRODUCTS.map((p, i) => ({
      sku: p.sku,
      name: p.name,
      category: p.category ?? '',
      popularity_score: Math.round((10 - (i % 10)) * 10) / 10,
    }));
    const byCat = new Map<string, typeof scored>();
    for (const s of scored) {
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    const all = scored.map((s) => s.popularity_score);
    const catalogMean = all.length
      ? all.reduce((a, b) => a + b, 0) / all.length
      : 0;
    const rows = [...byCat.entries()].map(([category, items]) => {
      items.sort((a, b) => b.popularity_score - a.popularity_score);
      const mean = items.reduce((s, it) => s + it.popularity_score, 0) / items.length;
      return {
        category_id: category || '',
        category_name: category || null,
        product_count: items.length,
        mean_score: Math.round(mean * 10) / 10,
        catalog_ratio: catalogMean > 0 ? Math.round((mean / catalogMean) * 10) / 10 : 0,
        top_products: items.slice(0, top).map((it, i) => ({
          sku: it.sku,
          name: it.name,
          popularity_score: it.popularity_score,
          rank: i + 1,
          percentile: items.length > 1
            ? Math.round(((items.length - 1 - i) / (items.length - 1)) * 100) / 100
            : 1,
        })),
      };
    });
    rows.sort((a, b) => b.mean_score - a.mean_score);
    return rows;
  },
  'get_category_popularity_trend': (args) => {
    const { startDate, endDate, granularity, topCategories } = (args ?? {}) as {
      startDate?: string;
      endDate?: string;
      granularity?: string;
      topCategories?: number;
    };
    const top = Math.max(1, Math.min(topCategories ?? 5, 10));
    // Reuse the same pseudo-scores as the standings handler, then draw a
    // small rising/falling series per category across the requested range.
    const cats = MOCK_CATEGORIES.slice(0, top).map((c, i) => ({
      id: c.id,
      name: c.name,
      base: 10 - i * 2,
    }));
    const start = new Date(startDate ?? new Date().toISOString().slice(0, 10));
    const end = new Date(endDate ?? start.toISOString().slice(0, 10));
    const step = granularity === 'monthly' ? 30 : granularity === 'weekly' ? 7 : 1;
    const points = [];
    const cursor = new Date(start);
    let guard = 0;
    while (cursor <= end && guard < 60) {
      for (const c of cats) {
        const wave = Math.sin((guard + c.base) / 3) * 2;
        points.push({
          period_start: cursor.toISOString().slice(0, 10),
          category_id: c.id,
          category_name: c.name,
          score: Math.max(0.5, Math.round((c.base + wave) * 10) / 10),
          units_sold: Math.max(0, Math.round(c.base * 3 + wave * 2)),
          distinct_transactions: Math.max(0, Math.round(c.base + wave)),
          searches: Math.max(0, Math.round(c.base / 2)),
          edits: Math.max(0, Math.round(c.base / 4)),
        });
      }
      cursor.setDate(cursor.getDate() + step);
      guard += 1;
    }
    return points;
  },
  'get_category_forecast': (args) => {
    const { startDate, endDate, granularity, topCategories } = (args ?? {}) as {
      startDate?: string;
      endDate?: string;
      granularity?: string;
      topCategories?: number;
    };
    const top = Math.max(1, Math.min(topCategories ?? 5, 10));
    // Forecast from the same pseudo-series as the trend handler: each
    // category's slope over its generated points, projected one period.
    const trend = handlers['get_category_popularity_trend']!({
      startDate,
      endDate,
      granularity,
      topCategories: top,
    }) as Array<{
      category_id: string;
      category_name: string | null;
      units_sold: number;
      score: number;
    }>;
    const byCat = new Map<string, { name: string | null; units: number[] }>();
    for (const p of trend) {
      const e = byCat.get(p.category_id) ?? { name: p.category_name, units: [] };
      e.units.push(p.units_sold);
      byCat.set(p.category_id, e);
    }
    const rows = [...byCat.entries()].map(([category_id, e]) => {
      const units = e.units;
      const n = units.length;
      const avg = n ? units.reduce((a, b) => a + b, 0) / n : 0;
      // Least-squares slope over period indices.
      const meanX = (n - 1) / 2;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - meanX) * (units[i]! - avg);
        den += (i - meanX) * (i - meanX);
      }
      const slope = den > 0 ? num / den : 0;
      const forecast = Math.max(0, Math.round(avg + slope * ((n - 1) / 2)));
      return {
        category_id,
        category_name: e.name,
        forecast_units: n ? forecast : 0,
        trend_per_period: Math.round(slope * 10) / 10,
        recent_avg_units: Math.round(avg * 10) / 10,
      };
    });
    rows.sort((a, b) => b.forecast_units - a.forecast_units);
    return rows;
  },
  'get_hourly_heatmap': () => [0, 3, 5, 8, 11].flatMap((day) =>
    [9, 12, 15, 18].map((hour, i) => ({
      day_of_week: day,
      hour,
      total_minor: mockRevenue(day * 24 + hour) % 3_000_000,
      sale_count: (i * 3) % 14,
    })),
  ),
  'get_category_breakdown': () => {
    // Category breakdown feeds the retail-only "Sales by Category" card —
    // filter to retail products so restaurant categories (Hot Drinks, Food)
    // don't leak into the retail view.
    const byCat = new Map<string, { category_id: string | null; category_name: string; total_minor: number; sale_count: number }>();
    MOCK_PRODUCTS.forEach((p, i) => {
      if (p.product_type !== 'retail') return;
      const total = mockRevenue(i) % 4_000_000;
      const existing = byCat.get(p.category);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        byCat.set(p.category, { category_id: p.category, category_name: p.category, total_minor: total, sale_count: 1 });
      }
    });
    const rows = [...byCat.values()];
    const grand = rows.reduce((s, r) => s + r.total_minor, 0) || 1;
    return rows.map((r) => ({ ...r, percentage: (r.total_minor / grand) * 100 }));
  },
  'get_menu_engineering': () => {
    // Menu engineering is a restaurant-only card — the mock must return
    // restaurant products, not the retail catalog (which would show CPUs
    // under "Top Menu Items").
    const items = MOCK_PRODUCTS.filter((p) => p.product_type === 'restaurant');
    return {
      rows: items.slice(0, 6).map((p, i) => ({
        product_id: p.sku,
        sku: p.sku,
        name: p.name,
        total_volume: 2 + (i * 5) % 40,
        unit_price_minor: p.price.minor_units,
        unit_cost_minor: Math.floor(p.price.minor_units * 0.6),
        margin_per_unit: Math.floor(p.price.minor_units * 0.4),
        total_margin_minor: Math.floor(p.price.minor_units * 0.4) * (2 + (i * 5) % 40),
        total_revenue_minor: p.price.minor_units * (2 + (i * 5) % 40),
      })),
      median_volume: 15,
      median_margin: 500_000,
    };
  },
  'build_custom_report': () => ({
    rows: [], columns: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
  }),

  // ── Analytics dashboard cards ──────────────────────────────────────
  // Scoped-only commands (no unscoped twin, so applyScopedAliases mirrors
  // nothing here). Moved verbatim out of `tauri-api.ts`'s in-place
  // `handlers['x'] = …` patches by todo-refactor-devmock-router-consolidation.md
  // Phase 5.5. Each body is a self-contained plausible fixed shape so the
  // analytics grid renders in browser mode instead of resolving null and
  // crashing card layouts; none references router-local state, so the move is
  // a pure copy. Confirmed single-defined beforehand (git grep: each key
  // occurred in exactly one file) so folding them into this map cannot flip
  // which body wins.
  'get_customer_split_scoped': () => ({ new_count: 84, returning_count: 47 }),
  'get_payment_method_breakdown_scoped': () => [
    { payment_method: 'qris', total_minor: 98000000, sale_count: 142 },
    { payment_method: 'cash', total_minor: 74000000, sale_count: 118 },
    { payment_method: 'card', total_minor: 61000000, sale_count: 89 },
    { payment_method: 'ewallet', total_minor: 39000000, sale_count: 57 },
  ],
  'get_discounts_summary_scoped': () => ({
    sale_count: 406,
    discounted_sale_count: 96,
    share_percent: 6.4,
    codes: [
      { label: 'WELCOME10', redeemed_count: 41 },
      { label: 'PROMO8.8', redeemed_count: 28 },
      { label: 'LOYALTY15', redeemed_count: 17 },
      { label: 'FREESHIP', redeemed_count: 10 },
    ],
  }),
  'get_voided_sales_summary_scoped': () => ({ void_count: 23, void_total_minor: 5400000 }),
  'get_basket_size_scoped': () => ({ sale_count: 406, avg_line_count: 3.2 }),
  // Per-day basket size for the trend card — a week of plausible averages.
  'get_basket_size_trend_scoped': () => {
    const days: { date: string; sale_count: number; avg_line_count: number }[] = [];
    const avgs = [3.1, 3.4, 2.9, 3.6, 3.2, 3.8, 3.3];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        date: d.toISOString().slice(0, 10),
        sale_count: 55 + ((i * 13) % 20),
        avg_line_count: avgs[i]!,
      });
    }
    return days;
  },
  'get_inventory_turnover_scoped': () => ({ units_sold: 1280, stock_on_hand: 340, sku_count: 486, range_days: 30 }),
  'get_inventory_trend_scoped': () => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days.map((date, i) => ({ date, units_sold: 30 + ((i * 17) % 40) }));
  },
  // Restaurant table turnover: 7 days of completed table-bound orders.
  // ~18–31 turns/day → average turn 46–80 minutes (plausible service pace).
  'get_table_turnover_scoped': () => {
    const days: { date: string; table_orders: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: d.toISOString().slice(0, 10), table_orders: 18 + ((i * 7) % 14) });
    }
    return days;
  },
  // Restaurant hourly table activity: twin-peak service shape (lunch ≈ 12:00,
  // dinner ≈ 19:00) across the service day — feeds the occupancy curve.
  'get_hourly_occupancy_scoped': () => {
    const shape = [0, 0, 0, 0, 0, 0, 4, 9, 18, 30, 42, 55, 62, 48, 34, 30, 38, 52, 64, 70, 58, 36, 18, 6];
    return shape.map((count, hour) => ({ hour, table_orders: count }));
  },
  'get_voided_items_scoped': () => [
    { name: 'Caffè Latte', qty: 6 },
    { name: 'Iced Coffee', qty: 5 },
    { name: 'Avocado Toast', qty: 4 },
    { name: 'Smoothie', qty: 3 },
  ],
};
