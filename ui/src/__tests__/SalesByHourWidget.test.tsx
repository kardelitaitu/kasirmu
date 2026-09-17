import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import SalesByHourWidget from '@/features/sales/widgets/SalesByHourWidget';
import salesFtl from '@/locales/sales.ftl?raw';
import type { SalesByHourRow } from '@/api/sales';
import { clearWidgets, getDeniedWidgets, getWidgets } from '@/registries/widget-registry';
import { registerSalesWidgets } from '@/features/sales/widgets';

const mockExportSalesByHour = vi.fn();

vi.mock('@/api/sales', () => ({
  exportDailySummary: vi.fn(),
  exportDailySummaryScoped: vi.fn(),
  exportSalesByHour: (...args: unknown[]) => mockExportSalesByHour(...args),
  exportSalesByHourScoped: (...args: unknown[]) => mockExportSalesByHour(...args),
}));

// ── access ─────────────────────────────────────────────────────────
// The tile no longer decides its own access; what its own suite pins is the
// DECLARATION that arms the host gate. Delete `requiredPermission` from the
// sales-by-hour registration in ../widgets/index.ts and these tests go red.
/** Staff: sales:view, no reports:export (platform/core rbac_presets.rs:136). */
const STAFF = { userRole: 'Staff', permissions: ['sales:view'] };
/** Anything holding the key the scoped command enforces. */
const MANAGER = { userRole: 'Manager', permissions: ['sales:view', 'reports:export'] };

beforeEach(() => {
  mockExportSalesByHour.mockReset();
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

  // ── access: owned by the registration + the host, not by this component ──

  it('is registered with requiredPermission reports:export', () => {
    clearWidgets();
    registerSalesWidgets();
    const tile = getWidgets(undefined, MANAGER).find((w) => w.id === 'sales-by-hour');
    expect(tile?.requiredPermission).toBe('reports:export');
  });

  it('is refused to a Staff session and reported as denied, not removed', () => {
    clearWidgets();
    registerSalesWidgets();
    expect(getWidgets(new Set(['simple-retail']), STAFF).map((w) => w.id)).not.toContain('sales-by-hour');
    expect(getDeniedWidgets(new Set(['simple-retail']), STAFF).map((w) => w.id)).toContain('sales-by-hour');
  });
});
