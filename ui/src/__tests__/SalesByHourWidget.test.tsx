import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import SalesByHourWidget from '@/features/sales/widgets/SalesByHourWidget';
import salesFtl from '@/locales/sales.ftl?raw';
import type { SalesByHourRow } from '@/api/sales';

const mockExportSalesByHour = vi.fn();

vi.mock('@/api/sales', () => ({
  exportDailySummary: vi.fn(),
  exportDailySummaryScoped: vi.fn(),
  exportSalesByHour: (...args: unknown[]) => mockExportSalesByHour(...args),
  exportSalesByHourScoped: (...args: unknown[]) => mockExportSalesByHour(...args),
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
  mockExportSalesByHour.mockReset();
  mockSession.mockReturnValue({ permissions: EXPORT_GRANTED });
});

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    hour: 0,
    total_minor: 0,
    currency: 'USD',
    sale_count: 0,
    ...overrides,
  } as SalesByHourRow;
}

describe('SalesByHourWidget', () => {
  it('shows loading skeleton initially', () => {
    mockExportSalesByHour.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(8);
  });

  it('renders hourly bars after loading', async () => {
    const rows = [createRow({ hour: 9, total_minor: 120000, sale_count: 4 })];
    mockExportSalesByHour.mockResolvedValue(rows);
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    const item = await screen.findByRole('listitem');
    expect(item).toBeTruthy();
    expect(item.getAttribute('aria-label')).toContain('09:00');
    expect(item.getAttribute('aria-label')).toContain('1.200,00');
    expect(item.getAttribute('aria-label')).toContain('4 sales');
  });

  it('shows empty state when no data', async () => {
    mockExportSalesByHour.mockResolvedValue([]);
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    await waitFor(() => {
      expect(screen.getByText('No data for today')).toBeTruthy();
    });
  });

  it('handles API error gracefully', async () => {
    mockExportSalesByHour.mockRejectedValue(new Error('API error'));
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    await waitFor(() => {
      expect(screen.getByText('No data for today')).toBeTruthy();
    });
  });

  it('scales bar widths relative to peak', async () => {
    const rows = [
      createRow({ hour: 10, total_minor: 50000, sale_count: 2 }),
      createRow({ hour: 11, total_minor: 100000, sale_count: 5 }),
    ];
    mockExportSalesByHour.mockResolvedValue(rows);
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    const bars = await screen.findAllByRole('listitem');
    expect(bars).toHaveLength(2);
  });

  it('applies aria-label to the chart list', async () => {
    mockExportSalesByHour.mockResolvedValue([]);
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(list.getAttribute('aria-label')).toBe('Hourly sales bars');
    });
  });

  // ── F-017 permission gate ──────────────────────────────────────

  it('refuses without reports:export and never calls the command', () => {
    mockSession.mockReturnValue({ permissions: STAFF_NO_EXPORT });
    const { container } = renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    // A visible denied affordance in the tile slot — not a missing tile.
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(container.querySelector('.reporting-widget')).toBeInTheDocument();
    expect(container.querySelector('.reporting-widget-title')).toBeInTheDocument();
    expect(screen.getByText(/required permission: reports:export/i)).toBeInTheDocument();
    // And the command is never called, so there is no spinner and no refusal log.
    expect(mockExportSalesByHour).not.toHaveBeenCalled();
  });

  it('accepts the reports:* domain wildcard instead of demanding the exact key', async () => {
    mockSession.mockReturnValue({ permissions: ['reports:*'] });
    mockExportSalesByHour.mockResolvedValue([]);
    renderWithFluentSync(<SalesByHourWidget />, salesFtl);

    await waitFor(() => expect(mockExportSalesByHour).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /access denied/i })).not.toBeInTheDocument();
  });
});
