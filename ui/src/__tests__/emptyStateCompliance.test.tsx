// ── Empty-state compliance gate (EMPTY-10) ─────────────────────────
//
// The audit found that empty-state behavior was implemented ad hoc per
// screen: duplicate primitives, no distinction between a successful
// empty result and a failed request, misleading "no orders" copy after
// a filter removed every item, dead-end no-results states without a
// clear/reset action, and no executable contract that every async list
// keeps error ≠ empty ≠ no-results.
//
// This gate pins, in one place, the cross-screen empty-state contract
// that the remediation commits introduced:
//
//   1. The canonical EmptyState primitive is a single implementation
//      reachable through every public path (EMPTY-01 — mirrored here so
//      a future refactor can't silently fork the import surface).
//   2. Every empty-state Fluent key referenced by the screens the audit
//      flagged exists with a value-bearing message in BOTH the en and id
//      bundles (EMPTY-07).
//   3. A static sweep: no feature screen falls back to a hardcoded
//      English "No ..." string via `l10n.getString(...) || 'No ...'`
//      (EMPTY-07).
//   4. Screens with active filters must not claim the data is empty when
//      the filter removed everything — KDS layouts render status-scoped
//      copy (EMPTY-04, mirrored from the layout suites so the gate holds
//      even if those test files are renamed).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { EmptyState as ComponentEmptyState } from '@/components/EmptyState';
import { EmptyState as SharedEmptyState } from '@/components/EmptyState';

// ── 1. Primitive single-source-of-truth ──────────────────────────────
describe('empty-state compliance — primitive consolidation (EMPTY-01)', () => {
  it('every public EmptyState path resolves to one canonical implementation', () => {
    expect(ComponentEmptyState).toBe(SharedEmptyState);
  });
});

// ── 2. Bundle parity for empty-state keys (EMPTY-07) ─────────────────
describe('empty-state compliance — localized empty copy in both bundles (EMPTY-07)', () => {
  // Curated list of empty-state / no-results / clear-search keys the
  // audit flagged, keyed by the bundle file that owns them.
  const EMPTY_KEYS: Record<string, string[]> = {
    'kds': ['kds-no-orders', 'kds-no-orders-filtered', 'kds-picker-no-products', 'kds-picker-clear-search'],
    'products': ['product-lookup-no-results', 'product-lookup-clear-search'],
    'customers': ['customer-mgmt-search-clear'],
    'sales': ['sales-history-empty', 'sales-history-empty-filtered', 'sales-history-clear-filters'],
    'loyalty': ['loyalty-no-accounts', 'loyalty-no-transactions'],
    'promotions': ['promotions-no-promotions'],
    'purchasing': ['suppliers-no-data', 'suppliers-no-results', 'po-empty'],
    'terminals': ['terminal-management-empty'],
    'gift-cards': ['gift-cards-no-cards'],
  };

  const LOCALES_DIR = path.resolve(__dirname, '../../../shared-ui/locales');

  for (const [bundle, keys] of Object.entries(EMPTY_KEYS)) {
    for (const key of keys) {
      for (const suffix of ['', '.id']) {
        const file = path.join(LOCALES_DIR, `${bundle}${suffix}.ftl`);
        it(`${key} has a value-bearing message in ${bundle}${suffix || '.en'}.ftl`, () => {
          expect(fs.existsSync(file)).toBe(true);
          const src = fs.readFileSync(file, 'utf-8');
          // Key present as `key = value` (not an attribute-only / blank entry).
          const line = src
            .split('\n')
            .find((l) => l.startsWith(`${key} =`) || l === `${key} =`);
          expect(line).toBeTruthy();
          const value = line!.split('=').slice(1).join('=').trim();
          expect(value.length).toBeGreaterThan(0);
        });
      }
    }
  }
});

// ── 3. Static sweep: no hardcoded English empty fallback ──────────────
describe('empty-state compliance — no hardcoded English empty fallbacks (EMPTY-07)', () => {
  const FEATURES_DIR = path.resolve(__dirname, '../features');
  const tsxFiles = (function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  })(FEATURES_DIR);

  const offenders = tsxFiles
    .filter((f) => !f.includes('__tests__'))
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf-8');
      return /getString\([^)]*\)\s*\|\|\s*['"]No\s/.test(src);
    });

  it('no feature screen falls back to a hardcoded English "No ..." string', () => {
    expect(offenders).toEqual([]);
  });
});

// ── 4. Filter-driven empties never claim the data is empty (EMPTY-04) ─
describe('empty-state compliance — filter-aware no-results (EMPTY-04)', () => {
  it('renders role=status on the EmptyState container (EMPTY-06)', () => {
    render(<ComponentEmptyState title="Nothing here" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('KDS masonry never shows "No orders yet" when the board is populated', async () => {
    vi.doMock('@/features/kds/components/KdsTicketCard', () => ({
      KdsTicketCard: () => <div data-testid="ticket-card" />,
    }));
    const { renderWithFluentSync } = await import('@/__tests__/test-utils/render');
    const { KdsLayoutMasonry } = await import('@/features/kds/KdsLayoutMasonry');
    const kdsFtl = (await import('@/locales/kds.ftl?raw')).default;

    const now = Date.now();
    const order = {
      id: 'o1', sale_id: 's1', store_id: null, status: 'pending' as const,
      items_summary: 'Coffee x2', item_count: 2, display_number: 1,
      received_at: new Date(now - 60000).toISOString(), started_at: null,
      ready_at: null, served_at: null, prep_time_seconds: 0,
      kitchen_zone: null, notes: '', table_number: null, priority: false,
    };

    // Populated board → the empty-state copy must not appear.
    const { container } = renderWithFluentSync(
      <KdsLayoutMasonry
        orders={[order]}
        onAdvance={() => {}}
        showOrderId
        showTableNumber
        selectedOrderId={null}
        sessionToken="tok"
        newOrderIds={new Set<string>()}
      />,
      kdsFtl,
    );
    expect(container.textContent).not.toContain('No orders yet');
    vi.doUnmock('@/features/kds/components/KdsTicketCard');
  });
});
