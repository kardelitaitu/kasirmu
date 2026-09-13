import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { HardwareAccelProvider } from '@/contexts/HardwareAccelContext';
import KdsScreen from '@/features/kds/KdsScreen';
import kdsFtl from '@/locales/kds.ftl?raw';
import type { KdsOrder } from '@/api/kds';

// ── Zone-preference store (ZONE-TESTS) ──────────────────────────────
// The real useKdsPreferences persists and notifies; this store mirrors
// that contract so zone clicks re-render the screen NATURALLY instead of
// relying on manual rerender() calls (the old approach crashed the
// worker with an unbounded re-render loop).
const { kdsZoneStore } = vi.hoisted(() => {
  const state = { current: '' };
  const listeners = new Set<() => void>();
  return {
    kdsZoneStore: {
      get: () => state.current,
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      set: (zone: string) => {
        if (state.current === zone) return;
        state.current = zone;
        for (const l of listeners) l();
      },
      reset: () => {
        state.current = '';
      },
    },
  };
});

const { mockGetKdsQueue, mockUpdateKdsStatus, mockListKdsOrdersScoped, mockGetKdsOrderLines, mockUpdateKdsOrderItems, mockListProducts, mockUseTicketSla, mockPlayAlert, mockSpeak, mockUseWorkspaceScope } = vi.hoisted(() => ({
  mockGetKdsQueue: vi.fn(),
  mockUpdateKdsStatus: vi.fn(),
  mockListKdsOrdersScoped: vi.fn().mockResolvedValue([]),
  mockGetKdsOrderLines: vi.fn().mockResolvedValue([]),
  mockUpdateKdsOrderItems: vi.fn(),
  mockListProducts: vi.fn().mockResolvedValue([]),
  mockUseTicketSla: vi.fn((): { level: 'green' | 'yellow' | 'red'; elapsedSeconds: number; display: string } => ({
    level: 'green',
    elapsedSeconds: 120,
    display: '2m 0s',
  })),
  mockPlayAlert: vi.fn(),
  mockSpeak: vi.fn(),
  mockUseWorkspaceScope: vi.fn<() => { storeId: string; instanceId: string; typeKey: string } | null>(() => null),
}));

vi.mock('@/features/kds/hooks/useKdsPreferences', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useKdsPreferences: () => {
      // Subscribing via useSyncExternalStore makes a zone click re-render
      // the screen naturally — the same contract the real hook provides
      // (persist + notify), which manual rerender() could never emulate.
      const kdsZone = useSyncExternalStore(kdsZoneStore.subscribe, kdsZoneStore.get);
      return {
        prefs: {
          layout: 'kanban',
          showOrderId: true,
          showTableNumber: true,
          kdsZone,
          autoAcknowledge: false,
          acknowledgeDelayMin: 2,
        },
        setLayout: vi.fn(),
        setShowOrderId: vi.fn(),
        setShowTableNumber: vi.fn(),
        setKdsZone: (zone: string) => kdsZoneStore.set(zone),
        setAutoAcknowledge: vi.fn(),
        setAcknowledgeDelay: vi.fn(),
        loading: false,
      };
    },
  };
});

vi.mock('@/api/kds', () => ({
  getKdsQueue: async (_userId: string, _kdsZone?: string) => {
    const orders = await mockGetKdsQueue();
    if (!_kdsZone) {
      return orders;
    }
    return orders.filter((order: KdsOrder) => order['kitchen_zone'] === _kdsZone);
  },
  getKdsQueueScoped: async (_token: string, _kdsZone?: string) => {
    const orders = await mockGetKdsQueue();
    if (!_kdsZone) {
      return orders;
    }
    return orders.filter((order: KdsOrder) => order['kitchen_zone'] === _kdsZone);
  },
  listKdsOrdersScoped: (_token: string, _status: string) => mockListKdsOrdersScoped(),
  updateKdsStatus: (_userId: string, id: string, status: string) =>
    mockUpdateKdsStatus(id, status),
  updateKdsStatusScoped: (
    _token: string,
    id: string,
    status: string,
  ) => mockUpdateKdsStatus(id, status),
  getKdsOrderLinesScoped: (_token: string, _orderId: string) => mockGetKdsOrderLines(),
  updateKdsOrderItemsScoped: (_token: string, args: unknown) =>
    mockUpdateKdsOrderItems(args),
}));

vi.mock('@/api/products', () => ({
  listProductsScoped: () => mockListProducts(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'user-1', display_name: 'Alice', role_name: 'cashier' } }),
}));

vi.mock('@/features/kds/hooks/useTicketSla', () => ({
  useTicketSla: (..._args: unknown[]) => mockUseTicketSla(),
}));

