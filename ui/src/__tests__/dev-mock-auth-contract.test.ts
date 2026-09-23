import { afterEach, describe, expect, it, vi } from 'vitest';
// The vite config aliases @tauri-apps/api/core to the dev-mock in browser
// dev mode, so this test pins the mock's auth contract directly against
// the same module the app actually calls in dev.
//
// test-setup.ts globally mocks `@tauri-apps/api/event` (SettingsContext's
// dynamic import needs a stub in jsdom). This file imports the real
// dev-mock event module, so the global mock must be lifted here.
vi.unmock('@tauri-apps/api/event');
import { invoke, convertFileSrc, isTauri } from '@/dev-mock/tauri-api';
import { emit, listen } from '@/dev-mock/tauri-event';
import type { StaffLoginResult, BootstrapOwnerResult } from '@/api/staff';

// ── Real-webview delegation (Jul 2026 production regression) ───────────
// The vite alias used to be unconditional, so production builds bundled the
// mock and the packaged app silently ran on mock data. The mock must
// delegate to window.__TAURI_INTERNALS__ whenever a real Tauri webview is
// present, and only serve mock data in a plain browser (dev preview / E2E).

const fakeInternalsInvoke = vi.fn();

function installFakeInternals() {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: fakeInternalsInvoke,
    transformCallback: (cb: (e: unknown) => void) => ({ id: 42, cb }),
    convertFileSrc: (p: string) => `asset://${p}`,
  };
}

