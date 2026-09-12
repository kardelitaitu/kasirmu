import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import DailyTotalWidget from '@/features/sales/widgets/DailyTotalWidget';
import salesFtl from '@/locales/sales.ftl?raw';
import type { DailySummaryRow } from '@/api/sales';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';

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

// ── auth ─────────────────────────────────────────────────────────────
// Same pattern PermissionDenied.test.tsx uses: the widget asks the session
// whether it holds reports:export before it calls the export command.
const mockSession = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: mockSession() }),
}));

/** A role that holds the key the scoped command enforces. */
const EXPORT_GRANTED = ['sales:view', 'reports:export'];
/** The Staff preset: sales:view, no reports:export (rbac_presets.rs). */
const STAFF_NO_EXPORT = ['sales:view'];

beforeEach(() => {
  mockExportDailySummary.mockReset();
  mockSession.mockReturnValue({ permissions: EXPORT_GRANTED });
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

  // ── F-017 permission gate ──────────────────────────────────────

  it('refuses without reports:export and never calls the command', () => {
    mockSession.mockReturnValue({ permissions: STAFF_NO_EXPORT });
    const { container } = renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    // A visible denied affordance in the tile slot — not a missing tile.
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(container.querySelector('.reporting-widget')).toBeInTheDocument();
    expect(container.querySelector('.reporting-widget-title')).toBeInTheDocument();
    // And the command is never called, so there is no spinner and no refusal log.
    expect(mockExportDailySummary).not.toHaveBeenCalled();
  });

  it('names the missing permission in the refusal', () => {
    mockSession.mockReturnValue({ permissions: STAFF_NO_EXPORT });
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    expect(screen.getByText(/required permission: reports:export/i)).toBeInTheDocument();
  });

  it('refuses on an empty grant list and on no session', () => {
    mockSession.mockReturnValue({ permissions: [] });
    const { unmount } = renderWithFluentSync(<DailyTotalWidget />, salesFtl);
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(mockExportDailySummary).not.toHaveBeenCalled();
    unmount();

    mockSession.mockReturnValue(null);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(mockExportDailySummary).not.toHaveBeenCalled();
  });

  it('accepts the reports:* domain wildcard, not only the exact key', async () => {
    mockSession.mockReturnValue({ permissions: ['reports:*'] });
    mockExportDailySummary.mockResolvedValue([]);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => expect(mockExportDailySummary).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /access denied/i })).not.toBeInTheDocument();
  });

  it('accepts the Owner "*" wildcard', async () => {
    mockSession.mockReturnValue({ permissions: ['*'] });
    mockExportDailySummary.mockResolvedValue([]);
    renderWithFluentSync(<DailyTotalWidget />, salesFtl);

    await waitFor(() => expect(mockExportDailySummary).toHaveBeenCalled());
  });
});
