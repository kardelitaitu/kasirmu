// ── KdsLayoutMasonry tests ───────────────────────────────────────
//
// Covers: empty state (default + filtered), round-robin distribution
// across 3 columns, column header titles, column count badges,
// column CSS classes, and order-to-column assignment.
//
// Mocks: KdsTicketCard (rendered as a simple data-div) and Fluent
// i18n (via renderWithFluentSync).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { KdsLayoutMasonry } from '@/features/kds/KdsLayoutMasonry';
import type { KdsOrder } from '@/api/kds';
import kdsFtl from '@/locales/kds.ftl?raw';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';

// ── Mocks ───────────────────────────────────────────────────────────

// KdsTicketCard — render as a simple div so we can count orders per column.
vi.mock('@/features/kds/components/KdsTicketCard', () => ({
  KdsTicketCard: ({ order }: { order: { id: string } }) => (
    <div data-testid={`ticket-${order.id}`}>Ticket {order.id}</div>
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────

/** Create a minimal KdsOrder stub. */
function makeOrder(id: string, overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id,
    sale_id: `sale-${id}`,
    store_id: null,
    status: 'pending',
    items_summary: `Items for ${id}`,
    item_count: 2,
    display_number: Number(id.replace('order-', '')) || 1,
    received_at: new Date().toISOString(),
    started_at: null,
    ready_at: null,
    served_at: null,
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
    ...overrides,
  };
}

function defaultProps(orders: KdsOrder[] = []) {
  return {
    orders,
    onAdvance: vi.fn(),
    showOrderId: true,
    showTableNumber: false,
    selectedOrderId: null,
    sessionToken: 'test-token',
    newOrderIds: new Set<string>(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('KdsLayoutMasonry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ───────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders "No orders yet" when orders is empty', () => {
      renderWithFluentSync(<KdsLayoutMasonry {...defaultProps()} />, kdsFtl);
      expect(screen.getByRole('status')).toHaveTextContent(/no orders yet/i);
    });

    it('renders "No orders in this status" when filtered=true', () => {
      renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps()} filtered />,
        kdsFtl,
      );
      expect(screen.getByRole('status')).toHaveTextContent(/no orders in this status/i);
    });

    it('renders the empty container with "empty" class', () => {
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps()} />,
        kdsFtl,
      );
      const main = container.querySelector('.kds-main.kds-columns.empty');
      expect(main).not.toBeNull();
    });
  });

  // ── Column structure ──────────────────────────────────────────────

  describe('column structure', () => {
    it('renders 3 columns', () => {
      const orders = [makeOrder('o1'), makeOrder('o2'), makeOrder('o3')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      expect(cols).toHaveLength(3);
    });

    it('columns have the correct status classes', () => {
      const orders = [makeOrder('o1'), makeOrder('o2'), makeOrder('o3')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      expect(cols[0]).toHaveClass('kds-column--pending');
      expect(cols[1]).toHaveClass('kds-column--preparing');
      expect(cols[2]).toHaveClass('kds-column--ready');
    });

    it('each column has a header with title and count', () => {
      const orders = [makeOrder('o1'), makeOrder('o2'), makeOrder('o3')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const headers = container.querySelectorAll('.kds-column-header');
      expect(headers).toHaveLength(3);

      // Each header should have a title and count span.
      for (const header of headers) {
        expect(header.querySelector('.kds-column-title')).not.toBeNull();
        expect(header.querySelector('.kds-column-count')).not.toBeNull();
      }
    });
  });

  // ── Round-robin distribution ──────────────────────────────────────

  describe('round-robin distribution', () => {
    it('distributes 3 orders: one per column', () => {
      const orders = [makeOrder('o1'), makeOrder('o2'), makeOrder('o3')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      // Column 0 has order o1, Column 1 has o2, Column 2 has o3.
      expect(cols[0]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(1);
      expect(cols[1]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(1);
      expect(cols[2]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(1);
    });

    it('distributes 6 orders: two per column', () => {
      const orders = Array.from({ length: 6 }, (_, i) => makeOrder(`o${i + 1}`));
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      expect(cols[0]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(2);
      expect(cols[1]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(2);
      expect(cols[2]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(2);
    });

    it('distributes 5 orders: 2-2-1 (last column gets fewer)', () => {
      const orders = Array.from({ length: 5 }, (_, i) => makeOrder(`o${i + 1}`));
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      expect(cols[0]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(2);
      expect(cols[1]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(2);
      expect(cols[2]!.querySelectorAll('[data-testid^="ticket-"]')).toHaveLength(1);
    });

    it('assigns the first order to column 0, second to column 1, third to column 2', () => {
      const orders = [makeOrder('first'), makeOrder('second'), makeOrder('third')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      expect(cols[0]!.querySelector('[data-testid="ticket-first"]')).not.toBeNull();
      expect(cols[1]!.querySelector('[data-testid="ticket-second"]')).not.toBeNull();
      expect(cols[2]!.querySelector('[data-testid="ticket-third"]')).not.toBeNull();
    });

    it('the 4th order wraps back to column 0', () => {
      const orders = Array.from({ length: 4 }, (_, i) => makeOrder(`o${i + 1}`));
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const cols = container.querySelectorAll('.kds-col.kds-column');
      // Column 0 should have o1 and o4.
      const col0Tickets = cols[0]!.querySelectorAll('[data-testid^="ticket-"]');
      expect(col0Tickets).toHaveLength(2);
      expect(col0Tickets[0]).toHaveAttribute('data-testid', 'ticket-o1');
      expect(col0Tickets[1]).toHaveAttribute('data-testid', 'ticket-o4');
    });
  });

  // ── Column count display ──────────────────────────────────────────

  describe('column count display', () => {
    it('column count shows 1 for a single order in that column', () => {
      const orders = [makeOrder('o1')];
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const counts = container.querySelectorAll('.kds-column-count');
      // Column 0 has 1 order, columns 1 and 2 have 0.
      expect(counts[0]).toHaveTextContent('1');
      expect(counts[1]).toHaveTextContent('0');
      expect(counts[2]).toHaveTextContent('0');
    });

    it('column count shows correct numbers for 7 orders', () => {
      const orders = Array.from({ length: 7 }, (_, i) => makeOrder(`o${i + 1}`));
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const counts = container.querySelectorAll('.kds-column-count');
      // 7 orders → 3-2-2 (round-robin: 0,1,2,0,1,2,0)
      expect(counts[0]).toHaveTextContent('3');
      expect(counts[1]).toHaveTextContent('2');
      expect(counts[2]).toHaveTextContent('2');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles a single order without errors', () => {
      const orders = [makeOrder('solo')];
      renderWithFluentSync(<KdsLayoutMasonry {...defaultProps(orders)} />, kdsFtl);
      expect(screen.getByTestId('ticket-solo')).toBeInTheDocument();
    });

    it('handles many orders without errors', () => {
      const orders = Array.from({ length: 30 }, (_, i) => makeOrder(`o${i + 1}`));
      const { container } = renderWithFluentSync(
        <KdsLayoutMasonry {...defaultProps(orders)} />,
        kdsFtl,
      );
      const tickets = container.querySelectorAll('[data-testid^="ticket-"]');
      expect(tickets).toHaveLength(30);
    });
  });
});