function removeFakeInternals() {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

afterEach(() => {
  removeFakeInternals();
  fakeInternalsInvoke.mockReset();
});

// audit-open-findings regression: the real backend mints a picker ticket at login and
// first-owner bootstrap. WorkspaceProvider bails (availableWorkspaces stays
// []) when pickerTicket is null, which renders "No workspaces available"
// for EVERY user in browser dev previews — even owner. The mock must keep
// parity with the backend contract or the picker can never load in dev.
describe('dev-mock auth contract (audit-open-findings picker ticket parity)', () => {
  it('staff_login returns a picker_ticket alongside the session', async () => {
    const result = (await invoke('staff_login', {
      args: { username: 'owner', pin: '1234' },
    })) as unknown as StaffLoginResult;

    // 'staff-1', not 'owner-1': the session's user_id must be an id
    // `list_staff_scoped` actually serves, so a preview's own identity can be
    // matched against its own roster row. The old value was the seed's private
    // id, which named the Owner here and the Staff member on the roster —
    // see dev-mock-staff-identity.test.ts for the invariant.
    expect(result.session.user_id).toBe('staff-1');
    expect(typeof result.picker_ticket).toBe('string');
    expect(result.picker_ticket.length).toBeGreaterThan(0);
    expect(result.picker_ticket).toMatch(/^mock-picker-/);
  });

  it('bootstrap_owner returns a picker_ticket alongside the session', async () => {
    const result = (await invoke('bootstrap_owner', {
      args: { username: 'new-owner', pin: '1234', display_name: 'New Owner' },
    })) as unknown as BootstrapOwnerResult;

    expect(result.session.role_name).toBe('Owner');
    expect(result.session.role_id).toBe('role-owner');
    expect(typeof result.picker_ticket).toBe('string');
    expect(result.picker_ticket.length).toBeGreaterThan(0);
  });

  it('the picker listing is reachable once a ticket is returned', async () => {
    const login = (await invoke('staff_login', {
      args: { username: 'staff', pin: '1234' },
    })) as unknown as StaffLoginResult;

    // The mock ignores the ticket (no real verification), but the listing
    // must return workspace instances so the picker renders in dev.
    const workspaces = (await invoke('list_workspaces', {
      ticket: login.picker_ticket,
      storeId: 'store-1',
    })) as unknown as unknown[];

    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
  });
});

// The real backend persists the open shift (with opened_at) to the store
// `shifts` table, so a restart resumes the elapsed clock from the original
// opening time. The mock previously rebuilt the shift with `openedAt: new
// Date()` at module load, which reset the resto-POS "Current Order" shift
// duration to 0m on every reload. Pin the localStorage-backed contract so
// previews mirror the DB across page reloads.
describe('dev-mock active-shift persistence (restart parity)', () => {
  const KEY = 'oz-dev-mock:active-shift';

  afterEach(() => {
    localStorage.removeItem(KEY);
    vi.resetModules();
  });

  it('a previously opened shift survives a module reload with its openedAt', async () => {
    // Open a shift, then simulate a restart: re-import the module so the
    // in-memory copy is rebuilt from localStorage (like a fresh page load).
    const first = await import('@/dev-mock/tauri-api');
    const opened = (await first.invoke('open_shift_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { openedAt: string };
    const openedAt = opened.openedAt;

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const reloaded = (await second.invoke('get_active_shift_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { openedAt: string; status: string } | null;

    expect(reloaded).not.toBeNull();
    expect(reloaded?.status).toBe('open');
    // The clock must resume from the ORIGINAL opening time, not re-baseline
    // to the reload moment — otherwise the elapsed duration resets to 0m.
    expect(reloaded?.openedAt).toBe(openedAt);
  });

  it('closing the shift clears the persisted copy so a reload sees no active shift', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('open_shift_scoped', { sessionToken: 'session-1' });
    await first.invoke('close_shift_scoped', {
      sessionToken: 'session-1',
      args: { id: 'shift-1', closingBalanceMinor: 0, notes: null },
    });

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const reloaded = (await second.invoke('get_active_shift_scoped', {
      sessionToken: 'session-1',
    })) as unknown as unknown;

    expect(reloaded).toBeNull();
  });
});

// The real backend persists active-cart lines and completed sales in the
// store DB, so a restart resumes exactly where the operator left off. The
// mock previously kept cartState / completedSales in module memory, so a
// reloaded preview dropped the in-progress cart and lost sales history.
// Pin the localStorage-backed contract so previews mirror the DB.
describe('dev-mock cart + sales persistence (restart parity)', () => {
  const CART_KEY = 'oz-dev-mock:cart';
  const SALES_KEY = 'oz-dev-mock:sales';

  afterEach(() => {
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem(SALES_KEY);
    vi.resetModules();
  });

  it('an in-progress cart survives a module reload with its lines', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await first.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'LATTE', qty: 2 },
    });

    // Simulate a restart: re-import the module so the in-memory copy is
    // rebuilt from localStorage (like a fresh page load).
    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const completed = (await second.invoke('complete_sale_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { lineCount: number; total: { minor_units: number } };

    // The cart was rebuilt from storage, so the sale reflects the pre-reload lines.
    expect(completed.lineCount).toBe(1);
    expect(completed.total.minor_units).toBe(2 * 45000);
  });

  it('a completed sale survives a reload and its detail view resolves', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await first.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'LATTE', qty: 1 },
    });
    const sale = (await first.invoke('complete_sale_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { saleId: string };

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const sales = (await second.invoke('list_sales_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { sales: Array<{ id: string }> };
    const detail = (await second.invoke('get_sale_scoped', {
      id: sale.saleId,
    })) as unknown as { id: string; lines: unknown[] } | null;

    expect(sales.sales.some(s => s.id === sale.saleId)).toBe(true);
    expect(detail?.id).toBe(sale.saleId);
    expect(detail?.lines.length).toBe(1);
  });

  it('starting a new sale clears the persisted cart so a reload starts fresh', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await first.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'LATTE', qty: 1 },
    });
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const completed = (await second.invoke('complete_sale_scoped', {
      sessionToken: 'session-1',
    })) as unknown as { lineCount: number };

    // The empty cart was persisted on start_sale, so the reloaded sale is empty.
    expect(completed.lineCount).toBe(0);
  });
});

