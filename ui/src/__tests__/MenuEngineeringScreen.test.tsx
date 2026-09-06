import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalizationProvider } from '@fluent/react';
import { createEnUsLocalization } from '@/locales';
import MenuEngineeringScreen from '@/features/reports/MenuEngineeringScreen';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import * as reportsApi from '@/api/reports';
import type { MenuEngineeringResult } from '@/api/reports';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from '@/__tests__/test-utils/storeZoneCase';

// ── Mocks ─────────────────────────────────────────────────

// Mock recharts entirely to prevent its internal dependency on
// @reduxjs/toolkit (pure ESM) from crashing the vmThreads pool.
// The component's chart section still renders; recharts output
// is never directly asserted by any test.
vi.mock('recharts', () => ({
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
  ReferenceArea: () => null,
}));

vi.mock('@/api/reports', () => ({
  getMenuEngineering: vi.fn(),
}));

// R36-06: the screen now fetches the primary store to anchor its default
// window. Unmocked, that call rejects and is swallowed, leaving the store-zone
// path untested while the suite stays green.
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

// The screen renders money via the store default currency.
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', setCurrency: vi.fn(), loading: false }),
}));

const mockResult: MenuEngineeringResult = {
  median_volume: 50,
  median_margin: 2500,
  rows: [
    {
      product_id: 'p1',
      sku: 'STEAK',
      name: 'Ribeye Steak',
      total_volume: 100,
      unit_price_minor: 2500,
      unit_cost_minor: 800,
      margin_per_unit: 1700,
      total_margin_minor: 170000,
      total_revenue_minor: 250000,
    },
    {
      product_id: 'p2',
      sku: 'SALAD',
      name: 'Caesar Salad',
      total_volume: 80,
      unit_price_minor: 1200,
      unit_cost_minor: 400,
      margin_per_unit: 800,
      total_margin_minor: 64000,
      total_revenue_minor: 96000,
    },
    {
      product_id: 'p3',
      sku: 'SODA',
      name: 'Cola',
      total_volume: 200,
      unit_price_minor: 300,
      unit_cost_minor: 100,
      margin_per_unit: 200,
      total_margin_minor: 40000,
      total_revenue_minor: 60000,
    },
    {
      product_id: 'p4',
      sku: 'COFFEE',
      name: 'Specialty Coffee',
      total_volume: 30,
      unit_price_minor: 500,
      unit_cost_minor: 150,
      margin_per_unit: 350,
      total_margin_minor: 10500,
      total_revenue_minor: 15000,
    },
  ],
};

