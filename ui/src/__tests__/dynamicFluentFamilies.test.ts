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
// Four families were imported live rather than restated, so they cannot drift
// from the code: GRANULARITIES, MONTH_LABEL_KEYS, DAY_KEYS and SORT_MODES (this
// line said two until the data-mgmt case was rewired, which is itself an example
// of the drift this file exists to catch). DATA_TYPES makes five. Every case
// still restating its domain by hand is listed at the bottom of this comment
// with what it duplicates, because a hand-restated list checks the BUNDLES, not
// the code: adding a value to the screen ships red-free until someone edits a
// test that never asked to be edited.

import { describe, it, expect } from 'vitest';
import { getBundle } from '@/i18n';
import { GRANULARITIES } from '@/features/analytics/utils/dateRangePresets';
import { MONTH_LABEL_KEYS } from '@/features/analytics/analytics-data';
import { DAY_KEYS } from '@/features/reports/SalesReportScreen';
import { SORT_MODES } from '@/features/restaurant/RestaurantMenu';
import { DATA_TYPES } from '@/features/settings/dataManagementModel';
import { INVENTORY_TRANSACTION_TYPE_KEYS } from '@/features/inventory/transactionTypeLabel';

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

  it('data-mgmt types: every label and description id the MODEL emits resolves', () => {
    // The domain is DATA_TYPES itself, not a copy of its names. The table moved
    // out of DataManagementScreen.tsx into features/settings/dataManagementModel.ts
    // in DataManagement slice 1, and this case kept citing the screen — the stale
    // comment was the least of it. Restating the six names meant a seventh type
    // added to the table with no bundle keys shipped unchecked, and the six -desc
    // twins were never verified at all even though the screen renders every row's
    // descriptionId through requiredLocalized, where a miss returns the id itself
    // and prints 'data-mgmt-type-produts' to a cashier.
    const ids = DATA_TYPES.flatMap((row) => [row.labelId, row.descriptionId]);
    expect(ids).toHaveLength(DATA_TYPES.length * 2);
    expect(new Set(ids).size).toBe(ids.length);
    expectResolved(ids, 'data-mgmt type');
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

  it('inventory transaction types: every id the mapping emits resolves', () => {
    // HISTORY, kept on purpose: this is the family that was actually BROKEN.
    // `inv-log-type-${tx.type}` composed inv-log-type-purchase-order-receive,
    // which existed in neither bundle, so the log cell showed the humanized slug
    // "purchase order receive" while the dropdown on the SAME screen correctly
    // read "PO Diterima". Routing through INVENTORY_TRANSACTION_TYPE_KEYS fixed
    // it — see transactionTypeLabel.test.ts.
    //
    // The domain is now the mapping itself: a Record<InventoryTransaction['type'],
    // string> whose VALUES are the ids, so nothing is composed here (the old case
    // rebuilt them as `inv-log-type-${slug}` from a hand list that happened to
    // agree). Restating meant this test checked only the bundles: point a value at
    // a fresh id and the old assertions stayed green because they never asked the
    // const what it uses. Measured, the module exposes ONE per-type family —
    // inventory.ftl holds exactly seven inv-log-type-* keys and no -desc or
    // subtitle twin (its other inv-log-* keys are col/error/filter/title surfaces)
    // — so unlike data-mgmt there is no second half to cover.
    const ids = Object.values(INVENTORY_TRANSACTION_TYPE_KEYS);
    expect(ids.length).toBe(7);
    // Uniqueness is coverage the hand list could not have: two union members
    // mapped to the same id render one label for two transaction types.
    expect(new Set(ids).size).toBe(ids.length);
    expectResolved(ids, 'inv log type');
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
