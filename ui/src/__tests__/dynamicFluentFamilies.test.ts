// ── Dynamic Fluent id families ──────────────────────────────────────
//
// scripts/verify-bundle-parity.py resolves only string literals. Every id
// built from a template literal — `analytics-granularity-${g}`,
// `topology-new-${type}`, `stock-transfers-status-${status}` — is invisible
// to it, so a rename or a one-sided translation ships silently. For
// `l10n.getString()` sites the failure is the worst kind: the call returns
// null and React renders *nothing*.
//
// This test is the static gate's blind spot made visible. Each family lists
// the domain exactly as the runtime produces it, with the source named so a
// future reader can tell whether the list went stale.
//
// Two families are imported live rather than restated, so the test cannot
// drift from the code: GRANULARITIES and MONTH_LABEL_KEYS.

import { describe, it, expect } from 'vitest';
import { getBundle } from '@/i18n';
import { GRANULARITIES } from '@/features/analytics/utils/dateRangePresets';
import { MONTH_LABEL_KEYS } from '@/features/analytics/analytics-data';
import { DAY_KEYS } from '@/features/reports/SalesReportScreen';
import { SORT_MODES } from '@/features/restaurant/RestaurantMenu';

/** Assert every id resolves to non-empty, non-self text in both bundles. */
function expectResolved(ids: string[], label: string) {
  for (const locale of ['en', 'id'] as const) {
    const bundle = getBundle(locale);
    for (const id of ids) {
      expect(bundle.hasMessage(id), `${id} (${label}) absent from ${locale}`).toBe(true);
      const text = bundle.formatPattern(bundle.getMessage(id)!.value!, null);
      expect(text, `${id} (${label}) empty in ${locale}`).not.toBe('');
      expect(text, `${id} (${label}) unresolved in ${locale}`).not.toBe(id);
    }
  }
}