describe('dev-mock delegates to a real Tauri webview (production regression)', () => {
  it('invoke passes through to window.__TAURI_INTERNALS__ when present', async () => {
    installFakeInternals();
    fakeInternalsInvoke.mockResolvedValue({ real: 'backend' });

    const result = await invoke('any_command', { a: 1 });

    // Delegated — the fake internals got the call, not the mock handlers.
    expect(fakeInternalsInvoke).toHaveBeenCalledWith('any_command', { a: 1 }, undefined);
    expect(result).toEqual({ real: 'backend' });
  });

  it('defaults missing args to {} like the real invoke signature', async () => {
    installFakeInternals();
    fakeInternalsInvoke.mockResolvedValue(undefined);

    await invoke('argument_less_command');

    expect(fakeInternalsInvoke).toHaveBeenCalledWith('argument_less_command', {}, undefined);
  });

  it('serves mock data in a plain browser (no internals)', async () => {
    const result = (await invoke('staff_login', {
      args: { username: 'owner', pin: '1234' },
    })) as unknown as StaffLoginResult;

    expect(fakeInternalsInvoke).not.toHaveBeenCalled();
    expect(result.session.user_id).toBe('staff-1');
  });

  it('convertFileSrc and isTauri reflect the webview state', () => {
    expect(isTauri()).toBe(false);
    expect(convertFileSrc('/tmp/x.png')).toBe('/tmp/x.png');

    installFakeInternals();
    expect(isTauri()).toBe(true);
    expect(convertFileSrc('/tmp/x.png')).toBe('asset:///tmp/x.png');
  });

  it('event emit/listen delegate to the real event plugin when present', async () => {
    installFakeInternals();
    fakeInternalsInvoke.mockResolvedValue(7);

    const unlisten = await listen('kds:orders-changed', () => {});
    await emit('kds:orders-changed', { id: 'x' });

    expect(fakeInternalsInvoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({ event: 'kds:orders-changed' }));
    expect(fakeInternalsInvoke).toHaveBeenCalledWith('plugin:event|emit', {
      event: 'kds:orders-changed',
      payload: { id: 'x' },
    });

    await unlisten();
    expect(fakeInternalsInvoke).toHaveBeenCalledWith('plugin:event|unlisten', { event: 'kds:orders-changed', eventId: 7 });
  });
});

