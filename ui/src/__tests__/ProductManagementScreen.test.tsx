import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import productsFtl from '@/locales/products.ftl?raw';
import ProductManagementScreen from '@/features/products/ProductManagementScreen';

const SAMPLE_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
  { code: 'EUR', name: 'Euro', minor_exponent: 2, symbol: '€' },
];

const SAMPLE_CATEGORIES = [
  { id: 'cat-1', name: 'Beverages', colour: '#3b82f6', icon: 'coffee' },
  { id: 'cat-2', name: 'Food', colour: '#f97316', icon: 'food' },
];

const SAMPLE_TAX_RATES = [
  { id: 'tax-1', name: 'Sales Tax', rate_bps: 825, is_default: true, display_rate: '8.25%', is_inclusive: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'tax-2', name: 'VAT', rate_bps: 2000, is_default: false, display_rate: '20%', is_inclusive: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

const SAMPLE_PRODUCTS = [
  {
    sku: 'LATTE',
    name: 'Caffè Latte',
    category: 'Beverages',
    price: { minor_units: 450, currency: 'USD' },
    barcode: '4901234567890',
    in_stock: true,
    stock_qty: null,
  },
  {
    sku: 'BAGEL',
    name: 'Plain Bagel',
    category: 'Food',
    price: { minor_units: 250, currency: 'USD' },
    barcode: null,
    in_stock: true,
    stock_qty: null,
  },
  {
    sku: 'BROWNIE',
    name: 'Fudge Brownie',
    category: 'Food',
    price: { minor_units: 295, currency: 'USD' },
    barcode: '4901234567906',
    in_stock: false,
    stock_qty: null,
  },
];

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === 'list_products' || cmd === 'list_products_scoped') {
      return Promise.resolve(SAMPLE_PRODUCTS);
    }
    if (cmd === 'list_currencies_scoped') {
      return Promise.resolve(SAMPLE_CURRENCIES);
    }
    if (cmd === 'list_categories' || cmd === 'list_categories_scoped') {
      return Promise.resolve(SAMPLE_CATEGORIES);
    }
    if (cmd === 'list_tax_rates_scoped') {
      return Promise.resolve(SAMPLE_TAX_RATES);
    }
    if (
      cmd === 'create_product' || cmd === 'create_product_scoped' ||
      cmd === 'update_product' || cmd === 'update_product_scoped' ||
      cmd === 'delete_product' || cmd === 'delete_product_scoped'
    ) {
      return Promise.resolve({ sku: 'LATTE' });
    }
    return Promise.resolve([]);
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'test-user' }, logout: vi.fn() }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-session-token',
    currentInstanceId: 'inst-1',
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_products' || cmd === 'list_products_scoped') {
      return Promise.resolve(SAMPLE_PRODUCTS);
    }
    if (cmd === 'list_currencies_scoped') {
      return Promise.resolve(SAMPLE_CURRENCIES);
    }
    if (cmd === 'list_categories' || cmd === 'list_categories_scoped') {
      return Promise.resolve(SAMPLE_CATEGORIES);
    }
    if (cmd === 'list_tax_rates_scoped') {
      return Promise.resolve(SAMPLE_TAX_RATES);
    }
    if (
      cmd === 'create_product' || cmd === 'create_product_scoped' ||
      cmd === 'update_product' || cmd === 'update_product_scoped' ||
      cmd === 'delete_product' || cmd === 'delete_product_scoped'
    ) {
      return Promise.resolve({ sku: 'LATTE' });
    }
    return Promise.resolve([]);
  });
});

async function waitForTable() {
  await screen.findByRole('table', { name: /product catalog/i });
}

