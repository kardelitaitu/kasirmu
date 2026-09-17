import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import stockCountingFtl from '@/locales/stock-counting.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/inventoryCounts', () => ({
  listStockCounts: vi.fn(),
}));

import StockCountsScreen from '@/features/inventory/StockCountsScreen';
import { listStockCounts } from '@/api/inventoryCounts';

const mockListCounts = listStockCounts as ReturnType<typeof vi.fn>;



const sampleCounts = [
  {
    id: 'sc-1', count_number: 'SC-001', status: 'draft' as const,
    count_type: 'full' as const, notes: 'Monthly inventory',
    counted_by: 'user-1', created_at: '2026-07-01', completed_at: null,
    updated_at: '2026-07-01',
  },
  {
    id: 'sc-2', count_number: 'SC-002', status: 'in_progress' as const,
    count_type: 'cyclic' as const, notes: '',
    counted_by: 'user-1', created_at: '2026-07-02', completed_at: null,
    updated_at: '2026-07-02',
  },
  {
    id: 'sc-3', count_number: 'SC-003', status: 'completed' as const,
    count_type: 'spot' as const, notes: 'Spot check aisle 3',
    counted_by: 'user-1', created_at: '2026-06-15', completed_at: '2026-06-15',
    updated_at: '2026-06-15',
  },
  {
    id: 'sc-4', count_number: 'SC-004', status: 'cancelled' as const,
    count_type: 'full' as const, notes: '',
    counted_by: null, created_at: '2026-06-01', completed_at: null,
    updated_at: '2026-06-10',
  },
];

describe('StockCountsScreen', () => {
  // ── Basic rendering ──────────────────────────────────────────
  it('renders the title and New Count button', async () => {
    mockListCounts.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);
    expect(screen.getByText('Stock Counts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new count/i })).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching stock counts', async () => {
    mockListCounts.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);
    expect(document.querySelector('.sc-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no counts exist', async () => {
    mockListCounts.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/no stock counts/i)).toBeInTheDocument();
    });
  });

  // ── List display ─────────────────────────────────────────────
  it('loads and displays count cards', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('SC-002')).toBeInTheDocument();
    expect(screen.getByText('SC-003')).toBeInTheDocument();
    expect(screen.getByText('SC-004')).toBeInTheDocument();
  });

  it('renders status badges with Fluent-resolved text', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    // Use querySelector to avoid Fluent wrapper element collisions.
    const draftBadge = document.querySelector('.sc-badge--draft');
    expect(draftBadge).toBeInTheDocument();
    expect(draftBadge!.textContent).toBe('Draft');

    const inProgressBadge = document.querySelector('.sc-badge--in_progress');
    expect(inProgressBadge).toBeInTheDocument();

    const completedBadge = document.querySelector('.sc-badge--completed');
    expect(completedBadge).toBeInTheDocument();
    expect(completedBadge!.textContent).toBe('Completed');

    const cancelledBadge = document.querySelector('.sc-badge--cancelled');
    expect(cancelledBadge).toBeInTheDocument();
    expect(cancelledBadge!.textContent).toBe('Cancelled');
  });

  it('renders count type labels via Fluent', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    const fullLabels = document.querySelectorAll('.sc-card-type');
    const fullTexts = Array.from(fullLabels).map(el => el.textContent);
    expect(fullTexts).toContain('Full');
    expect(fullTexts).toContain('Cyclic');
    expect(fullTexts).toContain('Spot');
    // 'Full' appears twice (SC-001 and SC-004).
    expect(fullTexts.filter(t => t === 'Full').length).toBe(2);
  });

  it('shows notes when present on a count', async () => {
    mockListCounts.mockResolvedValue([sampleCounts[0]!, sampleCounts[2]!]);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Monthly inventory')).toBeInTheDocument();
    expect(screen.getByText('Spot check aisle 3')).toBeInTheDocument();
  });

  it('does not show notes paragraph when notes is empty', async () => {
    mockListCounts.mockResolvedValue([sampleCounts[1]!]);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-002')).toBeInTheDocument();
    });
    // The notes <p> element should not exist.
    expect(document.querySelector('.sc-card-notes')).not.toBeInTheDocument();
  });

  it('shows View button on each count card', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });
    // Fluent may affect accessible name — use regex.
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    expect(viewButtons.length).toBeGreaterThanOrEqual(2);
  });

  // ── Status filters ───────────────────────────────────────────
  it('renders status filter buttons', async () => {
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    // Filter buttons use aria-pressed.
    const filterBtns = screen.getAllByRole('button', { pressed: false });
    expect(filterBtns.length).toBeGreaterThanOrEqual(4);
    const allBtn = screen.getByRole('button', { pressed: true });
    expect(allBtn).toBeInTheDocument();
  });

  it('filters counts by status when a filter is clicked', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    // Click "Completed" filter button by role + name.
    await user.click(screen.getByRole('button', { name: 'Completed' }));

    await waitFor(() => {
      expect(screen.queryByText('SC-001')).not.toBeInTheDocument();
      expect(screen.getByText('SC-003')).toBeInTheDocument();
    });
  });

  it('shows empty message when filter matches nothing', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue([sampleCounts[0]!]);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Completed' }));

    await waitFor(() => {
      expect(screen.getByText(/no stock counts/i)).toBeInTheDocument();
    });
  });

  it('highlights active filter button with --active class', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    const draftBtn = screen.getByRole('button', { name: 'Draft' });
    await user.click(draftBtn);

    expect(draftBtn.className).toContain('sc-filter-btn--active');
  });

  it('returns to All filter when All is clicked', async () => {
    const user = userEvent.setup();
    mockListCounts.mockResolvedValue(sampleCounts);
    renderWithFluentSync(<ToastProvider><StockCountsScreen /></ToastProvider>, stockCountingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('SC-001')).toBeInTheDocument();
    });

    // Filter to draft.
    await user.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => {
      expect(screen.queryByText('SC-003')).not.toBeInTheDocument();
    });

    // Back to All.
    await user.click(screen.getByRole('button', { name: 'All' }));

    await waitFor(() => {
      expect(screen.getByText('SC-003')).toBeInTheDocument();
    });
  });
});
