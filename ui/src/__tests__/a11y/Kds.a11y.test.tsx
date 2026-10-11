//! A11y regression tests for the KDS (kitchen display) surfaces.
//!
//! The KDS is reachable from the restaurant POS sidebar ("Kitchen Display") and
//! is the only screen a kitchen actually operates, yet it had no axe coverage
//! while the POS panels did. Two components, chosen because each mounts with a
//! small, honest harness and together they cover the two KDS shapes a cook sees:
//! the live ticket card (status buttons, line items, notes) and the completed
//! bucket view (day columns, served cards, reopen button).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsCompletedView } from '@/features/kds/KdsCompletedView';
import { KdsTicketCard } from '@/features/kds/components/KdsTicketCard';
import type { KdsOrder } from '@/api/kds';

const mockList = vi.fn();
const mockGetKdsOrderLines = vi.fn().mockResolvedValue([]);
const mockPlayAlert = vi.fn();

vi.mock('@/api/kds', () => ({
  listKdsOrdersScoped: (_token: string, _status?: string) => mockList(),
  getKdsOrderLinesScoped: (_token: string, _orderId: string) => mockGetKdsOrderLines(),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: () => Promise.resolve({ timezone: 'UTC' }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-token' }),
}));

vi.mock('@/features/kds/hooks/useTicketSla', () => ({
  useTicketSla: () => ({ level: 'green', display: '0s', elapsedSeconds: 0 }),
}));

vi.mock('@/components/useSound', () => ({
  useSound: () => ({ playAlert: mockPlayAlert }),
}));

function makeOrder(overrides: Partial<KdsOrder> = {}): KdsOrder {
  const now = new Date();
  return {
    id: 'o-1',
    sale_id: 's-1',
    store_id: null,
    status: 'served',
    items_summary: 'Latte x2',
    item_count: 2,
    display_number: 101,
    received_at: new Date(now.getTime() - 10 * 60000).toISOString(),
    started_at: null,
    ready_at: null,
    served_at: now.toISOString(),
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
    ...overrides,
  } as KdsOrder;
}

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue([makeOrder()]);
  mockGetKdsOrderLines.mockReset().mockResolvedValue([]);
  mockPlayAlert.mockReset();
});

describe('KDS a11y', () => {
  it('KdsCompletedView has no axe violations with a served order', async () => {
    const { container } = renderWithProviders(<KdsCompletedView />);
    await vi.waitFor(() => {
      expect(container.querySelector('.kds-completed-col-head')).not.toBeNull();
    });
    await checkA11y(container);
    // Vacuity guard: the served card must be on screen, not an empty column.
    expect(container.textContent).toContain('Latte x2');
  });

  it('KdsTicketCard has no axe violations for a live ticket', async () => {
    const { container } = renderWithProviders(
      <KdsTicketCard
        order={makeOrder({ status: 'pending', served_at: null, table_number: '5' })}
        onAdvance={vi.fn()}
        onAddItems={vi.fn()}
        sessionToken="test-token"
      />,
    );
    await checkA11y(container);
    // Vacuity guard: the ticket's status controls mounted.
    expect(container.querySelectorAll('.kds-status-btn').length).toBeGreaterThan(0);
  });
});