// The real backend persists held carts in `held_carts` (013), so a preview
// restart must not turn a parked order into an empty list. The mock currently
// returns hardcoded empty held-cart data, which makes the hold/resume flow
// impossible to exercise in browser previews.
describe('dev-mock held-cart persistence (restart parity)', () => {
  const HELD_CART_KEY = 'oz-dev-mock:held-carts';

  afterEach(() => {
    localStorage.removeItem(HELD_CART_KEY);
    vi.resetModules();
  });

  it('holding a cart makes its summary visible to the held-cart listing', async () => {
    const first = await import('@/dev-mock/tauri-api');
    const cartData = JSON.stringify({
      lines: [
        {
          sku: 'LATTE',
          name: 'Caffè Latte',
          category: 'Hot Drinks',
          qty: 2,
          unit_price: { minor_units: 45000, currency: 'IDR' },
        },
      ],
    });

    const created = (await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Hold #42',
        cart_data: cartData,
        item_count: 1,
        total_minor: 90000,
        currency: 'IDR',
        bill_type: 'hold',
      },
    })) as unknown as { id: string };

    const carts = (await first.invoke('list_held_carts_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;

    expect(carts).toEqual([
      expect.objectContaining({
        id: created.id,
        label: 'Hold #42',
        item_count: 1,
        total_minor: 90000,
        currency: 'IDR',
        bill_type: 'hold',
      }),
    ]);
  });

  it('held-cart detail survives a module reload for resume', async () => {
    const first = await import('@/dev-mock/tauri-api');
    const cartData = JSON.stringify({
      lines: [{ sku: 'LATTE', name: 'Caffè Latte', qty: 2 }],
      discountPercent: 10,
    });
    const created = (await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Resume me',
        cart_data: cartData,
        item_count: 1,
        total_minor: 81000,
        currency: 'IDR',
        bill_type: 'hold',
        customer_name: 'Ada',
        deduction_location_id: 'loc-1',
      },
    })) as unknown as { id: string };

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const detail = (await second.invoke('get_held_cart_scoped', {
      sessionToken: 'session-1',
      id: created.id,
    })) as unknown as Record<string, unknown> | null;

    expect(detail).toEqual(expect.objectContaining({
      id: created.id,
      label: 'Resume me',
      cart_data: cartData,
      customer_name: 'Ada',
      deduction_location_id: 'loc-1',
    }));
  });

  it('open-bill listing separates table bills from parked holds', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Parked hold',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        bill_type: 'hold',
      },
    });
    await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Table 4',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        bill_type: 'open_bill',
      },
    });

    const openBills = (await first.invoke('list_open_bills_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;
    expect(openBills).toHaveLength(1);
    expect(openBills[0]?.['label']).toBe('Table 4');
    expect(openBills[0]?.['bill_type']).toBe('open_bill');
  });

  it('deleting a held cart removes it from the listing', async () => {
    const first = await import('@/dev-mock/tauri-api');
    const created = (await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Delete me',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        bill_type: 'hold',
      },
    })) as unknown as { id: string };

    await first.invoke('delete_held_cart_scoped', {
      sessionToken: 'session-1',
      id: created.id,
    });

    const carts = (await first.invoke('list_held_carts_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;
    expect(carts).toEqual([]);
  });

  it('filters malformed persisted rows before exposing them to the preview', async () => {
    const first = await import('@/dev-mock/tauri-api');
    const created = (await first.invoke('hold_cart_scoped', {
      sessionToken: 'session-1',
      args: {
        label: 'Keep me',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        bill_type: 'hold',
      },
    })) as unknown as { id: string };
    const persisted = JSON.parse(localStorage.getItem(HELD_CART_KEY) ?? '[]') as unknown[];
    localStorage.setItem(HELD_CART_KEY, JSON.stringify([
      { id: 'broken-row', total_minor: 'not-a-number' },
      ...persisted,
    ]));

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const carts = (await second.invoke('list_held_carts_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;

    expect(carts).toEqual([
      expect.objectContaining({ id: created.id, label: 'Keep me' }),
    ]);
  });

  it('does not reuse a held-cart id after deletion in the same clock tick', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_754_713_600_000);
    const first = await import('@/dev-mock/tauri-api');
    const args = {
      sessionToken: 'session-1',
      args: {
        label: 'Collision test',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        bill_type: 'hold',
      },
    };

    const firstHeld = (await first.invoke('hold_cart_scoped', args)) as unknown as { id: string };
    await first.invoke('delete_held_cart_scoped', {
      sessionToken: 'session-1',
      id: firstHeld.id,
    });
    const secondHeld = (await first.invoke('hold_cart_scoped', args)) as unknown as { id: string };

    expect(secondHeld.id).not.toBe(firstHeld.id);
    now.mockRestore();
  });
});