describe('dynamic Fluent id families', () => {
  it('analytics granularity: every rendered option resolves', () => {
    // Domain is the exported GRANULARITIES array, not the Granularity union:
    // 'daily' exists in the type but reaches no selector button.
    expect(GRANULARITIES).toContain('weekly');
    expectResolved(GRANULARITIES.map((g) => `analytics-granularity-${g}`), 'granularity');
  });

  it('analytics month: every MONTH_LABEL_KEYS entry resolves', () => {
    expect(MONTH_LABEL_KEYS).toHaveLength(12);
    expectResolved(MONTH_LABEL_KEYS.map((m) => `analytics-month-${m}`), 'month');
  });

  it('analytics range presets: every chip in the .map([7,30,90,365]) resolves', () => {
    // AnalyticsScreen.tsx renders {[7, 30, 90, 365].map(days => ...)} with
    // both aria-label and text from `analytics-range-preset-${days}d`.
    expectResolved([7, 30, 90, 365].map((d) => `analytics-range-preset-${d}d`), 'preset');
  });

  it('sales report view modes: every ViewMode resolves', () => {
    // SalesReportScreen.tsx: (['daily','weekly','monthly'] as ViewMode[])
    // feeds both getString(`sales-report-${mode}`) and <Localized id={...}>.
    expectResolved(['daily', 'weekly', 'monthly'].map((m) => `sales-report-${m}`), 'view mode');
  });

  it('data-mgmt types: every export/import row key resolves', () => {
    // DataManagementScreen.tsx DATA_TYPES: products, categories, sales,
    // customers, users, settings.
    expectResolved(
      ['products', 'categories', 'sales', 'customers', 'users', 'settings']
        .map((k) => `data-mgmt-type-${k}`),
      'data-mgmt type',
    );
  });

  it('topology rack panels: every panel title resolves', () => {
    // topologyToolRack.tsx onTogglePanel('add'|'edit'|'share'|'view') drives
    // `topology-rack-${rackPanel}-title`.
    expectResolved(
      ['add', 'edit', 'share', 'view'].map((p) => `topology-rack-${p}-title`),
      'rack panel',
    );
  });

  it('topology new-node: every NodeType resolves, title and subtitle', () => {
    // NodeTopologyEditor.tsx: export type NodeType =
    //   'store' | 'workspace' | 'warehouse' | 'hardware'
    // feeding `topology-new-${type}` and `topology-new-${type}-subtitle`.
    const types = ['store', 'workspace', 'warehouse', 'hardware'];
    expectResolved(types.map((t) => `topology-new-${t}`), 'new node');
    expectResolved(types.map((t) => `topology-new-${t}-subtitle`), 'new node subtitle');
  });

  it('stock-transfers statuses: every filter-tab status resolves', () => {
    // StockTransfersScreen.tsx builds `stock-transfers-status-${s}` for the
    // tabs and the badge; the fallback is a capitalized raw status.
    expectResolved(
      ['all', 'draft', 'pending', 'in_transit', 'received', 'received_partial', 'cancelled']
        .map((s) => `stock-transfers-status-${s}`),
      'transfer status',
    );
  });

  it('menu-engineering quadrants: every MenuQuadrant lowercased resolves', () => {
    // reports.ts: export type MenuQuadrant = 'Star'|'Plowhorse'|'Puzzle'|'Dog'
    // MenuEngineeringScreen.tsx builds `menu-eng-${row.quadrant.toLowerCase()}`.
    expectResolved(
      ['Star', 'Plowhorse', 'Puzzle', 'Dog'].map((q) => `menu-eng-${q.toLowerCase()}`),
      'quadrant',
    );
  });

  it('inventory transaction types: every mapped id resolves', () => {
    // The one family that was BROKEN: `inv-log-type-${tx.type}` produced
    // inv-log-type-purchase-order-receive, present in neither bundle, so the
    // cell showed the slug "purchase order receive" while the dropdown on the
    // same screen correctly read "PO Diterima". Now routed through
    // INVENTORY_TRANSACTION_TYPE_KEYS — see transactionTypeLabel.test.ts.
    expectResolved(
      ['sale', 'void', 'refund', 'transfer', 'po-receive', 'stock-count', 'manual-adjustment']
        .map((t) => `inv-log-type-${t}`),
      'inv log type',
    );
  });

  it('restaurant sort modes: every interpolated id resolves', () => {
    // A real defect found by this sweep: RestaurantMenu.tsx renders
    // `restaurant-sort-${mode}` for four modes and NOT ONE of the four keys
    // existed in either bundle. The buttons still looked right in English
    // because each has a hardcoded JSX fallback child — which meant
    // Indonesian users were silently seeing "Manual / A–Z / By Date /
    // Popularity". Enumerated from the exported SORT_MODES the type is
    // derived from, so a new mode cannot be added without this failing.
    expectResolved(SORT_MODES.map((mode) => `restaurant-sort-${mode}`), 'restaurant sort');
  });

  it('heatmap weekday labels: every DAY_KEYS entry resolves', () => {
    // `day-${dayKey}` across the sales heatmap. The domain is full weekday
    // names, not the mon/tue abbreviations a reader would guess from the
    // rendered label, which uppercases and slices to three characters.
    expectResolved(DAY_KEYS.map((k) => `day-${k}`), 'day label');
  });
});

// Four families are deliberately NOT covered here, because their ids are
// built from values that come from the server or the database and no
// enumeration can prove coverage:
//   gift-cards-status-${gc.card.status}        — api/giftCards.ts: string
//   gift-cards-txn-${txn.txn_type}             — api/giftCards.ts: string
//   sales-report-category-${name}              — DB category name
//   topology-purpose-${purposeKey ?? 'general'} — node metadata, open set
// For these the durable requirement is not a key list but a graceful
// fallback, which is what each call site already does. Recorded in the audit
// journal rather than pinned by an assertion that could only freeze drift.
