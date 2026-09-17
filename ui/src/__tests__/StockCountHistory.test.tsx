import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import stockCountingFtl from '@/locales/stock-counting.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/inventoryCounts', () => ({
  listStockCounts: vi.fn(),
  listStockAdjustments: vi.fn(),
  getCountLines: vi.fn(),
}));

import StockCountHistory from '@/features/inventory/StockCountHistory';
import { listStockCounts, listStockAdjustments, getCountLines } from '@/api/inventoryCounts';

const mockListCounts = listStockCounts as ReturnType<typeof vi.fn>;
const mockListAdjustments = listStockAdjustments as ReturnType<typeof vi.fn>;
const mockGetLines = getCountLines as ReturnType<typeof vi.fn>;



const sampleCounts = [
  { id: 'sc-1', count_number: 'SC-001', status: 'completed' as const, count_type: 'full' as const,
    notes: '', counted_by: 'user-1', created_at: '2026-07-01', completed_at: '2026-07-01', updated_at: '2026-07-01' },
  { id: 'sc-2', count_number: 'SC-002', status: 'cancelled' as const, count_type: 'spot' as const,
    notes: 'Aborted', counted_by: 'user-1', created_at: '2026-06-15', completed_at: null, updated_at: '2026-06-20' },
];

const sampleLines = [
  { id: 'l1', count_id: 'sc-1', sku: 'SKU-001', product_name: 'Widget', expected_qty: 100, counted_qty: 98, difference: -2, notes: '' },
  { id: 'l2', count_id: 'sc-1', sku: 'SKU-002', product_name: 'Gadget', expected_qty: 50, counted_qty: 55, difference: 5, notes: '' },
];

const sampleAdjustments = [
  { id: 'adj-1', count_id: 'sc-1', sku: 'SKU-001', product_name: 'Widget', previous_qty: 100, adjusted_qty: 98, reason: 'Stock recount', created_by: 'user-1', created_at: '2026-07-01' },
];

describe('StockCountHistory', () => {
  // ── Loading / empty ──────────────────────────────────────────
  it('shows loading skeleton initially', async () => {
    mockListCounts.mockReturnValue(new Promise(() => {}));
    mockListAdjustments.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);
    const skeleton = container.querySelector('[aria-hidden="true"].sc-hist-screen');
    expect(skeleton).toBeInTheDocument();
    // Verify old loading text is not present
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no completed/cancelled counts exist', async () => {
    mockListCounts.mockResolvedValue([]);
    mockListAdjustments.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);
    await waitFor(() => {
      // FTL sc-hist-empty = "No completed counts to display."
      expect(screen.getByText(/no completed counts/i)).toBeInTheDocument();
    });
  });

  // ── List display ─────────────────────────────────────────────
  it('renders history title', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);
    await waitFor(() => {
      // FTL sc-hist-title = "Count History"
      expect(screen.getByText(/count history/i)).toBeInTheDocument();
    });
  });

  it('loads and displays count list items', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('SC-002')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('filters to only completed and cancelled counts', async () => {
    // listStockCounts returns all; component filters internally.
    const allCounts = [
      ...sampleCounts,
      { id: 'sc-3', count_number: 'SC-003', status: 'draft' as const, count_type: 'full' as const,
        notes: '', counted_by: null, created_at: '2026-07-01', completed_at: null, updated_at: '2026-07-01' },
    ];
    mockListCounts.mockResolvedValue(allCounts);
    mockListAdjustments.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    // Draft should be filtered out.
    expect(screen.queryByText('SC-003')).not.toBeInTheDocument();
  });

  // ── Select count → detail ────────────────────────────────────
  it('shows detail panel when a count is selected', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    mockGetLines.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('SC-001'));

    await waitFor(() => {
      expect(screen.getByText(/reconciliation report/i)).toBeInTheDocument();
    });
  });

  it('loads and displays count lines when a count is selected', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    mockGetLines.mockResolvedValue(sampleLines);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('SC-001'));

    await waitFor(() => {
      expect(screen.getByText(/count lines/i)).toBeInTheDocument();
      expect(screen.getByText('SKU-001')).toBeInTheDocument();
      expect(screen.getByText('Widget')).toBeInTheDocument();
      expect(screen.getByText('SKU-002')).toBeInTheDocument();
      // Expected/Counted/Diff values.
      expect(screen.getByText('98')).toBeInTheDocument();
    });
  });

  it('shows adjustments when available for selected count', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue(sampleAdjustments);
    mockGetLines.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('SC-001'));

    await waitFor(() => {
      expect(screen.getByText(/adjustments applied/i)).toBeInTheDocument();
      expect(screen.getByText('SKU-001')).toBeInTheDocument();
      // Previous/New qty.
      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });

  it('shows no-data message when selected count has no lines or adjustments', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    mockGetLines.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('SC-001'));

    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).toBeInTheDocument();
    });
  });

  it('highlights selected count item', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    mockGetLines.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('SC-001'));

    // The selected item should have the --sel modifier class.
    const sc001Btn = screen.getByText('SC-001').closest('button');
    expect(sc001Btn?.className).toContain('sc-hist-item--sel');
  });

  it('handles getCountLines error gracefully', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    mockListAdjustments.mockResolvedValue([]);
    mockGetLines.mockRejectedValue(new Error('Network error'));
    renderWithFluentSync(<ToastProvider><StockCountHistory /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    // Should not crash; clicking still works.
    await user.click(screen.getByText('SC-001'));

    await waitFor(() => {
      // Falls back to empty lines, shows no-data message.
      expect(screen.getByText(/no data available/i)).toBeInTheDocument();
    });
  });
});