describe('ProductManagementScreen', () => {
  it('renders title and add button', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    expect(screen.getByRole('heading', { name: /products/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
  });

  it('renders product rows from IPC data', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    expect(screen.getByText('Plain Bagel')).toBeInTheDocument();
    expect(screen.getByText('Fudge Brownie')).toBeInTheDocument();
  });

  it('renders column headers', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    expect(screen.getByText('SKU')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Stock')).toBeInTheDocument();
  });

  it('shows stock status', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    const inStock = screen.getAllByText(/in stock/i);
    expect(inStock.length).toBe(2);
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it('shows formatted prices', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    expect(screen.getByText('$ 4,50')).toBeInTheDocument();
    expect(screen.getByText('$ 2,50')).toBeInTheDocument();
  });

  it('shows barcode or dash', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    expect(screen.getByText('4901234567890')).toBeInTheDocument();
    const dashes = screen.getAllByText('\u2014');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('opens add modal when clicking Add Product', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /add product/i })).toBeInTheDocument();
  });

  it('opens edit modal prefilled with product data', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    const editBtn = screen.getByRole('button', { name: /edit caffè latte/i });
    await userEvent.click(editBtn);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('LATTE')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Caffè Latte')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('450')).toBeInTheDocument();
  });

  it('disables SKU field when editing', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /edit caffè latte/i }));
    const skuInput = screen.getByDisplayValue('LATTE');
    expect(skuInput).toBeDisabled();
  });

  it('calls createProduct on save in add modal', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. LATTE'), 'NEWSKU');
    await userEvent.type(screen.getByPlaceholderText('e.g. Caffè Latte'), 'New Product');
    await userEvent.type(screen.getByPlaceholderText('450'), '999');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create_product_scoped', expect.any(Object));
    });
  });

  it('calls updateProduct on save in edit modal', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /edit caffè latte/i }));
    const nameInput = screen.getByDisplayValue('Caffè Latte');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Latte Macchiato');
    await userEvent.click(screen.getByRole('button', { name: /update/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_product_scoped', expect.any(Object));
    });
  });

  it('requires confirmation before calling deleteProductScoped (PROD-02)', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    // Clicking Delete opens the confirmation dialog but must NOT delete yet.
    await userEvent.click(screen.getByRole('button', { name: /delete caffè latte/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('delete_product_scoped', expect.anything());

    // Cancelling closes the dialog without deleting.
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalledWith('delete_product_scoped', expect.anything());
  });

  it('deletes after confirming the dialog', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /delete caffè latte/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('delete_product_scoped', expect.objectContaining({
        args: { sku: 'LATTE' },
      }));
    });
  });

  it('surfaces a delete failure instead of swallowing it (PROD-03)', async () => {
    invokeMock.mockImplementation(((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') return Promise.resolve(SAMPLE_PRODUCTS);
      if (cmd === 'delete_product' || cmd === 'delete_product_scoped') {
        return Promise.reject(new Error('product has sales history'));
      }
      if (cmd === 'list_currencies_scoped') return Promise.resolve(SAMPLE_CURRENCIES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      return Promise.resolve([]);
    }) as unknown as typeof invokeMock);

    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /delete caffè latte/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      // ERR-05: raw backend text never renders — the localized copy does.
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to delete product/i);
      expect(screen.queryByText(/product has sales history/i)).toBeNull();
    });
  });

  it('shows an error + retry instead of the empty catalog on load failure (PROD-04)', async () => {
    invokeMock.mockImplementation(((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') {
        return Promise.reject(new Error('database locked'));
      }
      return Promise.resolve([]);
    }) as unknown as typeof invokeMock);

    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitFor(() => {
      // ERR-05: raw backend text never renders — the localized copy does.
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load products/i);
      expect(screen.queryByText(/database locked/i)).toBeNull();
    });
    // The empty-catalog CTA must NOT be shown for a failed load.
    expect(screen.queryByText(/add your first product/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no products', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitFor(() => {
      expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
    });
  });

  it('disables save when SKU or name is empty', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    const createBtn = screen.getByRole('button', { name: /create/i });
    expect(createBtn).toBeDisabled();
  });

  // ── Bug #14: silent failure in handleSave (Axis 8) ────────────────────
  //
  // handleSave's catch block is empty (just a "// Error handling."
  // comment). When createProduct/updateProduct fails (duplicate SKU,
  // network error, validation), the error is silently swallowed — the
  // user gets ZERO feedback. The modal's loading state clears and it
  // appears to succeed, but nothing was saved. This test proves the
  // user sees an error message when creation fails.

  // ── TAX-01: product tax assignment must read the session store ───────

  it('loads tax rates and categories from the session store, not the global DB', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_tax_rates_scoped', expect.objectContaining({
        sessionToken: 'mock-session-token',
      }));
      expect(invokeMock).toHaveBeenCalledWith('list_categories_scoped', expect.objectContaining({
        sessionToken: 'mock-session-token',
      }));
    });

    // The unscoped variants must never be called by this screen.
    expect(invokeMock).not.toHaveBeenCalledWith('list_tax_rates');
    expect(invokeMock).not.toHaveBeenCalledWith('list_categories', expect.anything());
  });

  it('passes selected taxRateIds through create_product_scoped', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. LATTE'), 'NEWSKU');
    await userEvent.type(screen.getByPlaceholderText('e.g. Caffè Latte'), 'New Product');
    await userEvent.type(screen.getByPlaceholderText('450'), '999');

    // Toggle the two tax-rate checkboxes (shown when rates are loaded).
    await userEvent.click(screen.getByLabelText(/sales tax \(8\.25%\)/i));
    await userEvent.click(screen.getByLabelText(/vat \(20%\)/i));

    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create_product_scoped', expect.objectContaining({
        sessionToken: 'mock-session-token',
        args: expect.objectContaining({ taxRateIds: ['tax-1', 'tax-2'] }),
      }));
    });
  });

  it('rejects a decimal price instead of truncating it (PROD-05)', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. LATTE'), 'NEWSKU');
    await userEvent.type(screen.getByPlaceholderText('e.g. Caffè Latte'), 'New Product');
    await userEvent.type(screen.getByPlaceholderText('450'), '4.50');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/price must be a valid non-negative number/i);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('create_product_scoped', expect.anything());
  });

  it('rejects negative and malformed initial stock (PROD-06)', async () => {
    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();
    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. LATTE'), 'NEWSKU');
    await userEvent.type(screen.getByPlaceholderText('e.g. Caffè Latte'), 'New Product');
    await userEvent.type(screen.getByPlaceholderText('450'), '999');

    // Negative value must be rejected, not passed through.
    await userEvent.clear(screen.getByLabelText(/initial stock/i));
    await userEvent.type(screen.getByLabelText(/initial stock/i), '-1');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/stock must be a whole, non-negative number/i);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('create_product_scoped', expect.anything());

    // Malformed `1abc` must be rejected too, not partially parsed to 1.
    // (fireEvent bypasses the number input's browser-side sanitisation,
    // simulating the raw value that can reach the submit handler.)
    fireEvent.change(screen.getByLabelText(/initial stock/i), { target: { value: '1abc' } });
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/stock must be a whole, non-negative number/i);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('create_product_scoped', expect.anything());

    // A very large value outside safe-integer bounds must also be rejected.
    fireEvent.change(screen.getByLabelText(/initial stock/i), { target: { value: '99999999999999999999999999' } });
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/stock must be a whole, non-negative number/i);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('create_product_scoped', expect.anything());
  });

  it('surfaces a stock-alert poll failure with a retry action (PROD-10)', async () => {
    // First poll fails, then the retry succeeds.
    let failAlerts = true;
    invokeMock.mockImplementation(((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') return Promise.resolve(SAMPLE_PRODUCTS);
      if (cmd === 'list_currencies_scoped') return Promise.resolve(SAMPLE_CURRENCIES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      if (cmd === 'active_stock_alerts_scoped') {
        if (failAlerts) return Promise.reject(new Error('alert service down'));
        return Promise.resolve([{ id: 'a1', sku: 'LATTE', product_name: 'Caffè Latte', current_qty: 2, threshold: 5 }]);
      }
      return Promise.resolve([]);
    }) as unknown as typeof invokeMock);

    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    // Open the drawer — the failed poll must be visible, not silent.
    await userEvent.click(screen.getByRole('button', { name: /open stock alerts/i }));
    await waitFor(() => {
      expect(screen.getByText(/could not load stock alerts/i)).toBeInTheDocument();
    });

    // Retry recovers and the error banner disappears.
    failAlerts = false;
    await userEvent.click(screen.getByRole('button', { name: /reload alerts/i }));
    await waitFor(() => {
      expect(screen.queryByText(/could not load stock alerts/i)).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
    });
  });

  it('ignores a stale load when a newer load resolves first (PROD-11)', async () => {
    // Two overlapping loads: the delete-refresh load (call 2) stays in flight
    // while a second delete triggers call 3 which resolves immediately; the
    // stale call 2 then lands last and must NOT clobber the fresh result.
    let listCalls = 0;
    let resolveStale: ((v: unknown) => void) | null = null;
    invokeMock.mockImplementation(((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') {
        listCalls += 1;
        if (listCalls === 2) {
          // The first delete-refresh load hangs until we release it.
          return new Promise((resolve) => { resolveStale = resolve; });
        }
        return Promise.resolve([...SAMPLE_PRODUCTS]);
      }
      if (cmd === 'delete_product' || cmd === 'delete_product_scoped') return Promise.resolve({ sku: 'LATTE' });
      if (cmd === 'list_currencies_scoped') return Promise.resolve(SAMPLE_CURRENCIES);
      if (cmd === 'list_categories' || cmd === 'list_categories_scoped') return Promise.resolve(SAMPLE_CATEGORIES);
      if (cmd === 'list_tax_rates_scoped') return Promise.resolve(SAMPLE_TAX_RATES);
      return Promise.resolve([]);
    }) as unknown as typeof invokeMock);

    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    // Delete #1 → its refresh (call 2) starts and stays in flight.
    await userEvent.click(screen.getByRole('button', { name: /delete caffè latte/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(listCalls).toBe(2));

    // Delete #2 → its refresh (call 3) resolves immediately with fresh data.
    await userEvent.click(screen.getByRole('button', { name: /delete plain bagel/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(listCalls).toBe(3));

    // Now release the stale call 2 with data that would clobber the fresh
    // result if the guard were missing — the 'STALE' name must never appear.
    await act(async () => {
      resolveStale?.([{ ...SAMPLE_PRODUCTS[0], name: 'STALE' }]);
    });
    expect(screen.queryByText('STALE')).not.toBeInTheDocument();
    expect(screen.getByText('Caffè Latte')).toBeInTheDocument();
  });

  it('shows error message when createProduct fails (no silent swallow)', async () => {
    // Mock create_product to reject (e.g. duplicate SKU server-side).
    invokeMock.mockImplementation(((cmd: string) => {
      if (cmd === 'list_products' || cmd === 'list_products_scoped') return Promise.resolve(SAMPLE_PRODUCTS);
      if (cmd === 'create_product' || cmd === 'create_product_scoped') {
        return Promise.reject(new Error('SKU already exists'));
      }
      if (cmd === 'list_currencies_scoped') return Promise.resolve(SAMPLE_CURRENCIES);
      if (cmd === 'list_categories') return Promise.resolve(SAMPLE_CATEGORIES);
      return Promise.resolve([]);
    }) as unknown as typeof invokeMock);

    renderWithFluentSync(<ProductManagementScreen />, productsFtl);
    await waitForTable();

    await userEvent.click(screen.getByRole('button', { name: /add product/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. LATTE'), 'LATTE');
    await userEvent.type(screen.getByPlaceholderText('e.g. Caffè Latte'), 'Duplicate');
    await userEvent.type(screen.getByPlaceholderText('450'), '999');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    // The user must see an error message — not a silent failure.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/.+/);
  });
});