function renderWithLocales(ui: React.ReactElement) {
  const l10n = createEnUsLocalization();
  return render(
    <LocalizationProvider l10n={l10n}>
      {ui}
    </LocalizationProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────

describe('MenuEngineeringScreen', () => {
  beforeEach(() => {
    vi.mocked(reportsApi.getMenuEngineering).mockResolvedValue(mockResult);
    // No timezone -> the UTC fallback, so pre-existing assertions hold.
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: null });
  });

  
  it('anchors the default window to the primary store timezone (R36-06)', async () => {
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 0));
      expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 30));
    });
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });

  it('does not clobber a window the operator already edited (R36-06)', async () => {
    const zone = discriminatingStoreZone();
    // Hold the store response open so the edit provably happens BEFORE it
    // arrives -- the real "slow IPC" scenario. Resolving it eagerly races: the
    // re-seed changes startDate, the fetch effect refires, and `loading`
    // unmounts the inputs out from under the assertion.
    let resolveStore: (v: unknown) => void = () => {};
    mockGetPrimaryLocationScoped.mockReturnValue(
      new Promise((r) => { resolveStore = r; }),
    );

    renderWithLocales(<MenuEngineeringScreen />);
    await waitFor(() => expect(screen.getByLabelText('Start date')).toBeTruthy());

    const startInput = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-01-05' } });

    resolveStore({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    await waitFor(() => expect(mockGetPrimaryLocationScoped).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    // The screen may be mid-refetch; wait for the inputs to come back, then
    // confirm the operator's date survived the store profile arriving.
    await waitFor(() => {
      const input = screen.getByLabelText('Start date') as HTMLInputElement;
      expect(input.value).toBe('2026-01-05');
    });
  });

  it('shows loading spinner initially', () => {
    vi.mocked(reportsApi.getMenuEngineering).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    renderWithLocales(<MenuEngineeringScreen />);

    expect(screen.getByRole('region', { name: /Menu Engineering Report/ })).toBeTruthy();
  });

  it('renders KPI cards with correct values after loading', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    // Wait for product count KPI to appear
    await waitFor(() => {
      const productLabels = screen.getAllByText('Products');
      expect(productLabels.length).toBeGreaterThanOrEqual(1);
    });

    // Total revenue = 250000 + 96000 + 60000 + 15000 = 421000
    await waitFor(() => {
      expect(screen.getByText('$4,210.00')).toBeTruthy();
    });
  });

  it('renders quadrant summary cards for all 4 quadrants', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const stars = screen.getAllByText('Star');
      expect(stars.length).toBeGreaterThanOrEqual(1);
    });

    const plowhorses = screen.getAllByText('Plowhorse');
    expect(plowhorses.length).toBeGreaterThanOrEqual(1);

    const puzzles = screen.getAllByText('Puzzle');
    expect(puzzles.length).toBeGreaterThanOrEqual(1);

    const dogs = screen.getAllByText('Dog');
    expect(dogs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders product data table with row data', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Ribeye Steak')).toBeTruthy();
    });

    expect(screen.getByText('Caesar Salad')).toBeTruthy();
    expect(screen.getByText('Cola')).toBeTruthy();
    expect(screen.getByText('Specialty Coffee')).toBeTruthy();
  });

  it('renders quadrant badge for each row', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const stars = screen.getAllByText(/Star/);
      expect(stars.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls getMenuEngineering with default date range', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(reportsApi.getMenuEngineering).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        HARNESS_SESSION_TOKEN,
      );
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(reportsApi.getMenuEngineering).mockRejectedValue(
      new Error('Network error'),
    );

    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeTruthy();
    });
  });

  it('shows empty state when no data returned', async () => {
    vi.mocked(reportsApi.getMenuEngineering).mockResolvedValue({
      median_volume: 0,
      median_margin: 0,
      rows: [],
    });

    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText(/No results/)).toBeTruthy();
    });
  });

  it('classifies quadrants correctly', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const stars = screen.getAllByText(/Star/);
      expect(stars.length).toBeGreaterThanOrEqual(1);
    });

    // COFFEE has low volume (30 < 50) and high margin (10500 >= 2500) -> Puzzle
    const puzzles = screen.getAllByText(/Puzzle/);
    expect(puzzles.length).toBeGreaterThanOrEqual(1);
  });

  it('renders date range inputs', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText('Start date')).toBeTruthy();
    });

    expect(screen.getByLabelText('End date')).toBeTruthy();
  });

  it('renders margin rate KPI when revenue > 0', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    // Total margin = 170000 + 64000 + 40000 + 10500 = 284500
    // Total revenue = 250000 + 96000 + 60000 + 15000 = 421000
    // Margin rate = 284500 / 421000 * 100 ~= 67.6%
    await waitFor(() => {
      expect(screen.getByText(/67\.6%/)).toBeTruthy();
    });
  });

  it('recommendation text appears for Star quadrant', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const recs = screen.getAllByText(/Promote Star/);
      expect(recs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Title ──────────────────────────────────────────────
  it('renders Menu Engineering title', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Menu Engineering')).toBeTruthy();
    });
  });

  // ── All four quadrant recommendations ───────────────────
  it('renders Plowhorse recommendation text', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const recs = screen.getAllByText(/Increase Price on Plowhorse/);
      expect(recs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Puzzle recommendation text', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const recs = screen.getAllByText(/Reposition Puzzle/);
      expect(recs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Dog recommendation text', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const recs = screen.getAllByText(/Remove Dog/);
      expect(recs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Quadrant icons ─────────────────────────────────────
  it('renders all four quadrant icons (★ ▲ ◆ ▼)', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getAllByText('★').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('▲').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('◆').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('▼').length).toBeGreaterThanOrEqual(1);
  });

  // ── Scatter chart ──────────────────────────────────────
  it('renders scatter chart section title', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Volume vs. Margin Matrix')).toBeTruthy();
    });
  });

  it('renders scatter chart legend with quadrant descriptions', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Star.*high vol, high margin/)).toBeTruthy();
      expect(screen.getByText(/Plowhorse.*high vol, low margin/)).toBeTruthy();
      expect(screen.getByText(/Puzzle.*low vol, high margin/)).toBeTruthy();
      expect(screen.getByText(/Dog.*low vol, low margin/)).toBeTruthy();
    });
  });

  // ── Table hover state ──────────────────────────────────
  it('table row gets is-hovered class on mouseEnter', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Ribeye Steak')).toBeTruthy();
    });

    const row = screen.getByRole('row', { name: /Ribeye Steak: Star/ });
    expect(row.className).not.toContain('is-hovered');

    await userEvent.hover(row);
    expect(row.className).toContain('is-hovered');

    await userEvent.unhover(row);
    expect(row.className).not.toContain('is-hovered');
  });

  it('table row has keyboard tabIndex', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Ribeye Steak')).toBeTruthy();
    });

    const row = screen.getByRole('row', { name: /Ribeye Steak: Star/ });
    expect(row.getAttribute('tabIndex')).toBe('0');
  });

  // ── Table ARIA ─────────────────────────────────────────
  it('product table has role="table" with aria-label', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const table = screen.getByRole('table', { name: 'Menu engineering product breakdown' });
      expect(table).toBeTruthy();
    });
  });

  it('table has column headers for all 9 columns', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const headers = screen.getAllByRole('columnheader');
      expect(headers.length).toBe(9);
    });
  });

  it('table has role="cell" on data cells', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const cells = screen.getAllByRole('cell');
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  // ── Date filter refetch ────────────────────────────────
  it('re-fetches data when start date changes', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Menu Engineering')).toBeTruthy();
    });

    vi.mocked(reportsApi.getMenuEngineering).mockClear();

    const startInput = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-06-01' } });

    await waitFor(() => {
      expect(reportsApi.getMenuEngineering).toHaveBeenCalledWith('2026-06-01', expect.any(String), HARNESS_SESSION_TOKEN);
    });
  });

  it('re-fetches data when end date changes', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Menu Engineering')).toBeTruthy();
    });

    vi.mocked(reportsApi.getMenuEngineering).mockClear();

    const endInput = screen.getByLabelText('End date') as HTMLInputElement;
    // Use a date different from today() (computed at runtime so the test never
    // collides with the current date) to trigger a state change
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);
    fireEvent.change(endInput, { target: { value: yesterdayIso } });

    await waitFor(() => {
      expect(reportsApi.getMenuEngineering).toHaveBeenCalledWith(expect.any(String), yesterdayIso, HARNESS_SESSION_TOKEN);
    });
  });

  // ── Edge: zero revenue ─────────────────────────────────
  it('shows em-dash for margin rate when total revenue is zero', async () => {
    vi.mocked(reportsApi.getMenuEngineering).mockResolvedValue({
      median_volume: 0,
      median_margin: 0,
      rows: [
        {
          product_id: 'p0',
          sku: 'FREE',
          name: 'Free Item',
          total_volume: 10,
          unit_price_minor: 0,
          unit_cost_minor: 0,
          margin_per_unit: 0,
          total_margin_minor: 0,
          total_revenue_minor: 0,
        },
      ],
    });

    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Products/)).toBeTruthy();
    });

    // Margin rate should be "—"
    const kpiCards = document.querySelectorAll('.menu-eng-kpi');
    const marginRateCard = Array.from(kpiCards).find(
      (el) => el.textContent?.includes('Margin Rate'),
    );
    // The value should contain an em-dash
    expect(marginRateCard?.textContent).toMatch(/—/);
  });

  // ── KPI labels ─────────────────────────────────────────
  it('renders Products KPI label and count', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const productLabels = screen.getAllByText('Products');
      expect(productLabels.length).toBeGreaterThanOrEqual(1);
    });

    // 4 products in mockResult — appears in KPI and table row numbering, check at least one exists
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Total Revenue KPI label', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Total Revenue')).toBeTruthy();
    });
  });

  it('renders Total Margin KPI label', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Total Margin')).toBeTruthy();
    });
  });

  it('renders Margin Rate KPI label', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Margin Rate')).toBeTruthy();
    });
  });

  // ── Classification logic ───────────────────────────────
  it('classifies high-volume low-margin items as Plowhorse', async () => {
    // COLA: volume 200 >= 50 (high), margin 200 < 2500 (low) → Plowhorse
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      const plowhorses = screen.getAllByText(/Plowhorse/);
      expect(plowhorses.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Product Breakdown title ────────────────────────────
  it('renders Product Breakdown section title', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Product Breakdown')).toBeTruthy();
    });
  });

  // ── Table SKU column ───────────────────────────────────
  it('renders SKU values in product table', async () => {
    renderWithLocales(<MenuEngineeringScreen />);

    await waitFor(() => {
      expect(screen.getByText('STEAK')).toBeTruthy();
      expect(screen.getByText('SALAD')).toBeTruthy();
      expect(screen.getByText('SODA')).toBeTruthy();
      expect(screen.getByText('COFFEE')).toBeTruthy();
    });
  });
});