vi.mock('@/frontend/shared/useSound', () => ({
  useSound: () => ({
    playAlert: mockPlayAlert,
    playBeep: vi.fn(),
    playError: vi.fn(),
    playSuccess: vi.fn(),
    speak: mockSpeak,
    setSoundEnabled: vi.fn(),
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspaceScope: () => mockUseWorkspaceScope(),
  useWorkspace: () => ({
    activeWorkspace: 'kds',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: null,
    swapSessionToken: vi.fn(),
  }),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(kdsFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <HardwareAccelProvider>
        <KdsScreen />
      </HardwareAccelProvider>
    </LocalizationProvider>,
  );
}

function makeOrder(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: 'o-1',
    sale_id: 's-1',
    store_id: null,
    status: 'pending',
    items_summary: 'Burger x1, Fries x1',
    item_count: 2,
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
    ...overrides,
  };
}

describe('KdsScreen', () => {
  beforeEach(() => {
    mockGetKdsQueue.mockResolvedValue([]);
    mockSpeak.mockClear();
    kdsZoneStore.reset(); // Reset zone state between tests
  });

  it('renders the KDS region with aria-label', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /kitchen display/i })).toBeDefined();
    });
  });

  it('renders the masonry order view (single layout)', async () => {
    renderScreen();
    await waitFor(() => {
      // The prototype single view: cards flow into columns (.kds-main).
      expect(document.querySelector('.kds-main')).not.toBeNull();
    });
  });

  it('shows order count in the Open tab', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder(), makeOrder({ id: 'o-2' })]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-tab-open').textContent).toMatch(/2/);
    });
  });

  it('shows an empty state when no orders', async () => {
    renderScreen();
    await waitFor(() => {
      // Single masonry view → one empty state (not one per status column).
      expect(screen.getAllByText('No orders yet').length).toBe(1);
    });
  });

  it('renders tickets in the correct column by status', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, items_summary: 'Burger' }),
      makeOrder({ id: 'o-2', status: 'preparing', display_number: 102, items_summary: 'Fries' }),
      makeOrder({ id: 'o-3', status: 'ready', display_number: 103, items_summary: 'Drink' }),
    ]);
    renderScreen();
    await waitFor(() => {
      // Ticket numbers rendered as #display_number
      expect(screen.getByText('#101')).toBeDefined();
      expect(screen.getByText('#102')).toBeDefined();
      expect(screen.getByText('#103')).toBeDefined();
    });
  });

  it('shows items summary on each ticket', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());
  });

  it('shows item count on each ticket', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder({ item_count: 3 })]);
    renderScreen();
    await waitFor(() => {
      // Fluent Localized wraps the text in <span>, so use a custom matcher
      const countEl = document.querySelector('.kds-ticket-count');
      expect(countEl?.textContent).toMatch(/3/);
      expect(countEl?.textContent).toMatch(/items/);
    });
  });

  it('shows notes on ticket when present', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder({ notes: 'No onions' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('No onions')).toBeDefined());
  });

  it('advances pending order to preparing on click', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder({ status: 'pending' })]);
    mockUpdateKdsStatus.mockResolvedValue({});

    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());

    const advanceBtn = document.querySelector('[data-testid="kds-order-card-101-status-advance"]') as HTMLButtonElement;
    expect(advanceBtn).not.toBeNull();
    await userEvent.click(advanceBtn);

    await waitFor(() =>
      expect(mockUpdateKdsStatus).toHaveBeenCalledWith('o-1', 'preparing'),
    );
  });

  it('advances preparing order to ready on click', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder({ status: 'preparing' })]);
    mockUpdateKdsStatus.mockResolvedValue({});

    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());

    const advanceBtn = document.querySelector('[data-testid="kds-order-card-101-status-advance"]') as HTMLButtonElement;
    expect(advanceBtn).not.toBeNull();
    await userEvent.click(advanceBtn);

    await waitFor(() =>
      expect(mockUpdateKdsStatus).toHaveBeenCalledWith('o-1', 'ready'),
    );
  });

  it('shows offline banner when getKdsQueue fails', async () => {
    mockGetKdsQueue.mockRejectedValue(new Error('Network down'));
    renderScreen();
    // The offline banner should show instead of the raw error.
    await waitFor(() => {
      expect(document.querySelector('.kds-offline-banner')).not.toBeNull();
    });
  });

  it('shows time ago on tickets', async () => {
    const recentTime = new Date(Date.now() - 5 * 60000).toISOString(); // 5 min ago
    mockGetKdsQueue.mockResolvedValue([makeOrder({ received_at: recentTime })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());
    const timeCell = document.querySelector('.kds-ticket-time');
    // timeAgo should show "5m" for 5 minutes ago
    expect(timeCell?.textContent).toMatch(/m/);
  });

  it('shows the Open tab count', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending' }),
      makeOrder({ id: 'o-2', status: 'pending' }),
    ]);
    renderScreen();
    await waitFor(() => {
      // The Open tab shows the order count (prototype .kds-tab-count).
      const tabCount = document.querySelector('.kds-tab-count');
      expect(tabCount).not.toBeNull();
      expect(tabCount?.textContent).toBe('2');
    });
  });

  it('has aria-label on the KDS region', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Kitchen Display System' })).toBeDefined(),
    );
  });

  it('does not render cancelled orders in the masonry view', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'cancelled', display_number: 999, items_summary: 'Cancel Item' }),
    ]);
    renderScreen();
    await waitFor(() => {
      // Cancelled tickets are terminal history — the board is truly empty
      // (never surfaces on the kitchen board, history panel only).
      const empties = screen.getAllByText('No orders yet');
      expect(empties.length).toBe(1);
    });
    // Cancelled order should not be visible
    expect(screen.queryByText('#999')).toBeNull();
    expect(screen.queryByText('Cancel Item')).toBeNull();
  });

  // ── SLA class tests ──────────────────────────────────────────────────

  it('applies green SLA class by default', async () => {
    mockUseTicketSla.mockReturnValue({ level: 'green', elapsedSeconds: 120, display: '2m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      const ticket = document.querySelector('.kds-ticket');
      expect(ticket).not.toBeNull();
      expect(ticket?.classList.contains('kds-ticket--green')).toBe(true);
    });
  });

  it('applies yellow SLA class', async () => {
    mockUseTicketSla.mockReturnValue({ level: 'yellow', elapsedSeconds: 720, display: '12m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      const ticket = document.querySelector('.kds-ticket');
      expect(ticket?.classList.contains('kds-ticket--yellow')).toBe(true);
    });
  });

  it('applies red SLA class', async () => {
    mockUseTicketSla.mockReturnValue({ level: 'red', elapsedSeconds: 1200, display: '20m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      const ticket = document.querySelector('.kds-ticket');
      expect(ticket?.classList.contains('kds-ticket--red')).toBe(true);
    });
  });

  it('shows SLA display string instead of timeAgo', async () => {
    mockUseTicketSla.mockReturnValue({ level: 'green', elapsedSeconds: 300, display: '5m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      const timeCell = document.querySelector('.kds-ticket-time');
      expect(timeCell?.textContent).toBe('5m 0s');
    });
  });

  it('does not fire playAlert on initial render with red ticket (no transition)', async () => {
    // From the code: prevLevel starts null, so on first render it doesn't play
    mockUseTicketSla.mockReturnValue({ level: 'red', elapsedSeconds: 1200, display: '20m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.kds-ticket--red')).not.toBeNull();
    });
    expect(mockPlayAlert).not.toHaveBeenCalled();
  });

  it('applies color class on time element matching SLA level', async () => {
    mockUseTicketSla.mockReturnValue({ level: 'yellow', elapsedSeconds: 720, display: '12m 0s' });
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => {
      const timeCell = document.querySelector('.kds-ticket-time');
      expect(timeCell?.classList.contains('kds-ticket-time--yellow')).toBe(true);
    });
  });

  // ── ADR #8: store_id filtering tests ────────────────────────────────

  it('passes through orders with null store_id when scope is set (legacy compat)', async () => {
    mockUseWorkspaceScope.mockReturnValue({ storeId: 'store-downtown', instanceId: 'i-1', typeKey: 'kds' });
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', store_id: null, items_summary: 'Legacy Order' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Legacy Order')).toBeDefined();
    });
  });

  it('passes through orders whose store_id matches the active scope', async () => {
    mockUseWorkspaceScope.mockReturnValue({ storeId: 'store-downtown', instanceId: 'i-1', typeKey: 'kds' });
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', store_id: 'store-downtown', items_summary: 'Downtown Order' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Downtown Order')).toBeDefined();
    });
  });

  it('filters out orders whose store_id does not match the active scope', async () => {
    mockUseWorkspaceScope.mockReturnValue({ storeId: 'store-downtown', instanceId: 'i-1', typeKey: 'kds' });
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', store_id: 'store-mall', items_summary: 'Mall Order' }),
    ]);
    renderScreen();
    await waitFor(() => {
      // The Mall order should be filtered out — the masonry view is empty
      const empties = screen.getAllByText('No orders yet');
      expect(empties.length).toBe(1);
    });
    expect(screen.queryByText('Mall Order')).toBeNull();
  });

  it('passes through all orders when workspace scope is null (no filtering)', async () => {
    mockUseWorkspaceScope.mockReturnValue(null);
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', store_id: 'store-downtown', items_summary: 'DT Order' }),
      makeOrder({ id: 'o-2', store_id: 'store-mall', items_summary: 'Mall Order' }),
      makeOrder({ id: 'o-3', store_id: null, items_summary: 'Legacy Order' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('DT Order')).toBeDefined();
      expect(screen.getByText('Mall Order')).toBeDefined();
      expect(screen.getByText('Legacy Order')).toBeDefined();
    });
  });

  it('filters mixed orders — keeps matching and legacy, drops mismatched', async () => {
    mockUseWorkspaceScope.mockReturnValue({ storeId: 'store-downtown', instanceId: 'i-1', typeKey: 'kds' });
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', store_id: 'store-downtown', items_summary: 'DT Order' }),
      makeOrder({ id: 'o-2', store_id: 'store-mall', items_summary: 'Mall Order' }),
      makeOrder({ id: 'o-3', store_id: null, items_summary: 'Legacy Order' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('DT Order')).toBeDefined();
      expect(screen.getByText('Legacy Order')).toBeDefined();
    });
    // Mall order should be filtered out
    expect(screen.queryByText('Mall Order')).toBeNull();
    // Open tab count should show 2 orders
    expect(screen.getByTestId('kds-tab-open').textContent).toMatch(/2/);
  });

  // ── 2d: Keyboard shortcuts tests ─────────────────────────────────

  it('selects the first order when pressing key 1', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101 }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102 }),
    ]);
    mockUpdateKdsStatus.mockResolvedValue({});
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    const kds = document.querySelector('.kds')!;
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));

    // First ticket should have selected class
    await waitFor(() => {
      const tickets = document.querySelectorAll('.kds-ticket');
      expect(tickets[0]?.classList.contains('kds-ticket--selected')).toBe(true);
      expect(tickets[1]?.classList.contains('kds-ticket--selected')).toBe(false);
    });
  });

  it('selects the second order when pressing key 2', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101 }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102 }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    const kds = document.querySelector('.kds')!;
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));

    await waitFor(() => {
      const tickets = document.querySelectorAll('.kds-ticket');
      expect(tickets[0]?.classList.contains('kds-ticket--selected')).toBe(false);
      expect(tickets[1]?.classList.contains('kds-ticket--selected')).toBe(true);
    });
  });

  it('advances selected order when pressing Space', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending' }),
    ]);
    mockUpdateKdsStatus.mockResolvedValue({});
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    const kds = document.querySelector('.kds')!;
    // Select the first order
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    // Then advance it with Space
    await waitFor(() => {
      expect(document.querySelector('.kds-ticket--selected')).not.toBeNull();
    });
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    await waitFor(() =>
      expect(mockUpdateKdsStatus).toHaveBeenCalledWith('o-1', 'preparing'),
    );
  });

  it('deselects on Escape key', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    const kds = document.querySelector('.kds')!;
    // Select first order then deselect
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await waitFor(() => {
      expect(document.querySelector('.kds-ticket--selected')).not.toBeNull();
    });
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => {
      expect(document.querySelector('.kds-ticket--selected')).toBeNull();
    });
  });

  // ── 3a: Zone-switching tests ───────────────────────────────────

  it('shows zone chips when orders have kitchen zones', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // Should show "All" chip and both zone chips
    expect(screen.getByText('All')).toBeDefined();
    expect(screen.getByText('Grill')).toBeDefined();
    expect(screen.getByText('Fry')).toBeDefined();
  });

  it('hides zone chips when no orders have kitchen zones', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', kitchen_zone: null }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // "All" chip should NOT be shown since the zone bar is hidden entirely
    expect(screen.queryByText('All')).toBeNull();
  });

  //  it('activates clicked zone chip', async () => {
  //   mockGetKdsQueue.mockResolvedValue([
  //     makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
  //     makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
  //   ]);
  //   const { rerender } = renderScreen();
  //   await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

  //   // Click the "Grill" zone chip
  //   await userEvent.click(screen.getByText('Grill'));

  //   // Re-render to pick up the updated kdsZone state
  //   rerender(
  //     <LocalizationProvider l10n={l10n}>
  //       <KdsScreen />
  //     </LocalizationProvider>
  //   );

  //   // The Grill chip should have the active class (zones sorted: Fry, Grill → index 2)
  //   await waitFor(() => {
  //     const chips = document.querySelectorAll('.kds-zone-chip');
  //     expect(chips[0]?.classList.contains('kds-zone-chip--active')).toBe(false);
  //     expect(chips[2]?.classList.contains('kds-zone-chip--active')).toBe(true);
  //   });
  // });

  it('activates clicked zone chip', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // Click the "Grill" zone chip — the subscribed prefs store re-renders
    // the screen naturally (same persist+notify contract as the real hook).
    await userEvent.click(screen.getByText('Grill'));

    // Grill chip becomes active and All chip becomes inactive.
    await waitFor(() => {
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
      expect(screen.getByText('All').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(false);
    });
  });

  //   it('resets to All zone when All chip is clicked', async () => {
  //   mockGetKdsQueue.mockResolvedValue([
  //     makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
  //   ]);
  //   renderScreen();
  //   await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

  //   // First click Grill to activate a specific zone
  //   await userEvent.click(screen.getByText('Grill'));
  //   await waitFor(() => {
  //     expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //   });

  //   // Then click All to reset
  //   await userEvent.click(screen.getByText('All'));
  //   await waitFor(() => {
  //     expect(screen.getByText('All').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //     expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(false);
  //   });
  // });

  it('resets to All zone when All chip is clicked', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // First click Grill to activate a specific zone
    await userEvent.click(screen.getByText('Grill'));
    await waitFor(() => {
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
    });

    // Then click All to reset
    await userEvent.click(screen.getByText('All'));
    await waitFor(() => {
      expect(screen.getByText('All').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(false);
    });
  });

  // ── 3a: Zone-switching filtering tests ──────────────────────
  //   it('shows only Grill orders when Grill zone is selected', async () => {
  //   const allOrders = [
  //     makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
  //     makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
  //     makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
  //   ];
  //   mockGetKdsQueue.mockResolvedValue(allOrders);

  //   renderScreen();
  //   await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

  //   // Click the Grill zone chip
  //   await userEvent.click(screen.getByText('Grill'));
  //   await waitFor(() => {
  //     expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //   });

  //   // Should only show Grill orders (o-1 and o-3)
  //   expect(screen.getByText('#101')).toBeInTheDocument();
  //   expect(screen.queryByText('#102')).not.toBeInTheDocument(); // Fry order should be hidden
  //   expect(screen.getByText('#103')).toBeInTheDocument();
  // });

  it('shows only Grill orders when Grill zone is selected', async () => {
    const allOrders = [
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
      makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
    ];
    mockGetKdsQueue.mockResolvedValue(allOrders);

    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // Click the Grill zone chip
    await userEvent.click(screen.getByText('Grill'));
    await waitFor(() => {
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
    });

    // Should only show Grill orders (o-1 and o-3)
    await waitFor(() => {
      expect(screen.getByText('#101')).toBeDefined();
      expect(screen.queryByText('#102')).toBeNull(); // Fry order should be hidden
      expect(screen.getByText('#103')).toBeDefined();
    });
  });

  // it('shows only Fry orders when Fry zone is selected', async () => {
  //   const allOrders = [
  //     makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
  //     makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
  //     makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
  //   ];
  //   mockGetKdsQueue.mockResolvedValue(allOrders);

  //   renderScreen();
  //   await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

  //   // Click the Fry zone chip
  //   await userEvent.click(screen.getByText('Fry'));
  //   await waitFor(() => {
  //     expect(screen.getByText('Fry').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //   });

  //   // Should only show Fry orders (o-2)
  //   expect(screen.queryByText('#101')).not.toBeInTheDocument(); // Grill order should be hidden
  //   expect(screen.getByText('#102')).toBeInTheDocument();
  //   expect(screen.queryByText('#103')).not.toBeInTheDocument(); // Grill order should be hidden
  // });

  it('shows only Fry orders when Fry zone is selected', async () => {
    const allOrders = [
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
      makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
    ];
    mockGetKdsQueue.mockResolvedValue(allOrders);

    renderScreen();
    await waitFor(() => expect(screen.getByText('#102')).toBeDefined());

    // Click the Fry zone chip
    await userEvent.click(screen.getByText('Fry'));
    await waitFor(() => {
      expect(screen.getByText('Fry').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
    });

    // Should only show Fry orders (o-2)
    await waitFor(() => {
      expect(screen.queryByText('#101')).toBeNull(); // Grill order should be hidden
      expect(screen.getByText('#102')).toBeDefined();
      expect(screen.queryByText('#103')).toBeNull(); // Grill order should be hidden
    });
  });

  // it('shows all orders when All zone is selected', async () => {
  //   const allOrders = [
  //     makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
  //     makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
  //     makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
  //   ];
  //   mockGetKdsQueue.mockResolvedValue(allOrders);

  //   renderScreen();
  //   await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

  //   // Click the Grill zone chip first
  //   await userEvent.click(screen.getByText('Grill'));
  //   await waitFor(() => {
  //     expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //   });

  //   // Then click All to reset
  //   await userEvent.click(screen.getByText('All'));
  //   await waitFor(() => {
  //     expect(screen.getByText('All').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
  //     expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(false);
  //   });

  //   // Should show all orders
  //   expect(screen.getByText('#101')).toBeInTheDocument();
  //   expect(screen.getByText('#102')).toBeInTheDocument();
  //   expect(screen.getByText('#103')).toBeInTheDocument();
  // });

  it('shows all orders when All zone is selected', async () => {
    const allOrders = [
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, kitchen_zone: 'Grill' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102, kitchen_zone: 'Fry' }),
      makeOrder({ id: 'o-3', status: 'pending', display_number: 103, kitchen_zone: 'Grill' }),
    ];
    mockGetKdsQueue.mockResolvedValue(allOrders);

    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    // Click the Grill zone chip first
    await userEvent.click(screen.getByText('Grill'));
    await waitFor(() => {
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
    });

    // Then click All to reset
    await userEvent.click(screen.getByText('All'));
    await waitFor(() => {
      expect(screen.getByText('All').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(true);
      expect(screen.getByText('Grill').closest('.kds-zone-chip')?.classList.contains('kds-zone-chip--active')).toBe(false);
    });

    // Should show all orders — the unfiltered refetch returns the Fry
    // ticket that the Grill-only view had dropped.
    await waitFor(() => {
      expect(screen.getByText('#102')).toBeDefined();
    });
    expect(screen.getByText('#101')).toBeDefined();
    expect(screen.getByText('#103')).toBeDefined();
  });

  // ── 2b: Open / Completed tab navigation ───────────────────────

  it('renders the Open/Completed tab bar', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const tabs = document.querySelector('.kds-tabs');
      expect(tabs).not.toBeNull();
      expect(document.querySelector('.kds-tab')).not.toBeNull();
    });
  });

  it('shows completed view when the Completed tab is clicked', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const tab = document.querySelector('[data-testid="kds-tab-completed"]');
      expect(tab).not.toBeNull();
    });

    // Click the Completed tab
    const tab = document.querySelector('[data-testid="kds-tab-completed"]') as HTMLButtonElement;
    await userEvent.click(tab);

    // Completed view should render (prototype bucket columns)
    await waitFor(() => {
      expect(document.querySelector('.kds-main.completed-view')).not.toBeNull();
    });
  });

  it('switches between Open and Completed tabs on horizontal swipe gestures', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.kds-main-viewport')).not.toBeNull();
    });

    const viewport = document.querySelector('.kds-main-viewport') as HTMLElement;

    // Swipe left (from Open to Completed)
    fireEvent.touchStart(viewport, {
      touches: [{ clientX: 300, clientY: 100 }],
    });
    fireEvent.touchEnd(viewport, {
      changedTouches: [{ clientX: 100, clientY: 100 }],
    });

    await waitFor(() => {
      expect(document.querySelector('.kds-main.completed-view')).not.toBeNull();
    });

    // Swipe right (from Completed back to Open)
    fireEvent.touchStart(viewport, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    fireEvent.touchEnd(viewport, {
      changedTouches: [{ clientX: 300, clientY: 100 }],
    });

    await waitFor(() => {
      expect(document.querySelector('.kds-main:not(.completed-view)')).not.toBeNull();
    });
  });

  // ── 3d: Voice callout tests ────────────────────────────────────

  it('announces order up via TTS when ticket advances to ready', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'preparing', display_number: 42 }),
    ]);
    mockUpdateKdsStatus.mockResolvedValue({});

    renderScreen();
    await waitFor(() => expect(screen.getByText('#42')).toBeDefined());

    const advanceBtn = document.querySelector('[data-testid="kds-order-card-42-status-advance"]') as HTMLButtonElement;
    expect(advanceBtn).not.toBeNull();
    await userEvent.click(advanceBtn);

    await waitFor(() =>
      expect(mockUpdateKdsStatus).toHaveBeenCalledWith('o-1', 'ready'),
    );

    // Should have called speak with the TTS string
    await waitFor(() =>
      expect(mockSpeak).toHaveBeenCalledWith('Order 42 up!'),
    );
  });

  it('does not announce when advancing to preparing (only on ready)', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 42 }),
    ]);
    mockUpdateKdsStatus.mockResolvedValue({});

    renderScreen();
    await waitFor(() => expect(screen.getByText('#42')).toBeDefined());

    const advanceBtn = document.querySelector('[data-testid="kds-order-card-42-status-advance"]') as HTMLButtonElement;
    expect(advanceBtn).not.toBeNull();
    await userEvent.click(advanceBtn);

    await waitFor(() =>
      expect(mockUpdateKdsStatus).toHaveBeenCalledWith('o-1', 'preparing'),
    );

    // speak should NOT have been called (not advancing to ready)
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('navigates selection with ArrowDown and ArrowUp', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending' }),
      makeOrder({ id: 'o-2', status: 'pending', display_number: 102 }),
      makeOrder({ id: 'o-3', status: 'pending', display_number: 103 }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('#101')).toBeDefined());

    const kds = document.querySelector('.kds')!;
    // Start at second order
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    await waitFor(() => {
      const tickets = document.querySelectorAll('.kds-ticket');
      expect(tickets[1]?.classList.contains('kds-ticket--selected')).toBe(true);
    });

    // ArrowDown goes to third
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await waitFor(() => {
      const tickets = document.querySelectorAll('.kds-ticket');
      expect(tickets[2]?.classList.contains('kds-ticket--selected')).toBe(true);
    });

    // ArrowUp goes back to second
    kds.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await waitFor(() => {
      const tickets = document.querySelectorAll('.kds-ticket');
      expect(tickets[1]?.classList.contains('kds-ticket--selected')).toBe(true);
    });
  });

  it('a double-tap on the picker Confirm adds the items once (no duplicate merge)', async () => {
    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    mockGetKdsOrderLines.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([
      {
        sku: 'ESPR', name: 'Espresso Shot', category: 'Hot Drinks',
        price: { minor_units: 15000, currency: 'IDR' }, barcode: '8990000000001',
        in_stock: true, stock_qty: 10, tax_rate_ids: [], created_at: '',
        price_updated_at: '', product_type: 'restaurant',
      },
    ]);
    // Defer the merge so the modal stays open with Confirm enabled — the
    // second tap lands while the first merge is still in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockUpdateKdsOrderItems.mockReturnValue(gate.then(() => ({ id: 'o-1' })));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add items to order/i }));
    await waitFor(() => expect(screen.getByText('Espresso Shot')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^espresso shot( \(added\))?$/i }));
    const confirmBtn = screen.getByRole('button', { name: /add .* item/i });
    await userEvent.click(confirmBtn);
    // The modal surfaces the in-flight save: Confirm disables until release.
    await waitFor(() => expect(confirmBtn).toBeDisabled());
    await userEvent.click(confirmBtn); // double-tap before the merge resolves

    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The second tap must NOT re-merge the picked items onto the ticket.
    expect(mockUpdateKdsOrderItems).toHaveBeenCalledTimes(1);
  });

  // ── Topbar filter dropdown (All / Prepared) ────────────────────

  it('renders the filter button and filters to prepared (ready) orders', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, items_summary: 'Burger' }),
      makeOrder({ id: 'o-2', status: 'ready', display_number: 102, items_summary: 'Fries' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger')).toBeDefined());
    expect(screen.getByText('Fries')).toBeDefined();

    // Open the filter dropdown and pick "Prepared".
    await userEvent.click(screen.getByTestId('kds-topbar-filter'));
    await userEvent.click(screen.getByTestId('kds-filter-mode-prepared'));

    // Only the ready order remains visible.
    await waitFor(() => {
      expect(screen.queryByText('Burger')).toBeNull();
      expect(screen.getByText('Fries')).toBeDefined();
    });

    // Open tab count reflects filtered orders count (1 order)
    expect(screen.getByTestId('kds-tab-open').textContent).toContain('1');
  });

  it('filter button shows "All orders" label in the default state', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const filter = screen.getByTestId('kds-topbar-filter');
      expect(filter.textContent).toMatch(/all/i);
    });
  });

  it('supports multi-selecting zones without closing the panel and formats label', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', kitchen_zone: 'Grill', items_summary: 'Steak' }),
      makeOrder({ id: 'o-2', kitchen_zone: 'Bar', items_summary: 'Beer' }),
      makeOrder({ id: 'o-3', kitchen_zone: 'Bakery', items_summary: 'Bread' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Steak')).toBeDefined());

    // Open filter dropdown
    await userEvent.click(screen.getByTestId('kds-topbar-filter'));
    const panel = screen.getByRole('listbox', { name: /filter orders/i });
    expect(panel).toBeDefined();

    // Click Grill zone — panel stays open for multi-selection
    await userEvent.click(screen.getByTestId('kds-filter-zone-Grill'));
    expect(screen.getByRole('listbox', { name: /filter orders/i })).toBeDefined();
    expect(screen.getByTestId('kds-topbar-filter').textContent).toContain('Grill');

    // Click Bar zone — panel stays open and label updates to "2 selected"
    await userEvent.click(screen.getByTestId('kds-filter-zone-Bar'));
    expect(screen.getByRole('listbox', { name: /filter orders/i })).toBeDefined();
    expect(screen.getByTestId('kds-topbar-filter').textContent).toMatch(/2.*selected/);

    // Filtered orders show Steak and Beer, Bread is hidden
    await waitFor(() => {
      expect(screen.getByText('Steak')).toBeDefined();
      expect(screen.getByText('Beer')).toBeDefined();
      expect(screen.queryByText('Bread')).toBeNull();
    });
  });

  it('navigates filtered orders with keyboard shortcuts 1-9 without selecting hidden orders', async () => {
    mockGetKdsQueue.mockResolvedValue([
      makeOrder({ id: 'o-1', status: 'pending', display_number: 101, items_summary: 'Burger' }),
      makeOrder({ id: 'o-2', status: 'ready', display_number: 102, items_summary: 'Fries' }),
      makeOrder({ id: 'o-3', status: 'ready', display_number: 103, items_summary: 'Shake' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger')).toBeDefined());

    // Filter to prepared (ready) -> o-2 and o-3
    await userEvent.click(screen.getByTestId('kds-topbar-filter'));
    await userEvent.click(screen.getByTestId('kds-filter-mode-prepared'));

    await waitFor(() => {
      expect(screen.queryByText('Burger')).toBeNull();
    });

    // Press '1' -> should select o-2 (the 1st visible filtered order, Fries)
    await userEvent.keyboard('1');
    const friesCard = screen.getByText('Fries').closest('.kds-ticket');
    expect(friesCard?.classList.contains('kds-ticket--selected')).toBe(true);

    // Press '2' -> should select o-3 (the 2nd visible filtered order, Shake)
    await userEvent.keyboard('2');
    const shakeCard = screen.getByText('Shake').closest('.kds-ticket');
    expect(shakeCard?.classList.contains('kds-ticket--selected')).toBe(true);
  });

  it('supports filtering on the Completed tab by order type (All / Dine in / Takeaway)', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    mockListKdsOrdersScoped.mockResolvedValue([
      makeOrder({ id: 'done-1', status: 'served', display_number: 101, table_number: 'T4' }),
      makeOrder({ id: 'done-2', status: 'served', display_number: 102, table_number: null }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-filter')).toBeDefined();
    });

    // Switch to Completed tab
    await userEvent.click(screen.getByTestId('kds-tab-completed'));
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-filter')).toBeDefined();
    });

    // Open filter dropdown on Completed tab
    await userEvent.click(screen.getByTestId('kds-topbar-filter'));
    expect(screen.getByTestId('kds-filter-completed-all')).toBeDefined();
    expect(screen.getByTestId('kds-filter-completed-dinein')).toBeDefined();
    expect(screen.getByTestId('kds-filter-completed-takeaway')).toBeDefined();

    // Select Dine in mode
    await userEvent.click(screen.getByTestId('kds-filter-completed-dinein'));
    await waitFor(() => {
      expect(screen.getByText('#101')).toBeDefined();
      expect(screen.queryByText('#102')).toBeNull();
    });

    // Select Takeaway mode
    await userEvent.click(screen.getByTestId('kds-topbar-filter'));
    await userEvent.click(screen.getByTestId('kds-filter-completed-takeaway'));
    await waitFor(() => {
      expect(screen.getByText('#102')).toBeDefined();
      expect(screen.queryByText('#101')).toBeNull();
    });
  });

  it('closes the filter dropdown on Escape key and refocuses trigger button', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-filter')).toBeDefined();
    });

    // Open dropdown
    const filterBtn = screen.getByTestId('kds-topbar-filter');
    await userEvent.click(filterBtn);
    expect(screen.getByRole('listbox')).toBeDefined();

    // Press Escape inside listbox panel
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  // ── Shift button + confirm modal ───────────────────────────────

  it('starts a shift directly and ends it via the confirm modal', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-shift')).not.toBeNull();
    });

    // Start shift — direct, no confirmation.
    await userEvent.click(screen.getByTestId('kds-topbar-shift'));
    expect(screen.getByText('End Shift')).toBeTruthy();

    // End shift — opens the confirm modal.
    await userEvent.click(screen.getByTestId('kds-topbar-shift'));
    await waitFor(() => {
      expect(document.querySelector('.kds-modal')).not.toBeNull();
    });

    // Cancel keeps the shift active.
    await userEvent.click(screen.getByTestId('kds-confirm-cancel'));
    await waitFor(() => {
      expect(document.querySelector('.kds-modal')).toBeNull();
    });
    expect(screen.getByText('End Shift')).toBeTruthy();

    // Confirm ends the shift.
    await userEvent.click(screen.getByTestId('kds-topbar-shift'));
    await waitFor(() => {
      expect(document.querySelector('.kds-modal')).not.toBeNull();
    });
    await userEvent.click(screen.getByTestId('kds-confirm-ok'));
    await waitFor(() => {
      expect(document.querySelector('.kds-modal')).toBeNull();
    });
    expect(screen.getByText('Start Shift')).toBeTruthy();
  });

  // ── Card colours pickers ───────────────────────────────────────

  it('renders card colour pickers in the hamburger and updates a colour', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-settings')).not.toBeNull();
    });

    // Open the hamburger panel.
    await userEvent.click(screen.getByTestId('kds-topbar-settings'));
    await waitFor(() => {
      expect(document.querySelector('.kds-hamburger-panel')).not.toBeNull();
    });

    // Card Colours section with native + hex pickers for dinein.
    const native = document.querySelector('[data-testid="kds-settings-colors-native-dinein"]') as HTMLInputElement;
    expect(native).not.toBeNull();
    const hex = document.querySelector('[data-testid="kds-settings-colors-hex-dinein"]') as HTMLInputElement;
    expect(hex).not.toBeNull();

    // Changing the native picker updates the hex field.
    fireEvent.change(native, { target: { value: '#ff00aa' } });
    expect(hex.value).toBe('#ff00aa');
  });

  it('renders and toggles hardware acceleration switch in the hamburger panel', async () => {
    mockGetKdsQueue.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('kds-topbar-settings')).not.toBeNull();
    });

    // Open hamburger panel
    await userEvent.click(screen.getByTestId('kds-topbar-settings'));
    await waitFor(() => {
      expect(document.querySelector('.kds-hamburger-panel')).not.toBeNull();
    });

    const toggle = screen.getByTestId('kds-settings-hw-accel-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Click toggle to disable
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.getAttribute('data-hw-accel')).toBe('disabled');

    // Click toggle to re-enable
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.hasAttribute('data-hw-accel')).toBe(false);
  });

  // ── PERF-KDS-01: the realtime subscription / fetch loop ────────────
  //
  // The board used to re-create `fetchOrders` on every successful fetch
  // (because `wrapFetch` closed over the cache it had just written, and the
  // callback also depended on the pending-queue length). The subscribe effect
  // depended on `fetchOrders`, so each fetch tore down and rebuilt the Tauri
  // event listener and fired another fetch — an unbounded loop that exhausted
  // the WebView2 PostMessage queue on Windows (0x80070718, "Not enough quota
  // is available to process this command") and made opening KDS lag.

  it('subscribes to kds:orders-changed exactly once per mount', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const listenMock = vi.mocked(listen);
    listenMock.mockClear();

    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());

    const kdsSubscriptions = listenMock.mock.calls.filter(
      ([event]) => event === 'kds:orders-changed',
    );
    expect(kdsSubscriptions).toHaveLength(1);
  });

  it('does not re-fetch the queue in a loop after the initial load', async () => {
    // A fresh array per call is what the real IPC boundary returns — every
    // `invoke` deserializes a new object graph. That identity change is what
    // made the old `wrapFetch` (which closed over the cache it had just
    // written) produce a new callback, re-run the subscribe effect, and fetch
    // again. With `mockResolvedValue` the identity is stable and the loop
    // stays hidden, so this test must build the payload per call.
    mockGetKdsQueue.mockImplementation(() => Promise.resolve([makeOrder()]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());

    const afterFirstPaint = mockGetKdsQueue.mock.calls.length;
    // Let every already-scheduled microtask/effect settle. The pre-fix board
    // issued ~900 fetches per second here.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockGetKdsQueue.mock.calls.length).toBe(afterFirstPaint);
  });

  it('re-fetches when the realtime event fires', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const listenMock = vi.mocked(listen);
    listenMock.mockClear();

    mockGetKdsQueue.mockResolvedValue([makeOrder()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Burger x1, Fries x1')).toBeDefined());

    const subscription = listenMock.mock.calls.find(
      ([event]) => event === 'kds:orders-changed',
    );
    expect(subscription).toBeDefined();
    const handler = subscription![1] as (payload: unknown) => void;

    const before = mockGetKdsQueue.mock.calls.length;
    await act(async () => {
      handler({ event: 'kds:orders-changed', id: 1, payload: null });
    });

    // Push still drives a refresh — the loop fix must not disable realtime.
    expect(mockGetKdsQueue.mock.calls.length).toBeGreaterThan(before);
  });
});
