import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/Toast';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import InventoryReportScreen from '@/features/reports/InventoryReportScreen';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

// ── shared.ftl keys used by this component ─────────────────────────────
const sharedFtl = `
print = Print
`;

// ── inventory.ftl keys used by this component ──────────────────────────
const inventoryFtl = `
inv-report-title = Inventory Report
inv-report-threshold = Threshold
inv-report-export-csv = Export CSV
inv-report-sku = SKU
inv-report-product = Product
inv-report-current-stock = Stock
inv-report-loading-aria = Loading inventory report
inv-report-region-aria = Inventory Report
inv-report-threshold-aria = Low stock threshold
inv-report-print-aria = Print report
inv-report-export-aria = Export to CSV
inv-report-csv-header-sku = SKU
inv-report-csv-header-product = Product
inv-report-csv-header-stock = Current Stock
inv-report-csv-header-threshold = Threshold
inv-report-csv-header-unit-price = Unit Price
inv-report-csv-header-unit-cost = Unit Cost
inv-report-csv-header-unit-margin = Unit Margin
inv-report-csv-header-margin = Margin
inv-report-csv-header-stock-value = Stock Value
inv-report-no-results = No results found
inventory-report-error-load = Failed to load the inventory report. Please try again.
`;

// ── mock API functions ─────────────────────────────────────────────────
const mockGetLowStockAlerts = vi.fn();
const mockPrintSalesReceipt = vi.fn();

vi.mock('@/api/reports', () => ({
  getLowStockAlerts: (...args: unknown[]) => mockGetLowStockAlerts(...args),
}));

