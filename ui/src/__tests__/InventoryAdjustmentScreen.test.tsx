import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import {
  assertAllInvokesHandled,
  recordUnmatchedInvoke,
  resetUnmatchedInvokes,
} from '@/__tests__/test-utils/invokeCoverage';
import { ToastProvider } from '@/components/Toast';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import InventoryAdjustmentScreen from '@/features/inventory/InventoryAdjustmentScreen';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SAMPLE_PRODUCTS: any[] = [
  { sku: 'LATTE', name: 'Caffè Latte', price: { minor_units: 450, currency: 'USD' }, barcode: null, in_stock: true, stock_qty: 20, category: 'Beverages' },
  { sku: 'BAGEL', name: 'Plain Bagel', price: { minor_units: 250, currency: 'USD' }, barcode: '4901234567890', in_stock: true, stock_qty: 5, category: 'Food' },
  { sku: 'BROWNIE', name: 'Fudge Brownie', price: { minor_units: 295, currency: 'USD' }, barcode: null, in_stock: false, stock_qty: 0, category: 'Food' },
];

const { invokeMock } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMock: vi.fn() as any,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  invokeMock.mockClear();
  resetUnmatchedInvokes();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_products_scoped') return Promise.resolve(SAMPLE_PRODUCTS);
    if (cmd === 'adjust_stock_scoped') return Promise.resolve(25);
    recordUnmatchedInvoke(cmd);
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  });
});

afterEach(() => assertAllInvokesHandled('InventoryAdjustmentScreen'));

describe('InventoryAdjustmentScreen', () => {
  it('renders title and step 1', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText(/inventory adjustment/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1\. select product/i)).toBeInTheDocument();
  });

  it('shows search input', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/search by sku/i)).toBeInTheDocument();
  });

  it('shows hint text when no query', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText(/type to search for a product/i)).toBeInTheDocument();
    });
  });

  it('filters products by search', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'latte');
    await waitFor(() => {
      expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    });
  });

  it('selects a product', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'latte');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /caffè latte/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: /caffè latte/i }));
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    expect(screen.getByText('$ 4,50')).toBeInTheDocument();
    expect(screen.getByText((c) => c.includes('20') && c.includes('in stock'))).toBeInTheDocument();
  });

  it('shows step 2 after product selected', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'bagel');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /plain bagel/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: /plain bagel/i }));
    await waitFor(() => {
      expect(screen.getByText(/2\. adjustment details/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/quantity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  // A double submit on Apply must not apply the adjustment TWICE.
  //
  // `handleSubmit` sets `saving` and awaits; `saving` is STATE, so React commits it on
  // its next render -- after the second submit of a real double tap -- and the button's
  // own disabled state is not authoritative in the same task.
  //
  // The backend does NOT refuse the replay, and this is what distinguishes it from the
  // refused-replay screens. `adjust_stock_at_location_with_reason` mints a FRESH movement
  // id and INSERTs a delta row, then sets `new_qty = current_qty + delta`
  // (crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs:259-271). A stock
  // adjustment is a RELATIVE delta with no key to replay against, so two submissions
  // credit the quantity twice -- a silent stock gain or loss that only a physical count
  // would catch, and that then feeds the next adjustment.
  //
  // SHAPE 3 (round 139): both submits inside ONE act() batch, before React re-renders.
  it('applies a stock adjustment once for a double submit while the first is in flight', async () => {
    let releaseAdjust: (v: unknown) => void = () => {};
    const heldAdjust = new Promise((resolve) => { releaseAdjust = resolve; });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_products_scoped') return Promise.resolve(SAMPLE_PRODUCTS);
      if (cmd === 'adjust_stock_scoped') return heldAdjust as never;
      recordUnmatchedInvoke(cmd);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    const user = userEvent.setup();
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });

    await user.type(screen.getByRole('searchbox'), 'latte');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /caffè latte/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: /caffè latte/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
    });

    // The qty field's accessible name is the whole label, which also carries the
    // "Current stock" hint; the reason is a <select>, not a textbox.
    const qtyInput = document.getElementById('inv-field-qty') as HTMLInputElement;
    await user.clear(qtyInput);
    await user.type(qtyInput, '5');
    fireEvent.change(document.getElementById('inv-field-reason') as HTMLSelectElement, { target: { value: 'restock' } });

    const applyBtn = screen.getByRole('button', { name: /apply/i });
    await act(async () => {
      fireEvent.click(applyBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second click to the handler the way a real one would.
      applyBtn.removeAttribute('disabled');
      fireEvent.click(applyBtn);
    });

    const adjustCalls = invokeMock.mock.calls.filter((c: unknown[]) => c[0] === 'adjust_stock_scoped');
    expect(
      adjustCalls.length,
      'a second submit re-applied the adjustment; the backend mints a fresh movement id ' +
        'per call with no dedupe, so the stock delta is credited twice',
    ).toBe(1);

    releaseAdjust(25);
    await act(async () => { await heldAdjust; });
  });
  it('rejects fractional quantities instead of silently truncating them', async () => {
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByRole('searchbox'), 'latte');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /caffè latte/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: /caffè latte/i }));

    await userEvent.type(screen.getByRole('spinbutton'), '2.5');
    await userEvent.selectOptions(screen.getByLabelText(/reason/i), 'damaged');

    // The apply button stays disabled for a fractional quantity — the
    // previous `parseInt(quantity, 10)` would have sent 2 silently.
    expect(screen.getByRole('button', { name: /apply restock/i })).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalledWith('adjust_stock');
  });

  // ── Durable product-load error (INV-08) ────────────────────────

  it('shows a persistent error with retry when products fail to load', async () => {
    invokeMock.mockRejectedValue(new Error('list_products_scoped failed'));
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);

    await waitFor(() => {
      expect(document.querySelector('.inv-adjust-load-error')).toBeInTheDocument();
    });
    expect(document.querySelector('.inv-adjust-load-error')!.textContent).toContain('Failed to load products');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('recovers when Retry succeeds after a failed product load', async () => {
    invokeMock.mockRejectedValueOnce(new Error('list_products_scoped failed'));
    renderWithFluentSync(<ToastProvider><InventoryAdjustmentScreen /></ToastProvider>, inventoryFtl);

    await waitFor(() => {
      expect(document.querySelector('.inv-adjust-load-error')).toBeInTheDocument();
    });

    // The default beforeEach implementation returns SAMPLE_PRODUCTS on retry.
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.querySelector('.inv-adjust-load-error')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
});
