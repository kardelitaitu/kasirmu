import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { KdsTicketCard } from '@/features/kds/components/KdsTicketCard';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { withFluent } from '@/i18n/test-utils';
import type { KdsOrder } from '@/api/kds';

const mockPlayAlert = vi.fn();
const mockGetKdsOrderLines = vi.fn().mockResolvedValue([]);
const mockSlaResult: { level: string; display: string; elapsedSeconds: number } = { level: 'green', display: '0s', elapsedSeconds: 0 };

vi.mock('@/api/kds', () => ({
  getKdsOrderLinesScoped: (_token: string, _orderId: string) => mockGetKdsOrderLines(),
}));

vi.mock('@/features/kds/hooks/useTicketSla', () => ({
  useTicketSla: () => mockSlaResult,
}));

vi.mock('@/components/useSound', () => ({
  useSound: () => ({ playAlert: mockPlayAlert }),
}));

beforeEach(() => {
  mockPlayAlert.mockReset();
  mockSlaResult.level = 'green';
  mockSlaResult.display = '0s';
});

afterEach(() => {
  mockPlayAlert.mockReset();
});

const baseOrder: KdsOrder = {
  id: 'order-1',
  sale_id: 'sale-1',
  store_id: null,
  status: 'pending',
  items_summary: '2x Nasi Goreng, 1x Es Teh',
  item_count: 3,
  display_number: 42,
  received_at: new Date().toISOString(),
  started_at: null,
  ready_at: null,
  served_at: null,
  prep_time_seconds: 0,
  kitchen_zone: null,    notes: '',
    table_number: null,
    priority: false,
};

function renderCard(order: Partial<KdsOrder> = {}) {
  const merged = { ...baseOrder, ...order };
  return renderWithFluentSync(<KdsTicketCard order={merged} onAdvance={onAdvance} sessionToken="test-token" />, sharedFtl, kdsFtl);
}

const onAdvance = vi.fn();

describe('KdsTicketCard', () => {
  it('renders display number', () => {
    renderCard();
    expect(screen.getByText('#42')).toBeTruthy();
  });

  it('renders items summary', async () => {
    renderCard();
    await vi.waitFor(() => {
      expect(screen.getByText('2x Nasi Goreng, 1x Es Teh')).toBeTruthy();
    });
  });

  it('renders item count', () => {
    renderCard();
    expect(screen.getByText('3 items')).toBeTruthy();
  });

  it('shows SLA time', () => {
    mockSlaResult.display = '5m 30s';
    renderCard();
    expect(screen.getByText('5m 30s')).toBeTruthy();
  });

  it('shows notes when present', () => {
    renderCard({ notes: 'No onion please' });
    expect(screen.getByText('No onion please')).toBeTruthy();
  });

  it('does not show notes when empty', () => {
    const { container } = renderCard({ notes: '' });
    expect(container.querySelector('.kds-ticket-notes')).toBeNull();
  });

  it('sets level class on the ticket', () => {
    mockSlaResult.level = 'red';
    const { container } = renderCard();
    const ticket = container.querySelector('.kds-ticket');
    expect(ticket?.className).toContain('kds-ticket--red');
  });

  it('calls onAdvance on the footer Advance button when status can advance', () => {
    renderCard({ status: 'pending' });
    const advance = document.querySelector('[data-testid="kds-order-card-42-status-advance"]') as HTMLButtonElement;
    expect(advance).not.toBeNull();
    fireEvent.click(advance);
    expect(onAdvance).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-1' }));
  });

  it('does not call onAdvance for served orders (no Advance button)', () => {
    renderCard({ status: 'served' });
    expect(document.querySelector('[data-testid="kds-order-card-42-status-advance"]')).toBeNull();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not call onAdvance for cancelled orders (no Advance button)', () => {
    renderCard({ status: 'cancelled' });
    expect(document.querySelector('[data-testid="kds-order-card-42-status-advance"]')).toBeNull();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('rejects fractional edit counts at the keystroke level', () => {
    const onSaveItems = vi.fn();
    const { container } = renderWithFluentSync(
      <KdsTicketCard order={baseOrder} onAdvance={onAdvance} onSaveItems={onSaveItems} sessionToken="test-token" />,
      sharedFtl, kdsFtl,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>('.kds-ticket-edit-btn')!);

    const countInput = container.querySelector<HTMLInputElement>('.kds-ticket-edit-count')!;
    // Simulate typing "2.5" — the fractional change must be rejected
    // (the controlled input stays at the previous integer value).
    fireEvent.change(countInput, { target: { value: '2.5' } });
    expect(countInput.value).toBe('3');

    // And an integer change is still accepted.
    fireEvent.change(countInput, { target: { value: '4' } });
    expect(countInput.value).toBe('4');
  });

  it('plays alert when transitioning to red', () => {
    const { rerender } = renderCard();
    expect(mockPlayAlert).not.toHaveBeenCalled();

    mockSlaResult.level = 'red';
    rerender(
      withFluent(
        <KdsTicketCard order={{ ...baseOrder, notes: 'trigger' }} onAdvance={onAdvance} sessionToken="test-token" />,
        sharedFtl, kdsFtl,
      ),
    );

    expect(mockPlayAlert).toHaveBeenCalledTimes(1);
  });

  it('does not play alert on first render', () => {
    renderCard();
    expect(mockPlayAlert).not.toHaveBeenCalled();
  });

  it('sets aria-label on the Advance button with SLA info', () => {
    mockSlaResult.level = 'yellow';
    mockSlaResult.display = '12m 0s';
    renderCard();
    const advance = document.querySelector('[data-testid="kds-order-card-42-status-advance"]');
    expect(advance?.getAttribute('aria-label')).toContain('42');
  });
});