vi.mock('@/api/sales', () => ({
  printSalesReceipt: (...args: unknown[]) => mockPrintSalesReceipt(...args),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, className, shadow }: Record<string, unknown>) => (
    <div className={className as string} data-shadow={shadow as string}>{children as React.ReactNode}</div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({ children, onClick, variant, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      className={`btn btn--${variant as string || 'primary'}`}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/features/reports/InventoryReportScreen.css', () => ({}));

// ── helpers ────────────────────────────────────────────────────────────
const bundle = new FluentBundle('en');
bundle.addResource(new FluentResource(sharedFtl));
bundle.addResource(new FluentResource(inventoryFtl));
const l10n = new ReactLocalization([bundle]);

function buildSampleAlert(overrides: Partial<{
  product_id: string;
  sku: string;
  name: string;
  current_qty: number;
  threshold: number;
  currency: string;
  price_minor: number;
  cost_minor: number;
}> = {}) {
  return {
    product_id: overrides.product_id ?? 'prod-1',
    sku: overrides.sku ?? 'SKU001',
    name: overrides.name ?? 'Test Product',
    current_qty: overrides.current_qty ?? 5,
    threshold: overrides.threshold ?? 10,
    currency: overrides.currency ?? 'USD',
    price_minor: overrides.price_minor ?? 1500,
    cost_minor: overrides.cost_minor ?? 900,
  };
}

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      {/* The report's print button now reports a failed print through the toast
          context, so the screen has to render under a ToastProvider. */}
      <ToastProvider>
        <InventoryReportScreen />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────
describe('InventoryReportScreen', () => {
  beforeEach(() => {
    // Default: never resolves (loading state)
    mockGetLowStockAlerts.mockImplementation(() => new Promise(() => {}));
    mockPrintSalesReceipt.mockResolvedValue(undefined);
  });

  // ── Loading state ──────────────────────────────────────────────────
  it('shows loading skeleton initially', () => {
    renderScreen();
    const skeleton = document.querySelector('.inventory-report-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  // ── Error state ────────────────────────────────────────────────────
  it('shows the localized error and never the raw rejection', async () => {
    mockGetLowStockAlerts.mockRejectedValue(new Error('Network error'));
    renderScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Failed to load the inventory report. Please try again.'),
      ).toBeTruthy();
    });
    expect(screen.queryByText('Network error')).toBeNull();
  });

  // The error banner and the empty state used to render TOGETHER: the catch set
  // `error` but left `items` at [], so a failed read printed "No results found"
  // right under the banner — one element saying it broke, another saying the
  // answer is zero. And nothing ever cleared `error`, so the banner outlived a
  // later successful read.
  it('does not claim "No results found" when the read failed', async () => {
    mockGetLowStockAlerts.mockRejectedValue(new Error('Network error'));
    renderScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Failed to load the inventory report. Please try again.'),
      ).toBeTruthy();
    });
    expect(screen.queryByText('No results found')).toBeNull();
  });

  // `error` was never cleared, so one failed read stuck the banner on the report
  // for the rest of the mount — even after the threshold changed and the next
  // read succeeded. Drive a REAL re-read through the threshold input; a fresh
  // mount would reset the state and prove nothing.
  it('clears the error once a later read succeeds', async () => {
    // The describe-level beforeEach installs a never-resolving default, so the
    // once/rejected pair below has to REPLACE that implementation, not queue
    // behind it -- otherwise the first read never settles at all.
    mockGetLowStockAlerts.mockReset();
    mockGetLowStockAlerts.mockRejectedValueOnce(new Error('Network error'));
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.inventory-report-error')).not.toBeNull();
    });

    fireEvent.change(document.getElementById('threshold-input') as HTMLInputElement, {
      target: { value: '5' },
    });

    // The re-read must SETTLE before the assertion below is meaningful — a bare
    // waitFor here once passed before the first read had even resolved.
    await waitFor(() => {
      expect(mockGetLowStockAlerts).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      // The re-read happened and succeeded, so the banner must be gone.
      expect(mockGetLowStockAlerts).toHaveBeenCalledTimes(2);
      expect(document.querySelector('.inventory-report-error')).toBeNull();
    });
  });

  // ── Empty state ────────────────────────────────────────────────────
  it('shows "No results found" when no items', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeTruthy();
    });
  });

  // ── Title & headers ────────────────────────────────────────────────
  it('renders the title "Inventory Report"', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Inventory Report')).toBeTruthy();
    });
  });

  it('renders table headers: SKU, Product, Stock', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('SKU')).toBeTruthy();
      expect(screen.getByText('Product')).toBeTruthy();
      expect(screen.getByText('Stock')).toBeTruthy();
    });
  });

  // ── Data rows ──────────────────────────────────────────────────────
  it('renders rows with SKU, name, and quantity', async () => {
    const alerts = [
      buildSampleAlert({ product_id: 'p1', sku: 'SKU-001', name: 'Widget', current_qty: 5 }),
      buildSampleAlert({ product_id: 'p2', sku: 'SKU-002', name: 'Gadget', current_qty: 3 }),
    ];
    mockGetLowStockAlerts.mockResolvedValue(alerts);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('SKU-001')).toBeTruthy();
      expect(screen.getByText('Widget')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
      expect(screen.getByText('SKU-002')).toBeTruthy();
      expect(screen.getByText('Gadget')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
    });
  });

  it('applies "critical" CSS class when quantity is 0', async () => {
    const alerts = [buildSampleAlert({ product_id: 'p1', current_qty: 0 })];
    mockGetLowStockAlerts.mockResolvedValue(alerts);
    renderScreen();
    await waitFor(() => {
      const row = document.querySelector('.inventory-report-row');
      expect(row).toBeTruthy();
      expect(row!.className).toContain('critical');
      const qtySpan = document.querySelector('.inventory-report-qty');
      expect(qtySpan!.className).toContain('critical');
    });
  });

  it('applies "low" CSS class when quantity > 0 but <= threshold', async () => {
    const alerts = [buildSampleAlert({ product_id: 'p1', current_qty: 3, threshold: 10 })];
    mockGetLowStockAlerts.mockResolvedValue(alerts);
    renderScreen();
    await waitFor(() => {
      const row = document.querySelector('.inventory-report-row');
      expect(row!.className).toContain('low');
      const qtySpan = document.querySelector('.inventory-report-qty');
      expect(qtySpan!.className).toContain('low');
    });
  });

  it('applies no special class when quantity > threshold', async () => {
    const alerts = [buildSampleAlert({ product_id: 'p1', current_qty: 15, threshold: 10 })];
    mockGetLowStockAlerts.mockResolvedValue(alerts);
    renderScreen();
    await waitFor(() => {
      const row = document.querySelector('.inventory-report-row');
      expect(row!.className).not.toContain('critical');
      expect(row!.className).not.toContain('low');
    });
  });

  // ── Threshold ──────────────────────────────────────────────────────
  it('renders threshold input with default value 10', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const input = screen.getByLabelText('Low stock threshold') as HTMLInputElement;
      expect(input.value).toBe('10');
    });
  });

  it('refetches when threshold changes', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(mockGetLowStockAlerts).toHaveBeenCalledWith(10, HARNESS_SESSION_TOKEN);
    });
    mockGetLowStockAlerts.mockClear();

    const input = screen.getByLabelText('Low stock threshold') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });

    await waitFor(() => {
      expect(mockGetLowStockAlerts).toHaveBeenCalledWith(5, HARNESS_SESSION_TOKEN);
    });
  });

  // ── Print & CSV ────────────────────────────────────────────────────
  it('renders Print button and calls printSalesReceipt on click', async () => {
    mockGetLowStockAlerts.mockResolvedValue([buildSampleAlert()]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Print')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => {
      expect(mockPrintSalesReceipt).toHaveBeenCalledTimes(1);
    });
  });

  it('renders Export CSV button and triggers CSV download on click', async () => {
    mockGetLowStockAlerts.mockResolvedValue([buildSampleAlert()]);
    // jsdom may or may not provide these — always stub them
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Export CSV'));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    createElementSpy.mockRestore();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });

  it('exports cost, margin, and stock-value columns in the CSV', async () => {
    mockGetLowStockAlerts.mockResolvedValue([
      buildSampleAlert({ sku: 'SKU001', name: 'Widget', current_qty: 5, price_minor: 1500, cost_minor: 900 }),
    ]);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderScreen();
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeTruthy());
    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const blob = createUrl.mock.calls[0]![0] as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    // Header line is unquoted; data cells containing special chars are quoted per RFC 4180.
    expect(text).toContain('Threshold,Unit Price,Unit Cost,Unit Margin,Margin,Stock Value');
    // Price $15.00, cost $9.00, unit margin $6.00, margin 40.0%, stock value $45.00
    // (id-ID locale renders decimals with commas: "$ 15,00").
    // Fields with commas (currency values) are quoted; Margin (40.0%) has no special chars, so unquoted.
    expect(text).toContain('"$ 15,00"');
    expect(text).toContain('"$ 9,00"');
    expect(text).toContain('"$ 6,00"');
    expect(text).toContain('40.0%'); // unquoted - no comma/quote/newline
    expect(text).toContain('"$ 45,00"');
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    clickSpy.mockRestore();
  });

  // ── ARIA ───────────────────────────────────────────────────────────
  it('has role="region" with aria-label on the container', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const region = screen.getByRole('region', { name: 'Inventory Report' });
      expect(region).toBeTruthy();
    });
  });

  it('renders the threshold label', async () => {
    mockGetLowStockAlerts.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Threshold')).toBeTruthy();
    });
  });
});
