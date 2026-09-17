import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
