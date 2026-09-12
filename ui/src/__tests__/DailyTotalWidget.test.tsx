import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import DailyTotalWidget from '@/features/sales/widgets/DailyTotalWidget';
import salesFtl from '@/locales/sales.ftl?raw';
import type { DailySummaryRow } from '@/api/sales';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import { clearWidgets, getDeniedWidgets, getWidgets } from '@/platform/ui/widget-registry';
import { registerSalesWidgets } from '@/features/sales/widgets';

vi.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: vi.fn(),
}));

const mockExportDailySummary = vi.fn();

vi.mock('@/api/sales', () => ({
  exportDailySummary: (...args: unknown[]) => mockExportDailySummary(...args),
  exportDailySummaryScoped: (...args: unknown[]) => mockExportDailySummary(...args),
  exportSalesByHour: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

// ── access ─────────────────────────────────────────────────────────
// The tile no longer decides its own access (4274ee416 had it ask
// `hasGrantedPermission` in its own body; b3a1e6f7c moved that rule into the
// registry). What its own suite still pins is the DECLARATION that arms the
// host gate: delete `requiredPermission` from the daily-total registration in
// ../widgets/index.ts and the first test below goes red.
/** Staff: sales:view, no reports:export (platform/core rbac_presets.rs:136). */
const STAFF = { userRole: 'Staff', permissions: ['sales:view'] };
/** Anything holding the key the scoped command enforces. */
const MANAGER = { userRole: 'Manager', permissions: ['sales:view', 'reports:export'] };

beforeEach(() => {
  mockExportDailySummary.mockReset();
  vi.mocked(useSubscription).mockReturnValue({
    caps: null,
    state: 'active',
    loading: false,
    refresh: vi.fn(),
  });
});

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-07-16',
    total_minor: 0,
    currency: 'USD',
    sale_count: 0,
    line_count: 0,
    ...overrides,
  } as unknown as DailySummaryRow;
}

describe('DailyTotalWidget', () => {
  it('shows loading skeleton initially', () => {
    mockExportDailySummary.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('renders KPI values after loading', async () => {
    const rows = [
      createRow({ total_minor: 150000, currency: 'IDR', sale_count: 3, line_count: 12 }),
      createRow({ total_minor: 75000, currency: 'IDR', sale_count: 1, line_count: 5 }),
    ];
    mockExportDailySummary.mockResolvedValue(rows);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => {
      expect(screen.getByText((t) => t.includes('Rp'))).toBeTruthy();
    });

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
  });

  it('shows zero values when no rows returned', async () => {
    mockExportDailySummary.mockResolvedValue([]);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => {
      expect(screen.getByText((t) => /^\$/.test(t))).toBeTruthy();
    });

    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to USD when currency is empty string', async () => {
    mockExportDailySummary.mockResolvedValue([createRow({ total_minor: 5000, currency: '' })]);
    const { container } = renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => {
      expect(container.querySelector('.reporting-widget-kpi-value--primary')?.textContent)
        .toMatch(/50,00/);
    });
  });

  it('handles API error gracefully', async () => {
    mockExportDailySummary.mockRejectedValue(new Error('API error'));
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => {
      expect(screen.getByText((t) => /^\$/.test(t))).toBeTruthy();
    });
  });

  it('sets aria-label on the widget', async () => {
    mockExportDailySummary.mockResolvedValue([]);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    const widget = await screen.findByLabelText('Daily sales summary');
    expect(widget).toBeTruthy();
  });

  // ── C2.2: Free-tier gate — blurred teaser + upgrade CTA ────────

  it('shows blurred teaser with upgrade CTA for Free tier (C2.2)', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'free', supportsDailyDashboard: false }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    // TierLockedFeature renders the title and CTA
    expect(screen.getByText('Daily Sales Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to plus/i })).toBeInTheDocument();

    // Preview content should be rendered but hidden (aria-hidden)
    const preview = document.querySelector('.tier-locked-preview');
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders full widget for Plus tier with supportsDailyDashboard (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'plus', supportsDailyDashboard: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    mockExportDailySummary.mockResolvedValue([
      { sale_id: 's-1', total_minor: 100000, currency: 'IDR', line_count: 15, status: 'completed', created_at: '2026-07-16T10:00:00Z' } as DailySummaryRow,
    ]);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => {
      // The widget header renders via <Localized id="sales-dashboard-daily-total">
      expect(screen.getByRole('heading', { name: /daily total/i })).toBeInTheDocument();
    });
    // Should NOT show the locked feature overlay
    expect(screen.queryByRole('button', { name: /upgrade to plus/i })).not.toBeInTheDocument();
  });

  it('shows skeleton while caps are loading (C2.2)', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: null,
      loading: true,
      refresh: vi.fn(),
    });
    mockExportDailySummary.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    // Should show loading skeleton, not the locked feature
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Daily Sales Dashboard')).not.toBeInTheDocument();
  });

  // ── access: owned by the registration + the host, not by this component ──

  it('is registered with requiredPermission reports:export', () => {
    clearWidgets();
    registerSalesWidgets();
    const tile = getWidgets(undefined, MANAGER).find((w) => w.id === 'daily-total');
    expect(tile?.requiredPermission).toBe('reports:export');
  });

  it('is refused to a Staff session and reported as denied, not removed', () => {
    clearWidgets();
    registerSalesWidgets();
    const visible = getWidgets(new Set(['simple-retail']), STAFF).map((w) => w.id);
    const refused = getDeniedWidgets(new Set(['simple-retail']), STAFF).map((w) => w.id);
    expect(visible).not.toContain('daily-total');
    // The slot survives as a denial (SalesDashboardScreen renders this list);
    // a Staff user never sees an empty hole where the tile was.
    expect(refused).toContain('daily-total');
  });

  it('is mounted for the reports:* and "*" wildcards, not only the exact key', () => {
    clearWidgets();
    registerSalesWidgets();
    for (const permissions of [['reports:*'], ['*'], ['reports:export']]) {
      expect(
        getWidgets(new Set(['simple-retail']), { userRole: 'Owner', permissions })
          .map((w) => w.id),
      ).toContain('daily-total');
    }
  });
});
