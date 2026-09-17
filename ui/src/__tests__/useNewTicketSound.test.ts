import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { KdsOrder } from '@/api/kds';

// ── Mock useSound ────────────────────────────────────────────────────

const mockPlayBeep = vi.fn();

vi.mock('@/components/useSound', () => ({
  useSound: () => ({ playBeep: mockPlayBeep }),
}));

// We need to import AFTER setting up the mock.
const { useNewTicketSound } = await import('@/features/kds/hooks/useNewTicketSound');

// ── Helpers ──────────────────────────────────────────────────────────

function makeOrder(id: string): KdsOrder {
  return {
    id,
    sale_id: 'sale-1',
    store_id: 'default',
    status: 'pending',
    items_summary: 'Item 1',
    item_count: 1,
    display_number: 101,
    received_at: new Date().toISOString(),
    started_at: null,
    ready_at: null,
    served_at: null,
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useNewTicketSound', () => {
  beforeEach(() => {
    mockPlayBeep.mockClear();
  });

  it('plays beep when a new ticket arrives', () => {
    const orders: KdsOrder[] = [makeOrder('o-1')];
    renderHook(() => useNewTicketSound(orders));
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
  });

  it('does not play beep for duplicate ticket', () => {
    const orders: KdsOrder[] = [makeOrder('o-1')];
    const { rerender } = renderHook(
      (props: { orders: KdsOrder[] }) => useNewTicketSound(props.orders),
      { initialProps: { orders } },
    );
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
    // Re-render with same orders.
    rerender({ orders: [makeOrder('o-1')] });
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
  });

  it('plays beep when a second distinct ticket arrives after debounce', async () => {
    const { rerender } = renderHook(
      (props: { orders: KdsOrder[] }) => useNewTicketSound(props.orders),
      { initialProps: { orders: [makeOrder('o-1')] } },
    );
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
    // Advance past debounce window.
    await new Promise((r) => setTimeout(r, 6000));
    rerender({ orders: [makeOrder('o-1'), makeOrder('o-2')] });
    expect(mockPlayBeep).toHaveBeenCalledTimes(2);
  });

  it('debounces rapid new tickets within 5 seconds', async () => {
    const { rerender } = renderHook(
      (props: { orders: KdsOrder[] }) => useNewTicketSound(props.orders),
      { initialProps: { orders: [makeOrder('o-1')] } },
    );
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
    // Advance only 2 seconds (within 5s debounce).
    await new Promise((r) => setTimeout(r, 2000));
    // Add two new tickets.
    rerender({ orders: [makeOrder('o-1'), makeOrder('o-2'), makeOrder('o-3')] });
    // Should NOT have played — still within debounce window.
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
  });

  it('plays one trailing catch-up chime for arrivals inside the debounce window', async () => {
    const { rerender } = renderHook(
      (props: { orders: KdsOrder[] }) => useNewTicketSound(props.orders),
      { initialProps: { orders: [makeOrder('o-1')] } },
    );
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
    // Burst arrives inside the window — previously swallowed forever.
    await new Promise((r) => setTimeout(r, 1500));
    rerender({ orders: [makeOrder('o-1'), makeOrder('o-2')] });
    rerender({ orders: [makeOrder('o-1'), makeOrder('o-2'), makeOrder('o-3')] });
    expect(mockPlayBeep).toHaveBeenCalledTimes(1);
    // Wait past the remainder of the debounce window: exactly one trailing
    // catch-up chime (not one per arrival, not zero).
    await new Promise((r) => setTimeout(r, 4500));
    expect(mockPlayBeep).toHaveBeenCalledTimes(2);
    // No further chimes for the same burst.
    await new Promise((r) => setTimeout(r, 2000));
    expect(mockPlayBeep).toHaveBeenCalledTimes(2);
  });

  it('does not play beep when enabled=false', () => {
    const orders: KdsOrder[] = [makeOrder('o-1')];
    renderHook(() => useNewTicketSound(orders, false));
    expect(mockPlayBeep).not.toHaveBeenCalled();
  });

  it('does not play beep for empty orders array', () => {
    renderHook(() => useNewTicketSound([]));
    expect(mockPlayBeep).not.toHaveBeenCalled();
  });
});