// The real backend persists KDS orders (kds_orders 032), per-item line
// statuses (kds_line_items 105), and the daily display counter
// (kds_daily_counters 032), so a restart resumes the kitchen queue exactly
// where the operator left off. The mock previously kept all three in module
// memory — a reloaded preview wiped the queue, reverted every status, and
// restarted ticket numbering at 104. Pin the localStorage-backed contract so
// previews mirror the DB across page reloads.
describe('dev-mock KDS persistence (restart parity)', () => {
  const KDS_KEY = 'oz-dev-mock:kds';

  afterEach(() => {
    localStorage.removeItem(KDS_KEY);
    vi.resetModules();
  });

  it('a pushed KDS order and its line items survive a module reload', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await first.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'ESPR', qty: 1 },
    });
    // complete_sale_scoped pushes a KDS order derived from the cart lines.
    // '1x Espresso Shot' is unambiguous — the seeds carry different summaries.
    await first.invoke('complete_sale_scoped', { sessionToken: 'session-1' });

    // Simulate a restart: re-import the module so the in-memory copy is
    // rebuilt from localStorage (like a fresh page load).
    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const queue = (await second.invoke('get_kds_queue_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;

    // The pushed order must be in the reloaded queue, not just the 3 seeds.
    const pushed = queue.find(
      (o) => o['items_summary'] === '1x Espresso Shot' && o['status'] === 'pending',
    );
    expect(pushed).toBeDefined();
    // …and its course-grouped line items must survive so the ticket renders.
    const lines = (await second.invoke('get_kds_order_lines_scoped', {
      sessionToken: 'session-1',
      args: { orderId: pushed?.['id'] as string },
    })) as unknown as unknown[];
    expect(lines.length).toBe(1);
  });

  it('the display counter continues past the pre-reload ticket number', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await first.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'LATTE', qty: 1 },
    });
    await first.invoke('complete_sale_scoped', { sessionToken: 'session-1' }); // ticket 104

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    await second.invoke('start_sale_scoped', { sessionToken: 'session-1' });
    await second.invoke('add_line_scoped', {
      sessionToken: 'session-1',
      args: { cartId: 'mock-cart-1', sku: 'ESPR', qty: 1 },
    });
    await second.invoke('complete_sale_scoped', { sessionToken: 'session-1' });

    const queue = (await second.invoke('get_kds_queue_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;
    const displayNumbers = queue.map((o) => Number(o['display_number']));
    // Ticket numbering must continue past 104 — not restart at the seed.
    expect(displayNumbers).toContain(105);
  });

  it('a line-item status update survives a module reload', async () => {
    const first = await import('@/dev-mock/tauri-api');
    // Flip a seeded order's line item to 'preparing' (per-item advance).
    const flipped = (await first.invoke('update_kds_line_item_status', {
      args: { itemId: 'kds-line-1-1', status: 'preparing' },
    })) as unknown as { item_status: string } | null;
    expect(flipped?.item_status).toBe('preparing');

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const lines = (await second.invoke('get_kds_order_lines', {
      args: { id: 'kds-order-1' },
    })) as unknown as Array<Record<string, unknown>>;
    expect(lines.find((l) => l['id'] === 'kds-line-1-1')?.['item_status']).toBe('preparing');
  });
});

