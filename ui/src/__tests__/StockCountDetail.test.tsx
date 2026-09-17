import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import stockCountingFtl from '@/locales/stock-counting.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// Shared mock instances for ADR #7 scoped-API pattern. Each pair below
// (legacy `getStockCount` + scoped `getStockCountScoped`, etc.) delegates
// to the same vi.fn() instance so a single `mockGetStockCount.mockResolvedValue(...)`
// call drives both the unscoped and scoped call sites.
//
// Write-side APIs (addCountLine, updateCountLine, removeCountLine and
// their scoped siblings) default to resolving with an empty object so
// the component's await returns cleanly without per-test setup.
const {
  mockGetStockCount,
  mockComplete,
  mockUpdateStatus,
  mockGetLines,
  mockAddCountLine,
  mockUpdateCountLine,
  mockRemoveCountLine,
  mockListProducts,
} = vi.hoisted(() => ({
  mockGetStockCount: vi.fn(),
  mockComplete: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockGetLines: vi.fn(),
  mockAddCountLine: vi.fn(),
  mockUpdateCountLine: vi.fn(),
  mockRemoveCountLine: vi.fn(),
  mockListProducts: vi.fn(),
}));

// getCountLines is dynamically imported — vi.fn() inside factory avoids hoisting issues.
vi.mock('@/api/inventoryCounts', () => ({
  getStockCount: () => mockGetStockCount(),
  getStockCountScoped: () => mockGetStockCount(),
  addCountLine: () => mockAddCountLine(),
  addCountLineScoped: () => mockAddCountLine(),
  updateCountLine: () => mockUpdateCountLine(),
  updateCountLineScoped: () => mockUpdateCountLine(),
  removeCountLine: () => mockRemoveCountLine(),
  removeCountLineScoped: () => mockRemoveCountLine(),
  completeStockCount: (...args: unknown[]) => mockComplete(...args),
  completeStockCountScoped: (...args: unknown[]) => mockComplete(...args),
  updateStockCountStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  updateStockCountStatusScoped: (...args: unknown[]) => mockUpdateStatus(...args),
  getCountLines: () => mockGetLines(),
  getCountLinesScoped: () => mockGetLines(),
}));

// Default mock implementations: read paths return empty arrays / null,
// write paths return empty objects. Tests override per-test as needed.
beforeEach(() => {
  mockGetStockCount.mockResolvedValue(null);
  mockGetLines.mockResolvedValue([]);
  mockComplete.mockResolvedValue(undefined);
  mockUpdateStatus.mockResolvedValue(undefined);
  mockAddCountLine.mockResolvedValue({});
  mockUpdateCountLine.mockResolvedValue({});
  mockRemoveCountLine.mockResolvedValue(undefined);
  mockListProducts.mockResolvedValue([]);
});

// listProducts lives in @/api/products; mock it there so the
// StockCountDetail component can call it without hitting the Tauri backend.
vi.mock('@/api/products', () => ({
  listProducts: () => mockListProducts(),
  listProductsScoped: () => mockListProducts(),
}));

import StockCountDetail from '@/features/inventory/StockCountDetail';



const sampleCount = {
  id: 'sc-1', count_number: 'SC-001', status: 'draft' as const,
  count_type: 'full' as const, notes: 'Monthly inventory',
  counted_by: 'user-1', created_at: '2026-07-01', completed_at: null,
  updated_at: '2026-07-01',
};

const sampleLines = [
  { id: 'line-1', count_id: 'sc-1', sku: 'SKU-001', product_name: 'Widget', expected_qty: 100, counted_qty: null as number | null, difference: 0, notes: '' },
  { id: 'line-2', count_id: 'sc-1', sku: 'SKU-002', product_name: 'Gadget', expected_qty: 50, counted_qty: 48, difference: -2, notes: '' },
  { id: 'line-3', count_id: 'sc-1', sku: 'SKU-003', product_name: 'Thing', expected_qty: 25, counted_qty: 30, difference: 5, notes: '' },
];

describe('StockCountDetail', () => {
  beforeEach(() => {
    mockListProducts.mockResolvedValue([]);
    mockGetLines.mockResolvedValue([]);
  });

  // ── Loading / not found ──────────────────────────────────────
  it('shows loading skeleton initially', async () => {
    mockGetStockCount.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);
    const skeleton = container.querySelector('[aria-hidden="true"].sc-detail-screen');
    expect(skeleton).toBeInTheDocument();
    // Verify old loading text is not present
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows not found when count is null', async () => {
    mockGetStockCount.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/count not found/i)).toBeInTheDocument();
    });
  });

  // ── Basic rendering ──────────────────────────────────────────
  it('renders count number and meta info', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByText('Monthly inventory')).toBeInTheDocument();
  });

  it('shows Back button and calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    mockGetStockCount.mockResolvedValue(sampleCount);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={onBack} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ── Lines table ──────────────────────────────────────────────
  it('shows empty lines message when no lines exist', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    // FTL key sc-no-lines = "No lines in this count. Add products above."
    expect(screen.getByText(/no lines in this count/i)).toBeInTheDocument();
  });

  it('renders lines table with expected, counted, diff columns', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    // 48 is rendered as an input value (draft mode editable) — use getByDisplayValue.
    expect(screen.getByDisplayValue('48')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
  });

  it('shows positive diff with + prefix', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue([sampleLines[2]!]);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      // +5 appears in both the line row and the total row.
    const plusFive = screen.getAllByText('+5');
    expect(plusFive.length).toBe(2);
    });
  });

  it('shows negative diff without +', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue([sampleLines[1]!]);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      const minusTwo = screen.getAllByText('-2');
    expect(minusTwo.length).toBe(2);
    });
  });

  it('shows total row with sums', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('175')).toBeInTheDocument();
      expect(screen.getByText('78')).toBeInTheDocument();
      expect(screen.getByText('+3')).toBeInTheDocument();
    });
  });

  // ── Actions ──────────────────────────────────────────────────
  it('shows Start Counting button for draft counts', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /start counting/i })).toBeInTheDocument();
  });

  it('calls updateStockCountStatus when Start Counting is clicked', async () => {
    const user = userEvent.setup();
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockUpdateStatus.mockResolvedValue(undefined);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /start counting/i }));
    await waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith('mock-session-token', 'sc-1', 'in_progress');
    });
  });

  it('shows Complete Count button when editable and has lines', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete count/i })).toBeInTheDocument();
    });
  });

  it('calls completeStockCount and shows success message', async () => {
    const user = userEvent.setup();
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    mockComplete.mockResolvedValue([{ id: 'adj-1' }, { id: 'adj-2' }]);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete count/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /complete count/i }));
    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledWith('mock-session-token', { countId: 'sc-1' });
      expect(screen.getByText(/count completed/i)).toBeInTheDocument();
    });
  });

  it('shows error when completeStockCount fails', async () => {
    const user = userEvent.setup();
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    mockComplete.mockRejectedValue(new Error('Network failure'));
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete count/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /complete count/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to complete count');
    });
  });

  // ── Remove line ──────────────────────────────────────────────
  it('shows remove × button on each line when editable', async () => {
    mockGetStockCount.mockResolvedValue(sampleCount);
    mockGetLines.mockResolvedValue(sampleLines);
    renderWithFluentSync(<ToastProvider><StockCountDetail countId="sc-1" onBack={vi.fn()} /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(2);
  });
});