// The real backend persists login attempts (login_attempts 074 + device
// 111) and closed-shift history (shifts 021), so a reload cannot defeat an
// active lockout and reconciliation history survives restarts. The mock
// kept both in module memory — a reloaded preview bypassed the lockout and
// lost every closed shift (only the seed regenerated). Pin the
// localStorage-backed contracts so previews mirror the DB.
describe('dev-mock lockout + shift-history persistence (restart parity)', () => {
  const LOCK_KEY = 'oz-dev-mock:login-attempts';
  const SHIFT_KEY = 'oz-dev-mock:shift-history';

  afterEach(() => {
    localStorage.removeItem(LOCK_KEY);
    localStorage.removeItem(SHIFT_KEY);
    vi.resetModules();
  });

  it('a lockout survives a module reload so a reloaded page cannot bypass it', async () => {
    const first = await import('@/dev-mock/tauri-api');
    // Four failed attempts for staff → the fifth is blocked.
    for (let i = 0; i < 4; i++) {
      await expect(
        first.invoke('staff_login', { args: { username: 'staff', pin: '0000' } }),
      ).rejects.toThrow(/Invalid credentials/);
    }

    // Simulate a restart: re-import the module so the in-memory copy is
    // rebuilt from localStorage (like a fresh page load).
    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    // Even with the CORRECT pin, the persisted attempt count still blocks.
    await expect(
      second.invoke('staff_login', { args: { username: 'staff', pin: '1234' } }),
    ).rejects.toThrow(/Account locked/);
  });

  it('a successful login clears the persisted lockout', async () => {
    const first = await import('@/dev-mock/tauri-api');
    for (let i = 0; i < 3; i++) {
      await expect(
        first.invoke('staff_login', { args: { username: 'staff', pin: '0000' } }),
      ).rejects.toThrow(/Invalid credentials/);
    }
    // Correct pin resets the counter (the persisted delete must survive).
    await first.invoke('staff_login', { args: { username: 'staff', pin: '1234' } });

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    // A wrong pin afterwards is a fresh first failure, not a lockout.
    await expect(
      second.invoke('staff_login', { args: { username: 'staff', pin: '0000' } }),
    ).rejects.toThrow(/Invalid credentials/);
  });

  it('a closed shift survives a module reload in the shift history', async () => {
    const first = await import('@/dev-mock/tauri-api');
    await first.invoke('open_shift_scoped', { sessionToken: 'session-1' });
    const closed = (await first.invoke('close_shift_scoped', {
      sessionToken: 'session-1',
      args: { id: 'shift-1', closingBalanceMinor: 0, notes: null },
    })) as unknown as { id: string };

    vi.resetModules();
    const second = await import('@/dev-mock/tauri-api');
    const shifts = (await second.invoke('list_shifts_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;

    // The closed shift must be in the reloaded history, not just the seed.
    expect(shifts.some((s) => s['id'] === closed.id)).toBe(true);
  });

  it('a fresh browser seeds exactly the one pre-seeded closed shift', async () => {
    const first = await import('@/dev-mock/tauri-api');
    const shifts = (await first.invoke('list_shifts_scoped', {
      sessionToken: 'session-1',
    })) as unknown as Array<Record<string, unknown>>;
    expect(shifts.length).toBe(1);
    expect(shifts[0]!['id']).toBe('shift-seed-1');
  });
});

// ── The first-run owner-bootstrap seam (has_users) ─────────────────────
//
// `CreatePinScreen` is reached only when the shell reads `has_users: false`,
// and the mock answered a hardcoded `true` — so the screen had no browser
// coverage at all. `?nousers=1` is the opt-in that opens it. The DEFAULT is the
// load-bearing half of this contract: a dev preview that silently reported no
// accounts would drop every developer into first-run bootstrap.
describe('dev-mock has_users seam', () => {
  function setSearch(search: string): void {
    window.history.replaceState({}, '', search === '' ? '/index.html' : `/index.html${search}`);
  }

  afterEach(() => setSearch(''));

  it('answers true by default, so a normal dev preview keeps its seeded owner', async () => {
    setSearch('');
    const res = (await invoke('has_users', {})) as unknown as { has_users: boolean };
    expect(res.has_users).toBe(true);
  });

  it('answers true for any other query string', async () => {
    setSearch('?unprovisioned=1');
    const res = (await invoke('has_users', {})) as unknown as { has_users: boolean };
    expect(res.has_users).toBe(true);
  });

  it('answers false only under ?nousers=1, opening owner bootstrap', async () => {
    setSearch('?nousers=1');
    const res = (await invoke('has_users', {})) as unknown as { has_users: boolean };
    expect(res.has_users).toBe(false);
  });

  it('reads the flag at CALL time, not at module load', async () => {
    // A test must be able to navigate first and invoke after — capturing the
    // flag at import time would freeze the answer of whichever page loaded first.
    setSearch('');
    const first = (await invoke('has_users', {})) as unknown as { has_users: boolean };
    expect(first.has_users).toBe(true);

    setSearch('?nousers=1');
    const second = (await invoke('has_users', {})) as unknown as { has_users: boolean };
    expect(second.has_users).toBe(false);
  });
});